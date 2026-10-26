import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { ArrowLeft, ArrowRight, ArrowUp, CalendarDays, Check, Copy, Folder, LoaderCircle,
  MessageSquare, Moon, PanelLeft, Search, Settings, Sun, TextSearch, X, AlertCircle, Archive, SlidersHorizontal } from 'lucide-react';
import { SidebarTaskActions } from '../../src/ScheduledTasks';
import { AppMenu } from '../../src/AppMenu';
import { DisclosureChevron } from '../../src/DisclosureChevron';
import { applyTheme } from '../../src/theme';
import { filterSessions } from '../../src/session-search';
import { conversations, projects, queryFixture, sidebarPreferences, sidebarSessions, termsFor,
  type SearchMessage } from './fulltext-search-data';
import '../../src/style.css';
import '../../src/theme.css';
import '../../src/layout.css';
import './fulltext-search.css';

type Scenario = 'ready' | 'loading' | 'partial' | 'degraded' | 'error';
const scenarios = [
  { id: 'ready', label: '正常' }, { id: 'loading', label: '查询中' },
  { id: 'partial', label: '索引建立中' }, { id: 'degraded', label: '索引不可用' }, { id: 'error', label: '查询失败' },
];

function Picker({ label, value, items, onChange, icon }: {
  label: string; value: string; items: { id: string; label: string }[]; onChange: (value: string) => void; icon?: ReactNode;
}) {
  const anchor = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  return <><button type="button" className="fs-picker" ref={anchor} aria-label={label} aria-haspopup="menu"
    aria-expanded={open} onClick={() => setOpen(value => !value)}>
    {icon}<span>{items.find(item => item.id === value)?.label}</span><DisclosureChevron/>
  </button><AppMenu anchor={anchor} open={open} label={label} items={items} selected={value}
    onSelect={onChange} onClose={close} maxVisibleItems={6}/></>;
}

function Highlight({ text, query }: { text: string; query: string }) {
  const terms = termsFor(query).sort((a, b) => b.length - a.length);
  if (!terms.length) return <>{text}</>;
  const escaped = terms.map(term => term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return <>{text.split(new RegExp(`(${escaped.join('|')})`, 'giu'))
    .map((piece, index) => terms.includes(piece.toLocaleLowerCase()) ? <mark key={index}>{piece}</mark> : piece)}</>;
}

function CopyButton({ text }: { text: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  useEffect(() => {
    if (state === 'idle') return;
    const timer = setTimeout(() => setState('idle'), 1800);
    return () => clearTimeout(timer);
  }, [state]);
  return <button type="button" className="icon-button" title={state === 'failed' ? '复制失败，请选择文字复制' : state === 'copied' ? '已复制' : '复制消息'}
    aria-label={state === 'copied' ? '已复制' : '复制消息'} onClick={async () => {
      try { await navigator.clipboard.writeText(text); setState('copied'); } catch { setState('failed'); }
    }}>{state === 'copied' ? <Check size={14}/> : state === 'failed' ? <AlertCircle size={14}/> : <Copy size={14}/>}</button>;
}

function Preview() {
  const params = new URLSearchParams(location.search);
  const [dark, setDark] = useState(params.get('theme') === 'dark');
  const [sidebarOpen, setSidebarOpen] = useState(() => innerWidth > 760);
  const [quickQuery, setQuickQuery] = useState('');
  const [sidebarNotice, setSidebarNotice] = useState('');
  const [view, setView] = useState<'chat' | 'search' | 'hit'>(params.get('view') === 'search' ? 'search' : 'chat');
  const [query, setQuery] = useState(params.get('q') ?? '');
  const [settledQuery, setSettledQuery] = useState(query);
  const [project, setProject] = useState('all');
  const [range, setRange] = useState('all');
  const [includeArchived, setIncludeArchived] = useState(false);
  const [scenario, setScenario] = useState<Scenario>('ready');
  const [limit, setLimit] = useState(6);
  const [active, setActive] = useState('account');
  const [selected, setSelected] = useState<{ conversationId: string; messageId: string }>();
  const [collapsed, setCollapsed] = useState<string[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({ account: '那我们再检查一下取消授权的情况。' });
  const [sent, setSent] = useState<Record<string, SearchMessage[]>>({});
  const searchInput = useRef<HTMLInputElement>(null);
  const secondaryTrigger = useRef<HTMLButtonElement>(null);
  const resultList = useRef<HTMLDivElement>(null);
  const resultScroll = useRef(0);
  const resultFocus = useRef<string | undefined>(undefined);
  const hitBody = useRef<HTMLDivElement>(null);
  const queryChanged = query !== settledQuery;
  const busy = !!query.trim() && (queryChanged || scenario === 'loading');
  const hits = useMemo(() => queryFixture(settledQuery, project, range, includeArchived), [settledQuery, project, range, includeArchived]);
  const visibleHits = scenario === 'degraded' ? hits : hits.slice(0, limit);
  const grouped = [...conversations].sort((a, b) => b.date.localeCompare(a.date))
    .map(conversation => ({ conversation, hits: visibleHits.filter(hit => hit.conversation.id === conversation.id) }))
    .filter(group => group.hits.length);
  const filtered = filterSessions(sidebarSessions, sidebarPreferences, quickQuery);
  const current = conversations.find(item => item.id === active) ?? conversations[0];
  const hitConversation = conversations.find(item => item.id === selected?.conversationId);

  useEffect(() => applyTheme(dark ? 'original-dark' : 'original-light', dark, dark ? '#b8b8b8' : '#4c4c4c'), [dark]);
  useEffect(() => {
    const timer = setTimeout(() => setSettledQuery(query), 220);
    return () => clearTimeout(timer);
  }, [query]);
  useEffect(() => { setLimit(6); resultScroll.current = 0; resultList.current?.scrollTo(0, 0); }, [settledQuery, project, range, includeArchived]);
  useLayoutEffect(() => {
    if (view === 'search') {
      if (resultList.current) resultList.current.scrollTop = resultScroll.current;
      const target = resultFocus.current && document.getElementById(resultFocus.current);
      if (target) target.focus({ preventScroll: true });
      else searchInput.current?.focus();
    }
    if (view === 'hit' && selected) {
      const message = document.getElementById(`hit-${selected.messageId}`);
      message?.scrollIntoView({ block: 'center', behavior: 'instant' });
      message?.focus({ preventScroll: true });
    }
  }, [view, selected]);
  const returnToChat = () => {
    setView('chat');
    if (innerWidth > 760) requestAnimationFrame(() => secondaryTrigger.current?.focus());
  };
  const openSearch = () => {
    setQuery(quickQuery);
    setSettledQuery(quickQuery);
    resultScroll.current = 0; resultFocus.current = undefined;
    setView('search');
    if (innerWidth <= 760) setSidebarOpen(false);
  };
  const openConversation = (id: string) => {
    setActive(id); setView('chat');
    if (innerWidth <= 760) setSidebarOpen(false);
  };
  const openHit = (conversationId: string, messageId: string) => {
    resultScroll.current = resultList.current?.scrollTop ?? 0;
    resultFocus.current = `result-${messageId}`;
    setSelected({ conversationId, messageId }); setView('hit');
  };
  return <div className="fs-preview" onKeyDown={event => {
    if (event.key !== 'Escape' || event.nativeEvent.isComposing || document.querySelector(':popover-open')) return;
    if (sidebarOpen && innerWidth <= 760) { setSidebarOpen(false); return; }
    if (view === 'hit') setView('search');
    else if (view === 'search') returnToChat();
  }}>
    <div className="fs-preview-bar"><span>聊天记录搜索 <span className="fs-demo-label">交互预览 · 示例数据</span></span>
      <div><Picker label="预览状态" value={scenario} items={scenarios} onChange={value => setScenario(value as Scenario)} icon={<SlidersHorizontal size={13}/>}/>
        <button className="icon-button" title={dark ? '切换浅色' : '切换深色'} aria-label="切换主题" onClick={() => setDark(value => !value)}>
          {dark ? <Sun size={16}/> : <Moon size={16}/>}</button></div>
    </div>
    <div className="fs-shell">
      {sidebarOpen && <button className="fs-sidebar-backdrop" aria-label="关闭会话侧栏" onClick={() => setSidebarOpen(false)}/>}
      <aside className="fs-sidebar" data-open={sidebarOpen} aria-label="会话导航" inert={!sidebarOpen}>
        <div className="sidebar-identity"><img src="/StepCode.svg" width="26" height="26" alt=""/>
          <span className="sidebar-wordmark"><img className="wordmark-light" src="/wordmark-light.png" alt="Desktop for Step Code"/>
            <img className="wordmark-dark" src="/wordmark-dark.png" alt="Desktop for Step Code"/></span></div>
        <div className="fs-native-actions">
          <SidebarTaskActions selected={false} onNewSession={() => { setActive('new'); setView('chat'); }}
            onPlugins={() => setSidebarNotice('插件市场不在本次搜索预览范围内')}
            onScheduledTasks={() => setSidebarNotice('定时任务不在本次搜索预览范围内')}
            onSearchChange={setQuickQuery}/>
          <div className="fs-search-entry-disclosure"><div>
            <button ref={secondaryTrigger} className="fs-secondary-entry" aria-label="搜索聊天记录" onClick={openSearch}>
              <TextSearch size={16}/><span>搜索聊天记录</span><ArrowRight size={14}/></button>
          </div></div>
        </div>
        {sidebarNotice && <div className="fs-sidebar-notice" role="status"><span>{sidebarNotice}</span><button className="icon-button" aria-label="关闭提示" onClick={() => setSidebarNotice('')}><X size={13}/></button></div>}
        <nav className="fs-session-list" aria-label="会话列表">
          {projects.map(name => {
            const sessions = filtered.filter(session => session.cwd.endsWith(name));
            if (!sessions.length) return null;
            const expanded = !!quickQuery || !collapsed.includes(name);
            return <section key={name}><button className="fs-project-heading" aria-expanded={expanded}
              onClick={() => setCollapsed(value => value.includes(name) ? value.filter(item => item !== name) : [...value, name])}>
              <Folder size={14}/><span>{name}</span><DisclosureChevron/></button>
              {expanded && sessions.map(session => <button className="fs-session" key={session.id} aria-current={view === 'chat' && active === session.id ? 'page' : undefined}
                onClick={() => openConversation(session.id)}><MessageSquare size={14}/><span>{session.name}</span></button>)}
            </section>;
          })}
          {!filtered.length && <p className="fs-sidebar-empty">没有匹配的会话</p>}
        </nav>
        <footer className="sidebar-bottom"><button onClick={() => setSidebarNotice('设置不在本次搜索预览范围内')}><Settings size={17}/>设置<span>本地预览</span></button><div className="connection"><i/>未连接</div></footer>
      </aside>
      <main className="fs-main">
        <header className="fs-topbar">
          <button className="icon-button" aria-label={sidebarOpen ? '收起侧栏' : '展开侧栏'} title={sidebarOpen ? '收起侧栏' : '展开侧栏'} onClick={() => setSidebarOpen(value => !value)}><PanelLeft size={17}/></button>
          {view === 'search' ? <><button className="icon-button" title="返回会话" aria-label="返回会话" onClick={returnToChat}><ArrowLeft size={17}/></button><h1>聊天记录搜索</h1><span className="fs-top-meta">本机记录</span></>
            : view === 'hit' ? <><button className="fs-back-search" onClick={() => setView('search')}><ArrowLeft size={15}/>搜索结果</button><span className="fs-top-divider"/><h1>{hitConversation?.title}</h1></>
              : <><span className="fs-top-meta">{active === 'new' ? 'StepCode Desktop' : current.project}</span><span className="fs-top-divider"/><h1>{active === 'new' ? '新建会话' : current.title}</h1></>}
        </header>
        <section className="fs-chat" hidden={view !== 'chat'} aria-label="当前会话">
          <div className="fs-chat-scroll"><div className="fs-transcript">
            {active === 'new' ? <div className="fs-chat-empty"><img src="/StepCode.svg" alt="Step Code"/><h2>开始一个新任务</h2></div>
              : current.messages.map(message => <article className={`fs-message ${message.role}`} key={message.id}><div className="fs-message-heading">
                {message.role === 'user' ? '你' : <><img src="/StepCode.svg" alt=""/>Step Code</>}<span>10:24</span></div><p>{message.text}</p></article>)}
            {(sent[active] ?? []).map(message => <article className="fs-message user" key={message.id}><div className="fs-message-heading">你<span>刚刚</span></div><p>{message.text}</p></article>)}
          </div></div>
          <form className="fs-composer" onSubmit={event => {
            event.preventDefault(); const text = drafts[active]?.trim(); if (!text) return;
            setSent(value => ({ ...value, [active]: [...(value[active] ?? []), { id: `demo-${Date.now()}`, role: 'user', text }] }));
            setDrafts(value => ({ ...value, [active]: '' }));
          }}><div className="fs-composer-field"><textarea aria-label="消息草稿" placeholder="发送消息…" rows={2} value={drafts[active] ?? ''}
            onChange={event => setDrafts(value => ({ ...value, [active]: event.target.value }))}/>
            <div className="fs-composer-bottom"><span>Ask</span><span>Step Code</span><button className="icon-button" type="submit" title="发送示例消息" aria-label="发送示例消息" disabled={!drafts[active]?.trim()}><ArrowUp size={18}/></button></div></div>
            <small>示例会话 · 不调用模型</small></form>
        </section>
        <section className="fs-search-view" hidden={view !== 'search'} aria-label="聊天记录搜索">
          <div className="fs-search-controls">
            <div className="fs-input fs-full-input"><Search size={19}/><input ref={searchInput} aria-label="搜索聊天记录关键词" value={query}
              placeholder="搜索聊天记录…" onChange={event => setQuery(event.target.value)}
              onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) setSettledQuery(query); }}/>
              {query && <button className="icon-button" aria-label="清空关键词" title="清空关键词" onClick={() => { setQuery(''); searchInput.current?.focus(); }}><X size={16}/></button>}
            </div>
            <div className="fs-filters"><Picker label="筛选项目" icon={<Folder size={14}/>} value={project}
              items={[{ id: 'all', label: '全部项目' }, ...projects.map(name => ({ id: name, label: name }))]} onChange={setProject}/>
              <Picker label="筛选时间" icon={<CalendarDays size={14}/>} value={range}
                items={[{ id: 'all', label: '不限时间' }, { id: '7', label: '最近 7 天' }, { id: '30', label: '最近 30 天' }]} onChange={setRange}/>
              <label className="fs-archive-filter"><input type="checkbox" checked={includeArchived} onChange={event => setIncludeArchived(event.target.checked)}/>包含归档</label>
              {(project !== 'all' || range !== 'all' || includeArchived) && <button className="fs-reset" onClick={() => { setProject('all'); setRange('all'); setIncludeArchived(false); }}>重置筛选</button>}
            </div>
          </div>
          {scenario === 'partial' && <div className="fs-notice" role="status"><LoaderCircle size={15}/><span>索引建立中，当前结果尚未覆盖全部记录。</span><span>38 / 64 个会话</span></div>}
          {scenario === 'degraded' && <div className="fs-notice" role="status"><AlertCircle size={15}/><span>索引暂不可用，仅显示会话级匹配，暂不支持消息定位。</span></div>}
          <div className="fs-result-scroll" ref={resultList} aria-busy={busy}>
            {!query.trim() ? <div className="fs-empty"><TextSearch size={30} strokeWidth={1.4}/><h2>搜索聊天记录</h2><p>暂无查询</p></div>
              : busy ? <div className="fs-loading" role="status"><span><LoaderCircle size={15}/>正在查询…</span>{[0, 1, 2].map(index => <div className="fs-skeleton" key={index}><i/><i/><i/></div>)}</div>
                : scenario === 'error' ? <div className="fs-empty"><AlertCircle size={28}/><h2>暂时无法查询</h2><p>关键词和筛选条件已保留</p><button onClick={() => setScenario('ready')}>重新查询</button></div>
                  : !hits.length ? <div className="fs-empty"><Search size={28}/><h2>没有匹配记录</h2><p>{scenario === 'partial' ? '当前已索引的记录中未找到匹配' : '当前筛选范围内未找到匹配'}</p></div>
                    : <><div className="fs-result-summary" role="status"><span>{scenario === 'degraded' ? `${new Set(hits.map(hit => hit.conversation.id)).size} 个会话` : `${hits.length} 条匹配 · ${new Set(hits.map(hit => hit.conversation.id)).size} 个会话`}</span><span>最近更新优先</span></div>
                      {grouped.map(({ conversation, hits: groupHits }) => <section className="fs-result-group" key={conversation.id} aria-label={conversation.title}>
                        <div className="fs-result-group-heading"><MessageSquare size={15}/><h2>{conversation.title}</h2>{conversation.archived && <Archive size={13} aria-label="已归档"/>}
                          <span>{conversation.project}</span><time>{conversation.date.slice(5).replace('-', '/')}</time></div>
                        {scenario === 'degraded' ? <button className="fs-result-row" onClick={() => openConversation(conversation.id)}><span className="fs-result-text">{conversation.messages[0].text}</span><ArrowRight size={15}/></button>
                          : groupHits.map(({ message }) => <button className="fs-result-row" id={`result-${message.id}`} key={message.id}
                            aria-label={`查看匹配消息：${conversation.title}，${message.role === 'user' ? '你' : 'Step Code'}，${message.id}`}
                            onClick={() => openHit(conversation.id, message.id)}>
                            <span className="fs-role">{message.role === 'user' ? '你' : 'Step Code'}</span><span className="fs-result-text"><Highlight text={message.text} query={settledQuery}/></span><ArrowRight size={15}/></button>)}
                      </section>)}
                      {limit < hits.length && scenario !== 'degraded' && <button className="fs-more" onClick={() => setLimit(value => value + 6)}>加载更多 <span>{visibleHits.length} / {hits.length}</span></button>}
                    </>}
          </div>
          <footer className="fs-search-footer"><span>本地记录</span><span>示例数据，不读取真实会话</span></footer>
        </section>
        <section className="fs-hit-view" hidden={view !== 'hit'} aria-label="匹配消息">
          <div className="fs-hit-context"><Folder size={14}/><span>{hitConversation?.project}</span><span>{hitConversation?.date}</span><span className="fs-readonly">历史记录</span></div>
          <div className="fs-hit-scroll" ref={hitBody}><div className="fs-transcript">{hitConversation?.messages.map(message =>
            <article key={message.id} id={`hit-${message.id}`} tabIndex={-1} className={`fs-message ${message.role} ${message.id === selected?.messageId ? 'fs-matched' : ''}`}>
              <div className="fs-message-heading">{message.role === 'user' ? '你' : <><img src="/StepCode.svg" alt=""/>Step Code</>}
                {message.id === selected?.messageId && <span className="fs-match-label"><TextSearch size={13}/>匹配消息</span>}<CopyButton text={message.text}/></div>
              <p><Highlight text={message.text} query={settledQuery}/></p>
            </article>)}</div></div>
          <footer className="fs-hit-footer"><button className="fs-back-search" onClick={() => setView('search')}><ArrowLeft size={14}/>返回搜索结果</button>
            <button onClick={() => { if (hitConversation) openConversation(hitConversation.id); }}>打开此会话<ArrowRight size={14}/></button></footer>
        </section>
      </main>
    </div>
  </div>;
}

createRoot(document.getElementById('root')!).render(<Preview/>);
