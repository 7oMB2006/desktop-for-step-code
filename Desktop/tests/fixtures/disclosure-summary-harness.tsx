import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ConversationMessages } from '../../src/ConversationMessages';
import { SummaryBoard } from '../../src/SummaryBoard';
import { AppTooltip } from '../../src/AppTooltip';
import { selectInterfacePreset } from '../../src/interface-presets';
import { applyAppearance, defaultAppearance } from '../../src/appearance';
import type { DesktopBridge, Message, SessionSummary } from '../../src/contracts';
import '../../src/style.css';
import '../../src/layout.css';
import '../../src/appearance.css';
import './disclosure-summary.css';

const params = new URLSearchParams(location.search);
const language = params.get('lang') === 'en' ? 'en' : 'zh';
document.documentElement.dataset.theme = params.get('theme') === 'light' ? 'light' : 'dark';
applyAppearance(defaultAppearance);
export const thought: Message = { role: 'assistant', content: [{ type: 'thinking', thinking: '核对已有组件，再补上交互细节。\n\n保留展开状态，避免流式更新打断阅读。' }] };
export const command: Message = { role: 'assistant', content: [{ type: 'toolCall', id: 'read-1', name: 'read_file', arguments: { path: 'src/main.tsx' } }] };
export const result: Message = { role: 'toolResult', toolName: 'read_file', toolCallId: 'read-1', content: 'export function App() {\n  return <Conversation />;\n}\n'.repeat(6) };
const summary: SessionSummary = { sessionId: 'fixture', tasks: [
  { id: '1', subject: '统一展开交互', description: '检查键盘、焦点及三次方缓动。', status: 'completed' },
  { id: '2', subject: '完善摘要板', description: '任务进度与代理记录。', status: 'in_progress' },
  { id: '3', subject: '回归验证', description: '明暗主题和窄窗口。', status: 'pending' },
], mcp: [], skillCount: 4 };
let currentSummary = summary;
window.desktop = { summary: async () => currentSummary, repositoryDiff: async () => ({ state: 'not-repository', files: [] }) } as unknown as DesktopBridge;

function Harness() {
  const [messages, setMessages] = useState<Message[]>([thought]);
  const [busy, setBusy] = useState(true);
  const [revision, setRevision] = useState(0);
  const [target, setTarget] = useState('');
  const [preset, setPreset] = useState<'simple' | 'standard' | 'detailed'>('simple');
  Object.assign(window, { disclosureFixture: {
    load: (items: Message[], active = false) => { setMessages(items); setBusy(active); },
    summary: (value: SessionSummary) => { currentSummary = value; setRevision(value => value + 1); },
    thought, command, result,
  } });
  const agents: Message[] = [{ role: 'assistant', content: [{ type: 'toolCall', id: 'agents', name: 'subagent', arguments: { tasks: [{ agent: 'reviewer', task: '核对交互边界' }] } }] },
    { role: 'toolResult', toolName: 'subagent', toolCallId: 'agents', content: '', details: { results: [{ agent: 'reviewer', task: '核对交互边界', status: 'running', messages: [] }] } }];
  return <div className="disclosure-fixture">
    <nav aria-label="Preview controls">
      <button onClick={() => { setMessages([thought]); setBusy(true); }}>单条思考</button>
      <button onClick={() => { setMessages([command, result]); setBusy(false); }}>单条工具</button>
      <button onClick={() => { setMessages([thought, command, result, ...agents]); setBusy(true); }}>组合过程</button>
      <select aria-label="复杂度" value={preset} onChange={event => setPreset(event.target.value as typeof preset)}>
        <option value="simple">简洁</option><option value="standard">标准</option><option value="detailed">详细</option>
      </select>
      <button onClick={() => { document.documentElement.dataset.theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'; }}>亮 / 暗</button>
    </nav>
    <div className="disclosure-fixture-layout">
      <div className="messages">
        <ConversationMessages messages={messages} language={language} busy={busy} canEdit={false}
          interfaceSettings={selectInterfacePreset(preset)} openImage={() => {}} edit={async () => {}} branch={() => {}}
          onError={setTarget} onOpenSubagent={task => setTarget(task.task)}/>
        {target && <p role="status">{target}</p>}
      </div>
      <aside className="summary-board" aria-label={language === 'zh' ? '摘要' : 'Summary'}>
        <SummaryBoard key={revision} runtimeId="fixture" sessionId="fixture" language={language}
          messages={messages} busy={busy} onOpenChanges={() => {}} onOpenSubagent={task => setTarget(task.task)}
          onClose={() => setTarget(language === 'zh' ? '关闭摘要' : 'Close Summary')}/>
      </aside>
    </div><AppTooltip/>
  </div>;
}
createRoot(document.getElementById('root')!).render(<Harness/>);
