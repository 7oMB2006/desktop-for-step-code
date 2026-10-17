import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { valid } from 'semver';

if (process.platform !== 'darwin' || process.arch !== 'arm64') throw new Error('Prepare the release on an Apple Silicon Mac');
const app = resolve(process.argv[2] ?? 'release/mac-arm64/Desktop for Step Code.app');
const { version, sourceCommit, sourceDirty } = JSON.parse(await readFile(join(app, 'Contents/Resources/macos-update.json'), 'utf8'));
const commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
if (sourceDirty || sourceCommit !== commit || execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim()) throw new Error('Commit changes and rebuild the package from the exact clean release commit');
if (!valid(version)) throw new Error('Missing macOS update version');
const folder = resolve('release', `v${version}`);
// Refuse to overwrite a prepared/published artifact set.
await mkdir(folder);
const name = `Desktop.for.Step.Code.${version}.arm64.zip`;
execFileSync('/usr/bin/ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', app, join(folder, name)]);
const sha512 = createHash('sha512'); const sha256 = createHash('sha256');
for await (const chunk of createReadStream(join(folder, name))) { sha512.update(chunk); sha256.update(chunk); }
const metadata = { version, arch: 'arm64', bundleIdentifier: 'community.stepcode.desktop', files: [{ url: name, size: (await stat(join(folder, name))).size, sha512: sha512.digest('base64') }] };
await writeFile(join(folder, 'mac-update.json'), `${JSON.stringify(metadata, null, 2)}\n`);
await writeFile(join(folder, 'SHA256SUMS.txt'), `${sha256.digest('hex')}  ${name}\n`);
await writeFile(join(folder, 'COMMIT.txt'), `${commit}\n`);
await writeFile(join(folder, 'runtime-manifest.json'), await readFile(join(app, 'Contents/Resources/runtime/manifest.json')));
console.log(`Prepared ${folder}. Review verification evidence and release notes before uploading; mac-update.json is required for in-app updates.`);
