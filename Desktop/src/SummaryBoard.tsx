import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ArrowUpRight, Bot, Check, CircleHelp, FileDiff, GitBranch, Layers3, ListTodo, X } from 'lucide-react';
import { McpIcon } from './McpIcon';
import type { Message, RepositoryDiff, SessionSummary, SummaryTask } from './contracts';
import type { SubagentTask } from './conversation-presentation';
import { summaryActivity, summaryAgents } from './summary-activity';
import { DisclosureChevron } from './DisclosureChevron';
import { DiffCount } from './DiffCount';
import { SubagentStatusIcon } from './SubagentStatusIcon';
import { TaskProgress } from './TaskProgress';
import './summary-board.css';

function TaskRow({ task, visible, language, animateEntrance }: { task: SummaryTask; visible: boolean; language: 'zh' | 'en'; animateEntrance: boolean }) {
  const [open, setOpen] = useState(false);
  const [entering] = useState(animateEntrance);
  const id = useId();
  return <li className={`sb-disclosure sb-task-shell${entering ? ' is-new' : ''}${visible ? ' is-open' : ''}`} aria-hidden={!visible} inert={!visible}>
    <div><div className={`sb-step is-${task.status}`}>
      <button className="sb-step-trigger" type="button" aria-expanded={open} aria-controls={id}
        aria-label={`${task.subject} · ${{ pending: language === 'zh' ? '待推进' : 'Pending', in_progress: language === 'zh' ? '进行中' : 'In progress', completed: language === 'zh' ? '已完成' : 'Completed', failed: language === 'zh' ? '已失败' : 'Failed' }[task.status]}`} onClick={() => setOpen(!open)}>
        <span className="sb-step-symbol"><SubagentStatusIcon language={language} state={task.status === 'pending' ? 'pending' : task.status === 'in_progress' ? 'running' : task.status === 'failed' ? 'failed' : 'done'}/></span>
        <span>{task.subject}</span><span className={`sb-fold-icon${open ? ' is-open' : ''}`}><DisclosureChevron/></span>
      </button>
      <div id={id} className={`sb-disclosure${open ? ' is-open' : ''}`} aria-hidden={!open} inert={!open}>
        <div><p className="sb-step-detail">{task.description || task.subject}</p></div>
      </div>
    </div></div>
  </li>;
}

export function SummaryBoard({ runtimeId, sessionId, language, onOpenChanges, messages = [], busy = false, onOpenSubagent, onOpenWorkflow, onClose }: {
  runtimeId?: string; sessionId?: string; language: 'zh' | 'en'; onOpenChanges: () => void;
  messages?: Message[]; busy?: boolean; onOpenSubagent?: (task: SubagentTask) => void; onOpenWorkflow?: (id: string) => void; onClose?: () => void;
}) {
  const [model, setModel] = useState<SessionSummary>();
  const [repository, setRepository] = useState<RepositoryDiff>();
  const [failed, setFailed] = useState(false);
  const [completedOpen, setCompletedOpen] = useState(false);
  const [mcpOpen, setMcpOpen] = useState(false);
  const [recent, setRecent] = useState<string[]>([]);
  const previous = useRef(new Map<string, string>());
  const hasSnapshot = useRef(false);
  const mcpId = useId();
  const t = (zh: string, en: string) => language === 'zh' ? zh : en;
  useEffect(() => {
    if (!runtimeId || !sessionId || !window.desktop) return;
    let live = true;
    let reading = false;
    let queued = false;
    let timer: ReturnType<typeof setTimeout>;
    const read = async () => {
      if (!live) return;
      if (reading) { queued = true; return; }
      reading = true;
      clearTimeout(timer);
      try {
        const value = await window.desktop!.summary(runtimeId);
        if (live && value.sessionId === sessionId) { setModel(value); setFailed(false); }
      } catch { if (live) setFailed(true); }
      reading = false;
      if (live) {
        const delay = queued ? 0 : 1200;
        queued = false;
        timer = setTimeout(read, delay);
      }
    };
    void read();
    const unsubscribe = window.desktop.onEvent?.(event => {
      if (event.runtimeId === runtimeId && (!event.sessionId || event.sessionId === sessionId)
        && ['tool_execution_end', 'agent_end'].includes(event.type)) void read();
    });
    return () => { live = false; clearTimeout(timer); unsubscribe?.(); };
  }, [runtimeId, sessionId]);
  useEffect(() => {
    if (!runtimeId || !window.desktop) return;
    let live = true;
    let timer: ReturnType<typeof setTimeout>;
    const read = async () => {
      try { const value = await window.desktop!.repositoryDiff(runtimeId); if (live) setRepository(value); }
      catch { if (live) setRepository(undefined); }
      if (live) timer = setTimeout(read, 5000);
    };
    void read();
    return () => { live = false; clearTimeout(timer); };
  }, [runtimeId]);
  useLayoutEffect(() => {
    const key = (task: SummaryTask) => `${model?.plan?.id ?? ''}:${task.id}`;
    const newlyCompleted = model?.tasks.filter(task => {
      const before = previous.current.get(key(task));
      return task.status === 'completed' && before !== undefined && before !== 'completed';
    }).map(key) ?? [];
    previous.current = new Map(model?.tasks.map(task => [key(task), task.status]));
    if (model) hasSnapshot.current = true;
    if (newlyCompleted.length) setRecent(ids => [...new Set([...ids, ...newlyCompleted])]);
  }, [model]);
  useEffect(() => {
    if (!recent.length) return;
    const timer = setTimeout(() => setRecent([]), 1100);
    return () => clearTimeout(timer);
  }, [recent]);
  const tasks = model?.tasks ?? [];
  const agents = useMemo(() => sessionId ? summaryAgents(messages, busy) : [], [messages, busy, sessionId]);
  const activity = summaryActivity(model?.tasks, agents, failed, busy);
  const done = tasks.filter(task => task.status === 'completed');
  const connected = model?.mcp.filter(server => server.status === 'connected').length ?? 0;
  const root = repository?.root?.replace(/\\/g, '/').split('/').at(-1);
  const activityLabel = activity === 'running' ? busy ? t('会话运行中', 'Conversation running') : t('任务或代理进行中', 'Task or agent running')
    : activity === 'completed' ? t('任务与代理已全部完成', 'All tasks and agents completed')
    : activity === 'unknown' ? t('活动状态未知', 'Activity unknown') : t('暂无进行中的任务或代理', 'No running tasks or agents');
  return <><header>
    <h2 className="sb-header-title"><span className="sb-activity" data-state={activity} role="img" aria-label={activityLabel} data-tooltip={activityLabel}/>{t('摘要', 'Summary')}</h2>
    <div className="sb-header-metrics">
      {!!tasks.length && <span aria-label={t(`任务 ${done.length} / ${tasks.length} 项完成`, `${done.length} of ${tasks.length} tasks completed`)}><ListTodo size={12} aria-hidden="true"/>{done.length}/{tasks.length}</span>}
      {!!agents.length && <span aria-label={t(`${agents.length} 条代理记录`, `${agents.length} agent records`)}><Bot size={12}/>{agents.length}</span>}
    </div>
    <button type="button" className="icon-button" aria-label={t('关闭侧栏', 'Close panel')} data-tooltip={t('关闭侧栏', 'Close panel')} onClick={onClose}><X size={16}/></button>
  </header><div className="summary-content"><div className="sb-content">
    {repository && ['ready', 'unborn'].includes(repository.state) && <section className="sb-repository" aria-label={t('仓库概览', 'Repository overview')}>
      <h3>{root}</h3><div className="sb-repo-branch"><GitBranch size={12}/><span>{repository.branch || t('尚无提交', 'No commits')}</span></div>
      <button className="sb-repo-change" type="button" onClick={onOpenChanges}>
        <FileDiff size={15} strokeWidth={1.5}/><span className="sb-repo-change-label">{t('仓库变更', 'Repository changes')}</span>
        <span className="sb-repo-counts"><DiffCount value={repository.added} kind="added"/><DiffCount value={repository.removed} kind="removed"/></span><ArrowUpRight size={13}/>
      </button><div className="sb-repo-scope"><span>{repository.base ? `${t('相对', 'Against')} ${repository.base} · ${t('含工作区', 'includes worktree')}` : t('尚无比较基线', 'No comparison base')}</span>
        <span>{repository.truncated ? '≥ ' : ''}{repository.files.length} {t('个文件', 'files')}</span></div>
    </section>}
    <section className="sb-steps" aria-label={t('推进清单', 'Task plan')}>
      <div className="sb-section-heading"><h4>{t('推进清单', 'Task plan')}</h4><span className="sb-step-count">{model ? <><strong>{done.length}</strong> / {tasks.length}</> : '--'}</span></div>
      {model?.plan && <p className="sb-plan-title">{model.plan.title}</p>}
      {failed && <p className="sb-state" role="status">{t('暂时无法读取，正在重试', 'Could not refresh. Retrying.')}</p>}
      {!tasks.length && <p className="sb-state">{!runtimeId || !sessionId ? t('请先打开一个会话', 'Open a session first') : model ? t('暂无任务清单', 'No task plan yet') : t('读取中', 'Loading')}</p>}
      {!!done.length && <button className="sb-completed-trigger" type="button" aria-expanded={completedOpen} onClick={() => setCompletedOpen(!completedOpen)}>
        <Check size={13}/><span>{t(`已完成 ${done.length} 项`, `${done.length} completed`)}</span><span className={`sb-fold-icon${completedOpen ? ' is-open' : ''}`}><DisclosureChevron/></span>
      </button>}
      <ol>{tasks.map(task =>
        <TaskRow key={`${model?.plan?.id ?? ''}:${task.id}`} task={task} language={language}
          animateEntrance={hasSnapshot.current && !previous.current.has(`${model?.plan?.id ?? ''}:${task.id}`)}
          visible={task.status !== 'completed' || completedOpen || recent.includes(`${model?.plan?.id ?? ''}:${task.id}`)}/>)}</ol>
      {!!tasks.length && <TaskProgress key={JSON.stringify([model?.plan?.id, tasks.map(task => task.id)])}
        runtimeId={runtimeId} sessionId={sessionId} total={tasks.length} completed={done.length} busy={busy} language={language}/>}
    </section>
    <section className="sb-agents" aria-label={t('代理记录', 'Agent records')}>
      <div className="sb-section-heading"><h4>{t('代理记录', 'Agent records')}</h4><span className="sb-step-count">{agents.length}</span></div>
      <ul>{agents.map(agent => {
        const state = ({ queued: 'pending', running: 'running', completed: 'done', failed: 'failed', aborted: 'stopped', skipped: 'skipped', cached: 'done', unknown: 'unknown' } as const)[agent.status];
        const statusLabel = { queued: t('待执行', 'Queued'), running: t('进行中', 'Running'), completed: t('已完成', 'Completed'),
          failed: t('已失败', 'Failed'), aborted: t('已停止', 'Stopped'), skipped: t('已跳过', 'Skipped'), cached: t('缓存复用', 'Cached'), unknown: t('未知', 'Unknown') }[agent.status];
        const label = agent.carried ? `${t('后台', 'Background')} · ${statusLabel}` : statusLabel;
        return <li key={agent.key}><button type="button" className="sb-agent-row" data-agent-status={agent.status}
          disabled={agent.target.type === 'subagent' ? !onOpenSubagent : !onOpenWorkflow}
          aria-label={`${t('查看代理记录', 'Open agent record')}: ${label}, ${agent.task || agent.agent}`}
          onClick={() => agent.target.type === 'subagent' ? onOpenSubagent?.(agent.target.task) : onOpenWorkflow?.(agent.target.id)}>
          <Bot size={14}/>{state === 'unknown' ? <CircleHelp size={16} aria-hidden="true"/> : <SubagentStatusIcon state={state} language={language}/>}
          <span className="sb-agent-text"><span><strong>{agent.agent || t('子代理', 'Subagent')}</strong><small>{label}</small></span>
            <span>{agent.task || t('无任务描述', 'No task description')}</span></span>
          <span className="sb-agent-chevron"><DisclosureChevron/></span>
        </button></li>;
      })}</ul>
      {!agents.length && <p className="sb-state">{t(sessionId ? '本轮暂无代理记录' : '请先打开一个会话', sessionId ? 'No agent records this turn' : 'Open a session first')}</p>}
    </section>
    <section className="sb-mcp">
      <button className="sb-mcp-trigger" type="button" aria-expanded={mcpOpen} aria-controls={mcpId} onClick={() => setMcpOpen(!mcpOpen)}>
        <McpIcon size={14}/><span>MCP</span><span className={`sb-fold-icon${mcpOpen ? ' is-open' : ''}`}><DisclosureChevron/></span>
        <span className="sb-mcp-count">{model ? `${connected} / ${model.mcp.length}` : '--'}</span>
      </button><div id={mcpId} className={`sb-disclosure${mcpOpen ? ' is-open' : ''}`} aria-hidden={!mcpOpen} inert={!mcpOpen}><div><ul className="sb-mcp-list">
        {model?.mcp.map(server => <li key={server.name} className={`sb-mcp-server is-${server.status}`}>
          <span className={`sb-service-switch${server.status !== 'disabled' ? ' is-enabled' : ''}`} aria-hidden="true"><i/></span>
          <span className="sb-server-name">{server.name}</span><span className="sb-server-status">{({
            connected: t('已连接', 'Connected'), connecting: t('连接中', 'Connecting'), failed: t('连接失败', 'Failed'), disabled: t('已关闭', 'Disabled'),
          })[server.status]}</span>
        </li>)}{model && !model.mcp.length && <li className="sb-state">{t('没有已配置的服务', 'No configured servers')}</li>}
      </ul></div></div>
    </section>
    <section className="sb-skills"><Layers3 size={14}/><span>{t('可用 Skills', 'Available Skills')}</span><strong>{model?.skillCount ?? '--'}</strong></section>
  </div></div></>;
}
