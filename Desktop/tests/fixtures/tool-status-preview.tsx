import { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ArrowUp, MessageSquare, Moon, PanelLeft, Plus, RotateCcw, Settings, Sun, X } from 'lucide-react';
import type { PluginUpdateOperation, PluginUpdatePreflight } from '../../src/plugin-update';
import type { PluginReloadState } from '../../src/plugin-reload';
import { PluginCenter, type PluginCenterBridge } from '../../src/PluginCenter';
import { PluginLifecyclePreview } from './plugin-lifecycle-preview';
import { SidebarTaskActions } from '../../src/ScheduledTasks';
import { AppTooltip } from '../../src/AppTooltip';
import { applyTheme } from '../../src/theme';
import { startupNeedsAttention, type RuntimeStartup } from '../../src/runtime-startup';
import type { CapabilityCatalog, CapabilityMutation } from '../../src/capabilities';
import '../../src/style.css';
import '../../src/theme.css';
import '../../src/layout.css';
import '../../src/session-navigation.css';
import './tool-status-preview.css';

type Mode = 'failed' | 'connecting' | 'ready' | 'cleanup' | 'discovery';
type View = 'plugins' | 'chat' | 'scheduled';
const labels: Record<Mode, string> = {
  failed: '部分不可用', connecting: '连接中', ready: '全部正常',
  cleanup: '清理未确认', discovery: '发现失败',
};
const plugins = [
  { id: 'bvr', name: 'Bilibili Video Research', description: '结合字幕、语音与视频画面，整理带时间定位的研究证据。',
    mcpServers: ['bvr__bvr'], version: '0.1.0', warnings: [],
    icon: { kind: 'png' as const, dataUrl: new URL('./plugin-center-assets/bvr.png', import.meta.url).href } },
  { id: 'playwright', name: 'Playwright', description: '打开网页、操作页面与验证浏览器交互。',
    mcpServers: ['playwright__browser'], version: '1.0.0', warnings: [], icon: { kind: 'step' as const } },
  { id: 'steppage', name: 'StepPage', description: '发布和管理项目网页。',
    mcpServers: ['steppage__steppage'], version: '1.0.0', warnings: [], icon: { kind: 'step' as const } },
].map(plugin => ({ ...plugin, package: { ref: `preview:${plugin.id}`, provenance: 'recorded' as const,
  documentation: {}, tutorials: [], links: [], warnings: [] } }));
const lifecyclePlugins = [...plugins, ...[
  { id: 'filesystem', name: 'Filesystem', description: '读取与整理工作区文件。' },
  { id: 'git', name: 'Git', description: '查看仓库提交、分支和差异。' },
  { id: 'fetch', name: 'Fetch', description: '获取网页内容并转换为可阅读的文本。' },
  { id: 'memory', name: 'Memory', description: '保存和检索项目知识条目。' },
  { id: 'sqlite', name: 'SQLite', description: '查询本地数据库并检查数据结构。' },
  { id: 'time', name: 'Time', description: '查询时间与转换时区。' },
].map(plugin => ({ ...plugins[1], ...plugin, mcpServers: [`${plugin.id}__main`],
  package: { ...plugins[1].package, ref: `preview:${plugin.id}` } }))];

function Preview() {
  const params = new URLSearchParams(location.search);
  const lifecycle = params.has('lifecycle');
  const reloadFailure = params.get('reloadOutcome') === 'failure';
  const reloadProtection = params.get('reloadProtection');
  const [marketTab, setMarketTab] = useState<'discover' | 'sources'>();
  const [previewRevision, setPreviewRevision] = useState(0);
  const [loadFailure, setLoadFailure] = useState(false);
  const [mode, setMode] = useState<Mode>('failed');
  const [view, setView] = useState<View>('plugins');
  const [dark, setDark] = useState(() => localStorage.getItem('tool-status-web-theme') !== 'light');
  const [sidebar, setSidebar] = useState(() => matchMedia('(min-width: 760px)').matches);
  const [mcpOpen, setMcpOpen] = useState(false);
  const [enabled, setEnabled] = useState<Record<string, boolean>>({});
  const [draft, setDraft] = useState('');
  const [messages, setMessages] = useState<string[]>([]);
  const [startedAt, setStartedAt] = useState(Date.now());
  const [occupancy, setOccupancy] = useState<'idle' | 'busy' | 'unknown'>('idle');
  const [removed, setRemoved] = useState<string[]>([]);
  const [updated, setUpdated] = useState<string[]>([]);
  const [sessionName, setSessionName] = useState('插件联调记录');
  const previews = useRef(new Map<string, { preview: PluginUpdatePreflight; remove: boolean }>());
  const operations = useRef(new Map<string, PluginUpdateOperation>());
  const reloads = useRef(new Map<string, PluginReloadState & { started: number; ref: string }>());
  useEffect(() => {
    applyTheme(dark ? 'dark' : 'light', false);
    localStorage.setItem('tool-status-web-theme', dark ? 'dark' : 'light');
  }, [dark]);
  useEffect(() => {
    if (!mcpOpen) return;
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') setMcpOpen(false); };
    document.addEventListener('keydown', close);
    return () => document.removeEventListener('keydown', close);
  }, [mcpOpen]);
  const changeMode = (next: Mode) => { setMode(next); setStartedAt(Date.now()); };
  const state: RuntimeStartup = {
    protocol: 1, configurationRevision: 'web-preview', catalogRevision: 1, coreReadyAt: startedAt,
    runtimeId: 'web-preview', sessionId: 'preview-chat', startupEpoch: `${mode}:${startedAt}`,
    cleanupConfirmed: mode !== 'cleanup', discovery: mode === 'discovery' ? 'failed' : 'ready',
    targetBound: true, modelReady: true,
    tools: plugins.map((plugin, index) => ({
      name: plugin.mcpServers[0], startedAt,
      status: enabled[plugin.mcpServers[0]] === false ? 'disabled'
        : index > 0 || mode === 'ready' ? 'connected' : mode === 'connecting' ? 'connecting' : 'failed',
      toolCount: index > 0 || mode === 'ready' ? 8 : 0,
      ...(mode === 'cleanup' && index === 0 ? { cleanupConfirmed: false } : {}),
    })),
  };
  const bridge = useMemo(() => {
    const catalog: CapabilityCatalog = {
      plugins: plugins.filter(plugin => !removed.includes(plugin.id)).map(plugin => ({
        ...plugin, version: updated.includes(plugin.id) ? '2.0.0' : plugin.version,
        package: updated.includes(plugin.id) ? { ...plugin.package, ref: `updated:${plugin.id}` } : plugin.package,
        update: updated.includes(plugin.id) ? { status: 'current' as const } : { status: 'available' as const, version: '2.0.0', ref: `candidate:${plugin.id}` },
      })), pluginUpdates: true, available: [], marketplaces: [], skills: [], warnings: [],
      mcp: plugins.filter(plugin => !removed.includes(plugin.id)).map(plugin => ({ name: plugin.mcpServers[0], source: 'plugin', pluginId: plugin.id,
        pluginName: plugin.name, transport: 'stdio', enabled: enabled[plugin.mcpServers[0]] !== false, configurable: true })),
    };
    const preflight = async (input: { id: string }, remove: boolean) => {
      const preview: PluginUpdatePreflight = { token: crypto.randomUUID(), pluginId: input.id,
        version: remove ? plugins.find(plugin => plugin.id === input.id)!.version : '2.0.0',
        status: 'compatible', changes: [], readiness: occupancy === 'idle' ? 'needs-release' : 'blocked',
        blockers: occupancy === 'idle' ? [] : [occupancy === 'busy' ? 'session-busy' : 'runtime-unknown'],
        sessions: [{ runtimeId: 'mock-owner', sessionId: 'preview-chat', name: '插件联调记录', status: occupancy },
          { runtimeId: 'mock-second', sessionId: 'preview-research', name: '每周资料整理', status: 'idle' }] };
      previews.current.set(preview.token, { preview, remove });
      return preview;
    };
    const apply = async (input: { token: string; release: boolean }, remove: boolean) => {
      const item = previews.current.get(input.token);
      previews.current.delete(input.token);
      if (!item || item.remove !== remove || item.preview.readiness === 'blocked' || !input.release)
        throw new Error('capability:operation-denied');
      await new Promise(resolve => setTimeout(resolve, 600));
      const result: PluginUpdateOperation = { id: input.token, pluginId: item.preview.pluginId, version: item.preview.version,
        phase: 'done', installation: 'committed', warnings: [],
        sessions: item.preview.sessions.map(session => ({ ...session, restoration: 'restored' })) };
      operations.current.set(item.preview.pluginId, result);
      if (remove) {
        catalog.plugins = catalog.plugins.filter(plugin => plugin.id !== item.preview.pluginId);
        catalog.mcp = catalog.mcp.filter(server => server.pluginId !== item.preview.pluginId);
        setRemoved(current => [...current, item.preview.pluginId]);
      } else {
        catalog.plugins = catalog.plugins.map(plugin => plugin.id === item.preview.pluginId
          ? { ...plugin, version: '2.0.0', update: { status: 'current' as const } } : plugin);
        setUpdated(current => [...current, item.preview.pluginId]);
      }
      return result;
    };
    return {
      pluginReloadStart: async (input: { id: string; ref: string }) => {
        const current = reloads.current.get(input.id);
        if (current?.ref === input.ref && current.sessions.some(item => ['waiting', 'applying'].includes(item.phase))) return structuredClone(current);
        await new Promise(resolve => setTimeout(resolve, 150));
        const result: PluginReloadState & { started: number; ref: string } = { pluginId: input.id, name: plugins.find(item => item.id === input.id)!.name,
          mode: 'plugin-mcp', operationId: crypto.randomUUID(), started: Date.now(), ref: input.ref, sessions: [
            { runtimeId: 'mock-owner', sessionId: 'preview-chat', name: '插件联调记录',
              phase: occupancy === 'idle' ? 'applying' : 'waiting',
              reason: occupancy === 'busy' ? 'occupied' : occupancy === 'unknown' ? 'unavailable' : undefined },
            { runtimeId: 'mock-second', sessionId: 'preview-research', name: '每周资料整理', phase: 'applying' },
          ] };
        if (!current && (reloadProtection === 'external' || reloadProtection === 'remote-attached')) {
          result.sessions[0] = { runtimeId: 'mock-owner', sessionId: 'preview-chat', name: 'Relatum',
            phase: 'cancelled', reason: reloadProtection };
        }
        reloads.current.set(input.id, result);
        return structuredClone(result);
      },
      pluginReloadState: async (input: { id: string; ref: string }) => {
        const current = reloads.current.get(input.id);
        if (current?.ref !== input.ref) return null;
        if (Date.now() - current.started > 900) for (const item of current.sessions) {
          if (item.phase === 'applying' || item.phase === 'waiting' && occupancy === 'idle') {
            item.phase = reloadFailure ? 'failed' : 'applied';
            if (reloadFailure) item.reason = 'failed';
            else delete item.reason;
          }
        }
        return structuredClone(current);
      },
      pluginReloadCancel: async (input: { id: string; operationId: string }) => {
        const current = reloads.current.get(input.id);
        if (!current || current.operationId !== input.operationId) throw new Error('capability:stale');
        current.sessions = current.sessions.map(item => item.phase === 'waiting' ? { ...item, phase: 'cancelled', reason: undefined } : item);
        return structuredClone(current);
      },
      pluginRemovalPreflight: (input: { id: string }) => preflight(input, true),
      pluginRemovalApply: (input: { token: string; release: boolean }) => apply(input, true),
      pluginRemovalOperation: async (input: { pluginId: string }) => operations.current.get(input.pluginId) ?? null,
      pluginUpdatePreflight: (input: { id: string }) => preflight(input, false),
      pluginUpdateApply: (input: { token: string; release: boolean }) => apply(input, false),
      pluginUpdateOperation: async (input: { pluginId: string }) => operations.current.get(input.pluginId) ?? null,
      platform: 'win32',
      capabilityCatalog: async () => catalog,
      capabilityMutate: async (input: CapabilityMutation) => {
        if (input.action !== 'plugin-toggle') throw new Error('此网页不修改插件安装。');
        const plugin = plugins.find(plugin => plugin.id === input.id);
        if (plugin) {
          for (const server of catalog.mcp.filter(server => server.pluginId === plugin.id)) server.enabled = input.enabled;
          setEnabled(current => ({ ...current, [plugin.mcpServers[0]]: input.enabled }));
        }
        return { warnings: [] };
      },
      summary: async () => ({ mcp: plugins.map((plugin, index) => ({
        name: plugin.mcpServers[0], status: index > 0 || mode === 'ready' ? 'connected'
          : mode === 'connecting' ? 'connecting' : 'failed', toolCount: index > 0 ? 8 : 0,
      })) }),
      saveMcp: async (name: string, value: { enabled?: boolean }) => {
        setEnabled(current => ({ ...current, [name]: value.enabled !== false }));
      },
      pluginRepositoryInfo: async () => ({ status: 'unknown' }),
      stepPageState: async () => ({ status: 'ready', version: '1.0.0' }),
      prepareStepPage: async () => ({ status: 'ready', version: '1.0.0' }),
    } as unknown as PluginCenterBridge;
  }, [mode, enabled, occupancy, removed, updated, reloadFailure, reloadProtection]);
  const settings = { mcp: Object.fromEntries(plugins.map(plugin => [
    plugin.mcpServers[0], { enabled: enabled[plugin.mcpServers[0]] !== false, command: 'web-preview' },
  ])) };
  const navigate = (next: View) => {
    setView(next);
    if (innerWidth < 760) setSidebar(false);
  };
  return <div className="web-preview">
    <AppTooltip/>
    <header className="web-preview-toolbar">
      <button className="icon-button" aria-label="切换侧栏" data-tooltip="切换侧栏"
        aria-expanded={sidebar} onClick={() => setSidebar(value => !value)}><PanelLeft size={16}/></button>
      <span className="web-preview-label">{lifecycle ? '插件操作 · 交互预览' : '网页预览'}</span>
      <div className="web-preview-controls">
        <label>{lifecycle ? '目标插件' : '会话占用'}<select aria-label={lifecycle ? '目标插件占用' : '会话占用'} value={occupancy}
          onChange={event => setOccupancy(event.target.value as typeof occupancy)}>
          <option value="idle">空闲</option><option value="busy">{lifecycle ? '正在被调用' : '任务运行中'}</option><option value="unknown">状态未知</option>
        </select></label>
        <button className="icon-button" aria-label="重置预览" data-tooltip="重置预览"
          onClick={() => { setRemoved([]); setUpdated([]); setPreviewRevision(value => value + 1); previews.current.clear(); operations.current.clear(); reloads.current.clear(); }}>
          <RotateCcw size={16}/></button>
        {lifecycle ? <label>加载结果<select aria-label="加载结果" value={loadFailure ? 'failure' : 'success'}
          onChange={event => setLoadFailure(event.target.value === 'failure')}>
          <option value="success">成功</option><option value="failure">连接失败</option>
        </select></label> : <label>工具状态<select aria-label="工具状态" value={mode}
          onChange={event => changeMode(event.target.value as Mode)}>
          {Object.entries(labels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select></label>}
        <button className="icon-button" aria-label={dark ? '切换浅色' : '切换深色'}
          data-tooltip={dark ? '切换浅色' : '切换深色'} onClick={() => setDark(value => !value)}>
          {dark ? <Sun size={16}/> : <Moon size={16}/>}
        </button>
      </div>
    </header>
    <div className="web-preview-layout">
      {sidebar && <>
        <button className="web-preview-scrim" aria-label="关闭侧栏" onClick={() => setSidebar(false)}/>
        <aside className="web-preview-sidebar">
          <SidebarTaskActions language="zh" selected={view === 'scheduled'} pluginsSelected={view === 'plugins'}
            pluginsAttention={startupNeedsAttention(state)} onPlugins={() => { setMarketTab(undefined); navigate('plugins'); }}
            onNewSession={() => { setDraft(''); navigate('chat'); }} onScheduledTasks={() => navigate('scheduled')}/>
          <div className="web-preview-session-heading">Desktop for Step Code</div>
          <button className={`web-preview-session ${view === 'chat' ? 'is-selected' : ''}`}
            onClick={() => navigate('chat')}><MessageSquare size={14}/><span>插件联调记录</span></button>
          <div className="web-preview-sidebar-bottom"><img src="/StepCode.svg" alt="" width="20" height="20"/>
            <span>Desktop for Step Code</span></div>
        </aside>
      </>}
      <main className="web-preview-main">
        {lifecycle && <div className="web-preview-lifecycle" hidden={view !== 'plugins' || Boolean(marketTab)}>
          <PluginLifecyclePreview key={previewRevision}
          plugins={lifecyclePlugins} visible={view === 'plugins' && !marketTab}
          occupancy={occupancy} failure={loadFailure} failed={mode === 'failed'} connecting={mode === 'connecting'}
          onBack={() => navigate('chat')} onCatalog={setMarketTab} onConfigure={() => setMcpOpen(true)}
          onSession={id => { setSessionName(id === 'preview-research' ? '每周资料整理' : '插件联调记录'); navigate('chat'); }}/>
        </div>}
        {view === 'plugins' ? lifecycle && !marketTab ? null
          : <PluginCenter bridge={bridge} language="zh" busy={false} active
          target={marketTab ? { page: 'plugins', tab: marketTab } : undefined}
          runtimeId="web-preview" settings={settings} startup={state} startupDisabled={false}
          onChanged={async () => {}} onRestart={async () => changeMode('ready')}
          onOpenSession={async id => { setSessionName(id === 'preview-research' ? '每周资料整理' : '插件联调记录'); navigate('chat'); }}
          onOpenRemote={() => { setSessionName('Remote'); navigate('chat'); }}
          onManageMcp={() => setMcpOpen(true)} onBack={() => lifecycle && marketTab ? setMarketTab(undefined) : navigate('chat')}/>
          : view === 'scheduled' ? <section className="web-preview-scheduled"><h2>定时任务</h2><p className="muted">暂无定时任务</p></section>
          : <div className="web-preview-chat">
            <header className="web-preview-chat-heading">{sessionName}</header>
            <div className="web-preview-messages">
              <article className="message user"><div className="message-label">你</div>
                <div className="message-body">整理一下这周的插件联调记录和下一步要核对的事项。</div></article>
              <article className="message assistant"><div className="message-label">Step Code</div>
                <div className="message-body"><h3>本周联调记录</h3>
                  <p>先把插件资源、独立运行时和账户授权分开核对。资源版本一致，不代表外部运行时也已同步更新。</p>
                  <table><thead><tr><th>核对项</th><th>记录</th></tr></thead><tbody>
                    <tr><td>插件资源</td><td>已记录安装来源与版本</td></tr>
                    <tr><td>独立运行时</td><td>待检查协议和依赖</td></tr>
                    <tr><td>模型账户</td><td>尚未进行真实调用</td></tr>
                  </tbody></table><h3>下一步</h3><ol><li>检查本体路径指向的实际版本。</li>
                    <li>对照宿主协议确认适配范围。</li><li>完成隔离环境连接验证。</li></ol></div></article>
              {messages.map((message, index) => <article className="message user" key={index}>
                <div className="message-label">你</div><div className="message-body">{message}</div></article>)}
            </div>
            <form className="web-preview-composer" onSubmit={event => {
              event.preventDefault();
              if (!draft.trim()) return;
              setMessages(current => [...current, draft.trim()]); setDraft('');
            }}>
              <textarea aria-label="消息" placeholder="消息" value={draft} onChange={event => setDraft(event.target.value)}/>
              <div><button className="icon-button" type="button" aria-label="新建消息" data-tooltip="新建消息"
                onClick={() => setDraft('')}><Plus size={16}/></button><span>Step 3.7 Flash</span>
                <button className="send-button" aria-label="发送" disabled={!draft.trim()}><ArrowUp size={16}/></button></div>
            </form>
          </div>}
      </main>
    </div>
    {mcpOpen && <div className="modal-backdrop" onClick={() => setMcpOpen(false)}>
      <section role="dialog" aria-modal="true" aria-label="MCP 设置" className="small-dialog"
        onClick={event => event.stopPropagation()}>
        <header><h2><Settings size={16}/> MCP 设置</h2><button autoFocus className="icon-button" aria-label="关闭设置"
          onClick={() => setMcpOpen(false)}><X size={16}/></button></header>
        {plugins.map(plugin => <label className="web-preview-mcp-row" key={plugin.id}>
          <span>{plugin.name}</span><input type="checkbox" checked={enabled[plugin.mcpServers[0]] !== false}
            onChange={event => setEnabled(current => ({ ...current, [plugin.mcpServers[0]]: event.target.checked }))}/>
        </label>)}
      </section>
    </div>}
  </div>;
}
createRoot(document.getElementById('root')!).render(<Preview/>);
