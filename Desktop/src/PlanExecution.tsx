import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import Markdown from 'react-markdown';
import { ClipboardCheck } from 'lucide-react';
import { DisclosureChevron } from './DisclosureChevron';
import { messageRemarkPlugins, messageRehypePlugins } from './markdown-math';
import type { ApprovedPlan, PlanExecutionState } from './plan-execution';
import './plan-execution.css';

export function PlanExecution({ plan, state, note = false, language }: {
  plan: ApprovedPlan; state: PlanExecutionState; note?: boolean; language: 'zh' | 'en';
}) {
  const [open, setOpen] = useState(false);
  const [present, setPresent] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  const [offset, setOffset] = useState(0);
  useLayoutEffect(() => {
    if (note || !present) return;
    const row = anchor.current?.closest<HTMLElement>('.working');
    if (!row) return;
    const place = () => {
      const button = anchor.current?.getBoundingClientRect();
      const bounds = row.getBoundingClientRect();
      setOffset(row.classList.contains('assistant-footer-row') || !button ? 0 : Math.max(0, button.left - bounds.left));
    };
    place();
    const observer = new ResizeObserver(place);
    observer.observe(row);
    if (anchor.current) observer.observe(anchor.current);
    return () => observer.disconnect();
  }, [note, present]);
  useEffect(() => {
    if (open || !present) return;
    const timer = setTimeout(() => setPresent(false), matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 180);
    return () => clearTimeout(timer);
  }, [open, present]);
  const id = useId();
  const zh = language === 'zh';
  const label = note ? zh ? '已批准计划' : 'Plan approved'
    : (zh ? { running: '执行计划中', completed: '计划已执行', failed: '计划执行失败', interrupted: '计划执行已中断' }
      : { running: 'Executing plan', completed: 'Plan executed', failed: 'Plan execution failed', interrupted: 'Plan execution interrupted' })[state];
  return <div className={`plan-execution ${note ? 'plan-approval-note' : 'plan-execution-status'}`} data-state={state} data-open={open}
    onKeyDown={event => { if (event.key === 'Escape' && open) { event.preventDefault(); event.stopPropagation(); setOpen(false); } }}>
    <button ref={anchor} className={note ? 'plan-approval-trigger' : 'launch-status-trigger launch-status-pulse'}
      aria-expanded={open} aria-controls={id} onClick={() => { setPresent(true); setOpen(value => !value); }}>
      <ClipboardCheck size={14}/><strong>{label}</strong>
      {note && <span className="plan-approved-title">{plan.title}</span>}
      <span className="plan-execution-chevron" data-open={open}><DisclosureChevron/></span>
    </button>
    {present && <div className="launch-inline-reveal" data-open={open} id={id} inert={!open}
      style={!note ? { marginLeft: offset, maxWidth: `calc(100% - ${offset}px)` } : undefined}>
      <div className="launch-inline-clip"><section className="plan-approved-snapshot" aria-label={zh ? '已批准的计划快照' : 'Approved plan snapshot'}>
        {present && <><code>{plan.path}</code><div className="markdown"><Markdown skipHtml
          remarkPlugins={messageRemarkPlugins} rehypePlugins={messageRehypePlugins}
          components={{ a: ({ children }) => <span>{children}</span>, img: () => null }}>{plan.content}</Markdown></div></>}
      </section></div>
    </div>}
  </div>;
}
