import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ArrowLeft, CheckCheck, Languages, MessageSquare, Moon, RotateCcw, Settings, Smartphone, Sun } from 'lucide-react';
import { AppTooltip } from '../../src/AppTooltip';
import { ComposerInput } from '../../src/ComposerInput';
import { ScheduledTaskSelect, SidebarTaskActions } from '../../src/ScheduledTasks';
import { UsageOverviewView } from './usage-overview-view';
import { RemoteAccessView, remoteScenarios, remoteSessions, type RemoteScenario } from './remote-access-view';
import '../../src/style.css';
import '../../src/layout.css';
import '../../src/theme.css';
import '../../src/usage-overview-preview.css';
import './remote-access.css';

const params = new URLSearchParams(location.search);
const initialScenario = (remoteScenarios.find(item => item.id === params.get('state'))?.id ?? 'connected') as RemoteScenario;
document.documentElement.dataset.theme = params.get('theme') === 'dark' ? 'dark' : 'light';

function Preview() {
  const [view, setView] = useState<'remote' | 'conversation' | 'usage'>('remote');
  const [language, setLanguage] = useState<'zh' | 'en'>(params.get('lang') === 'en' ? 'en' : 'zh');
  const [dark, setDark] = useState(params.get('theme') === 'dark');
  const [scenario, setScenario] = useState<RemoteScenario>(initialScenario);
  const [session, setSession] = useState('recovery');
  const [chatId, setChatId] = useState('recovery');
  const [bound, setBound] = useState(initialScenario !== 'unconfigured' && initialScenario !== 'pairing');
  const [approvalReady, setApprovalReady] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, string>>({ recovery: '顺便核对一下切换会话时的隔离边界。' });
  const [generation, setGeneration] = useState(0);
  const remoteButton = useRef<HTMLButtonElement>(null);
  const t = (zh: string, en: string) => language === 'zh' ? zh : en;
  const currentChat = remoteSessions.find(item => item.id === chatId)!;
  useEffect(() => { document.documentElement.lang = language === 'zh' ? 'zh-CN' : 'en'; }, [language]);
  const selectScenario = (value: string) => {
    const next = value as RemoteScenario;
    setScenario(next); setBound(next !== 'pairing' && next !== 'unconfigured');
    setApprovalReady(false); setGeneration(value => value + 1); setView('remote');
  };
  const back = () => {
    setView('conversation');
    requestAnimationFrame(() => {
      const target = matchMedia('(max-width: 760px)').matches
        ? document.querySelector<HTMLButtonElement>('.remote-narrow-entry') : remoteButton.current;
      target?.focus({ preventScroll: true });
    });
  };
  return <div className="app remote-preview">
    <header className="remote-preview-toolbar">
      <img src="/StepCode.svg" width="20" height="20" alt=""/>
      <span className="remote-preview-label">{t('示例数据 · 未连接真实服务', 'Sample data · No live services')}</span>
      <div className="remote-preview-tools">
        <ScheduledTaskSelect label={t('预览状态', 'Preview state')} value={scenario}
          options={remoteScenarios.map(item => ({ id: item.id, label: t(item.label, item.en) }))} onChange={selectScenario}/>
        {scenario === 'pairing' ? <button className="icon-button" aria-label={t('模拟授权完成', 'Simulate authorization')}
          data-tooltip={t('模拟授权完成', 'Simulate authorization')} onClick={() => {
          setScenario('connected'); setBound(false);
        }}><CheckCheck size={16}/></button> : <button className="icon-button" aria-label={t('模拟审批回调验证', 'Simulate approval callback')}
          data-tooltip={t('模拟审批回调验证', 'Simulate approval callback')} aria-pressed={approvalReady} disabled={scenario !== 'connected' || !bound}
          onClick={() => setApprovalReady(value => !value)}><CheckCheck size={16}/></button>}
        <button className="icon-button" aria-label={t('重置预览', 'Reset preview')} data-tooltip={t('重置预览', 'Reset preview')}
          onClick={() => { setSession('recovery'); selectScenario('connected'); }}><RotateCcw size={15}/></button>
        <button className="icon-button" aria-label={t('切换语言', 'Toggle language')} data-tooltip={t('切换语言', 'Toggle language')}
          onClick={() => setLanguage(value => value === 'zh' ? 'en' : 'zh')}><Languages size={16}/></button>
        <button className="icon-button" aria-label={t('切换主题', 'Toggle theme')} data-tooltip={t('切换主题', 'Toggle theme')}
          onClick={() => { setDark(value => !value); document.documentElement.dataset.theme = dark ? 'light' : 'dark'; }}>
          {dark ? <Sun size={16}/> : <Moon size={16}/>}</button>
        <button className="icon-button remote-narrow-entry" aria-label={t('远程访问', 'Remote access')} data-tooltip={t('远程访问', 'Remote access')}
          aria-pressed={view === 'remote'} onClick={() => view === 'remote' ? back() : setView('remote')}><Smartphone size={17}/></button>
      </div>
    </header>
    <aside className="sidebar">
      <button className="sidebar-identity usage-entry" aria-label={t('用量统计', 'Usage overview')}
        aria-pressed={view === 'usage'} onClick={() => setView(value => value === 'usage' ? 'conversation' : 'usage')}>
        <img src="/StepCode.svg" width="26" height="26" alt=""/>
        <span className="sidebar-wordmark"><img className="wordmark-light" src="/wordmark-light.png" alt="Desktop for Step Code"/>
          <img className="wordmark-dark" src="/wordmark-dark.png" alt="Desktop for Step Code"/></span>
      </button>
      <SidebarTaskActions language={language} selected={false} disabled onNewSession={() => {}} onScheduledTasks={() => {}} onPlugins={() => {}}/>
      <div className="workspace-tree">
        <div className="section-label">{t('会话', 'Conversations')}</div>
        {remoteSessions.map(item => <div className={`session-row${view === 'conversation' && item.id === chatId ? ' selected' : ''}`} key={item.id}>
          <button aria-current={view === 'conversation' && item.id === chatId ? 'page' : undefined}
            onClick={() => { setChatId(item.id); setView('conversation'); }}><MessageSquare size={14}/><span>{t(item.label, item.en)}<small>{item.project}</small></span></button>
        </div>)}
      </div>
      <div className="sidebar-bottom">
        <div className="remote-preview-utilities">
          <button className="icon-button remote-preview-settings" aria-label={t('设置', 'Settings')}
            data-tooltip={t('设置', 'Settings')} disabled><Settings size={17}/></button>
          <button ref={remoteButton} className="icon-button remote-entry" aria-label={t('远程访问', 'Remote access')}
            aria-pressed={view === 'remote'} data-tooltip={view === 'remote' ? t('返回会话', 'Back to conversation') : t('远程访问', 'Remote access')}
            onClick={() => view === 'remote' ? back() : setView('remote')}><Smartphone size={18}/></button>
        </div>
        <div className="connection remote-preview-status"><span><i className="online"/>{t('Step Code 已连接', 'Step Code connected')}</span>
          <span className="remote-preview-version">v0.6.0</span></div>
      </div>
    </aside>
    <main className="remote-preview-main">
      {view === 'remote' && <RemoteAccessView key={generation} language={language} scenario={scenario} onScenario={setScenario}
        session={session} onSession={setSession} bound={bound} onBound={setBound} approvalReady={approvalReady}
        onApprovalReady={setApprovalReady} onBack={back}/>}
      {view === 'usage' && <section className="usage-overview-preview">
        <header><button onClick={() => setView('conversation')}><ArrowLeft size={15}/>{t('返回会话', 'Back to conversation')}</button>
          <span>{t('用量统计 · 示例数据', 'Usage overview · Sample data')}</span></header>
        <div className="usage-overview-scroll"><UsageOverviewView embedded language={language}/></div>
      </section>}
      <section className="remote-preview-chat" hidden={view !== 'conversation'} inert={view !== 'conversation'}>
        <header className="topbar"><span>{t(currentChat.label, currentChat.en)}</span></header>
        <div className="conversation"><div className="messages">
          <article className="message user"><div className="message-body">{t('核对会话恢复时的运行器归属。', 'Check runtime ownership when restoring a session.')}</div></article>
          <article className="message assistant"><div className="message-body"><p>{t('已完成链路检查。已保存的历史和当前运行器分别保留，会话切换不转移任务归属。', 'The ownership review is complete. Saved history and live runtimes remain separate; navigation does not transfer task ownership.')}</p></div></article>
        </div></div>
        <div className="composer-wrap"><div className="composer">
          <ComposerInput value={drafts[chatId] ?? ''} onChange={value => setDrafts(current => ({ ...current, [chatId]: value }))} disabled={false} language={language}
            label={t('消息草稿', 'Message draft')} placeholder={t('发送消息', 'Message')}
            onPaste={() => {}} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey) event.preventDefault(); }}/>
        </div></div>
      </section>
    </main>
    <AppTooltip/>
  </div>;
}
createRoot(document.getElementById('root')!).render(<Preview/>);
