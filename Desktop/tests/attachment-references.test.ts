import test from 'node:test';
import assert from 'node:assert/strict';
import { fileReferenceMessage } from '../electron/attachment-utils';
import { attachmentPresentation } from '../src/attachment-references';

test('generated bilingual attachments map to names while preserving the exact draft and raw prompt', () => {
  const files = process.platform === 'win32'
    ? [{ path: 'C:\\Users\\owner\\实验二.doc', name: '实验二.doc' }, { path: '\\\\server\\share\\slides.pptx', name: 'slides.pptx' }]
    : [{ path: '/tmp/实验二.doc', name: '实验二.doc' }, { path: '/tmp/quote "example".pptx', name: 'quote "example".pptx' }];
  for (const language of ['zh', 'en'] as const) {
    for (const draft of ['', 'Read this', 'Paragraph\n\nwith /skill and a quote']) {
      const raw = fileReferenceMessage(draft, files.map(file => file.path), language);
      assert.deepEqual(attachmentPresentation(raw), { draft, files });
      assert.ok(raw.includes('Word/PPT'));
    }
  }
});
test('saved Windows references are recognized regardless of the host platform', () => {
  const draft = 'Read this';
  const header = fileReferenceMessage('', ['/tmp/notes.doc'], 'en').split('\n')[0];
  const path = 'C:\\local\\a.doc';
  const raw = `${draft}\n\n${header}\n- ${JSON.stringify(path)} ("a.doc")`;
  assert.deepEqual(attachmentPresentation(raw), { draft, files: [{ path, name: 'a.doc' }] });
});
test('ordinary prose, incomplete blocks and unmatched filenames stay visible', () => {
  const path = process.platform === 'win32' ? 'C:\\local\\a.doc' : '/tmp/a.doc';
  const raw = fileReferenceMessage('Read this', [path], 'en');
  for (const text of ['hello a.doc', raw + '\nMore prose', raw.slice(0, -1), raw.replace('("a.doc")', '("b.doc")'),
    raw.replace(JSON.stringify(path), '"relative/a.doc"'), '```\n' + raw + '\n```'])
    assert.equal(attachmentPresentation(text), undefined);
});
