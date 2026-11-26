const maxEdge = 8192;
const maxPixels = 16_000_000;

function bounded(width: number, height: number) {
  return width > 0 && height > 0 && width <= maxEdge && height <= maxEdge && width * height <= maxPixels;
}

function png(bytes: Buffer) {
  if (bytes.length < 45 || bytes.readUInt32BE(8) !== 13 || bytes.toString('ascii', 12, 16) !== 'IHDR'
    || !bounded(bytes.readUInt32BE(16), bytes.readUInt32BE(20))) return false;
  let data = false;
  for (let offset = 33; offset + 12 <= bytes.length;) {
    const size = bytes.readUInt32BE(offset);
    const type = bytes.toString('ascii', offset + 4, offset + 8);
    const next = offset + 12 + size;
    if (next > bytes.length || ['IHDR', 'acTL', 'fcTL', 'fdAT'].includes(type)) return false;
    if (type === 'IDAT') data = true;
    if (type === 'IEND') return data && size === 0 && next === bytes.length;
    offset = next;
  }
  return false;
}

function jpeg(bytes: Buffer) {
  for (let i = 2; i + 3 < bytes.length;) {
    if (bytes[i++] !== 0xff) return false;
    while (bytes[i] === 0xff) i++;
    const marker = bytes[i++];
    if (marker === undefined || i + 2 > bytes.length || marker < 0xc0 || marker === 0xd9 || marker === 0xda) return false;
    const size = bytes.readUInt16BE(i);
    if (size < 2 || i + size > bytes.length) return false;
    if ([0xc0, 0xc1, 0xc2].includes(marker))
      return size >= 8 && bounded(bytes.readUInt16BE(i + 5), bytes.readUInt16BE(i + 3));
    if (marker < 0xd0 && ![0xc4, 0xcc].includes(marker)) return false;
    i += size;
  }
  return false;
}

function webp(bytes: Buffer) {
  if (bytes.length < 20 || bytes.readUInt32LE(4) !== bytes.length - 8) return false;
  let canvas: [number, number] | undefined;
  let image: [number, number] | undefined;
  let i = 12;
  for (; i + 8 <= bytes.length;) {
    const name = bytes.toString('ascii', i, i + 4);
    const size = bytes.readUInt32LE(i + 4);
    const start = i + 8;
    const next = start + size + (size & 1);
    if (next > bytes.length || name === 'ANIM' || name === 'ANMF') return false;
    if (name === 'VP8X') {
      if (i !== 12 || size !== 10 || bytes[start] & 2) return false;
      canvas = [1 + bytes.readUIntLE(start + 4, 3), 1 + bytes.readUIntLE(start + 7, 3)];
      if (!bounded(...canvas)) return false;
    } else if (name === 'VP8 ') {
      if (image || size < 10 || (bytes[start] & 1) !== 0 || !bytes.subarray(start + 3, start + 6).equals(Buffer.from([0x9d, 0x01, 0x2a]))) return false;
      image = [bytes.readUInt16LE(start + 6) & 0x3fff, bytes.readUInt16LE(start + 8) & 0x3fff];
    } else if (name === 'VP8L') {
      if (image || size < 5 || bytes[start] !== 0x2f) return false;
      const bits = bytes.readUInt32LE(start + 1);
      image = [(bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1];
    }
    i = next;
  }
  return i === bytes.length && !!image && bounded(...image)
    && (!canvas || (image[0] === canvas[0] && image[1] === canvas[1]));
}

function gif(bytes: Buffer) {
  if (bytes.length < 14) return false;
  const width = bytes.readUInt16LE(6), height = bytes.readUInt16LE(8);
  if (!bounded(width, height)) return false;
  const palette = (flags: number) => flags & 0x80 ? 3 * (2 << (flags & 7)) : 0;
  let i = 13 + palette(bytes[10]);
  let images = 0;
  const skipBlocks = () => {
    while (i < bytes.length) {
      const size = bytes[i++];
      if (!size) return true;
      i += size;
    }
    return false;
  };
  while (i < bytes.length) {
    const marker = bytes[i++];
    if (marker === 0x3b) return images === 1 && i === bytes.length;
    if (marker === 0x21) {
      // No GIF application/loop extensions; allow ordinary comments and graphic control.
      if (![0xf9, 0xfe].includes(bytes[i++]) || !skipBlocks()) return false;
    } else if (marker === 0x2c) {
      if (++images > 1 || i + 9 > bytes.length) return false;
      const left = bytes.readUInt16LE(i), top = bytes.readUInt16LE(i + 2);
      const w = bytes.readUInt16LE(i + 4), h = bytes.readUInt16LE(i + 6);
      if (!bounded(w, h) || left + w > width || top + h > height) return false;
      i += 9 + palette(bytes[i + 8]);
      if (i >= bytes.length || bytes[i] < 2 || bytes[i++] > 8 || !skipBlocks()) return false;
    } else return false;
  }
  return false;
}

/** Call only after checking the matching magic bytes and byte-length budget. */
export function rasterPreviewWithinBudget(bytes: Buffer, mime: string): boolean {
  switch (mime) {
    case 'image/png': return png(bytes);
    case 'image/jpeg': return jpeg(bytes);
    case 'image/webp': return webp(bytes);
    case 'image/gif': return gif(bytes);
    default: return false;
  }
}
