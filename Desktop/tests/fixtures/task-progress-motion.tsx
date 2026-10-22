import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Moon, Play, RotateCcw, Sun, Volume2, VolumeX } from 'lucide-react';
import { SummaryBoard } from '../../src/SummaryBoard';
import { playCompletionSound, prepareCompletionSound } from '../../src/completion-sound';
import type { DesktopBridge, SessionSummary } from '../../src/contracts';
import '../../src/style.css';
import '../../src/layout.css';
import './task-progress-motion.css';

const subjects = ['读取日报记录', '整理项目进展', '核对统计数据', '生成日报文件', '验证报告并归档'];
const listeners = new Set<(event: any) => void>();
let summary: SessionSummary = {
  sessionId: 'preview-session', plan: { id: 'daily-plan', title: '每日早间简报任务执行' },
  tasks: subjects.map((subject, index) => ({ id: String(index), subject, description: `检查并完成：${subject}。`,
    status: index < 4 ? 'completed' : 'in_progress' })),
  mcp: [{ name: 'StepPage', status: 'connected', toolCount: 13 }], skillCount: 0,
};
let muted = false;
let generation = 0;
let heldSummary: { promise: Promise<SessionSummary>; release: (value: SessionSummary) => void } | undefined;
const mediaPlay = HTMLMediaElement.prototype.play;
HTMLMediaElement.prototype.play = function () {
  this.muted = muted;
  return mediaPlay.call(this);
};
const emit = (type: string, runtimeId = 'preview-runtime', sessionId = 'preview-session') => {
  const event = { type, runtimeId, sessionId };
  for (const listener of listeners) listener(event);
  if (type === 'desktop_task_completed') playCompletionSound(event);
};
window.desktop = {
  summary: async () => heldSummary ? heldSummary.promise : summary,
  repositoryDiff: async () => ({ state: 'not-repository', files: [] }),
  onEvent: (listener: (event: any) => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
} as unknown as DesktopBridge;

function Harness() {
  const [busy, setBusy] = useState(true);
  const [visible, setVisible] = useState(true);
  const [scope, setScope] = useState('preview-session');
  const [dark, setDark] = useState(new URLSearchParams(location.search).get('theme') === 'dark');
  const [silent, setSilent] = useState(false);
  useEffect(() => { document.documentElement.dataset.theme = dark ? 'dark' : 'light'; }, [dark]);
  const update = (done: number, active = true, session = scope) => {
    summary = { sessionId: session, plan: { id: 'daily-plan', title: '每日早间简报任务执行' },
      tasks: subjects.map((subject, index) => ({ id: String(index), subject, description: `检查并完成：${subject}。`,
        status: index < done ? 'completed' : index === done ? 'in_progress' : 'pending' })),
      mcp: [{ name: 'StepPage', status: 'connected', toolCount: 13 }], skillCount: 0 };
    setBusy(active);
    emit('tool_execution_end', 'preview-runtime', session);
  };
  Object.assign(window, { taskProgressFixture: {
    holdSummary: () => {
      let release!: (value: SessionSummary) => void;
      const promise = new Promise<SessionSummary>(resolve => { release = resolve; });
      heldSummary = { promise, release };
    },
    releaseSummary: () => { const held = heldSummary; heldSummary = undefined; held?.release(summary); },
    update, complete: (runtime = 'preview-runtime', session = scope) => emit('desktop_task_completed', runtime, session),
    idle: () => setBusy(false), visible: setVisible,
    session: (session: string) => { generation++; setScope(session); update(5, false, session); },
  } });
  async function play(full: boolean) {
    const run = ++generation;
    prepareCompletionSound();
    update(full ? 0 : 4);
    const wait = async (duration: number) => {
      await new Promise(resolve => setTimeout(resolve, duration));
      return run === generation;
    };
    if (!await wait(500)) return;
    for (let done = full ? 1 : 5; done <= 5; done++) {
      update(done);
      if (done < 5 && !await wait(1400)) return;
    }
    if (!await wait(1800)) return;
    emit('desktop_task_completed');
    setBusy(false);
  }
  return <div className="motion-demo">
    <nav className="demo-controls" aria-label="演示控制">
      <button onClick={() => void play(true)}><Play size={14}/>完整流程</button>
      <button onClick={() => void play(false)}><RotateCcw size={14}/>重播收尾</button>
      <button className="icon-button" aria-label={silent ? '开启完成提示音' : '静音'} aria-pressed={silent}
        onClick={() => { muted = !muted; setSilent(muted); }} title={silent ? '开启完成提示音' : '静音'}>{silent ? <VolumeX size={16}/> : <Volume2 size={16}/>}</button>
      <button className="icon-button" aria-label={dark ? '切换亮色' : '切换暗色'} title={dark ? '切换亮色' : '切换暗色'}
        onClick={() => setDark(!dark)}>{dark ? <Sun size={16}/> : <Moon size={16}/>}</button>
    </nav>
    {visible && <aside className="summary-board" aria-label="摘要"><SummaryBoard key={scope} runtimeId="preview-runtime" sessionId={scope}
      language="zh" busy={busy} onOpenChanges={() => {}} onClose={() => setVisible(false)}/></aside>}
  </div>;
}
createRoot(document.getElementById('root')!).render(<Harness/>);
