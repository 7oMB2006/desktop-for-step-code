import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { X } from 'lucide-react';
import type { Message } from './contracts';
import { isUserMessage } from './user-message';
import { scrollOverlayWheel } from './conversation-scroll';
import { afterConversationLayout } from './conversation-layout';

export type ConversationTurn = { index: number; preview: string; timestamp?: number };

export function turnTime(timestamp: number | undefined, language: 'zh' | 'en'): string {
  if (typeof timestamp !== 'number' || !Number.isFinite(timestamp)) return '';
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime())) return '';
  const pad = (value: number) => String(value).padStart(2, '0');
  const day = language === 'zh' ? `${pad(date.getMonth() + 1)}月${pad(date.getDate())}日` : `${pad(date.getMonth() + 1)}/${pad(date.getDate())}`;
  return `${day} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function conversationTurns(messages: Message[], language: 'zh' | 'en'): ConversationTurn[] {
  return messages.flatMap((message, index) => {
    if (!isUserMessage(message)) return [];
    const text = typeof message.content === 'string'
      ? message.content
      : message.content?.filter(part => part.type === 'text').map(part => part.text ?? '').join(' ') ?? '';
    return [{ index, preview: text.replace(/\s+/gu, ' ').trim() || (language === 'zh' ? '图片消息' : 'Image message'),
      ...(message.timestamp !== undefined ? { timestamp: message.timestamp } : {}) }];
  });
}

export function createConversationTurnsReader() {
  let previous: ConversationTurn[] = [];
  return (messages: Message[], language: 'zh' | 'en') => {
    const next = conversationTurns(messages, language);
    if (next.length === previous.length && next.every((turn, index) => {
      const saved = previous[index];
      return turn.index === saved.index && turn.preview === saved.preview && turn.timestamp === saved.timestamp;
    })) return previous;
    previous = next;
    return previous;
  };
}

export function scrollToTurn(scroll: HTMLDivElement | null, index: number) {
  afterConversationLayout(scroll, () => {
    const message = scroll?.querySelector<HTMLElement>(`[data-message-index="${index}"]`);
    if (!scroll || !message) return;
    const top = message.getBoundingClientRect().top - scroll.getBoundingClientRect().top + scroll.scrollTop;
    scroll.scrollTo({ top, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
  });
}

export function ConversationNavigationPanel({ open, replaced, overlay, turns, scrollRef, language, onClose, onSelect }: {
  open: boolean; replaced: boolean; overlay: boolean; turns: ConversationTurn[]; language: 'zh' | 'en';
  scrollRef: RefObject<HTMLDivElement | null>;
  onClose: () => void; onSelect: (index: number) => void;
}) {
  const [present, setPresent] = useState(open);
  const [readingIndex, setReadingIndex] = useState<number | null>(null);
  useLayoutEffect(() => {
    const scroll = scrollRef.current;
    if (!open || !scroll || !turns.length) { setReadingIndex(null); return; }
    let frame = 0;
    const elements = turns.map(turn => scroll.querySelector<HTMLElement>(`article[data-message-index="${turn.index}"]`));
    const measure = () => {
      setReadingIndex(turns[Math.floor(measureTurnCursor(scroll, elements))]?.index ?? null);
    };
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(measure); };
    const observer = new ResizeObserver(schedule);
    observer.observe(scroll);
    const content = scroll.querySelector('.messages');
    if (content) observer.observe(content);
    scroll.addEventListener('scroll', schedule, { passive: true });
    schedule();
    return () => { cancelAnimationFrame(frame); observer.disconnect(); scroll.removeEventListener('scroll', schedule); };
  }, [open, scrollRef, turns]);
  if (open && !present) setPresent(true);
  useLayoutEffect(() => {
    if (!open && matchMedia('(prefers-reduced-motion: reduce)').matches) setPresent(false);
  }, [open]);
  useEffect(() => {
    if (open || !present) return;
    const timer = setTimeout(() => setPresent(false), 260);
    return () => clearTimeout(timer);
  }, [open, present]);
  if (!present) return null;
  const zh = language === 'zh';
  return <div className={`conversation-nav-track${open ? ' is-open' : ''}${overlay ? ' is-overlay' : ''}${replaced ? ' is-replaced' : ''}`}>
    <aside className={`conversation-nav-panel${open ? '' : ' is-closing'}`} id="conversation-navigation-panel"
      aria-label={zh ? '会话导航' : 'Conversation navigation'} aria-hidden={!open} inert={!open}>
      <header className="right-panel-header"><h2>{zh ? '会话导航' : 'Conversation navigation'}</h2>
        <span className="nav-turn-count">{turns.length} {zh ? '轮' : 'turns'}</span>
        <button type="button" className="icon-button" aria-label={zh ? '关闭侧栏' : 'Close panel'}
          data-tooltip={zh ? '关闭侧栏' : 'Close panel'} onClick={onClose}><X size={16}/></button></header>
      <nav aria-label={zh ? '会话轮次' : 'Conversation turns'}>
        {turns.map((turn, number) => <button key={turn.index} type="button"
          aria-current={turn.index === readingIndex ? 'location' : undefined} onClick={() => onSelect(turn.index)}>
          <span className="nav-turn-number">{number + 1}</span><span className="nav-turn-content"><span className="nav-turn-preview">{turn.preview}</span>
            {turnTime(turn.timestamp, language) && <time className="nav-turn-time" dateTime={new Date(turn.timestamp!).toISOString()}>{turnTime(turn.timestamp, language)}</time>}
          </span>
        </button>)}
        {!turns.length && <p className="panel-empty">{zh ? '暂无会话轮次' : 'No turns yet'}</p>}
      </nav>
    </aside>
  </div>;
}

export const RULER_STEP = 18;

export function readingTurn(positions: { index: number; top: number }[], position: number): number | null {
  if (!positions.length) return null;
  let current = positions[0].index;
  for (const entry of positions) {
    if (entry.top > position) break;
    current = entry.index;
  }
  return current;
}

export function rulerOpacity(distance: number): number {
  return Math.max(0, Math.min(1, (14 - distance) / 11));
}

export function turnCursor(offsets: number[], position: number): number {
  return turnCursorFrom(offsets.length, index => offsets[index], position);
}

export function turnCursorFrom(count: number, offset: (index: number) => number, position: number): number {
  if (count < 2 || position <= offset(0)) return 0;
  let low = 0, high = count - 1;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (offset(middle) <= position) low = middle;
    else high = middle - 1;
  }
  if (low === count - 1) return low;
  const start = offset(low);
  return low + (position - start) / Math.max(1, offset(low + 1) - start);
}

function measureTurnCursor(scroll: HTMLElement, elements: (HTMLElement | null)[]): number {
  const top = scroll.getBoundingClientRect().top;
  const scrollTop = scroll.scrollTop;
  const offsets = new Map<number, number>();
  // Only the turns around the reading position need geometry, even after reflow.
  return turnCursorFrom(elements.length, index => {
    if (!offsets.has(index)) offsets.set(index, elements[index] ? elements[index]!.getBoundingClientRect().top - top + scrollTop : 0);
    return offsets.get(index)!;
  }, scrollTop + 48);
}

export function ConversationMarkers({ scrollRef, turns, language, onNavigate }: {
  scrollRef: RefObject<HTMLDivElement | null>; turns: ConversationTurn[]; language: 'zh' | 'en';
  onNavigate?: () => void;
}) {
  const [ruler, setRuler] = useState({ cursor: 0, height: 0 });
  const [hovered, setHovered] = useState<number | null>(null);
  const layerRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const scroll = scrollRef.current, layer = layerRef.current;
    if (!scroll || !layer) return;
    const wheel = (event: WheelEvent) => { scrollOverlayWheel(scroll, event); };
    layer.addEventListener('wheel', wheel, { passive: false });
    return () => layer.removeEventListener('wheel', wheel);
  }, [scrollRef]);

  useLayoutEffect(() => {
    const scroll = scrollRef.current;
    if (!scroll || !turns.length) { setRuler({ cursor: 0, height: 0 }); return; }
    let frame = 0;
    const elements = turns.map(turn => scroll.querySelector<HTMLElement>(`article[data-message-index="${turn.index}"]`));
    const update = () => {
      const cursor = measureTurnCursor(scroll, elements), height = scroll.clientHeight;
      setRuler(previous => previous.cursor === cursor && previous.height === height ? previous : { cursor, height });
    };
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        update();
      });
    };
    const observer = new ResizeObserver(measure);
    observer.observe(scroll);
    const content = scroll.querySelector('.messages');
    if (content) observer.observe(content);
    const onScroll = () => { setHovered(null); measure(); };
    scroll.addEventListener('scroll', onScroll, { passive: true });
    measure();
    return () => { cancelAnimationFrame(frame); observer.disconnect(); scroll.removeEventListener('scroll', onScroll); };
  }, [scrollRef, turns]);

  const selected = turns.find(turn => turn.index === hovered);
  const markerTop = (number: number) => ruler.height / 2 + (number - ruler.cursor) * RULER_STEP;
  const selectedNumber = turns.findIndex(turn => turn.index === hovered);
  const top = markerTop(selectedNumber);
  const visible = turns.map((turn, number) => ({ turn, number, top: markerTop(number) }))
    .filter(marker => marker.top > -16 && marker.top < ruler.height + 16 && Math.abs(marker.number - ruler.cursor) < 14);
  return <div ref={layerRef} className="turn-marker-layer">
    <div className="turn-marker-ruler">
      {visible.map(({ turn, number, top }) => <button key={turn.index} type="button"
        className={`turn-marker${number === Math.floor(ruler.cursor) ? ' active' : ''}`}
        aria-current={number === Math.floor(ruler.cursor) ? 'location' : undefined}
        style={{ top, opacity: rulerOpacity(Math.abs(number - ruler.cursor)) }}
        aria-label={`${language === 'zh' ? '跳到会话' : 'Go to turn'}: ${turn.preview.slice(0, 80)}`}
        onPointerEnter={() => setHovered(turn.index)} onPointerLeave={() => setHovered(null)}
        onFocus={() => setHovered(turn.index)} onBlur={() => setHovered(null)}
        onClick={() => { onNavigate?.(); scrollToTurn(scrollRef.current, turn.index); }}><span/></button>)}
    </div>
    {selected && <div className="turn-marker-preview" style={{ top: `clamp(8px, ${top - 28}px, calc(100% - 104px))` }}>
      <strong>{selected.preview.slice(0, 70)}</strong>
      {turnTime(selected.timestamp, language) && <time className="nav-turn-time"
        dateTime={new Date(selected.timestamp!).toISOString()}>{turnTime(selected.timestamp, language)}</time>}
    </div>}
  </div>;
}
