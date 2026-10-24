import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ArrowUp, Check, ChevronRight, Clock3, Folder, Maximize2, MessageSquare, Minimize2, Moon, PanelRight, RotateCcw, ShieldCheck, Sun, X } from 'lucide-react';
import { CommandContextUsage, WorkingContextIcon } from '../../src/ContextCommandIcon';
import { ClmRevisionExplorer, type ClmScenario } from './clm-revision-explorer';
import { applyTheme } from '../../src/theme';
import { applyAppearance, defaultAppearance } from '../../src/appearance';
import '../../src/style.css';
import '../../src/layout.css';
import '../../src/theme.css';
import '../../src/context-command-icon.css';
import './clm-workspace.css';

const tabs = [['context', '上下文'], ['status', '状态'], ['clm', 'CLM']] as const;
type Tab = typeof tabs[number][0];
function Preview() {
  const [dark, setDark] = useState(new URLSearchParams(location.search).get('theme') === 'dark');
  const [scenario, setScenario] = useState<ClmScenario>('ready');
  const [resetKey, setResetKey] = useState(0);
  const [tokens, setTokens] = useState<number | null>(42600);
  const [panelOpen, setPanelOpen] = useState(true);
  const [panelTab, setPanelTab] = useState<Tab>(new URLSearchParams(location.search).get('view') === 'clm' ? 'clm' : 'context');
  const [wide, setWide] = useState(false);
  const [draft, setDraft] = useState('');
  const [commandNotice, setCommandNotice] = useState('');
  const panelTrigger = useRef<HTMLButtonElement>(null);
  const percent = tokens === null ? null : tokens / 256000 * 100;
  useEffect(() => {
    applyTheme(dark ? 'original-dark' : 'original-light', dark, new URLSearchParams(location.search).get('accent'));
    applyAppearance(defaultAppearance);
  }, [dark]);
  const revealClm = () => {
    setPanelOpen(true); setPanelTab('clm');
    window.requestAnimationFrame(() => document.getElementById('clm-revision-title')?.focus());
  };
  const submit = () => {
    if (draft.trim() === '/clm') { revealClm(); setDraft(''); setCommandNotice(''); }
    else setCommandNotice('此预览仅响应 /clm，不会发送消息或调用模型。');
  };
  return <CommandContextUsage.Provider value={{ language: 'zh', usage: tokens === null ? undefined : { tokens, percent, contextWindow: 256000 } }}>
    <div className={`clm-preview ${panelOpen ? 'panel-open' : ''} ${wide ? 'is-wide' : ''}`}>
      <header className="clm-preview-bar">
        <div><img src="/StepCode.svg" alt="Step Code" /><strong>CLM 修订</strong><span className="clm-preview-label">交互预览 · 模拟数据</span></div>
        <div><select aria-label="预览场景" value={scenario} onChange={event => setScenario(event.target.value as ClmScenario)}>
          <option value="ready">正常会话</option><option value="history">长历史 · 24 版</option><option value="empty">新会话</option><option value="unknown">状态未知</option><option value="failure">整理失败</option>
        </select>
          <button className="icon-button" title="重置演示" aria-label="重置演示" onClick={() => setResetKey(value => value + 1)}><RotateCcw size={16} /></button>
          <button className="icon-button" title={dark ? '切换亮色' : '切换暗色'} aria-label="切换主题" onClick={() => setDark(!dark)}>{dark ? <Sun size={17} /> : <Moon size={17} />}</button>
        </div>
      </header>
      <aside className="clm-nav">
        <div className="clm-nav-project"><Folder size={16} /><span>Desktop For Step Code</span></div>
        <span className="clm-nav-label">会话</span>
        <div className="clm-nav-selected"><MessageSquare size={15} />账户查询与凭据隔离</div>
        <div className="clm-nav-item"><MessageSquare size={15} />界面与交互细节</div>
        <footer><span className="clm-connected" />本地工作区</footer>
      </aside>
      <main className="clm-chat">
        <header className="clm-chat-header"><span>账户查询与凭据隔离</span><button ref={panelTrigger} className="icon-button" title="右栏" aria-label="打开右栏" aria-expanded={panelOpen} onClick={() => setPanelOpen(!panelOpen)}><PanelRight size={18} /></button></header>
        <div className="clm-transcript">
          {scenario === 'empty' ? <div className="clm-unavailable"><MessageSquare size={24} /><strong>新的会话</strong><p>尚无对话记录。</p></div> : <>
            <div className="clm-user-message">接入套餐查询，注意切换账户时不要串计费。之前确认过的边界都要保留。</div>
            <div className="clm-assistant-label"><img src="/StepCode.svg" alt="" />Step Code</div>
            <p>我先检查账户身份、请求路由和缓存之间的关系，再补上切换场景的测试。</p>
            <div className="clm-chat-process"><Check size={15} /><span>已检查账户服务与登录流程</span><span>6 项</span></div>
            <p>问题在于旧请求可能晚于账户切换返回。我会让查询结果绑定发起时的账户身份，过期响应不再覆盖新账户。</p>
            <div className="clm-code-sample"><span>account-service.ts</span><code>if (request.accountId !== activeAccount.id) return;</code></div>
            <p>已确认的约束会继续保留：<strong>不回退计费方式、不共用跨账户缓存、取消登录保留原账户。</strong></p>
            <button className="clm-inline-event" onClick={revealClm}><WorkingContextIcon size={16} /><span>工作上下文<small>查看 CLM 修订记录</small></span><ChevronRight size={14} /></button>
          </>}
        </div>
        <form className="clm-composer" onSubmit={event => { event.preventDefault(); submit(); }}>
          <textarea aria-label="消息" placeholder="继续讨论，或输入 /clm" value={draft} onChange={event => setDraft(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); submit(); } }} />
          <div><span>Step · 标准</span><span><ShieldCheck size={13} />Plan</span><button type="submit" className="icon-button" aria-label="发送命令" title="发送命令" disabled={!draft.trim()}><ArrowUp size={17} /></button></div>
          {commandNotice && <small role="status">{commandNotice}</small>}
        </form>
        <div className="clm-footer"><Clock3 size={12} />24s<span>·</span>32.6 tok/s<span>·</span>8,412 tokens</div>
      </main>
      <aside className="clm-panel" aria-label="会话信息" hidden={!panelOpen}>
        <header className="clm-panel-header"><div role="tablist" aria-label="右栏视图" onKeyDown={event => {
          if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
          event.preventDefault();
          const index = tabs.findIndex(([id]) => id === panelTab);
          const next = tabs[event.key === 'Home' ? 0 : event.key === 'End' ? 2 : (index + (event.key === 'ArrowRight' ? 1 : 2)) % 3][0];
          setPanelTab(next); document.getElementById(`clm-tab-${next}`)?.focus();
        }}>
          {tabs.map(([id, label]) => <button key={id} id={`clm-tab-${id}`} role="tab" aria-controls={`clm-page-${id}`} tabIndex={panelTab === id ? 0 : -1} aria-selected={panelTab === id} onClick={() => setPanelTab(id)}>{label}</button>)}
        </div><div className="clm-panel-tools"><button className="icon-button" aria-label={wide ? '收窄面板' : '展开宽视图'} title={wide ? '收窄面板' : '展开宽视图'} onClick={() => setWide(!wide)}>{wide ? <Minimize2 size={15} /> : <Maximize2 size={15} />}</button><button className="icon-button" title="关闭面板" aria-label="关闭右栏" onClick={() => { setPanelOpen(false); panelTrigger.current?.focus(); }}><X size={16} /></button></div></header>
        <div className="clm-panel-scroll">
          <section id="clm-page-context" role="tabpanel" aria-labelledby="clm-tab-context" hidden={panelTab !== 'context'}>
            <section className="clm-overview">
              <div className="clm-overview-heading"><span>当前上下文</span><span>{percent === null ? '占用未知' : `${percent.toFixed(1)}%`}</span></div>
              <div className="clm-usage"><strong>{tokens === null ? '—' : tokens.toLocaleString('en-US')}</strong><span>/ 256,000 tokens</span></div>
              <div className="clm-capacity" role="meter" aria-label="上下文占用" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent ?? undefined} aria-valuetext={percent === null ? '未知' : `${percent.toFixed(1)}%`}><i style={{ transform: `scaleX(${(percent ?? 0) / 100})` }} /></div>
            </section>
            <section className="clm-session-status"><h2>会话用量</h2><dl><dt>输入 token</dt><dd>38,120</dd><dt>输出 token</dt><dd>8,412</dd><dt>缓存命中</dt><dd>31,200</dd><dt>上下文窗口</dt><dd>256,000</dd></dl></section>
          </section>
          <section id="clm-page-status" role="tabpanel" aria-labelledby="clm-tab-status" hidden={panelTab !== 'status'} className="clm-session-status"><h2>当前会话</h2><dl><dt>模型</dt><dd>Step</dd><dt>思考档位</dt><dd>标准</dd><dt>账户</dt><dd>Step Plan · 模拟</dd><dt>工作目录</dt><dd>Desktop For Step Code</dd></dl></section>
          <div id="clm-page-clm" role="tabpanel" aria-labelledby="clm-tab-clm" hidden={panelTab !== 'clm'}><ClmRevisionExplorer scenario={scenario} resetKey={resetKey} onUsageChange={setTokens} onRecover={() => setScenario('ready')} /></div>
        </div>
      </aside>
    </div>
  </CommandContextUsage.Provider>;
}
createRoot(document.getElementById('root')!).render(<Preview />);
