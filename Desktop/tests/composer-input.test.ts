import test from 'node:test';
import assert from 'node:assert/strict';
import { EditorState } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import { composerDocument, composerSchema, composerSelection, selectComposer } from '../src/composer-input';
import { composerLinkRanges } from '../src/composer-links';

test('plain composer documents preserve newlines, spaces, Markdown and Unicode without decoration bytes', () => {
  for (const value of ['', '\n', '  开头\n\n结尾  ', '/clm-compact 保留链接 https://example.com/?a=1&b=2\n`代码` 🧪']) {
    const document = composerDocument(value);
    assert.equal(document.textContent, value);
    assert.equal(composerSchema.nodeFromJSON(document.toJSON()).textContent, value);
    assert.equal(document.childCount, 1);
  }
});
test('inline decorations retain each occurrence and exact offsets including repeated links after Unicode', () => {
  const draft = '🧪中文 https://example.com/a\n第二次 https://example.com/a `https://example.com/code`';
  const ranges = composerLinkRanges(draft);
  assert.equal(ranges.length, 2);
  for (const range of ranges) assert.equal(draft.slice(range.from, range.to), 'https://example.com/a');
});
test('composer selection uses bounded canonical UTF-16 offsets, not icon DOM text', () => {
  let state = EditorState.create({ schema: composerSchema, doc: composerDocument('中文 https://example.com/ 尾部') });
  const view = { get state() { return state; }, dispatch: (transaction: Parameters<EditorView['dispatch']>[0]) => { state = state.apply(transaction); } } as EditorView;
  selectComposer(view, 3, 23, 'backward');
  assert.deepEqual(composerSelection(state), { start: 3, end: 23 });
  assert.equal(state.selection.anchor, 24);
  selectComposer(view, -3, 1000);
  assert.deepEqual(composerSelection(state), { start: 0, end: state.doc.textContent.length });
});
