import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';
import { validateInstallerMetadata } from '../electron/update-installer.ts';
import { RELEASES_URL } from '../electron/app-updates.ts';

const require = createRequire(import.meta.resolve('electron-updater'));
const { load } = require('js-yaml');
const directory = resolve(process.argv[2] ?? 'release/updater-preview');
const { version } = JSON.parse(await readFile('package.json', 'utf8'));
const name = `Desktop.for.Step.Code.Setup.${version}.exe`;
const installer = join(directory, name);
const text = await readFile(join(directory, 'latest.yml'), 'utf8');
assert.ok(Buffer.byteLength(text) <= 128 * 1024);
const metadata = load(text);
const size = (await stat(installer)).size;
validateInstallerMetadata(metadata, { version, tag: `v${version}`, name, notes: '',
  url: `${RELEASES_URL}/tag/v${version}`, installer: { name, size, url: `${RELEASES_URL}/download/v${version}/${name}`, inApp: true } });
const sha512 = createHash('sha512');
const sha256 = createHash('sha256');
for await (const bytes of createReadStream(installer)) { sha512.update(bytes); sha256.update(bytes); }
assert.equal(sha512.digest('base64'), metadata.files[0].sha512);
const result = { version, name, size, sha256: sha256.digest('hex'), metadataMatches: true };
await writeFile(join(directory, 'update-package-check.json'), JSON.stringify(result, null, 2), 'utf8');
console.log(JSON.stringify(result));
