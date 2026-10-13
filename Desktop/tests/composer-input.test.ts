import test from 'node:test';
import assert from 'node:assert/strict';
import { EditorState, TextSelection } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import { composerDocument, composerSchema, composerSelection, composerValueSync, isComposerInputChange, selectComposer } from '../src/composer-input';
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
test('controlled draft synchronization never emits a user edit but subsequent edits do', () => {
  let state = EditorState.create({ schema: composerSchema, doc: composerDocument('current draft') });
  const sync = state.tr.insertText('target draft', 1, state.doc.textContent.length + 1)
    .setMeta(composerValueSync, true).setMeta('addToHistory', false);
  assert.equal(sync.docChanged, true);
  assert.equal(isComposerInputChange(sync), false);
  state = state.apply(sync);
  assert.equal(state.doc.textContent, 'target draft');
  assert.equal(isComposerInputChange(state.tr.setSelection(TextSelection.create(state.doc, 2))), false);
  const edit = state.tr.insertText('!', state.doc.textContent.length + 1);
  assert.equal(isComposerInputChange(edit), true);
  assert.equal(edit.doc.textContent, 'target draft!');
});
