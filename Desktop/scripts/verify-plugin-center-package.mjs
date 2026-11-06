import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { isAbsolute, join } from 'node:path';

const options = {};
for (let index = 2; index < process.argv.length; index += 2) {
  const key = process.argv[index], value = process.argv[index + 1];
  assert.ok(['--build-root', '--output'].includes(key) && !options[key] && isAbsolute(value ?? ''),
    'Use --build-root <isolated build directory> --output <preview package directory>');
  options[key] = value;
}
assert.equal(Object.keys(options).length, 2);
const root = options['--build-root'], output = options['--output'];
const desktop = join(root, 'Desktop'), resources = join(output, 'win-unpacked/resources');
const json = async path => JSON.parse(await readFile(path, 'utf8'));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const require = createRequire(join(desktop, 'package.json'));
const { extractFile, listPackage } = require('@electron/asar');
const archive = join(resources, 'app.asar');
const receipt = await json(join(output, 'source-receipt.json'));
const manifest = await json(join(desktop, 'package.json'));
const pin = await json(join(root, 'patches/v017/manifest.json'));
const shipped = JSON.parse(extractFile(archive, 'package.json'));
assert.equal(shipped.version, manifest.version);
assert.equal(shipped.dependencies, undefined);
assert.equal(shipped.devDependencies, undefined);
assert.deepEqual([...new Set(listPackage(archive).map(path =>
  path.replaceAll('\\', '/').split('/').filter(Boolean)[0]))].sort(), ['dist', 'package.json']);
const runtime = await json(join(resources, 'runtime/manifest.json'));
assert.deepEqual(runtime, receipt.runtime);
assert.equal(runtime.commit, pin.commit);
assert.deepEqual(runtime.upstreamCommits, pin.upstream.commits.map(item => item.sha));
assert.deepEqual(runtime.patchedSourceHashes, { ...pin.patchedSources, ...pin.platforms?.win32?.patchedSources });
assert.equal(hash(await readFile(join(resources, 'runtime/node/node.exe'))), runtime.nodeSha256);

async function inventory(directory, prefix = '') {
  const result = {};
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name), key = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) Object.assign(result, await inventory(path, key));
    else if (entry.isFile()) result[key] = hash(await readFile(path));
    else throw new Error(`Unexpected linked package entry: ${key}`);
  }
  return result;
}
const counts = { source: 0, desktop: 0, runtime: 0, terminal: 0, extraResources: 0, bvr: 0, plugin: 0 };
for (const [key, expected] of Object.entries(receipt.sourceHashes)) {
  assert.equal(hash(await readFile(join(root, key))), expected, key);
  counts.source++;
}
const config = manifest.build;
const external = key => config.extraResources.some(resource =>
  key === resource.from || key.startsWith(`${resource.from}/`));
for (const [key, expected] of Object.entries(await inventory(join(desktop, 'dist')))) {
  // electron-builder removes extraResources from app.asar to avoid duplicate payloads.
  if (!external(`dist/${key}`)) {
    assert.equal(hash(extractFile(archive, join('dist', ...key.split('/')))), expected, key);
    counts.desktop++;
  }
}
for (const name of ['runtime', 'terminal-runtime']) {
  const input = await inventory(join(desktop, name));
  const actual = await inventory(join(resources, name));
  for (const [key, expected] of Object.entries(actual)) {
    assert.equal(expected, input[key], `${name}/${key}`);
    counts[name === 'runtime' ? 'runtime' : 'terminal']++;
  }
  if (name === 'runtime') assert.equal(Object.keys(actual).length, Object.keys(input).length);
}
for (const resource of config.extraResources) {
  if (['runtime', 'terminal-runtime/host.cjs', 'terminal-runtime/node_modules/node-pty'].includes(resource.from)) continue;
  const input = join(desktop, resource.from), target = join(resources, resource.to);
  if ((await stat(input)).isDirectory()) {
    const expected = await inventory(input), actual = await inventory(target);
    assert.deepEqual(actual, expected, resource.to);
    counts.extraResources += Object.keys(actual).length;
  } else {
    assert.equal(hash(await readFile(target)), hash(await readFile(input)), resource.to);
    counts.extraResources++;
  }
}
for (const [key, expected] of Object.entries(receipt.desktopRuntimeHelpers)) {
  assert.equal(hash(await readFile(join(resources, 'runtime', key))), expected, key);
}
for (const [directory, entries, counter] of [
  ['bvr-runtime', receipt.bvrHashes, 'bvr'], ['bvr-local-preview', receipt.pluginHashes, 'plugin'],
]) {
  for (const [key, expected] of Object.entries(entries)) {
    assert.equal(hash(await readFile(join(output, directory, key))), expected, key);
    counts[counter]++;
  }
}
const installer = `Desktop.for.Step.Code.Setup.${manifest.version}.exe`;
const sha256 = hash(await readFile(join(output, installer)));
await mkdir(join(output, 'acceptance'), { recursive: true });
await writeFile(join(output, 'acceptance/package-integrity.json'), JSON.stringify({
  version: manifest.version, installer, sha256, counts, desktopBase: receipt.desktopBase,
  bvrBase: receipt.bvrBase, includesUncommittedFeatureChanges: true,
  runtimePin: runtime.commit, localBvrRuntimeIsNotPortable: receipt.localBvrRuntimeIsNotPortable,
  scope: 'File integrity only; native application acceptance and real billing are separate.',
}, null, 2) + '\n');
await writeFile(join(output, 'SHA256SUMS.txt'), `${sha256}  ${installer}\n`);
console.log(JSON.stringify({ output, installer, sha256, counts }, null, 2));
