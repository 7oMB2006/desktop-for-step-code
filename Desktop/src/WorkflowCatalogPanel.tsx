import { useCallback, useEffect, useId, useRef, useState, type PointerEvent } from 'react';
import { GitBranch, RefreshCw, Workflow, X } from 'lucide-react';
import type { DesktopBridge } from './contracts';
import type { WorkflowCatalog } from './workflow-catalog';
import { workflowStatusLabels } from './workflow-catalog';
import { DisclosureChevron } from './DisclosureChevron';
import { useAnimatedDisclosure } from './useAnimatedDisclosure';
import './workflow-catalog-panel.css';

const AUTO_CLOSE_MS = 5000;
type LoadState = 'loading' | 'ready' | 'error' | 'unsupported' | 'no-session';

export function WorkflowCatalogPanel({ open, requestId, runtimeId, sessionId, language, bridge, onClose }: {
  open: boolean; requestId: number; runtimeId?: string; sessionId?: string; language: 'zh' | 'en';
  bridge?: Pick<DesktopBridge, 'workflows'>; onClose: () => void;
}) {
  const zh = language === 'zh';
  const heading = useId();
  const panel = useRef<HTMLElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const [state, setState] = useState<LoadState>('loading');
  const [catalog, setCatalog] = useState<WorkflowCatalog>();
  const [refresh, setRefresh] = useState(0);
  const [remaining, setRemaining] = useState(AUTO_CLOSE_MS);
  const remainingRef = useRef(AUTO_CLOSE_MS);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [dragY, setDragY] = useState(0);
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{ pointerId: number; startY: number; offset: number } | null>(null);
  const suppressClick = useRef(false);
  const { details, body } = useAnimatedDisclosure(expanded);
  const paused = hovered || focused || expanded || dragging || state !== 'ready';
  const close = useCallback(() => {
    if (panel.current?.contains(document.activeElement) && returnFocus.current?.isConnected) returnFocus.current.focus();
    onCloseRef.current();
  }, []);
  useEffect(() => {
    if (!open) return;
    if (!panel.current?.contains(document.activeElement)) {
      returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    }
    remainingRef.current = AUTO_CLOSE_MS;
    setRemaining(AUTO_CLOSE_MS); setExpanded(false); setHovered(false); setFocused(false);
    drag.current = null; suppressClick.current = false; setDragging(false); setDragY(0);
  }, [open, requestId]);
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setCatalog(undefined);
    remainingRef.current = AUTO_CLOSE_MS;
    setRemaining(AUTO_CLOSE_MS);
    if (!runtimeId || !sessionId) { setState('no-session'); return; }
    if (typeof bridge?.workflows !== 'function') { setState('unsupported'); return; }
    setState('loading');
    const timeout = window.setTimeout(() => {
      cancelled = true; setState('error');
    }, 10000);
    void bridge.workflows(runtimeId, sessionId).then(value => {
      if (cancelled) return;
      clearTimeout(timeout);
      if (!value || !Array.isArray(value.saved) || !Array.isArray(value.runs) || !Array.isArray(value.issues)) {
        setState('unsupported'); return;
      }
      setCatalog(value); setState('ready');
    }).catch(() => {
      if (!cancelled) { clearTimeout(timeout); setState('error'); }
    });
    return () => { cancelled = true; clearTimeout(timeout); };
  }, [open, requestId, runtimeId, sessionId, bridge, refresh]);
  useEffect(() => {
    if (!open || paused) return;
    let last = performance.now();
    const timer = window.setInterval(() => {
      const now = performance.now();
      const elapsed = now - last;
      if (!document.hidden) {
        remainingRef.current = Math.max(0, remainingRef.current - elapsed);
        setRemaining(remainingRef.current);
        if (remainingRef.current === 0) close();
      }
      last = now;
    }, 50);
    const visibility = () => { last = performance.now(); };
    document.addEventListener('visibilitychange', visibility);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', visibility); };
  }, [open, paused, close]);
  useEffect(() => {
    if (!open) return;
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.isComposing && !event.defaultPrevented) {
        event.preventDefault(); close();
      }
    };
    document.addEventListener('keydown', escape);
    return () => document.removeEventListener('keydown', escape);
  }, [open, close]);
  const startDrag = (event: PointerEvent<HTMLButtonElement>) => {
    if (!event.isPrimary || event.button !== 0) return;
    suppressClick.current = false;
    drag.current = { pointerId: event.pointerId, startY: event.clientY, offset: 0 };
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(true);
  };
  const moveDrag = (event: PointerEvent<HTMLButtonElement>) => {
    const active = drag.current;
    if (!active || active.pointerId !== event.pointerId) return;
    const distance = event.clientY - active.startY;
    active.offset = Math.min(0, distance);
    if (Math.abs(distance) > 5) suppressClick.current = true;
    setDragY(active.offset);
  };
  const finishDrag = (event: PointerEvent<HTMLButtonElement>, cancelled = false) => {
    const active = drag.current;
    if (!active || active.pointerId !== event.pointerId) return;
    const dismiss = !cancelled && Math.min(active.offset, event.clientY - active.startY) <= -48;
    drag.current = null;
    setDragging(false); setDragY(0);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (dismiss) close();
  };
  const date = (value?: number) => value !== undefined && Number.isFinite(value) && Math.abs(value) <= 8.64e15
    ? new Intl.DateTimeFormat(zh ? 'zh-CN' : 'en', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(value)
    : zh ? '时间未知' : 'Time unknown';
  const issueLabels = {
    project: zh ? '项目保存项' : 'Project definitions',
    desktop: zh ? 'Desktop 保存项' : 'Desktop definitions',
    runs: zh ? '运行记录' : 'Run records',
  };
  const reasonLabels = {
    unavailable: zh ? '无法读取' : 'Unavailable',
    invalid: zh ? '部分记录无法读取或校验' : 'Some records could not be read or validated',
    unsupported: zh ? '部分记录格式暂不支持' : 'Some record formats are not supported',
    limited: zh ? '仅展示部分记录' : 'Showing a limited set',
  };
  return <div className="workflow-catalog-anchor">
    <section ref={panel} id="workflow-catalog-panel" role="region" aria-labelledby={heading}
      aria-hidden={!open} inert={!open} className={`workflow-catalog-panel${open ? ' is-open' : ''}${dragging ? ' is-dragging' : ''}`}
      style={open ? { transform: `translateY(${dragY}px)` } : undefined}
      onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
      onFocusCapture={() => setFocused(true)}
      onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocused(false); }}>
      <header><Workflow size={18} aria-hidden="true"/><h2 id={heading}>{zh ? '工作流' : 'Workflows'}</h2>
        <div className="workflow-catalog-actions">
          <button type="button" className="icon-button" aria-label={zh ? '刷新工作流' : 'Refresh workflows'}
            data-tooltip={zh ? '刷新' : 'Refresh'} disabled={state === 'loading' || !runtimeId || !sessionId}
            onClick={() => setRefresh(value => value + 1)}><RefreshCw size={15}/></button>
          <button type="button" className="icon-button" aria-label={zh ? '关闭工作流面板' : 'Close workflows'}
            data-tooltip={zh ? '关闭' : 'Close'} onClick={close}><X size={17}/></button>
        </div>
      </header>
      <div className="workflow-catalog-scroll" aria-busy={state === 'loading'}>
        {state === 'loading' && <div className="workflow-catalog-loading" role="status">
          <span>{zh ? '正在读取工作流…' : 'Loading workflows…'}</span><i/><i/><i/>
        </div>}
        {state === 'error' && <p className="workflow-catalog-error" role="alert">
          {zh ? '工作流读取失败，请重试。' : 'Could not load workflows. Please retry.'}
        </p>}
        {state === 'unsupported' && <p className="workflow-catalog-empty" role="status">
          {zh ? '当前版本不支持工作流列表查询。' : 'Workflow listing is unavailable in this version.'}
        </p>}
        {state === 'no-session' && <p className="workflow-catalog-empty" role="status">
          {zh ? '请先打开一个已有会话。' : 'Open an existing conversation first.'}
        </p>}
        {state === 'ready' && catalog && <>
          {catalog.issues.map(item => <p className="workflow-catalog-warning" key={`${item.section}:${item.reason}`} role="status">
            {issueLabels[item.section]} · {reasonLabels[item.reason]}
          </p>)}
          <h3>{zh ? '已保存' : 'Saved'}<span>{catalog.saved.length}</span></h3>
          {!catalog.saved.length && <p className="workflow-catalog-empty">
            {catalog.issues.some(item => item.section !== 'runs' && item.reason !== 'limited')
              ? zh ? '暂无可显示的保存项。' : 'No definitions available to display.'
              : zh ? '没有保存的工作流。' : 'No saved workflows.'}
          </p>}
          <div className="workflow-catalog-saved">{catalog.saved.map(item => <div key={item.id}>
            <GitBranch size={15} aria-hidden="true"/><span>{item.name}</span>
            <small>{item.scope === 'project' ? zh ? '项目' : 'Project' : 'Desktop'}</small>
          </div>)}</div>
          <h3>{zh ? '近期运行' : 'Recent runs'}<span>{catalog.runs.length}</span></h3>
          {!catalog.runs.length ? <p className="workflow-catalog-empty">
            {catalog.issues.some(item => item.section === 'runs' && item.reason !== 'limited')
              ? zh ? '暂无可显示的运行记录。' : 'No runs available to display.'
              : zh ? '当前项目还没有运行记录。' : 'No workflow runs in this project.'}
          </p> : <table className="workflow-catalog-runs">
            <thead><tr><th>{zh ? '工作流' : 'Workflow'}</th><th>{zh ? '状态' : 'Status'}</th>
              <th>{zh ? '完成 / 代理' : 'Done / agents'}</th></tr></thead>
            <tbody>{catalog.runs.map(run => <tr key={run.runId} data-workflow-status={run.status}>
              <td><strong>{run.name === 'inline' ? zh ? '临时工作流' : 'Inline workflow' : run.name || run.runId}</strong>
                <small>{run.name && <>{run.runId} · </>}{date(run.startedAt ?? run.modifiedAt)}</small>
                {run.recordedStatus && <small>{zh ? '尚无存活运行确认' : 'Live execution not confirmed'}</small>}
              </td>
              <td><span className={`workflow-catalog-state is-${run.status}`}>
                <i/>{workflowStatusLabels[run.status][zh ? 0 : 1]}
              </span></td>
              <td className="workflow-catalog-count">{run.completedAgents ?? '?'} / {run.totalAgents ?? '?'}</td>
            </tr>)}</tbody>
          </table>}
        </>}
        <details ref={details} className="workflow-catalog-scope" data-expanded={expanded}>
          <summary aria-expanded={expanded} onClick={event => { event.preventDefault(); setExpanded(value => !value); }}>
            {zh ? '记录范围' : 'Record scope'}<span><DisclosureChevron/></span>
          </summary>
          <div ref={body} inert={!expanded} aria-hidden={!expanded}><p>
            {zh ? '保存项包含当前项目与 Desktop 全局定义，同名时优先项目定义。运行记录来自当前项目，不等同于当前会话的代理列表。'
              : 'Definitions include this project and the Desktop profile; project names take precedence. Runs belong to this project, not just the current conversation.'}
          </p></div>
        </details>
      </div>
      <footer><span>{paused ? zh ? '已暂停收起' : 'Auto-close paused'
        : zh ? `${Math.ceil(remaining / 1000)} 秒后收起` : `Closes in ${Math.ceil(remaining / 1000)}s`}</span>
        <span>{zh ? '只读记录' : 'Read-only records'}</span></footer>
      <button type="button" className="workflow-catalog-grab" aria-label={zh ? '收起工作流面板' : 'Dismiss workflows'}
        data-tooltip={zh ? '向上拖动或点击收起' : 'Drag up or click to dismiss'}
        onPointerDown={startDrag} onPointerMove={moveDrag} onPointerUp={event => finishDrag(event)}
        onPointerCancel={event => finishDrag(event, true)} onLostPointerCapture={event => finishDrag(event, true)}
        onClick={event => { if (event.detail === 0 || !suppressClick.current) close(); }}><span/></button>
      <div className="workflow-catalog-timer" aria-hidden="true" style={{ transform: `scaleX(${remaining / AUTO_CLOSE_MS})` }}/>
    </section>
  </div>;
}
