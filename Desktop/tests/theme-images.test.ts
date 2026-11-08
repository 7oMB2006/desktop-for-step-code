import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_THEME_IMAGE_BYTES, MAX_THEME_IMAGE_EDGE, MAX_THEME_IMAGE_PIXELS, validateThemeImage } from '../electron/theme-images';

const pixel = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jJmQAAAAASUVORK5CYII=', 'base64');
function chunk(type: string, data = Buffer.alloc(0)) {
  const result = Buffer.alloc(12 + data.length);
  result.writeUInt32BE(data.length); result.write(type, 4, 'ascii'); data.copy(result, 8);
  return result;
}
function png(width = 1, height = 1, extra: Buffer[] = []) {
  const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6;
  return Buffer.concat([pixel.subarray(0, 8), chunk('IHDR', header), ...extra, chunk('IDAT', Buffer.from([1])), chunk('IEND')]);
}
function jpeg(width = 1, height = 1, extra: Buffer[] = []) {
  const frame = Buffer.from([0xff, 0xc0, 0, 11, 8, 0, 0, 0, 0, 1, 1, 0x11, 0]);
  frame.writeUInt16BE(height, 5); frame.writeUInt16BE(width, 7);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), frame, ...extra,
    Buffer.from([0xff, 0xda, 0, 8, 1, 1, 0, 0, 63, 0, 1, 0xff, 0, 2, 0xff, 0xd9])]);
}
const decode = (bytes = pixel, width = 1, height = 1) => () => ({ bytes, width, height });
function rejectsBeforeDecode(bytes: Buffer, filename: string) {
  let calls = 0;
  assert.throws(() => validateThemeImage(bytes, filename, () => { calls++; return { bytes: pixel, width: 1, height: 1 }; }), /Invalid theme image/);
  assert.equal(calls, 0);
}

test('static images use bounded native decoding and expose only canonical PNG data', () => {
  for (const [bytes, filename] of [[pixel, 'background.png'], [jpeg(), 'background.jpg']] as const) {
    let calls = 0;
    const result = validateThemeImage(bytes, filename, source => {
      calls++; assert.equal(source, bytes); return { bytes: pixel, width: 1, height: 1 };
    });
    assert.equal(calls, 1);
    assert.deepEqual(result, { dataUrl: `data:image/png;base64,${pixel.toString('base64')}`, width: 1, height: 1 });
  }
});

test('filenames, actual signatures and encoded bounds are checked before decoding', () => {
  for (const filename of ['background.jpg', 'background.webp', 'image.png', '../background.png', 'https://example.com/background.png', 'background.PNG'])
    rejectsBeforeDecode(pixel, filename);
  rejectsBeforeDecode(Buffer.alloc(0), 'background.png');
  rejectsBeforeDecode(Buffer.alloc(MAX_THEME_IMAGE_BYTES + 1), 'background.png');
  rejectsBeforeDecode(Buffer.from('<svg/>'), 'background.png');
});

test('PNG bounds, chunks and animation are checked before decoding', () => {
  for (const bytes of [
    png(0, 1), png(MAX_THEME_IMAGE_EDGE + 1, 1), png(8192, 8192),
    png(1, 1, [chunk('acTL', Buffer.alloc(8))]), png(1, 1, [chunk('fcTL', Buffer.alloc(26))]),
    png(1, 1, [chunk('fdAT', Buffer.alloc(4))]),
    pixel.subarray(0, pixel.length - 1), Buffer.concat([pixel, Buffer.from([0])]),
    Buffer.concat([pixel.subarray(0, 33), chunk('IHDR', Buffer.alloc(13)), pixel.subarray(33)]),
  ]) rejectsBeforeDecode(bytes, 'background.png');
  const overflowing = Buffer.from(pixel); overflowing.writeUInt32BE(0xffffffff, 33);
  rejectsBeforeDecode(overflowing, 'background.png');
  const noData = Buffer.concat([pixel.subarray(0, 33), chunk('IEND')]);
  rejectsBeforeDecode(noData, 'background.png');
});

test('JPEG scans are bounded and reject hidden or truncated dimensions', () => {
  for (const bytes of [
    jpeg(0, 1), jpeg(MAX_THEME_IMAGE_EDGE + 1, 1), jpeg(8192, 8192),
    jpeg().subarray(0, 9), jpeg().subarray(0, jpeg().length - 1),
    Buffer.concat([jpeg(), Buffer.from([0])]),
    jpeg(1, 1, [jpeg(2, 2).subarray(2, 15)]),
    jpeg(1, 1, [Buffer.from([0xff, 0xdc, 0, 4, 0, 2])]),
    Buffer.from([0xff, 0xd8, 0xff, 0xd9]),
  ]) rejectsBeforeDecode(bytes, 'background.jpg');
});

test('JPEG progressive scans and rotated native output remain bounded', () => {
  const source = jpeg(2, 3);
  assert.deepEqual(validateThemeImage(source, 'background.jpg', decode(png(3, 2), 3, 2)),
    { dataUrl: `data:image/png;base64,${png(3, 2).toString('base64')}`, width: 3, height: 2 });
  const progressive = Buffer.concat([jpeg().subarray(0, jpeg().length - 2),
    Buffer.from([0xff, 0xda, 0, 8, 1, 1, 0, 1, 63, 0, 3, 0xff, 0xd9])]);
  progressive[3] = 0xc2;
  assert.doesNotThrow(() => validateThemeImage(progressive, 'background.jpg', decode()));
});

test('native output must remain bounded, static PNG and match decoded dimensions', () => {
  for (const output of [
    { bytes: pixel, width: 0, height: 1 },
    { bytes: pixel, width: NaN, height: 1 },
    { bytes: pixel, width: MAX_THEME_IMAGE_EDGE + 1, height: 1 },
    { bytes: pixel, width: 8192, height: 8192 },
    { bytes: Buffer.alloc(MAX_THEME_IMAGE_BYTES + 1), width: 1, height: 1 },
    { bytes: jpeg(), width: 1, height: 1 },
    { bytes: pixel, width: 2, height: 1 },
    { bytes: png(2, 1), width: 1, height: 1 },
    { bytes: png(1, 1, [chunk('acTL', Buffer.alloc(8))]), width: 1, height: 1 },
  ]) assert.throws(() => validateThemeImage(pixel, 'background.png', () => output), /Invalid theme image/);
  assert.throws(() => validateThemeImage(pixel, 'background.png', () => { throw new Error('Decoder rejected image'); }), /Decoder rejected image/);
});

test('pixel and edge limits are independently enforced without clamping or resampling', () => {
  assert.equal(MAX_THEME_IMAGE_PIXELS, 8192 * 4096);
  assert.doesNotThrow(() => validateThemeImage(png(8192, 4096), 'background.png', decode(png(8192, 4096), 8192, 4096)));
  rejectsBeforeDecode(png(8192, 4097), 'background.png');
  assert.throws(() => validateThemeImage(png(2, 3), 'background.png', decode(png(3, 2), 3, 2)), /Invalid theme image/);
});
