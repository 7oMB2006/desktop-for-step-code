import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { test } from 'node:test';
import { canvasPrebuild, downloadReleaseAsset, preparePrebuild } from './ci-canvas-prebuild.mjs';

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'ci-canvas-prebuild-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const bytes = Buffer.from('controlled native-prebuild fixture');
  const asset = {
    filename: 'canvas-fixture.tar.gz',
    url: 'https://github.com/Automattic/node-canvas/releases/download/v3.2.3/canvas-fixture.tar.gz',
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
  return { directory, bytes, asset, destination: join(directory, asset.filename) };
}

test('CI selects the official pinned canvas release and native architecture', () => {
  for (const [platform, arch, sha256] of [
    ['win32', 'x64', 'ba953cc8c38303ab94cc83461c7561506a5a3af37d6c678de4a47914d2d0bb48'],
    ['darwin', 'arm64', '38c296c9d81c05598db849fb8103543d6649fec7246c35197d9be8199c75116f'],
  ]) {
    const asset = canvasPrebuild(platform, arch);
    assert.equal(asset.filename, `canvas-v3.2.3-napi-v7-${platform}-${arch}.tar.gz`);
    assert.equal(asset.url, `https://github.com/Automattic/node-canvas/releases/download/v3.2.3/${asset.filename}`);
    assert.equal(asset.sha256, sha256);
  }
  for (const [platform, arch] of [['win32', 'arm64'], ['darwin', 'x64'], ['linux', 'x64']]) {
    assert.throws(() => canvasPrebuild(platform, arch), /Unsupported canvas CI platform/);
  }
});

test('downloads retain HTTPS, finite deadlines, retries and visible failures', () => {
  let call;
  downloadReleaseAsset('https://github.com/fixture', 'fixture.download', (...args) => { call = args; });
  assert.equal(call[0], 'curl');
  for (const flag of ['--fail', '--location', '--show-error', '--retry-all-errors']) assert.ok(call[1].includes(flag));
  for (const [flag, value] of [
    ['--proto', '=https'], ['--proto-redir', '=https'], ['--connect-timeout', '15'],
    ['--max-time', '120'], ['--retry', '2'], ['--retry-max-time', '240'],
    ['--output', 'fixture.download'],
  ]) assert.equal(call[1][call[1].indexOf(flag) + 1], value);
  assert.equal(call[1].at(-1), 'https://github.com/fixture');
  assert.equal(call[2].timeout, 360000);
  assert.equal(call[2].windowsHide, true);
  assert.deepEqual(call[2].stdio, ['ignore', 'inherit', 'inherit']);
  const failure = new Error('HTTP 504');
  assert.throws(() => downloadReleaseAsset('https://github.com/fixture', 'fixture.download', () => { throw failure; }),
    error => error === failure);
});

test('a complete verified prebuild is published under its unchanged installer filename', t => {
  const { directory, bytes, asset, destination } = fixture(t);
  const result = preparePrebuild(directory, asset, (url, pending) => {
    assert.equal(url, asset.url);
    assert.equal(existsSync(destination), false);
    writeFileSync(pending, bytes);
  });
  assert.equal(result, destination);
  assert.deepEqual(readFileSync(destination), bytes);
  assert.deepEqual(readdirSync(directory), [asset.filename]);
});

test('an existing prebuild is reused only after verifying its checksum', t => {
  const { directory, bytes, asset, destination } = fixture(t);
  writeFileSync(destination, bytes);
  assert.equal(preparePrebuild(directory, asset, () => assert.fail('must not download')), destination);
  writeFileSync(destination, 'corrupted cache');
  assert.throws(() => preparePrebuild(directory, asset, () => assert.fail('must not download')), /SHA-256 mismatch/);
  assert.equal(readFileSync(destination, 'utf8'), 'corrupted cache');
});

test('a failed or corrupt download never becomes an installable prebuild', t => {
  const { directory, asset, destination } = fixture(t);
  for (const download of [
    (_url, pending) => { writeFileSync(pending, 'partial'); throw new Error('HTTP 504'); },
    (_url, pending) => { writeFileSync(pending, 'incorrect archive'); },
  ]) {
    assert.throws(() => preparePrebuild(directory, asset, download), /HTTP 504|SHA-256 mismatch/);
    assert.equal(existsSync(destination), false);
    assert.deepEqual(readdirSync(directory), []);
  }
});

test('both CI platforms prepare the prebuild before unmodified frozen-lockfile installation', () => {
  const windows = readFileSync(new URL('../.github/workflows/windows-integration.yml', import.meta.url), 'utf8');
  const mac = readFileSync(new URL('../.github/actions/setup-macos/action.yml', import.meta.url), 'utf8');
  for (const source of [windows, mac]) {
    assert.match(source, /npm_config_canvas_local_prebuilds: \$\{\{ runner\.temp \}\}\/dfsc-canvas-prebuilds/);
    assert.match(source, /node scripts\/ci-canvas-prebuild\.mjs/);
    assert.ok(source.indexOf('node scripts/ci-canvas-prebuild.mjs') < source.indexOf('corepack pnpm install --frozen-lockfile'));
    assert.doesNotMatch(source, /--ignore-scripts|continue-on-error|canvas_binary_host|canvas_binary_host_mirror/);
    assert.match(source, /node node_modules\/electron\/install\.js/);
  }
  const workflow = readFileSync(new URL('../.github/workflows/macos-integration.yml', import.meta.url), 'utf8');
  const policy = readFileSync(new URL('../.github/workflows/pr-ci.yml', import.meta.url), 'utf8');
  assert.match(workflow, /'scripts\/ci-canvas-prebuild\*'/);
  assert.match(workflow, /node --test .*ci-canvas-prebuild\.test\.mjs/);
  assert.match(policy, /node --test .*ci-canvas-prebuild\.test\.mjs/);
});
