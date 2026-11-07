// One-time conversion from the approved local wallpaper. No plugin JS is executed.
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const source = process.argv[2];
if (!source) throw new Error('Pass the original Wallpaper directory');
const script = await readFile(resolve(source, 'public/assets/dragon-points.js'), 'utf8');
const start = 'window.STELLAR_DRAGONS=Object.freeze(';
const at = script.indexOf(start);
if (at < 0 || !/\);\s*$/.test(script)) throw new Error('Unexpected artwork format');
const dragons = JSON.parse(script.slice(at + start.length).replace(/\);\s*$/, ''));
const duck = JSON.parse(await readFile(resolve(source, 'src/artwork/duck-landmarks.json'), 'utf8'));
await writeFile(new URL('../../theme-marketplace/plugins/stellar-cruise/scene.json', import.meta.url),
  JSON.stringify({ dragons, duck }) + '\n');
console.log('Imported original stellar artwork as JSON.');
