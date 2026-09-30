import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decodeImageUrl, imageFileName, fileReferenceMessage, imageMime, MAX_IMAGE_BYTES } from '../electron/attachment-utils';

test('image actions accept bounded inline images, not URLs or disguised payloads', () => {
  const bytes = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  assert.deepEqual(decodeImageUrl(`data:image/png;base64,${bytes.toString('base64')}`).bytes, bytes);
  for (const url of ['https://example.com/a.png', 'file:///C:/a.png', 'data:image/svg+xml;base64,PHN2Zz4=', `data:image/jpeg;base64,${bytes.toString('base64')}`, 'data:image/png;base64,???', null]) {
    assert.throws(() => decodeImageUrl(url));
  }
  assert.throws(() => decodeImageUrl(`data:image/png;base64,${Buffer.alloc(MAX_IMAGE_BYTES + 1).toString('base64')}`), /exceeds/);
});

test('image export names cannot carry paths and use the actual format', () => {
  assert.equal(imageFileName('C:\\photos\\holiday.jpeg', 'image/png'), 'holiday.png');
  assert.equal(imageFileName('../../picture.webp', 'image/jpeg'), 'picture.jpg');
  assert.equal(imageFileName('CON', 'image/webp'), 'image.webp');
  assert.equal(imageFileName('bad:name?.png', 'image/png'), 'badname.png');
});

test('detects only supported image signatures', () => {
  assert.equal(imageMime(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])), 'image/png');
  assert.equal(imageMime(Buffer.from([255, 216, 255, 224])), 'image/jpeg');
  assert.equal(imageMime(Buffer.from('RIFF1234WEBP')), 'image/webp');
  assert.equal(imageMime(Buffer.from('<svg></svg>')), null);
});

test('file references remain explicit local paths, never imply native parsing', () => {
  const path = 'D:\\project\\about-me.md';
  assert.equal(fileReferenceMessage('Read this', [], 'en'), 'Read this');
  assert.match(fileReferenceMessage('Read this', [path], 'en'), /not parsed model inputs/);
  assert.match(fileReferenceMessage('', [path], 'zh'), /不是已解析的模型输入/);
  assert.ok(fileReferenceMessage('', [path], 'en').includes(JSON.stringify(path)));
});
