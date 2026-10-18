import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { Circle, CircleCheck, CircleHelp, CircleX, FilePenLine, MessageCircleQuestion, ShieldAlert, Terminal, Wrench } from 'lucide-react';
import { DisclosureChevron } from './DisclosureChevron';
import type { PermissionApprovalPresentation } from './approval-presentation';
import './permission-approval.css';

function AnswerLabel({ label }: { label: string }) {
  const normalized = label.replace(/^[✅❌✓✗]\s*/, '').trim();
  const positive = /^(批准|允许|同意|是|approve|allow|yes)$/i.test(normalized);
  const negative = /^(拒绝|不允许|不同意|否|deny|reject|no)$/i.test(normalized);
  const Icon = positive ? CircleCheck : negative ? CircleX : Circle;
  return <strong className="permission-approval-answer-label">
    <Icon size={16} strokeWidth={1.9} aria-hidden="true" className={positive ? 'positive' : negative ? 'negative' : 'neutral'}/>
    {positive || negative ? normalized : label}
  </strong>;
}

export function PermissionApproval({ presentation, requestId, open, language, onLater, onRespond }: {
  presentation?: PermissionApprovalPresentation;
  requestId?: string;
  open: boolean;
  language: string;
  onLater: () => void;
  onRespond: (value: { confirmed: true } | { cancelled: true }) => Promise<void>;
}) {
  const active = open && Boolean(presentation);
  const retained = useRef(presentation);
  if (active) retained.current = presentation;
  const p = active ? presentation : retained.current;
  const [visible, setVisible] = useState(active);
  const [rawOpen, setRawOpen] = useState(false);
  const [inputOpen, setInputOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [height, setHeight] = useState(240);
  const [expanded, setExpanded] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [limit, setLimit] = useState(400);
  const panel = useRef<HTMLElement>(null);
  const grip = useRef<HTMLButtonElement>(null);
  const dragging = useRef<{ y: number; height: number } | null>(null);
  const responseLock = useRef(false);
  const rawId = useId();
  const inputId = useId();
  const contentId = useId();
  const zh = language === 'zh';
  const t = (cn: string, en: string) => zh ? cn : en;
  useLayoutEffect(() => {
    if (active) {
      setVisible(true);
      return;
    }
    if (!visible) return;
    const timer = setTimeout(() => {
      const wrap = panel.current?.closest('.composer-wrap');
      wrap?.removeAttribute('data-approval-covered');
      const composer = wrap?.querySelector<HTMLElement>('.composer .composer-input');
      if (document.activeElement === document.body || panel.current?.contains(document.activeElement)) composer?.focus();
      setVisible(false);
    }, matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 140);
    return () => clearTimeout(timer);
  }, [active, visible]);
  useLayoutEffect(() => {
    if (!visible) return;
    const main = panel.current?.closest('main');
    if (!main) return;
    const observer = new ResizeObserver(() => setLimit(Math.max(140, Math.floor(main.clientHeight / 2))));
    observer.observe(main);
    return () => observer.disconnect();
  }, [visible]);
  useEffect(() => {
    if (!active) return;
    setRawOpen(false); setInputOpen(false); setHeight(240); setExpanded(false); setIsDragging(false);
    dragging.current = null;
    grip.current?.focus({ preventScroll: true });
  }, [active, visible, requestId]);
  // Keep the draft covered and inert until the opaque surface finishes exiting.
  useLayoutEffect(() => {
    const wrap = panel.current?.closest('.composer-wrap');
    if (visible) wrap?.setAttribute('data-approval-covered', '');
    return () => wrap?.removeAttribute('data-approval-covered');
  }, [visible]);
  const respond = async (value: { confirmed: true } | { cancelled: true }) => {
    if (!active || responseLock.current) return;
    responseLock.current = true; setPending(true);
    try { await onRespond(value); } finally { responseLock.current = false; setPending(false); }
  };
  if (!visible || !p) return null;
  const Icon = p.category === 'hazardous' ? ShieldAlert : p.category === 'uncertain' ? CircleHelp
    : p.operation === 'command' ? Terminal : p.operation === 'file' ? FilePenLine
      : p.operation === 'question' ? MessageCircleQuestion : Wrench;
  const compactHeight = Math.min(240, limit);
  const actualHeight = isDragging ? Math.min(height, limit) : expanded ? limit : compactHeight;
  const midpoint = (compactHeight + limit) / 2;
  const selectSize = (value: boolean) => {
    setExpanded(value);
    if (!value) { setRawOpen(false); setInputOpen(false); }
  };
  return <section ref={panel} className={`permission-approval approval-drawer${!active ? ' is-closing' : ''}`}
    role="dialog" aria-modal="false" aria-label={p.title} inert={!active}
    data-size={expanded ? 'expanded' : 'compact'} data-dragging={isDragging}
    style={{ height: actualHeight }}
    onKeyDown={event => {
      if (event.key === 'Escape' && !pending) { event.preventDefault(); event.stopPropagation(); onLater(); }
    }}>
    <button ref={grip} type="button" className="approval-drawer-grip"
      aria-label={t('调整审批抽屉高度', 'Resize approval drawer')} disabled={pending}
      aria-expanded={expanded} aria-controls={contentId}
      onPointerDown={event => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.currentTarget.focus();
        dragging.current = { y: event.clientY, height: actualHeight };
        setHeight(actualHeight); setIsDragging(true);
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={event => {
        if (dragging.current) {
          const next = Math.max(compactHeight, Math.min(limit, dragging.current.height + dragging.current.y - event.clientY));
          setHeight(next);
          if (limit > compactHeight) selectSize(next >= midpoint);
        }
      }}
      onPointerUp={event => {
        if (!dragging.current) return;
        const down = event.clientY - dragging.current.y;
        const next = Math.max(compactHeight, Math.min(limit, dragging.current.height - down));
        dragging.current = null;
        setIsDragging(false);
        event.currentTarget.releasePointerCapture(event.pointerId);
        if (down > 90 && next <= compactHeight + 8) onLater();
        else selectSize(Math.abs(down) < 5 ? !expanded : next >= midpoint && limit > compactHeight);
      }}
      onLostPointerCapture={() => { dragging.current = null; setIsDragging(false); }}
      onKeyDown={event => {
        if (['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) {
          event.preventDefault();
          selectSize(event.key === 'ArrowUp' || event.key === 'End');
        }
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault(); selectSize(!expanded);
        }
      }} onClick={event => {
        if (event.detail === 0) selectSize(!expanded);
      }}><span/></button>
    <header className={`approval-drawer-heading ${p.category}`}>
      <Icon size={17}/><h2>{p.operation === 'question' ? t('允许 Agent 向你提问？', 'Allow the agent to ask you a question?') : p.action}</h2><code>{p.toolName}</code>
    </header>
    <div id={contentId} className="permission-approval-content">
      {p.category === 'hazardous' && p.verificationCommand === undefined && <p className="permission-approval-reason hazardous"><strong>{p.operation === 'project' ? t('持久授权', 'Persistent authorization') : t('命中高风险规则', 'High-risk rule matched')}</strong> · {p.reason}</p>}
      {p.target && <p className="permission-approval-target"><span>{p.operation === 'command' ? t('工作目录', 'Working directory') : t('目标', 'Target')}</span><code>{p.target}</code></p>}
      {p.verificationCommand !== undefined && <div className="permission-approval-verification">
        <div className="permission-approval-input-heading"><strong>{t('文件修改后执行', 'Run after the file change')}</strong></div>
        <pre className="permission-approval-input" tabIndex={0}>{p.verificationCommand}</pre>
      </div>}
      {p.category === 'hazardous' && p.verificationCommand !== undefined && <p className="permission-approval-reason hazardous"><strong>{t('命中高风险规则', 'High-risk rule matched')}</strong> · {p.reason}</p>}
      {p.preview !== undefined && (p.operation === 'question'
        ? <p className="permission-approval-question">{p.preview.split(/(`[^`\n]+`)/g).map((part, index) =>
          part.startsWith('`') && part.endsWith('`') ? <code key={index}>{part.slice(1, -1)}</code> : part)}</p>
        : <><div className="permission-approval-input-heading"><strong>{p.previewLabel}</strong></div>
        <pre className="permission-approval-input" tabIndex={0}>{p.preview}</pre></>
      )}
      {p.operation === 'tool' && p.inputKind !== 'summary' && <pre className="permission-approval-input" tabIndex={0}>{p.input}</pre>}
      {p.choices?.length ? <div className="permission-approval-answer-preview">
        <div className="permission-approval-input-heading">{t('随后可选的回答', 'Answers available after approval')}</div>
        <ul className="permission-approval-choices">{p.choices.map((option, index) =>
          <li key={index}><AnswerLabel label={option.label}/>{expanded && option.description && <span className="permission-approval-detail">{option.description}</span>}</li>)}</ul>
      </div> : null}
      {p.category === 'uncertain' && <p className={`permission-approval-reason ${p.category}`}><strong>{t('无法自动判断', 'Analysis incomplete')}</strong> · {p.reason}</p>}
      {p.category === 'uncertain' && <p className="permission-approval-note">{t('无法分析不等于已经判断为危险或安全。', 'Incomplete analysis is not a verdict that the command is dangerous or safe.')}</p>}
      {p.inputKind === 'summary' && <><pre className="permission-approval-input">{p.input}</pre>
        <p className="permission-approval-note">{t('完整参数暂不可用；上游摘要可能已截断。', 'Full input is unavailable; the upstream summary may be truncated.')}</p></>}
      {expanded && <div className="permission-approval-detail">
      {p.agentNote && <div className="permission-approval-agent-note question-note"><span>{t('Agent 说明', 'Agent note')}</span><p>{p.agentNote}</p></div>}
      {p.category !== 'hazardous' && p.category !== 'uncertain' && <p className="permission-approval-reason">{p.reason}</p>}
      {p.inputKind !== 'summary' && p.operation !== 'project' && <><button type="button" className="permission-approval-disclosure" aria-expanded={inputOpen} aria-controls={inputId} onClick={() => setInputOpen(value => !value)}>
        <DisclosureChevron/>{t('完整调用参数', 'Full tool input')}</button>
        {inputOpen && <div id={inputId}><pre className="permission-approval-parameters" tabIndex={0}>{p.input}</pre>
          {p.otherParameters && <pre className="permission-approval-parameters" tabIndex={0}>{p.otherParameters}</pre>}</div>}</>}
      <button type="button" className="permission-approval-disclosure" aria-expanded={rawOpen} aria-controls={rawId} onClick={() => setRawOpen(value => !value)}>
        <DisclosureChevron/>{t('原始审批信息', 'Original approval details')}
      </button>
      {rawOpen && <div id={rawId}>
        <pre className="permission-approval-raw" tabIndex={0}>{p.rawMessage}</pre>
      </div>}
      </div>}
      </div>
      <footer className="button-row">
        <span>{p.operation === 'project' ? t('保存后重启生效', 'Applies on runtime restart') : p.operation === 'question' ? t('仅允许提问，不会代你选择答案', 'Allows asking only; does not select an answer') : t('仅限本次调用', 'This call only')}</span>
        <button type="button" disabled={pending} onClick={onLater}>{t('稍后处理', 'Review later')}</button>
        <button type="button" aria-label={p.operation === 'project' ? t('取消项目信任', 'Cancel project trust') : t('拒绝本次操作', 'Deny this call')} disabled={pending} onClick={() => void respond({ cancelled: true })}>{p.operation === 'project' ? t('取消', 'Cancel') : p.operation === 'question' ? t('不允许', 'Don’t allow') : t('拒绝', 'Deny')}</button>
        <button type="button" aria-label={p.operation === 'project' ? t('信任项目并保存', 'Trust project and save') : t('批准本次操作', 'Approve this call')} className="primary" disabled={pending} onClick={() => void respond({ confirmed: true })}>{p.operation === 'project' ? t('信任并保存', 'Trust and save') : p.operation === 'question' ? t('允许提问', 'Allow question') : t('允许一次', 'Allow once')}</button>
      </footer>
    </section>;
}
