import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { Check, PencilLine, Pin, Trash2, X } from 'lucide-react';
import { MAX_ANNOTATION_LENGTH, type ChatQuote } from './chat-quotes';

// Reconstruct only verified selections. Never attach a note to a guessed occurrence.
function sourceRange(root: HTMLElement, quote: ChatQuote) {
  const message = root.querySelector(`[data-message-index="${quote.messageIndex}"]`);
  const blocks = message?.querySelectorAll('.response-text, .user > .message-body');
  const block = blocks?.[quote.blockIndex ?? 0];
  if (!block) return null;
  const text = block.textContent ?? '';
  let startOffset = quote.startOffset;
  let endOffset = quote.endOffset;
  const expected = quote.sourceText ?? quote.text;
  if (text.slice(startOffset, endOffset).trim() !== expected.trim()) {
    // Native Selection inserts paragraph breaks that Range text does not contain.
    // Recover legacy preview drafts only when the visible excerpt occurs once.
    const positions: number[] = [];
    let normalized = '';
    for (let index = 0; index < text.length; index++) {
      if (!/\s/.test(text[index])) { positions.push(index); normalized += text[index]; }
    }
    const needle = expected.replace(/\s/g, '');
    const start = normalized.indexOf(needle);
    if (!needle || start < 0 || normalized.indexOf(needle, start + 1) >= 0) return null;
    startOffset = positions[start];
    endOffset = positions[start + needle.length - 1] + 1;
  }
  const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  let offset = 0;
  let started = false;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const end = offset + (node.textContent?.length ?? 0);
    if (!started && startOffset >= offset && startOffset < end) {
      range.setStart(node, startOffset - offset);
      started = true;
    }
    if (started && endOffset <= end) {
      range.setEnd(node, endOffset - offset);
      return range;
    }
    offset = end;
  }
  return null;
}

type Marker = { id: string; index: number; left: number; top: number };

export function QuoteAnnotations({ root, quotes: allQuotes, language, scope, annotate, remove, focusedId }: {
  root: RefObject<HTMLDivElement | null>; quotes: ChatQuote[]; language: 'zh' | 'en'; scope: string;
  annotate: (id: string, text: string) => void;
  remove: (id: string) => void;
  focusedId?: string | null;
}) {
  const zh = language === 'zh';
  const quotes = useMemo(() => allQuotes.filter(quote => quote.annotation !== undefined), [allQuotes]);
  const id = useId();
  const panel = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const focusRequested = useRef(false);
  const [markers, setMarkers] = useState<Marker[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [pinned, setPinned] = useState(false);
  const [editing, setEditing] = useState(false);
  const rangesRef = useRef(new Map<string, Range>());
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  const quote = quotes.find(item => item.id === active);
  const marker = markers.find(item => item.id === active);
  const close = useCallback((restoreFocus = false) => {
    if (restoreFocus && panel.current?.contains(document.activeElement)) trigger.current?.focus({ preventScroll: true });
    panel.current?.hidePopover();
    setActive(null); setPinned(false); setEditing(false);
    trigger.current = null; focusRequested.current = false;
  }, []);
  useEffect(() => { panel.current?.hidePopover(); setActive(null); setPinned(false); setEditing(false); }, [scope]);
  useLayoutEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      const host = root.current;
      const viewport = host?.closest('.conversation')?.getBoundingClientRect();
      if (!host || !viewport) { setMarkers([]); return; }
      const ranges: Range[] = [];
      const focused: Range[] = [];
      rangesRef.current.clear();
      const next: Marker[] = [];
      quotes.forEach((item, index) => {
        if (!item.annotation?.trim() && active !== item.id) return;
        const range = sourceRange(host, item);
        if (!range) return;
        ranges.push(range);
        rangesRef.current.set(item.id, range);
        if (item.id === (focusedId ?? active)) focused.push(range);
        const rect = [...range.getClientRects()].filter(box => box.width > 0 && box.height > 0
          && box.top >= viewport.top + 14 && box.bottom <= viewport.bottom).at(-1);
        if (!rect) return;
        let left = Math.max(viewport.left + 4, Math.min(rect.right + 2, viewport.right - 25, innerWidth - 25));
        let top = rect.top - 12;
        while (next.some(other => Math.abs(other.top - top) < 17 && Math.abs(other.left - left) < 22)) {
          if (left + 44 < Math.min(viewport.right, innerWidth)) left += 22;
          else top -= 18;
        }
        if (top < viewport.top) return;
        next.push({ id: item.id, index, left, top });
      });
      if ('highlights' in CSS) {
        CSS.highlights.set('quote-annotation-marks', new Highlight(...ranges));
        const highlight = new Highlight(...focused);
        highlight.priority = 1;
        CSS.highlights.set('quote-annotation-focus', highlight);
      }
      setMarkers(current => JSON.stringify(current) === JSON.stringify(next) ? current : next);
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(update); };
    update();
    const resize = new ResizeObserver(schedule);
    const mutation = new MutationObserver(schedule);
    if (root.current) {
      resize.observe(root.current);
      mutation.observe(root.current, { childList: true, characterData: true, subtree: true });
    }
    document.addEventListener('scroll', schedule, true);
    window.addEventListener('resize', schedule);
    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect(); mutation.disconnect();
      document.removeEventListener('scroll', schedule, true);
      window.removeEventListener('resize', schedule);
      if ('highlights' in CSS) {
        CSS.highlights.delete('quote-annotation-marks');
        CSS.highlights.delete('quote-annotation-focus');
      }
    };
  }, [root, quotes, scope, active, focusedId]);
  useEffect(() => {
    let openTimer: ReturnType<typeof setTimeout> | undefined;
    let closeTimer: ReturnType<typeof setTimeout> | undefined;
    let pending: string | null = null;
    const cancelClose = () => { clearTimeout(closeTimer); closeTimer = undefined; };
    const hit = (x: number, y: number) => {
      const viewport = root.current?.closest('.conversation')?.getBoundingClientRect();
      if (!viewport || x < viewport.left || x > viewport.right || y < viewport.top || y > viewport.bottom) return null;
      return [...rangesRef.current.entries()]
        .filter(([, range]) => [...range.getClientRects()].some(rect => x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom))
        .sort((a, b) => a[1].toString().length - b[1].toString().length)[0]?.[0] ?? null;
    };
    const move = (event: PointerEvent) => {
      if (event.pointerType !== 'mouse' || pinned || editing) return;
      if (event.buttons || window.getSelection()?.isCollapsed === false) {
        clearTimeout(openTimer); pending = null; return;
      }
      if (panel.current?.contains(event.target as Node)) { cancelClose(); return; }
      const found = hit(event.clientX, event.clientY);
      if (found) {
        cancelClose();
        if (found === active || found === pending) return;
        clearTimeout(openTimer);
        pending = found;
        openTimer = setTimeout(() => {
          pending = null;
          if (window.getSelection()?.isCollapsed !== false) { setActive(found); setEditing(false); }
        }, 400);
        return;
      }
      clearTimeout(openTimer); pending = null;
      // Keep a travel corridor from the marked fragment to its floating note.
      const text = active ? rangesRef.current.get(active)?.getBoundingClientRect() : null;
      const box = panel.current?.getBoundingClientRect();
      if (text && box && event.clientX >= Math.min(text.left, box.left) - 6 && event.clientX <= Math.max(text.right, box.right) + 6
        && event.clientY >= Math.min(text.top, box.top) - 6 && event.clientY <= Math.max(text.bottom, box.bottom) + 6) { cancelClose(); return; }
      if (active && !closeTimer) closeTimer = setTimeout(() => close(), 250);
    };
    const down = (event: PointerEvent) => {
      clearTimeout(openTimer); pending = null;
      if (!pinned && !editing && !panel.current?.contains(event.target as Node)) close();
    };
    const click = (event: MouseEvent) => {
      if ((panel.current && event.composedPath().includes(panel.current)) || (event.target as Element)?.closest?.('.annotation-footnote')) return;
      if (window.getSelection()?.isCollapsed === false) return;
      const found = hit(event.clientX, event.clientY);
      clearTimeout(openTimer); clearTimeout(closeTimer);
      if (found) { setActive(found); setPinned(true); setEditing(false); }
      else close();
    };
    const key = (event: KeyboardEvent) => {
      if (event.isComposing || event.keyCode === 229) return;
      if (event.key === 'Escape') close(true);
    };
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerdown', down);
    document.addEventListener('click', click);
    document.addEventListener('keydown', key);
    return () => {
      clearTimeout(openTimer); clearTimeout(closeTimer);
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerdown', down);
      document.removeEventListener('click', click);
      document.removeEventListener('keydown', key);
    };
  }, [root, active, pinned, editing, quotes, close]);
  useLayoutEffect(() => {
    if (!marker || !quote) { panel.current?.hidePopover(); setPosition(null); return; }
    const element = panel.current;
    if (!element) return;
    if (!element.matches(':popover-open')) element.showPopover();
    const place = () => {
      const box = element.getBoundingClientRect();
      const viewport = root.current?.closest('.conversation')?.getBoundingClientRect();
      const visible = [...(rangesRef.current.get(quote.id)?.getClientRects() ?? [])].filter(rect =>
        rect.width > 0 && rect.height > 0 && (!viewport || (rect.bottom > viewport.top && rect.top < viewport.bottom)));
      const text = visible.length ? {
        left: Math.min(...visible.map(rect => rect.left)),
        top: Math.max(viewport?.top ?? 0, visible[0].top),
        bottom: Math.min(viewport?.bottom ?? innerHeight, visible.at(-1)!.bottom),
      } : null;
      const left = Math.max(12, Math.min(text?.left ?? marker.left, innerWidth - box.width - 12));
      const below = text ? text.bottom + 10 : marker.top + 38;
      const top = below + box.height < innerHeight - 12
        ? below : Math.max(12, (text?.top ?? marker.top) - box.height - 8);
      setPosition({ left, top });
    };
    place();
    const resize = new ResizeObserver(place);
    resize.observe(element);
    return () => resize.disconnect();
  }, [marker, quote?.id, pinned, root]);
  useLayoutEffect(() => {
    if (!position || !focusRequested.current) return;
    focusRequested.current = false;
    panel.current?.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true });
  }, [position, active, pinned]);
  return createPortal(<>
    {markers.filter(item => quotes[item.index]?.id === item.id).map(item => <button key={item.id} type="button" className="annotation-footnote"
      style={{ left: item.left, top: item.top }} aria-label={zh ? `查看批注 ${item.index + 1}` : `View annotation ${item.index + 1}`}
      aria-expanded={active === item.id && !!position} aria-controls={id}
      onClick={event => {
        if (active === item.id && pinned && panel.current?.matches(':popover-open')) {
          close(true);
        } else {
          trigger.current = event.currentTarget; focusRequested.current = event.detail === 0;
          setActive(item.id); setPinned(true); setEditing(false);
        }
      }}>[{item.index + 1}]</button>)}
    <div ref={panel} id={id} popover="manual" className="annotation-footnote-panel" role="dialog"
      aria-label={zh ? '正文批注' : 'Inline annotation'}
      style={{ left: position?.left ?? 0, top: position?.top ?? 0, visibility: position ? 'visible' : 'hidden' }}
      onToggle={event => { if (!event.currentTarget.matches(':popover-open')) { setActive(null); setPinned(false); setEditing(false); } }}>
      {quote && <><header><span>{zh ? `批注 ${(marker?.index ?? 0) + 1}` : `Annotation ${(marker?.index ?? 0) + 1}`}{pinned && <Pin size={12}/>}</span>
        <div className="annotation-actions">
        {!editing && <button type="button" className="icon-button" aria-label={zh ? '编辑批注' : 'Edit annotation'}
          title={zh ? '编辑批注' : 'Edit annotation'} onClick={() => { setEditing(true); setPinned(true); }}><PencilLine size={15}/></button>}
        {!editing && <button type="button" className="icon-button" aria-label={zh ? '移除批注' : 'Remove annotation'}
          title={zh ? '移除批注' : 'Remove annotation'}
          onClick={() => { close(); remove(quote.id); }}><Trash2 size={15}/></button>}
        <button type="button" className="icon-button" aria-label={zh ? '关闭批注' : 'Close annotation'} onClick={() => close(true)}><X size={15}/></button></div></header>
        {editing ? <><textarea autoFocus rows={3} maxLength={MAX_ANNOTATION_LENGTH} aria-label={zh ? '编辑正文批注' : 'Edit inline annotation'}
          value={quote.annotation ?? ''} onChange={event => annotate(quote.id, event.target.value)}/>
        <footer><button type="button" className="icon-button" aria-label={zh ? '完成编辑' : 'Finish editing'}
          title={zh ? '完成编辑' : 'Finish editing'} onClick={() => setEditing(false)}><Check size={16}/></button></footer></>
          : <div className="annotation-note-text">{quote.annotation}</div>}
      </>}
    </div>
  </>, document.body);
}
