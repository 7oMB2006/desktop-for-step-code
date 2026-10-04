import { useEffect, useLayoutEffect, useState, type RefObject } from 'react';
import { X } from 'lucide-react';
import type { Message } from './contracts';

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
    if (message.role !== 'user') return [];
    const text = typeof message.content === 'string'
      ? message.content
      : message.content?.filter(part => part.type === 'text').map(part => part.text ?? '').join(' ') ?? '';
    return [{ index, preview: text.replace(/\s+/gu, ' ').trim() || (language === 'zh' ? '图片消息' : 'Image message'),
      ...(message.timestamp !== undefined ? { timestamp: message.timestamp } : {}) }];
  });
}

export function scrollToTurn(scroll: HTMLDivElement | null, index: number) {
  const message = scroll?.querySelector<HTMLElement>(`[data-message-index="${index}"]`);
  if (!scroll || !message) return;
  const top = message.getBoundingClientRect().top - scroll.getBoundingClientRect().top + scroll.scrollTop;
  scroll.scrollTo({ top, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
}

export function ConversationNavigationPanel({ open, replaced, turns, language, onClose, onSelect }: {
  open: boolean; replaced: boolean; turns: ConversationTurn[]; language: 'zh' | 'en';
  onClose: () => void; onSelect: (index: number) => void;
}) {
  const [present, setPresent] = useState(open);
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
  return <div className={`conversation-nav-track${open ? ' is-open' : ''}${replaced ? ' is-replaced' : ''}`}>
    <aside className={`conversation-nav-panel${open ? '' : ' is-closing'}`} id="conversation-navigation-panel"
      aria-label={zh ? '会话导航' : 'Conversation navigation'} aria-hidden={!open} inert={!open}>
      <header><h2>{zh ? '会话导航' : 'Conversation navigation'}</h2>
        <button type="button" className="icon-button" aria-label={zh ? '关闭侧栏' : 'Close panel'}
          data-tooltip={zh ? '关闭侧栏' : 'Close panel'} onClick={onClose}><X size={16}/></button></header>
      <nav aria-label={zh ? '会话轮次' : 'Conversation turns'}>
        {turns.map((turn, number) => <button key={turn.index} onClick={() => onSelect(turn.index)}>
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

export function rulerOpacity(distance: number): number {
  return Math.max(0, Math.min(1, (14 - distance) / 11));
}

export function turnCursor(offsets: number[], position: number): number {
  if (offsets.length < 2 || position <= offsets[0]) return 0;
  for (let index = 1; index < offsets.length; index++) {
    if (position < offsets[index]) {
      return index - 1 + (position - offsets[index - 1]) / Math.max(1, offsets[index] - offsets[index - 1]);
    }
  }
  return offsets.length - 1;
}

export function ConversationMarkers({ scrollRef, turns, language }: {
  scrollRef: RefObject<HTMLDivElement | null>; turns: ConversationTurn[]; language: 'zh' | 'en';
}) {
  const [ruler, setRuler] = useState({ cursor: 0, height: 0 });
  const [hovered, setHovered] = useState<number | null>(null);

  useLayoutEffect(() => {
    const scroll = scrollRef.current;
    if (!scroll || !turns.length) { setRuler({ cursor: 0, height: 0 }); return; }
    let frame = 0;
    let offsets: number[] = [];
    const update = () => {
      const position = scroll.scrollTop + 48;
      setRuler({ cursor: turnCursor(offsets, position), height: scroll.clientHeight });
    };
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const container = scroll.getBoundingClientRect();
        offsets = turns.map(turn => {
          const element = scroll.querySelector<HTMLElement>(`[data-message-index="${turn.index}"]`);
          return element ? element.getBoundingClientRect().top - container.top + scroll.scrollTop : 0;
        });
        update();
      });
    };
    const observer = new ResizeObserver(measure);
    observer.observe(scroll);
    const content = scroll.querySelector('.messages');
    if (content) observer.observe(content);
    const onScroll = () => { setHovered(null); update(); };
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
  return <div className="turn-marker-layer">
    <div className="turn-marker-ruler">
      {visible.map(({ turn, number, top }) => <button key={turn.index} type="button"
        className={`turn-marker${number === Math.floor(ruler.cursor) ? ' active' : ''}`}
        style={{ top, opacity: rulerOpacity(Math.abs(number - ruler.cursor)) }}
        aria-label={`${language === 'zh' ? '跳到会话' : 'Go to turn'}: ${turn.preview.slice(0, 80)}`}
        onPointerEnter={() => setHovered(turn.index)} onPointerLeave={() => setHovered(null)}
        onFocus={() => setHovered(turn.index)} onBlur={() => setHovered(null)}
        onClick={() => scrollToTurn(scrollRef.current, turn.index)}><span/></button>)}
    </div>
    {selected && <div className="turn-marker-preview" style={{ top: `clamp(8px, ${top - 28}px, calc(100% - 104px))` }}>
      <strong>{selected.preview.slice(0, 70)}</strong>
    </div>}
  </div>;
}
