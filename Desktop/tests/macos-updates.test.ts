import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, realpath, lstat, rm, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { crc32 } from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { selectRelease, createUpdateManifest, parseUpdateManifest, AppUpdates, RELEASES_URL } from '../electron/app-updates';
import { MacUpdateDriver, macUpdateUrlAllowed, acknowledgeMacUpdate } from '../electron/macos-update-driver';
import { extractMacUpdate, archivePath } from '../electron/macos-update-archive';
import { runMacInstall, validateInstallPlan } from '../electron/macos-update-helper';

function catalog(version: string, mac = true) {
  const name = mac ? `Desktop.for.Step.Code.${version}.arm64.zip` : `Desktop.for.Step.Code.Setup.${version}.exe`;
  return { tag_name: `v${version}`, draft: false, prerelease: mac, assets: [
    { name, size: 100, state: 'uploaded', browser_download_url: `${RELEASES_URL}/download/v${version}/${name}` },
    { name: mac ? 'mac-update.json' : 'latest.yml', size: 100, state: 'uploaded', browser_download_url: `${RELEASES_URL}/download/v${version}/${mac ? 'mac-update.json' : 'latest.yml'}` },
  ] };
}
const temporary = async () => realpath(await mkdtemp(join(tmpdir(), 'dfsc-mac-update-test-')));
function zip(entries: { name: string; data: string; mode?: number }[]) {
  const local: Buffer[] = []; const central: Buffer[] = []; let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name); const data = Buffer.from(entry.data); const crc = crc32(data);
    const header = Buffer.alloc(30); header.writeUInt32LE(0x04034b50); header.writeUInt16LE(20, 4); header.writeUInt32LE(crc, 14); header.writeUInt32LE(data.length, 18); header.writeUInt32LE(data.length, 22); header.writeUInt16LE(name.length, 26);
    const index = Buffer.alloc(46); index.writeUInt32LE(0x02014b50); index.writeUInt16LE(0x0314, 4); index.writeUInt16LE(20, 6); index.writeUInt32LE(crc, 16); index.writeUInt32LE(data.length, 20); index.writeUInt32LE(data.length, 24); index.writeUInt16LE(name.length, 28); index.writeUInt32LE(((entry.mode ?? 0o100644) << 16) >>> 0, 38); index.writeUInt32LE(offset, 42);
    local.push(header, name, data); central.push(index, name); offset += header.length + name.length + data.length;
  }
  const directory = Buffer.concat(central); const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, directory, end]);
}

test('platform catalogs separate macOS previews, Windows releases and repeated preview revisions', async () => {
  const values = [catalog('0.5.1', false), catalog('0.5.1-macos.1'), catalog('0.5.1-macos.2')];
  const manifest = createUpdateManifest(values);
  assert.equal(selectRelease(values, 'preview')?.version, '0.5.1');
  assert.equal(parseUpdateManifest(manifest, 'preview', 'darwin')?.version, '0.5.1-macos.2');
  assert.equal(parseUpdateManifest(manifest, 'stable', 'darwin'), undefined);
  assert.equal(parseUpdateManifest(manifest, 'preview')?.version, '0.5.1');
  assert.equal(parseUpdateManifest({ ...manifest, platforms: undefined }, 'preview', 'darwin'), undefined);
  const updates = new AppUpdates('0.5.1-macos.1', async () => new Response(JSON.stringify(manifest)), () => {}, Date.now, 1000, 'darwin');
  assert.equal((await updates.check()).updateAvailable, true);
  assert.equal(updates.snapshot().release?.installer?.inApp, true);
  const missing = { ...catalog('0.6.0-macos.1'), assets: [] };
  assert.equal(selectRelease([missing, ...values], 'preview', 'darwin')?.installer, undefined);
  const malformed = structuredClone(manifest); malformed.platforms.darwin.preview!.installer!.url = 'https://evil.example/update.zip';
  assert.throws(() => parseUpdateManifest(malformed, 'preview', 'darwin'));
});

test('macOS download transport validates origins, metadata, lengths, hashes and cancellation', async () => {
  const root = await temporary();
  try {
    const release = selectRelease([catalog('0.6.0-macos.1')], 'preview', 'darwin')!;
    const bytes = Buffer.alloc(100, 7); let mode = 'ok'; const calls: string[] = [];
    const driver = new MacUpdateDriver(root, { resources: root, target: join(root, 'Desktop for Step Code.app'), quit() {},
      request: async (url, options) => {
        calls.push(url); assert.equal(options.credentials, 'omit'); assert.equal(options.redirect, 'manual'); assert.equal(options.headers, undefined);
        if (mode === 'redirect') return new Response('', { status: 302, headers: { location: 'https://evil.example/update.zip' } });
        if (url.endsWith('mac-update.json')) return new Response(JSON.stringify({ version: release.version, arch: 'arm64', bundleIdentifier: 'community.stepcode.desktop', files: [{ url: release.installer!.name, size: mode === 'metadata' ? 99 : 100, sha512: createHash('sha512').update(bytes).digest('base64') }] }));
        if (mode === 'cancel') throw options.signal!.reason;
        return new Response(mode === 'corrupt' ? Buffer.alloc(100) : bytes, { headers: { 'content-length': mode === 'length' ? '99' : '100' } });
      } });
    const abort = new AbortController(); let progress = 0;
    await driver.download(release, abort.signal, value => { progress = value.percent!; }); await driver.verify(); assert.equal(progress, 100);
    for (mode of ['metadata', 'length', 'corrupt', 'redirect']) await assert.rejects(driver.download(release, abort.signal, () => {}));
    mode = 'cancel'; const cancelled = new AbortController(); cancelled.abort();
    await assert.rejects(driver.download(release, cancelled.signal, () => {}));
    assert.ok(calls.every(url => url.startsWith(`${RELEASES_URL}/download/`)));
    assert.equal(macUpdateUrlAllowed('https://release-assets.githubusercontent.com/x?sig=y', release.installer!.url), true);
    assert.equal(macUpdateUrlAllowed('https://evil.example/update.zip', 'https://evil.example/update.zip'), false);
    for (const url of ['http://github.com/a', 'https://github.com.evil/a', 'https://u@objects.githubusercontent.com/a', 'https://objects.githubusercontent.com:8443/a']) assert.equal(macUpdateUrlAllowed(url, release.installer!.url), false);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('ZIP extraction rejects traversal, foreign roots and symlink escape, preserving safe framework links', { skip: process.platform === 'win32' }, async () => {
  const root = await temporary();
  try {
    for (const path of ['../outside', '/outside', 'Desktop for Step Code.app/../../outside', 'Other.app/x', 'Desktop for Step Code.app/./x', 'Desktop for Step Code.app/a\\b']) assert.throws(() => archivePath(path));
    let count = 0;
    const extract = async (entries: Parameters<typeof zip>[0]) => { const file = join(root, `${count++}.zip`); await writeFile(file, zip(entries)); return extractMacUpdate(file, join(root, `out-${count}`), new AbortController().signal); };
    const app = await extract([{ name: 'Desktop for Step Code.app/Contents/Versions/A/file', data: 'safe', mode: 0o100755 }, { name: 'Desktop for Step Code.app/Contents/Versions/Current', data: 'A', mode: 0o120777 }]);
    assert.equal(await readFile(join(app, 'Contents/Versions/Current/file'), 'utf8'), 'safe');
    assert.ok((await lstat(join(app, 'Contents/Versions/A/file'))).mode & 0o111);
    await assert.rejects(extract([{ name: 'Desktop for Step Code.app/link', data: '../../outside', mode: 0o120777 }]));
    await assert.rejects(extract([{ name: 'Desktop for Step Code.app/link', data: '/tmp', mode: 0o120777 }]));
    await assert.rejects(extract([{ name: 'Desktop for Step Code.app/FILE', data: '1' }, { name: 'Desktop for Step Code.app/file', data: '2' }]));
    await assert.rejects(extract([{ name: 'Desktop for Step Code.app/link', data: 'Contents', mode: 0o120777 }, { name: 'Desktop for Step Code.app/link/escape', data: 'x' }]));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('confirmed install keeps old bundle until acknowledgement and rolls back failed startup', { skip: process.platform === 'win32' }, async () => {
  const folder = await temporary(); const token = randomUUID();
  const target = join(folder, 'Desktop for Step Code.app'); const staged = join(folder, `.dfsc-next-${token}.app`); const backup = join(folder, `.dfsc-backup-${token}.app`);
  const setup = async () => { await mkdir(target); await writeFile(join(target, 'version'), 'old'); await mkdir(staged); await writeFile(join(staged, 'version'), 'new'); };
  try {
    await setup();
    const plan = { folder, token, target, staged, backup, version: '0.6.0-macos.1', pid: 999999, targetInode: (await lstat(target)).ino };
    assert.throws(() => validateInstallPlan({ ...plan, backup: '/tmp/foreign' }));
    await runMacInstall(plan, async () => { assert.equal(await readFile(join(target, 'version'), 'utf8'), 'new'); assert.equal(await readFile(join(backup, 'version'), 'utf8'), 'old'); await writeFile(join(folder, 'ack'), token); }, () => false, 100);
    assert.equal(await readFile(join(target, 'version'), 'utf8'), 'new'); await assert.rejects(lstat(backup));
    await rm(target, { recursive: true }); await rm(join(folder, 'ack')); await setup(); plan.targetInode = (await lstat(target)).ino;
    await runMacInstall(plan, async path => { if (await readFile(join(path, 'version'), 'utf8') === 'new') throw new Error('Launch blocked'); }, () => false, 100);
    assert.equal(await readFile(join(target, 'version'), 'utf8'), 'old'); assert.equal(JSON.parse(await readFile(join(folder, 'result.json'), 'utf8')).status, 'rolled-back');
  } finally { await rm(folder, { recursive: true, force: true }); }
});

test('native macOS associated application helper uses LaunchServices with bounded JSON', { skip: process.platform !== 'darwin' }, async () => {
  assert.match(execFileSync('/usr/bin/otool', ['-l', 'dist/file-opening/file-applications-macos'], { encoding: 'utf8' }), /minos 13\.5/);
  const root = await temporary();
  const file = join(root, 'example.txt'); await writeFile(file, 'fixture');
  const result = JSON.parse(execFileSync('dist/file-opening/file-applications-macos', { input: JSON.stringify({ action: 'list', path: file }), encoding: 'utf8' }));
  assert.ok(Array.isArray(result)); assert.ok(result.some(item => item.id.endsWith('/TextEdit.app')));
  assert.ok(result.every(item => item.id.startsWith('/') && item.id.endsWith('.app')));
  for (const item of result.filter(item => item.icon)) {
    const png = Buffer.from(item.icon.split(',')[1], 'base64');
    assert.equal(png.readUInt32BE(16), 24); assert.equal(png.readUInt32BE(20), 24);
  }
  assert.throws(() => execFileSync('dist/file-opening/file-applications-macos', { input: '{"action":"execute"}', stdio: ['pipe', 'pipe', 'pipe'] }));
  await rm(root, { recursive: true, force: true });
});


test('startup acknowledgement is release-bound and waits for helper completion before cleanup', { skip: process.platform === 'win32' }, async () => {
  const root = await temporary(); const token = randomUUID(); const target = join(root, 'Desktop for Step Code.app');
  const folder = join(root, 'mac-install-fixture');
  try {
    await mkdir(target); await mkdir(folder);
    await writeFile(join(root, 'mac-pending.json'), JSON.stringify({ folder, target, token, version: '0.6.0-macos.1' }));
    assert.equal(await acknowledgeMacUpdate(root, target, '0.5.1-macos.1'), undefined);
    await assert.rejects(lstat(join(folder, 'ack')));
    assert.equal(await acknowledgeMacUpdate(root, target, '0.6.0-macos.1'), 'installed');
    assert.equal(await readFile(join(folder, 'ack'), 'utf8'), token);
    await new Promise(done => setTimeout(done, 1100)); assert.ok(await lstat(folder));
    await writeFile(join(folder, 'finished'), token);
    const deadline = Date.now() + 3000;
    while (Date.now() < deadline) {
      try { await lstat(folder); } catch { break; }
      await new Promise(done => setTimeout(done, 100));
    }
    await assert.rejects(lstat(folder)); await assert.rejects(lstat(join(root, 'mac-pending.json')));
  } finally { await rm(root, { recursive: true, force: true }); }
});
