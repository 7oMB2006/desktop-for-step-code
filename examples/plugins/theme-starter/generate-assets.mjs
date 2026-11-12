import { writeFile } from 'node:fs/promises';
import { deflateSync } from 'node:zlib';

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const name = Buffer.from(type);
  const result = Buffer.alloc(data.length + 12);
  result.writeUInt32BE(data.length);
  name.copy(result, 4); data.copy(result, 8);
  result.writeUInt32BE(crc32(Buffer.concat([name, data])), data.length + 8);
  return result;
}

function png(width, height, pixel) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width); header.writeUInt32BE(height, 4);
  header[8] = 8; header[9] = 2;
  const scanlines = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const offset = y * (width * 3 + 1) + 1 + x * 3;
      pixel(x, y).forEach((channel, index) => { scanlines[offset + index] = channel; });
    }
  }
  return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'),
    chunk('IHDR', header), chunk('IDAT', deflateSync(scanlines)), chunk('IEND', Buffer.alloc(0))]);
}

const directory = new URL('./plugins/dfsc-theme-example/', import.meta.url);
await writeFile(new URL('background.png', directory), png(1280, 720, (x, y) => {
  const grid = x % 80 === 0 || y % 80 === 0;
  const terrace = Math.floor((x + y * .6) / 160) % 3;
  if (Math.abs(y - 510 + Math.floor(x / 160) * 24) < 3) return [100, 203, 178];
  if (x > 970 && y > 80 && y < 245 && (x + y) % 40 < 3) return [163, 111, 135];
  if (grid) return [44, 48, 46];
  return [[24, 27, 26], [29, 32, 30], [34, 35, 32]][terrace];
}));
await writeFile(new URL('icon.png', directory), png(96, 96, (x, y) => {
  if (x < 8 || y < 8 || x > 87 || y > 87) return [24, 27, 26];
  if (x < 46) return y < 46 ? [100, 203, 178] : [163, 111, 135];
  return y < 46 ? [225, 224, 214] : [66, 75, 70];
}));
