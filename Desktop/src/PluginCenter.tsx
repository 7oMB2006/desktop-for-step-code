import { useEffect, useId, useRef, useState } from 'react';
import { ArrowDownToLine, ArrowLeft, BookOpen, Check, Globe, LoaderCircle, Plug, Plus, RefreshCw, RotateCcw, Save, Search, Settings, Trash2, X } from 'lucide-react';
import type { McpServer, SessionSummary } from './contracts';
import type { CapabilityCatalog, CapabilityMutation, CapabilityPlugin, MarketplacePlugin, PluginPackage } from './capabilities';
import type { CapabilityTarget, PluginTab } from './capability-command';
import { CapabilityDisclosure, CapabilityPluginIconView, capabilityErrorText, type CapabilityBridge } from './CapabilitySettings';
import { BvrConfigurationForm, type BvrSettingsBridge } from './BvrConfigurationForm';
import { PluginConfigurationForm } from './PluginConfigurationForm';
import { ScrollThumb } from './ConversationScrollThumb';
import { StepPageSettings } from './StepPageSettings';
import { PluginDocumentation, PluginDocumentReader, PluginStars } from './PluginDocumentation';
import './capability-settings.css';
import './plugin-center.css';

export type PluginCenterBridge = CapabilityBridge & BvrSettingsBridge & Pick<import('./contracts').DesktopBridge,
  'pluginDocument' | 'pluginRepositoryInfo' | 'pluginConfiguration' | 'pluginSaveConfiguration' | 'pluginChoosePath'>;
type Entry = { key: string; name: string; description?: string; version?: string; repository?: string;
  icon?: CapabilityPlugin['icon']; source?: string; installed?: CapabilityPlugin; available?: MarketplacePlugin; package?: PluginPackage };
function ProjectLink({ entry, language }: { entry: Entry; language: string }) {
  if (!entry.repository || !/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+$/u.test(entry.repository)) return null;
  return <a className="icon-button pc-project-link" href={entry.repository} target="_blank" rel="noopener noreferrer"
    aria-label={language === 'zh' ? `打开 ${entry.name} GitHub 项目` : `Open ${entry.name} on GitHub`}>
    <span className="pc-github-mark" aria-hidden="true"/></a>;
}
export function PluginCenter({ bridge, language, busy, active, runtimeId, settings, target, onChanged, onRestart, onManageMcp, onBack }: {
  bridge: PluginCenterBridge; language: string; busy: boolean; active: boolean; runtimeId?: string;
  settings?: { mcp: Record<string, McpServer> }; target?: CapabilityTarget;
  onChanged(): Promise<void>; onRestart(): Promise<void>; onManageMcp(name?: string): void; onBack(): void;
}) {
  const t = (cn: string, en: string) => language === 'zh' ? cn : en;
  const [catalog, setCatalog] = useState<CapabilityCatalog>();
  const [loading, setLoading] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [warnings, setWarnings] = useState<string[]>([]);
  const [tab, setTab] = useState<PluginTab>('installed');
  const [query, setQuery] = useState('');
  const [source, setSource] = useState('');
  const [adding, setAdding] = useState(false);
  const [selected, setSelected] = useState<string>();
  const [detailTab, setDetailTab] = useState('config');
  const [changed, setChanged] = useState(false);
  const [repositoryPending, setRepositoryPending] = useState(false);
  const [bvrState, setBvrState] = useState({ dirty: false, pending: false, ready: false });
  const [confirmation, setConfirmation] = useState<{ title: string; action(): void }>();
  const [live, setLive] = useState<{ runtimeId: string; servers: SessionSummary['mcp'] }>();
  const operation = useRef(false);
  const alive = useRef(true);
  const dialog = useRef<HTMLDialogElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const listTrigger = useRef<HTMLButtonElement | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const scroll = useRef<HTMLDivElement>(null);
  const id = useId();
  const formId = `${id}-bvr`;
  const installed: Entry[] = (catalog?.plugins ?? []).map(plugin => ({ ...plugin, key: `i:${plugin.id}`, source: plugin.marketplace, installed: plugin }));
  const available: Entry[] = (catalog?.available ?? []).map(plugin => {
    const owner = catalog?.plugins.find(item => item.id === plugin.installedId);
    return { key: `m:${plugin.marketplace}/${plugin.name}`, name: plugin.displayName ?? plugin.name,
      description: plugin.description, version: plugin.version, repository: plugin.repository,
      icon: plugin.icon, source: plugin.marketplace, installed: owner, available: plugin,
      package: plugin.package };
  });
  const entry = [...installed, ...available].find(item => item.key === selected);
  const refreshRepository = async () => {
    if (!entry?.package || repositoryPending) return;
    const ref = entry.package.ref;
    const repository = entry.repository;
    setRepositoryPending(true);
    try {
      const stars = await bridge.pluginRepositoryInfo({ ref, refresh: true });
      if (alive.current) setCatalog(current => current && ({ ...current,
        plugins: current.plugins.map(plugin => plugin.package && plugin.repository === repository ? { ...plugin, package: { ...plugin.package, stars } } : plugin),
        available: current.available.map(plugin => plugin.package && plugin.repository === repository ? { ...plugin, package: { ...plugin.package, stars } } : plugin),
      }));
    } catch (error) { if (alive.current) setError(capabilityErrorText(error, language === 'zh')); }
    finally { if (alive.current) setRepositoryPending(false); }
  };
  const isBvr = entry?.installed?.id === 'bilibili-video-research';
  const isStepPage = entry?.installed?.id === 'steppage';
  const locked = busy || pending || loading || bvrState.pending;
  const configurationPackage = entry?.installed?.package;
  const hasConfigurationForm = Boolean(isBvr || configurationPackage?.configurationAvailable);
  const canEditBvr = Boolean(hasConfigurationForm && bvrState.ready);
  const refresh = async () => {
    if (operation.current) return;
    operation.current = true; setLoading(true); setError('');
    try { const value = await bridge.capabilityCatalog(); if (alive.current) setCatalog(value); }
    catch (error) { if (alive.current) setError(capabilityErrorText(error, language === 'zh')); }
    finally { operation.current = false; if (alive.current) setLoading(false); }
  };
  useEffect(() => { alive.current = true; void refresh(); return () => { alive.current = false; }; }, [bridge]);
  useEffect(() => {
    // MCP edits can happen in Settings while this view retains its local draft.
    if (active && catalog) void refresh();
  }, [active, settings]);
  useEffect(() => {
    if (!target || target.page !== 'plugins') return;
    navigate(() => {
      setSelected(undefined); setBvrState({ dirty: false, pending: false, ready: false });
      setTab(target.tab ?? 'installed'); setQuery(target.query ?? ''); setAdding(Boolean(target.source)); setSource(target.source ?? '');
    });
  }, [target]);
  useEffect(() => {
    if (!active || !runtimeId || !entry?.installed) { setLive(undefined); return; }
    let valid = true, running = false;
    const poll = async () => {
      if (running) return; running = true;
      try { const summary = await bridge.summary(runtimeId); if (valid) setLive({ runtimeId, servers: summary.mcp }); }
      catch { if (valid) setLive(undefined); }
      finally { running = false; }
    };
    void poll(); const timer = setInterval(() => void poll(), 3000);
    return () => { valid = false; clearInterval(timer); };
  }, [active, runtimeId, entry?.installed?.id, bridge]);
  useEffect(() => {
    if (!active) return;
    if (selected) heading.current?.focus({ preventScroll: true });
    else listTrigger.current?.focus({ preventScroll: true });
  }, [selected, active]);
  useEffect(() => {
    if (confirmation) {
      returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      dialog.current?.showModal();
    } else if (dialog.current?.open) {
      dialog.current.close(); returnFocus.current?.focus({ preventScroll: true });
    }
  }, [confirmation]);
  useEffect(() => { if (!active) setConfirmation(undefined); }, [active]);
  const navigate = (action: () => void) => {
    if (pending || bvrState.pending) return;
    if (hasConfigurationForm && bvrState.dirty) setConfirmation({ title: t('放弃未保存的插件配置？', 'Discard unsaved plugin configuration?'), action });
    else action();
  };
  const choose = (item: Entry, trigger?: HTMLButtonElement, page = 'config') => navigate(() => {
    if (trigger) listTrigger.current = trigger;
    setSelected(item.key); setDetailTab(page);
    setBvrState({ dirty: false, pending: false, ready: false });
  });
  const perform = async (input: CapabilityMutation) => {
    if (operation.current || locked) return;
    operation.current = true; setPending(true); setError(''); setWarnings([]);
    try {
      const result = await bridge.capabilityMutate(input);
      if (!alive.current) return;
      setWarnings(result.warnings);
      if (!input.action.startsWith('marketplace-')) setChanged(true);
      if (input.action === 'plugin-remove') { setSelected(undefined); setBvrState({ dirty: false, pending: false, ready: false }); }
      if (input.action === 'marketplace-add') { setAdding(false); setSource(''); }
      const next = await bridge.capabilityCatalog();
      if (alive.current) {
        setCatalog(next);
        if (input.action === 'plugin-install') {
          const added = next.available.find(item => item.name === input.name && item.marketplace === input.marketplace);
          if (added?.installedId) { setSelected(`i:${added.installedId}`); setDetailTab('config'); }
        }
      }
      await onChanged();
    } catch (error) { if (alive.current) setError(capabilityErrorText(error, language === 'zh')); }
    finally { operation.current = false; if (alive.current) setPending(false); }
  };
  const restart = async () => {
    if (operation.current || locked || !runtimeId) throw new Error('Session restart unavailable');
    operation.current = true; setPending(true); setError('');
    try { await onRestart(); if (alive.current) { setChanged(false); setLive(undefined); } }
    finally { operation.current = false; if (alive.current) setPending(false); }
  };
  const stepPagePrepared = async () => {
    setChanged(true); await onChanged();
    const next = await bridge.capabilityCatalog();
    if (!alive.current) return;
    setCatalog(next);
  };
  const servers = (plugin: CapabilityPlugin) => catalog?.mcp.filter(server => server.pluginId === plugin.id) ?? [];
  const toggle = (plugin: CapabilityPlugin) => {
    const owned = servers(plugin);
    return <button type="button" role="switch" className={`cap-switch${owned.length && owned.every(server => server.enabled) ? ' on' : ''}`}
      aria-label={t(`启用 ${plugin.name} 服务`, `Enable ${plugin.name} services`)}
      aria-checked={owned.length > 0 && owned.every(server => server.enabled)}
      disabled={locked || !owned.length || owned.some(server => !server.configurable)}
      onClick={() => void perform({ action: 'plugin-toggle', id: plugin.id, enabled: !owned.every(server => server.enabled) })}><span/></button>;
  };
  const status = (plugin: CapabilityPlugin) => {
    const owned = servers(plugin);
    return !owned.length ? t('无 MCP 服务', 'No MCP services') : owned.every(server => server.enabled) ? t('服务已启用', 'Services enabled')
      : owned.every(server => !server.enabled) ? t('服务已停用', 'Services disabled') : t('部分服务启用', 'Some services enabled');
  };
  const matches = (item: Entry) => `${item.name} ${item.description ?? ''} ${item.installed?.id ?? item.available?.name ?? ''} ${item.source ?? ''}`.toLocaleLowerCase().includes(query.toLocaleLowerCase());
  const shown = (tab === 'installed' ? installed : available).filter(matches);
  const back = () => navigate(() => { setSelected(undefined); setBvrState({ dirty: false, pending: false, ready: false }); });
  const tabs: [PluginTab, string][] = [['installed', t('已安装', 'Installed')], ['discover', t('发现', 'Discover')], ['sources', t('市场来源', 'Marketplaces')]];
  const detailTabs = [['about', t('使用说明', 'Guide')], ['config', t('配置', 'Configuration')], ['capabilities', t('能力', 'Capabilities')],
    ...(entry?.package?.documentation.changelog ? [['updates', t('更新记录', 'Changelog')]] : [])];
  useEffect(() => {
    if (detailTab === 'updates' && !entry?.package?.documentation.changelog) setDetailTab('about');
  }, [entry?.package?.documentation.changelog, detailTab]);
  const tabKeyboard = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role=tab]'));
    const current = buttons.findIndex(button => button === document.activeElement);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
      : (current + (event.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length;
    event.preventDefault(); buttons[next]?.click(); buttons[next]?.focus();
  };
  return <section className="plugin-center pc-center" aria-label={t('插件中心', 'Plugin center')} data-level={entry ? 'detail' : 'catalog'} hidden={!active}>
    <header className="pc-page-header" hidden={Boolean(entry)}><div><button className="icon-button" aria-label={t('返回会话', 'Back to conversation')} onClick={onBack}><ArrowLeft size={18}/></button>
      <Plug size={23}/><h1>{t('插件', 'Plugins')}</h1><span className="pc-count">{catalog?.plugins.length ?? ''}</span></div>
      <button type="button" className="icon-button" aria-label={t('刷新插件目录', 'Refresh plugins')} disabled={pending || loading}
        onClick={() => void refresh()}><RefreshCw size={16} className={loading ? 'pc-spin' : undefined}/></button></header>
    {pending && <p className="cap-pending" role="status"><LoaderCircle size={14} className="pc-spin"/>{t('正在处理', 'Working')}</p>}
    {error && <div className="cap-error" role="alert">{error}</div>}
    {!!warnings.length && <ul className="cap-notes">{warnings.map((value, index) => <li key={index}>{value}</li>)}</ul>}
    {!entry ? <div className="pc-catalog-page">
      <div className="pc-catalog-toolbar">
        <div className="cap-tabs pc-catalog-tabs" role="tablist" aria-label={t('插件目录', 'Plugin catalog')} onKeyDown={tabKeyboard}>
          {tabs.map(([value, label]) => <button key={value} role="tab" id={`${id}-${value}`} aria-selected={tab === value}
            tabIndex={tab === value ? 0 : -1} aria-controls={`${id}-catalog`} onClick={() => setTab(value)}>{label}
            {value === 'installed' && catalog && <span>{installed.length}</span>}</button>)}
        </div>
        <label className="pc-search"><Search size={15}/><input value={query} aria-label={t('搜索插件', 'Search plugins')} placeholder={t('搜索插件', 'Search plugins')}
          onChange={event => setQuery(event.target.value)}/>{query && <button className="icon-button" aria-label={t('清空搜索', 'Clear search')} onClick={() => setQuery('')}><X size={13}/></button>}</label>
      </div>
      <div className="pc-catalog-body" id={`${id}-catalog`} role="tabpanel" aria-labelledby={`${id}-${tab}`}>
        {!catalog ? <div className="pc-list-empty">{loading ? t('加载中', 'Loading') : <button onClick={() => void refresh()}>{t('重试', 'Retry')}</button>}</div>
          : tab === 'sources' ? <div className="pc-sources">
            <div className="pc-section-title"><h3>{t('市场来源', 'Marketplaces')}</h3><button disabled={locked} onClick={() => setAdding(!adding)}><Plus size={15}/>{t('添加市场', 'Add marketplace')}</button></div>
            {adding && <form className="pc-source-form" onSubmit={event => { event.preventDefault(); void perform({ action: 'marketplace-add', source }); }}>
              <label>{t('市场来源', 'Marketplace source')}<input autoFocus required value={source} disabled={locked} placeholder="owner/repo" onChange={event => setSource(event.target.value)}/></label>
              <button type="button" disabled={pending} onClick={() => setAdding(false)}>{t('取消', 'Cancel')}</button><button className="primary" disabled={locked || !source.trim()}><Plus size={14}/>{t('添加', 'Add')}</button></form>}
            {catalog.marketplaces.filter(market => `${market.name} ${market.origin ?? ''}`.toLocaleLowerCase().includes(query.toLocaleLowerCase())).map(market =>
              <div className="pc-source-row" key={market.name}><Globe size={20}/><div><strong>{market.name}</strong><small>{market.origin ?? t('随运行时提供', 'Provided by runtime')}</small></div>
                {market.kind === 'builtin' ? <span className="pc-status">{t('内置', 'Built-in')}</span> : <>
                  <button className="icon-button" disabled={locked} aria-label={t(`更新市场 ${market.name}`, `Update marketplace ${market.name}`)}
                    onClick={() => void perform({ action: 'marketplace-update', name: market.name })}><RefreshCw size={15}/></button>
                  <button className="icon-button pc-danger-button" disabled={locked} aria-label={t(`移除市场 ${market.name}`, `Remove marketplace ${market.name}`)}
                    onClick={() => setConfirmation({ title: t(`移除市场 ${market.name}？已安装插件将保留。`, `Remove marketplace ${market.name}? Installed plugins are kept.`),
                      action: () => void perform({ action: 'marketplace-remove', name: market.name }) })}><Trash2 size={15}/></button></>}
              </div>)}
          </div> : <div className="pc-plugin-list">
            <div className="pc-plugin-grid">{shown.map(item => <article className="pc-plugin-row" key={item.key}>
              <button className="pc-card-open" aria-label={t(`查看 ${item.name} 使用说明`, `Read ${item.name} guide`)} onClick={event => choose(item, event.currentTarget, 'about')}>
                <span className="pc-card-heading"><CapabilityPluginIconView icon={item.icon}/><span><strong>{item.name}</strong><span>{item.version ? `v${item.version}` : item.installed?.id ?? item.available?.name}</span></span></span>
                <span className="pc-card-description">{item.description}</span><span className="pc-card-meta"><span>{item.source ?? t('本机安装', 'Local installation')}</span>
                  <PluginStars value={item.package?.stars} language={language}/>
                  </span>
              </button>
              <footer className="pc-card-footer"><div className="pc-card-state">{item.installed ? <>{toggle(item.installed)}<span className="pc-status">{status(item.installed)}</span></>
                : <button disabled={locked || item.available?.installed || item.available?.blocked} onClick={() => item.available && void perform({ action: 'plugin-install', name: item.available.name, marketplace: item.available.marketplace, ref: item.package?.ref })}>
                  {item.available?.installed ? <Check size={14}/> : <ArrowDownToLine size={14}/>} {item.available?.installed ? t('已安装', 'Installed') : t('安装', 'Install')}</button>}</div>
                <div className="pc-card-actions"><ProjectLink entry={item} language={language}/>
                  <button className="icon-button pc-card-settings" aria-label={t(`配置 ${item.name}`, `Configure ${item.name}`)} onClick={event => choose(item, event.currentTarget)}><Settings size={16}/></button></div></footer>
            </article>)}</div>
            {!shown.length && <div className="pc-list-empty">{t('没有匹配的插件', 'No matching plugins')}{tab === 'installed' && <button onClick={() => { setTab('discover'); setQuery(''); }}>{t('浏览插件', 'Browse plugins')}</button>}</div>}
            <p className="pc-list-footer">{t('开关控制插件 MCP 服务；技能与指令仍由运行时加载。现有会话需重启后应用。', 'Switches control plugin MCP services; skills and commands remain runtime-managed. Restart existing sessions to apply changes.')}</p>
            <ul className="cap-notes">{catalog.warnings.map((value, index) => <li key={index}>{value}</li>)}</ul>
            {tab === 'installed' && !catalog.plugins.some(plugin => plugin.id === 'steppage') && <CapabilityDisclosure className="cap-preparation" label={<>StepPage · {t('内置准备', 'Built-in setup')}</>}>
              <StepPageSettings bridge={bridge} language={language} config={settings?.mcp.steppage__steppage} busy={locked}
                onPrepared={stepPagePrepared} onRestart={restart}/>
            </CapabilityDisclosure>}
          </div>}
      </div>
    </div> : <section className="pc-detail">
      <div className="pc-detail-navigation"><button onClick={back} disabled={pending || bvrState.pending}><ArrowLeft size={15}/>{t('全部插件', 'All plugins')}</button><span>/</span><span>{entry.name}</span>
        <button className="icon-button" aria-label={t('返回会话', 'Back to conversation')} onClick={onBack}><X size={16}/></button></div>
      <div className="pc-detail-workspace"><div ref={scroll} id={`${id}-scroll`} className="pc-detail-scroll"><div className="pc-detail-document">
        <header className="pc-plugin-header"><div className="pc-plugin-identity"><CapabilityPluginIconView icon={entry.icon}/><div className="pc-plugin-title">
          <h2 ref={heading} tabIndex={-1}>{entry.name}</h2><p><span>{entry.version ? `v${entry.version}` : ''}</span><span>{entry.source ?? t('本机安装', 'Local installation')}</span></p>
          {entry.package?.author && <p className="pc-plugin-byline">{entry.package.author}</p>}</div></div>
          <div className="pc-plugin-summary"><p>{entry.description}</p>{entry.installed && <span className="pc-status">{status(entry.installed)}</span>}</div>
          <div className="pc-header-actions"><span className="pc-repository"><ProjectLink entry={entry} language={language}/><PluginStars value={entry.package?.stars} language={language}/>
            {entry.repository && entry.package && <button className="icon-button" disabled={repositoryPending} aria-label={t('刷新仓库信息', 'Refresh repository information')}
              onClick={() => void refreshRepository()}><RefreshCw size={13} className={repositoryPending ? 'pc-spin' : undefined}/></button>}</span>{entry.installed ? <>
            {toggle(entry.installed)}<button className="icon-button pc-danger-button" disabled={locked} aria-label={t('卸载插件', 'Uninstall plugin')}
              onClick={() => navigate(() => setConfirmation({ title: t(`卸载 ${entry.name}？`, `Uninstall ${entry.name}?`),
                action: () => void perform({ action: 'plugin-remove', id: entry.installed!.id }) }))}><Trash2 size={16}/></button></>
            : <button className="primary" disabled={locked || entry.available?.installed || entry.available?.blocked} onClick={() => entry.available && void perform({ action: 'plugin-install', name: entry.available.name, marketplace: entry.available.marketplace, ref: entry.package?.ref })}>
              <ArrowDownToLine size={15}/>{entry.available?.installed ? t('已安装', 'Installed') : t('安装', 'Install')}</button>}</div></header>
        {entry.package?.stars && ['stale', 'limited', 'unavailable'].includes(entry.package.stars.status) && <p className="pc-hint" role="status">
          {entry.package.stars.status === 'stale' ? t('仓库信息为旧快照，查询时间见 Star。', 'Repository information is a previous snapshot; see its timestamp.')
            : entry.package.stars.status === 'limited' ? t('GitHub 查询受限，请稍后重试。', 'GitHub requests are limited. Retry later.')
              : t('仓库信息暂不可用，不影响插件使用。', 'Repository information is unavailable. Plugin use is unaffected.')}</p>}
        {(entry.available?.blocked || entry.package?.provenance === 'conflict') && <p className="cap-error" role="status">
          {t('存在重复的包名、运行时 ID 或不同来源的安装。请先核对市场和已安装副本，相关操作已阻止。',
            'A package name, runtime ID or installation source conflicts. Review the marketplaces and installed copies; ambiguous actions are blocked.')}</p>}
        <div className="cap-tabs pc-detail-tabs" role="tablist" aria-label={t('插件详情', 'Plugin details')} onKeyDown={tabKeyboard}>
          {detailTabs.map(([value, title]) =>
            <button key={value} role="tab" id={`${id}-detail-${value}`} aria-selected={detailTab === value} tabIndex={detailTab === value ? 0 : -1}
              aria-controls={`${id}-${value}-panel`} onClick={() => setDetailTab(value)}>{title}</button>)}
        </div>
        <div className="pc-detail-content" key={entry.key}>
          <div id={`${id}-config-panel`} role="tabpanel" aria-labelledby={`${id}-detail-config`} hidden={detailTab !== 'config'}>
            {isBvr ? <BvrConfigurationForm bridge={bridge} language={language} busy={busy || pending} formId={formId} visible={active && detailTab === 'config'}
              onState={setBvrState} onSaved={async () => { setChanged(true); await onChanged(); }}/>
              : isStepPage ? <StepPageSettings bridge={bridge} language={language} config={settings?.mcp.steppage__steppage} busy={locked}
                onPrepared={stepPagePrepared} onRestart={restart}/>
                : configurationPackage?.configurationAvailable ? <PluginConfigurationForm key={configurationPackage.ref} bridge={bridge} pkg={configurationPackage}
                  language={language} busy={busy || pending} formId={formId} visible={active && detailTab === 'config'}
                  onState={setBvrState} onSaved={async () => { setChanged(true); await onChanged(); }}/>
                : <section className="pc-form-section"><h3>{t('服务配置', 'Service configuration')}</h3><p className="pc-body-copy">
                  {entry.installed ? t('此插件暂未提供专用配置表单。MCP 启动参数与环境变量可在 MCP 设置中管理。', 'This plugin has no dedicated form. Manage MCP launch options and environment variables in MCP settings.')
                    : t('安装后可查看服务配置。', 'Install to view service configuration.')}</p>{entry.installed && <button onClick={() => onManageMcp()}><Settings size={15}/>{t('MCP 设置', 'MCP settings')}</button>}</section>}
          </div>
          <div id={`${id}-capabilities-panel`} role="tabpanel" aria-labelledby={`${id}-detail-capabilities`} hidden={detailTab !== 'capabilities'}>
            {entry.installed ? <>
              <section className="pc-form-section"><h3>MCP</h3>{servers(entry.installed).map(server => {
                const state = live && live.runtimeId === runtimeId ? live.servers.find(value => value.name === server.name) : undefined;
                return <div className="pc-capability-row" key={server.name}><Plug size={18}/><div><strong>{server.name}</strong><p>{server.transport} · {server.enabled ? t('配置已启用', 'Enabled in configuration') : t('配置已停用', 'Disabled in configuration')}</p>
                  <p>{state ? state.status === 'connected' ? t(`已连接 · ${state.toolCount} 个工具`, `Connected · ${state.toolCount} tools`) : state.status
                    : t('当前会话连接状态未确认', 'Current session connection unconfirmed')}</p></div>{server.source === 'user' && <button className="icon-button" aria-label={t(`编辑 ${server.name}`, `Edit ${server.name}`)} onClick={() => onManageMcp(server.name)}><Settings size={15}/></button>}</div>;
              })}{!servers(entry.installed).length && <p className="pc-body-copy">{t('未声明 MCP 服务', 'No declared MCP services')}</p>}</section>
              <section className="pc-form-section"><h3>Skills</h3>{catalog?.skills.filter(skill => skill.pluginName === entry.installed!.name).map(skill =>
                <div className="pc-capability-row" key={skill.id}><BookOpen size={18}/><div><strong>{skill.name}</strong><p>{skill.description}</p></div></div>)}</section>
            </> : <p className="pc-body-copy">{t('安装后查看运行时发现的能力。', 'Install to view runtime-discovered capabilities.')}</p>}
          </div>
          <div id={`${id}-about-panel`} role="tabpanel" aria-labelledby={`${id}-detail-about`} hidden={detailTab !== 'about'}>
            <PluginDocumentation presentation={entry.package} description={entry.description} version={entry.version} language={language}
              fileName={entry.package?.documentation.readme}
              reader={active && detailTab === 'about' && entry.package?.documentation.readme
                ? <PluginDocumentReader key={`${entry.package.ref}-readme`} bridge={bridge} pkg={entry.package} kind="readme" language={language}/> : undefined}/>
            {entry.package?.provenance === 'unknown' && <p className="cap-notes">{t('安装来源未确认', 'Installation source unconfirmed')}</p>}
            {!!entry.package?.warnings.length && <ul className="cap-notes">{entry.package.warnings.map((value, index) => <li key={index}>{value}</li>)}</ul>}
            {!entry.package && <dl className="pc-info-list"><div><dt>ID</dt><dd>{entry.installed?.id ?? entry.available?.id ?? entry.available?.name}</dd></div>
              <div><dt>{t('配置范围', 'Configuration scope')}</dt><dd>{t('本机 Desktop 独立配置', 'Local Desktop profile')}</dd></div></dl>}
            {!!entry.installed?.warnings.length && <ul className="cap-notes">{entry.installed.warnings.map((value, index) => <li key={index}>{value}</li>)}</ul>}
          </div>
          {entry.package?.documentation.changelog && <div id={`${id}-updates-panel`} role="tabpanel" aria-labelledby={`${id}-detail-updates`} hidden={detailTab !== 'updates'}>
            <div className="pc-document-heading"><span>{t('更新记录', 'Changelog')}</span><span>{entry.package.documentation.changelog}</span></div>
            {active && detailTab === 'updates' && <PluginDocumentReader key={`${entry.package.ref}-changelog`} bridge={bridge} pkg={entry.package} kind="changelog" language={language}/>}
          </div>}
        </div>
      </div></div><ScrollThumb scrollRef={scroll} language={language === 'zh' ? 'zh' : 'en'} sessionId={`${entry.key}-${detailTab}`} messageCount={1}
        scrollId={`${id}-scroll`} label={t('插件详情滚动', 'Scroll plugin details')} className="pc-detail-scroll-track" contentSelector=".pc-detail-document" compact/></div>
      <footer className="pc-detail-footer" hidden={['about', 'updates'].includes(detailTab) && !bvrState.dirty && !changed}><span className="pc-save-state" role="status">{hasConfigurationForm && bvrState.dirty ? t('有未保存的更改', 'Unsaved changes')
        : changed ? t('已保存，现有会话需重启后应用', 'Saved; restart existing sessions to apply') : t('Desktop 独立配置', 'Desktop profile')}</span>
        <div>{hasConfigurationForm && detailTab === 'config' && <button className="primary" type="submit" form={formId} disabled={!canEditBvr || !bvrState.dirty || locked}><Save size={14}/>{t('保存配置', 'Save configuration')}</button>}
          <button disabled={locked || !runtimeId || bvrState.dirty} onClick={() => void restart().catch(error => setError(capabilityErrorText(error, language === 'zh')))}><RotateCcw size={14}/>{t('重启当前会话', 'Restart current session')}</button></div></footer>
    </section>}
    <dialog ref={dialog} className="pc-dialog" aria-label={confirmation?.title} onCancel={event => { event.preventDefault(); setConfirmation(undefined); }}>
      <header><h2>{confirmation?.title}</h2></header><footer><button autoFocus onClick={() => setConfirmation(undefined)}>{t('取消', 'Cancel')}</button>
        <button className="pc-danger-button" onClick={() => { const action = confirmation?.action; setConfirmation(undefined); action?.(); }}>{t('确认', 'Confirm')}</button></footer>
    </dialog>
  </section>;
}
