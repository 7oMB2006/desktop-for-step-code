import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import type { ChatQuote } from './chat-quotes';
import { ScrollThumb } from './ConversationScrollThumb';

function QuoteItem({ quote, index, language, remove, reveal }: {
  quote: ChatQuote; index: number; language: 'zh' | 'en';
  remove: () => void; reveal: () => void;
}) {
  const zh = language === 'zh';
  const scroll = useRef<HTMLDivElement>(null);
  const scrollId = useId();
  return <div className="composer-quote">
    <button type="button" className="quote-number" onClick={reveal}
      aria-label={zh ? `查看引用 ${index + 1} 的原文` : `Show source of quote ${index + 1}`}
      data-tooltip={zh ? '查看原文' : 'Show source'}>{index + 1}.</button>
    <div ref={scroll} id={scrollId} className="quote-excerpt" tabIndex={0}
      role="region" aria-label={zh ? `引用 ${index + 1}` : `Quote ${index + 1}`}>
      <div className="quote-excerpt-content">{quote.text}</div>
    </div>
    <div className="quote-controls">
      <button type="button" className="icon-button" aria-label={zh ? `移除引用 ${index + 1}` : `Remove quote ${index + 1}`}
        data-tooltip={zh ? '移除引用' : 'Remove quote'} onClick={remove}><X size={14}/></button>
      <ScrollThumb scrollRef={scroll} language={language} sessionId={quote.id} messageCount={quote.text.length}
        scrollId={scrollId} label={zh ? `引用 ${index + 1} 滚动` : `Scroll quote ${index + 1}`}
        className="quote-scroll-track" contentSelector=".quote-excerpt-content" compact/>
    </div>
  </div>;
}

export function QuotePreview({ quotes, language, remove, reveal, clear }: {
  quotes: ChatQuote[]; language: 'zh' | 'en';
  remove: (id: string) => void; reveal: (quote: ChatQuote) => void; clear: () => void;
}) {
  const zh = language === 'zh';
  const id = useId();
  const anchor = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  useEffect(() => { if (!quotes.length) { setOpen(false); setPosition(null); } }, [quotes.length]);
  useLayoutEffect(() => {
    if (!open) { setPosition(null); return; }
    const place = () => {
      const trigger = anchor.current?.getBoundingClientRect();
      const box = panel.current?.getBoundingClientRect();
      if (!trigger || !box) return;
      const titlebar = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--window-bar-height')) || 46;
      const left = Math.max(12, Math.min(trigger.left, innerWidth - box.width - 12));
      const above = trigger.top - box.height - 8;
      const top = above >= titlebar + 8 ? above
        : Math.max(titlebar + 8, Math.min(trigger.bottom + 8, innerHeight - box.height - 12));
      setPosition({ left, top });
    };
    place();
    const observer = new ResizeObserver(place);
    if (panel.current) observer.observe(panel.current);
    window.addEventListener('resize', place);
    document.addEventListener('scroll', place, true);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', place);
      document.removeEventListener('scroll', place, true);
    };
  }, [open]);
  if (!quotes.length) return null;
  return <><div className="composer-quotes" aria-label={zh ? '待发送引用' : 'Pending quotes'}>
    <div className="quote-chip">
      <button ref={anchor} type="button" popoverTarget={id} aria-expanded={open} aria-controls={id}
        aria-label={zh ? '查看引用' : 'View quotes'}>{zh ? `${quotes.length} 条引用` : `${quotes.length} ${quotes.length === 1 ? 'quote' : 'quotes'}`}</button>
      <button type="button" className="quote-clear" aria-label={zh ? '清空引用' : 'Clear quotes'}
        data-tooltip={zh ? '清空引用' : 'Clear quotes'} onClick={clear}><X size={13}/></button>
    </div>
  </div>{createPortal(<div id={id} ref={panel} popover="auto" className="quote-popover"
    role="dialog" aria-label={zh ? '引用预览' : 'Quote preview'}
    onToggle={event => setOpen(event.currentTarget.matches(':popover-open'))}
    style={{ left: position?.left ?? 0, top: position?.top ?? 0, visibility: position ? 'visible' : 'hidden' }}>
    {quotes.map((quote, index) => <QuoteItem key={quote.id} quote={quote} index={index} language={language}
      remove={() => remove(quote.id)} reveal={() => { panel.current?.hidePopover(); reveal(quote); }}/>)}
  </div>, document.body)}</>;
}
