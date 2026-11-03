import { useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { createRoot } from 'react-dom/client';
import { ArrowUpRight, Bot, Moon, RotateCcw, Sun } from 'lucide-react';
import { SubagentPanel } from '../../src/SubagentPanel';
import { AppTooltip } from '../../src/AppTooltip';
import type { BackgroundAgentClient, BackgroundAgentLane, BackgroundAgentSelection } from '../../src/background-agents';
import { AgentRoleLabel, rolePresentation, roleSamples } from './background-agent-roles';
import '../../src/style.css';
import '../../src/layout.css';
import '../../src/theme.css';
import './background-agents.css';

const params = new URLSearchParams(location.search);
document.documentElement.dataset.theme = params.get('theme') || 'light';
const language = params.get('lang') === 'en' ? 'en' : 'zh';
const now = Date.now();
const sample = (): BackgroundAgentLane[] => [
  { id: 'lane_12345678', mode: 'single', status: 'running', settling: false, startedAt: now - 83000, updatedAt: now,
    omittedSteps: 0, steps: [{ index: 0, agent: 'explore', task: '梳理会话恢复链路，核对后台宿主回收边界。', status: 'running',
      model: 'step-3.5-flash', startedAt: now - 83000, updatedAt: now, usage: { input: 18240, output: 2460, cacheRead: 12000, cacheWrite: 0, turns: 4 },
      activeTool: 'read_file', output: '### 会话恢复\n\n已确认宿主由主进程持有，正在核对切换会话时的回收条件。\n\n- 历史记录不会恢复进程所有权\n- 后台任务继续运行时保留原宿主',
      redacted: 0, outputTruncated: false }] },
  { id: 'lane_23456789', mode: 'parallel', status: 'running', settling: false, startedAt: now - 40000, updatedAt: now,
    omittedSteps: 0, steps: [
      { index: 0, agent: 'review', task: '独立审查任务停止的会话隔离。', status: 'running', usage: {}, output: '', redacted: 0, outputTruncated: false },
      { index: 1, agent: 'test', task: '核对迟到结果与重复停止请求。', status: 'queued', usage: {}, output: '', redacted: 0, outputTruncated: false },
    ] },
  { id: 'lane_34567890', mode: 'single', status: 'completed', settling: false, startedAt: now - 180000, updatedAt: now - 105000,
    omittedSteps: 0, steps: [{ index: 0, agent: 'test', task: '检查 IPC 参数校验与白名单投影。', status: 'completed', usage: { input: 8460, output: 1280, turns: 2 },
      model: 'step-3.5-flash', output: '接口参数校验通过。没有发现普通消息、账户路由或主任务停止逻辑被复用。', redacted: 0, outputTruncated: false }] },
  { id: 'lane_45678901', mode: 'single', status: 'failed', settling: false, startedAt: now - 220000, updatedAt: now - 200000,
    omittedSteps: 0, steps: [{ index: 0, agent: 'review', task: '核对外部依赖', status: 'failed', usage: {}, output: '', error: '上游请求失败，未返回完整结果。', redacted: 0, outputTruncated: false }] },
];
function Preview() {
  const [open, setOpen] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const [view, setView] = useState<'background' | 'overview' | 'agent'>('background');
  const [backgroundAgent, setBackgroundAgent] = useState<BackgroundAgentSelection>();
  const [presentation, setPresentation] = useState(params.get('presentation') === 'original' ? 'original' : 'roles');
  const [theme, setTheme] = useState(document.documentElement.dataset.theme || 'light');
  const [selectedLaneId, setSelectedLaneId] = useState(`role_${(params.get('agent') || 'explore').replace('-', '_')}`);
  const [scenario, setScenario] = useState(params.get('state') || 'normal');
  const [sessionId, setSessionId] = useState('session-a');
  const [generation, setGeneration] = useState(0);
  const [toolbarHeight, setToolbarHeight] = useState(62);
  const toolbar = useRef<HTMLElement>(null);
  const roles = useMemo(roleSamples, [generation]);
  const records = useRef<BackgroundAgentLane[]>([]);
  const zh = language === 'zh';
  useLayoutEffect(() => {
    setBackgroundAgent(undefined); setView('background');
  }, [generation, presentation, sessionId]);
  useLayoutEffect(() => {
    const element = toolbar.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setToolbarHeight(Math.ceil(element.getBoundingClientRect().height)));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const client = useMemo<BackgroundAgentClient>(() => {
    records.current = presentation === 'roles' ? structuredClone(roles) : sample();
    return {
      async backgroundAgents(_runtimeId, owner) {
        if (scenario === 'slow') await new Promise(resolve => setTimeout(resolve, 2000));
        if (scenario === 'error') throw new Error('Fixture unavailable');
        return { sessionId: owner, lanes: scenario === 'empty' || owner !== 'session-a' ? [] : structuredClone(records.current) };
      },
      async stopBackgroundAgent(_runtimeId, _owner, id) {
        if (scenario === 'stop-error') throw new Error('Fixture stop unconfirmed');
        const lane = records.current.find(lane => lane.id === id)!;
        lane.settling = true;
        await new Promise(resolve => setTimeout(resolve, 700));
        lane.settling = false; lane.status = 'aborted'; lane.updatedAt = Date.now();
        lane.steps = lane.steps.map(step => ({ ...step, status: step.status === 'completed' ? 'completed' : 'aborted' }));
      },
    };
  }, [scenario, generation, presentation, roles]);
  const selectRole = (id: string) => {
    setSelectedLaneId(id); setSessionId('session-a'); setBackgroundAgent(undefined); setView('background'); setOpen(true);
  };
  return <div className="app background-preview" data-presentation={presentation}
    style={{ '--window-bar-height': `${toolbarHeight}px` } as CSSProperties}>
    <header ref={toolbar} className="background-preview-toolbar">
      <img src="/StepCode.svg" width="24" height="24" alt=""/><strong>Step Code</strong>
      <span className="background-preview-data">{zh ? '演示数据' : 'Sample data'}</span>
      <div className="background-preview-mode" role="group" aria-label={zh ? '展示方式' : 'Presentation'}>
        <button aria-pressed={presentation === 'roles'} onClick={() => setPresentation('roles')}>{zh ? '角色设计' : 'Role view'}</button>
        <button aria-pressed={presentation === 'original'} onClick={() => setPresentation('original')}>{zh ? '原版' : 'Original'}</button>
      </div>
      <select aria-label="Scenario" value={scenario} onChange={event => setScenario(event.target.value)}>
        {['normal', 'empty', 'slow', 'error', 'stop-error', 'disconnected'].map(value => <option key={value}>{value}</option>)}
      </select>
      <button className="icon-button" aria-label={zh ? '重置演示' : 'Reset preview'} data-tooltip={zh ? '重置演示' : 'Reset preview'}
        onClick={() => setGeneration(value => value + 1)}><RotateCcw size={15}/></button>
      <button className="icon-button" aria-label={zh ? '切换主题' : 'Toggle theme'} data-tooltip={zh ? '切换主题' : 'Toggle theme'}
        onClick={() => {
          const next = theme === 'light' ? 'dark' : 'light';
          document.documentElement.dataset.theme = next; setTheme(next);
        }}>{theme === 'light' ? <Moon size={15}/> : <Sun size={15}/>}</button>
      <button className="icon-button" aria-label={zh ? '子代理面板' : 'Subagent panel'} aria-pressed={open}
        data-tooltip={zh ? '子代理面板' : 'Subagent panel'} onClick={() => setOpen(value => !value)}><Bot size={15}/></button>
    </header>
    <main className="background-preview-conversation">
      <div className="background-preview-prompt">梳理会话恢复链路，并行安排审查和测试。</div>
      <p>后台任务已派发。主会话可以继续处理下一项工作。</p>
      {presentation === 'roles' && <section className="background-preview-team" aria-label={zh ? '本轮子代理' : 'Assigned subagents'}>
        <h2>{zh ? '本轮子代理' : 'Assigned subagents'}</h2>
        {roles.map(lane => <button key={lane.id} className="background-preview-member"
          aria-pressed={selectedLaneId === lane.id} onClick={() => selectRole(lane.id)}>
          <span><AgentRoleLabel agent={lane.steps[0].agent} language={language}/><small>{lane.steps[0].task}</small></span>
          <ArrowUpRight size={15}/>
        </button>)}
      </section>}
    </main>
    <SubagentPanel key={generation} open={open} replaced={false} overlay={false} expanded={expanded} task={{
      agent: 'general', task: '只读核对项目入口。', status: 'completed', messages: [], output: '已确认项目入口。没有修改文件。',
    }} view={view} onView={setView} runtimeId="preview-runtime" sessionId={sessionId}
      connected={scenario !== 'disconnected'} selectedLaneId={presentation === 'roles' ? selectedLaneId : 'lane_12345678'} backgroundClient={client}
      backgroundAgent={backgroundAgent} onBackgroundAgent={selection => { setBackgroundAgent(selection); setView('agent'); }}
      backgroundPresentation={presentation === 'roles' ? rolePresentation : undefined}
      language={language} onClose={() => setOpen(false)} onToggleExpanded={() => setExpanded(value => !value)}
      openImage={() => {}} onError={() => {}}/>
    <AppTooltip/>
  </div>;
}
createRoot(document.getElementById('root')!).render(<Preview/>);
