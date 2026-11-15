import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { watch } from 'node:fs';
import { lstat, mkdir, readFile, readdir, realpath, symlink, truncate, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { auditPluginRelease, validateReleaseManifest } from '../electron/plugin-release.mjs';
import { stagePluginRelease } from '../scripts/plugin-release.mjs';
import { mkdtemp, removeTestProfile } from '../scripts/test-profile.mjs';

async function fixture(action: (root: string) => Promise<void>) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'desktop-plugin-release-')));
  try { await action(root); }
  finally { await removeTestProfile(root); }
}

async function file(root: string, path: string, content = 'fixture') {
  const target = join(root, path);
  await mkdir(resolve(target, '..'), { recursive: true });
  await writeFile(target, content);
}

test('publication audit is read-only and accepts ordinary bundled resources and example settings', () => fixture(async root => {
  await file(root, 'dist/server.mjs', 'console.log("fixture")');
  await file(root, '.env.example', 'API_KEY=replace_me');
  await file(root, 'docs/README.md');
  const before = await readdir(root);
  const audit = await auditPluginRelease(root);
  assert.equal(audit.ok, true);
  assert.equal(audit.files, 3);
  assert.deepEqual(audit.issues, []);
  assert.deepEqual(await readdir(root), before);
  assert.equal(await readFile(join(root, '.env.example'), 'utf8'), 'API_KEY=replace_me');
}));

test('VCS, actual credentials, generated caches, and undeclared dependencies are rejected without payload reads',
  () => fixture(async root => {
    await file(root, '.git/config');
    await file(root, '.env', 'synthetic secret');
    await file(root, 'private.pem');
    await file(root, 'test-results/result.json');
    await file(root, 'node_modules/library/index.js');
    const result = await auditPluginRelease(root);
    assert.equal(result.ok, false);
    assert.deepEqual(new Set(result.issues.map(item => item.code)), new Set([
      'release-vcs', 'release-secret-file', 'release-development-artifact', 'release-runtime-dependency',
    ]));
    assert.ok(!JSON.stringify(result).includes('synthetic secret'));
    assert.equal(await readFile(join(root, '.env'), 'utf8'), 'synthetic secret');
  }));

test('necessary runtime dependencies require an explicit package-owned path and reason', () => fixture(async root => {
  await file(root, 'node_modules/native/index.js');
  await file(root, 'node_modules/native/node_modules/runtime/index.js');
  await file(root, 'dfsc.release.json', JSON.stringify({ schemaVersion: 1,
    runtimeDependencies: [{ path: 'node_modules', reason: 'Runtime native addon cannot be bundled.' }] }));
  const accepted = await auditPluginRelease(root);
  assert.equal(accepted.ok, true);
  assert.deepEqual(accepted.warnings, [{ code: 'release-runtime-dependency-approved', path: 'node_modules' }]);
  await file(root, 'node_modules/native/.env', 'fixture');
  const denied = await auditPluginRelease(root);
  assert.equal(denied.ok, false);
  assert.ok(denied.issues.some(item => item.code === 'release-secret-file'));
}));

test('unused dependency exceptions and malformed release manifests fail closed', () => fixture(async root => {
  await file(root, 'dfsc.release.json', JSON.stringify({ schemaVersion: 1,
    runtimeDependencies: [{ path: 'node_modules', reason: 'Unused exception' }] }));
  assert.equal((await auditPluginRelease(root)).issues[0].code, 'release-invalid-manifest');
  for (const value of [
    {}, { schemaVersion: 1, files: ['../outside'] }, { schemaVersion: 1, files: ['C:/outside'] },
    { schemaVersion: 1, files: ['dist/**'] }, { schemaVersion: 1, files: ['dist', 'dist'] },
    { schemaVersion: 1, files: [] }, { schemaVersion: 1, ignored: true },
    { schemaVersion: 1, runtimeDependencies: null },
    { schemaVersion: 1, runtimeDependencies: [{ path: 'node_modules', reason: '' }] },
    { schemaVersion: 1, runtimeDependencies: [{ path: 'vendor', reason: 'Not an exception target' }] },
  ]) assert.throws(() => validateReleaseManifest(value), /release-invalid-manifest/);
  await file(root, 'dfsc.release.json', '{broken');
  assert.equal((await auditPluginRelease(root)).issues[0].code, 'release-invalid-manifest');
}));

test('source code is permitted with a warning rather than requiring every MCP author to bundle', () => fixture(async root => {
  await file(root, 'src/server.py', 'print("fixture")');
  const result = await auditPluginRelease(root);
  assert.equal(result.ok, true);
  assert.deepEqual(result.warnings, [{ code: 'release-source-layout', path: 'src' }]);
}));

test('explicit whitelist staging excludes the development checkout and never changes it', () => fixture(async root => {
  const source = join(root, 'source'), output = join(root, 'release');
  await file(source, 'step.plugin.json', '{"id":"fixture"}');
  await file(source, 'dist/server.mjs');
  await file(source, 'docs/README.md');
  await file(source, '.git/config');
  await file(source, 'node_modules/development/index.js');
  await file(source, 'dfsc.release.json', JSON.stringify({ schemaVersion: 1,
    files: ['step.plugin.json', 'dist', 'docs'] }));
  const audit = await stagePluginRelease(source, output);
  assert.equal(audit.ok, true);
  assert.deepEqual((await readdir(output)).sort(), ['dfsc.release.json', 'dist', 'docs', 'step.plugin.json']);
  assert.ok((await lstat(join(source, 'node_modules'))).isDirectory());
  assert.ok((await lstat(join(source, '.git'))).isDirectory());
}));

test('staging refuses overlaps, existing outputs, missing files and ambiguous whitelist entries', () => fixture(async root => {
  const source = join(root, 'source'), output = join(root, 'release');
  await file(source, 'dist/server.mjs');
  await file(source, 'dfsc.release.json', JSON.stringify({ schemaVersion: 1, files: ['dist'] }));
  await assert.rejects(stagePluginRelease(source, join(source, 'release')), /release-overlapping-path/);
  await assert.rejects(stagePluginRelease(source, root), /release-overlapping-path/);
  await mkdir(output);
  await file(output, 'preserve.txt', 'existing');
  await assert.rejects(stagePluginRelease(source, output), { code: 'EEXIST' });
  assert.equal(await readFile(join(output, 'preserve.txt'), 'utf8'), 'existing');
  await file(source, 'dfsc.release.json', JSON.stringify({ schemaVersion: 1, files: ['missing'] }));
  await assert.rejects(stagePluginRelease(source, join(root, 'missing-output')), { code: 'ENOENT' });
  await assert.rejects(lstat(join(root, 'missing-output')), { code: 'ENOENT' });
  await file(source, 'dfsc.release.json', JSON.stringify({ schemaVersion: 1, files: ['dist', 'dist/server.mjs'] }));
  await assert.rejects(stagePluginRelease(source, join(root, 'overlap-output')), /release-overlapping-files/);
}));

test('staging does not publish a rejected candidate and only removes its own new output', () => fixture(async root => {
  const source = join(root, 'source'), output = join(root, 'release');
  await file(source, '.env', 'synthetic');
  await file(source, 'dfsc.release.json', JSON.stringify({ schemaVersion: 1, files: ['.env'] }));
  await assert.rejects(stagePluginRelease(source, output), /release-check-failed/);
  await assert.rejects(lstat(output), { code: 'ENOENT' });
  assert.equal(await readFile(join(source, '.env'), 'utf8'), 'synthetic');
}));

test('an aliased output parent is rejected before staging can write inside the source', () => fixture(async root => {
  const source = join(root, 'source'), alias = join(root, 'alias');
  await file(source, 'dist/server.mjs');
  try { await symlink(source, alias, process.platform === 'win32' ? 'junction' : 'dir'); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EPERM') return;
    throw error;
  }
  const changes: string[] = [], before = await lstat(source);
  const watcher = watch(source, (event, filename) => {
    if (event === 'rename') changes.push(String(filename));
  });
  try {
    await assert.rejects(stagePluginRelease(source, join(alias, 'release'), {
      manifest: { schemaVersion: 1, files: ['dist'] },
    }), /release-invalid-path/);
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.deepEqual(changes, []);
    assert.equal((await lstat(source)).mtimeMs, before.mtimeMs);
    assert.deepEqual(await readdir(source), ['dist']);
    await assert.rejects(lstat(join(source, 'release')), { code: 'ENOENT' });
  } finally { watcher.close(); }
}));

test('a canonical output parent permits exclusive staging without changing source contents', () => fixture(async root => {
  const source = join(root, 'source'), parent = join(root, 'releases'), output = join(parent, 'release');
  await file(source, 'dist/server.mjs', 'export default "fixture";');
  await mkdir(parent);
  assert.equal(await realpath(parent), parent);
  const report = await stagePluginRelease(source, output, {
    manifest: { schemaVersion: 1, files: ['dist'] },
  });
  assert.equal(report.ok, true);
  assert.equal(await realpath(output), output);
  assert.equal(await readFile(join(output, 'dist/server.mjs'), 'utf8'), 'export default "fixture";');
  assert.equal(await readFile(join(source, 'dist/server.mjs'), 'utf8'), 'export default "fixture";');
  assert.deepEqual(await readdir(source), ['dist']);
}));

test('an external release whitelist stages a read-only checkout without adding a manifest to it', () => fixture(async root => {
  const source = join(root, 'source'), output = join(root, 'release');
  await file(source, 'dist/server.mjs');
  await file(source, '.git/config');
  const result = await stagePluginRelease(source, output, {
    manifest: { schemaVersion: 1, files: ['dist'] },
  });
  assert.equal(result.ok, true);
  await assert.rejects(lstat(join(source, 'dfsc.release.json')), { code: 'ENOENT' });
  assert.equal(JSON.parse(await readFile(join(output, 'dfsc.release.json'), 'utf8')).schemaVersion, 1);
}));

test('links cannot admit content from outside the selected source or the published package', () => fixture(async root => {
  const source = join(root, 'source'), outside = join(root, 'outside');
  await file(outside, 'server.mjs');
  await mkdir(source);
  try { await symlink(outside, join(source, 'linked'), process.platform === 'win32' ? 'junction' : 'dir'); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EPERM') return;
    throw error;
  }
  await file(source, 'dfsc.release.json', JSON.stringify({ schemaVersion: 1, files: ['linked/server.mjs'] }));
  assert.ok((await auditPluginRelease(source)).issues.some(item => item.code === 'release-invalid-path'));
  await assert.rejects(stagePluginRelease(source, join(root, 'release')), /release-invalid-path/);
}));

test('audit enforces the existing package byte budget without reading large contents', () => fixture(async root => {
  await file(root, 'oversized.bin', '');
  await truncate(join(root, 'oversized.bin'), 128 * 1024 * 1024 + 1);
  assert.equal((await auditPluginRelease(root)).issues[0].code, 'release-too-large');
}));

test('audit refuses nonexistent roots and unsafe dependency exceptions', () => fixture(async root => {
  assert.equal((await auditPluginRelease(join(root, 'missing'))).issues[0].code, 'release-invalid-path');
  await file(root, 'node_modules/library/index.js');
  const result = await auditPluginRelease(root, {
    allowRuntimeDependencies: [{ path: '../node_modules', reason: 'Not within the package' }],
  });
  assert.equal(result.ok, false);
  assert.equal(result.issues[0].code, 'release-invalid-manifest');
}));

test('CLI check returns a nonzero exit and structured path-only diagnostics for rejected input', () => fixture(async root => {
  await file(root, '.env', 'do-not-log-this');
  const result = spawnSync(process.execPath, ['scripts/plugin-release.mjs', 'check', root], {
    cwd: resolve(import.meta.dirname, '..'), encoding: 'utf8', windowsHide: true, timeout: 15000,
  });
  assert.equal(result.status, 1, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.ok, false);
  assert.equal(report.issues[0].code, 'release-secret-file');
  assert.ok(!`${result.stdout}${result.stderr}`.includes('do-not-log-this'));
}));

test('CLI does not echo malformed manifest contents in parse errors', () => fixture(async root => {
  const source = join(root, 'source'), manifest = join(root, 'manifest.json');
  await mkdir(source);
  await writeFile(manifest, 'do-not-log-this-invalid-json');
  const result = spawnSync(process.execPath, ['scripts/plugin-release.mjs', 'stage', source,
    join(root, 'release'), '--manifest', manifest], {
    cwd: resolve(import.meta.dirname, '..'), encoding: 'utf8', windowsHide: true, timeout: 15000,
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /release-invalid-manifest/);
  assert.ok(!`${result.stdout}${result.stderr}`.includes('do-not-log-this'));
  await assert.rejects(lstat(join(root, 'release')), { code: 'ENOENT' });
}));
