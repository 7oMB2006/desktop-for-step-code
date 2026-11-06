import { deflateSync } from 'node:zlib';
import { mkdir, writeFile } from 'node:fs/promises';

const side = 96;
const raw = Buffer.alloc((side * 4 + 1) * side);
function pixel(x, y, color) {
  const offset = y * (side * 4 + 1) + 1 + x * 4;
  color.forEach((value, index) => { raw[offset + index] = value; });
}
function rectangle(x, y, width, height, color) {
  for (let row = y; row < y + height; row++)
    for (let col = x; col < x + width; col++) pixel(col, row, color);
}
const dark = [21, 62, 55, 255], white = [242, 249, 246, 255], green = [123, 221, 179, 255];
for (let y = 0; y < side; y++) {
  for (let x = 0; x < side; x++) {
    const dx = Math.max(14 - x, x - 81, 0), dy = Math.max(14 - y, y - 81, 0);
    pixel(x, y, dx * dx + dy * dy <= 196 ? dark : [0, 0, 0, 0]);
  }
}
for (const y of [25, 45, 65]) {
  rectangle(22, y, 8, 8, green);
  rectangle(38, y + 1, y === 65 ? 24 : 36, 6, white);
}
function chunk(type, data) {
  const name = Buffer.from(type), payload = Buffer.concat([name, data]);
  let crc = 0xffffffff;
  for (const byte of payload) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  const length = Buffer.alloc(4), checksum = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
  return Buffer.concat([length, payload, checksum]);
}
const header = Buffer.alloc(13);
header.writeUInt32BE(side); header.writeUInt32BE(side, 4);
header[8] = 8; header[9] = 6;
const directory = new URL('../plugins/text-workbench/assets/', import.meta.url);
await mkdir(directory, { recursive: true });
await writeFile(new URL('icon.png', directory), Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk('IHDR', header), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
]));
console.log('Generated original 96x96 PNG icon.');
