import assert from 'node:assert/strict';
import test from 'node:test';
import { AppUpdates, RELEASES_URL, UPDATE_MANIFEST_URL, RELEASES_FEED_URL, createUpdateManifest, parseUpdateManifest, parseReleaseFeed, releaseVersion, selectRelease, updatePreferences } from '../electron/app-updates';
import type { AppUpdateState } from '../src/contracts';

const release = (version: string, preview = false) => ({
  tag_name: `v${version}`, draft: false, prerelease: preview, name: `Version ${version}`, body: '# Changes\nTest release',
  published_at: '2026-10-08T00:00:00Z',
  assets: [{ name: `Desktop.for.Step.Code.Setup.${version}.exe`, state: 'uploaded', size: 150_000_000,
    browser_download_url: `${RELEASES_URL}/download/v${version}/Desktop.for.Step.Code.Setup.${version}.exe` }],
});
const response = (body: unknown) => new Response(JSON.stringify(createUpdateManifest(body)));
const feed = (tags: string[]) => `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom">
  <id>tag:github.com,2008:${RELEASES_URL}</id>${tags.map(tag => `<entry><title>Version ${tag}</title>
  <link rel="alternate" href="${RELEASES_URL}/tag/${tag}"/></entry>`).join('')}</feed>`;

test('semantic version comparison includes numeric ordering and ignores publish order', () => {
  assert.equal(releaseVersion('v0.10.0'), '0.10.0');
  assert.equal(releaseVersion('v0.2.0-rc.1'), '0.2.0-rc.1');
  for (const invalid of ['main', 'latest', 'v01.2.3', '', null, {}, '1.2']) assert.equal(releaseVersion(invalid), undefined);
  const values = [release('0.2.0'), release('0.10.0'), release('0.9.0')];
  assert.equal(selectRelease(values, 'stable')?.version, '0.10.0');
});

test('preview channel includes GitHub prereleases even without a semver suffix', () => {
  const values = [release('0.1.0', true), release('0.2.0-rc.1'), { ...release('9.0.0'), draft: true }, release('0.0.9')];
  assert.equal(selectRelease(values, 'preview')?.version, '0.2.0-rc.1');
  assert.equal(selectRelease(values, 'stable')?.version, '0.0.9');
  assert.equal(selectRelease([release('0.1.0', true)], 'preview')?.version, '0.1.0');
  assert.equal(selectRelease([release('0.1.0', true)], 'stable'), undefined);
  assert.equal(selectRelease([release('0.2.0', true), release('0.2.0')], 'preview')?.prerelease, false);
});

test('installer targets must be exact release assets in the official repository', () => {
  const item = release('0.2.0');
  assert.ok(selectRelease([item], 'preview')?.installer);
  const asset = item.assets[0];
  for (const url of [
    'https://example.com/installer.exe',
    asset.browser_download_url.replace('7oMB2006', 'other'),
    asset.browser_download_url.replace('v0.2.0/', 'v0.1.0/'),
    asset.browser_download_url.replace('https:', 'http:'),
    asset.browser_download_url.replace('github.com/', 'github.com.evil/'),
    asset.browser_download_url.replace('github.com/', 'user@github.com/'),
    `${asset.browser_download_url}?redirect=https://example.com`,
    `${asset.browser_download_url}#test`,
  ]) assert.equal(selectRelease([{ ...item, assets: [{ ...asset, browser_download_url: url }] }], 'preview')?.installer, undefined);
  for (const patch of [{ name: 'other.exe' }, { state: 'new' }, { size: 0 }, { size: Infinity }, { size: 3 * 1024 ** 3 }]) {
    assert.equal(selectRelease([{ ...item, assets: [{ ...asset, ...patch }] }], 'preview')?.installer, undefined);
  }
  const name = 'Desktop for Step Code Setup 0.2.0.exe';
  assert.ok(selectRelease([{ ...item, assets: [{ ...asset, name,
    browser_download_url: `${RELEASES_URL}/download/v0.2.0/${encodeURIComponent(name)}` }] }], 'preview')?.installer);
  assert.equal(selectRelease([{ ...release('0.3.0'), assets: [] }, item], 'preview')?.version, '0.3.0');
  assert.equal(selectRelease([{ ...release('0.3.0'), assets: [] }, item], 'preview')?.installer, undefined);
});

test('release projection is bounded and ignores unsafe/malformed metadata', () => {
  assert.throws(() => selectRelease({}, 'preview'));
  const item = { ...release('0.2.0'), body: 'a'.repeat(30_000), name: 'b'.repeat(300), published_at: 'not a date',
    html_url: 'https://evil.com' };
  const result = selectRelease([null, 'bad', { tag_name: 'latest' }, item], 'preview')!;
  assert.equal(result.notes.length, 20_000);
  assert.equal(result.name.length, 160);
  assert.equal(result.publishedAt, undefined);
  assert.equal(result.url, `${RELEASES_URL}/tag/v0.2.0`);
});

test('checks coalesce, throttle requests and reject arbitrary open targets', async () => {
  let now = 1000;
  let calls = 0;
  const states: AppUpdateState[] = [];
  const updates = new AppUpdates('0.1.0', async (url, options) => {
    calls++;
    assert.equal(url, UPDATE_MANIFEST_URL);
    assert.equal(options.credentials, 'omit');
    assert.equal(options.redirect, 'error');
    assert.equal((options.headers as Record<string, string>).Authorization, undefined);
    return response([release('0.2.0')]);
  }, state => states.push(state), () => now);
  assert.equal(updates.openTarget('release'), RELEASES_URL);
  assert.throws(() => updates.openTarget('download'));
  assert.throws(() => updates.openTarget('https://evil.com'));
  const first = updates.check();
  assert.equal(updates.check(), first);
  const result = await first;
  assert.equal(result.status, 'available');
  assert.equal(calls, 1);
  assert.deepEqual(states.map(state => state.status), ['checking', 'available']);
  assert.equal(updates.openTarget('download'), release('0.2.0').assets[0].browser_download_url);
  await updates.check();
  assert.equal(calls, 1);
  now += 60_000;
  await updates.check();
  assert.equal(calls, 2);
  result.release!.version = 'tampered';
  assert.equal(updates.snapshot().release?.version, '0.2.0');
});

test('equal and older versions do not prompt an upgrade or allow a download', async () => {
  for (const version of ['0.1.0', '0.0.9', '0.1.0+build.2']) {
    const updates = new AppUpdates('0.1.0', async () => response([release(version)]), () => {});
    assert.equal((await updates.check()).status, 'current');
    assert.throws(() => updates.openTarget('download'));
  }
  const missing = new AppUpdates('0.1.0', async () => response([]), () => {});
  assert.equal((await missing.check()).status, 'no-release');
  const invalid = new AppUpdates('not-a-version', async () => { throw new Error('must not fetch'); }, () => {});
  assert.equal((await invalid.check()).error, 'unsupported-version');
});

test('channel changes discard late replies and cached results remain meaningful', async () => {
  let finish!: (value: Response) => void;
  let calls = 0;
  const updates = new AppUpdates('0.1.0', async () => ++calls === 1 ? new Promise(resolve => { finish = resolve; })
    : response([release('0.2.0', true), release('0.1.0')]), () => {});
  const old = updates.check();
  await Promise.resolve();
  updates.setChannel('stable');
  const stable = await updates.check();
  assert.equal(stable.channel, 'stable');
  assert.equal(stable.status, 'current');
  finish(response([release('9.0.0')]));
  await old;
  assert.equal(updates.snapshot().release?.version, '0.1.0');
  // A completed channel can be revisited without presenting a blank cached state.
  updates.setChannel('preview');
  updates.setChannel('stable');
  assert.equal((await updates.check()).status, 'current');
});

test('network, malformed payload, oversize body and timeout are not reported as up-to-date', async () => {
  const requests = [
    async () => { throw new Error('secret details must not cross IPC'); },
    async () => new Response('bad json'),
    async () => response({}),
    async () => new Response('x', { headers: { 'content-length': '3000000' } }),
    async () => new Response('x'.repeat(2 * 1024 * 1024 + 1)),
    async () => new Response('failed', { status: 500 }),
  ];
  for (const request of requests) {
    const updates = new AppUpdates('0.1.0', request, () => {});
    const result = await updates.check();
    assert.equal(result.status, 'error');
    assert.equal(result.release, undefined);
    assert.ok(!JSON.stringify(result).includes('secret details'));
  }
  const timeout = new AppUpdates('0.1.0', (_url, options) => new Promise((_resolve, reject) => {
    options.signal!.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
  }), () => {}, Date.now, 10);
  assert.equal((await timeout.check()).error, 'network');
});

test('rate-limit reset is honored across channels and cannot be an infinite timestamp', async () => {
  let now = 1000;
  let calls = 0;
  const updates = new AppUpdates('0.1.0', async () => {
    calls++;
    return new Response('', { status: 403, headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '100' } });
  }, () => {}, () => now);
  assert.equal((await updates.check()).retryAt, 100_000);
  updates.setChannel('stable');
  assert.equal((await updates.check()).error, 'rate-limit');
  assert.equal(calls, 1);
  now = 101_000;
  await updates.check();
  assert.equal(calls, 2);
  const odd = new AppUpdates('0.1.0', async () => new Response('', { status: 429,
    headers: { 'retry-after': 'Infinity', 'x-ratelimit-reset': 'Infinity' } }), () => {}, () => 1000);
  assert.ok(Number.isFinite((await odd.check()).retryAt));
});

test('static manifest finds channel heads without querying the REST API', async () => {
  let calls = 0;
  const updates = new AppUpdates('0.1.0', async url => {
    calls++;
    assert.equal(url, UPDATE_MANIFEST_URL);
    return response([release('0.2.0', true), release('0.10.0'), release('0.9.0')]);
  }, () => {});
  assert.equal((await updates.check()).release?.version, '0.10.0');
  assert.equal(calls, 1);
});

test('manifest schema, repository, channel membership and installer targets are validated', () => {
  const manifest = createUpdateManifest([release('0.1.0', true)]);
  assert.equal(parseUpdateManifest(manifest, 'preview')?.version, '0.1.0');
  assert.equal(parseUpdateManifest(manifest, 'stable'), undefined);
  for (const patch of [{ schemaVersion: 2 }, { repository: 'other/repo' }, { generatedAt: 'invalid' },
    { channels: {} }, { channels: { stable: manifest.channels.preview, preview: manifest.channels.preview } },
    { channels: { stable: null, preview: { ...manifest.channels.preview, url: 'https://evil.example' } } },
    { channels: { stable: null, preview: { ...manifest.channels.preview, installer: { ...manifest.channels.preview!.installer, url: 'https://evil.example/file.exe' } } } }]) {
    assert.throws(() => parseUpdateManifest({ ...manifest, ...patch }, 'preview'));
  }
  assert.throws(() => parseUpdateManifest(createUpdateManifest([release('0.1.0')], 'invalid'), 'stable'));
});

test('confirmed update remains visible during checks and transient errors, but clears after successful comparison', async () => {
  let now = 1000;
  let fail = false;
  const states: AppUpdateState[] = [];
  const updates = new AppUpdates('0.1.0', async () => {
    if (fail) throw new Error('offline');
    return response([release(now === 1000 ? '0.2.0' : '0.1.0')]);
  }, state => states.push(state), () => now);
  assert.equal((await updates.check()).updateAvailable, true);
  now += 60_001;
  fail = true;
  const error = await updates.check();
  assert.equal(error.status, 'error');
  assert.equal(error.updateAvailable, true);
  assert.equal([...states].reverse().find(state => state.status === 'checking')?.updateAvailable, true);
  assert.ok(updates.openTarget('download').includes('0.2.0'));
  now += 60_001;
  fail = false;
  assert.equal((await updates.check()).updateAvailable, false);
  assert.throws(() => updates.openTarget('download'));
});

test('missing manifest falls back to the official Atom feed, never guesses assets or prerelease flags', async () => {
  const calls: string[] = [];
  const updates = new AppUpdates('0.1.0', async url => {
    calls.push(url);
    return url === UPDATE_MANIFEST_URL ? new Response('', { status: 404 }) : new Response(feed(['v0.1.0', 'v0.2.0']));
  }, () => {});
  const result = await updates.check();
  assert.deepEqual(calls, [UPDATE_MANIFEST_URL, RELEASES_FEED_URL]);
  assert.equal(result.source, 'release-feed');
  assert.equal(result.status, 'available');
  assert.equal(result.release?.version, '0.2.0');
  assert.equal(result.release?.installer, undefined);
  assert.equal(result.release?.prerelease, undefined);
  assert.throws(() => updates.openTarget('download'));
  assert.equal(updates.openTarget('release'), `${RELEASES_URL}/tag/v0.2.0`);
  updates.setChannel('stable');
  const stable = await updates.check();
  assert.equal(stable.error, 'feed-unavailable');
  assert.equal(calls.length, 3, 'stable channel cannot infer prerelease status from Atom');
});

test('invalid, limited and failed static sources do not silently use an incomplete fallback', async () => {
  for (const status of [403, 429, 500]) {
    let calls = 0;
    const updates = new AppUpdates('0.1.0', async () => { calls++; return new Response('', { status }); }, () => {});
    assert.equal((await updates.check()).status, 'error');
    assert.equal(calls, 1);
  }
  for (const xml of ['bad xml', '<feed/>', feed(['v0.2.0']).replace('</feed>', ''),
    feed(['v0.2.0']).replace('</entry>', '</wrong>'), feed(['v0.2.0']).replace('7oMB2006', 'other'),
    `<!DOCTYPE feed SYSTEM "file:///secret">${feed(['v0.2.0'])}`,
    feed(['v0.2.0']).replace(`${RELEASES_URL}/tag/v0.2.0`, 'https://evil.example/v0.2.0')]) {
    assert.throws(() => parseReleaseFeed(xml));
  }
  assert.equal(parseReleaseFeed(feed(['latest'])), undefined);
  assert.equal(parseReleaseFeed(feed(['v0.2.0', 'v0.10.0']))?.version, '0.10.0');
});

test('update preferences validate IPC input without accepting coercions', () => {
  assert.deepEqual(updatePreferences({}), {});
  assert.deepEqual(updatePreferences({ updateChannel: 'stable', autoCheckUpdates: false }), { updateChannel: 'stable', autoCheckUpdates: false });
  for (const value of ['yes', 1, null, {}]) assert.throws(() => updatePreferences({ autoCheckUpdates: value }));
  for (const value of ['nightly', true, null, {}]) assert.throws(() => updatePreferences({ updateChannel: value }));
});
