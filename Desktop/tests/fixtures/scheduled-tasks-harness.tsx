import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Folder, MessageSquare, PanelLeft, Settings, SunMoon } from 'lucide-react';
import { ScheduledTasks, ScheduledTaskSelect, SidebarTaskActions, type ScheduledTaskView } from '../../src/ScheduledTasks';
import { AppTooltip } from '../../src/AppTooltip';
import '../../src/style.css';
import '../../src/layout.css';
import '../../src/theme.css';
import './scheduled-tasks-preview.css';

document.documentElement.dataset.theme = new URLSearchParams(location.search).get('theme') === 'dark' ? 'dark' : 'light';
const samples: ScheduledTaskView[] = [
  { id: 'daily', title: '整理项目待办', prompt: '检查 TODO.md 与最近合并的 PR，列出尚未完成的事项和可能的阻塞。不修改文件。', workspace: 'Desktop for Step Code',
    schedule: '每天 09:00', next: '明天 09:00', expires: '10 月 25 日 14:30', recurring: true, durable: true, host: 'online',
    runtimeId: 'preview-desktop-host', hostName: 'Cron 桌面适配' },
  { id: 'ci', title: '稍后检查 CI', prompt: '20 分钟后检查当前分支的 CI。如果有失败，说明失败的检查项和原因，先不要修改代码。', workspace: 'Desktop for Step Code',
    schedule: '仅执行一次', next: '今天 15:20', recurring: false, durable: false, host: 'online',
    runtimeId: 'preview-ci-host', hostName: '下一版开发计划' },
  { id: 'weekly', title: '每周项目回顾', prompt: '汇总本周项目变更、测试结果与未完成工作，整理成一份简短周报。', workspace: 'StepTrading',
    schedule: '每周五 18:00', next: '10 月 23 日 18:00', expires: '10 月 25 日 10:00', recurring: true, durable: true, host: 'offline' },
];
function Harness() {
  const [view, setView] = useState('tasks');
  const [jobs, setJobs] = useState(samples);
  const [sidebar, setSidebar] = useState(true);
  const [notice, setNotice] = useState('');
  return <div className={`cron-preview app${sidebar ? '' : ' preview-sidebar-hidden'}`}>
    <header className="cron-preview-window">
      <button className="icon-button" aria-label="切换侧栏" data-tooltip="切换侧栏" onClick={() => setSidebar(value => !value)}><PanelLeft size={17}/></button>
      <span>Desktop for Step Code</span><span className="cron-preview-label">前端预览 · 示例数据</span>
      <ScheduledTaskSelect label="预览数据" value={jobs.length ? 'sample' : 'empty'}
        options={[{ id: 'sample', label: '任务列表' }, { id: 'empty', label: '空状态' }]}
        onChange={id => { setJobs(id === 'empty' ? [] : samples); setNotice(''); }}/>
      <button className="icon-button" aria-label="切换主题" data-tooltip="切换主题" onClick={() => { document.documentElement.dataset.theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'; }}><SunMoon size={16}/></button>
    </header>
    {sidebar && <aside className="sidebar">
      <div className="sidebar-identity"><img src="/StepCode.svg" width="26" height="26" alt=""/><span className="sidebar-wordmark"><img className="wordmark-light" src="/wordmark-light.png" alt="Desktop for Step Code"/><img className="wordmark-dark" src="/wordmark-dark.png" alt="Desktop for Step Code"/></span></div>
      <SidebarTaskActions selected={view === 'tasks'} onNewSession={() => { setView('new'); setNotice(''); }} onScheduledTasks={() => { setView('tasks'); setNotice(''); }}/>
      <nav className="workspace-tree" aria-label="会话列表">
        <div className="workspace-heading"><span className="cron-preview-section"><MessageSquare size={15}/>独立会话<small>2</small></span></div>
        {['看看项目的最新进展', '整理发布说明'].map(name => <div className={`session-row${view === name ? ' selected' : ''}`} key={name}><button onClick={() => { setView(name); setNotice(''); }}><span>{name}</span></button></div>)}
        <div className="section-label">置顶</div>
        <div className="workspace-heading"><span className="cron-preview-section"><Folder size={15}/>Desktop for Step Code</span></div>
        {['下一版开发计划', 'Cron 桌面适配'].map(name => <div className={`session-row${view === name ? ' selected' : ''}`} key={name}><button onClick={() => { setView(name); setNotice(''); }}><span>{name}</span></button></div>)}
        <div className="section-label">项目</div><div className="workspace-heading"><span className="cron-preview-section"><Folder size={15}/>StepTrading</span></div>
      </nav>
      <div className="sidebar-bottom"><span className="cron-preview-section"><Settings size={16}/>设置<small>v0.5.1</small></span><div className="connection"><i className="online"/>Step Code 已连接</div></div>
    </aside>}
    <main>{notice && <div className="cron-preview-notice" role="status">{notice}</div>}
      {view === 'tasks' ? <ScheduledTasks jobs={jobs} onDelete={id => { setJobs(value => value.filter(job => job.id !== id)); setNotice('已从演示列表移除，未修改真实任务。'); }}
        onOpenHost={async runtimeId => {
          const host = jobs.find(job => job.runtimeId === runtimeId && job.host === 'online');
          if (!host?.hostName) throw new Error('Preview host is offline');
          setView(host.hostName); setNotice('');
        }}
        onCreate={() => setNotice('已预览创建流程，未创建真实任务。')} />
        : <div className="cron-preview-chat"><h1>{view === 'new' ? '新建会话' : view}</h1><p>会话预览</p>
          <div className="cron-preview-composer"><textarea aria-label="演示输入框" placeholder="发送消息…"/><span>Step 3.5 Flash　 ·　中等思考</span></div></div>}
    </main><AppTooltip/>
  </div>;
}
createRoot(document.getElementById('root')!).render(<Harness/>);
