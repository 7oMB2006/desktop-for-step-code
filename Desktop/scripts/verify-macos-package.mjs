import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, readdir, stat, mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { extractFile } from '@electron/asar';

const app = resolve(process.argv[2] ?? 'release/mac-arm64/Desktop for Step Code.app');
const resources = join(app, 'Contents/Resources');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const manifest = JSON.parse(await readFile('runtime/manifest.json', 'utf8'));
assert.equal(manifest.platform, 'darwin');
assert.equal(manifest.arch, 'arm64');
const source = JSON.parse(await readFile('package.json', 'utf8'));
const archive = join(resources, 'app.asar');
const packaged = JSON.parse(extractFile(archive, 'package.json').toString('utf8'));
assert.equal(packaged.version, source.version);
const marker = JSON.parse(await readFile(join(resources, 'macos-update.json'), 'utf8'));
assert.equal(marker.version.replace(/-macos\.\d+$/, ''), source.version);
for (const name of ['file-applications-macos', 'macos-update-helper.cjs']) assert.equal(hash(await readFile(join(resources, 'file-opening', name))), hash(await readFile(join('dist/file-opening', name))));
assert.equal(execFileSync('/usr/bin/plutil', ['-extract', 'LSMinimumSystemVersion', 'raw', '-o', '-', join(app, 'Contents/Info.plist')], { encoding: 'utf8' }).trim(), '13.5');
assert.match(execFileSync('/usr/bin/otool', ['-l', join(resources, 'file-opening/file-applications-macos')], { encoding: 'utf8' }), /minos 13\.5/);
const checked = [];
async function walk(root) {
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) await walk(path);
    else {
      const bytes = await readFile(path);
      const target = path === 'dist/keyless-fetch.cjs'
        ? await readFile(join(resources, 'runtime-adapters/keyless-fetch.cjs'))
        : path.startsWith('dist/') ? extractFile(archive, path) : await readFile(join(resources, path));
      assert.equal(hash(bytes), hash(target), `${path} differs in the package`);
      checked.push(path);
    }
  }
}
await walk('dist');
await walk('runtime');
for (const path of ['terminal-runtime/host.cjs', 'terminal-runtime/node_modules/node-pty/prebuilds/darwin-arm64/pty.node', 'terminal-runtime/node_modules/node-pty/prebuilds/darwin-arm64/spawn-helper']) {
  assert.equal(hash(await readFile(path)), hash(await readFile(join(resources, path))), path);
  checked.push(path);
}
assert.ok((await stat(join(resources, 'runtime/node/node'))).mode & 0o111);
assert.ok((await stat(join(resources, 'terminal-runtime/node_modules/node-pty/prebuilds/darwin-arm64/spawn-helper'))).mode & 0o111);
assert.equal(hash(await readFile(join(resources, 'runtime/node/node'))), manifest.nodeSha256);
await mkdir('test-results', { recursive: true });
await writeFile('test-results/macos-package-resources.json', JSON.stringify({
  baseline: `v${source.version}`, desktop: packaged.version, platform: manifest.platform,
  arch: manifest.arch, runtime: manifest.commit, node: manifest.node,
  nodeSha256: manifest.nodeSha256, verifiedFiles: checked.length, checked,
}, null, 2));
console.log(`Verified ${checked.length} packaged files, native Node and PTY executable permissions, version and runtime architecture.`);
