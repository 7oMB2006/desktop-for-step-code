import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, readdir, realpath, symlink, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const source = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const options = {};
for (let index = 2; index < process.argv.length; index += 2) {
  const key = process.argv[index], value = process.argv[index + 1];
  assert.ok(['--build-root', '--output', '--bvr', '--step-source'].includes(key) && !options[key] && isAbsolute(value ?? ''),
    'Use --build-root <new directory> --output <new directory> --bvr <BVR checkout> [--step-source <patched checkout>]');
  options[key] = resolve(value);
}
assert.ok(options['--build-root'] && options['--output'] && options['--bvr']);
assert.equal(process.platform, 'win32');
const root = options['--build-root'], output = options['--output'], bvr = options['--bvr'];
const stepSource = options['--step-source'];
assert.equal(new Set([root, output, source, bvr]).size, 4);
const contains = (parent, child) => {
  const path = relative(parent, child);
  return !path || !path.startsWith('..') && !isAbsolute(path);
};
assert.ok(!contains(root, output) && !contains(output, root));
for (const target of [root, output]) {
  for (const protectedRoot of [source, bvr, ...(stepSource ? [stepSource] : [])]) {
    assert.ok(!contains(target, protectedRoot) && !contains(protectedRoot, target));
  }
}
const json = async path => JSON.parse(await readFile(path, 'utf8'));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' });
const pin = await json(join(source, 'patches/v017/manifest.json'));
const sharedRuntime = await realpath(join(source, 'Desktop/runtime'));
const sharedManifest = await json(join(sharedRuntime, 'manifest.json'));
const patchedSources = { ...pin.patchedSources, ...pin.platforms?.win32?.patchedSources };
assert.equal(sharedManifest.commit, pin.commit);
assert.equal(sharedManifest.platform, 'win32');
assert.equal(sharedManifest.arch, 'x64');
assert.deepEqual(sharedManifest.upstreamCommits, pin.upstream.commits.map(item => item.sha));
assert.equal(hash(await readFile(join(sharedRuntime, 'node/node.exe'))), sharedManifest.nodeSha256);
if (stepSource) {
  assert.equal(git(stepSource, 'rev-parse', 'HEAD').trim(), pin.commit);
  for (const [file, expected] of Object.entries(patchedSources))
    assert.equal(git(stepSource, 'hash-object', file).trim(), expected, file);
} else assert.deepEqual(sharedManifest.patchedSourceHashes, patchedSources);
assert.equal((await json(join(bvr, 'package.json'))).dfscConfigurationVersion, 1);

await mkdir(root, { recursive: false });
await mkdir(output, { recursive: false });
const desktop = join(root, 'Desktop');
const files = git(source, 'ls-files', '--cached', '--others', '--exclude-standard', '-z', 'Desktop')
  .split('\0').filter(Boolean);
const sourceHashes = {};
for (const file of [...new Set(files)]) {
  const bytes = await readFile(join(source, file));
  await mkdir(dirname(join(root, file)), { recursive: true });
  await writeFile(join(root, file), bytes);
  sourceHashes[file] = hash(bytes);
}
await cp(join(source, 'LICENSE'), join(root, 'LICENSE'));
await mkdir(join(root, 'patches/v017'), { recursive: true });
await cp(join(source, 'patches/v017/manifest.json'), join(root, 'patches/v017/manifest.json'));
await symlink(await realpath(join(source, 'Desktop/node_modules')), join(desktop, 'node_modules'), 'junction');
// Never build or restage into the shared runtime junction.
await cp(sharedRuntime, join(desktop, 'runtime'), { recursive: true, dereference: true });
assert.equal(await realpath(join(desktop, 'runtime')), join(desktop, 'runtime'));
if (stepSource) execFileSync(process.execPath, ['scripts/stage-runtime.mjs', stepSource],
  { cwd: desktop, stdio: 'inherit' });
const runtimeManifest = await json(join(desktop, 'runtime/manifest.json'));
assert.equal(runtimeManifest.commit, pin.commit);
assert.deepEqual(runtimeManifest.patchedSourceHashes, patchedSources);
assert.equal(hash(await readFile(join(desktop, 'runtime/node/node.exe'))), runtimeManifest.nodeSha256);
const helpers = {};
for (const name of new Set([...(await readdir(sharedRuntime)), 'plugin-files.mjs', 'marketplace-refresh.mjs'])) {
  if (!name.endsWith('.mjs')) continue;
  const bytes = await readFile(join(source, 'Desktop/electron', name));
  await writeFile(join(desktop, 'runtime', name), bytes);
  helpers[name] = hash(bytes);
}
const bvrRuntime = join(output, 'bvr-runtime');
await mkdir(bvrRuntime);
for (const name of ['package.json', 'package-lock.json', 'tsconfig.json', 'LICENSE', 'README.md', 'README.zh-CN.md', 'src'])
  await cp(join(bvr, name), join(bvrRuntime, name), { recursive: true });
await symlink(await realpath(join(bvr, 'node_modules')), join(bvrRuntime, 'node_modules'), 'junction');
const market = join(output, 'bvr-local-preview');
await mkdir(join(market, '.step-plugin'), { recursive: true });
await cp(join(bvr, 'plugins/bilibili-video-research'), join(market, 'plugins/bilibili-video-research'), { recursive: true });
await writeFile(join(market, '.step-plugin/marketplace.json'), JSON.stringify({
  name: 'bvr-local-preview',
  plugins: [{ name: 'bilibili-video-research', source: './plugins/bilibili-video-research',
    description: 'Local BVR companion resource. Requires the matching DFSC host and separately prepared runtime.' }],
}, null, 2) + '\n');
async function inventory(directory, prefix = '') {
  const result = {};
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue;
    const key = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) Object.assign(result, await inventory(join(directory, entry.name), key));
    else result[key] = hash(await readFile(join(directory, entry.name)));
  }
  return result;
}
const receipt = {
  kind: 'local-unpublished-unsigned-preview', builtAt: new Date().toISOString(),
  desktopBase: git(source, 'rev-parse', 'HEAD').trim(), bvrBase: git(bvr, 'rev-parse', 'HEAD').trim(),
  includesUncommittedFeatureChanges: true, runtime: runtimeManifest, desktopRuntimeHelpers: helpers,
  localBvrRuntimeIsNotPortable: true, sourceHashes,
  bvrHashes: await inventory(bvrRuntime), pluginHashes: await inventory(market),
};
await writeFile(join(output, 'source-receipt.json'), JSON.stringify(receipt, null, 2) + '\n');
execFileSync(process.execPath, ['scripts/build.mjs'], { cwd: desktop, stdio: 'inherit' });

const stage = join(root, 'package-app');
await mkdir(stage);
for (const name of ['dist', 'build', 'scripts'])
  await cp(join(desktop, name), join(stage, name), { recursive: true });
for (const name of ['runtime', 'terminal-runtime'])
  await symlink(await realpath(join(desktop, name)), join(stage, name), 'junction');
const manifest = await json(join(desktop, 'package.json'));
const { dependencies, devDependencies, pnpm, packageManager, scripts, build: config, ...metadata } = manifest;
await writeFile(join(stage, 'package.json'), JSON.stringify(metadata, null, 2) + '\n');
const require = createRequire(join(desktop, 'package.json'));
const { build, Platform, Arch } = require('electron-builder');
await build({ projectDir: stage, targets: Platform.WINDOWS.createTarget('nsis', Arch.x64), publish: 'never',
  config: { ...config, npmRebuild: false, electronVersion: devDependencies.electron,
    electronDist: await realpath(join(desktop, 'node_modules/electron/dist')), directories: { output } } });

execFileSync(process.execPath, [join(source, 'Desktop/scripts/verify-plugin-center-package.mjs'),
  '--build-root', root, '--output', output], { stdio: 'inherit' });
