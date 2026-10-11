import { ChevronRight } from 'lucide-react';
import type { WorkflowAgent, WorkflowState } from './workflow-state';
import { workflowCount, workflowIcon } from './workflow-state';
import { SubagentStatusIcon } from './SubagentStatusIcon';
import { elapsedTime } from './elapsed-time';
import { useEffect, useState } from 'react';
import './workflow-view.css';

export function WorkflowElapsed({ startedAt, finishedAt, running }: { startedAt?: number; finishedAt?: number; running: boolean }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [running]);
  return startedAt !== undefined && (running || finishedAt !== undefined)
    ? <span className="workflow-elapsed">{elapsedTime({ startedAt, endedAt: finishedAt }, now)}</span> : null;
}
export function WorkflowTrigger({ flow, language, onOpen, settled = false }: { flow: WorkflowState; language: 'zh' | 'en'; onOpen: (id: string) => void; settled?: boolean }) {
  const status = settled && flow.status === 'running' ? 'unknown' : flow.status;
  const labels = {
    completed: ['编排已完成', 'Workflow completed'], failed: ['编排失败', 'Workflow failed'],
    aborted: ['编排已中断', 'Workflow interrupted'], budget_exceeded: ['编排预算耗尽', 'Workflow budget reached'],
    unknown: ['编排状态待确认', 'Workflow state unknown'], running: ['多代理协作', 'Multi-agent workflow'],
  };
  return <button type="button" className={`workflow-trigger${settled ? ' workflow-settled' : ''}`} data-workflow-state={status}
    onClick={() => onOpen(flow.toolCallId)} aria-controls="subagent-panel">
    <SubagentStatusIcon state={workflowIcon(status)} language={language}
      detail={settled && flow.status === 'running' ? language === 'zh' ? '本轮已结束，编排最终状态未返回' : 'Turn ended without a final workflow state' : undefined}/>
    <span>{settled ? labels[status][language === 'zh' ? 0 : 1] : flow.currentPhase || (language === 'zh' ? '多代理协作' : 'Multi-agent workflow')}</span>
    <span className="workflow-count">{workflowCount(flow)}</span><ChevronRight size={12}/>
  </button>;
}
export function WorkflowBlock({ flow, language, onOpen }: { flow: WorkflowState; language: 'zh' | 'en'; onOpen: (id: string) => void }) {
  const zh = language === 'zh';
  return <div className="workflow-inline">
    <button type="button" className="workflow-heading" onClick={() => onOpen(flow.toolCallId)} aria-controls="subagent-panel">
      <SubagentStatusIcon state={workflowIcon(flow.status)} language={language}/>
      <strong>{flow.name === 'inline' ? zh ? '多代理协作' : 'Multi-agent workflow' : flow.name}</strong>
      <span className="workflow-brand">Ultracode</span><span className="workflow-count">{workflowCount(flow)}</span><ChevronRight size={13}/>
    </button>
    <div className="workflow-inline-meta">{flow.currentPhase && <span>{flow.currentPhase}</span>}
      <WorkflowElapsed {...flow} running={flow.status === 'running'}/>
      {flow.agents.length > 0 && <span>{flow.agents.filter(a => a.status === 'running').length || ''}{flow.agents.some(a => a.status === 'running') ? zh ? ' 个运行中' : ' running' : zh ? `${flow.agents.length} 个代理` : `${flow.agents.length} agents`}</span>}
    </div>
  </div>;
}
export function WorkflowOverview({ flow, selected, onSelect, language }: {
  flow: WorkflowState; selected?: string; onSelect: (agent: WorkflowAgent) => void; language: 'zh' | 'en';
}) {
  const zh = language === 'zh';
  const groups = new Map<string, WorkflowAgent[]>();
  for (const agent of flow.agents) { const key = agent.phase ?? ''; groups.set(key, [...(groups.get(key) ?? []), agent]); }
  return <div className="workflow-overview">
    <div className="workflow-overview-heading"><SubagentStatusIcon state={workflowIcon(flow.status)} language={language}/>
      <strong>{flow.name === 'inline' ? zh ? '多代理协作' : 'Multi-agent workflow' : flow.name}</strong><span className="workflow-count">{workflowCount(flow)}</span></div>
    <div className="workflow-inline-meta"><span>Ultracode</span><WorkflowElapsed {...flow} running={flow.status === 'running'}/>
      {flow.spentTokens !== undefined && <span>{flow.spentTokens.toLocaleString()} tokens</span>}</div>
    {flow.status === 'budget_exceeded' && <p className="workflow-warning">{zh ? '已达到工作流预算上限' : 'Workflow budget reached'}</p>}
    {flow.status === 'unknown' && <p className="panel-empty">{zh ? '此记录未提供工作流状态。' : 'Workflow state is unavailable in this record.'}</p>}
    {[...groups].map(([phase, agents]) => <section className="workflow-phase" key={phase}>
      {phase && <h3>{phase}</h3>}
      {agents.map(agent => <button type="button" key={agent.id} className={`workflow-agent${selected === agent.id ? ' is-selected' : ''}`}
        onClick={() => onSelect(agent)} aria-label={`${agent.label || agent.id}: ${agent.task}`}>
        <SubagentStatusIcon state={workflowIcon(agent.status)} language={language} detail={agent.status === 'unknown' ? zh ? '工作流已结束，代理最终状态未返回' : 'Workflow ended; final agent state unavailable' : agent.status === 'cached' ? zh ? '已复用缓存结果' : 'Cached result reused' : undefined}/>
        <span className="workflow-agent-copy"><strong>{agent.label || agent.id}</strong>{agent.task && <span>{agent.task}</span>}</span>
        {agent.status === 'cached' ? <span className="workflow-cached">{zh ? '缓存' : 'Cached'}</span>
          : <WorkflowElapsed {...agent} running={agent.status === 'running'}/>}
        <ChevronRight size={12}/>
      </button>)}
    </section>)}
    {!flow.agents.length && <p className="panel-empty">{flow.status === 'running'
      ? zh ? '等待工作流返回代理进度。' : 'Waiting for agent progress.'
      : zh ? '未找到逐代理记录，保留工作流汇总。' : 'Individual agent records are unavailable; showing the workflow summary.'}</p>}
  </div>;
}
export function WorkflowAgentDetail({ agent, language }: { agent: WorkflowAgent; language: 'zh' | 'en' }) {
  const zh = language === 'zh';
  return <div className="subagent-body"><div className="subagent-head">
    <SubagentStatusIcon state={workflowIcon(agent.status)} language={language} detail={agent.status === 'unknown' ? zh ? '工作流已结束，代理最终状态未返回' : 'Workflow ended; final agent state unavailable' : undefined}/><strong>{agent.label || agent.id}</strong>
    <WorkflowElapsed {...agent} running={agent.status === 'running'}/></div>
    {agent.phase && <p className="workflow-detail-phase">{agent.phase}</p>}
    <p className="subagent-task">{agent.task || (zh ? '未提供任务描述' : 'Task description unavailable')}</p>
    {agent.usageTokens !== undefined && <p className="workflow-detail-phase">{agent.usageTokens.toLocaleString()} tokens</p>}
    {agent.status === 'cached' && <p className="workflow-detail-phase">{zh ? '本次复用了缓存结果。' : 'A cached result was reused.'}</p>}
    {agent.status === 'unknown' && <p className="workflow-detail-phase">{zh ? '工作流已结束，但此代理未返回最终状态。' : 'The workflow ended without a final state for this agent.'}</p>}
    <p className="subagent-note">{zh ? '工作流代理的只读记录。当前进度接口提供任务与状态，不包含完整对话。' : 'Read-only workflow agent record. The progress interface supplies task and state, not a full transcript.'}</p>
  </div>;
}
