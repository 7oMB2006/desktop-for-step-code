import { useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { WorkflowCatalogPanel } from '../../src/WorkflowCatalogPanel';
import type { WorkflowCatalog } from '../../src/workflow-catalog';
import '../../src/style.css';
import './workflow-catalog.css';

const params = new URLSearchParams(location.search);
document.documentElement.dataset.theme = params.get('theme') || 'light';
const language = params.get('lang') === 'en' ? 'en' : 'zh';
const sample: WorkflowCatalog = {
  saved: [{ id: 'release', name: '发布检查', scope: 'project' }, { id: 'review', name: '并行审查', scope: 'desktop' }],
  runs: [
    { runId: 'wf_release', name: '发布检查', status: 'completed', completedAgents: 3, totalAgents: 3, startedAt: 1793000000000 },
    { runId: 'wf_review', name: '并行审查', status: 'partial_failed', completedAgents: 2, totalAgents: 3, startedAt: 1792990000000 },
    { runId: 'wf_old', name: 'inline', status: 'unknown', recordedStatus: 'running', totalAgents: 2 },
  ], issues: [],
};
function Preview() {
  const [open, setOpen] = useState(false);
  const [requestId, setRequestId] = useState(0);
  const [scenario, setScenario] = useState(params.get('state') || 'normal');
  const [session, setSession] = useState('session-a');
  const bridge = useMemo(() => ({
    workflows: async (_runtime: string, owner: string): Promise<WorkflowCatalog> => {
      if (scenario === 'loading') await new Promise(resolve => setTimeout(resolve, 1800));
      if (scenario === 'delayed') await new Promise(resolve => setTimeout(resolve, owner === 'session-a' ? 2000 : 100));
      if (scenario === 'error') throw new Error('Fixture error');
      if (scenario === 'empty') return { saved: [], runs: [], issues: [] };
      if (scenario === 'long') return { saved: Array.from({ length: 100 }, (_, index) => ({
        id: `${index}`, name: `workflow-${index}-long-definition-without-spaces`, scope: 'project' as const,
      })), runs: sample.runs, issues: [{ section: 'project', reason: 'limited' }] };
      return { ...sample, saved: scenario === 'delayed' ? [{ id: owner, name: owner, scope: 'project' }] : sample.saved };
    },
  }), [scenario]);
  return <div className="catalog-preview">
    <header><img src="/StepCode.svg" alt="" width="26" height="26"/><strong>Step Code</strong>
      <select aria-label="Scenario" value={scenario} onChange={event => setScenario(event.target.value)}>
        {['normal', 'empty', 'long', 'loading', 'error', 'delayed'].map(value => <option key={value}>{value}</option>)}
      </select>
      <button onClick={() => { setRequestId(value => value + 1); setOpen(true); }}>/workflows</button>
      <button onClick={() => setSession(value => value === 'session-a' ? 'session-b' : 'session-a')}>Switch session</button>
    </header>
    <main><WorkflowCatalogPanel open={open} requestId={requestId} runtimeId="preview-runtime" sessionId={session}
      language={language} bridge={bridge} onClose={() => setOpen(false)}/>
      <div className="catalog-preview-message"><p>检查构建、协议测试和发布文件。</p><p>已完成发布检查，3 个代理均已返回结果。</p></div>
    </main>
  </div>;
}
createRoot(document.getElementById('root')!).render(<Preview/>);
