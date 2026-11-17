import test from 'node:test';
import assert from 'node:assert/strict';
import { fileReferenceMessage } from '../electron/attachment-utils';
import { attachmentPresentation } from '../src/attachment-references';

test('generated bilingual attachments map to names while preserving the exact draft and raw prompt', () => {
  const paths = ['C:\\Users\\owner\\实验二.doc', '/tmp/quote "example".pptx'];
  for (const language of ['zh', 'en'] as const) {
    for (const draft of ['', 'Read this', 'Paragraph\n\nwith /skill and a quote']) {
      const raw = fileReferenceMessage(draft, paths, language);
      assert.deepEqual(attachmentPresentation(raw), { draft, files: [
        { path: paths[0], name: '实验二.doc' }, { path: paths[1], name: 'quote "example".pptx' },
      ] });
      assert.ok(raw.includes('Word/PPT'));
    }
  }
});
test('ordinary prose, incomplete blocks and unmatched filenames stay visible', () => {
  const raw = fileReferenceMessage('Read this', ['C:\\local\\a.doc'], 'en');
  for (const text of ['hello a.doc', raw + '\nMore prose', raw.slice(0, -1), raw.replace('("a.doc")', '("b.doc")'),
    raw.replace('"C:\\\\local\\\\a.doc"', '"relative/a.doc"'), '```\n' + raw + '\n```'])
    assert.equal(attachmentPresentation(text), undefined);
});
