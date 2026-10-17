import { realpathSync } from 'node:fs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, readFile, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { UpdateInstaller, InstallerFailure, validateInstallerMetadata, isUpdateRequestAllowed, isUpdateResponseAllowed, type UpdateDriver } from '../electron/update-installer';
import { cleanInstalledUpdate, verifyInstallerFile, prepareUpdateCache } from '../electron/update-cache';
import { createUpdateManifest, parseUpdateManifest, RELEASES_URL } from '../electron/app-updates';
import type { AppRelease, UpdateTransfer } from '../src/contracts';

const release: AppRelease = { version: '0.5.0', tag: 'v0.5.0', name: 'Release', notes: '', url: `${RELEASES_URL}/tag/v0.5.0`,
  installer: { name: 'Desktop.for.Step.Code.Setup.0.5.0.exe', url: `${RELEASES_URL}/download/v0.5.0/Desktop.for.Step.Code.Setup.0.5.0.exe`, size: 128, inApp: true } };
const digest = createHash('sha512').update('fixture').digest('base64');
const info = () => ({ version: '0.5.0', files: [{ url: release.installer!.name, size: 128, sha512: digest }] });
function fixture(supported = true) {
  let finish!: () => void;
  let progress!: (value: Partial<UpdateTransfer>) => void;
  let downloads = 0; let installs = 0; let verified = 0;
  const driver: UpdateDriver = {
    download: async (_release, signal, callback) => {
      downloads++; progress = callback;
      await new Promise<void>(resolve => { finish = resolve; signal.addEventListener('abort', () => resolve(), { once: true }); });
    },
    verify: async () => { verified++; },
    install: () => { installs++; },
  };
  const controller = new UpdateInstaller('0.4.0', supported, () => driver, () => {});
  return { controller, driver, finish: () => finish(), progress: (value: Partial<UpdateTransfer>) => progress(value),
    counts: () => ({ downloads, installs, verified }) };
}
test('metadata binds exactly one full installer to the selected release', () => {
  validateInstallerMetadata(info(), release);
  for (const invalid of [
    {}, { ...info(), version: '0.6.0' }, { ...info(), files: [] },
    { ...info(), files: [info().files[0], info().files[0]] }, { ...info(), packages: {} },
    ...[{ url: '../installer.exe' }, { url: 'https://evil.example/app.exe' }, { size: 0 }, { size: 129 },
      { sha512: 'invalid' }].map(patch => ({ ...info(), files: [{ ...info().files[0], ...patch }] })),
  ]) assert.throws(() => validateInstallerMetadata(invalid, release), InstallerFailure);
});
test('network policy pins repository assets, HTTPS destinations and bounded response sizes', () => {
  const installer = release.installer!.url;
  for (const url of [installer, installer.replace(/[^/]+$/, 'latest.yml?noCache=123'),
    'https://release-assets.githubusercontent.com/fixture?signature=fixture',
    'https://objects.githubusercontent.com/fixture']) assert.equal(isUpdateRequestAllowed(url, installer), true);
  for (const url of ['invalid', 'http://github.com/fixture', installer.replace('7oMB2006', 'other'),
    installer.replace('v0.5.0/', 'v0.4.0/'), installer.replace('github.com', 'github.com.evil'),
    installer.replace('github.com', 'user@github.com'), installer.replace('github.com', 'github.com:8443'),
    `${installer}#fragment`, 'https://example.com/fixture']) assert.equal(isUpdateRequestAllowed(url, installer), false);
  assert.equal(isUpdateResponseAllowed(200, '128', 128, false), true);
  assert.equal(isUpdateResponseAllowed(200, '128', 128, true), true);
  assert.equal(isUpdateResponseAllowed(302, undefined, 128, true), true);
  for (const length of [undefined, 0, -1, 'NaN', 'Infinity', 129]) assert.equal(isUpdateResponseAllowed(200, length, 128, false), false);
  assert.equal(isUpdateResponseAllowed(200, 128 * 1024 + 1, 128, true), false);
});
test('release feed only offers in-app updates when the metadata asset exists', () => {
  const asset = (name: string, size: number) => ({ name, size, state: 'uploaded', browser_download_url: `${RELEASES_URL}/download/v0.5.0/${name}` });
  const catalog = [{ tag_name: 'v0.5.0', draft: false, prerelease: true, assets: [asset(release.installer!.name, 128)] }];
  assert.equal(createUpdateManifest(catalog).channels.preview?.installer?.inApp, undefined);
  catalog[0].assets.push(asset('latest.yml', 300));
  const manifest = createUpdateManifest(catalog);
  assert.equal(parseUpdateManifest(manifest, 'preview')?.installer?.inApp, true);
  (manifest.channels.preview!.installer as any).inApp = 'true';
  assert.throws(() => parseUpdateManifest(manifest, 'preview'));
});
test('unsupported installations, missing metadata and non-upgrades cannot download', async () => {
  await assert.rejects(fixture(false).controller.download(release));
  await assert.rejects(fixture().controller.download({ ...release, version: '0.3.0' }));
  await assert.rejects(fixture().controller.download({ ...release, installer: { ...release.installer!, inApp: false } }));
});
test('concurrent downloads share work and never automatically install', async () => {
  const f = fixture();
  const first = f.controller.download(release);
  assert.equal(first, f.controller.download(release));
  await Promise.resolve();
  f.progress({ percent: 42, transferred: 54, total: 128, bytesPerSecond: 32 });
  assert.equal(f.controller.snapshot().status, 'downloading');
  f.finish(); await first;
  assert.equal(f.controller.snapshot().status, 'ready');
  assert.deepEqual(f.counts(), { downloads: 1, installs: 0, verified: 0 });
  await f.controller.download(release);
  assert.equal(f.counts().downloads, 1);
});
test('cancellation ignores late progress and completion, then permits retry', async () => {
  const f = fixture();
  const first = f.controller.download(release); await Promise.resolve();
  f.controller.cancel();
  f.progress({ percent: 99 }); await first;
  assert.equal(f.controller.snapshot().status, 'cancelled');
  const retry = f.controller.download(release); await Promise.resolve();
  f.finish(); await retry;
  assert.equal(f.controller.snapshot().status, 'ready');
  assert.equal(f.counts().downloads, 2);
});
test('channel changes invalidate an in-flight or downloaded release', async () => {
  const f = fixture();
  const pending = f.controller.download(release); await Promise.resolve();
  f.controller.reconcile(undefined); await pending;
  assert.equal(f.controller.snapshot().status, 'cancelled');
  const retry = f.controller.download(release); await Promise.resolve(); f.finish(); await retry;
  f.controller.reconcile({ ...release, version: '0.6.0' });
  await assert.rejects(f.controller.install(async () => {}));
});
test('an immediate retry waits for cancellation to settle and starts exactly one new download', async () => {
  const f = fixture();
  let finish!: () => void;
  let attempts = 0;
  f.driver.download = () => { attempts++; return new Promise(resolve => { finish = resolve; }); };
  const first = f.controller.download(release); await Promise.resolve();
  f.controller.cancel();
  const retry = f.controller.download(release);
  const duplicate = f.controller.download(release);
  f.driver.download = async () => { attempts++; };
  finish(); await Promise.all([first, retry, duplicate]);
  assert.equal(f.controller.snapshot().status, 'ready');
  assert.equal(attempts, 2);
});
test('a new cancellation or channel change suppresses a queued retry', async () => {
  for (const changeChannel of [false, true]) {
    const f = fixture();
    let finish!: () => void;
    let attempts = 0;
    f.driver.download = () => { attempts++; return new Promise(resolve => { finish = resolve; }); };
    const first = f.controller.download(release); await Promise.resolve();
    f.controller.cancel();
    const retry = f.controller.download(release);
    if (changeChannel) f.controller.reconcile(undefined); else f.controller.cancel();
    finish(); await Promise.all([first, retry]);
    assert.equal(attempts, 1);
    assert.equal(f.controller.snapshot().status, 'cancelled');
  }
});
test('failed downloads expose only a bounded error category and can retry', async () => {
  const f = fixture();
  f.driver.download = async () => { throw new Error('secret private server data'); };
  await f.controller.download(release);
  assert.equal(f.controller.snapshot().error, 'download');
  assert.ok(!JSON.stringify(f.controller.snapshot()).includes('secret'));
  f.driver.download = async () => {};
  await f.controller.download(release);
  assert.equal(f.controller.snapshot().status, 'ready');
});
test('busy installation retains ready state and never invokes installer', async () => {
  const f = fixture();
  const pending = f.controller.download(release); await Promise.resolve(); f.finish(); await pending;
  await assert.rejects(f.controller.install(async () => { throw new InstallerFailure('busy'); }));
  assert.equal(f.controller.snapshot().status, 'ready');
  assert.equal(f.controller.snapshot().error, 'busy');
  assert.equal(f.counts().installs, 0);
  await f.controller.install(async () => {});
  assert.equal(f.counts().installs, 1);
});
test('integrity failure prevents shutdown preparation and installation', async () => {
  const f = fixture(); let prepared = false;
  const pending = f.controller.download(release); await Promise.resolve(); f.finish(); await pending;
  f.driver.verify = async () => { throw new InstallerFailure('integrity'); };
  await assert.rejects(f.controller.install(async () => { prepared = true; }));
  assert.equal(prepared, false);
  assert.equal(f.controller.snapshot().error, 'integrity');
  assert.equal(f.counts().installs, 0);
});
test('double install is rejected while verification is pending', async () => {
  const f = fixture();
  const pending = f.controller.download(release); await Promise.resolve(); f.finish(); await pending;
  let finish!: () => void;
  f.driver.verify = () => new Promise(resolve => { finish = resolve; });
  const installing = f.controller.install(async () => {});
  await assert.rejects(f.controller.install(async () => {}));
  finish(); await installing;
  assert.equal(f.counts().installs, 1);
});
test('cached installer must be inside the owned root and retain size and hash', async () => {
  const root = await mkdtemp(join(realpathSync(tmpdir()), 'step-update-integrity-'));
  const file = join(root, 'installer.exe');
  await writeFile(file, 'fixture');
  await verifyInstallerFile(file, root, 7, digest);
  await assert.rejects(verifyInstallerFile(file, root, 8, digest));
  await writeFile(file, 'changed');
  await assert.rejects(verifyInstallerFile(file, root, 7, digest));
  const child = join(root, 'cache'); await mkdir(child);
  await assert.rejects(verifyInstallerFile(file, child, 7, digest));
});
test('startup cleanup preserves failures and only deletes the owned download cache after upgrade', async () => {
  const root = await mkdtemp(join(realpathSync(tmpdir()), 'step-update-clean-'));
  const cache = join(root, 'download-cache'); await mkdir(cache);
  await writeFile(join(cache, 'installer.exe'), 'cached');
  await writeFile(join(root, 'sessions.json'), 'preserve');
  await writeFile(join(root, 'installed.json'), JSON.stringify({ version: '0.5.0' }));
  await cleanInstalledUpdate(root, '0.4.0');
  assert.equal(await readFile(join(cache, 'installer.exe'), 'utf8'), 'cached');
  await cleanInstalledUpdate(root, '0.5.0');
  await assert.rejects(readFile(join(cache, 'installer.exe')));
  assert.equal(await readFile(join(root, 'sessions.json'), 'utf8'), 'preserve');
});
test('cleanup does not traverse a cache junction', async () => {
  const root = await mkdtemp(join(realpathSync(tmpdir()), 'step-update-link-'));
  const outside = await mkdtemp(join(realpathSync(tmpdir()), 'step-update-outside-'));
  await writeFile(join(outside, 'keep.exe'), 'preserve');
  await symlink(outside, join(root, 'download-cache'), process.platform === 'win32' ? 'junction' : 'dir');
  await writeFile(join(root, 'installed.json'), JSON.stringify({ version: '0.5.0' }));
  await cleanInstalledUpdate(root, '0.5.0');
  assert.equal(await readFile(join(outside, 'keep.exe'), 'utf8'), 'preserve');
  await assert.rejects(prepareUpdateCache(root), InstallerFailure);
});
test('cache preparation rejects nested redirects before any download', async () => {
  const root = await mkdtemp(join(realpathSync(tmpdir()), 'step-update-preflight-'));
  const outside = await mkdtemp(join(realpathSync(tmpdir()), 'step-update-preflight-outside-'));
  await prepareUpdateCache(root);
  await symlink(outside, join(root, 'download-cache', 'pending'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(prepareUpdateCache(root), InstallerFailure);
});
test('Windows path casing does not prevent preparation or successful-upgrade cleanup', { skip: process.platform !== 'win32' }, async () => {
  const root = await mkdtemp(join(realpathSync(tmpdir()), 'step-update-case-'));
  const alias = root.toUpperCase();
  await prepareUpdateCache(alias);
  await writeFile(join(root, 'download-cache', 'installer.exe'), 'cached');
  await writeFile(join(root, 'installed.json'), JSON.stringify({ version: '0.5.0' }));
  await cleanInstalledUpdate(alias, '0.5.0');
  await assert.rejects(readFile(join(root, 'download-cache', 'installer.exe')));
});
test('cache preparation and cleanup reject a redirected parent directory', async () => {
  const parent = await mkdtemp(join(realpathSync(tmpdir()), 'step-update-parent-'));
  const outside = await mkdtemp(join(realpathSync(tmpdir()), 'step-update-parent-outside-'));
  await symlink(outside, join(parent, 'redirect'), process.platform === 'win32' ? 'junction' : 'dir');
  const root = join(parent, 'redirect', 'app-updates');
  await mkdir(join(outside, 'app-updates', 'download-cache'), { recursive: true });
  await writeFile(join(root, 'download-cache', 'keep.exe'), 'preserve');
  await writeFile(join(root, 'installed.json'), JSON.stringify({ version: '0.5.0' }));
  await assert.rejects(prepareUpdateCache(root), InstallerFailure);
  await assert.rejects(cleanInstalledUpdate(root, '0.5.0'), InstallerFailure);
  assert.equal(await readFile(join(root, 'download-cache', 'keep.exe'), 'utf8'), 'preserve');
});
