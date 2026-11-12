import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { SubagentPanel } from '../../src/SubagentPanel';
import { AgentRoleLabel } from '../../src/AgentRole';
import { ConversationMessages } from '../../src/ConversationMessages';
import type { Message } from '../../src/contracts';
import type { SubagentDisplayTask } from '../../src/conversation-presentation';
import type { WorkflowState } from '../../src/workflow-state';
import '../../src/style.css';
import '../../src/layout.css';
import '../../src/theme.css';
import './background-agents.css';
import './workflow-roles.css';

const params = new URLSearchParams(location.search);
document.documentElement.dataset.theme = params.get('theme') || 'dark';
const language = params.get('lang') === 'en' ? 'en' : 'zh';
const transcript = params.get('view') === 'transcript';
const roles = ['explore', 'review', 'implement', 'test', 'general', 'docs-helper', undefined];
const flow: WorkflowState = { toolCallId: 'roles', name: 'inline', status: 'running',
  agents: roles.map((agentType, index) => ({ id: `agent-${index}`, agentType,
    label: ['ref-config-starter', 'sdk-boundary-review', 'implementation-worker', 'verification-worker',
      'synthesis', 'custom-documentation-worker-with-a-very-long-label', 'review'][index],
    task: '核对插件接口与配置边界，保留来源和验证结果。', status: index === 4 ? 'running' : 'completed' })) };
function Preview() {
  const [view, setView] = useState<'overview' | 'agent' | 'background'>('overview');
  const [agentId, setAgentId] = useState<string>();
  const [open, setOpen] = useState(!transcript);
  const [task, setTask] = useState<SubagentDisplayTask | null>(null);
  const transcriptFlow = { ...flow, agents: [...flow.agents, { ...flow.agents[0], id: 'second-explorer' }] };
  const tasks = roles.filter((role): role is string => !!role).map(agent => ({ agent, task: `核对 ${agent} 的执行记录。` }));
  const messages: Message[] = [
    { role: 'user', content: '核对配置、审查实现并验证结果。' },
    { role: 'assistant', content: [{ type: 'toolCall', id: 'roles', name: 'workflow', arguments: {} }] },
    { role: 'toolResult', toolName: 'workflow', toolCallId: 'roles', content: '', desktopWorkflow: transcriptFlow },
    { role: 'assistant', content: [{ type: 'toolCall', id: 'ordinary', name: 'subagent', arguments: { tasks } }] },
    { role: 'toolResult', toolName: 'subagent', toolCallId: 'ordinary', content: 'done',
      details: { results: tasks.map(task => ({ ...task, status: 'completed', messages: [] })) } },
    { role: 'assistant', content: '配置与验证记录已整理。' },
  ];
  return <div className="app background-preview">
    <header className="background-preview-toolbar">
      <button type="button" onClick={() => { setOpen(true); setView('overview'); }}>{language === 'zh' ? '编排' : 'Orchestration'}</button>
    </header>
    {transcript ? <main className="workflow-role-transcript">
      <ConversationMessages messages={messages} language={language} busy={false} canEdit={false}
        openImage={() => {}} edit={async () => {}} branch={() => {}} onError={message => { throw new Error(message); }}
        onOpenWorkflow={() => { setOpen(true); setView('overview'); }}
        onOpenSubagent={task => { setTask(task); setAgentId(undefined); setOpen(true); setView('agent'); }}/>
    </main> : <div className="background-preview-conversation">
      {roles.filter((role): role is string => !!role).map(role => <p key={role}><AgentRoleLabel agent={role} language={language}/></p>)}
    </div>}
    <SubagentPanel open={open} replaced={false} overlay expanded={false} task={task} workflows={[transcript ? transcriptFlow : flow]}
      workflowId={flow.toolCallId} view={view} agentId={agentId} onView={setView}
      onAgent={id => { setAgentId(id); setView('agent'); }} language={language}
      onClose={() => setOpen(false)} onToggleExpanded={() => {}}
      openImage={() => {}} onError={message => { throw new Error(message); }}/>
  </div>;
}
createRoot(document.getElementById('root')!).render(<Preview/>);
