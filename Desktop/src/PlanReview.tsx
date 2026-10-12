import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import Markdown from 'react-markdown';
import { ArrowLeft, Check, ClipboardCheck, MessageSquare, X } from 'lucide-react';
import { messageRemarkPlugins, messageRehypePlugins } from './markdown-math';
import './permission-approval.css';
import './plan-review.css';

export function PlanReview({ plan, feedback, open, requestId, zh, onLater, onRespond }: {
  plan?: { path: string; content: string }; feedback: boolean; open: boolean; requestId?: string; zh: boolean;
  onLater: () => void; onRespond: (value: { value: string } | { cancelled: true }) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [submission, setSubmission] = useState<{ requestId?: string; value: string }>();
  const modifying = feedback || editing;
  const active = open && Boolean(plan || feedback);
  const retained = useRef({ plan, feedback: modifying });
  if (active) retained.current = { plan, feedback: modifying };
  const content = active ? { plan, feedback: modifying } : retained.current;
  const [visible, setVisible] = useState(active);
  const [expanded, setExpanded] = useState(false);
  const [height, setHeight] = useState(600);
  const [value, setValue] = useState('');
  const [pending, setPending] = useState(false);
  const panel = useRef<HTMLElement>(null);
  const grip = useRef<HTMLButtonElement>(null);
  const lock = useRef(false);
  const drag = useRef<{ y: number; height: number } | undefined>(undefined);
  const [dragHeight, setDragHeight] = useState(0);
  const [dragging, setDragging] = useState(false);
  useLayoutEffect(() => {
    if (active) { setVisible(true); return; }
    if (!visible) return;
    const timer = setTimeout(() => { setVisible(false); document.querySelector<HTMLButtonElement>('.plan-review-trigger')?.focus({ preventScroll: true }); }, matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 140);
    return () => clearTimeout(timer);
  }, [active, visible]);
  useLayoutEffect(() => {
    if (!visible) return;
    const main = panel.current?.closest('main');
    if (!main) return;
    const observer = new ResizeObserver(() => setHeight(main.clientHeight));
    observer.observe(main); return () => observer.disconnect();
  }, [visible]);
  useEffect(() => { setValue(''); setEditing(false); }, [requestId]);
  // Collect edits locally before advancing the native select/input handshake.
  useEffect(() => {
    if (!feedback || !requestId || !submission || submission.requestId === requestId || pending) return;
    setSubmission(undefined);
    void respond({ value: submission.value });
  }, [feedback, requestId, submission, pending]);
  useLayoutEffect(() => {
    if (!visible) return;
    const wrap = panel.current?.closest('.composer-wrap');
    wrap?.setAttribute('data-approval-covered', '');
    return () => wrap?.removeAttribute('data-approval-covered');
  }, [visible]);
  useEffect(() => { if (active && visible) grip.current?.focus({ preventScroll: true }); }, [active, visible, requestId]);
  const respond = async (answer: { value: string } | { cancelled: true }) => {
    if (!active || lock.current) return;
    lock.current = true; setPending(true);
    try { await onRespond(answer); } finally { lock.current = false; setPending(false); }
  };
  if (!visible) return null;
  const t = (cn: string, en: string) => zh ? cn : en;
  const compact = Math.min(height - 54, Math.max(220, height * .5));
  const large = Math.min(height - 54, Math.max(220, height * .85));
  const actualHeight = dragging ? dragHeight : expanded ? large : compact;
  return <section ref={panel} className={`approval-drawer plan-review-drawer${!active ? ' is-closing' : ''}`}
    role="dialog" aria-modal="false" aria-label={content.feedback ? t('修改计划', 'Refine plan') : t('审阅计划', 'Review plan')}
    inert={!active} data-size={expanded ? 'expanded' : 'compact'} data-dragging={dragging}
    style={{ height: actualHeight }}
    onKeyDown={event => { if (event.key === 'Escape' && !pending) { event.preventDefault(); event.stopPropagation(); onLater(); } }}>
    <button ref={grip} className="approval-drawer-grip" aria-label={t('调整计划批阅高度', 'Resize plan review')} aria-expanded={expanded}
      disabled={pending} onClick={event => { if (event.detail === 0) setExpanded(v => !v); }}
      onPointerDown={event => { if (event.button !== 0) return; event.preventDefault(); event.currentTarget.focus(); drag.current = { y: event.clientY, height: actualHeight }; setDragHeight(actualHeight); setDragging(true); event.currentTarget.setPointerCapture(event.pointerId); }}
      onPointerMove={event => { if (drag.current) setDragHeight(Math.max(compact, Math.min(large, drag.current.height + drag.current.y - event.clientY))); }}
      onPointerUp={event => { if (!drag.current) return; const distance = drag.current.y - event.clientY; const next = Math.max(compact, Math.min(large, drag.current.height + distance)); setExpanded(Math.abs(distance) < 5 ? !expanded : next >= (compact + large) / 2); drag.current = undefined; setDragging(false); event.currentTarget.releasePointerCapture(event.pointerId); }}
      onLostPointerCapture={() => { drag.current = undefined; setDragging(false); }}
      onKeyDown={event => { if (['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) { event.preventDefault(); setExpanded(event.key === 'ArrowUp' || event.key === 'End'); } }}><span/></button>
    <header className="approval-drawer-heading"><ClipboardCheck size={18}/><h2>{content.feedback ? t('修改计划', 'Refine plan') : t('批阅计划', 'Review plan')}</h2></header>
    <div className="permission-approval-content plan-review-content">
      {content.feedback ? <textarea aria-label={t('修改意见', 'Requested changes')} value={value} onChange={event => setValue(event.target.value)}/>
        : <><code className="plan-review-path">{content.plan?.path}</code><div className="markdown"><Markdown skipHtml remarkPlugins={messageRemarkPlugins} rehypePlugins={messageRehypePlugins}
          components={{ a: ({ children }) => <span>{children}</span>, img: () => null }}>{content.plan?.content ?? ''}</Markdown></div></>}
    </div>
    <div className="button-row plan-review-actions">
      <button disabled={pending} onClick={onLater}>{t('稍后批阅', 'Review later')}</button>
      {editing && !feedback ? <button disabled={pending || Boolean(submission)} onClick={() => setEditing(false)}><ArrowLeft size={16}/>{t('返回批阅', 'Back to review')}</button>
        : <button disabled={pending} onClick={() => void respond({ cancelled: true })}><X size={16}/>{t('取消', 'Cancel')}</button>}
      {content.feedback ? <button className="primary" disabled={pending || Boolean(submission) || !value.trim()} onClick={() => {
        if (feedback) void respond({ value });
        else { setSubmission({ requestId, value }); void respond({ value: 'Request refinements' }); }
      }}>{t('提交修改意见', 'Submit changes')}</button>
        : <><button disabled={pending} onClick={() => setEditing(true)}><MessageSquare size={16}/>{t('提出修改', 'Request changes')}</button>
        <button className="primary" disabled={pending} onClick={() => void respond({ value: 'Approve plan' })}><Check size={16}/>{t('批准并执行', 'Approve and execute')}</button></>}
    </div>
  </section>;
}
