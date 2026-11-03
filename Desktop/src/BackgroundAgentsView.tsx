import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ComponentType, type ReactNode } from 'react';
import { ArrowLeft, ArrowUpRight, Bot, CircleHelp, RefreshCw, Square, Timer } from 'lucide-react';
import type { BackgroundAgentClient, BackgroundAgentLane, BackgroundAgentSelection, BackgroundAgentSnapshot, BackgroundAgentStep } from './background-agents';
import { DisclosureChevron } from './DisclosureChevron';
import { SubagentStatusIcon } from './SubagentStatusIcon';
import { ElapsedLabel } from './ElapsedLabel';
import { Text } from './ConversationMessages';
import { toolPresentation } from './conversation-presentation';
import { useAnimatedDisclosure } from './useAnimatedDisclosure';
import { AppMenu } from './AppMenu';
import './background-agents.css';

export type BackgroundAgentStepProps = { step: BackgroundAgentStep; live: boolean; language: 'zh' | 'en'; showIdentity?: boolean }
  & Pick<Parameters<typeof Text>[0], 'openImage' | 'onError'>;
export interface BackgroundAgentPresentation {
  label: (agent: string, language: 'zh' | 'en') => ReactNode;
  Step: ComponentType<BackgroundAgentStepProps>;
}

function agentStatus(status: BackgroundAgentStep['status'], zh: boolean) {
  return { queued: zh ? '待执行' : 'Queued', running: zh ? '运行中' : 'Running', completed: zh ? '已完成' : 'Completed',
    failed: zh ? '失败' : 'Failed', aborted: zh ? '已停止' : 'Stopped', skipped: zh ? '已跳过' : 'Skipped',
    unknown: zh ? '状态未知' : 'Unknown' }[status];
}
export function BackgroundAgentStatusIcon({ status, language }: { status: BackgroundAgentStep['status']; language: 'zh' | 'en' }) {
  const state = { queued: 'pending', running: 'running', completed: 'done', failed: 'failed', aborted: 'stopped', skipped: 'skipped', unknown: 'unknown' } as const;
  return status === 'unknown' ? <CircleHelp size={16}/> : <SubagentStatusIcon state={state[status]} language={language}/>;
}
function AgentStep({ step, live, language, showIdentity = true, ...props }: BackgroundAgentStepProps) {
  const zh = language === 'zh';
  const format = (value?: number) => value === undefined ? '--' : value.toLocaleString(zh ? 'zh-CN' : 'en-US');
  return <section className="background-agent-step" aria-label={`${step.agent || (zh ? '子代理' : 'Subagent')} ${step.index + 1}`}>
    {showIdentity && <><div className="background-agent-step-head">
      <BackgroundAgentStatusIcon status={!live && ['running', 'queued'].includes(step.status) ? 'unknown' : step.status} language={language}/><strong>{step.agent || (zh ? '子代理' : 'Subagent')}</strong>
      <span>{!live && (zh ? '记录：' : 'Recorded: ')}{agentStatus(step.status, zh)}</span>
    </div>
    <p className="background-agent-task">{step.task || (zh ? '无任务描述' : 'No task description')}</p></>}
    <dl className="background-agent-metrics">
      <div><dt>{zh ? '模型' : 'Model'}</dt><dd>{step.model || '--'}</dd></div>
      <div><dt>{zh ? '轮次' : 'Turns'}</dt><dd>{format(step.usage.turns)}</dd></div>
      <div><dt>{zh ? '输入 Token' : 'Input tokens'}</dt><dd>{format(step.usage.input)}</dd></div>
      <div><dt>{zh ? '输出 Token' : 'Output tokens'}</dt><dd>{format(step.usage.output)}</dd></div>
      <div><dt>{zh ? '缓存读取' : 'Cache read'}</dt><dd>{format(step.usage.cacheRead)}</dd></div>
      <div><dt>{zh ? '缓存写入' : 'Cache write'}</dt><dd>{format(step.usage.cacheWrite)}</dd></div>
    </dl>
    {step.activeTool && step.status === 'running' && <p className="background-agent-tool">
      {!live && (zh ? '上次工具：' : 'Last tool: ')}{toolPresentation(step.activeTool, undefined, live, language).label || step.activeTool}
    </p>}
    {step.error && <p className="background-agent-error">{step.error}</p>}
    <h4>{live && step.status === 'running' ? zh ? '当前输出片段' : 'Current output excerpt' : zh ? '产出片段' : 'Output excerpt'}</h4>
    {step.output ? <div className="background-agent-output lane-text"><Text text={step.output} language={language} {...props}/></div>
      : <p className="background-agent-empty">{zh ? '未返回输出片段' : 'No output excerpt returned'}</p>}
    {(step.outputTruncated || step.redacted > 0) && <p className="background-agent-source">
      {step.outputTruncated && <span>{zh ? '仅显示末尾片段' : 'Showing the available tail only'}</span>}
      {step.redacted > 0 && <span>{zh ? `已隐去 ${step.redacted} 行疑似凭据内容` : `${step.redacted} credential-like line(s) hidden`}</span>}
    </p>}
  </section>;
}

function AgentLane({ lane, selected, active, stopping, onStop, onInspect, language, presentation, ...props }: {
  lane: BackgroundAgentLane; selected: boolean; active: boolean; stopping: boolean;
  onStop: () => Promise<void>; language: 'zh' | 'en'; presentation?: BackgroundAgentPresentation;
  onInspect?: (selection: BackgroundAgentSelection, trigger: HTMLButtonElement) => void;
} & Pick<Parameters<typeof Text>[0], 'openImage' | 'onError'>) {
  const [expanded, setExpanded] = useState(selected);
  const [confirm, setConfirm] = useState(false);
  const [agentMenuOpen, setAgentMenuOpen] = useState(false);
  const detailButton = useRef<HTMLButtonElement>(null);
  const closeAgentMenu = useCallback(() => setAgentMenuOpen(false), []);
  const { details, body } = useAnimatedDisclosure(expanded);
  const confirmationId = useId();
  const zh = language === 'zh';
  useEffect(() => {
    if (selected && active) {
      setExpanded(true);
      details.current?.scrollIntoView({ block: 'nearest', behavior: 'instant' });
    }
  }, [selected, active, details]);
  useEffect(() => { if (!active || stopping || lane.status !== 'running') setConfirm(false); }, [active, stopping, lane.status]);
  useEffect(() => { if (!active || lane.steps.length < 2) setAgentMenuOpen(false); }, [active, lane.steps.length]);
  const status = !active ? zh ? '上次记录' : 'Last recorded'
    : stopping || lane.settling ? zh ? '正在收尾' : 'Settling' : agentStatus(lane.status, zh);
  const mode = { single: zh ? '单任务' : 'Single', parallel: zh ? '并行' : 'Parallel', chain: zh ? '顺序执行' : 'Chain' }[lane.mode];
  const agents = [...new Set(lane.steps.map(step => step.agent).filter(Boolean))];
  const label = agents.join(' / ') || (zh ? '后台任务' : 'Background task');
  const Step = presentation?.Step ?? AgentStep;
  const canStop = active && lane.status === 'running' && !lane.settling && !stopping;
  const running = lane.status === 'running' || lane.settling;
  const timing = lane.startedAt && (active && running
    || lane.updatedAt !== undefined && lane.updatedAt >= lane.startedAt) ? { startedAt: lane.startedAt,
    endedAt: active && running ? undefined : lane.updatedAt } : undefined;
  const hasDetails = Boolean(onInspect && lane.steps.length);
  return <div className="background-agent-lane" data-expanded={expanded} data-lane-id={lane.id}
    data-lane-status={lane.status} data-settling={lane.settling || stopping}>
    <details className="background-agent-disclosure" ref={details} data-has-details={hasDetails || undefined}>
    <summary onClick={event => { event.preventDefault(); setExpanded(value => !value); }} aria-expanded={expanded}>
      <span className="background-agent-symbol"><BackgroundAgentStatusIcon status={!active ? 'unknown' : lane.settling || stopping ? 'running' : lane.status} language={language}/></span>
      <span className="background-agent-heading"><span><strong>{presentation && agents.length
        ? agents.map((agent, index) => <span key={agent}>{index > 0 && ' / '}{presentation.label(agent, language)}</span>) : label}</strong><small>{mode}</small></span>
        <span className="background-agent-preview">{lane.steps[0]?.task || lane.id}</span>
        <span className="background-agent-meta"><span>{status}</span>
          {timing ? <ElapsedLabel timing={timing} language={language} active={active && (lane.status === 'running' || lane.settling)}/>
            : <span><Timer size={11}/>{zh ? '耗时未知' : 'Duration unknown'}</span>}</span>
      </span>
      <span className={`background-agent-chevron${expanded ? ' is-open' : ''}`}><DisclosureChevron/></span>
    </summary>
    <div ref={body} aria-hidden={!expanded} inert={!expanded}><div className="background-agent-detail">
      <div className="background-agent-detail-toolbar"><code>{lane.id}</code>
        {(lane.status === 'running' || lane.settling || stopping) && <button type="button" className="background-agent-stop"
          disabled={!canStop} aria-expanded={confirm} aria-controls={confirmationId} onClick={() => setConfirm(value => !value)}>
          <Square size={12}/>{stopping || lane.settling ? zh ? '等待收尾' : 'Awaiting settlement' : zh ? '停止任务' : 'Stop task'}
        </button>}
      </div>
      {confirm && <div id={confirmationId} className="background-agent-confirm" role="group" aria-label={zh ? '确认停止后台任务' : 'Confirm background task stop'}>
        <p>{zh ? '停止这个后台任务？主会话和其他后台任务不受影响。' : 'Stop this background task? The parent and other background tasks will continue.'}</p>
        <div><button type="button" onClick={() => setConfirm(false)}>{zh ? '取消' : 'Cancel'}</button>
          <button type="button" className="background-agent-stop" onClick={() => { setConfirm(false); void onStop(); }}><Square size={12}/>{zh ? '停止此任务' : 'Stop this task'}</button></div>
      </div>}
      {stopping && <p className="background-agent-source" role="status">{zh ? '停止请求已发送，等待运行时确认退出。' : 'Stop requested. Waiting for the runtime to settle.'}</p>}
      {lane.steps.map(step => <div className="background-agent-step-entry" key={step.index} data-step-index={step.index}>
        <Step step={step} live={active} language={language} showIdentity={lane.steps.length > 1} {...props}/>
      </div>)}
      {!lane.steps.length && <p className="background-agent-empty">{zh ? '运行时未返回过程记录' : 'No activity record returned'}</p>}
      {lane.omittedSteps > 0 && <p className="background-agent-source">{zh ? `另有 ${lane.omittedSteps} 个步骤未随本次快照返回。` : `${lane.omittedSteps} additional step(s) were not included in this snapshot.`}</p>}
    </div></div>
    </details>
    {hasDetails && <>
      <button ref={detailButton} type="button" className="icon-button background-agent-inspect"
        aria-label={zh ? '查看代理详情' : 'View agent details'}
        data-tooltip={lane.steps.length > 1 ? zh ? '选择代理步骤' : 'Choose agent step' : zh ? '查看代理详情' : 'View agent details'}
        aria-haspopup={lane.steps.length > 1 ? 'menu' : undefined}
        aria-expanded={lane.steps.length > 1 ? agentMenuOpen : undefined}
        onClick={event => {
          if (lane.steps.length === 1) onInspect?.({ laneId: lane.id, stepIndex: lane.steps[0].index }, event.currentTarget);
          else setAgentMenuOpen(value => !value);
        }}><ArrowUpRight size={15}/></button>
      {lane.steps.length > 1 && <AppMenu anchor={detailButton} open={agentMenuOpen} onClose={closeAgentMenu}
        label={zh ? '选择代理步骤' : 'Choose agent step'} maxVisibleItems={5}
        items={lane.steps.map(step => ({ id: String(step.index),
          label: `${zh ? `第 ${step.index + 1} 步` : `Step ${step.index + 1}`} · ${step.agent || (zh ? '子代理' : 'Subagent')} · ${step.task || (zh ? '无任务描述' : 'No task description')}`,
          icon: <BackgroundAgentStatusIcon status={!active && ['running', 'queued'].includes(step.status) ? 'unknown' : step.status} language={language}/>,
        }))}
        onSelect={id => {
          const step = lane.steps.find(step => String(step.index) === id);
          if (step && detailButton.current) onInspect?.({ laneId: lane.id, stepIndex: step.index }, detailButton.current);
        }}/>}
    </>}
  </div>;
}

export function BackgroundAgentsView({ open, runtimeId, sessionId, connected, selectedLaneId, client = window.desktop, language, presentation,
  detail, onDetail, onBack, ...props }: {
  open: boolean; runtimeId?: string; sessionId?: string; connected: boolean; selectedLaneId?: string;
  client?: BackgroundAgentClient; language: 'zh' | 'en'; presentation?: BackgroundAgentPresentation;
  detail?: BackgroundAgentSelection; onDetail?: (selection: BackgroundAgentSelection) => void; onBack?: () => void;
} & Pick<Parameters<typeof Text>[0], 'openImage' | 'onError'>) {
  const [snapshot, setSnapshot] = useState<BackgroundAgentSnapshot>();
  const [failed, setFailed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [actionError, setActionError] = useState(false);
  const [stopping, setStopping] = useState<Set<string>>(new Set());
  const stopLocks = useRef(new Set<string>());
  const refresh = useRef<() => void>(() => {});
  const list = useRef<HTMLDivElement>(null);
  const listScroll = useRef(0);
  const backButton = useRef<HTMLButtonElement>(null);
  const returnTrigger = useRef<HTMLButtonElement | null>(null);
  const wasDetail = useRef(false);
  const identity = useMemo(() => ({ runtimeId, sessionId }), [runtimeId, sessionId]);
  const owner = useRef<typeof identity | undefined>(identity);
  owner.current = identity;
  const zh = language === 'zh';
  useEffect(() => {
    setSnapshot(undefined); setFailed(false); setActionError(false); setStopping(new Set());
    stopLocks.current = new Set();
  }, [identity]);
  useEffect(() => { owner.current = identity; return () => { owner.current = undefined; }; }, [identity]);
  useLayoutEffect(() => {
    const returning = wasDetail.current && !detail;
    wasDetail.current = Boolean(detail);
    if (!open) return;
    if (detail) backButton.current?.focus({ preventScroll: true });
    else if (returning) {
      if (list.current) list.current.scrollTop = listScroll.current;
      if (returnTrigger.current?.isConnected) returnTrigger.current.focus({ preventScroll: true });
      else list.current?.focus({ preventScroll: true });
    }
  }, [detail, open]);
  useEffect(() => {
    if (!open || !connected || !runtimeId || !sessionId || !client) return;
    let live = true, reading = false, queued = false;
    let timer: ReturnType<typeof setTimeout>;
    const read = async () => {
      if (!live) return;
      if (reading) { queued = true; return; }
      reading = true; clearTimeout(timer); setRefreshing(true);
      try {
        const value = await client.backgroundAgents(runtimeId, sessionId);
        if (value.sessionId !== sessionId || !Array.isArray(value.lanes)) throw new Error('Session changed');
        if (live) {
          setSnapshot(value); setFailed(false);
          setStopping(previous => new Set([...previous].filter(id => value.lanes.some(lane =>
            lane.id === id && (lane.status === 'running' || lane.settling)))));
        }
      } catch { if (live) setFailed(true); }
      finally {
        reading = false;
        if (live) {
          setRefreshing(false);
          const delay = queued ? 0 : 1500;
          queued = false; timer = setTimeout(read, delay);
        }
      }
    };
    refresh.current = () => { void read(); };
    void read();
    const unsubscribe = window.desktop?.onEvent?.(event => {
      if (event.runtimeId === runtimeId && (!event.sessionId || event.sessionId === sessionId)
        && ['desktop_background_changed', 'agent_end'].includes(event.type)) void read();
    });
    return () => { live = false; clearTimeout(timer); refresh.current = () => {}; unsubscribe?.(); };
  }, [open, connected, runtimeId, sessionId, client]);
  const stop = async (lane: BackgroundAgentLane) => {
    if (!open || !connected || failed || !client || !runtimeId || !sessionId || lane.status !== 'running'
      || lane.settling || stopLocks.current.has(lane.id)) return;
    const locks = stopLocks.current;
    locks.add(lane.id);
    setStopping(value => new Set([...value, lane.id])); setActionError(false);
    try { await client.stopBackgroundAgent(runtimeId, sessionId, lane.id); }
    catch {
      if (owner.current === identity) {
        setActionError(true);
        setStopping(value => new Set([...value].filter(id => id !== lane.id)));
      }
    } finally {
      locks.delete(lane.id);
      if (owner.current === identity) refresh.current();
    }
  };
  const lanes = snapshot && snapshot.sessionId === sessionId ? snapshot.lanes : undefined;
  const running = lanes?.filter(lane => lane.status === 'running' || lane.settling).length ?? 0;
  const selectedLane = detail && lanes?.find(lane => lane.id === detail.laneId);
  const selectedStep = selectedLane?.steps.find(step => step.index === detail?.stepIndex);
  const live = open && connected && !failed;
  const Step = presentation?.Step ?? AgentStep;
  const inspect = onDetail ? (selection: BackgroundAgentSelection, trigger: HTMLButtonElement) => {
    listScroll.current = list.current?.scrollTop ?? 0;
    returnTrigger.current = trigger;
    onDetail(selection);
  } : undefined;
  return <div className="background-agents-view">
    <div className="background-agents-list" ref={list} hidden={Boolean(detail)} tabIndex={-1}>
    <div className="background-agents-toolbar"><Bot size={14}/>
      <span>{lanes ? !connected || failed ? zh ? `${lanes.length} 条上次记录` : `${lanes.length} last-known records`
        : zh ? `${running} 个进行中 · ${lanes.length - running} 个已结束` : `${running} active · ${lanes.length - running} settled`
        : zh ? '后台任务' : 'Background tasks'}</span>
      <button type="button" className="icon-button" disabled={!connected || refreshing || !runtimeId || !sessionId}
        aria-label={zh ? '刷新后台任务' : 'Refresh background tasks'} data-tooltip={zh ? '刷新后台任务' : 'Refresh background tasks'} onClick={() => refresh.current()}><RefreshCw size={14}/></button>
    </div>
    {!connected ? <p className="background-agent-empty" role="status">{zh ? '会话未连接，保留的记录不是运行状态。' : 'Session disconnected. Retained records are not live status.'}</p>
      : failed && <p className="background-agent-error" role="status">{zh
        ? lanes ? '无法刷新后台任务。当前显示上次记录，暂不可停止任务。' : '无法读取后台任务，暂不可停止任务。可手动刷新重试。'
        : 'Could not refresh background tasks. Any displayed records are stale; stop controls are unavailable.'}</p>}
    {actionError && <p className="background-agent-error" role="alert">{zh
      ? '停止结果未确认，请刷新状态后再判断；未自动重试。'
      : 'Stop outcome unconfirmed. Refresh to check the state; no retry was sent.'}</p>}
    {!lanes && connected && !failed && <div className="background-agents-loading" role="status">{zh ? '正在读取后台任务' : 'Loading background tasks'}<i/><i/><i/></div>}
    {lanes && selectedLaneId && !lanes.some(lane => lane.id === selectedLaneId) && <p className="background-agent-source" role="status">{zh
      ? '这个任务已不在当前运行时的保留范围内，请查看原代理记录。'
      : 'This task is no longer retained in this runtime. Its original agent record remains available.'}</p>}
    {lanes?.map(lane => <AgentLane key={lane.id} lane={lane} selected={lane.id === selectedLaneId}
      active={live} stopping={stopping.has(lane.id)} onStop={() => stop(lane)} onInspect={inspect} language={language} presentation={presentation} {...props}/>)}
    {lanes?.length === 0 && <p className="background-agent-empty">{zh ? '当前运行时没有后台任务记录' : 'No background tasks in this runtime'}</p>}
    {lanes && <p className="background-agent-source background-agents-scope">{zh
      ? '当前会话运行时 · 最多保留最近 16 个已结束任务'
      : 'Current session runtime · Up to 16 recently settled tasks retained'}</p>}
    </div>
    {detail && <div className="background-agent-inspector" key={`${detail.laneId}:${detail.stepIndex}`}
      data-lane-id={detail.laneId} data-step-index={detail.stepIndex}>
      <div className="background-agent-inspector-nav">
        <button ref={backButton} type="button" onClick={onBack}><ArrowLeft size={13}/>{zh ? '返回后台任务' : 'Back to background tasks'}</button>
        <button type="button" className="icon-button" disabled={!connected || refreshing || !runtimeId || !sessionId}
          aria-label={zh ? '刷新代理详情' : 'Refresh agent details'} data-tooltip={zh ? '刷新代理详情' : 'Refresh agent details'}
          onClick={() => refresh.current()}><RefreshCw size={14}/></button>
      </div>
      {!connected || failed ? <p className="background-agent-source" role="status">{zh
        ? '当前显示上次记录，不代表实时运行状态。'
        : 'Showing last-known records, not live execution state.'}</p> : null}
      {!lanes && connected && !failed ? <p className="background-agent-empty" role="status">{zh ? '正在读取代理详情' : 'Loading agent details'}</p>
        : !selectedStep ? <p className="background-agent-empty" role="status">{zh
          ? '这个代理步骤已不在当前运行时快照中，未替换为其他代理。'
          : 'This agent step is not in the current runtime snapshot. No other agent was substituted.'}</p>
          : <>
            <div className="background-agent-inspector-title">
              <strong>{presentation?.label(selectedStep.agent, language) || selectedStep.agent || (zh ? '子代理' : 'Subagent')}</strong>
              <span><BackgroundAgentStatusIcon status={!live && ['running', 'queued'].includes(selectedStep.status) ? 'unknown' : selectedStep.status} language={language}/>
                {live ? agentStatus(selectedStep.status, zh) : zh ? '上次记录' : 'Last recorded'}</span>
            </div>
            <p className="background-agent-source">{zh ? '后台任务' : 'Background task'} · {zh ? `第 ${selectedStep.index + 1} 步` : `Step ${selectedStep.index + 1}`}</p>
            <p className="background-agent-task">{selectedStep.task || (zh ? '无任务描述' : 'No task description')}</p>
            <Step step={selectedStep} live={live} language={language} showIdentity={false} {...props}/>
            <p className="background-agent-source">{zh ? '运行时快照 · 输出片段' : 'Runtime snapshot · Output excerpt'}</p>
          </>}
    </div>}
  </div>;
}
