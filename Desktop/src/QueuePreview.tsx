import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, ArrowUpToLine, Check, Pencil, X } from 'lucide-react';
import type { PendingMessage } from './contracts';
import { quotePresentation, quotePrompt } from './chat-quotes';
import './queue-preview.css';

export function QueuePreview({ messages, language, disabled, connected, onAction, onOpenChange }: {
  messages: PendingMessage[]; language: 'zh' | 'en'; disabled: boolean; connected: boolean;
  onAction: (action: 'queue_edit' | 'queue_remove' | 'queue_steer', message: PendingMessage, text?: string) => Promise<void>;
  onOpenChange: (open: boolean) => void;
}) {
  const zh = language === 'zh';
  const t = (cn: string, en: string) => zh ? cn : en;
  const id = useId();
  const anchor = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const returnFocus = useRef(false);
  const lastLeft = useRef(0);
  const pinned = useRef(false);
  const [open, setOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ item: PendingMessage; text: string } | null>(null);
  const [acting, setActing] = useState(false);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  const [present, setPresent] = useState(messages.length > 0);
  const last = useRef(messages);
  const visible = messages.length > 0;
  useLayoutEffect(() => { if (visible && anchor.current) lastLeft.current = anchor.current.parentElement?.offsetLeft ?? 0; });
  if (visible) last.current = messages;
  const displayed = visible ? messages : last.current;
  const selected = displayed.find(item => item.id === selectedId);
  const transition = useRef<{ height: number; opacity: number } | null>(null);
  const tween = useRef<Animation | null>(null);
  const clearTimers = () => { clearTimeout(hoverTimer.current); clearTimeout(closeTimer.current); };
  const show = () => {
    if (!disabled && visible) { clearTimers(); panel.current?.showPopover(); }
  };
  const hide = () => { clearTimers(); pinned.current = false; panel.current?.hidePopover(); };
  const enter = () => { clearTimers(); if (!disabled && visible) hoverTimer.current = setTimeout(show, 200); };
  const leave = () => { clearTimers(); if (!pinned.current && !editing) closeTimer.current = setTimeout(hide, 180); };
  useEffect(() => {
    if (visible) { setPresent(true); return; }
    hide();
    const timer = setTimeout(() => setPresent(false), 240);
    return () => clearTimeout(timer);
  }, [visible]);
  useEffect(() => { if (disabled) hide(); }, [disabled]);
  useEffect(() => {
    if (selectedId && !messages.some(item => item.id === selectedId)) { setSelectedId(null); setEditing(null); }
  }, [messages, selectedId]);
  useEffect(() => () => { clearTimers(); tween.current?.cancel(); }, []);
  useEffect(() => { onOpenChange(open); return () => onOpenChange(false); }, [open, onOpenChange]);
  const switchView = (item: PendingMessage | null, edit = false) => {
    const element = body.current;
    if (element) transition.current = { height: element.getBoundingClientRect().height, opacity: Number(getComputedStyle(element).opacity) };
    setSelectedId(item?.id ?? null);
    setEditing(edit && item ? { item: { ...item }, text: quotePresentation(item.message)?.draft ?? item.message } : null);
    pinned.current = Boolean(item);
  };
  useLayoutEffect(() => {
    const element = body.current;
    const previous = transition.current;
    transition.current = null;
    tween.current?.cancel();
    if (!element || !previous || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    tween.current = element.animate([
      { height: `${previous.height}px`, opacity: previous.opacity, transform: 'translateX(0)' },
      { opacity: .35, offset: .2 },
      { height: `${element.scrollHeight}px`, opacity: 1, transform: 'translateX(0)' },
    ], { duration: 220, easing: 'cubic-bezier(.22, 1, .36, 1)' });
    const content = element.firstElementChild;
    content?.animate([{ opacity: 0, transform: `translateX(${selectedId ? 6 : -6}px)` }, { opacity: 1, transform: 'translateX(0)' }],
      { duration: 220, easing: 'cubic-bezier(.22, 1, .36, 1)' });
  }, [selectedId, Boolean(editing)]);
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const trigger = anchor.current?.getBoundingClientRect();
      const box = panel.current?.getBoundingClientRect();
      if (!trigger || !box) return;
      const bar = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--window-bar-height')) || 46;
      setPosition({ left: Math.max(12, Math.min(trigger.left, innerWidth - box.width - 12)), top: Math.max(bar + 8, trigger.top - box.height - 8) });
    };
    place();
    const observer = new ResizeObserver(place);
    if (panel.current) observer.observe(panel.current);
    if (anchor.current) observer.observe(anchor.current);
    window.addEventListener('resize', place);
    document.addEventListener('scroll', place, true);
    return () => { observer.disconnect(); window.removeEventListener('resize', place); document.removeEventListener('scroll', place, true); };
  }, [open]);
  const act = async (action: 'queue_edit' | 'queue_remove' | 'queue_steer', item: PendingMessage, text?: string) => {
    if (acting || disabled || item.sending) return;
    setActing(true);
    try { await onAction(action, item, text); if (action === 'queue_edit') switchView(item); }
    finally { setActing(false); }
  };
  const actions = (item: PendingMessage) => <div className="queue-actions">
    <button type="button" aria-label={t(`编辑第 ${displayed.indexOf(item) + 1} 条`, 'Edit queued message')} data-tooltip={t('编辑', 'Edit')} disabled={acting || disabled || item.sending} onClick={() => switchView(item, true)}><Pencil size={15}/></button>
    <button type="button" aria-label={t(`插队第 ${displayed.indexOf(item) + 1} 条`, 'Steer queued message')} data-tooltip={t('立即插队', 'Steer now')} disabled={acting || disabled || !connected || item.sending} onClick={() => void act('queue_steer', item).catch(() => {})}><ArrowUpToLine size={15}/></button>
    <button type="button" aria-label={t(`撤回第 ${displayed.indexOf(item) + 1} 条`, 'Withdraw queued message')} data-tooltip={t('撤回', 'Withdraw')} disabled={acting || disabled || item.sending} onClick={() => void act('queue_remove', item).catch(() => {})}><X size={15}/></button>
  </div>;
  if (!present && !visible) return null;
  const parsed = selected ? quotePresentation(selected.message) : null;
  return <div className={`queue-context${visible ? '' : ' is-leaving'}`} aria-hidden={!visible} inert={!visible}
    style={!visible ? { left: lastLeft.current } : undefined}
    onMouseEnter={enter} onMouseLeave={leave}>
    <button type="button" ref={anchor} className="queue-trigger" aria-expanded={open} aria-controls={id}
      disabled={disabled || !visible} onClick={() => { if (open && pinned.current) hide(); else { pinned.current = true; show(); } }}
      onFocus={() => { if (!returnFocus.current) show(); returnFocus.current = false; }}>{t('待发送', 'Queued')} · {displayed.length}</button>
    {createPortal(<div ref={panel} id={id} popover="auto" className="queue-popover" role="dialog" aria-label={t('待发送消息', 'Pending messages')}
      onMouseEnter={() => clearTimers()} onMouseLeave={leave}
      onFocusCapture={() => { pinned.current = true; clearTimers(); }}
      onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); returnFocus.current = true; hide(); anchor.current?.focus({ preventScroll: true }); } }}
      onToggle={event => { const shown = event.currentTarget.matches(':popover-open'); setOpen(shown); if (!shown) { pinned.current = false; setSelectedId(null); setEditing(null); } }}
      style={{ left: position?.left ?? 0, top: position?.top ?? 0, visibility: position ? 'visible' : 'hidden' }}>
      <header className="queue-heading">{selected ? <>
        <button type="button" aria-label={t('返回队列', 'Back to queue')} onClick={() => switchView(null)}><ArrowLeft size={15}/></button>
        <span>{t('待发送', 'Queued')} · {t(`第 ${displayed.indexOf(selected) + 1} 条`, `Message ${displayed.indexOf(selected) + 1}`)}</span>
        {editing ? <div className="queue-actions">
          <button type="button" aria-label={t('保存队列编辑', 'Save queued edit')} disabled={acting || disabled || (!editing.text.trim() && !parsed?.quotes.length && !selected.attachmentCount)}
            onClick={() => void act('queue_edit', editing.item, parsed ? quotePrompt(editing.text, parsed.quotes, language) : editing.text).catch(() => {})}><Check size={15}/></button>
          <button type="button" aria-label={t('取消队列编辑', 'Cancel queued edit')} onClick={() => switchView(selected)}><X size={15}/></button>
        </div> : actions(selected)}
      </> : <><span>{t('待发送', 'Queued')}</span><small>{t('输入框为空时，Enter 插队最早一条', 'Empty composer: Enter steers the oldest message')}</small><span className="queue-total">{displayed.length} {t('条', 'messages')}</span></>}</header>
      <div className="queue-view" ref={body}>{selected ? <div className="queue-full">
        {editing ? <textarea aria-label={t('编辑待发送消息', 'Edit queued message')} autoFocus value={editing.text} onChange={event => setEditing({ ...editing, text: event.target.value })} maxLength={100000}/>
          : <div className="queue-full-text" tabIndex={0}>{parsed?.draft || (parsed ? parsed.quotes.map(quote => quote.text).join('\n\n') : selected.message)}</div>}
        {parsed && <div className="queue-full-quotes">{parsed.quotes.map((quote, index) => <blockquote key={index}>{quote.text}</blockquote>)}</div>}
      </div> : <div className="queue-list">{displayed.map((item, index) => {
        const presentation = quotePresentation(item.message);
        return <div key={item.id} className="queue-row">
          <span className="queue-order">{index + 1}.</span>
          <button type="button" className="queue-message" aria-label={t(`查看第 ${index + 1} 条全文`, `View message ${index + 1}`)} onClick={() => switchView(item)}>
            <span className="queue-message-preview">{presentation?.draft || (presentation ? presentation.quotes[0]?.text : item.message) || t('附件', 'Attachment')}</span>
            {(presentation || item.attachmentCount > 0 || item.sending) && <small>{[presentation && t(`${presentation.quotes.length} 条引用`, `${presentation.quotes.length} quotes`), item.attachmentCount > 0 && t(`${item.attachmentCount} 个附件`, `${item.attachmentCount} attachments`), item.sending && t('正在投递', 'Sending')].filter(Boolean).join(' · ')}</small>}
          </button>{actions(item)}
        </div>;
      })}</div>}</div>
    </div>, document.body)}
  </div>;
}
