import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ChevronRight, X } from 'lucide-react';
import type { Message } from './contracts';
import type { SubagentTask } from './conversation-presentation';
import { responsePresentation } from './conversation-presentation';
import { Tool, Text } from './ConversationMessages';
import { redactSubagentMessages } from './subagent-redact';
import { RightPanelExpandButton } from './RightPanelExpandButton';
import { SubagentStatusIcon } from './SubagentStatusIcon';
import './subagent-panel.css';
import type { WorkflowState } from './workflow-state';
import { WorkflowAgentDetail, WorkflowOverview } from './WorkflowView';
import { AppMenu } from './AppMenu';
import { DisclosureChevron } from './DisclosureChevron';
import { workflowCount, workflowIcon } from './workflow-state';

function SubagentTranscript({ task, ...props }: { task: SubagentTask } & Pick<Parameters<typeof Text>[0], 'language' | 'openImage' | 'onError'>) {
  // A child call's arguments and result text are new surfaces here, so credentials, cookies and
  // raw child environment values are filtered before the shared Tool renderer sees them.
  const redacted = useMemo(() => redactSubagentMessages(task.messages), [task.messages]);
  // The dispatched task is shown in the head, so the subagent's own copy of it is skipped here.
  const nested = responsePresentation(redacted.messages
    .map((message: Message, index: number) => ({ message, index }))
    .filter(entry => entry.message.role !== 'user'));
  return <>
    {redacted.redacted > 0 && <p className="subagent-note">{props.language === 'zh'
      ? `已隐去 ${redacted.redacted} 行疑似凭据内容。`
      : `${redacted.redacted} line(s) that looked like credentials were hidden.`}</p>}
    {nested.content.map(item => item.type === 'tool'
      ? <Tool key={item.key} item={item} active={false} {...props}/>
      : item.type === 'image' ? null
        : <div className="lane-text" key={item.key}><Text text={item.block.text ?? ''} {...props}/></div>)}
  </>;
}

function SubagentContent({ task, ...props }: { task: SubagentTask } & Pick<Parameters<typeof Text>[0], 'language' | 'openImage' | 'onError'>) {
  const zh = props.language === 'zh';
  const state = task.status === 'completed' ? 'done' : task.status === 'running' ? 'running' : task.status === 'queued' ? 'pending' : task.status === 'skipped' ? 'skipped' : task.status === 'aborted' ? 'stopped' : 'failed';
  const status = task.status === 'aborted' ? zh ? '已终止' : 'Stopped'
    : { pending: zh ? '待执行' : 'Pending', skipped: zh ? '已跳过' : 'Skipped', running: zh ? '进行中' : 'In progress', done: zh ? '完成' : 'Done', failed: zh ? '失败' : 'Failed', stopped: zh ? '已终止' : 'Stopped' }[state];
  // Activity only arrives with the final result; a running subagent has none yet.
  const hasTranscript = task.messages.some(message => message.role !== 'user' && message.display !== false);
  return <div className="subagent-body">
    <div className="subagent-head">
      <span className="lane-type">{task.agent || (zh ? '子代理' : 'Subagent')}</span>
      <span className="subagent-status" data-lane-state={task.status} role="img" aria-label={status}>
        <SubagentStatusIcon state={state} language={props.language}/>
      </span>
      {task.model && <span className="subagent-meta">{task.model}{task.turns ? ` · ${zh ? '轮次' : 'turns'} ${task.turns}` : ''}</span>}
    </div>
    <p className="subagent-task">{task.task || (zh ? '无任务描述' : 'No task description')}</p>
    <p className="subagent-note">{zh
      ? '只读记录。子代理由主会话分发任务后独立执行，此处无法与它对话，也无法追加指令。'
      : 'Read-only record. The subagent runs on its own after the dispatch; you cannot talk to it or send follow-ups here.'}</p>
    <div className="subagent-transcript">
      {hasTranscript ? <SubagentTranscript task={task} {...props}/>
        : state === 'running' ? <p className="panel-empty">{zh
          ? task.backgroundAgentId ? '运行中。后台任务未返回过程记录。' : '运行中。过程数据要等这个子代理跑完才随结果一起到达。'
          : task.backgroundAgentId ? 'Running. No activity record returned for this background task.' : 'Running. Its activity arrives with the result once it finishes.'}</p>
          : <p className="panel-empty">{state === 'pending' ? zh ? '等待前序步骤或可用执行名额。' : 'Waiting for earlier steps or execution capacity.'
            : state === 'skipped' ? zh ? '链路已停止，这一步没有执行。' : 'The chain stopped before this step ran.'
              : zh ? '无过程记录。' : 'No activity recorded.'}</p>}
    </div>
  </div>;
}

export function SubagentPanel({ open, replaced, overlay, expanded, task, workflows = [], workflowId, view = 'agent', agentId, onView, onWorkflow, onAgent, ...props }: {
  open: boolean; replaced: boolean; overlay: boolean; expanded: boolean; task: SubagentTask | null;
  workflows?: WorkflowState[]; workflowId?: string | null; view?: 'overview' | 'agent'; agentId?: string | null;
  onView?: (view: 'overview' | 'agent') => void; onWorkflow?: (id: string) => void; onAgent?: (id: string) => void;
  language: 'zh' | 'en'; onClose: () => void; onToggleExpanded: () => void;
  openImage: (src: string, name: string, anchor: HTMLElement) => void; onError: (message: string) => void;
}) {
  const [present, setPresent] = useState(open);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuAnchor = useRef<HTMLButtonElement>(null);
  const closeMenu = useCallback(() => setMenuOpen(false), []);
  useEffect(() => { setMenuOpen(false); }, [open, view, workflowId]);
  if (open && !present) setPresent(true);
  useLayoutEffect(() => {
    if (!open && matchMedia('(prefers-reduced-motion: reduce)').matches) setPresent(false);
  }, [open]);
  useEffect(() => {
    if (open || !present) return;
    const timer = setTimeout(() => setPresent(false), 260);
    return () => clearTimeout(timer);
  }, [open, present]);
  if (!present) return null;
  const zh = props.language === 'zh';
  const flow = workflows.find(flow => flow.toolCallId === workflowId);
  const agent = flow?.agents.find(agent => agent.id === agentId);
  return <div className={`subagent-track${open ? ' is-open' : ''}${overlay ? ' is-overlay' : ''}${replaced ? ' is-replaced' : ''}`}>
    <aside className={`subagent-panel right-inspector-surface${expanded ? ' is-expanded' : ''}${open ? '' : ' is-closing'}`} id="subagent-panel"
      aria-label={zh ? '子代理记录' : 'Subagent record'} aria-hidden={!open} inert={!open}>
      <header className="right-panel-header">
        <ChevronRight size={15}/>
        <h2>{zh ? '子代理' : 'Subagents'}</h2>
        <RightPanelExpandButton expanded={expanded} onToggle={props.onToggleExpanded} language={props.language}/>
        <button type="button" className="icon-button" aria-label={zh ? '关闭面板' : 'Close panel'} onClick={props.onClose}><X size={16}/></button>
      </header>
      {(flow || workflows.length > 0) && <div className="workflow-tabs" aria-label={zh ? '子代理视图' : 'Subagent view'}>
        <button type="button" aria-pressed={view === 'overview'} onClick={() => onView?.('overview')}>{zh ? '编排' : 'Orchestration'}</button>
        <button type="button" aria-pressed={view === 'agent'} disabled={!agent && !task} onClick={() => onView?.('agent')}>{zh ? '代理' : 'Agent'}</button>
      </div>}
      {view === 'overview' && workflows.length > 1 && <div className="workflow-run-picker">
        <button ref={menuAnchor} type="button" aria-label={zh ? '选择编排记录' : 'Choose workflow'}
          aria-haspopup="menu" aria-expanded={menuOpen} onClick={() => setMenuOpen(value => !value)}>
          <span>{flow?.name === 'inline' ? 'Ultracode' : flow?.name || 'Ultracode'} · {zh ? `第 ${workflows.findIndex(run => run.toolCallId === flow?.toolCallId) + 1} 次` : `Run ${workflows.findIndex(run => run.toolCallId === flow?.toolCallId) + 1}`}</span>
          <DisclosureChevron/>
        </button>
        <AppMenu anchor={menuAnchor} open={open && menuOpen} maxVisibleItems={5} label={zh ? '编排记录' : 'Workflow history'}
          selected={flow?.toolCallId} onClose={closeMenu} onSelect={id => onWorkflow?.(id)}
          items={[...workflows].reverse().map((run, index) => ({
            id: run.toolCallId,
            label: `${run.name === 'inline' ? 'Ultracode' : run.name} · ${zh ? `第 ${workflows.length - index} 次` : `Run ${workflows.length - index}`} · ${workflowCount(run)}`,
            icon: <SubagentStatusIcon state={workflowIcon(run.status)} language={props.language}/>,
          }))}/>
      </div>}
      <div className="workflow-pane" hidden={view !== 'overview'}>
        {flow ? <WorkflowOverview flow={flow} selected={agentId ?? undefined} onSelect={agent => onAgent?.(agent.id)} language={props.language}/>
          : <p className="panel-empty">{zh ? '暂无编排记录' : 'No orchestration recorded'}</p>}
      </div>
      <div className="workflow-pane" hidden={view !== 'agent'}>
        {agent ? <WorkflowAgentDetail agent={agent} language={props.language}/>
          : task ? <SubagentContent key={`${task.agent}:${task.task}`} task={task} {...props}/>
            : <p className="panel-empty">{zh ? '从编排中选择一个代理' : 'Select an agent from orchestration'}</p>}
      </div>
    </aside>
  </div>;
}
