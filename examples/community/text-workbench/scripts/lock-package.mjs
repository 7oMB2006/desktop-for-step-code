import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const project = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const root = join(project, 'plugins', 'text-workbench');
const files = [];
async function walk(directory) {
  for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name < b.name ? -1 : 1)) {
    const path = join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error('Package links are not allowed.');
    if (entry.isDirectory()) await walk(path);
    else if (entry.isFile()) {
      const bytes = await readFile(path);
      files.push({ path: relative(root, path).split(sep).join('/'), size: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex') });
    } else throw new Error('Unsupported package entry.');
  }
}
await walk(root);
await writeFile(join(project, 'source-lock.json'), JSON.stringify({
  format: 'local-sha256-v1', plugin: 'text-workbench', version: '0.1.0',
  published: false, gitCommit: null, files,
}, null, 2) + '\n');
console.log(`Locked ${files.length} local package files; no published commit claimed.`);
