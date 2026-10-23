import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { PencilLine, X } from 'lucide-react';
import { MAX_ANNOTATION_LENGTH, type ChatQuote } from './chat-quotes';
import { ScrollThumb } from './ConversationScrollThumb';

function QuoteItem({ quote, index, language, remove, reveal, annotate, highlight }: {
  quote: ChatQuote; index: number; language: 'zh' | 'en';
  remove: () => void; reveal: () => void;
  annotate: (text: string) => void;
  highlight?: (active: boolean) => void;
}) {
  const zh = language === 'zh';
  const annotated = quote.annotation !== undefined;
  const name = annotated ? (zh ? '批注' : 'Annotation') : (zh ? '引用' : 'Quote');
  const scroll = useRef<HTMLDivElement>(null);
  const scrollId = useId();
  return <div className="composer-quote" data-source-range={`${quote.messageIndex}:${quote.blockIndex ?? 0}:${quote.startOffset}:${quote.endOffset}`}
    onMouseEnter={() => highlight?.(true)} onMouseLeave={() => highlight?.(false)}
    onFocusCapture={() => highlight?.(true)} onBlurCapture={event => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) highlight?.(false);
    }}>
    <button type="button" className="quote-number" onClick={reveal}
      aria-label={zh ? `查看${name} ${index + 1} 的原文` : `Show source of ${name.toLowerCase()} ${index + 1}`}
      data-tooltip={zh ? '查看原文' : 'Show source'}>{index + 1}.</button>
    <div ref={scroll} id={scrollId} className="quote-excerpt" tabIndex={0}
      role="region" aria-label={`${name} ${index + 1}`}>
      <div className="quote-excerpt-content">{quote.text}</div>
    </div>
    <div className="quote-controls">
      <button type="button" className="icon-button" aria-label={zh ? `移除${name} ${index + 1}` : `Remove ${name.toLowerCase()} ${index + 1}`}
        data-tooltip={zh ? `移除${name}` : `Remove ${name.toLowerCase()}`} onClick={remove}><X size={14}/></button>
      <ScrollThumb scrollRef={scroll} language={language} sessionId={quote.id} messageCount={quote.text.length}
        scrollId={scrollId} label={zh ? `引用 ${index + 1} 滚动` : `Scroll quote ${index + 1}`}
        className="quote-scroll-track" contentSelector=".quote-excerpt-content" compact/>
    </div>
    {annotated && <label className="quote-annotation-editor">
      <span><PencilLine size={15}/>{zh ? '批注' : 'Annotation'}</span>
      <textarea aria-label={zh ? `批注 ${index + 1} 内容` : `Annotation ${index + 1} text`}
        placeholder={zh ? '添加批注…' : 'Add an annotation…'} rows={2}
        maxLength={MAX_ANNOTATION_LENGTH} value={quote.annotation ?? ''}
        onChange={event => annotate(event.target.value)}/>
    </label>}
  </div>;
}

type QuotePreviewProps = {
  quotes: ChatQuote[]; language: 'zh' | 'en';
  remove: (id: string) => void; reveal: (quote: ChatQuote) => void; clear: () => void;
  annotate: (id: string, text: string) => void;
  onHighlight?: (id: string | null) => void;
};

export function QuotePreview(props: QuotePreviewProps) {
  if (!props.quotes.length) return null;
  return <div className="composer-quotes" aria-label={props.language === 'zh' ? '待发送引用与批注' : 'Pending quotes and annotations'}>
    <QuoteGroup {...props} quotes={props.quotes.filter(quote => quote.annotation === undefined)} annotated={false}/>
    <QuoteGroup {...props} quotes={props.quotes.filter(quote => quote.annotation !== undefined)} annotated/>
  </div>;
}

function QuoteGroup({ quotes, language, remove, reveal, annotate, onHighlight, annotated }: QuotePreviewProps & { annotated: boolean }) {
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
  const viewLabel = annotated ? (zh ? '查看批注' : 'View annotations') : (zh ? '查看引用' : 'View quotes');
  const clearLabel = annotated ? (zh ? '清空批注' : 'Clear annotations') : (zh ? '清空引用' : 'Clear quotes');
  return <><div className="quote-chip">
      <button ref={anchor} type="button" popoverTarget={id} aria-expanded={open} aria-controls={id}
        aria-label={viewLabel}>
        {annotated && <PencilLine size={15}/>}
        {zh ? `${quotes.length} 条${annotated ? '批注' : '引用'}` : `${quotes.length} ${annotated ? 'annotation' : 'quote'}${quotes.length === 1 ? '' : 's'}`}</button>
      <button type="button" className="quote-clear" aria-label={clearLabel}
        data-tooltip={clearLabel} onClick={() => quotes.forEach(quote => remove(quote.id))}><X size={13}/></button>
    </div>
  {createPortal(<div id={id} ref={panel} popover="auto" className="quote-popover"
    role="dialog" aria-label={annotated ? (zh ? '批注预览' : 'Annotation preview') : (zh ? '引用预览' : 'Quote preview')}
    onToggle={event => {
      const visible = event.currentTarget.matches(':popover-open');
      setOpen(visible); if (!visible) onHighlight?.(null);
    }}
    style={{ left: position?.left ?? 0, top: position?.top ?? 0, visibility: position ? 'visible' : 'hidden' }}>
    {quotes.map((quote, index) => <QuoteItem key={quote.id} quote={quote} index={index} language={language}
      annotate={text => annotate(quote.id, text)}
      highlight={active => onHighlight?.(active ? quote.id : null)}
      remove={() => remove(quote.id)} reveal={() => { panel.current?.hidePopover(); reveal(quote); }}/>)}
  </div>, document.body)}</>;
}
