import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ArrowUp, Clock3, Database, FileText, Folder, Layers, MessageSquare, PanelLeft, Plus, Settings, Shield, Timer, Zap } from 'lucide-react';
import { ConversationMessages } from '../../src/ConversationMessages';
import type { Message } from '../../src/contracts';
import { selectInterfacePreset } from '../../src/interface-presets';
import { QuitConfirmation } from '../../src/QuitConfirmation';
import type { QuitReasons } from '../../src/quit-confirmation';
import '../../src/style.css';
import '../../src/layout.css';
import '../../src/theme.css';
import './cron-transcript.css';

document.documentElement.dataset.theme = new URLSearchParams(location.search).get('theme') === 'dark' ? 'dark' : 'light';
const params = new URLSearchParams(location.search);
const language = params.get('lang') === 'en' ? 'en' : 'zh';
const timestamp = new Date('2026-10-20T09:10:02+08:00').getTime();
const notice: Message = { role: 'custom', customType: 'step-cron', display: true,
  content: '[cron] 每天早上和我发一句早上好', timestamp,
  details: { id: 'example-job', cron: '10 9 * * *', recurring: true, durable: true } };
const missed: Message = { ...notice,
  content: '[cron] Missed 1 one-shot job while the session was offline.\n- example-job: 检查今天的待办',
  details: { kind: 'missed', count: 1, jobs: [] } };
const messages: Message[] = [
  { role: 'user', content: '整理今天的简报', timestamp: timestamp - 65000 },
  { role: 'assistant', content: '今日简报已整理，相关来源：\n\n- 2026 年 10 月 20 日数智新版早参\n- 早读｜中美经贸磋商在纽约开始举行\n- A 股收评 10-19（中国经济网）', timestamp: timestamp - 60000, stopReason: 'stop' },
  params.get('state') === 'missed' ? missed : params.get('state') === 'spoof' ? { ...notice, role: 'user' }
    : params.get('state') === 'hidden' ? { ...notice, display: false } : notice,
  { role: 'assistant', content: [{ type: 'text', text: '早上好！\n\n今天是 **2026-10-20（星期二）**，新的一天开始了。\n\n顺带提醒两件事：\n\n- 早间简报已经在今天约 08:15 自动生成，里面有天气、待办和今日要闻。\n- 天气大致是晴，17°C 左右，体感 14°C，出门加件薄外套比较合适。\n\n祝你今天顺利，需要我做什么随时说。' }], timestamp: timestamp + 4000 },
];
messages[1].desktopTiming = { run: { startedAt: timestamp - 68000, endedAt: timestamp - 60000 }, thinking: {} };
messages.at(-1)!.desktopTiming = { run: { startedAt: timestamp, endedAt: timestamp + 4000 }, thinking: {} };
const preset = params.get('preset') === 'simple' ? 'simple' : params.get('preset') === 'detailed' ? 'detailed' : 'standard';
function Preview() {
  const [snapshot, setSnapshot] = useState(messages);
  const scenario = params.get('quit');
  const [quitOpen, setQuitOpen] = useState(Boolean(scenario));
  const [quitResult, setQuitResult] = useState('');
  const reasons: QuitReasons = scenario === 'running'
    ? { temporaryJobs: 0, durableJobs: 0, runningTasks: 1, activeGoals: 0 }
    : scenario === 'mixed' ? { temporaryJobs: 1, durableJobs: 1, runningTasks: 1, activeGoals: 1 }
      : scenario === 'durable' ? { temporaryJobs: 0, durableJobs: 2, runningTasks: 0, activeGoals: 0 }
        : { temporaryJobs: 1, durableJobs: 1, runningTasks: 0, activeGoals: 0 };
  return <><div className="cron-chat-preview">
    <header className="window-bar"><PanelLeft size={16}/><span>文件</span><span>编辑</span><span>视图</span><span>帮助</span><span className="window-title">请创建一个临时、单次的定时任务，在本机时间约…</span>{!scenario && <button onClick={() => setSnapshot(value => structuredClone(value))}>刷新示例快照</button>}{scenario && <button onClick={() => { setQuitResult(''); setQuitOpen(true); }}>退出应用</button>}<small>{quitResult || '前端预览 · 示例数据'}</small></header>
    <aside className="preview-sidebar">
      <div className="preview-brand"><img src="/StepCode.svg" alt="" width="28"/><img src={document.documentElement.dataset.theme === 'dark' ? '/wordmark-dark.png' : '/wordmark-light.png'} alt="Desktop for Step Code" width="170"/></div>
      <div className="sidebar-actions"><button><Plus size={15}/>新建会话</button><button><Clock3 size={15}/>定时任务</button></div>
      <div className="sidebar-heading"><MessageSquare size={15}/>独立会话</div>
      <div className="sidebar-caption">置顶</div><div className="sidebar-heading"><Folder size={15}/>阶跃测试</div>
      <div className="preview-session selected">请创建一个临时、单次的定时…</div>
      {['你演示一下当前端能展…', '整理一下今天的 A 股市场', '你能看到的有什么 mcp 啊', 'DFSC', '整理一下周末的新闻面'].map(name => <div className="preview-session" key={name}>{name}</div>)}
      <div className="sidebar-heading"><Folder size={15}/>StepFun</div>
      <div className="sidebar-foot"><span><Settings size={16}/>设置</span><small>● Step Code 已连接</small></div>
    </aside>
    <main className="preview-main">
      <div className="preview-transcript">
        <section className="cron-turn">
          <ConversationMessages messages={snapshot} language={language} busy={params.get('active') === 'true'} canEdit={false}
            interfaceSettings={selectInterfacePreset(preset)}
            openImage={() => {}} edit={async () => {}} branch={() => {}} onError={console.error} onOpenSubagent={() => {}}/>
        </section>
      </div>
      <div className="preview-compose"><div className="compose-input">你想做什么？</div><div className="compose-controls"><Plus size={18}/><span className="permission"><Shield size={15}/>完全访问</span><span className="model">step-5-preview&nbsp; 关闭</span><button aria-label="发送"><ArrowUp size={17}/></button></div></div>
      <div className="preview-performance"><Timer size={13}/><span>4s</span><Zap size={13}/><span>32 tok/s</span><Database size={13}/><span>4314K / 28.3K</span><span>缓存命中 86%</span></div>
    </main>
    <aside className="preview-rail"><Layers size={18}/><FileText size={18}/><Folder size={18}/></aside>
  </div>{quitOpen && <QuitConfirmation reasons={reasons} language={language}
    onCancel={() => { setQuitOpen(false); setQuitResult('已取消退出 · 示例'); }}
    onConfirm={async () => {
      await new Promise(resolve => setTimeout(resolve, 350));
      if (params.get('quitError') === 'true') throw new Error('Example failure');
      setQuitOpen(false); setQuitResult('已确认退出 · 示例，不关闭应用');
    }}/>}</>;
}
createRoot(document.getElementById('root')!).render(<Preview/>);
