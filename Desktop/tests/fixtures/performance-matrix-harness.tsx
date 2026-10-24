import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ArrowUp, Plus, ShieldCheck } from 'lucide-react';
import { AppTooltip } from '../../src/AppTooltip';
import { PerformanceBar } from '../../src/PerformanceBar';
import { ElapsedLabel } from '../../src/ElapsedLabel';
import { WorkingIndicator } from '../../src/WorkingIndicator';
import type { RunMetrics } from '../../src/performance';
import '../../src/style.css';
import '../../src/layout.css';
import '../../src/appearance.css';

const params = new URLSearchParams(location.search);
const language = params.get('lang') === 'en' ? 'en' : 'zh';
document.documentElement.dataset.theme = params.get('theme') === 'light' ? 'light' : 'dark';
const requestedElapsed = Number(params.get('elapsedMs') ?? 12000);
const initialElapsed = Number.isFinite(requestedElapsed) ? Math.max(0, requestedElapsed) : 12000;
const frozen = params.get('frozen') === '1';
function Harness() {
  const [mode, setMode] = useState<'running' | 'thinking' | 'waiting' | 'responding' | 'compacting' | 'complete'>('running');
  const [origin, setOrigin] = useState(() => frozen ? 0 : performance.now() - initialElapsed);
  const [clock, setClock] = useState(() => frozen ? initialElapsed : performance.now());
  useEffect(() => {
    if (mode === 'complete' || frozen) return;
    const timer = setInterval(() => setClock(performance.now()), 1000);
    return () => clearInterval(timer);
  }, [mode]);
  const run: RunMetrics = { startedAt: origin, finishedAt: mode === 'complete' ? clock : undefined, turns: 2, tools: 1, toolTimeMs: 3000, activeTools: {},
    usage: { input: 1600, output: 1400, cacheRead: 6600, cacheWrite: 0 }, usageReported: true, measuredOutputTokens: 480, measuredOutputMs: 10000 };
  const t = (zh: string, en: string) => language === 'zh' ? zh : en;
  return <div className="app sidebar-hidden"><main>
    <header className="topbar" style={{ flexWrap: 'wrap', height: 'auto', minHeight: 56, paddingBlock: 8 }}><strong>{t('性能与运行态', 'Performance and run state')}</strong><div className="top-actions" style={{ flexWrap: 'wrap' }}>
      {(['running', 'thinking', 'waiting', 'responding', 'compacting', 'complete'] as const).map(state => <button key={state} aria-pressed={state === mode} onClick={() => { if (mode === 'complete' && state !== 'complete') { setOrigin(performance.now() - 12000); setClock(performance.now()); } setMode(state); }}>
        {state === 'running' ? t('运行', 'Run') : state === 'thinking' ? t('思考', 'Think') : state === 'waiting' ? t('等待', 'Wait') : state === 'responding' ? t('等待响应', 'Response') : state === 'compacting' ? t('压缩', 'Compact') : t('完成', 'Finish')}
      </button>)}
    </div></header>
    <div className="conversation"><div className="messages">
      <div className="message user"><div className="message-body">{t('做一个番茄钟页面，并验证开始、暂停与重置。', 'Build a timer and verify start, pause and reset.')}</div></div>
      <div className="message-body"><p>{t('页面结构已经确认。接下来补上计时交互，并验证状态切换。', 'The structure is ready. Next, implement the timer and verify state transitions.')}</p></div>
      <div className="working">{mode !== 'complete' && <WorkingIndicator language={language} mode={mode === 'running' ? 'executing' : mode} elapsedMs={clock - origin}>
        <span className="working-label">{mode === 'waiting' ? t('等待你的确认', 'Awaiting your decision') : mode === 'responding' ? t('等待响应', 'Awaiting response') : mode === 'compacting' ? t('正在整理上下文', 'Organizing context') : mode === 'thinking' ? t('正在思考', 'Thinking') : t('正在阶跃', 'Working')}</span>
      </WorkingIndicator>}{mode === 'complete' && <ElapsedLabel total language={language} timing={{ startedAt: origin, endedAt: clock }}/>}</div>
    </div></div>
    <div className="composer-wrap"><div className="composer">
      <textarea aria-label={t('消息', 'Message')} placeholder={t('你想做什么？', 'What would you like to do?')}/>
      <div className="composer-tools"><Plus size={16}/><ShieldCheck size={14}/><span>{t('需审批', 'Ask')}</span><span className="spacer"/><span>Step · Medium</span><ArrowUp size={18}/></div>
    </div><PerformanceBar run={run} connected language={language} now={clock}/></div>
    <AppTooltip/>
  </main></div>;
}
createRoot(document.getElementById('root')!).render(<Harness/>);
