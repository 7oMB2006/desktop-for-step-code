import { readFile, rename, writeFile } from 'node:fs/promises';
import { getDomain } from 'tldts';
import type { BrowserPresetMode, BrowserProfile, BrowserProfileSnapshot } from '../src/contracts';
import { publicBrowserSite } from './public-browser-policy';
import type { Session } from 'electron';

export const partitions: Record<BrowserProfile, string> = { personal: 'persist:desktop-browser', agent: 'persist:desktop-browser-agent' };
const limit = 512;

export function profileHost(value: unknown) {
  if (typeof value !== 'string' || value.length > 253
    || !value.split('.').every(label => /^[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?$/i.test(label)))
    throw new Error('Invalid website domain');
  const host = value.toLowerCase();
  if (!publicBrowserSite(`https://${host}`)) throw new Error('Invalid website domain');
  return host;
}

export function profileSite(value: unknown): string {
  const domain = publicBrowserSite(`https://${profileHost(value)}`);
  if (!domain) throw new Error('Invalid website domain');
  return domain;
}

export function browserProfile(value: unknown): BrowserProfile {
  if (value !== 'personal' && value !== 'agent') throw new Error('Invalid browser profile');
  return value;
}

function storageOrigin(address: string) {
  try {
    const url = new URL(address);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return;
    const site = getDomain(url.hostname, { allowPrivateDomains: true });
    if (site) return { site, origin: url.origin };
  } catch { /* Untracked address. */ }
}

export class BrowserProfiles {
  private writes = Promise.resolve();
  private origins: Record<BrowserProfile, Map<string, string>> = { personal: new Map(), agent: new Map() };
  private presets = new Map<string, BrowserPresetMode>();
  constructor(private file: string, private getSession: (profile: BrowserProfile) => Session,
    private favicon: (domain: string, origin?: string) => string | undefined) {}

  async restore() {
    try {
      const value = JSON.parse(await readFile(this.file, 'utf8'));
      for (const profile of ['personal', 'agent'] as const) {
        if (!Array.isArray(value?.origins?.[profile])) continue;
        for (const address of value.origins[profile].slice(0, limit)) this.record(profile, address, false);
      }
      if (Array.isArray(value?.presets)) for (const row of value.presets.slice(0, limit)) {
        try {
          const domain = profileSite(row?.domain);
          if (row.mode === 'anonymous' || row.mode === 'agent') this.presets.set(domain, row.mode);
        } catch { /* Ignore invalid stored rows. */ }
      }
    } catch { /* An empty profile needs no metadata file. */ }
  }

  private save() {
    const next = this.writes.catch(() => {}).then(async () => {
      const content = JSON.stringify({ origins: { personal: [...this.origins.personal.keys()], agent: [...this.origins.agent.keys()] },
        presets: [...this.presets].map(([domain, mode]) => ({ domain, mode })) });
      const temp = `${this.file}.tmp`;
      await writeFile(temp, content, { mode: 0o600 });
      await rename(temp, this.file);
    });
    this.writes = next;
    return next;
  }

  record(profile: BrowserProfile, address: string, persist = true) {
    const location = typeof address === 'string' ? storageOrigin(address) : undefined;
    const list = this.origins[profile];
    if (!location || list.has(location.origin)) return;
    if (list.size >= limit) list.delete(list.keys().next().value!);
    list.set(location.origin, location.site);
    if (persist) void this.save().catch(() => {});
  }

  usesAgentProfile(site: string) { return this.presets.get(site) === 'agent'; }

  private representativeOrigins(profile: BrowserProfile) {
    const sites = new Map<string, string>();
    for (const [origin, site] of this.origins[profile]) {
      const previous = sites.get(site);
      if (!previous || !publicBrowserSite(previous) || publicBrowserSite(origin)) sites.set(site, origin);
    }
    return sites;
  }

  openAddress(profile: BrowserProfile, target: unknown) {
    if (typeof target === 'string') return `https://${profileHost(target)}/`;
    if (!target || typeof target !== 'object' || !('origin' in target) || typeof target.origin !== 'string')
      throw new Error('Invalid browser profile target');
    const { origin } = target;
    if (!this.origins[profile].has(origin) || !publicBrowserSite(origin)) throw new Error('No known address for this site');
    return `${origin}/`;
  }

  async snapshot(): Promise<BrowserProfileSnapshot> {
    const list = async (profile: BrowserProfile) => {
      const known = this.representativeOrigins(profile);
      const domains = new Set(known.keys());
      for (const cookie of await this.getSession(profile).cookies.get({})) {
        const site = getDomain(cookie.domain?.replace(/^\./, '') ?? '', { allowPrivateDomains: true });
        if (site) domains.add(site);
      }
      return [...domains].map(domain => {
        const origin = known.get(domain);
        return { domain, host: origin ? new URL(origin).host : undefined, openOrigin: origin && publicBrowserSite(origin) ? origin : undefined,
          favicon: origin ? this.favicon(domain, origin) : undefined };
      }).sort((a, b) => (a.host ?? a.domain).localeCompare(b.host ?? b.domain));
    };
    const [personal, agent] = await Promise.all([list('personal'), list('agent')]);
    return { sites: { personal, agent }, presets: [...this.presets].map(([domain, mode]) => ({ domain, mode, favicon: this.favicon(domain) })) };
  }

  async clear(profile: BrowserProfile, domain: string) {
    const store = this.getSession(profile);
    const list = this.origins[profile];
    const origins = [...list].filter(([, site]) => site === domain).map(([origin]) => origin);
    const scope = [...new Set([...origins, `https://${domain}`, `http://${domain}`])];
    await store.clearData({ origins: scope, dataTypes: ['cookies', 'localStorage', 'indexedDB', 'fileSystems', 'serviceWorkers', 'backgroundFetch', 'webSQL'],
      originMatchingMode: 'origin-in-all-contexts' });
    await Promise.all(scope.map(origin => store.clearStorageData({ origin, storages: ['cachestorage'] })));
    for (const origin of origins) list.delete(origin);
    await this.save();
    return this.snapshot();
  }

  async setPreset(domain: string, mode: unknown, previous?: string) {
    if (mode !== null && mode !== 'anonymous' && mode !== 'agent') throw new Error('Invalid browser opening preset');
    if (mode !== null && previous !== domain && this.presets.has(domain)) throw new Error('A preset for this site already exists');
    if (previous && !this.presets.has(previous)) throw new Error('The original preset no longer exists');
    if (mode !== null && !previous && this.presets.size >= limit) throw new Error('Browser preset limit reached');
    if (previous) this.presets.delete(previous);
    if (mode === null) this.presets.delete(domain);
    else this.presets.set(domain, mode);
    await this.save();
    return this.snapshot();
  }
}
