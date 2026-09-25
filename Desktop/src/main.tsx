import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ArrowUp, Square, Plus, Folder, FolderOpen, MessageSquare, Settings as SettingsIcon, PanelLeft, X, Search, ChevronDown, ChevronRight, Terminal, Copy, Check, RotateCcw, Paperclip, Trash2, Pencil, Cpu, SlidersHorizontal, AlertCircle, Download, Plug, BookOpen, LogOut, SunMoon, ExternalLink, FileCode2 } from 'lucide-react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import type { Snapshot, Settings, Message, Content, UIRequest, McpServer } from './contracts';
import './style.css';
import './layout.css';
import { applyMessageEvent } from './message-events';
import { WindowBar } from './WindowBar';

const bridge = window.desktop;
const initial: Snapshot = { preferences: { theme: 'system', language: 'zh', workspaces: [] }, status: 'disconnected', messages: [], models: [], sessions: [] };
const basename = (p: string) => p.split(/[\\/]/).filter(Boolean).at(-1) ?? p;
function IconButton({ title, children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { title: string }) { return <button type="button" className="icon-button" title={title} aria-label={title} {...props}>{children}</button>; }
function Code({ children, className }: any) {
  const [copied, setCopied] = useState(false);
  if (!className) return <code>{children}</code>;
  return <span className="code-block"><span className="code-header">{className.replace('hljs language-', '').replace('language-', '')}<IconButton title="Copy" onClick={() => { void navigator.clipboard.writeText(String(children)); setCopied(true); setTimeout(() => setCopied(false), 1800); }}>{copied ? <Check size={14}/> : <Copy size={14}/>}</IconButton></span><code className={className}>{children}</code></span>;
}
function MessageView({ message, inspect }: { message: Message; inspect: (value: string) => void }) {
  const blocks: Content[] = typeof message.content === 'string' ? [{ type: 'text', text: message.content }] : message.content ?? [];
  if (message.role === 'toolResult') return <details className={`tool-result ${message.isError ? 'failed' : ''}`}><summary><Terminal size={14}/><span>{message.toolName ?? 'Tool'}</span><span className="tool-outcome">{message.isError ? 'Error' : 'Result'}</span><ChevronDown size={14}/></summary><pre>{blocks.filter(b => b.type === 'text').map(b => b.text).join('\n')}</pre>{blocks.filter(b => b.type === 'image').map((b, i) => <img key={i} src={`data:${b.mimeType};base64,${b.data}`} alt="Tool output"/>)}</details>;
  return <article className={`message ${message.role}`}><div className="message-label">{message.role === 'user' ? 'You' : 'Step Code'}<span>{message.timestamp ? new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}</span></div><div className="message-body">{blocks.map((b, i) => {
    if (b.type === 'thinking') return <details className="thinking" key={i}><summary>Thinking</summary><Markdown>{b.thinking ?? ''}</Markdown></details>;
    if (b.type === 'toolCall') return <button className="tool-call" key={i} onClick={() => inspect(JSON.stringify({ tool: b.name, arguments: b.arguments }, null, 2))}><Terminal size={14}/><span>{b.name}</span><code>{JSON.stringify(b.arguments ?? {}).slice(0, 95)}</code><ChevronRight size={14}/></button>;
    if (b.type === 'image') return <img className="attachment" key={i} src={`data:${b.mimeType};base64,${b.data}`} alt="Attachment"/>;
    if (b.type === 'text') return <Markdown key={i} remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]} components={{ code: Code, a: ({ children, href }) => <a href={href} target="_blank" rel="noreferrer">{children}</a>, img: ({ src, alt }) => src?.startsWith('data:image/') ? <img src={src} alt={alt}/> : <span>{alt}</span> }}>{b.text ?? ''}</Markdown>;
    return null;
  })}</div></article>;
}
function App() {
  const [data, setData] = useState(initial);
  const [error, setError] = useState('');
  const [draft, setDraft] = useState('');
  const [images, setImages] = useState<Content[]>([]);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [collapsedWorkspaces, setCollapsedWorkspaces] = useState<Set<string>>(new Set());
  const [sidebar, setSidebar] = useState(true);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [tab, setTab] = useState('account');
  const [details, setDetails] = useState('');
  const [requests, setRequests] = useState<UIRequest[]>([]);
  const [answer, setAnswer] = useState('');
  const [levels, setLevels] = useState<string[]>([]);
  const [commands, setCommands] = useState<{ name: string; description?: string; source?: string }[]>([]);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState('');
  const [loginProfile, setLoginProfile] = useState('step_plan');
  const [key, setKey] = useState('');
  const [loggingIn, setLoggingIn] = useState(false);
  const [mcpEdit, setMcpEdit] = useState<{ name: string; original?: string; config: McpServer; args: string; secrets: string } | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const scroll = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  const zh = data.preferences.language === 'zh';
  const t = (cn: string, en: string) => zh ? cn : en;
  const connected = data.status === 'connected';
  const current = data.sessions.find(s => s.id === data.state?.sessionId) ?? (data.state?.sessionName ? { name: data.state.sessionName } : undefined);
  const run = async <T,>(action: () => Promise<T>): Promise<T | undefined> => { try { setError(''); return await action(); } catch (e) { setError(String(e instanceof Error ? e.message : e)); } };
  const refresh = async () => { if (bridge) { const value = await bridge.snapshot(); setData(value); setBusy(Boolean(value.state?.isStreaming)); } };
  const applySnapshot = async (action: () => Promise<Snapshot | null>) => { setLoading(true); await run(async () => { const result = await action(); if (result) setData(result); setRequests([]); follow.current = true; }); setLoading(false); };
  const command = async (type: string, args?: Record<string, unknown>) => run(async () => { const result = await bridge!.command(type, args); if (!['prompt', 'abort', 'extension_ui_response'].includes(type)) await refresh(); return result; });
  useEffect(() => {
    void run(refresh).finally(() => setLoading(false));
    if (!bridge) return;
    return bridge.onEvent(event => {
      if (event.type === 'agent_start') setBusy(true);
      if (event.type === 'agent_end') { setBusy(false); void run(refresh); }
      if (event.type === 'desktop_exit') { setBusy(false); setData(d => ({ ...d, status: 'disconnected', state: undefined })); setRequests([]); }
      if (event.type === 'desktop_status') setData(d => ({ ...d, status: event.status }));
      if (event.type === 'desktop_error') setError(event.message);
      if (['message_start', 'message_update', 'message_end'].includes(event.type)) setData(d => ({ ...d, messages: applyMessageEvent(d.messages, event) }));
      if (event.type === 'extension_ui_request') {
        if (['select', 'input', 'editor', 'confirm'].includes(event.method)) setRequests(r => [...r.filter(v => v.id !== event.id), event as UIRequest]);
        if (event.method === 'notify') setError(event.message);
        if (event.method === 'set_editor_text') setDraft(event.text);
      }
    });
  }, []);
  useEffect(() => {
    if (!connected) return;
    void run(async () => { setLevels((await bridge!.command('get_available_thinking_levels')).levels); setCommands((await bridge!.command('get_commands')).commands); });
  }, [connected, data.state?.model?.id]);
  useEffect(() => { if (follow.current) bottom.current?.scrollIntoView({ behavior: 'instant' }); }, [data.messages, busy]);
  useEffect(() => {
    const input = document.querySelector<HTMLTextAreaElement>('.composer > textarea');
    if (input) { input.style.height = 'auto'; input.style.height = `${Math.min(input.scrollHeight, 180)}px`; }
  }, [draft]);
  useEffect(() => {
    const query = matchMedia('(prefers-color-scheme: dark)');
    const update = () => document.documentElement.dataset.theme = data.preferences.theme === 'system' ? query.matches ? 'dark' : 'light' : data.preferences.theme;
    update(); query.addEventListener('change', update); document.documentElement.lang = zh ? 'zh-CN' : 'en'; return () => query.removeEventListener('change', update);
  }, [data.preferences.theme, zh]);
  useEffect(() => { setAnswer(requests[0]?.prefill ?? ''); }, [requests[0]?.id]);
  useEffect(() => {
    if (!settingsOpen && !mcpEdit && !requests.length && !renaming) return;
    const previous = document.activeElement as HTMLElement | null;
    const dialog = [...document.querySelectorAll<HTMLElement>('[role="dialog"]')].at(-1);
    const controls = () => [...(dialog?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href]') ?? [])];
    controls()[0]?.focus();
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const items = controls(); if (!items.length) return;
      if (e.shiftKey && document.activeElement === items[0]) { e.preventDefault(); items.at(-1)?.focus(); }
      else if (!e.shiftKey && document.activeElement === items.at(-1)) { e.preventDefault(); items[0].focus(); }
    };
    document.addEventListener('keydown', handler);
    return () => { document.removeEventListener('keydown', handler); previous?.focus(); };
  }, [settingsOpen, Boolean(mcpEdit), requests[0]?.id, renaming, tab]);
  useEffect(() => {
    const r = requests[0]; if (!r?.timeout) return;
    const timer = setTimeout(() => { void respond({ cancelled: true }); }, r.timeout); return () => clearTimeout(timer);
  }, [requests[0]?.id]);
  const respond = async (value: Record<string, unknown>) => {
    const r = requests[0]; if (!r) return;
    await run(async () => { await bridge!.command('extension_ui_response', { id: r.id, ...value }); setRequests(q => q.filter(v => v.id !== r.id)); });
  };
  const openSettings = async () => { setSettingsOpen(true); await run(async () => setSettings(await bridge!.settings())); };
  const send = async () => {
    if ((!draft.trim() && !images.length) || !connected || loading) return;
    const message = draft; const attached = images; setDraft(''); setImages([]); follow.current = true;
    await run(async () => { try { await bridge!.command('prompt', { message, images: attached }); } catch (e) { setDraft(message); setImages(attached); throw e; } });
  };
  const setPreference = async (patch: any) => run(async () => { const p = await bridge!.preferences(patch); setData(d => ({ ...d, preferences: p })); });
  const saveMcp = async () => run(async () => {
    if (!mcpEdit) return;
    const parsed = JSON.parse(mcpEdit.args || '[]'); const secrets = JSON.parse(mcpEdit.secrets || '{}');
    await bridge!.saveMcp(mcpEdit.name, { ...mcpEdit.config, args: parsed }, secrets);
    setMcpEdit(null); setSettings(await bridge!.settings());
  });
  const workspaceKey = (path: string) => path.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
  const workspaceGroups = new Map<string, { path: string; sessions: typeof data.sessions }>();
  for (const path of data.preferences.workspaces) {
    const key = workspaceKey(path);
    if (!workspaceGroups.has(key)) workspaceGroups.set(key, { path, sessions: [] });
  }
  const independentSessions = data.sessions.filter(session => session.independent ?? !workspaceGroups.has(workspaceKey(session.cwd)));
  for (const session of data.sessions) if (!independentSessions.includes(session)) workspaceGroups.get(workspaceKey(session.cwd))?.sessions.push(session);
  const toggleWorkspace = (key: string) => setCollapsedWorkspaces(previous => { const next = new Set(previous); next.has(key) ? next.delete(key) : next.add(key); return next; });
  const independentExpanded = !collapsedWorkspaces.has('__independent__');
  const createInWorkspace = async (path: string, sessions: typeof data.sessions) => {
    setCollapsedWorkspaces(previous => { const next = new Set(previous); next.delete(workspaceKey(path)); return next; });
    await applySnapshot(async () => {
      if (!connected || workspaceKey(path) !== workspaceKey(data.preferences.workspace ?? '')) {
        if (data.preferences.workspaces.includes(path)) await bridge!.workspace(path);
        else await bridge!.switchSession(sessions[0].id);
      }
      await bridge!.command('new_session');
      return bridge!.snapshot();
    });
  };
  return <div className={`app ${sidebar ? '' : 'sidebar-hidden'}`}>
    <WindowBar language={data.preferences.language}/>
    {error && (settingsOpen || mcpEdit || requests.length > 0) && <div className="modal-error" role="alert"><AlertCircle size={16}/><span>{error}</span><IconButton title="Dismiss" onClick={() => setError('')}><X size={16}/></IconButton></div>}
    <aside className="sidebar"><div className="sidebar-dismiss"><IconButton title={t('收起侧栏', 'Collapse sidebar')} onClick={() => setSidebar(false)}><PanelLeft size={17}/></IconButton></div>
      <div className="sidebar-identity"><img src="./StepCode.svg" width="26" height="26" alt=""/><span className="sidebar-wordmark"><img className="wordmark-light" src="./wordmark-light.png" alt="Desktop for Step Code"/><img className="wordmark-dark" src="./wordmark-dark.png" alt="Desktop for Step Code"/></span></div>
      <button className="new-chat" disabled={!bridge || busy || loading} onClick={() => void applySnapshot(() => bridge!.newIndependentSession())}><Plus size={17}/>{t('新建会话', 'New session')}</button>
      <nav className="workspace-tree" aria-label={t('工作区与会话', 'Workspaces and sessions')}>
        <section className="workspace-group independent-group" aria-label={t('独立会话', 'Independent sessions')}>
          <div className="workspace-heading"><button className="workspace-toggle" aria-label={t('独立会话', 'Independent sessions')} aria-expanded={independentExpanded} onClick={() => toggleWorkspace('__independent__')}><MessageSquare size={15}/><span>{t('独立会话', 'Independent sessions')}</span><small>{independentSessions.length}</small></button></div>
          <div className="workspace-disclosure" aria-hidden={!independentExpanded} inert={!independentExpanded}>
            <div className="workspace-sessions">{independentSessions.map(s => <div key={s.id} className={`session-row ${s.id === data.state?.sessionId ? 'selected' : ''}`}><button aria-current={s.id === data.state?.sessionId ? 'page' : undefined} title={`${s.name || s.firstMessage || t('新会话', 'New session')}\n${new Date(s.modified).toLocaleDateString()} · ${s.messageCount} ${t('条消息', 'messages')}`} disabled={busy || loading} onClick={() => void applySnapshot(() => bridge!.switchSession(s.id))}><span>{s.name || s.firstMessage || t('新会话', 'New session')}</span></button><IconButton title={t('删除会话', 'Delete session')} disabled={busy || loading} onClick={() => void run(async () => { if (await bridge!.deleteSession(s.id)) await refresh(); })}><Trash2 size={13}/></IconButton></div>)}</div>
          </div>
        </section>
        <div className="section-label">{t('项目', 'Projects')}<IconButton title={t('添加工作区', 'Add workspace')} disabled={!bridge || busy || loading} onClick={() => void applySnapshot(() => bridge!.chooseWorkspace())}><Plus size={15}/></IconButton></div>
        {[...workspaceGroups].map(([key, group]) => {
          const expanded = !collapsedWorkspaces.has(key);
          return <section className="workspace-group" key={key} aria-label={group.path}>
            <div className={`workspace-heading ${key === workspaceKey(data.preferences.workspace ?? '') ? 'current' : ''}`}>
              <button className="workspace-toggle" title={group.path} aria-label={basename(group.path)} aria-expanded={expanded} onClick={() => toggleWorkspace(key)}>{expanded ? <FolderOpen size={15}/> : <Folder size={15}/>}<span>{basename(group.path)}</span></button>
              <IconButton title={t(`在 ${basename(group.path)} 新建会话`, `New session in ${basename(group.path)}`)} disabled={!bridge || busy || loading} onClick={() => void createInWorkspace(group.path, group.sessions)}><Plus size={15}/></IconButton>
            </div>
            <div className="workspace-disclosure" aria-hidden={!expanded} inert={!expanded}>
              <div className="workspace-sessions">{group.sessions.map(s => <div key={s.id} className={`session-row ${s.id === data.state?.sessionId ? 'selected' : ''}`}><button aria-current={s.id === data.state?.sessionId ? 'page' : undefined} title={`${s.name || s.firstMessage || t('新会话', 'New session')}\n${new Date(s.modified).toLocaleDateString()} · ${s.messageCount} ${t('条消息', 'messages')}`} disabled={busy || loading} onClick={() => void applySnapshot(() => bridge!.switchSession(s.id))}><span>{s.name || s.firstMessage || t('新会话', 'New session')}</span></button><IconButton title={t('删除会话', 'Delete session')} disabled={busy || loading} onClick={() => void run(async () => { if (await bridge!.deleteSession(s.id)) await refresh(); })}><Trash2 size={13}/></IconButton></div>)}{!group.sessions.length && <span className="workspace-empty">{t('暂无会话', 'No sessions yet')}</span>}</div>
            </div>
          </section>;
        })}
        {!workspaceGroups.size && <button disabled={!bridge || loading} onClick={() => void applySnapshot(() => bridge!.chooseWorkspace())}><FolderOpen size={15}/>{t('打开项目', 'Open project')}</button>}
      </nav>
      <div className="sidebar-bottom"><button onClick={() => void openSettings()} disabled={!bridge}><SettingsIcon size={17}/>{t('设置', 'Settings')}<span>0.1.0</span></button><div className="connection"><i className={connected ? 'online' : ''}/>{connected ? t('Step Code 已连接', 'Step Code connected') : loading ? t('连接中', 'Connecting') : t('未连接', 'Disconnected')}</div></div>
    </aside>
    <main><header className="topbar"><IconButton title={t('侧栏', 'Sidebar')} onClick={() => setSidebar(!sidebar)}><PanelLeft size={18}/></IconButton><div className="breadcrumb"><span>{data.independent ? t('独立会话', 'Independent session') : data.preferences.workspace ? basename(data.preferences.workspace) : t('工作区', 'Workspace')}</span><span>/</span><strong>{current?.name || t('新会话', 'New session')}</strong></div><div className="top-actions"><IconButton title={t('重命名', 'Rename')} disabled={!connected || busy} onClick={() => { setName(current?.name ?? ''); setRenaming(true); }}><Pencil size={15}/></IconButton><IconButton title={t('重启运行时', 'Restart runtime')} disabled={!data.preferences.workspace || busy || loading} onClick={() => void applySnapshot(() => bridge!.restart())}><RotateCcw size={16}/></IconButton><IconButton title={t('会话统计', 'Session statistics')} disabled={!connected} onClick={() => void run(async () => setDetails(JSON.stringify(await bridge!.command('get_session_stats'), null, 2)))}><SlidersHorizontal size={17}/></IconButton></div></header>
      {error && <div className="error-banner" role="alert"><AlertCircle size={16}/><span>{error}</span><IconButton title={t('关闭', 'Dismiss')} onClick={() => setError('')}><X size={14}/></IconButton></div>}
      {!bridge && <div className="error-banner">{t('请从 Electron 桌面窗口打开此应用。', 'Open this application in the Electron desktop window.')}</div>}
      <div className="conversation" ref={scroll} onScroll={() => { if (scroll.current) follow.current = scroll.current.scrollHeight - scroll.current.scrollTop - scroll.current.clientHeight < 100; }}>
        {!data.messages.length ? <div className="empty-state"><div className="empty-symbol"><img src="./StepCode.svg" width="48" height="48" alt=""/></div><h1>{t('让想法阶跃星辰', 'Let ideas reach the stars')}</h1><p>{data.independent ? t('独立会话', 'Independent session') : data.preferences.workspace ? basename(data.preferences.workspace) : t('选择一个本地项目', 'Choose a local project')}</p><div className="empty-actions"><button disabled={!bridge || loading} onClick={() => void applySnapshot(() => bridge!.chooseWorkspace())}><FolderOpen size={16}/>{t('打开项目', 'Open project')}</button><button disabled={!bridge} onClick={() => void openSettings()}><SettingsIcon size={16}/>{t('账户设置', 'Account settings')}</button></div><span className="community-note">Desktop for Step Code · {t('独立社区项目', 'Independent community project')}</span></div> : <div className="messages">{data.messages.map((m, i) => <MessageView key={i} message={m} inspect={setDetails}/>)}{busy && <div className="working"><span className="working-dot"/>{t('正在执行', 'Working')}</div>}<div ref={bottom}/></div>}
      </div>
      <div className="composer-wrap"><div className="session-location"><button title={data.preferences.workspace} disabled={!bridge || !data.preferences.workspace || loading} onClick={() => void run(() => bridge!.openSessionFolder())}><FolderOpen size={14}/>{data.independent ? t('会话文件夹', 'Session folder') : basename(data.preferences.workspace ?? '')}</button>{data.independent && <button disabled={!bridge || busy || loading} onClick={() => void applySnapshot(() => bridge!.chooseWorkspace())}>{t('选择项目', 'Choose project')}<ChevronDown size={13}/></button>}</div>{draft.startsWith('/') && commands.filter(c => c.name.startsWith(draft.slice(1))).length > 0 && <div className="command-menu">{commands.filter(c => c.name.startsWith(draft.slice(1))).slice(0, 6).map(c => <button key={c.name} onClick={() => setDraft(`/${c.name} `)}><code>/{c.name}</code><span>{c.description}</span></button>)}</div>}
        <div className="composer">{images.length > 0 && <div className="attachments">{images.map((im, i) => <div key={i}><img src={`data:${im.mimeType};base64,${im.data}`} alt="Attachment"/><IconButton title="Remove" onClick={() => setImages(v => v.filter((_, n) => n !== i))}><X size={12}/></IconButton></div>)}</div>}
          <textarea aria-label={t('消息', 'Message')} placeholder={connected ? t('你想做什么？', 'What would you like to work on?') : t('打开项目以开始', 'Open a project to begin')} value={draft} disabled={!connected || loading} onChange={e => setDraft(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(); } }}/>
          <div className="composer-tools"><IconButton title={t('添加图片', 'Attach images')} disabled={!connected || images.length >= 5} onClick={() => void run(async () => { const added = await bridge!.images(); setImages(v => [...v, ...added].slice(0, 5)); })}><Paperclip size={17}/></IconButton><select aria-label={t('模型', 'Model')} disabled={!connected || busy} value={data.state?.model ? `${data.state.model.provider}/${data.state.model.id}` : ''} onChange={e => { const m = data.models.find(m => `${m.provider}/${m.id}` === e.target.value); if (m) void command('set_model', { provider: m.provider, modelId: m.id }); }}><option value="">{t('选择模型', 'Select model')}</option>{data.models.map(m => <option key={`${m.provider}/${m.id}`} value={`${m.provider}/${m.id}`}>{m.name || m.id}</option>)}</select><select aria-label={t('思考等级', 'Thinking level')} disabled={!connected || busy || !levels.length} value={data.state?.thinkingLevel ?? ''} onChange={e => void command('set_thinking_level', { level: e.target.value })}>{!levels.length && <option value="">{t('思考', 'Thinking')}</option>}{levels.map(l => <option key={l}>{l}</option>)}</select><div className="spacer"/>{busy && <IconButton title={t('停止', 'Stop')} className="stop-button" onClick={() => void command('abort')}><Square size={15}/></IconButton>}<IconButton title={busy ? t('加入队列', 'Queue message') : t('发送', 'Send')} className="send-button" disabled={!connected || (!draft.trim() && !images.length) || loading} onClick={() => void send()}><ArrowUp size={18}/></IconButton></div>
        </div><div className="composer-footer"><span><i className={connected ? 'online' : ''}/>{busy ? t('执行中', 'Running') : connected ? t('就绪', 'Ready') : t('离线', 'Offline')}</span><span>{t('由 Step Code 驱动', 'Powered by Step Code')}</span></div>
      </div>
    </main>
    {details && <aside className="details-panel"><header><FileCode2 size={16}/>{t('详情', 'Details')}<IconButton title="Close" onClick={() => setDetails('')}><X size={17}/></IconButton></header><pre>{details}</pre></aside>}
    {settingsOpen && <div className="modal-backdrop"><section className="settings-dialog" role="dialog" aria-modal="true" aria-label={t('设置', 'Settings')}><header><h2>{t('设置', 'Settings')}</h2><IconButton title="Close" onClick={() => { setSettingsOpen(false); setKey(''); }}><X size={19}/></IconButton></header><div className="settings-layout"><nav>{[['account', Cpu, t('账户', 'Account')], ['mcp', Plug, 'MCP'], ['skills', BookOpen, t('资源', 'Resources')], ['general', SunMoon, t('通用', 'General')]].map(([id, Icon, title]: any) => <button key={id} className={tab === id ? 'selected' : ''} onClick={() => setTab(id)}><Icon size={17}/>{title}</button>)}</nav><div className="settings-content">
      {!settings ? <p>{t('加载中…', 'Loading…')}</p> : tab === 'account' ? <><h3>{t('Step 账户', 'Step account')}</h3><p className="muted">{settings.account.loggedIn ? `${settings.account.profile} · ${settings.account.validity}` : t('尚未登录', 'Not signed in')}</p><label>{t('登录方式', 'Sign-in method')}<select value={loginProfile} disabled={loggingIn} onChange={e => setLoginProfile(e.target.value)}>{settings.profiles.map(p => <option key={p.id} value={p.id}>{p.title}</option>)}</select></label>{settings.profiles.find(p => p.id === loginProfile)?.credentialSource === 'apiKey' && <label>API key<input type="password" autoComplete="off" value={key} onChange={e => setKey(e.target.value)}/></label>}<div className="button-row"><button className="primary" disabled={loggingIn || busy} onClick={() => void run(async () => { setLoggingIn(true); try { await bridge!.login(loginProfile, key); setKey(''); setSettings(await bridge!.settings()); if (data.preferences.workspace) await applySnapshot(() => bridge!.restart()); } finally { setLoggingIn(false); } })}><ExternalLink size={15}/>{loggingIn ? t('等待授权…', 'Waiting for sign-in…') : t('登录', 'Sign in')}</button>{loggingIn && <button onClick={() => void run(() => bridge!.cancelLogin())}>{t('取消', 'Cancel')}</button>}{settings.account.loggedIn && <button disabled={busy} onClick={() => void run(async () => { await bridge!.logout(); setSettings(await bridge!.settings()); await refresh(); })}><LogOut size={15}/>{t('退出登录', 'Sign out')}</button>}</div></> : tab === 'mcp' ? <><div className="section-heading"><h3>MCP servers</h3><IconButton title="Add MCP" onClick={() => setMcpEdit({ name: '', config: { command: '', args: [], enabled: true }, args: '[]', secrets: '{}' })}><Plus size={18}/></IconButton></div>{Object.entries(settings.mcp).map(([n, c]) => <div className="resource-row" key={n}><Plug size={18}/><div><strong>{n}</strong><small>{c.url || c.command}</small><small>{c.enabled ? t('已启用，重启后生效', 'Enabled; applies after restart') : t('已停用', 'Disabled')}</small></div><IconButton title="Edit" onClick={() => setMcpEdit({ name: n, original: n, config: c, args: JSON.stringify(c.args ?? []), secrets: '{}' })}><Pencil size={14}/></IconButton><IconButton title="Remove" onClick={() => { if (confirm(t(`移除 ${n}？`, `Remove ${n}?`))) void run(async () => { await bridge!.saveMcp(n, null); setSettings(await bridge!.settings()); }); }}><Trash2 size={14}/></IconButton></div>)}{!Object.keys(settings.mcp).length && <p className="muted">{t('尚未配置服务器', 'No servers configured')}</p>}<button disabled={!connected || busy} onClick={() => void applySnapshot(() => bridge!.restart())}><RotateCcw size={15}/>{t('重启并应用', 'Restart to apply')}</button></> : tab === 'skills' ? <><h3>{t('Skills 与命令', 'Skills and commands')}</h3>{settings.skills.map(s => <div className="resource-row" key={`${s.source}/${s.name}`}><BookOpen size={17}/><div><strong>{s.name}</strong><small>{s.description}</small><small>{s.source}</small></div></div>)}{commands.map(c => <div className="resource-row" key={c.name}><Terminal size={17}/><div><strong>/{c.name}</strong><small>{c.description}</small><small>{c.source}</small></div></div>)}{!settings.skills.length && !commands.length && <p className="muted">{t('没有已发现的资源', 'No resources discovered')}</p>}</> : <><h3>{t('外观与语言', 'Appearance and language')}</h3><label>{t('主题', 'Theme')}<select value={data.preferences.theme} onChange={e => void setPreference({ theme: e.target.value })}><option value="system">{t('跟随系统', 'System')}</option><option value="light">{t('浅色', 'Light')}</option><option value="dark">{t('深色', 'Dark')}</option></select></label><label>{t('语言', 'Language')}<select value={data.preferences.language} onChange={e => void setPreference({ language: e.target.value })}><option value="zh">简体中文</option><option value="en">English</option></select></label><h3>{t('关于', 'About')}</h3><p>Desktop for Step Code 0.1.0</p><p className="muted">{t('社区预览版', 'Community preview')}</p><button onClick={() => void run(() => bridge!.diagnostics())}><Download size={15}/>{t('导出脱敏诊断', 'Export diagnostics')}</button></>}
    </div></div></section></div>}
    {mcpEdit && <div className="modal-backdrop higher"><section className="small-dialog" role="dialog" aria-modal="true" aria-label="MCP"><header><h2>MCP server</h2><IconButton title="Close" onClick={() => setMcpEdit(null)}><X size={18}/></IconButton></header><label>{t('名称', 'Name')}<input value={mcpEdit.name} disabled={Boolean(mcpEdit.original)} onChange={e => setMcpEdit({ ...mcpEdit, name: e.target.value })}/></label><label>{t('传输', 'Transport')}<select value={mcpEdit.config.url !== undefined ? 'http' : 'stdio'} onChange={e => setMcpEdit({ ...mcpEdit, config: e.target.value === 'http' ? { url: '', enabled: true } : { command: '', args: [], enabled: true } })}><option value="stdio">stdio</option><option value="http">HTTP</option></select></label>{mcpEdit.config.url !== undefined ? <label>URL<input value={mcpEdit.config.url} onChange={e => setMcpEdit({ ...mcpEdit, config: { ...mcpEdit.config, url: e.target.value } })}/></label> : <><label>{t('可执行文件', 'Executable')}<input value={mcpEdit.config.command ?? ''} onChange={e => setMcpEdit({ ...mcpEdit, config: { ...mcpEdit.config, command: e.target.value } })}/></label><label>{t('参数（JSON 数组）', 'Arguments (JSON array)')}<textarea value={mcpEdit.args} onChange={e => setMcpEdit({ ...mcpEdit, args: e.target.value })}/></label></>}<label>{t('新增或替换环境变量（JSON）', 'Add or replace environment variables (JSON)')}<textarea value={mcpEdit.secrets} onChange={e => setMcpEdit({ ...mcpEdit, secrets: e.target.value })}/></label><label className="checkbox"><input type="checkbox" checked={mcpEdit.config.enabled !== false} onChange={e => setMcpEdit({ ...mcpEdit, config: { ...mcpEdit.config, enabled: e.target.checked } })}/>{t('启用', 'Enabled')}</label><button className="primary" onClick={() => void saveMcp()}>{t('保存', 'Save')}</button></section></div>}
    {(requests[0] || renaming) && <div className="modal-backdrop higher"><section className="small-dialog" role="dialog" aria-modal="true" aria-label={requests[0]?.title ?? 'Rename'}><h2>{requests[0]?.title ?? t('重命名会话', 'Rename session')}</h2>{requests[0]?.message && <p>{requests[0].message}</p>}{renaming ? <input autoFocus value={name} onChange={e => setName(e.target.value)}/> : requests[0].method === 'select' ? requests[0].options?.map(o => <button className="option" key={o} onClick={() => void respond({ value: o })}>{o}</button>) : requests[0].method !== 'confirm' ? <textarea autoFocus placeholder={requests[0].placeholder} value={answer} onChange={e => setAnswer(e.target.value)}/> : null}<div className="button-row"><button onClick={() => renaming ? setRenaming(false) : void respond({ cancelled: true })}>{t('取消', 'Cancel')}</button>{(renaming || requests[0]?.method !== 'select') && <button className="primary" onClick={() => { if (renaming) void run(async () => { await bridge!.command('set_session_name', { name }); setRenaming(false); await refresh(); }); else void respond(requests[0].method === 'confirm' ? { confirmed: true } : { value: answer }); }}>{t('确认', 'Confirm')}</button>}</div></section></div>}
  </div>;
}
class RenderBoundary extends React.Component<{ children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (this.state.failed) return <><WindowBar language="zh"/><div className="empty-state" role="alert"><h1>界面暂时无法显示 / Display error</h1><p>重新加载界面不会重新发送任务。 / Reloading does not resend your task.</p><button onClick={() => location.reload()}>重新加载 / Reload</button></div></>;
    return this.props.children;
  }
}
createRoot(document.getElementById('root')!).render(<RenderBoundary><App/></RenderBoundary>);
