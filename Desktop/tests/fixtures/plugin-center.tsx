import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import {
  ArrowDownToLine, ArrowLeft, ArrowRight, BarChart3, BookOpen, Check,
  CheckCheck, CircleAlert, Clock3, Eye, EyeOff, FileKey2, FileText, Folder, FolderOpen, Globe,
  HardDrive, Info, LoaderCircle, LockKeyhole, MessageSquare, Mic,
  PanelLeft, Plug, Plus, RefreshCw, RotateCcw, Save, Search, Settings, ShieldCheck,
  SlidersHorizontal, SunMoon, Trash2, Video, X,
} from 'lucide-react';
import { AppTooltip } from '../../src/AppTooltip';
import { ScrollThumb } from '../../src/ConversationScrollThumb';
import { DisclosureChevron } from '../../src/DisclosureChevron';
import { ScheduledTaskSelect, ScheduledTasks, SidebarTaskActions, type ScheduledTaskView } from '../../src/ScheduledTasks';
import { StepPlatformIcon } from '../../src/ProviderBrand';
import { UsageOverviewView } from '../../src/UsageOverviewView';
import { emptyUsageOverview } from '../../src/usage-overview';
import { useAnimatedDisclosure } from '../../src/useAnimatedDisclosure';
import { applyTheme, themes, type ThemeId } from '../../src/theme';
import '../../src/style.css';
import '../../src/layout.css';
import '../../src/theme.css';
import '../../src/capability-settings.css';
import '../../src/plugin-center.css';

type MainView = 'plugins' | 'usage' | 'scheduled' | 'chat';
type CatalogTab = 'installed' | 'discover' | 'sources';
type DetailTab = 'config' | 'capabilities' | 'about';
type PluginId = 'bvr' | 'playwright' | 'steppage';
type Config = {
  mode: 'dfsc' | 'independent'; runtime: string; apiBase: string; apiKey: string; model: string;
  asrApiBase: string; asrApiKey: string; asrModel: string;
  cookie: string; proxy: string; download: string; subtitles: boolean;
};
type Plugin = {
  id: PluginId; name: string; subtitle: string; description: string;
  source: string; version: string; server: string; capabilities: string[]; repository?: string;
};
const plugins: Plugin[] = [
  { id: 'bvr', name: 'Bilibili Video Research', subtitle: 'B 站视频研究', source: 'DFSC 社区', version: '0.1.0', server: 'bvr',
    repository: 'https://github.com/7oMB2006/Bilibili-Video-Research',
    description: '结合字幕、语音与视频画面，整理带时间定位的研究证据。',
    capabilities: ['视频信息', '字幕与语音', '画面理解', '证据整理'] },
  { id: 'playwright', name: 'Playwright', subtitle: '浏览器自动化', source: '阶跃官方', version: '1.0.0', server: 'playwright',
    repository: 'https://github.com/microsoft/playwright-mcp',
    description: '打开网页、操作页面与验证浏览器交互。',
    capabilities: ['页面浏览', '交互操作', '页面截图'] },
  { id: 'steppage', name: 'StepPage', subtitle: '网页发布', source: '阶跃官方', version: '1.0.0', server: 'steppage',
    description: '将项目中的网页发布到 StepPage。',
    capabilities: ['网页发布', '发布记录'] },
];
const initialConfig: Config = {
  mode: 'dfsc', runtime: 'D:\\Tools\\Bilibili-Video-Research',
  apiBase: 'https://api.stepfun.com/v1', apiKey: '', model: 'step-3.7-flash',
  asrApiBase: 'https://api.stepfun.com/v1', asrApiKey: '', asrModel: 'stepaudio-2.5-asr',
  cookie: '', proxy: '', download: 'D:\\BVR\\downloads', subtitles: true,
};
const sampleJobs: ScheduledTaskView[] = [
  { id: 'review', title: '整理项目待办', prompt: '检查近期合并记录，列出未完成事项。不修改文件。',
    workspace: 'Desktop for Step Code', schedule: '每天 09:00', next: '明天 09:00',
    recurring: true, durable: true, host: 'online', hostName: '插件适配' },
];
const usage = emptyUsageOverview();
usage.scannedAt = Date.now();
usage.chats = { all: 24, official: 24, custom: 0 };
usage.days = usage.days.map((day, index) => ({
  ...day, official: index > 330 && index % 4 !== 0 ? 12500 + (index * 3179) % 73000 : 0,
  chats: index > 330 ? 2 : 0, officialChats: index > 330 ? 2 : 0,
}));
const params = new URLSearchParams(location.search);
const startingTheme = themes.some(theme => theme.id === params.get('theme')) ? params.get('theme') as ThemeId : 'light';
applyTheme(startingTheme, false);
const bvrIcon = new URL('./plugin-center-assets/bvr.png', import.meta.url).href;

function PluginIcon({ id, size = 32 }: { id: PluginId; size?: number }) {
  return <span className={`pc-plugin-icon pc-icon-${id}`} style={{ width: size, height: size }}>
    {id === 'bvr' ? <img src={bvrIcon} alt="" width={size} height={size}/> : <StepPlatformIcon size={Math.round(size * .7)}/>}
  </span>;
}
function ProjectLink({ plugin }: { plugin: Plugin }) {
  if (!plugin.repository) return null;
  return <a className="icon-button pc-project-link" href={plugin.repository} target="_blank" rel="noopener noreferrer"
    aria-label={`打开 ${plugin.name} GitHub 项目（新标签页）`}><span className="pc-github-mark" aria-hidden="true"/></a>;
}
function ToolButton({ label, children, onClick, disabled = false }: {
  label: string; children: ReactNode; onClick: () => void; disabled?: boolean;
}) {
  return <button type="button" className="icon-button" aria-label={label} data-tooltip={label} onClick={onClick} disabled={disabled}>{children}</button>;
}
function Disclosure({ title, children, extra }: { title: string; children: ReactNode; extra?: string }) {
  const [expanded, setExpanded] = useState(false);
  const disclosure = useAnimatedDisclosure(expanded);
  return <details ref={disclosure.details} className="cap-disclosure pc-disclosure" data-expanded={expanded}>
    <summary onClick={event => { event.preventDefault(); setExpanded(value => !value); }}>
      <span>{title}</span><span className="cap-chevron"><DisclosureChevron/></span>
      {extra && <small>{extra}</small>}
    </summary>
    <div ref={disclosure.body} inert={!expanded}><div className="pc-disclosure-content">{children}</div></div>
  </details>;
}
function Status({ kind, children }: { kind: 'ready' | 'pending' | 'neutral'; children: ReactNode }) {
  return <span className={`pc-status is-${kind}`}><i/>{children}</span>;
}
function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return <div className="pc-field"><label>{label}{children}</label>{hint && <p className="pc-hint">{hint}</p>}</div>;
}
function Preview() {
  const [view, setView] = useState<MainView>('plugins');
  const [sidebar, setSidebar] = useState(() => matchMedia('(min-width: 1001px)').matches);
  const [theme, setTheme] = useState<ThemeId>(startingTheme);
  const [catalogTab, setCatalogTab] = useState<CatalogTab>('installed');
  const [detailTab, setDetailTab] = useState<DetailTab>('config');
  const [selected, setSelected] = useState<PluginId>('bvr');
  const [detailOpen, setDetailOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [sessionQuery, setSessionQuery] = useState('');
  const [installed, setInstalled] = useState<PluginId[]>(['bvr', 'playwright', 'steppage']);
  const [draft, setDraft] = useState<Config>(initialConfig);
  const [saved, setSaved] = useState<Config>(initialConfig);
  const [showApiKey, setShowApiKey] = useState(false);
  const [showAsrApiKey, setShowAsrApiKey] = useState(false);
  const [needsReload, setNeedsReload] = useState(false);
  const [checking, setChecking] = useState(false);
  const [check, setCheck] = useState<'none' | 'passed' | 'failed'>('none');
  const [checkFailure, setCheckFailure] = useState('');
  const [reloading, setReloading] = useState(false);
  const [connected, setConnected] = useState(false);
  const [enabled, setEnabled] = useState(true);
  const [notice, setNotice] = useState('');
  const [picker, setPicker] = useState<'runtime' | 'cookie' | 'download'>();
  const [dialog, setDialog] = useState<'leave' | 'remove' | 'authorize'>();
  const [authorized, setAuthorized] = useState(false);
  const [sourceAdding, setSourceAdding] = useState(false);
  const [sourceValue, setSourceValue] = useState('');
  const [sources, setSources] = useState(['https://github.com/7oMB2006/dfsc-community-plugins']);
  const [message, setMessage] = useState('帮我研究这个 B 站视频，先看字幕，再核对关键画面。');
  const [jobs, setJobs] = useState(sampleJobs);
  const [pluginEnabled, setPluginEnabled] = useState({ playwright: true, steppage: true });
  const [pageProject, setPageProject] = useState('DFSC');
  const [pageSaved, setPageSaved] = useState('DFSC');
  const actionAfterLeave = useRef<(() => void) | undefined>(undefined);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const pendingTimer = useRef<number | undefined>(undefined);
  const sourceInput = useRef<HTMLInputElement>(null);
  const detailHeading = useRef<HTMLHeadingElement>(null);
  const detailScroll = useRef<HTMLDivElement>(null);
  const listTrigger = useRef<HTMLButtonElement | null>(null);
  const wasDetailOpen = useRef(false);
  const tabId = useId();
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
  const otherDirty = pageProject !== pageSaved;
  const plugin = plugins.find(item => item.id === selected)!;
  const pageEnabled = selected === 'bvr' ? enabled : pluginEnabled[selected];
  const bvrReady = connected && enabled && !needsReload;
  const isInstalled = installed.includes(selected);
  const dialogOpen = Boolean(dialog || picker);
  const counts = installed.length;
  const isBusy = checking || reloading;
  useEffect(() => {
    if (!notice) return;
    const timeout = window.setTimeout(() => setNotice(''), 4500);
    return () => clearTimeout(timeout);
  }, [notice]);
  useEffect(() => {
    if (dialogOpen) {
      returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      dialogRef.current?.showModal();
    } else if (dialogRef.current?.open) {
      dialogRef.current.close();
      returnFocus.current?.focus({ preventScroll: true });
    }
  }, [dialogOpen]);
  useEffect(() => () => window.clearTimeout(pendingTimer.current), []);
  useEffect(() => { if (sourceAdding) sourceInput.current?.focus(); }, [sourceAdding]);
  useEffect(() => {
    if (view !== 'plugins') return;
    if (detailOpen) detailHeading.current?.focus({ preventScroll: true });
    else if (wasDetailOpen.current) listTrigger.current?.focus({ preventScroll: true });
    wasDetailOpen.current = detailOpen;
  }, [view, detailOpen, selected]);
  useEffect(() => { setShowApiKey(false); setShowAsrApiKey(false); }, [view, detailOpen, draft.mode]);
  useEffect(() => {
    if (!sidebar || dialogOpen) return;
    const dismiss = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && matchMedia('(max-width: 1000px)').matches) setSidebar(false);
    };
    window.addEventListener('keydown', dismiss);
    return () => window.removeEventListener('keydown', dismiss);
  }, [sidebar, dialogOpen]);
  const announce = (value: string) => setNotice(value);
  const cancelDialog = () => { setDialog(undefined); setPicker(undefined); actionAfterLeave.current = undefined; };
  const navigate = (action: () => void) => {
    if (isBusy) return;
    if (dirty || otherDirty) { actionAfterLeave.current = action; setDialog('leave'); }
    else action();
  };
  const navigateView = (next: MainView) => navigate(() => {
    setView(next);
    if (next === 'plugins') setDetailOpen(false);
    if (matchMedia('(max-width: 1000px)').matches) setSidebar(false);
  });
  const choosePlugin = (id: PluginId, trigger: HTMLButtonElement) => {
    listTrigger.current = trigger;
    navigate(() => { setSelected(id); setDetailTab('config'); setDetailOpen(true); });
  };
  const togglePlugin = (id: PluginId) => {
    if (id === 'bvr') {
      setEnabled(value => !value);
      setAuthorized(false);
    } else setPluginEnabled(value => ({ ...value, [id]: !value[id] }));
  };
  const update = <K extends keyof Config>(key: K, value: Config[K]) => {
    setDraft(current => ({ ...current, [key]: value })); setCheck('none'); setCheckFailure('');
  };
  const validate = () => {
    if (!/^[A-Za-z]:[\\/].+/.test(draft.runtime.trim())) return '请输入 BVR 运行目录的 Windows 绝对路径。';
    if (draft.mode === 'independent') {
      for (const connection of [
        { label: '主力模型', endpoint: draft.apiBase, key: draft.apiKey, model: draft.model, modelLabel: '视频理解模型' },
        { label: 'ASR', endpoint: draft.asrApiBase, key: draft.asrApiKey, model: draft.asrModel, modelLabel: '语音识别模型' },
      ]) {
        const addressError = `请输入有效的 ${connection.label} 接口地址，例如 https://api.stepfun.com/v1。`;
        try {
          const url = new URL(connection.endpoint.trim());
          if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash)
            return addressError;
        } catch { return addressError; }
        if (!connection.key.trim()) return `请输入 ${connection.label} 的 API Key。`;
        if (!connection.model.trim()) return `请输入${connection.modelLabel}名称。`;
      }
    }
    if (draft.proxy && !/^https?:\/\/[^/\s]+\/?$/.test(draft.proxy)) return '代理地址须使用 http:// 或 https://，例如 http://127.0.0.1:7897。';
    return '';
  };
  const checkEnvironment = () => {
    const failure = validate();
    setCheckFailure(failure);
    if (failure) { setCheck('failed'); return; }
    setChecking(true); setCheck('none');
    pendingTimer.current = window.setTimeout(() => { setChecking(false); setCheck('passed'); }, 850);
  };
  const save = () => {
    const failure = validate();
    if (failure) { setCheckFailure(failure); setCheck('failed'); return; }
    setSaved({ ...draft }); setNeedsReload(true); setConnected(false); setAuthorized(false);
    setShowApiKey(false); setShowAsrApiKey(false);
    announce('示例配置已保存，重新加载后生效。');
  };
  const reload = () => {
    setReloading(true);
    pendingTimer.current = window.setTimeout(() => {
      setReloading(false); setNeedsReload(false); setConnected(true); setCheck('passed');
      announce('已模拟重新加载。尚未调用模型。');
    }, 900);
  };
  const restore = () => {
    setDraft({ ...saved }); setShowApiKey(false); setShowAsrApiKey(false); setPageProject(pageSaved); setCheck('none'); setCheckFailure('');
  };
  const choosePath = () => {
    if (!picker) return;
    const paths = { runtime: 'D:\\Tools\\Bilibili-Video-Research',
      cookie: 'D:\\BVR\\private\\cookies.txt', download: 'D:\\BVR\\downloads' };
    update(picker, paths[picker]); setPicker(undefined);
  };
  const install = () => {
    setInstalled(current => [...current, selected]);
    setCatalogTab('installed'); setDetailTab('config');
    announce('已添加到示例已安装列表，未安装真实插件。');
  };
  const sourceSubmit = () => {
    if (!/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/?$/.test(sourceValue.trim())) {
      announce('请输入完整的 GitHub 仓库 HTTPS 地址。'); return;
    }
    if (sources.includes(sourceValue.trim())) { announce('该市场来源已在列表中。'); return; }
    setSources(current => [...current, sourceValue.trim()]); setSourceValue(''); setSourceAdding(false);
  };
  const shown = plugins.filter(item => (catalogTab === 'discover' || installed.includes(item.id))
    && `${item.name} ${item.subtitle} ${item.source}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  return <div className={`pc-preview app${sidebar ? ' pc-sidebar-open' : ''}`}>
    <header className="pc-window">
      <ToolButton label="切换侧栏" onClick={() => setSidebar(value => !value)}><PanelLeft size={17}/></ToolButton>
      <span>Desktop for Step Code</span><span className="pc-preview-label">前端预览 · 示例数据</span>
      <div className="pc-theme-select"><SunMoon size={14}/><ScheduledTaskSelect label="预览主题" value={theme}
        options={themes.filter(item => ['light', 'dark', 'wine', 'original-light'].includes(item.id)).map(item => ({ id: item.id, label: item.title[0] }))}
        onChange={id => { setTheme(id as ThemeId); applyTheme(id, false); }}/></div>
    </header>
    {sidebar && <button className="pc-sidebar-shade" aria-label="关闭侧栏" onClick={() => setSidebar(false)}/>}
    <aside className="sidebar">
      <button className={`sidebar-identity usage-entry${view === 'usage' ? ' is-active' : ''}`} data-tooltip="用量统计" onClick={() => navigateView('usage')} aria-label="用量统计">
        <img src="/StepCode.svg" width="26" height="26" alt=""/>
        <span className="sidebar-wordmark"><img className="wordmark-light" src="/wordmark-light.png" alt="Desktop for Step Code"/><img className="wordmark-dark" src="/wordmark-dark.png" alt="Desktop for Step Code"/></span>
        <BarChart3 size={15}/>
      </button>
      <SidebarTaskActions selected={view === 'scheduled'} onNewSession={() => navigateView('chat')}
        onScheduledTasks={() => navigateView(view === 'scheduled' ? 'chat' : 'scheduled')}
        onPlugins={() => navigateView('plugins')} onSearchChange={setSessionQuery}/>
      <nav className="workspace-tree" aria-label="会话">
        <div className="workspace-heading"><span className="pc-sidebar-section"><MessageSquare size={15}/>独立会话<small>1</small></span></div>
        {!sessionQuery || '看看这个视频'.includes(sessionQuery) ? <div className={`session-row${view === 'chat' ? ' selected' : ''}`}><button onClick={() => navigateView('chat')}><span>看看这个视频</span></button></div> : <p className="pc-hint">没有匹配的会话</p>}
        <div className="section-label">置顶</div>
        <div className="workspace-heading"><span className="pc-sidebar-section"><Folder size={15}/>Desktop for Step Code</span></div>
        {['插件适配', '下一版开发计划'].filter(title => title.includes(sessionQuery)).map(title =>
          <div className="session-row" key={title}><button onClick={() => navigateView('chat')}><span>{title}</span></button></div>)}
      </nav>
      <div className="sidebar-bottom"><span className="pc-sidebar-section"><Settings size={16}/>设置<small>v0.6.0</small></span>
        <div className="connection"><i className="online"/>Step Code 已连接</div></div>
    </aside>
    <main className="pc-main">
      {view === 'plugins' && <section className="pc-center" aria-label="插件中心" data-level={detailOpen ? 'detail' : 'catalog'}>
        <div className="pc-catalog-page" hidden={detailOpen}>
        <header className="pc-page-header"><div><Plug size={23}/><h1>插件</h1><span className="pc-count">{counts}</span></div>
          <ToolButton label="刷新插件目录" onClick={() => announce('已刷新示例插件目录。')}><RefreshCw size={16}/></ToolButton>
        </header>
        <div className="pc-catalog-toolbar">
          <div className="cap-tabs pc-catalog-tabs" role="tablist" aria-label="插件目录">
            {([['installed', '已安装', counts], ['discover', '发现', ''], ['sources', '市场来源', '']] as const).map(([id, label, count]) =>
              <button id={`${tabId}-${id}`} key={id} role="tab" aria-selected={catalogTab === id} aria-controls={`${tabId}-catalog`}
                onClick={() => navigate(() => setCatalogTab(id))}>{label}{count !== '' && <span>{count}</span>}</button>)}
          </div>
          {catalogTab !== 'sources' && <div className="pc-search"><Search size={15}/><input value={query} onChange={event => setQuery(event.target.value)}
            aria-label="搜索插件" placeholder="搜索插件"/>{query && <ToolButton label="清空搜索" onClick={() => setQuery('')}><X size={13}/></ToolButton>}</div>}
        </div>
        <div id={`${tabId}-catalog`} role="tabpanel" aria-labelledby={`${tabId}-${catalogTab}`} className="pc-catalog-body">
          {catalogTab === 'sources' ? <div className="pc-sources pc-entrance">
            <div className="pc-section-title"><h2>市场来源</h2><button onClick={() => setSourceAdding(value => !value)}><Plus size={14}/>添加来源</button></div>
            {sourceAdding && <form className="pc-source-form" onSubmit={event => { event.preventDefault(); sourceSubmit(); }}>
              <label>GitHub 仓库地址<input ref={sourceInput} value={sourceValue} onChange={event => setSourceValue(event.target.value)} placeholder="https://github.com/owner/marketplace"/></label>
              <button className="primary" type="submit"><Plus size={14}/>添加</button><ToolButton label="取消添加" onClick={() => setSourceAdding(false)}><X size={16}/></ToolButton>
            </form>}
            <div className="pc-source-row"><StepPlatformIcon size={24}/><div><strong>阶跃官方</strong><small>内置来源</small></div><Status kind="ready">已启用</Status><LockKeyhole size={14}/></div>
            {sources.map((source, index) => <div className="pc-source-row" key={source}><Globe size={23}/><div><strong>{index === 0 ? 'DFSC 社区' : source.split('/').at(-1)}</strong><small>{source}</small></div>
              <Status kind="ready">已启用</Status><ToolButton label="移除市场来源" onClick={() => setSources(current => current.filter(item => item !== source))}><Trash2 size={15}/></ToolButton></div>)}
          </div> : <nav className="pc-plugin-list" aria-label={catalogTab === 'installed' ? '已安装插件' : '可发现插件'}>
              <div className="pc-list-heading">{catalogTab === 'installed' ? '全部插件' : '全部来源'}<span>{shown.length} 个插件</span></div>
              <div className="pc-plugin-grid">
              {shown.map(item => {
                const installedItem = installed.includes(item.id);
                const active = item.id === 'bvr' ? enabled : pluginEnabled[item.id];
                const label = !installedItem ? '未安装' : !active ? '已停用' : item.id === 'bvr' ? needsReload ? '待重新加载' : connected ? '已连接' : '待检查' : '已连接';
                return <article className="pc-plugin-row" key={item.id} aria-label={item.name}>
                  <button className="pc-card-open" aria-label={`查看 ${item.name}`} onClick={event => choosePlugin(item.id, event.currentTarget)}>
                  <span className="pc-card-heading"><PluginIcon id={item.id} size={40}/><span><strong>{item.name}</strong><span>{item.subtitle}</span></span></span>
                  <span className="pc-card-description">{item.description}</span>
                  <span className="pc-card-meta"><span>{item.source}</span><span>v{item.version}</span></span>
                  </button>
                  <div className="pc-card-footer"><div className="pc-card-state">
                    {installedItem && <button type="button" className={`cap-switch${active ? ' on' : ''}`} role="switch"
                      aria-label={`启用 ${item.name}`} aria-checked={active}
                      disabled={item.id === 'bvr' && isBusy} onClick={() => togglePlugin(item.id)}><span/></button>}
                    <Status kind={installedItem && active && (item.id !== 'bvr' || bvrReady) ? 'ready' : 'neutral'}>{label}</Status>
                  </div>
                    <div className="pc-card-actions"><ProjectLink plugin={item}/>
                    <button className={installedItem ? 'icon-button pc-card-settings' : 'pc-card-action'}
                      aria-label={`${installedItem ? '配置' : '查看'} ${item.name}`} onClick={event => choosePlugin(item.id, event.currentTarget)}>
                      {installedItem ? <Settings size={16}/> : <><ArrowDownToLine size={14}/>查看插件<ArrowRight size={13}/></>}</button></div></div>
                </article>;
              })}
              </div>
              {!shown.length && <div className="pc-list-empty"><Search size={22}/><p>没有匹配的插件</p><button onClick={() => setQuery('')}>清空搜索</button></div>}
              <div className="pc-list-footer"><ShieldCheck size={13}/><span>{catalogTab === 'installed' ? '插件配置由本机独立保存' : '社区插件由各自作者维护'}</span></div>
            </nav>}
        </div>
        </div>
            <section className="pc-detail" hidden={!detailOpen} aria-label={`${plugin.name} 详情`}>
              <div className="pc-detail-navigation"><button onClick={() => navigate(() => setDetailOpen(false))}><ArrowLeft size={15}/>插件列表</button>
                <span>/</span><span>{plugin.subtitle}</span></div>
              <div className="pc-detail-workspace">
              <div className="pc-detail-scroll" ref={detailScroll} id={`${tabId}-detail-scroll`}>
              <div className="pc-detail-document">
              <header className="pc-plugin-header">
                <div className="pc-plugin-identity">
                <PluginIcon id={selected} size={48}/>
                <div className="pc-plugin-title"><h2 ref={detailHeading} tabIndex={-1}>{plugin.name}</h2><p>{plugin.subtitle}<span>v{plugin.version}</span><span>{plugin.source}</span></p></div>
                </div>
              <div className="pc-plugin-summary">
                <p>{plugin.description}</p>
                <div>{selected === 'bvr' ? <><Status kind={!isInstalled || !enabled ? 'neutral' : needsReload ? 'pending' : connected ? 'ready' : 'neutral'}>
                  {!isInstalled ? '未安装' : !enabled ? '已停用' : needsReload ? '待重新加载' : connected ? 'MCP 已连接' : '环境未检查'}</Status>
                  <span className="pc-auth-state"><LockKeyhole size={12}/>{authorized ? '本次示例调用已授权' : '首次调用需要授权'}</span></> :
                  <Status kind={isInstalled && pageEnabled ? 'ready' : 'neutral'}>{!isInstalled ? '未安装' : pageEnabled ? 'MCP 已连接' : '已停用'}</Status>}</div>
              </div>
                <div className="pc-header-actions"><ProjectLink plugin={plugin}/>{isInstalled ? <>
                  <button className={`cap-switch${(selected === 'bvr' ? enabled : pageEnabled) ? ' on' : ''}`} role="switch" aria-label="启用插件"
                    aria-checked={selected === 'bvr' ? enabled : pageEnabled} disabled={isBusy}
                    onClick={() => togglePlugin(selected)}><span/></button>
                  <ToolButton label="卸载插件" disabled={isBusy} onClick={() => navigate(() => setDialog('remove'))}><Trash2 size={16}/></ToolButton>
                </> : <button className="primary" onClick={install}><ArrowDownToLine size={15}/>安装</button>}</div>
              </header>
              <div className="cap-tabs pc-detail-tabs" role="tablist" aria-label="插件详情">
                {([['config', SlidersHorizontal, '配置'], ['capabilities', Plug, '能力'], ['about', FileText, '说明']] as const).map(([id, Icon, title]) =>
                  <button key={id} id={`${tabId}-detail-${id}`} role="tab" aria-selected={detailTab === id} aria-controls={`${tabId}-detail-content`}
                    onClick={() => setDetailTab(id)}><Icon size={14}/>{title}</button>)}
              </div>
              <div className="pc-detail-content" id={`${tabId}-detail-content`} role="tabpanel" aria-labelledby={`${tabId}-detail-${detailTab}`}>
                <div className="pc-detail-inner pc-entrance" key={`${selected}-${detailTab}`}>
                  {detailTab === 'config' && (selected === 'bvr' ? <>
                    <section className="pc-form-section">
                      <div className="pc-section-title"><h3>模型来源</h3><span className="pc-section-meta">仅影响 BVR</span></div>
                      <div className="pc-mode" role="group" aria-label="模型来源">
                        <button aria-pressed={draft.mode === 'dfsc'} onClick={() => update('mode', 'dfsc')}><StepPlatformIcon size={17}/>跟随 DFSC 会话{draft.mode === 'dfsc' && <Check size={14}/>}</button>
                        <button aria-pressed={draft.mode === 'independent'} onClick={() => update('mode', 'independent')}><FileKey2 size={17}/>独立配置{draft.mode === 'independent' && <Check size={14}/>}</button>
                      </div>
                      {draft.mode === 'dfsc' ? <div className="pc-follow pc-entrance" key="dfsc">
                        <div className="pc-follow-heading"><span><MessageSquare size={13}/>当前会话示例</span><small>看看这个视频</small></div>
                        <dl className="pc-account-grid"><div><dt>账户与计费</dt><dd><span className="pc-plan-mark">Plan</span>Step Plan</dd></div>
                          <div><dt>地区</dt><dd>中国大陆</dd></div><div><dt>视觉模型</dt><dd>step-3.5-flash</dd></div><div><dt>语音识别</dt><dd>stepaudio-2.5-asr</dd></div></dl>
                        <p className="pc-semantic-note"><Info size={13}/><span>以实际调用 BVR 的会话为准。Plan 请求失败不会回退到直调 API。</span></p>
                      </div> : <div className="pc-independent pc-entrance" key="independent">
                        <div className="pc-api-services">
                        <fieldset className="pc-api-service">
                        <legend><Video size={15}/>主力模型</legend>
                        <p className="pc-service-purpose">视频画面分析与内容整理</p>
                        <div className="pc-api-fields">
                        <Field label="接口地址">
                          <input type="url" value={draft.apiBase} onChange={event => update('apiBase', event.target.value)}
                            spellCheck={false} autoCapitalize="none" placeholder="https://api.stepfun.com/v1"/>
                        </Field>
                        <Field label="API Key">
                          <span className="pc-secret"><input type={showApiKey ? 'text' : 'password'} value={draft.apiKey}
                            onChange={event => update('apiKey', event.target.value)} placeholder="输入 API Key"
                            autoComplete="off" spellCheck={false} autoCapitalize="none"/>
                            <button type="button" className="icon-button" aria-label={showApiKey ? '隐藏 API Key' : '显示 API Key'}
                              aria-pressed={showApiKey} onClick={() => setShowApiKey(value => !value)}>
                              {showApiKey ? <EyeOff size={16}/> : <Eye size={16}/>}
                            </button>
                          </span>
                        </Field>
                        <Field label="视频理解模型" hint="分析视频画面，填写支持视频输入的模型。">
                          <input value={draft.model} onChange={event => update('model', event.target.value)}
                            spellCheck={false} autoCapitalize="none" placeholder="step-3.7-flash"/>
                        </Field>
                        </div>
                        </fieldset>
                        <fieldset className="pc-api-service">
                        <legend><Mic size={15}/>语音识别（ASR）</legend>
                        <p className="pc-service-purpose">没有可用字幕时，将音频转为文字</p>
                        <div className="pc-api-fields">
                        <Field label="ASR 接口地址">
                          <input type="url" value={draft.asrApiBase} onChange={event => update('asrApiBase', event.target.value)}
                            spellCheck={false} autoCapitalize="none" placeholder="https://api.stepfun.com/v1"/>
                        </Field>
                        <Field label="ASR API Key">
                          <span className="pc-secret"><input type={showAsrApiKey ? 'text' : 'password'} value={draft.asrApiKey}
                            onChange={event => update('asrApiKey', event.target.value)} placeholder="输入 ASR 的 API Key"
                            autoComplete="off" spellCheck={false} autoCapitalize="none"/>
                            <button type="button" className="icon-button" aria-label={showAsrApiKey ? '隐藏 ASR API Key' : '显示 ASR API Key'}
                              aria-pressed={showAsrApiKey} onClick={() => setShowAsrApiKey(value => !value)}>
                              {showAsrApiKey ? <EyeOff size={16}/> : <Eye size={16}/>}
                            </button>
                          </span>
                        </Field>
                        <Field label="语音识别模型" hint="填写语音识别服务提供的模型名称。">
                          <input value={draft.asrModel} onChange={event => update('asrModel', event.target.value)}
                            spellCheck={false} autoCapitalize="none" placeholder="stepaudio-2.5-asr"/>
                        </Field>
                        </div>
                        </fieldset>
                        </div>
                        <p className="pc-semantic-note"><FileKey2 size={13}/><span>两组接口、Key 和模型独立设置，分别使用各自账户计费；不使用 DFSC 的 Step Plan 套餐额度。</span></p>
                        {check === 'failed' && <p className="pc-check-error" role="alert"><CircleAlert size={15}/>{checkFailure}</p>}
                      </div>}
                      <div className="pc-permission-row"><ShieldCheck size={17}/><div><strong>调用前确认</strong><p>按调用会话、账户与模型确认，切换后重新询问。</p></div><LockKeyhole size={14}/></div>
                    </section>
                    <section className="pc-form-section">
                      <div className="pc-section-title"><h3>本机运行环境</h3><span className="pc-section-meta">Node.js 24+</span></div>
                      <Field label="BVR 运行目录" hint="使用已安装依赖的 BVR 项目目录，不是插件安装目录。">
                        <span className="pc-path"><input value={draft.runtime} onChange={event => update('runtime', event.target.value)} aria-invalid={check === 'failed' && !draft.runtime}
                          placeholder="D:\Tools\Bilibili-Video-Research"/>
                          <ToolButton label="选择 BVR 运行目录" onClick={() => setPicker('runtime')}><FolderOpen size={16}/></ToolButton></span>
                      </Field>
                      <div className="pc-check-row"><button onClick={checkEnvironment} disabled={isBusy}>
                        {checking ? <LoaderCircle size={14} className="pc-spin"/> : <CheckCheck size={14}/>}检查环境
                      </button><span className="pc-hint">仅环境检查，不调用模型</span></div>
                      {check === 'failed' && draft.mode !== 'independent' && <p className="pc-check-error" role="alert"><CircleAlert size={15}/>{checkFailure}</p>}
                      {check === 'passed' && <div className="pc-check-results pc-entrance" role="status"><span><Check size={13}/>Node.js 24</span><span><Check size={13}/>运行目录与依赖</span>
                        <span><Check size={13}/>{draft.mode === 'dfsc' ? 'DFSC 桥接可用' : 'API 配置格式'}</span><small>{draft.mode === 'dfsc' ? '示例检查结果' : '示例检查结果，不验证 Key 有效性'}</small></div>}
                    </section>
                    <Disclosure title="下载与高级设置" extra="可选">
                      <Field label="下载目录"><span className="pc-path"><input value={draft.download} onChange={event => update('download', event.target.value)}/>
                        <ToolButton label="选择下载目录" onClick={() => setPicker('download')}><FolderOpen size={16}/></ToolButton></span></Field>
                      <Field label="Bilibili Cookie 文件" hint="可选。需要登录的视频可使用本机 Cookie 文件。">
                        <span className="pc-path"><input value={draft.cookie} onChange={event => update('cookie', event.target.value)} placeholder="未设置"/>
                          <ToolButton label="选择 Cookie 文件" onClick={() => setPicker('cookie')}><FolderOpen size={16}/></ToolButton></span>
                      </Field>
                      <Field label="HTTP 代理"><input value={draft.proxy} onChange={event => update('proxy', event.target.value)} placeholder="http://127.0.0.1:7897"/></Field>
                      <label className="pc-checkbox"><input type="checkbox" checked={draft.subtitles} onChange={event => update('subtitles', event.target.checked)}/>优先使用已有字幕</label>
                    </Disclosure>
                  </> : selected === 'playwright' ? <section className="pc-form-section">
                    <div className="pc-section-title"><h3>浏览器连接</h3><Status kind="ready">无需额外配置</Status></div>
                    <dl className="pc-info-list"><div><dt>MCP 服务</dt><dd>playwright</dd></div><div><dt>传输方式</dt><dd>stdio</dd></div>
                      <div><dt>工具审批</dt><dd>遵循调用会话的权限模式</dd></div></dl>
                  </section> : <section className="pc-form-section">
                    <h3>发布设置</h3><Field label="项目名称"><input value={pageProject} onChange={event => setPageProject(event.target.value)}/></Field>
                    <dl className="pc-info-list"><div><dt>账户状态</dt><dd>发布前需要登录</dd></div><div><dt>默认可见性</dt><dd>私有</dd></div></dl>
                  </section>)}
                  {detailTab === 'capabilities' && <>
                    <section className="pc-form-section"><div className="pc-section-title"><h3>MCP 服务</h3><span className="pc-section-meta">1 个</span></div>
                      <div className="pc-capability-row"><Plug size={19}/><div><strong>{plugin.server}</strong><p>stdio · {plugin.capabilities.join(' / ')}</p></div>
                        <Status kind={selected === 'bvr' ? bvrReady ? 'ready' : 'neutral' : pageEnabled ? 'ready' : 'neutral'}>
                          {selected === 'bvr' ? bvrReady ? '已连接' : !enabled ? '已停用' : needsReload ? '待重新加载' : '待连接' : pageEnabled ? '已连接' : '已停用'}</Status></div>
                    </section>
                    <section className="pc-form-section"><h3>包含的能力</h3>{plugin.capabilities.map((capability, index) =>
                      <div className="pc-capability-row" key={capability}>{index === 0 ? <Video size={18}/> : <BookOpen size={18}/>}<div><strong>{capability}</strong></div><Check size={14}/></div>)}</section>
                    {selected === 'bvr' && <div className="pc-semantic-note"><ShieldCheck size={15}/><span>视频模型请求受独立确认约束，环境检查不等于模型调用授权。</span></div>}
                  </>}
                  {detailTab === 'about' && <>
                    <section className="pc-form-section"><h3>{plugin.subtitle}</h3><p className="pc-body-copy">{plugin.description}</p>
                      {selected === 'bvr' && <p className="pc-body-copy">支持以字幕为主、画面为主或综合证据的研究方式。视觉请求沿用调用会话的模型，语音识别使用专用 ASR 模型。</p>}
                      <dl className="pc-info-list"><div><dt>版本</dt><dd>{plugin.version}</dd></div><div><dt>来源</dt><dd>{plugin.source}</dd></div>
                        <div><dt>配置范围</dt><dd>本机 Desktop 配置，不读取个人 Step Code 配置</dd></div></dl>
                    </section>
                    {selected === 'bvr' && <Disclosure title="首次使用"><ol className="pc-guide"><li>指定已安装依赖的 BVR 运行目录。</li>
                      <li>选择模型来源，检查并保存配置。</li><li>重新加载插件，在会话中发起视频研究。</li><li>首次模型请求前，核对账户、模型与计费渠道。</li></ol></Disclosure>}
                  </>}
                </div>
              </div>
              </div>
              </div>
              <ScrollThumb scrollRef={detailScroll} language="zh" sessionId={`${selected}-${detailTab}`}
                messageCount={detailOpen ? 1 : 0} scrollId={`${tabId}-detail-scroll`} label="插件详情滚动"
                className="pc-detail-scroll-track" contentSelector=".pc-detail-document" compact/>
              </div>
              <footer className="pc-detail-footer">
                <div className="pc-save-state" role="status">{(selected === 'bvr' ? dirty : otherDirty) ? <><i/>有未保存的更改</> : needsReload && selected === 'bvr' ? <><Clock3 size={14}/>已保存，待重新加载</> : <><HardDrive size={13}/>本机配置</>}</div>
                <div>{(selected === 'bvr' ? dirty : otherDirty) && <ToolButton label="放弃更改" onClick={restore}><RotateCcw size={15}/></ToolButton>}
                  {selected === 'bvr' ? needsReload && !dirty ? <button className="primary" disabled={isBusy} onClick={reload}>
                    <RefreshCw size={14} className={reloading ? 'pc-spin' : ''}/>{reloading ? '重新加载中' : '重新加载'}</button> :
                    <button className="primary" disabled={!dirty || isBusy || !isInstalled} onClick={save}><Save size={14}/>保存配置</button> :
                    selected === 'steppage' ? <button className="primary" disabled={!otherDirty || !isInstalled} onClick={() => { setPageSaved(pageProject); announce('示例发布设置已保存。'); }}><Save size={14}/>保存配置</button> :
                    <Status kind="ready">无需保存</Status>}
                </div>
              </footer>
            </section>
      </section>}
      {view === 'usage' && <div className="pc-other-view pc-entrance"><div className="pc-view-back"><button onClick={() => navigateView('chat')}><ArrowLeft size={15}/>返回会话</button></div>
        <UsageOverviewView embedded overview={usage} onRefresh={() => announce('已刷新示例用量。')}/></div>}
      {view === 'scheduled' && <ScheduledTasks jobs={jobs} onCreate={() => announce('已预览创建流程，未创建真实定时任务。')}
        onDelete={id => setJobs(current => current.filter(item => item.id !== id))}/>}
      {view === 'chat' && <section className="pc-chat pc-entrance" aria-label="会话预览">
        <header><MessageSquare size={17}/><strong>看看这个视频</strong><span>Step Plan · step-3.5-flash</span></header>
        <div className="pc-chat-content"><div className="pc-chat-message"><p>我们可以先用字幕梳理内容，再核对关键画面。</p>
          <button onClick={() => { setDialog('authorize'); }}><Video size={15}/>预览 BVR 调用确认</button></div></div>
        <div className="pc-draft"><textarea value={message} onChange={event => setMessage(event.target.value)} aria-label="会话草稿"/>
          <div><span>Step 3.5 Flash</span><ToolButton label="返回插件配置" onClick={() => navigateView('plugins')}><Plug size={17}/></ToolButton></div></div>
      </section>}
      {notice && <div className="pc-notice" role="status"><Info size={14}/><span>{notice}</span><ToolButton label="关闭提示" onClick={() => setNotice('')}><X size={13}/></ToolButton></div>}
    </main>
    <dialog ref={dialogRef} className="pc-dialog" aria-labelledby="pc-dialog-title" onCancel={event => { event.preventDefault(); cancelDialog(); }}>
      <header><h2 id="pc-dialog-title">{picker ? '选择示例路径' : dialog === 'leave' ? '有未保存的更改' : dialog === 'remove' ? `卸载 ${plugin.name}？` : '允许 BVR 使用会话模型？'}</h2>
        <ToolButton label="关闭对话框" onClick={cancelDialog}><X size={17}/></ToolButton></header>
      {picker ? <><p>当前为浏览器预览，不会访问本机文件。</p>
        <button className="pc-path-choice" onClick={choosePath}><FolderOpen size={20}/><span>{picker === 'runtime' ? 'D:\\Tools\\Bilibili-Video-Research' : picker === 'cookie' ? 'D:\\BVR\\private\\cookies.txt' : 'D:\\BVR\\downloads'}</span><ArrowRight size={16}/></button>
        <footer><button onClick={cancelDialog}>取消</button></footer></> :
        dialog === 'leave' ? <><p>离开前保存当前插件配置，或放弃这次修改。</p><footer>
          <button autoFocus onClick={cancelDialog}>继续编辑</button><button onClick={() => { restore(); setDialog(undefined); actionAfterLeave.current?.(); actionAfterLeave.current = undefined; }}>放弃并离开</button>
          <button className="primary" onClick={() => {
            if (selected === 'bvr' && dirty) { const failure = validate(); if (failure) { setCheckFailure(failure); setCheck('failed'); cancelDialog(); return; } save(); }
            if (otherDirty) setPageSaved(pageProject);
            setDialog(undefined); actionAfterLeave.current?.(); actionAfterLeave.current = undefined;
          }}><Save size={14}/>保存并离开</button></footer></> :
        dialog === 'remove' ? <><p>将从示例列表中移除此插件，不改动真实安装或配置。</p><footer>
          <button autoFocus onClick={cancelDialog}>取消</button><button className="pc-danger-button" onClick={() => {
            setInstalled(current => current.filter(id => id !== selected)); setCatalogTab('discover'); setDialog(undefined);
            announce('已从示例列表中卸载。');
          }}><Trash2 size={14}/>卸载插件</button></footer></> :
        <><div className="pc-auth-call"><PluginIcon id="bvr" size={36}/><div><strong>Bilibili Video Research</strong><small>视频画面分析 · 示例请求</small></div></div>
          <dl className="pc-info-list"><div><dt>发起会话</dt><dd>看看这个视频</dd></div><div><dt>账户渠道</dt><dd>Step Plan · 中国大陆</dd></div>
            <div><dt>本次模型</dt><dd>step-3.5-flash</dd></div></dl><p className="pc-semantic-note"><ShieldCheck size={15}/><span>本次使用 Plan 额度，不回退到直调 API。仅为确认界面预览，不发起真实请求。</span></p>
          <footer><button autoFocus onClick={cancelDialog}>取消</button><button className="primary" onClick={() => { setAuthorized(true); setDialog(undefined); announce('已模拟授权，未发起模型请求。'); }}><Check size={14}/>允许本次示例</button></footer></>}
    </dialog>
    <AppTooltip/>
  </div>;
}
createRoot(document.getElementById('root')!).render(<Preview/>);
