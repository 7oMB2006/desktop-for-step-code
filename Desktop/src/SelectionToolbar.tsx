import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { createPortal } from 'react-dom';
import { Check, Copy } from 'lucide-react';
import { fencedSelection, MAX_QUOTE_LENGTH, type ChatQuote } from './chat-quotes';
import { selectionMarkdown } from './selection-markdown';

type Selected = { quote: ChatQuote; range: Range };
type Props = {
  root: RefObject<HTMLDivElement | null>;
  scope: string;
  language: 'zh' | 'en';
  enabled: boolean;
  onQuote: (quote: ChatQuote) => boolean;
  onError: (message: string) => void;
};

function closest(node: Node, selector: string) {
  return (node instanceof Element ? node : node.parentElement)?.closest<HTMLElement>(selector);
}

function capture(root: HTMLElement): Selected | null {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount !== 1) return null;
  const range = selection.getRangeAt(0);
  const article = closest(range.startContainer, '.message');
  if (!article || !root.contains(article) || closest(range.endContainer, '.message') !== article) return null;
  // Only message prose is quotable; exclude thinking, controls and tool payloads.
  const blocks = [...article.querySelectorAll<HTMLElement>('.response-text, .user > .message-body')];
  const first = blocks.find(block => block.contains(range.startContainer));
  const last = blocks.find(block => block.contains(range.endContainer));
  if (!first || first !== last) return null;
  const fragment = range.cloneContents();
  if (closest(range.startContainer, '.code-header') || closest(range.endContainer, '.code-header')
    || fragment.querySelector('.process-tool, .thinking, .message-actions')) return null;
  const text = selection.toString().trim();
  if (!text || text.length > MAX_QUOTE_LENGTH) return null;
  const index = Number(closest(range.startContainer, '[data-message-index]')?.dataset.messageIndex);
  if (!Number.isInteger(index)) return null;
  const prefix = range.cloneRange();
  prefix.selectNodeContents(first);
  prefix.setEnd(range.startContainer, range.startOffset);
  const code = closest(range.startContainer, 'pre code');
  const inCode = code && code === closest(range.endContainer, 'pre code');
  const language = inCode ? /language-([\w+#.-]+)/.exec(code.className)?.[1] ?? '' : '';
  const startOffset = prefix.toString().length;
  return {
    range: range.cloneRange(),
    quote: {
      id: crypto.randomUUID(), messageIndex: index,
      role: article.classList.contains('user') ? 'user' : 'assistant',
      text, markdown: inCode ? fencedSelection(selection.toString(), language) : selectionMarkdown(fragment, text),
      startOffset, endOffset: startOffset + selection.toString().length,
    },
  };
}

export function SelectionToolbar({ root, scope, language, enabled, onQuote, onError }: Props) {
  const [selected, setSelected] = useState<Selected | null>(null);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  const [copied, setCopied] = useState(false);
  const menu = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const zh = language === 'zh';

  useEffect(() => { setSelected(null); setPosition(null); }, [scope, enabled]);
  useEffect(() => {
    const update = () => {
      if (dragging.current || menu.current?.contains(document.activeElement)) return;
      const next = root.current && enabled ? capture(root.current) : null;
      setSelected(next);
      setCopied(false);
    };
    const down = (event: PointerEvent) => {
      if (menu.current?.contains(event.target as Node)) return;
      dragging.current = event.button === 0;
      setSelected(null);
    };
    const up = () => { dragging.current = false; update(); };
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setSelected(null); window.getSelection()?.removeAllRanges(); }
    };
    const blur = () => { dragging.current = false; setSelected(null); };
    document.addEventListener('selectionchange', update);
    document.addEventListener('pointerdown', down);
    document.addEventListener('pointerup', up);
    document.addEventListener('keydown', key);
    window.addEventListener('blur', blur);
    return () => {
      document.removeEventListener('selectionchange', update);
      document.removeEventListener('pointerdown', down);
      document.removeEventListener('pointerup', up);
      document.removeEventListener('keydown', key);
      window.removeEventListener('blur', blur);
    };
  }, [root, enabled]);
  useEffect(() => () => clearTimeout(copyTimer.current), []);

  useLayoutEffect(() => {
    if (!selected) { setPosition(null); return; }
    const place = () => {
      const viewport = root.current?.closest('.conversation')?.getBoundingClientRect();
      const box = menu.current?.getBoundingClientRect();
      if (!viewport || !box || !selected.range.startContainer.isConnected) { setPosition(null); return; }
      const rects = [...selected.range.getClientRects()].filter(rect =>
        rect.width > 0 && rect.bottom > viewport.top && rect.top < viewport.bottom);
      if (!rects.length) { setPosition(null); return; }
      const rect = rects[0];
      const minLeft = Math.max(8, viewport.left + 8);
      const maxLeft = Math.min(innerWidth - 8, viewport.right - 8) - box.width;
      const left = Math.max(minLeft, Math.min(maxLeft, rect.left + Math.min(rect.width, 260) / 2 - box.width / 2));
      const above = rect.top - box.height - 9;
      const top = above >= viewport.top + 8 ? above : Math.min(viewport.bottom - box.height - 8, rect.bottom + 9);
      setPosition({ left, top });
    };
    place();
    document.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    const observer = new ResizeObserver(place);
    if (root.current) observer.observe(root.current);
    return () => {
      document.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
      observer.disconnect();
    };
  }, [selected, root, language]);

  const add = () => {
    if (!selected || !onQuote(selected.quote)) return;
    setSelected(null);
    window.getSelection()?.removeAllRanges();
    document.querySelector<HTMLTextAreaElement>('.composer > textarea')?.focus({ preventScroll: true });
  };
  const copy = async () => {
    if (!selected) return;
    try {
      await window.desktop!.copyText(selected.quote.text);
      setCopied(true);
      clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopied(false), 1500);
    } catch (error) { setCopied(false); onError(String(error instanceof Error ? error.message : error)); }
  };
  return createPortal(selected && enabled ? <div ref={menu} className="selection-toolbar" role="toolbar"
    aria-label={zh ? '选中文字' : 'Selected text'}
    style={{ left: position?.left ?? 0, top: position?.top ?? 0, visibility: position ? 'visible' : 'hidden' }}
    onMouseDown={event => event.preventDefault()}>
    <button type="button" onClick={add}>{zh ? '引用' : 'Quote'}</button>
    <span className="selection-toolbar-divider"/>
    <button type="button" onClick={() => void copy()} aria-label={zh ? '复制选段' : 'Copy selection'}
      data-tooltip={zh ? '复制选段' : 'Copy selection'}>{copied ? <Check size={15}/> : <Copy size={15}/>}</button>
  </div> : null, document.body);
}
