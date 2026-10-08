import { gt, prerelease, rcompare, valid } from 'semver';
import { DOMParser, type Document as XmlDocument, type Element as XmlElement } from '@xmldom/xmldom';
import type { AppRelease, AppUpdateState, UpdateChannel } from '../src/contracts';

export const RELEASES_URL = 'https://github.com/7oMB2006/desktop-for-step-code/releases';
export const UPDATE_REPOSITORY = '7oMB2006/desktop-for-step-code';
export const UPDATE_MANIFEST_URL = `https://raw.githubusercontent.com/${UPDATE_REPOSITORY}/update-feed/latest.json`;
export const RELEASES_FEED_URL = `${RELEASES_URL}.atom`;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const CHECK_INTERVAL = 60_000;

class UpdateFailure extends Error {
  constructor(readonly kind: NonNullable<AppUpdateState['error']>, readonly retryAt?: number) { super(kind); }
}

export function releaseVersion(tag: unknown): string | undefined {
  if (typeof tag !== 'string' || tag.length > 100) return;
  return valid(tag.replace(/^v/, '')) ?? undefined;
}

function installerUrl(value: unknown, tag: string, name: string): string | undefined {
  if (typeof value !== 'string' || value.length > 2048) return;
  try {
    const url = new URL(value);
    if (url.origin !== 'https://github.com' || url.username || url.password || url.search || url.hash) return;
    if (decodeURIComponent(url.pathname) !== `/7oMB2006/desktop-for-step-code/releases/download/${tag}/${name}`) return;
    return url.href;
  } catch { return; }
}

export function selectRelease(values: unknown, channel: UpdateChannel): AppRelease | undefined {
  if (!Array.isArray(values)) throw new UpdateFailure('invalid-response');
  const releases: AppRelease[] = [];
  for (const item of values) {
    if (!item || typeof item !== 'object' || item.draft !== false || typeof item.prerelease !== 'boolean') continue;
    const version = releaseVersion(item.tag_name);
    if (!version || /[/\\]/.test(item.tag_name) || (channel === 'stable' && (item.prerelease || prerelease(version)))) continue;
    const release: AppRelease = {
      version, tag: item.tag_name, name: typeof item.name === 'string' ? item.name.slice(0, 160) : version,
      prerelease: item.prerelease || Boolean(prerelease(version)),
      notes: typeof item.body === 'string' ? item.body.slice(0, 20_000) : '',
      url: `${RELEASES_URL}/tag/${encodeURIComponent(item.tag_name)}`,
    };
    if (typeof item.published_at === 'string' && Number.isFinite(Date.parse(item.published_at))) release.publishedAt = item.published_at;
    const names = [`Desktop.for.Step.Code.Setup.${version}.exe`, `Desktop for Step Code Setup ${version}.exe`];
    if (Array.isArray(item.assets)) {
      for (const asset of item.assets) {
        if (!asset || !names.includes(asset.name) || !Number.isSafeInteger(asset.size) || asset.size <= 0
          || asset.size > 2 * 1024 ** 3 || asset.state !== 'uploaded') continue;
        const url = installerUrl(asset.browser_download_url, item.tag_name, asset.name);
        if (url) { release.installer = { name: asset.name, url, size: asset.size }; break; }
      }
    }
    releases.push(release);
  }
  // Never fall back to an older version merely because the newest release lacks an installer.
  return releases.sort((a, b) => rcompare(a.version, b.version) || Number(a.prerelease) - Number(b.prerelease))[0];
}

export function createUpdateManifest(values: unknown, generatedAt = new Date().toISOString()) {
  return { schemaVersion: 1, repository: UPDATE_REPOSITORY, generatedAt,
    channels: { stable: selectRelease(values, 'stable') ?? null, preview: selectRelease(values, 'preview') ?? null } };
}

function manifestRelease(value: any): AppRelease | undefined {
  if (value === null) return;
  if (!value || typeof value !== 'object' || releaseVersion(value.tag) !== value.version
    || /[/\\]/.test(value.tag) || typeof value.prerelease !== 'boolean'
    || typeof value.name !== 'string' || value.name.length > 160
    || typeof value.notes !== 'string' || value.notes.length > 20_000
    || value.url !== `${RELEASES_URL}/tag/${encodeURIComponent(value.tag)}`
    || value.publishedAt !== undefined && (typeof value.publishedAt !== 'string' || !Number.isFinite(Date.parse(value.publishedAt)))) {
    throw new UpdateFailure('invalid-response');
  }
  const release = selectRelease([{
    tag_name: value.tag, draft: false, prerelease: value.prerelease,
    name: value.name, body: value.notes, published_at: value.publishedAt,
    assets: value.installer === undefined ? [] : [{ ...value.installer, state: 'uploaded', browser_download_url: value.installer?.url }],
  }], 'preview');
  if (!release || value.installer !== undefined && !release.installer) throw new UpdateFailure('invalid-response');
  return release;
}

export function parseUpdateManifest(value: any, channel: UpdateChannel): AppRelease | undefined {
  if (!value || value.schemaVersion !== 1 || value.repository !== UPDATE_REPOSITORY
    || typeof value.generatedAt !== 'string' || !Number.isFinite(Date.parse(value.generatedAt))
    || !value.channels || typeof value.channels !== 'object') throw new UpdateFailure('invalid-response');
  const stable = manifestRelease(value.channels.stable);
  const preview = manifestRelease(value.channels.preview);
  if (stable?.prerelease || stable && (!preview || gt(stable.version, preview.version))) throw new UpdateFailure('invalid-response');
  return channel === 'stable' ? stable : preview;
}

export function parseReleaseFeed(xml: string): AppRelease | undefined {
  // A bounded public feed is a discovery fallback, not a complete release/asset catalog.
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new UpdateFailure('invalid-response');
  let document: XmlDocument;
  try { document = new DOMParser({ onError: () => { throw new UpdateFailure('invalid-response'); } }).parseFromString(xml, 'text/xml'); }
  catch { throw new UpdateFailure('invalid-response'); }
  const feed = document.documentElement;
  const children = (node: XmlElement) => Array.from(node.childNodes).filter((child): child is XmlElement => child.nodeType === 1);
  if (feed?.localName !== 'feed' || feed.namespaceURI !== 'http://www.w3.org/2005/Atom'
    || !children(feed).some(node => node.localName === 'id' && node.textContent === `tag:github.com,2008:${RELEASES_URL}`)) {
    throw new UpdateFailure('invalid-response');
  }
  const releases: AppRelease[] = [];
  for (const entry of children(feed).filter(node => node.localName === 'entry')) {
    const href = children(entry).find(node => node.localName === 'link' && node.getAttribute('rel') === 'alternate')?.getAttribute('href');
    if (!href?.startsWith(`${RELEASES_URL}/tag/`)) throw new UpdateFailure('invalid-response');
    let tag: string;
    try { tag = decodeURIComponent(href.slice(`${RELEASES_URL}/tag/`.length)); }
    catch { throw new UpdateFailure('invalid-response'); }
    const version = releaseVersion(tag);
    if (!version) continue;
    if (/[/\\]/.test(tag) || href !== `${RELEASES_URL}/tag/${encodeURIComponent(tag)}`) throw new UpdateFailure('invalid-response');
    const name = children(entry).find(node => node.localName === 'title')?.textContent;
    releases.push({ version, tag, name: name?.slice(0, 160) || version, notes: '', url: href });
  }
  return releases.sort((a, b) => rcompare(a.version, b.version))[0];
}

async function responseText(response: Response): Promise<string> {
  const size = Number(response.headers.get('content-length'));
  if (size > MAX_RESPONSE_BYTES) { await response.body?.cancel(); throw new UpdateFailure('invalid-response'); }
  const reader = response.body?.getReader();
  if (!reader) throw new UpdateFailure('invalid-response');
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > MAX_RESPONSE_BYTES) { await reader.cancel(); throw new UpdateFailure('invalid-response'); }
      chunks.push(value);
    }
    return Buffer.concat(chunks).toString('utf8');
  } finally { reader.releaseLock(); }
}

export function updatePreferences(patch: { autoCheckUpdates?: unknown; updateChannel?: unknown }) {
  if (patch.autoCheckUpdates !== undefined && typeof patch.autoCheckUpdates !== 'boolean') throw new Error('Invalid automatic update setting');
  if (patch.updateChannel !== undefined && patch.updateChannel !== 'preview' && patch.updateChannel !== 'stable') throw new Error('Invalid update channel');
  return { ...(patch.autoCheckUpdates !== undefined ? { autoCheckUpdates: patch.autoCheckUpdates as boolean } : {}),
    ...(patch.updateChannel !== undefined ? { updateChannel: patch.updateChannel as UpdateChannel } : {}) };
}

export class AppUpdates {
  private state: AppUpdateState;
  private pending?: Promise<AppUpdateState>;
  private abort?: AbortController;
  private revision = 0;
  private lastAttempts = new Map<UpdateChannel, number>();
  private results = new Map<UpdateChannel, AppUpdateState>();
  private blockedUntil = 0;
  constructor(currentVersion: string, private request: (url: string, options: RequestInit) => Promise<Response>,
    private changed: (state: AppUpdateState) => void, private now = Date.now, private timeout = 15_000) {
    this.state = { currentVersion, channel: 'preview', status: 'idle' };
  }
  snapshot(): AppUpdateState { return structuredClone(this.state); }
  private publish(state: AppUpdateState) {
    this.state = state;
    if (state.status !== 'idle' && state.status !== 'checking') this.results.set(state.channel, this.snapshot());
    this.changed(this.snapshot());
  }
  private async fetch(url: string, signal: AbortSignal, accept: string): Promise<Response> {
    const response = await this.request(url, { signal, credentials: 'omit', redirect: 'error',
      cache: 'no-cache', headers: { Accept: accept } });
    if (response.ok || response.status === 404 && url === UPDATE_MANIFEST_URL) return response;
    await response.body?.cancel();
    if (response.status === 429 || response.status === 403 && response.headers.get('x-ratelimit-remaining') === '0') {
      const reset = Number(response.headers.get('x-ratelimit-reset')) * 1000;
      const after = Number(response.headers.get('retry-after')) * 1000;
      const retryAt = Math.max(this.now() + CHECK_INTERVAL, Number.isFinite(reset) ? reset : 0,
        this.now() + (Number.isFinite(after) ? after : 0));
      throw new UpdateFailure('rate-limit', Math.min(retryAt, this.now() + 24 * 60 * 60 * 1000));
    }
    throw new UpdateFailure('network');
  }
  setChannel(channel: UpdateChannel) {
    if (channel === this.state.channel) return;
    if (this.state.status === 'checking') this.lastAttempts.delete(this.state.channel);
    this.revision++; this.abort?.abort(); this.pending = undefined;
    this.publish(this.results.get(channel) ?? { currentVersion: this.state.currentVersion, channel, status: 'idle' });
  }
  check(): Promise<AppUpdateState> {
    if (this.pending) return this.pending;
    const now = this.now();
    if (now < this.blockedUntil) {
      this.publish({ ...this.state, status: 'error',
        error: 'rate-limit', checkedAt: now, retryAt: this.blockedUntil });
      return Promise.resolve(this.snapshot());
    }
    if (this.state.retryAt && now < this.state.retryAt) return Promise.resolve(this.snapshot());
    const lastAttempt = this.lastAttempts.get(this.state.channel);
    if (lastAttempt !== undefined && now - lastAttempt < CHECK_INTERVAL) {
      return Promise.resolve(this.snapshot());
    }
    this.lastAttempts.set(this.state.channel, now);
    const revision = this.revision;
    const previous = this.snapshot();
    const { currentVersion, channel } = this.state;
    const abort = new AbortController();
    this.abort = abort;
    this.publish({ ...previous, status: 'checking', error: undefined, retryAt: undefined });
    const timer = setTimeout(() => abort.abort(), this.timeout);
    this.pending = Promise.resolve().then(async () => {
      try {
        if (!releaseVersion(currentVersion)) throw new UpdateFailure('unsupported-version');
        const response = await this.fetch(UPDATE_MANIFEST_URL, abort.signal, 'application/json');
        let release: AppRelease | undefined;
        let source: AppUpdateState['source'] = 'manifest';
        if (response.status === 404) {
          await response.body?.cancel();
          // Atom cannot identify GitHub's stable/prerelease flag or installer assets.
          if (channel === 'stable') throw new UpdateFailure('feed-unavailable');
          source = 'release-feed';
          release = parseReleaseFeed(await responseText(await this.fetch(RELEASES_FEED_URL, abort.signal, 'application/atom+xml')));
        } else {
          let manifest: unknown;
          try { manifest = JSON.parse(await responseText(response)); }
          catch (error) { if (error instanceof UpdateFailure) throw error; throw new UpdateFailure('invalid-response'); }
          release = parseUpdateManifest(manifest, channel);
        }
        if (revision === this.revision) this.publish({
          currentVersion, channel, checkedAt: this.now(), source, updateAvailable: Boolean(release && gt(release.version, currentVersion)),
          status: !release ? 'no-release' : gt(release.version, currentVersion) ? 'available' : 'current', release,
        });
      } catch (error) {
        if (error instanceof UpdateFailure && error.kind === 'rate-limit') this.blockedUntil = error.retryAt ?? 0;
        if (revision === this.revision) this.publish({ ...previous, currentVersion, channel, status: 'error', checkedAt: this.now(),
          error: error instanceof UpdateFailure ? error.kind : 'network',
          retryAt: error instanceof UpdateFailure ? error.retryAt : undefined });
      } finally {
        clearTimeout(timer);
        if (revision === this.revision) { this.pending = undefined; this.abort = undefined; }
      }
      return this.snapshot();
    });
    return this.pending;
  }
  openTarget(action: unknown): string {
    if (action === 'release') return this.state.release?.url ?? RELEASES_URL;
    if (action !== 'download' || !this.state.updateAvailable || !this.state.release?.installer) throw new Error('No verified update download');
    return this.state.release.installer.url;
  }
  dispose() { this.revision++; this.abort?.abort(); }
}
