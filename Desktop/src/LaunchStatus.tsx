import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, Goal, Lightbulb, Network, Pause, Pencil, Play, Trash2, X } from 'lucide-react';
import { emptyLaunch, goalStatusLabel, type LaunchMode, type LaunchState } from './launch-state';
import { elapsedTime } from './elapsed-time';
import { TurnStatusTrigger } from './TurnStatusTrigger';
import './launch-status.css';

export function LaunchStatus({ state = emptyLaunch(), language, disabled, onMode, onAction, placement = 'composer', align = 'start', turnUltracode = false, onDisableStanding, expanded, onExpandedChange }: {
  state?: LaunchState; language: 'zh' | 'en'; disabled: boolean;
  placement?: 'composer' | 'pulse'; align?: 'start' | 'end'; turnUltracode?: boolean; onDisableStanding?: () => Promise<unknown>;
  expanded?: boolean; onExpandedChange?: (expanded: boolean) => void;
  onMode: (mode: LaunchMode, enabled: boolean) => Promise<unknown>;
  onAction: (action: string, value?: unknown) => Promise<unknown>;
}) {
  const zh = language === 'zh', goal = state.goalArmed ? undefined : state.goal;
  const [localOpen, setLocalOpen] = useState(false);
  const open = expanded ?? localOpen;
  const setOpen = (value: boolean | ((previous: boolean) => boolean)) => {
    const next = typeof value === 'function' ? value(open) : value;
    setLocalOpen(next); onExpandedChange?.(next);
  };
  const [retained, setRetained] = useState(false);
  const [pending, setPending] = useState(false);
  const [editing, setEditing] = useState(false);
  const [objective, setObjective] = useState('');
  const [budget, setBudget] = useState('');
  const [error, setError] = useState('');
  const anchor = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const actionLock = useRef(false);
  const [position, setPosition] = useState({ left: 0, top: 0 });
  const visible = state.plan || state.ultracode || state.goalArmed || Boolean(goal) || turnUltracode;
  const previousGoal = useRef(goal?.id);
  useEffect(() => {
    if (previousGoal.current !== goal?.id) { setOpen(false); setEditing(false); setError(''); }
    previousGoal.current = goal?.id;
  }, [goal?.id]);
  useEffect(() => { setBudget(goal?.tokenBudget === undefined ? '' : String(goal.tokenBudget)); }, [goal?.id, goal?.tokenBudget]);
  useEffect(() => { if (!visible || disabled) setOpen(false); }, [visible, disabled]);
  useEffect(() => {
    if (open) { setRetained(true); return; }
    const timer = setTimeout(() => setRetained(false), window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 180);
    return () => clearTimeout(timer);
  }, [open]);
  useLayoutEffect(() => {
    const element = panel.current;
    if (!element || !open) return;
    if (placement === 'pulse') {
      const place = () => {
        const rect = anchor.current?.getBoundingClientRect();
        const row = anchor.current?.closest('.working')?.getBoundingClientRect();
        if (rect && row) setPosition({ left: Math.max(0, rect.left - row.left), top: 0 });
      };
      place();
      const row = anchor.current?.closest('.working');
      const observer = new ResizeObserver(place);
      if (row) observer.observe(row);
      const timer = setTimeout(() => {
        const scroll = element.closest('#conversation-scroll');
        if (scroll) {
          const bottom = element.getBoundingClientRect().bottom - scroll.getBoundingClientRect().bottom;
          if (bottom > 0) scroll.scrollTop += bottom + 8;
        }
      }, 200);
      element.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus({ preventScroll: true });
      return () => { observer.disconnect(); clearTimeout(timer); };
    }
    element.showPopover();
    const place = () => {
      const rect = anchor.current?.getBoundingClientRect();
      if (!rect) return;
      const above = rect.top - element.offsetHeight - 8;
      const top = above >= 54 ? above : rect.bottom + 8;
      setPosition({ left: Math.max(10, Math.min(rect.left, innerWidth - element.offsetWidth - 10)),
        top: Math.max(54, Math.min(top, innerHeight - element.offsetHeight - 10)) });
    };
    place();
    const observer = new ResizeObserver(place); observer.observe(element);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    element.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
    return () => { observer.disconnect(); window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true); };
  }, [open, placement, align]);
  const run = async (action: () => Promise<unknown>) => {
    if (actionLock.current) return false;
    actionLock.current = true; setPending(true); setError('');
    try { await action(); return true; }
    catch (error) { setError(String(error instanceof Error ? error.message : error)); return false; }
    finally { actionLock.current = false; setPending(false); }
  };
  if (!visible) return null;
  const status = goal ? goalStatusLabel(goal.status, zh) : state.goalArmed ? (zh ? '目标待发送' : 'Goal armed') : '';
  const label = [state.plan ? (zh ? '计划' : 'Plan') : '', status, state.ultracode || turnUltracode ? 'Ultracode' : ''].filter(Boolean).join(' · ');
  const content = <div ref={panel} popover={placement === 'composer' ? 'auto' : undefined} role="dialog" aria-label={zh ? '任务状态' : 'Task state'}
      className={`launch-status-panel${placement === 'pulse' ? ' launch-status-panel-inline' : ''}`} data-goal-state={goal?.status}
      aria-hidden={!open || undefined} style={placement === 'composer' ? position : undefined}
      onToggle={event => { if (event.newState === 'closed') setOpen(false); }}
      onKeyDown={event => {
        if (event.key === 'Escape') { event.stopPropagation(); setOpen(false); anchor.current?.focus(); }
        if (event.key === 'Tab') {
          const buttons = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),textarea:not(:disabled)')];
          if (event.shiftKey && document.activeElement === buttons[0]) { event.preventDefault(); buttons.at(-1)?.focus(); }
          else if (!event.shiftKey && document.activeElement === buttons.at(-1)) { event.preventDefault(); buttons[0]?.focus(); }
        }
      }}>
      <header><strong>{zh ? '任务状态' : 'Task state'}</strong>
        <button type="button" className="icon-button" aria-label={zh ? '关闭' : 'Close'} onClick={() => { setOpen(false); anchor.current?.focus(); }}><X size={15}/></button></header>
      {goal ? <>
        <div className="launch-goal-heading"><Goal size={16}/><strong>{status}</strong>
          <div className="spacer"/>
          {goal.status !== 'complete' && <button type="button" className="icon-button" disabled={pending}
            aria-label={goal.status === 'active' ? (zh ? '暂停目标' : 'Pause goal') : (zh ? '恢复目标' : 'Resume goal')}
            data-tooltip={goal.status === 'active' ? (zh ? '暂停目标' : 'Pause goal') : (zh ? '恢复目标' : 'Resume goal')}
            onClick={() => void run(() => onAction(goal.status === 'active' ? 'pause' : 'resume'))}>{goal.status === 'active' ? <Pause size={15}/> : <Play size={15}/>}</button>}
          <button type="button" className="icon-button" disabled={pending} aria-label={zh ? '编辑目标' : 'Edit goal'}
            data-tooltip={zh ? '编辑目标' : 'Edit goal'} onClick={() => { setObjective(goal.objective); setEditing(true); }}><Pencil size={15}/></button>
          <button type="button" className="icon-button" disabled={pending} aria-label={zh ? '清除目标' : 'Clear goal'}
            data-tooltip={zh ? '清除目标，并中止正在进行的任务' : 'Clear goal and abort any running task'} onClick={() => void run(() => onAction('clear'))}><Trash2 size={15}/></button>
        </div>
        {editing ? <form className="launch-goal-editor" onSubmit={event => { event.preventDefault(); void run(() => onAction('edit', objective)).then(saved => { if (saved) setEditing(false); }); }}>
          <textarea aria-label={zh ? '目标内容' : 'Goal objective'} value={objective} onChange={event => setObjective(event.target.value)} maxLength={goal.ultracode ? 15989 : 16000} disabled={pending}/>
          <div><button type="button" className="icon-button" disabled={pending} aria-label={zh ? '取消编辑' : 'Cancel edit'} onClick={() => setEditing(false)}><X size={15}/></button>
            <button type="submit" className="icon-button" disabled={pending || !objective.trim()} aria-label={zh ? '保存目标' : 'Save goal'}><Check size={15}/></button></div>
        </form> : <p className="launch-objective">{goal.objective}</p>}
        <div className="launch-goal-metrics"><span>{zh ? '已推进' : 'Iterations'} <b>{goal.iteration}</b></span>
          <span>{zh ? '已耗时' : 'Elapsed'} <b>{elapsedTime({ startedAt: 0, endedAt: goal.timeUsedSeconds * 1000 }, 0)}</b></span>
          <span>Token <b>{goal.tokensUsed.toLocaleString()}{goal.tokenBudget ? ` / ${goal.tokenBudget.toLocaleString()}` : ''}</b></span></div>
        <form className="launch-budget" onSubmit={event => { event.preventDefault(); void run(() => onAction('budget', budget.trim() ? Number(budget) : null)); }}>
          <label htmlFor="launch-budget">{zh ? 'Token 预算' : 'Token budget'}</label>
          <input id="launch-budget" type="number" min="1" step="1" disabled={pending} placeholder={goal.tokenBudget ? String(goal.tokenBudget) : (zh ? '不限' : 'Unbounded')}
            value={budget} onChange={event => setBudget(event.target.value)}/>
          <button type="submit" className="icon-button" disabled={pending} aria-label={zh ? '保存预算' : 'Save budget'}
            data-tooltip={zh ? '保存预算（留空取消限制）' : 'Save budget (empty removes limit)'}><Check size={15}/></button>
        </form>
      </> : state.goalArmed && <div className="launch-state-row"><Goal size={16}/><span>{zh ? '目标待发送' : 'Goal armed'}</span>
        <button type="button" className="icon-button" disabled={pending} aria-label={zh ? '取消目标启用' : 'Disarm goal'} onClick={() => void run(() => onMode('goal', false))}><X size={15}/></button></div>}
      {state.plan && <div className="launch-state-row"><Lightbulb size={16}/><span>{placement === 'composer' ? zh ? '计划待发送' : 'Plan armed' : zh ? '计划中' : 'Planning'}</span>
        <button type="button" className="icon-button" disabled={pending} aria-label={zh ? '关闭计划' : 'Disable Plan'} onClick={() => void run(() => onMode('plan', false))}><X size={15}/></button></div>}
      {state.ultracode && <div className="launch-state-row"><Network size={16}/><span>Ultracode</span>
        <small>{placement === 'composer' ? zh ? '本次发送' : 'This send' : zh ? '本会话' : 'This session'}</small>
        <button type="button" className="icon-button" disabled={pending} aria-label={zh ? '关闭 Ultracode' : 'Disable Ultracode'}
          onClick={() => void run(() => onDisableStanding ? onDisableStanding() : onMode('ultracode', false))}><X size={15}/></button></div>}
      {(turnUltracode || goal?.ultracode) && !state.ultracode && <div className="launch-state-row"><Network size={16}/><span>Ultracode</span><small>{goal?.ultracode ? zh ? '本次目标' : 'This goal' : zh ? '本次任务' : 'This task'}</small></div>}
      {error && <p className="launch-action-error" role="alert">{error}</p>}
    </div>;
  const triggerIcons = <>{state.plan && <Lightbulb size={16}/>}
    {(state.goalArmed || goal) && <Goal size={16}/>}
    {(state.ultracode || turnUltracode) && <Network size={16}/>}</>;
  const pulseLabel = goal ? zh ? `目标${goal.status === 'active' ? '推进' : status}` : `Goal: ${status}`
    : state.plan ? zh ? '计划中' : 'Planning' : 'Ultracode';
  return <>
    {placement === 'pulse' && align === 'end' ? <TurnStatusTrigger ref={anchor}
      className="launch-status-trigger launch-status-pulse" aria-label={label}
      icon={triggerIcons} label={pulseLabel}
      tone={goal?.status === 'complete' ? 'success' : goal?.status === 'blocked' || goal?.status === 'usage_limited' ? 'danger'
        : goal?.status === 'paused' || goal?.status === 'budget_limited' ? 'warning' : 'neutral'}
      aria-haspopup="dialog" aria-expanded={open} disabled={disabled} data-goal-state={goal?.status}
      onClick={() => setOpen(value => !value)}/>
      : <button ref={anchor} type="button" className={`launch-status-trigger launch-status-${placement}`} aria-label={label}
      aria-haspopup="dialog" aria-expanded={open} disabled={disabled} data-goal-state={goal?.status}
      data-tooltip={label} onClick={() => setOpen(value => !value)}>
      {triggerIcons}
      {placement === 'pulse' && <span className="launch-status-label">{pulseLabel}</span>}
    </button>}
    {placement === 'pulse' ? (open || retained) && <div className="launch-inline-reveal" data-open={open} data-align={align} inert={!open}
      style={align === 'start' ? { marginLeft: position.left, maxWidth: `calc(100% - ${position.left}px)` } : undefined}>
      <div className="launch-inline-clip">{content}</div>
    </div> : open && createPortal(content, document.body)}
  </>;
}
