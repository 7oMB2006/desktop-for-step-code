import { build } from 'esbuild';
import { existsSync } from 'node:fs';
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = join(root, 'plugins/dfsc-host-example/dist');
await mkdir(output, { recursive: true });
const result = await build({
  absWorkingDir: root, entryPoints: ['src/server.mjs'], outfile: join(output, 'server.mjs'),
  bundle: true, platform: 'node', format: 'esm', target: 'node24', metafile: true,
  legalComments: 'inline', charset: 'ascii',
  banner: { js: "import { createRequire as __dfscCreateRequire } from 'node:module'; const require = __dfscCreateRequire(import.meta.url);" },
});
const packages = new Map();
for (const input of Object.keys(result.metafile.inputs).filter(path => path.includes('node_modules/'))) {
  let cursor = dirname(await realpath(resolve(root, input)));
  let metadata;
  while (true) {
    if (existsSync(join(cursor, 'package.json'))) {
      const value = JSON.parse(await readFile(join(cursor, 'package.json'), 'utf8'));
      if (typeof value.name === 'string' && typeof value.version === 'string') { metadata = value; break; }
    }
    const parent = dirname(cursor);
    if (parent === cursor) throw new Error('Dependency package metadata missing');
    cursor = parent;
  }
  const name = `${metadata.name}@${metadata.version}`;
  if (packages.has(name)) continue;
  const license = ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'license', 'license.md']
    .find(file => existsSync(join(cursor, file)));
  if (!license) throw new Error(`Bundled dependency has no license file: ${name}`);
  packages.set(name, await readFile(join(cursor, license), 'utf8'));
}
const notices = [...packages].sort(([a], [b]) => a.localeCompare(b))
  .map(([name, license]) => `## ${name}\n\n${license.trim().replace(/\r\n/g, '\n')}\n`).join('\n');
await writeFile(join(output, 'THIRD_PARTY_LICENSES.txt'),
  `Bundled dependency licenses. Versions are pinned in the author lockfile.\n\n${notices}`);
await writeFile(join(root, 'plugins/dfsc-host-example/LICENSE'), await readFile(join(root, 'LICENSE')));
console.log(`Built self-contained SDK entry with ${packages.size} dependency license records.`);
