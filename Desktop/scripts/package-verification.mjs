import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, lstat, mkdir, readFile, readdir, realpath, symlink, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defaultRuntimeBaseline, readRuntimeBaseline } from './runtime-baseline.mjs';

const desktop = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repository = dirname(desktop);
const requested = process.argv[2];
assert.equal(process.platform, 'win32', 'This verification package currently targets Windows');
assert.ok(requested && isAbsolute(requested), 'Pass a new absolute package output directory');
const output = resolve(requested);
const contains = (parent, child) => {
  const path = relative(parent, child);
  return !path || !path.startsWith('..') && !isAbsolute(path);
};
assert.ok(!contains(repository, output) && !contains(output, repository), 'Output must be outside the source checkout');
assert.equal(await realpath(dirname(output)), dirname(output), 'Output parent must be canonical and already exist');
const json = async path => JSON.parse(await readFile(path, 'utf8'));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const { name: baseline, manifest: pin } = await readRuntimeBaseline();
const requestedRuntime = process.env.DESKTOP_VERIFY_RUNTIME;
if (baseline !== defaultRuntimeBaseline) assert.ok(requestedRuntime, 'Pass DESKTOP_VERIFY_RUNTIME for the non-default staged runtime');
if (requestedRuntime) assert.ok(isAbsolute(requestedRuntime), 'Pass an absolute DESKTOP_VERIFY_RUNTIME directory');
const runtime = await realpath(requestedRuntime ?? join(desktop, 'runtime'));
const terminalRuntime = await realpath(join(desktop, 'terminal-runtime'));
const electronDist = await realpath(join(desktop, 'node_modules/electron/dist'));
for (const input of [runtime, terminalRuntime, electronDist])
  assert.ok(!contains(input, output) && !contains(output, input), 'Output must not overlap shared package inputs');
const manifest = await json(join(runtime, 'manifest.json'));
assert.equal(manifest.commit, pin.commit);
assert.deepEqual(manifest.patchedSourceHashes, { ...pin.patchedSources, ...pin.platforms?.win32?.patchedSources });
if (pin.patchIds) assert.deepEqual(manifest.patches, [...pin.patchIds, ...(pin.platforms?.win32?.patchIds ?? [])]);
assert.equal(manifest.platform, 'win32');
assert.equal(manifest.arch, 'x64');
assert.equal(hash(await readFile(join(runtime, 'node/node.exe'))), manifest.nodeSha256);
const helpers = {};
const copiedHelpers = ['admin.mjs', 'windows-runtime-job.ps1', 'capability-admin.mjs', 'capability-failure.mjs',
  'marketplace-refresh.mjs', 'capability-settings.mjs', 'plugin-files.mjs', 'plugin-read-scope.mjs', 'plugin-release.mjs',
  'theme-composition.mjs', 'plugin-update.mjs', 'plugin-schema-update.mjs', 'plugin-configuration.mjs',
  'session-import.mjs', 'session-history.mjs', 'session-search.mjs', 'steppage-config.mjs', 'usage-overview.mjs',
  'desktop-sessions.mjs', 'desktop-remote.mjs', 'desktop-web-search.mjs', 'native-step-search.mjs',
  'runtime-compile-cache.mjs', 'remote-channel.mjs',
  'remote-channel-core.mjs', 'remote-media-channel.mjs', 'remote-card.mjs', 'remote-form.mjs'];
for (const name of copiedHelpers) {
  const bytes = await readFile(join(runtime, name));
  assert.equal(hash(bytes), hash(await readFile(join(desktop, 'electron', name))),
    `Runtime helper must match this checkout: ${name}`);
  helpers[name] = hash(bytes);
}
for (const name of ['compaction-configuration.mjs', 'project-instructions.mjs', 'remote-markdown.mjs',
  'session-reading-worker.mjs']) {
  const bytes = await readFile(join(runtime, name));
  assert.ok(bytes.length > 0, `Missing bundled runtime helper: ${name}`);
  helpers[name] = hash(bytes);
}

await mkdir(output);
const stage = join(output, 'build-app');
await mkdir(stage);
for (const name of ['dist', 'build', 'scripts'])
  await cp(join(desktop, name), join(stage, name), { recursive: true, errorOnExist: true, force: false });
for (const [name, source] of [['runtime', runtime], ['terminal-runtime', terminalRuntime]])
  await symlink(source, join(stage, name), 'junction');
const sourcePackage = await json(join(desktop, 'package.json'));
const { dependencies, devDependencies, pnpm, packageManager, scripts, build: config, ...metadata } = sourcePackage;
await writeFile(join(stage, 'package.json'), JSON.stringify(metadata, null, 2) + '\n');

async function inventory(directory, prefix = '') {
  const result = {};
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name), key = prefix ? `${prefix}/${entry.name}` : entry.name;
    assert.equal((await lstat(path)).isSymbolicLink(), false, `Unexpected linked artifact: ${key}`);
    if (entry.isDirectory()) Object.assign(result, await inventory(path, key));
    else if (entry.isFile()) result[key] = hash(await readFile(path));
  }
  return result;
}
const built = await inventory(join(stage, 'dist'));
const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z', 'Desktop'],
  { cwd: repository, encoding: 'utf8' }).split('\0').filter(Boolean);
const sourceHashes = {};
for (const path of [...new Set(files)]) sourceHashes[path] = hash(await readFile(join(repository, path)));
const receipt = {
  kind: 'local-unpublished-unsigned-verification', builtAt: new Date().toISOString(),
  desktopBase: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repository, encoding: 'utf8' }).trim(),
  includesUncommittedChanges: true, runtime: manifest, desktopRuntimeHelpers: helpers,
  sourceHashes, distHashes: built,
  scope: 'Pinned staged runtime with current Desktop helpers. No real-account acceptance.',
};
await writeFile(join(output, 'source-receipt.json'), JSON.stringify(receipt, null, 2) + '\n');
const require = createRequire(join(desktop, 'package.json'));
const { build, Platform, Arch } = require('electron-builder');
const packageOutput = join(output, 'package');
await build({ projectDir: stage, targets: Platform.WINDOWS.createTarget('nsis', Arch.x64), publish: 'never',
  config: { ...config, npmRebuild: false, electronVersion: devDependencies.electron,
    electronDist, directories: { output: packageOutput } } });
const resources = join(packageOutput, 'win-unpacked/resources');
const { extractFile } = require('@electron/asar');
for (const [key, expected] of Object.entries(built)) {
  const resource = config.extraResources.find(item =>
    `dist/${key}` === item.from || `dist/${key}`.startsWith(`${item.from}/`));
  const bytes = resource
    ? await readFile(join(resources, resource.to, relative(resource.from, `dist/${key}`)))
    : extractFile(join(resources, 'app.asar'), join('dist', ...key.split('/')));
  assert.equal(hash(bytes), expected, `Packaged Desktop artifact: ${key}`);
}
for (const [name, expected] of Object.entries(helpers))
  assert.equal(hash(await readFile(join(resources, 'runtime', name))), expected, `Packaged helper: ${name}`);
assert.deepEqual(await json(join(resources, 'runtime/manifest.json')), manifest);
assert.equal(hash(await readFile(join(resources, 'runtime/node/node.exe'))), manifest.nodeSha256);
assert.equal(hash(await readFile(join(resources, 'runtime', manifest.entry))), hash(await readFile(join(runtime, manifest.entry))));
const installer = `Desktop.for.Step.Code.Setup.${metadata.version}.exe`;
const sha256 = hash(await readFile(join(packageOutput, installer)));
await writeFile(join(output, 'package-integrity.json'), JSON.stringify({
  installer, sha256, desktopFiles: Object.keys(built).length, helpers: Object.keys(helpers).length,
  runtimePin: manifest.commit, scope: 'File integrity only; application behavior is verified separately.',
}, null, 2) + '\n');
await writeFile(join(output, 'SHA256SUMS.txt'), `${sha256}  package/${installer}\n`);
console.log(JSON.stringify({ output, installer, sha256 }));
