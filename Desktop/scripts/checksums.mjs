import { readdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const files = (await readdir('release')).filter(name => name.endsWith('.exe'));
const lines = await Promise.all(files.map(async name => `${createHash('sha256').update(await readFile(`release/${name}`)).digest('hex')}  ${name}`));
await writeFile('release/SHA256SUMS.txt', lines.join('\n') + '\n');
console.log(lines.join('\n'));
