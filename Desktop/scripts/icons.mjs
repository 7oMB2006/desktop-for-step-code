import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { Resvg } from '@resvg/resvg-js';

// All Windows icon sizes are derived from the canonical product SVG.
const svg = await readFile(new URL('../public/StepCode.svg', import.meta.url));
const sizes = [16, 24, 32, 48, 64, 128, 256];
const images = sizes.map(size => new Resvg(svg, { fitTo: { mode: 'width', value: size } }).render().asPng());
const header = Buffer.alloc(6 + sizes.length * 16);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(sizes.length, 4);
let offset = header.length;
images.forEach((image, index) => {
  const entry = 6 + index * 16;
  header[entry] = header[entry + 1] = sizes[index] % 256;
  header.writeUInt16LE(1, entry + 4);
  header.writeUInt16LE(32, entry + 6);
  header.writeUInt32LE(image.length, entry + 8);
  header.writeUInt32LE(offset, entry + 12);
  offset += image.length;
});
await mkdir(new URL('../build/', import.meta.url), { recursive: true });
await writeFile(new URL('../build/icon.ico', import.meta.url), Buffer.concat([header, ...images]));
