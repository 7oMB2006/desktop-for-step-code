import { Schema } from 'prosemirror-model';
import { TextSelection, type EditorState, type Transaction } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';

// A single text block preserves the plain prompt exactly; icons are view-only.
export const composerSchema = new Schema({
  nodes: {
    doc: { content: 'textblock' },
    textblock: { content: 'text*', code: true, whitespace: 'pre',
      parseDOM: [{ tag: 'pre', preserveWhitespace: 'full' }],
      toDOM: () => ['pre', { class: 'composer-text' }, 0] },
    text: {},
  },
});
export function composerDocument(text: string) {
  return composerSchema.node('doc', null, composerSchema.node('textblock', null, text ? composerSchema.text(text) : undefined));
}
export const composerValueSync = 'composerValueSync';
export function isComposerInputChange(transaction: Transaction) {
  return transaction.docChanged && !transaction.getMeta(composerValueSync);
}
export function composerSelection(state: EditorState) {
  return { start: state.selection.from - 1, end: state.selection.to - 1 };
}
export function selectComposer(view: EditorView, start: number, end = start, direction = 'forward') {
  const size = view.state.doc.textContent.length;
  const from = Math.max(0, Math.min(size, start)) + 1;
  const to = Math.max(0, Math.min(size, end)) + 1;
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc,
    direction === 'backward' ? to : from, direction === 'backward' ? from : to)));
}
export interface ComposerInputElement extends HTMLDivElement {
  readonly value: string;
  readonly selectionStart: number;
  readonly selectionEnd: number;
  readonly disabled: boolean;
  setSelectionRange(start: number, end: number, direction?: string): void;
}
export function composerInput(root: ParentNode = document) {
  return root.querySelector<ComposerInputElement>('.composer-input');
}
