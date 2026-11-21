import { useContext, useLayoutEffect, useMemo, useRef, useState, type ClipboardEvent, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { EditorState } from 'prosemirror-state';
import { Decoration, DecorationSet, EditorView } from 'prosemirror-view';
import { history, redo, undo } from 'prosemirror-history';
import { keymap } from 'prosemirror-keymap';
import { deleteSelection, selectAll } from 'prosemirror-commands';
import { CommandCatalog, CommandReference } from './CommandReference';
import { commandRanges } from './command-references';
import { MessageLink } from './MessageLink';
import { composerLinkRanges, composerSessionReferences } from './composer-links';
import { SessionReferenceLabel, SessionReferenceTitles } from './SessionReferenceLabel';
import { composerDocument, composerSchema, composerSelection, composerValueSync, isComposerInputChange, selectComposer, type ComposerInputElement } from './composer-input';
import './composer-input.css';

interface Props {
  value: string; disabled: boolean; placeholder: string; label: string; language: 'zh' | 'en';
  onChange: (value: string) => void;
  onPaste: (event: ClipboardEvent<HTMLDivElement>) => void;
  onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
}
export function ComposerInput(props: Props) {
  const root = useRef<ComposerInputElement>(null);
  const view = useRef<EditorView | null>(null);
  const latest = useRef(props);
  latest.current = props;
  const commands = useContext(CommandCatalog);
  const sessionTitles = useContext(SessionReferenceTitles);
  const sessionLinks = useMemo(() => sessionTitles?.size
    ? composerSessionReferences(props.value).filter(link => sessionTitles.has(link.id)) : [], [props.value, sessionTitles]);
  const [editingReference, setEditingReference] = useState<number>();
  const references = useRef(sessionLinks);
  references.current = sessionLinks;
  const referenceDecorations = useMemo(() => sessionLinks.flatMap(link => {
    if (link.from === editingReference) return [];
    const element = document.createElement('span');
    element.className = 'composer-session-reference';
    element.contentEditable = 'false';
    return [{ element, link }];
  }), [editingReference, sessionLinks]);
  const updateReferenceSelection = (state: EditorState) => {
    const { start, end } = composerSelection(state);
    const link = references.current.find(link => (start > link.from && start < link.to)
      || (end > link.from && end < link.to));
    setEditingReference(link?.from);
  };
  const decorations = useMemo(() => {
    const items: Decoration[] = [];
    const portals: { element: HTMLSpanElement; content: React.ReactNode; key: string }[] = [];
    for (const link of composerLinkRanges(props.value)) {
      const element = document.createElement('span');
      element.className = 'composer-inline-link-icon';
      element.contentEditable = 'false';
      portals.push({ element, content: <MessageLink href={link.href} language={props.language}>{link.href}</MessageLink>,
        key: `link:${link.from}:${link.href}` });
      items.push(Decoration.widget(link.from + 1, element, { side: -1, ignoreSelection: true, stopEvent: () => true }),
        Decoration.inline(link.from + 1, link.to + 1, { class: 'composer-inline-link-text' }));
    }
    for (const command of commandRanges(props.value, commands)) {
      const element = document.createElement('span');
      element.className = 'composer-inline-command-icon';
      element.contentEditable = 'false';
      element.setAttribute('aria-hidden', 'true');
      portals.push({ element, content: <CommandReference {...command}/>, key: `command:${command.from}:${command.name}:${command.source}` });
      items.push(Decoration.widget(command.from + 1, element, { side: -1, ignoreSelection: true }),
        Decoration.inline(command.from + 1, command.from + 2, { class: 'composer-command-slash' }),
        Decoration.inline(command.from + 2, command.to + 1, { class: 'composer-command-name' }));
    }
    return { items, portals };
  }, [props.value, props.language, commands]);

  useLayoutEffect(() => {
    const element = root.current!;
    const removeReference = (direction: -1 | 1) => (state: EditorState, dispatch?: EditorView['dispatch']) => {
      if (!state.selection.empty) return false;
      const { start } = composerSelection(state);
      const link = references.current.find(link => start === (direction === -1 ? link.to : link.from));
      if (!link) return false;
      dispatch?.(state.tr.delete(link.from + 1, link.to + 1));
      return true;
    };
    const editor = new EditorView({ mount: element }, {
      attributes: { spellcheck: 'false' },
      state: EditorState.create({ schema: composerSchema, doc: composerDocument(latest.current.value),
        plugins: [history(), keymap({
          'Mod-z': undo, 'Shift-Mod-z': redo, 'Mod-y': redo, 'Mod-a': selectAll,
          'Backspace': (state, dispatch) => deleteSelection(state, dispatch) || removeReference(-1)(state, dispatch),
          'Shift-Backspace': deleteSelection, 'Mod-Backspace': deleteSelection,
          'Delete': (state, dispatch) => deleteSelection(state, dispatch) || removeReference(1)(state, dispatch),
          'Mod-Delete': deleteSelection,
          'Shift-Enter': (state, dispatch) => { dispatch?.(state.tr.insertText('\n').scrollIntoView()); return true; },
        })] }),
      editable: () => !latest.current.disabled,
      dispatchTransaction(transaction) {
        editor.updateState(editor.state.apply(transaction));
        if (isComposerInputChange(transaction)) latest.current.onChange(editor.state.doc.textContent);
        if (transaction.selectionSet) {
          if (references.current.length) updateReferenceSelection(editor.state);
          element.dispatchEvent(new Event('select', { bubbles: true }));
        }
      },
      handlePaste(editor, event) {
        if (event.clipboardData?.files.length) return true;
        const text = event.clipboardData?.getData('text/plain');
        if (text === undefined) return false;
        editor.dispatch(editor.state.tr.insertText(text.replace(/\r\n?/g, '\n')).scrollIntoView());
        return true;
      },
      handleDrop: (_editor, event) => Boolean(event.dataTransfer?.files.length),
      clipboardTextSerializer: slice => slice.content.textBetween(0, slice.content.size, ''),
    });
    view.current = editor;
    Object.defineProperties(element, {
      value: { configurable: true, get: () => editor.state.doc.textContent },
      // React restores selection through these properties after moving a focused editor.
      selectionStart: { configurable: true, get: () => composerSelection(editor.state).start,
        set: (start: number) => selectComposer(editor, start, Math.max(start, composerSelection(editor.state).end)) },
      selectionEnd: { configurable: true, get: () => composerSelection(editor.state).end,
        set: (end: number) => selectComposer(editor, Math.min(composerSelection(editor.state).start, end), end) },
      disabled: { configurable: true, get: () => latest.current.disabled },
      setSelectionRange: { configurable: true, value: (start: number, end: number, direction?: string) => selectComposer(editor, start, end, direction) },
    });
    return () => { view.current = null; editor.destroy(); };
  }, []);

  useLayoutEffect(() => {
    const editor = view.current;
    if (!editor) return;
    const current = editor.state.doc.textContent;
    if (current !== props.value && !editor.composing) {
      editor.dispatch(editor.state.tr.insertText(props.value, 1, current.length + 1)
        .setMeta(composerValueSync, true).setMeta('addToHistory', false));
    }
    const document = editor.state.doc;
    // ProseMirror consumes this array; loading-only renders reuse the memoized items.
    const set = DecorationSet.create(document, [...decorations.items, ...referenceDecorations.flatMap(({ element, link }) => [
      Decoration.widget(link.from + 1, element, { side: -1, ignoreSelection: true, stopEvent: () => true }),
      Decoration.inline(link.from + 1, link.to + 1, { class: 'composer-session-reference-source', 'aria-hidden': 'true' }),
    ])]);
    editor.setProps({ editable: () => !latest.current.disabled,
      decorations: state => state.doc === document ? set : DecorationSet.empty });
  }, [props.value, props.disabled, decorations, referenceDecorations]);

  return <>
    <div ref={root} className="composer-input" role="textbox" aria-multiline="true" aria-label={props.label}
      aria-disabled={props.disabled} data-placeholder={props.placeholder} data-empty={!props.value}
      onBlur={() => setEditingReference(undefined)}
      onPasteCapture={props.onPaste} onKeyDownCapture={event => {
        if (event.target === event.currentTarget) props.onKeyDown(event);
      }}/>
    {decorations.portals.map(item => createPortal(item.content, item.element, item.key))}
    {referenceDecorations.map(({ element, link }) => createPortal(<SessionReferenceLabel id={link.id}/>, element, `session:${link.from}:${link.id}`))}
  </>;
}
