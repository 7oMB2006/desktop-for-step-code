import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstat, mkdir, readdir, realpath, symlink, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { packageFingerprint, plainFile } from '../electron/plugin-files.mjs';
import { mkdtemp, removeTestProfile } from '../scripts/test-profile.mjs';

async function fixture(t: test.TestContext) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'desktop-plugin-fingerprint-')));
  t.after(() => removeTestProfile(root));
  return root;
}

async function sequentialFingerprint(root: string) {
  const hash = createHash('sha256');
  async function visit(path = '') {
    for (const entry of (await readdir(join(root, path), { withFileTypes: true }))
      .sort((a, b) => a.name.localeCompare(b.name))) {
      const child = path ? `${path}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await visit(child);
      else {
        const bytes = await plainFile(root, child, 128 * 1024 * 1024);
        hash.update(JSON.stringify([child, bytes.length])).update(bytes);
      }
    }
  }
  await visit();
  return hash.digest('hex');
}

test('fingerprints preserve legacy DFS bytes, empty directories and bundled dependency contents', async t => {
  const root = await fixture(t);
  for (const path of ['a/nested', 'a-empty', 'node_modules/library', 'z-empty'])
    await mkdir(join(root, path), { recursive: true });
  for (const [path, bytes] of [
    ['a/nested/b.txt', Buffer.from([0, 255, 10])],
    ['a/z.txt', Buffer.from('nested')],
    ['a-file.txt', Buffer.from('sibling')],
    ['node_modules/library/index.js', Buffer.from('export default 1;')],
    ['README.md', Buffer.alloc(0)],
    ['Z.txt', Buffer.from('last')],
  ] as const) await writeFile(join(root, path), bytes);
  assert.equal(await packageFingerprint(root), await sequentialFingerprint(root));
  const before = await packageFingerprint(root);
  const dependency = join(root, 'node_modules/library/index.js'), info = await lstat(dependency);
  await writeFile(dependency, 'export default 2;');
  await utimes(dependency, info.atime, info.mtime);
  assert.notEqual(await packageFingerprint(root), before, 'same size and restored mtime cannot cache dependency bytes');
  assert.equal(await packageFingerprint(root), await sequentialFingerprint(root));
});

test('fingerprints reject a linked root and nested junction without reading outside the package', async t => {
  const root = await fixture(t), outside = join(root, 'outside'), target = join(root, 'package');
  await mkdir(outside);
  await mkdir(target);
  await writeFile(join(outside, 'private.txt'), 'outside');
  const linkedRoot = join(root, 'linked-root');
  try { await symlink(target, linkedRoot, process.platform === 'win32' ? 'junction' : 'dir'); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EPERM') { t.skip('Directory links unavailable'); return; }
    throw error;
  }
  await assert.rejects(packageFingerprint(linkedRoot), /invalid-path/);
  await symlink(outside, join(target, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(packageFingerprint(target), /invalid-path/);
});

// Synthetic filesystem hooks make budget and read races deterministic without large disk fixtures.
const harness = String.raw`
import assert from 'node:assert/strict';
import * as crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { SourceTextModule, SyntheticModule, createContext } from 'node:vm';

const scenario = process.argv[1], filename = process.argv[2];
const root = path.resolve('virtual-fingerprint-package'), nodes = new Map(), hooks = {};
let serial = 0, opened = 0, closed = 0, active = 0, maximum = 0, reads = 0;
function put(name, size = 0, kind = 'file') {
  const target = name ? path.join(root, name) : root;
  nodes.set(target, { kind, size, ino: ++serial, mtimeMs: serial });
  return target;
}
function lookup(target) {
  const node = nodes.get(path.resolve(target));
  if (!node) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
  return node;
}
const stat = node => ({
  dev: 1, ino: node.ino, size: node.size, mtimeMs: node.mtimeMs,
  isFile: () => node.kind === 'file', isDirectory: () => node.kind === 'directory',
  isSymbolicLink: () => node.kind === 'link',
});
put('', 0, 'directory');
const fs = {
  async lstat(target) { hooks.beforeLstat?.(path.resolve(target)); return stat(lookup(target)); },
  async realpath(target) {
    hooks.beforeRealpath?.(path.resolve(target));
    lookup(target);
    return path.resolve(target);
  },
  async readdir(target) {
    return [...nodes.entries()].filter(([name]) => name !== target && path.dirname(name) === target)
      .map(([name, node]) => ({ name: path.basename(name), ...stat(node) }));
  },
  async open(target, flags) {
    assert.equal(flags, 'r');
    const node = lookup(target);
    opened++; active++; maximum = Math.max(maximum, active);
    let done = false;
    return {
      async stat() { assert.ok(!done); return stat(node); },
      async read(buffer, offset, length) {
        assert.ok(!done); reads++;
        await hooks.beforeRead?.(path.resolve(target), node);
        const bytesRead = Math.min(length, node.size);
        buffer.fill(0, offset, offset + bytesRead);
        return { bytesRead };
      },
      async close() { assert.ok(!done); done = true; active--; closed++; },
    };
  },
  async mkdir() { throw new Error('unexpected write'); },
  async rename() { throw new Error('unexpected write'); },
  async rm() { throw new Error('unexpected write'); },
};
const context = createContext({ Buffer });
function synthetic(values) {
  return new SyntheticModule(Object.keys(values), function () {
    for (const [name, value] of Object.entries(values)) this.setExport(name, value);
  }, { context });
}
const module = new SourceTextModule(readFileSync(filename, 'utf8'), { context });
await module.link(specifier => {
  if (specifier === 'node:fs/promises') return synthetic(fs);
  if (specifier === 'node:crypto') return synthetic(crypto);
  if (specifier === 'node:path') return synthetic(path);
  if (specifier === './theme-composition.mjs') return synthetic({ parseThemeComposition() {} });
  throw new Error('unexpected import: ' + specifier);
});
await module.evaluate();
const fingerprint = () => module.namespace.packageFingerprint(root);
const noPayloadRead = () => { assert.equal(opened, 0); assert.equal(reads, 0); };
const complete = () => { assert.equal(active, 0); assert.equal(opened, closed); };
const expected = files => {
  const hash = crypto.createHash('sha256'), zeros = Buffer.alloc(1024 * 1024);
  for (const [name, size] of files) {
    hash.update(JSON.stringify([name, size]));
    for (let remaining = size; remaining > 0; remaining -= zeros.length)
      hash.update(zeros.subarray(0, Math.min(remaining, zeros.length)));
  }
  return hash.digest('hex');
};

if (scenario === 'entries-exact') {
  for (let index = 0; index < 10000; index++) put('f' + String(index).padStart(5, '0'));
  const names = [...nodes.keys()].filter(name => name !== root).map(name => path.basename(name)).sort((a, b) => a.localeCompare(b));
  assert.equal(await fingerprint(), expected(names.map(name => [name, 0])));
  assert.equal(opened, 10000); assert.ok(maximum <= 8); complete();
} else if (scenario === 'entries-directory-budget') {
  put('directory', 0, 'directory');
  for (let index = 0; index < 10000; index++) put('f' + String(index).padStart(5, '0'));
  await assert.rejects(fingerprint(), /too-large/); noPayloadRead();
} else if (scenario === 'size-exact') {
  put('a.bin', 64 * 1024 * 1024); put('b.bin', 64 * 1024 * 1024);
  assert.equal(await fingerprint(), expected([['a.bin', 64 * 1024 * 1024], ['b.bin', 64 * 1024 * 1024]]));
  complete();
} else if (scenario === 'size-aggregate') {
  put('a.bin', 64 * 1024 * 1024); put('b.bin', 64 * 1024 * 1024 + 1);
  await assert.rejects(fingerprint(), /too-large/); noPayloadRead();
} else if (scenario === 'size-single') {
  put('a.bin', 128 * 1024 * 1024 + 1);
  await assert.rejects(fingerprint(), /too-large/); noPayloadRead();
} else if (scenario === 'growth-before-read') {
  const file = put('a.bin', 1); let changed = false;
  hooks.beforeRealpath = () => {
    if (!changed) { changed = true; lookup(file).size = 128 * 1024 * 1024; }
  };
  await assert.rejects(fingerprint(), /too-large/); noPayloadRead();
} else if (scenario === 'mutation-during-read') {
  put('a.bin', 1);
  hooks.beforeRead = (_target, node) => { node.mtimeMs++; };
  await assert.rejects(fingerprint(), /stale/); complete();
} else if (scenario === 'link-before-read') {
  const file = put('a.bin', 1);
  hooks.beforeRealpath = () => { lookup(file).kind = 'link'; };
  await assert.rejects(fingerprint(), /invalid-path/); noPayloadRead();
} else if (scenario === 'non-file') {
  put('socket', 0, 'socket');
  await assert.rejects(fingerprint(), /too-large/); noPayloadRead();
} else if (scenario === 'concurrent-ordered') {
  const names = Array.from({ length: 25 }, (_, index) => 'f' + String(index).padStart(2, '0'));
  names.forEach((name, index) => put(name, index));
  hooks.beforeRead = target => new Promise(resolve => setTimeout(resolve, path.basename(target) === 'f00' ? 20 : 1));
  assert.equal(await fingerprint(), expected(names.map((name, index) => [name, index])));
  assert.equal(maximum, 8); assert.equal(reads, 25); complete();
} else if (scenario === 'failed-batch-drains') {
  for (let index = 0; index < 25; index++) put('f' + String(index).padStart(2, '0'), 1);
  hooks.beforeRead = async target => {
    if (path.basename(target) === 'f00') throw new Error('fixture-read-failed');
    await new Promise(resolve => setTimeout(resolve, 10));
  };
  await assert.rejects(fingerprint(), /fixture-read-failed/);
  assert.equal(opened, 8); complete();
} else throw new Error('unknown scenario: ' + scenario);
`;

const source = fileURLToPath(new URL('../electron/plugin-files.mjs', import.meta.url));
for (const scenario of [
  'entries-exact', 'entries-directory-budget', 'size-exact', 'size-aggregate', 'size-single',
  'growth-before-read', 'mutation-during-read', 'link-before-read', 'non-file',
  'concurrent-ordered', 'failed-batch-drains',
]) test(`fingerprint bounded-read protocol: ${scenario}`, { timeout: 20000 }, () => {
  const result = spawnSync(process.execPath, ['--experimental-vm-modules', '--input-type=module', '-e',
    harness, scenario, resolve(source)], { encoding: 'utf8', windowsHide: true, timeout: 18000 });
  assert.equal(result.status, 0, `${result.error ?? ''}\n${result.stdout}\n${result.stderr}`);
});
