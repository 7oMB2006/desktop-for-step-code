import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ContextPanel } from '../../src/ContextPanel';
import type { Snapshot, SessionSummary } from '../../src/contracts';
import '../../src/style.css';
import '../../src/layout.css';

const params = new URLSearchParams(location.search);
document.documentElement.dataset.theme = params.get('theme') === 'dark' ? 'dark' : 'light';
const language = params.get('lang') === 'en' ? 'en' : 'zh';
const model = { id: 'step-3.5-flash', provider: 'step', name: 'Step 3.5 Flash', reasoning: true };
const snapshot: Snapshot = {
  preferences: { theme: 'light', language, workspaces: [], workspace: 'D:\\Projects\\step-code-demo' },
  status: 'connected', runtimeId: 'runtime-demo', messages: [], models: [model], sessions: [],
  permissionPreset: 'approve-for-me', statusAccount: { mode: 'plan', region: 'cn', userId: '100008326' },
  state: { isStreaming: true, model, thinkingLevel: 'high', sessionId: '01a14a56-9dce-7343-a6e6-ae25051b8292' },
  modelSelection: { model: { ...model, name: 'Next model', id: 'next-model' }, thinkingLevel: 'medium' },
  launch: { plan: true, ultracode: false, goalArmed: false },
  pendingMessages: [{ id: 'queued', message: 'fixture', attachmentCount: 0, version: 0 }],
};
const details: SessionSummary = { sessionId: snapshot.state!.sessionId!, tasks: [], mcp: [], skillCount: 0, status: {
  trusted: true, agents: ['D:\\Projects\\step-code-demo\\AGENTS.md', 'D:\\Projects\\AGENTS.md'],
  collaboration: 'Plan', version: '0.1.0', versionSource: 'fallback',
  endpoint: 'https://api.stepfun.com/step_plan/v1', commit: 'b5dbed938d9ae589397cf522dcf2ff89ecf4c494', node: 'v24.16.0',
} };
Object.assign(window, { desktop: { summary: async () => {
  if (params.get('state') === 'error') throw new Error('Fixture failure');
  return details;
}, copyText: async () => {} } });
if (params.get('state') === 'draft') {
  snapshot.draftId = 'draft'; snapshot.state!.sessionId = undefined; snapshot.state!.isStreaming = false;
  snapshot.modelSelection = undefined;
}
if (params.get('state') === 'offline') snapshot.status = 'disconnected';
if (params.get('state') === 'custom') snapshot.state!.model = { ...model, provider: 'custom-provider', providerName: 'Local provider' };
if (params.get('state') === 'api') snapshot.statusAccount = { mode: 'api', region: 'global' };
function Demo() {
  const [view, setView] = useState<'status' | 'context' | 'clm'>('context');
  return <main style={{ width: 'min(100%, 480px)', height: '100dvh', margin: '0 auto', background: 'var(--bg)' }}>
    <ContextPanel snapshot={snapshot} view={view} onView={setView} title={language === 'zh' ? '状态面板验收' : 'Session status'}
      language={language} messages={[]} state={snapshot.state} connected={snapshot.status === 'connected'}
      busy={Boolean(snapshot.state?.isStreaming)} expanded={false} onToggleExpanded={() => {}} onClose={() => {}}
      onRefresh={async () => {}} onError={console.error}/>
  </main>;
}
createRoot(document.getElementById('root')!).render(<Demo/>);
