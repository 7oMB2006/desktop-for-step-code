import { imageMime } from './attachment-utils';

export const MAX_THEME_IMAGE_BYTES = 12 * 1024 * 1024;
export const MAX_THEME_IMAGE_EDGE = 8192;
export const MAX_THEME_IMAGE_PIXELS = 32 * 1024 * 1024;

export type ThemeImageDecoder = (bytes: Buffer) => { bytes: Buffer; width: number; height: number };
export interface ThemeImage { dataUrl: string; width: number; height: number }
interface Size { width: number; height: number }

function invalid(): never { throw new Error('Invalid theme image'); }
const boundedSize = (width: number, height: number): Size => {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1
    || width > MAX_THEME_IMAGE_EDGE || height > MAX_THEME_IMAGE_EDGE
    || width * height > MAX_THEME_IMAGE_PIXELS) invalid();
  return { width, height };
};
const sameSize = (a: Size, b: Size) => a.width === b.width && a.height === b.height;

function pngSize(bytes: Buffer): Size {
  if (imageMime(bytes) !== 'image/png') invalid();
  let size: Size | undefined, data = false, offset = 8;
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    if (length > bytes.length - offset - 12) invalid();
    const type = bytes.toString('ascii', offset + 4, offset + 8);
    if (!/^[A-Za-z]{4}$/.test(type) || ['acTL', 'fcTL', 'fdAT'].includes(type)) invalid();
    if (!size && type !== 'IHDR') invalid();
    if (type === 'IHDR') {
      if (size || length !== 13) invalid();
      size = boundedSize(bytes.readUInt32BE(offset + 8), bytes.readUInt32BE(offset + 12));
      const depth = bytes[offset + 16], color = bytes[offset + 17];
      const depths: Record<number, number[]> = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] };
      if (!depths[color]?.includes(depth) || bytes[offset + 18] !== 0 || bytes[offset + 19] !== 0
        || bytes[offset + 20] > 1) invalid();
    } else if (type === 'IDAT') {
      if (length) data = true;
    } else if (type === 'IEND') {
      if (!size || !data || length !== 0 || offset + 12 !== bytes.length) invalid();
      return size;
    }
    offset += length + 12;
  }
  return invalid();
}

const startOfFrame = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
function jpegSize(bytes: Buffer): Size {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) invalid();
  let size: Size | undefined, scan = false, hadScan = false, offset = 2;
  while (offset < bytes.length) {
    if (scan) {
      while (offset < bytes.length && bytes[offset] !== 0xff) offset++;
    }
    if (bytes[offset++] !== 0xff) invalid();
    while (offset < bytes.length && bytes[offset] === 0xff) offset++;
    if (offset >= bytes.length) invalid();
    const marker = bytes[offset++];
    if (scan && (marker === 0 || marker >= 0xd0 && marker <= 0xd7)) continue;
    scan = false;
    if (marker === 0xd9) {
      if (!size || !hadScan || offset !== bytes.length) invalid();
      return size;
    }
    if (marker === 0 || marker === 0xd8 || marker === 0xdc || marker >= 0xd0 && marker <= 0xd7) invalid();
    if (marker === 1) continue;
    if (offset + 2 > bytes.length) invalid();
    const length = bytes.readUInt16BE(offset);
    if (length < 2 || length > bytes.length - offset) invalid();
    if (startOfFrame.has(marker)) {
      if (size || length < 11) invalid();
      const components = bytes[offset + 7];
      if (components < 1 || components > 4 || length !== 8 + components * 3) invalid();
      size = boundedSize(bytes.readUInt16BE(offset + 5), bytes.readUInt16BE(offset + 3));
    }
    if (marker === 0xda) {
      if (!size || length < 8 || bytes[offset + 2] < 1 || bytes[offset + 2] > 4
        || length !== 6 + bytes[offset + 2] * 2) invalid();
      scan = true; hadScan = true;
    }
    offset += length;
  }
  return invalid();
}

export function validateThemeImage(bytes: Buffer, filename: string, decode: ThemeImageDecoder): ThemeImage {
  if (!Buffer.isBuffer(bytes) || !bytes.length || bytes.length > MAX_THEME_IMAGE_BYTES) invalid();
  const expected = filename === 'background.png' ? 'image/png'
    : filename === 'background.jpg' ? 'image/jpeg' : undefined;
  const mime = imageMime(bytes);
  if (!expected || mime !== expected) invalid();
  // Bounds and animation checks precede native decoding. The native decoder
  // validates pixels; only its re-encoded PNG is exposed to the renderer.
  const source = mime === 'image/png' ? pngSize(bytes) : jpegSize(bytes);
  const decoded = decode(bytes);
  if (!decoded || !Buffer.isBuffer(decoded.bytes) || !decoded.bytes.length
    || decoded.bytes.length > MAX_THEME_IMAGE_BYTES) invalid();
  const size = boundedSize(decoded.width, decoded.height);
  const rotated = mime === 'image/jpeg' && source.width === size.height && source.height === size.width;
  if (!sameSize(source, size) && !rotated || !sameSize(pngSize(decoded.bytes), size)) invalid();
  return { dataUrl: `data:image/png;base64,${decoded.bytes.toString('base64')}`, ...size };
}
