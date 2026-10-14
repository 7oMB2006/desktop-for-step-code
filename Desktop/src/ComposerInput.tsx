import { useContext, useLayoutEffect, useMemo, useRef, type ClipboardEvent, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { EditorState } from 'prosemirror-state';
import { Decoration, DecorationSet, EditorView } from 'prosemirror-view';
import { history, redo, undo } from 'prosemirror-history';
import { keymap } from 'prosemirror-keymap';
import { selectAll } from 'prosemirror-commands';
import { CommandCatalog, CommandReference, commandReference } from './CommandReference';
import { MessageLink } from './MessageLink';
import { composerLinkRanges } from './composer-links';
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
    const command = commandReference(props.value, commands);
    if (command) {
      const element = document.createElement('span');
      element.className = 'composer-inline-command-icon';
      element.contentEditable = 'false';
      element.setAttribute('aria-hidden', 'true');
      portals.push({ element, content: <CommandReference {...command}/>, key: `command:${command.name}:${command.source}` });
      items.push(Decoration.widget(1, element, { side: -1, ignoreSelection: true }),
        Decoration.inline(1, 2, { class: 'composer-command-slash' }),
        Decoration.inline(2, command.length + 1, { class: 'composer-command-name' }));
    }
    return { items, portals };
  }, [props.value, props.language, commands]);

  useLayoutEffect(() => {
    const element = root.current!;
    const editor = new EditorView({ mount: element }, {
      attributes: { spellcheck: 'false' },
      state: EditorState.create({ schema: composerSchema, doc: composerDocument(latest.current.value),
        plugins: [history(), keymap({
          'Mod-z': undo, 'Shift-Mod-z': redo, 'Mod-y': redo, 'Mod-a': selectAll,
          'Shift-Enter': (state, dispatch) => { dispatch?.(state.tr.insertText('\n').scrollIntoView()); return true; },
        })] }),
      editable: () => !latest.current.disabled,
      dispatchTransaction(transaction) {
        editor.updateState(editor.state.apply(transaction));
        if (isComposerInputChange(transaction)) latest.current.onChange(editor.state.doc.textContent);
        if (transaction.selectionSet) element.dispatchEvent(new Event('select', { bubbles: true }));
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
      selectionStart: { configurable: true, get: () => composerSelection(editor.state).start },
      selectionEnd: { configurable: true, get: () => composerSelection(editor.state).end },
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
    const set = DecorationSet.create(document, decorations.items);
    editor.setProps({ editable: () => !latest.current.disabled,
      decorations: state => state.doc === document ? set : DecorationSet.empty });
  }, [props.value, props.disabled, decorations]);

  return <>
    <div ref={root} className="composer-input" role="textbox" aria-multiline="true" aria-label={props.label}
      aria-disabled={props.disabled} data-placeholder={props.placeholder} data-empty={!props.value}
      onPasteCapture={props.onPaste} onKeyDownCapture={event => {
        if (event.target === event.currentTarget) props.onKeyDown(event);
      }}/>
    {decorations.portals.map(item => createPortal(item.content, item.element, item.key))}
  </>;
}
