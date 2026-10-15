import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, CircleHelp, X } from 'lucide-react';
import type { Questionnaire, QuestionDraft, QuestionAnswer } from './questionnaire';
import { validAnswer, serializeAnswers } from './questionnaire';
import './permission-approval.css';
import './question-review.css';

export function QuestionReview({ question, requestId, open, zh, drafts, onLater, onRespond }: {
  question?: Questionnaire; requestId?: string; open: boolean; zh: boolean;
  drafts: Map<string, QuestionDraft>; onLater: () => void;
  onRespond: (answer: { value: string } | { cancelled: true }) => Promise<void>;
}) {
  const active = Boolean(question && requestId && open);
  const retained = useRef(question);
  if (question) retained.current = question;
  const shown = question ?? retained.current;
  const [visible, setVisible] = useState(active);
  const empty = (): QuestionDraft => ({ page: 0, answers: [], custom: [] });
  const [draft, setDraft] = useState<QuestionDraft>(() => drafts.get(requestId ?? '') ?? empty());
  const [expanded, setExpanded] = useState(false);
  const [height, setHeight] = useState(700);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const panel = useRef<HTMLElement>(null);
  const grip = useRef<HTMLButtonElement>(null);
  const lock = useRef(false);
  const advance = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const drag = useRef<{ y: number; height: number } | undefined>(undefined);
  const [dragHeight, setDragHeight] = useState<number>();
  const t = (cn: string, en: string) => zh ? cn : en;
  useEffect(() => () => clearTimeout(advance.current), [active, requestId]);
  useLayoutEffect(() => {
    if (requestId) { setDraft(drafts.get(requestId) ?? empty()); setError(''); }
  }, [requestId, drafts]);
  useLayoutEffect(() => {
    if (active) { setVisible(true); return; }
    if (!visible) return;
    const timer = setTimeout(() => {
      setVisible(false); document.querySelector<HTMLButtonElement>('.question-review-trigger')?.focus({ preventScroll: true });
    }, matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 140);
    return () => clearTimeout(timer);
  }, [active, visible]);
  useLayoutEffect(() => {
    if (!visible) return;
    const main = panel.current?.closest('main');
    if (!main) return;
    const observer = new ResizeObserver(() => setHeight(main.clientHeight));
    observer.observe(main); return () => observer.disconnect();
  }, [visible]);
  useLayoutEffect(() => {
    if (!visible) return;
    const wrap = panel.current?.closest('.composer-wrap');
    wrap?.setAttribute('data-approval-covered', '');
    return () => wrap?.removeAttribute('data-approval-covered');
  }, [visible]);
  useEffect(() => { if (active && visible) grip.current?.focus({ preventScroll: true }); }, [active, visible, requestId]);
  const previousPage = useRef(0);
  useEffect(() => {
    const moved = previousPage.current !== draft.page;
    previousPage.current = draft.page;
    if (!active || !visible || (!moved && !draft.answers[draft.page]?.wasCustom)) return;
    panel.current?.querySelector<HTMLElement>('textarea, input:checked, input')?.focus({ preventScroll: true });
  }, [draft.page, draft.answers[draft.page]?.wasCustom, active, visible]);
  const update = (next: QuestionDraft) => {
    clearTimeout(advance.current);
    setDraft(next); setError('');
    if (requestId) drafts.set(requestId, next);
  };
  const respond = async (value: { value: string } | { cancelled: true }) => {
    if (!active || lock.current) return;
    clearTimeout(advance.current);
    lock.current = true; setPending(true); setError('');
    try { await onRespond(value); if (requestId) drafts.delete(requestId); }
    catch { setError(t('提交未成功，答案已保留，请重试。', 'Submission failed. Answers are retained; please retry.')); }
    finally { lock.current = false; setPending(false); }
  };
  if (!visible || !shown) return null;
  const index = Math.min(draft.page, shown.questions.length - 1);
  const q = shown.questions[index], answer = draft.answers[index];
  const compact = Math.min(height - 54, Math.max(240, height * .5));
  const large = Math.min(height - 54, Math.max(240, height * .85));
  const actualHeight = dragHeight ?? (expanded ? large : compact);
  const choose = (value: QuestionAnswer) => {
    const answers = [...draft.answers]; answers[index] = value;
    const nextDraft = { ...draft, answers, page: index };
    update(nextDraft);
    if (!value.wasCustom && index < shown.questions.length - 1) {
      // Let the selection feedback settle before replacing the question.
      advance.current = setTimeout(() => update({ ...nextDraft, page: index + 1 }),
        matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 200);
    }
  };
  const next = () => {
    if (validAnswer(q, answer)) update({ ...draft, page: Math.min(index + 1, shown.questions.length - 1) });
    else setError(t('请先回答当前问题。', 'Please answer this question.'));
  };
  const submit = () => {
    const missing = shown.questions.findIndex((question, i) => !validAnswer(question, draft.answers[i]));
    if (missing >= 0) { update({ ...draft, page: missing }); setError(t('请补充未回答的问题。', 'Please answer the remaining question.')); return; }
    void respond({ value: serializeAnswers(shown, draft.answers) });
  };
  return <section ref={panel} className={`approval-drawer question-review-drawer${!active ? ' is-closing' : ''}`}
    role="dialog" aria-modal="false" aria-label={t('回答问题', 'Answer questions')} inert={!active}
    data-size={expanded ? 'expanded' : 'compact'} data-dragging={dragHeight !== undefined} style={{ height: actualHeight }}
    onKeyDown={e => { if (e.key === 'Escape' && !pending) { e.preventDefault(); e.stopPropagation(); onLater(); } }}>
    <button ref={grip} type="button" className="approval-drawer-grip" disabled={pending}
      aria-label={t('调整提问高度', 'Resize questions')} aria-expanded={expanded}
      onClick={e => { if (e.detail === 0) setExpanded(v => !v); }}
      onPointerDown={e => { if (e.button !== 0) return; e.preventDefault(); e.currentTarget.focus(); drag.current = { y: e.clientY, height: actualHeight }; setDragHeight(actualHeight); e.currentTarget.setPointerCapture(e.pointerId); }}
      onPointerMove={e => { if (drag.current) setDragHeight(Math.max(compact, Math.min(large, drag.current.height + drag.current.y - e.clientY))); }}
      onPointerUp={e => {
        if (!drag.current) return;
        const distance = drag.current.y - e.clientY;
        const nextHeight = Math.max(compact, Math.min(large, drag.current.height + distance));
        setExpanded(Math.abs(distance) < 5 ? !expanded : nextHeight >= (compact + large) / 2);
        drag.current = undefined; setDragHeight(undefined); e.currentTarget.releasePointerCapture(e.pointerId);
      }}
      onLostPointerCapture={() => { drag.current = undefined; setDragHeight(undefined); }}
      onKeyDown={e => { if (['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key)) { e.preventDefault(); setExpanded(e.key === 'ArrowUp' || e.key === 'End'); } }}><span/></button>
    <header className="approval-drawer-heading"><CircleHelp size={18}/><h2>{t('回答问题', 'Answer questions')}</h2><span className="question-beta">Beta</span></header>
    <div className="permission-approval-content question-review-content" key={index}>
      <h3>{q.question}</h3>{q.reason && <p className="question-reason">{q.reason}</p>}
      <div className="question-options" role="radiogroup" aria-label={q.question}>
        {q.options.map((o, i) => <label key={i} className="question-option">
          <input type="radio" name={`question-${requestId}-${index}`} checked={answer?.wasCustom === false && answer.value === o.value}
            disabled={pending} onChange={() => choose({ id: q.id, value: o.value, wasCustom: false })}/>
          <span className="question-option-letter" aria-hidden="true">{String.fromCharCode(65 + i)}</span>
          <span><strong>{o.label}</strong>{o.description && <small>{o.description}</small>}</span>
        </label>)}
        {q.allowFreeform && q.options.length > 0 && <label className="question-option">
          <input type="radio" name={`question-${requestId}-${index}`} checked={answer?.wasCustom === true} disabled={pending}
            onChange={() => choose({ id: q.id, value: draft.custom[index] ?? '', wasCustom: true })}/>
          <span className="question-option-letter" aria-hidden="true">{String.fromCharCode(65 + q.options.length)}</span>
          <span><strong>{t('其他回答', 'Other answer')}</strong></span>
        </label>}
      </div>
      {q.allowFreeform && (!q.options.length || answer?.wasCustom) && <textarea
        aria-label={t('你的回答', 'Your answer')} placeholder={t('输入你的回答', 'Your answer')} disabled={pending}
        spellCheck={false} value={draft.custom[index] ?? ''}
        onChange={e => { const custom = [...draft.custom]; custom[index] = e.target.value;
          const answers = [...draft.answers]; answers[index] = { id: q.id, value: e.target.value, wasCustom: true };
          update({ ...draft, custom, answers }); }}
        onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
          e.preventDefault(); if (index < shown.questions.length - 1) next(); else submit();
        } }}/>}
    </div>
    {error && <p className="question-error" role="alert">{error}</p>}
    <footer className="button-row question-review-actions">
      <div className="question-navigation">
        <button type="button" aria-label={t('上一题', 'Previous question')} disabled={pending || index === 0}
          onClick={() => update({ ...draft, page: index - 1 })}><ArrowLeft size={15}/></button>
        <span>{index + 1} / {shown.questions.length}</span>
        <button type="button" aria-label={t('下一题', 'Next question')} disabled={pending || index === shown.questions.length - 1}
          onClick={() => update({ ...draft, page: index + 1 })}><ArrowRight size={15}/></button>
      </div>
      <button type="button" disabled={pending} onClick={onLater}>{t('稍后回答', 'Answer later')}</button>
      <button type="button" disabled={pending} onClick={() => void respond({ cancelled: true })}><X size={15}/>{t('取消提问', 'Cancel questions')}</button>
      <button type="button" className="primary" disabled={pending} onClick={index < shown.questions.length - 1 ? next : submit}>
        {index < shown.questions.length - 1 ? <ArrowRight size={15}/> : <Check size={15}/>}
        {index < shown.questions.length - 1 ? t('下一题', 'Next question') : t('提交回答', 'Submit answers')}
      </button>
    </footer>
  </section>;
}
