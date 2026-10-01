import { useLayoutEffect, useRef, useState, type PointerEvent, type RefObject } from 'react';

type ScrollMetrics = { top: number; height: number; maxScroll: number };

export function thumbMetrics(scrollTop: number, clientHeight: number, scrollHeight: number, trackHeight: number, compact = false): ScrollMetrics {
  const maxScroll = Math.max(0, scrollHeight - clientHeight);
  if (!maxScroll || !trackHeight) return { top: 0, height: 0, maxScroll };
  const height = Math.min(trackHeight, Math.max(compact ? 20 : 44, Math.min(compact ? 44 : 72, trackHeight * clientHeight / scrollHeight)));
  return { top: (trackHeight - height) * scrollTop / maxScroll, height, maxScroll };
}

export function ScrollThumb({ scrollRef, language, sessionId, messageCount, scrollId = 'conversation-scroll',
  label, className = '', contentSelector = '.messages', compact = false }: {
  scrollRef: RefObject<HTMLDivElement | null>; language: 'zh' | 'en';
  sessionId?: string; messageCount: number;
  scrollId?: string; label?: string; className?: string; contentSelector?: string; compact?: boolean;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const dragOffset = useRef<number | null>(null);
  const [metrics, setMetrics] = useState<ScrollMetrics>({ top: 0, height: 0, maxScroll: 0 });

  useLayoutEffect(() => {
    const scroll = scrollRef.current;
    const track = trackRef.current;
    if (!scroll || !track) return;
    const update = () => setMetrics(thumbMetrics(scroll.scrollTop, scroll.clientHeight, scroll.scrollHeight, track.clientHeight, compact));
    const observer = new ResizeObserver(update);
    observer.observe(scroll);
    observer.observe(track);
    const content = scroll.querySelector(contentSelector);
    if (content) observer.observe(content);
    scroll.addEventListener('scroll', update, { passive: true });
    const wheel = (event: WheelEvent) => {
      if (!compact || scroll.scrollHeight <= scroll.clientHeight) return;
      event.preventDefault();
      scroll.scrollTop += event.deltaY * (event.deltaMode === 1 ? 20 : event.deltaMode === 2 ? scroll.clientHeight : 1);
    };
    track.addEventListener('wheel', wheel, { passive: false });
    update();
    return () => { observer.disconnect(); scroll.removeEventListener('scroll', update); track.removeEventListener('wheel', wheel); };
  }, [scrollRef, sessionId, messageCount, contentSelector, compact]);

  const setFromPointer = (clientY: number, offset: number) => {
    const scroll = scrollRef.current;
    const track = trackRef.current;
    if (!scroll || !track || !metrics.maxScroll) return;
    const travel = track.clientHeight - metrics.height;
    const top = Math.max(0, Math.min(travel, clientY - track.getBoundingClientRect().top - offset));
    scroll.scrollTop = travel ? top / travel * metrics.maxScroll : 0;
  };
  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (!metrics.maxScroll) return;
    const thumb = trackRef.current?.querySelector('.conversation-scroll-thumb');
    const overThumb = thumb?.contains(event.target as Node);
    dragOffset.current = overThumb ? event.clientY - thumb!.getBoundingClientRect().top : metrics.height / 2;
    event.currentTarget.setPointerCapture(event.pointerId);
    setFromPointer(event.clientY, dragOffset.current);
  };

  return <div ref={trackRef} className={`conversation-scroll-track ${className}${metrics.maxScroll ? '' : ' hidden'}`}
    role="scrollbar" aria-label={label ?? (language === 'zh' ? '会话滚动' : 'Conversation scroll')}
    aria-hidden={!metrics.maxScroll}
    aria-controls={scrollId} aria-orientation="vertical"
    aria-valuemin={0} aria-valuemax={100}
    aria-valuenow={metrics.maxScroll ? Math.round(scrollRef.current!.scrollTop / metrics.maxScroll * 100) : 0}
    tabIndex={metrics.maxScroll ? 0 : -1}
    onPointerDown={onPointerDown}
    onPointerMove={event => { if (dragOffset.current !== null) setFromPointer(event.clientY, dragOffset.current); }}
    onPointerUp={event => { dragOffset.current = null; event.currentTarget.releasePointerCapture(event.pointerId); }}
    onLostPointerCapture={() => { dragOffset.current = null; }}
    onKeyDown={event => {
      const scroll = scrollRef.current;
      if (!scroll) return;
      const delta = { ArrowUp: -48, ArrowDown: 48, PageUp: -scroll.clientHeight * .85, PageDown: scroll.clientHeight * .85 }[event.key];
      if (delta !== undefined) scroll.scrollTop += delta;
      else if (event.key === 'Home') scroll.scrollTop = 0;
      else if (event.key === 'End') scroll.scrollTop = metrics.maxScroll;
      else return;
      event.preventDefault();
    }}>
    {metrics.maxScroll > 0 && <span className="conversation-scroll-thumb" style={{ top: metrics.top, height: metrics.height }}/>}
  </div>;
}

export { ScrollThumb as ConversationScrollThumb };
