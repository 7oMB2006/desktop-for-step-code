import { useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { AlertCircle, BookOpen, Check, Download, FolderInput, Globe, LoaderCircle, Package, Pencil, Plus, RefreshCw, RotateCcw, Search, Server, Trash2, X } from 'lucide-react';
import type { DesktopBridge, McpServer, SessionSummary } from './contracts';
import type { CapabilityCatalog, CapabilityMutation, CapabilityResult, CapabilityPluginIcon } from './capabilities';
import type { CapabilityPage, CapabilityTarget, PluginTab } from './capability-command';
import type { ComposerCommand } from './composer-commands';
import { McpIcon } from './McpIcon';
import { StepPageSettings } from './StepPageSettings';
import { DisclosureChevron } from './DisclosureChevron';
import { useAnimatedDisclosure } from './useAnimatedDisclosure';
import { StepPlatformIcon } from './ProviderBrand';
import './capability-settings.css';
export { capabilityErrorText } from './capability-errors';
import { capabilityErrorText, capabilityWarningText } from './capability-errors';
import { capabilityNeedsIdle } from './capability-locks';

export type { CapabilityPage, CapabilityTarget } from './capability-command';
export type CapabilityBridge = Pick<DesktopBridge, 'platform' | 'capabilityCatalog' | 'capabilityMutate'
  | 'capabilityImportSkill' | 'summary' | 'saveMcp' | 'stepPageState' | 'prepareStepPage'>;

function IconButton({ title, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { title: string }) {
  return <button type="button" className="icon-button" aria-label={title} data-tooltip={title} {...props}/>;
}

function Switch({ checked, disabled, label, onChange }: {
  checked: boolean; disabled: boolean; label: string; onChange(): void;
}) {
  return <button type="button" role="switch" aria-checked={checked} aria-label={label}
    className={`cap-switch${checked ? ' on' : ''}`} disabled={disabled} onClick={onChange}><span/></button>;
}
function Notes({ values }: { values: string[] }) {
  return values.length ? <ul className="cap-notes">{values.map((value, index) => <li key={index}>{value}</li>)}</ul> : null;
}

export function CapabilityPluginIconView({ icon }: { icon?: CapabilityPluginIcon }) {
  const [failed, setFailed] = useState('');
  const source = icon?.kind === 'png' ? icon.dataUrl : '';
  const image = source && source !== failed && /^data:image\/png;base64,[A-Za-z0-9+/]+=*$/u.test(source);
  return <span className="cap-plugin-icon" aria-hidden="true" data-icon-kind={image ? 'png' : icon?.kind === 'step' ? 'step' : 'fallback'}>
    {image ? <img src={source} alt="" onError={() => setFailed(source)}/>
      : icon?.kind === 'step' ? <StepPlatformIcon size={20}/> : <Package size={18}/>}
  </span>;
}

export function CapabilityDisclosure({ className, label, children }: {
  className: string; label: ReactNode; children: ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
  const { details, body } = useAnimatedDisclosure(expanded);
  const bodyId = useId();
  return <details className={`cap-disclosure ${className}`} ref={details} data-expanded={expanded}>
    <summary aria-expanded={expanded} aria-controls={bodyId}
      onClick={event => { event.preventDefault(); setExpanded(value => !value); }}>
      {label}<span className="cap-chevron"><DisclosureChevron/></span>
    </summary>
    <div ref={body} id={bodyId} className="cap-disclosure-body" aria-hidden={!expanded} inert={!expanded}>{children}</div>
  </details>;
}

export function CapabilitySettings({ page, bridge, language, busy, runtimeId, settings, target, commands = [], onEditMcp, onRestart, onChanged }: {
  page: CapabilityPage; bridge: CapabilityBridge; language: string; busy: boolean; runtimeId?: string;
  settings: { mcp: Record<string, McpServer> }; target?: CapabilityTarget;
  commands?: ComposerCommand[];
  onEditMcp(name?: string): void; onRestart(): Promise<void>; onChanged(): Promise<void>;
}) {
  const zh = language === 'zh';
  const t = (cn: string, en: string) => zh ? cn : en;
  const [catalog, setCatalog] = useState<CapabilityCatalog>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const [changed, setChanged] = useState(false);
  const [resultWarnings, setResultWarnings] = useState<string[]>([]);
  const [tab, setTab] = useState<PluginTab>(target?.tab ?? 'installed');
  const [query, setQuery] = useState(target?.query ?? '');
  const [form, setForm] = useState<'market' | 'skill' | null>(target?.source ? 'market' : null);
  const [source, setSource] = useState(target?.source ?? '');
  const [skill, setSkill] = useState({ name: '', description: '', instructions: '' });
  const [confirmation, setConfirmation] = useState<{ key: string; label: string; input: CapabilityMutation }>();
  const [live, setLive] = useState<{ runtimeId: string; servers: SessionSummary['mcp'] }>();
  const alive = useRef(true);
  const operation = useRef(false);
  const id = useId();
  const operationLocked = pending || loading;
  const locked = busy || operationLocked;
  const mutationLocked = (input: CapabilityMutation) => operationLocked || busy && capabilityNeedsIdle(input, catalog);
  const search = (value: string) => !query || value.toLocaleLowerCase().includes(query.toLocaleLowerCase());
  const refresh = async () => {
    if (operation.current) return;
    operation.current = true;
    setLoading(true); setError('');
    try { const next = await bridge.capabilityCatalog(); if (alive.current) setCatalog(next); }
    catch (error) { if (alive.current) setError(capabilityErrorText(error, zh)); }
    finally { operation.current = false; if (alive.current) setLoading(false); }
  };
  useEffect(() => {
    alive.current = true;
    void refresh();
    return () => { alive.current = false; };
  }, [bridge]);
  useEffect(() => {
    if (page !== 'mcp' || !runtimeId) { setLive(undefined); return; }
    let active = true;
    let running = false;
    const poll = async () => {
      if (running) return;
      running = true;
      try { const summary = await bridge.summary(runtimeId); if (active) setLive({ runtimeId, servers: summary.mcp }); }
      catch { if (active) setLive(undefined); }
      finally { running = false; }
    };
    void poll();
    const timer = setInterval(() => void poll(), 3000);
    return () => { active = false; clearInterval(timer); };
  }, [bridge, runtimeId, page]);
  const perform = async (work: () => Promise<CapabilityResult | null>, applies = true, requiresIdle = true) => {
    if (operation.current || busy && requiresIdle) return;
    operation.current = true; setPending(true); setError(''); setResultWarnings([]);
    try {
      const result = await work();
      if (!result || !alive.current) return;
      setConfirmation(undefined); setForm(null); setSource(''); setSkill({ name: '', description: '', instructions: '' });
      setResultWarnings(result.warnings); if (applies) setChanged(true);
      await onChanged();
      if (alive.current) setCatalog(await bridge.capabilityCatalog());
    } catch (error) { if (alive.current) setError(capabilityErrorText(error, zh)); }
    finally { operation.current = false; if (alive.current) setPending(false); }
  };
  const mutate = (input: CapabilityMutation) => perform(() => bridge.capabilityMutate(input),
    capabilityNeedsIdle(input, catalog), capabilityNeedsIdle(input, catalog));
  const restart = async () => {
    if (operation.current || busy) return;
    operation.current = true; setPending(true); setError('');
    try { await onRestart(); if (alive.current) { setChanged(false); setLive(undefined); } }
    catch (error) { if (alive.current) setError(capabilityErrorText(error, zh)); }
    finally { operation.current = false; if (alive.current) setPending(false); }
  };
  const confirm = (key: string) => confirmation?.key === key && <div className="cap-confirm" role="group" aria-label={confirmation.label}>
    <span>{confirmation.label}</span><button type="button" disabled={operationLocked} onClick={() => setConfirmation(undefined)}>{t('取消', 'Cancel')}</button>
    <button type="button" className="cap-danger" disabled={mutationLocked(confirmation.input)} onClick={() => void mutate(confirmation.input)}><Trash2 size={13}/>{t('确认移除', 'Remove')}</button>
  </div>;
  const heading = page === 'plugins' ? t('插件', 'Plugins') : page === 'mcp' ? 'MCP' : 'Skills';
  const tabs: [PluginTab, string][] = [['installed', t('已安装', 'Installed')], ['discover', t('发现', 'Discover')], ['sources', t('市场来源', 'Marketplaces')]];
  const mcpStatus = (name: string) => {
    if (!runtimeId) return t('未选择运行会话', 'No runtime selected');
    if (!live || live.runtimeId !== runtimeId) return t('连接状态未知', 'Connection status unknown');
    const value = live && live.runtimeId === runtimeId ? live.servers.find(server => server.name === name) : undefined;
    if (!value) return t('当前会话未加载', 'Not loaded in this session');
    if (value.status === 'connected') return t(`已连接 · ${value.toolCount} 个工具`, `Connected · ${value.toolCount} tools`);
    return { connecting: t('连接中', 'Connecting'), failed: t('连接失败', 'Connection failed'), disabled: t('会话中已停用', 'Disabled in session') }[value.status];
  };
  const stepPage = <StepPageSettings bridge={bridge} language={language} config={settings.mcp.steppage__steppage}
    busy={locked} onPrepared={async () => { await onChanged(); await refresh(); setChanged(true); }}
    onRestart={async () => { await onRestart(); if (alive.current) { setChanged(false); setLive(undefined); } }}/>;
  return <section className="capability-settings" aria-label={heading}>
    <header className="cap-heading"><h3>{heading}</h3><div>
      <IconButton title={t('刷新', 'Refresh')} disabled={loading || pending} onClick={() => void refresh()}><RefreshCw size={16} className={loading ? 'cap-spin' : undefined}/></IconButton>
      {page === 'mcp' && <IconButton title={t('添加 MCP', 'Add MCP')} disabled={locked} onClick={() => onEditMcp()}><Plus size={17}/></IconButton>}
      {page === 'skills' && <>
        <IconButton title={t('导入 Skill', 'Import Skill')} disabled={locked} onClick={() => void perform(() => bridge.capabilityImportSkill())}><FolderInput size={16}/></IconButton>
        <IconButton title={t('新建 Skill', 'Create Skill')} disabled={locked} onClick={() => setForm(form === 'skill' ? null : 'skill')}><Plus size={17}/></IconButton>
      </>}
      {page === 'plugins' && tab === 'sources' && <IconButton title={t('添加市场', 'Add marketplace')} disabled={operationLocked} onClick={() => setForm(form === 'market' ? null : 'market')}><Plus size={17}/></IconButton>}
    </div></header>
    {page === 'plugins' && <div className="cap-tabs" role="tablist" aria-label={t('插件分类', 'Plugin categories')}
      onKeyDown={event => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const current = tabs.findIndex(([key]) => key === tab);
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1
          : (current + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
        setTab(tabs[next][0]); setConfirmation(undefined); setForm(null);
        (event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]).focus();
      }}>
      {tabs.map(([key, label]) => <button type="button" role="tab" id={`${id}-${key}`} aria-selected={tab === key}
        aria-controls={`${id}-panel`} tabIndex={tab === key ? 0 : -1} key={key}
        onClick={() => { setTab(key); setConfirmation(undefined); setForm(null); setQuery(''); }}>{label}
        {catalog && <span>{key === 'installed' ? catalog.plugins.length : key === 'discover' ? catalog.available.length : catalog.marketplaces.length}</span>}
      </button>)}
    </div>}
    <label className="cap-search"><Search size={14}/><input aria-label={t('搜索资源', 'Search resources')} value={query}
      placeholder={t('搜索', 'Search')} onChange={event => setQuery(event.target.value)}/>{query && <IconButton title={t('清除搜索', 'Clear search')} onClick={() => setQuery('')}><X size={13}/></IconButton>}</label>
    {pending && <div className="cap-pending" role="status"><LoaderCircle className="cap-spin" size={14}/>{t('正在处理', 'Working')}</div>}
    {error && <div className="cap-error" role="alert"><AlertCircle size={15}/><span>{error}</span></div>}
    <div className="cap-body" id={`${id}-panel`} role={page === 'plugins' ? 'tabpanel' : undefined}
      aria-labelledby={page === 'plugins' ? `${id}-${tab}` : undefined}>
      {form === 'market' && <form className="cap-form" onSubmit={event => { event.preventDefault(); void mutate({ action: 'marketplace-add', source }); }}>
        <label>{t('市场来源', 'Marketplace source')}<input autoFocus required value={source} disabled={operationLocked}
          placeholder="owner/repo" onChange={event => setSource(event.target.value)}/></label>
        <div><button type="button" disabled={pending} onClick={() => setForm(null)}>{t('取消', 'Cancel')}</button>
          <button className="primary" disabled={operationLocked || !source.trim()}><Plus size={14}/>{t('添加市场', 'Add marketplace')}</button></div>
      </form>}
      {form === 'skill' && <form className="cap-form" onSubmit={event => { event.preventDefault(); void mutate({ action: 'skill-create', ...skill }); }}>
        <label>{t('名称', 'Name')}<input autoFocus required maxLength={64} pattern="[a-z0-9]+(-[a-z0-9]+)*" value={skill.name} disabled={locked}
          onChange={event => setSkill({ ...skill, name: event.target.value })}/></label>
        <label>{t('描述', 'Description')}<textarea required maxLength={1024} value={skill.description} disabled={locked} onChange={event => setSkill({ ...skill, description: event.target.value })}/></label>
        <label>{t('指令内容', 'Instructions')}<textarea className="cap-instructions" maxLength={128 * 1024} value={skill.instructions} disabled={locked} onChange={event => setSkill({ ...skill, instructions: event.target.value })}/></label>
        <div><button type="button" disabled={pending} onClick={() => setForm(null)}>{t('取消', 'Cancel')}</button>
          <button className="primary" disabled={locked || !skill.name.trim() || !skill.description.trim()}><Plus size={14}/>{t('创建 Skill', 'Create Skill')}</button></div>
      </form>}
      {resultWarnings.length > 0 && <Notes values={resultWarnings.map(value => capabilityWarningText(value, language === 'zh'))}/>}
      {loading && !catalog ? <div className="cap-empty" role="status">{t('加载中', 'Loading')}</div> : !catalog ? <button type="button" onClick={() => void refresh()}>{t('重试', 'Retry')}</button> : <>
        {page === 'plugins' && tab === 'installed' && <>
          {catalog.plugins.filter(plugin => search(`${plugin.name} ${plugin.id} ${plugin.description}`)).map(plugin => <div className="cap-row-wrap" key={plugin.id}>
            <CapabilityDisclosure className="cap-resource" label={<><CapabilityPluginIconView icon={plugin.icon}/><div><strong>{plugin.name}</strong><small>{plugin.description || plugin.id}</small></div>
                {plugin.version && <span className="cap-meta">v{plugin.version}</span>}</>}>
              <div className="cap-details"><dl><dt>ID</dt><dd>{plugin.id}</dd><dt>MCP</dt><dd>{plugin.mcpServers.join(', ') || '—'}</dd>
                {plugin.icon?.kind === 'png' && <><dt>{t('图标', 'Icon')}</dt><dd>DFSC Beta</dd></>}</dl>
                <Notes values={plugin.warnings}/>
                <button type="button" className="cap-danger" disabled={mutationLocked({ action: 'plugin-remove', id: plugin.id })} onClick={() => setConfirmation({ key: plugin.id,
                  label: t(`移除插件 ${plugin.name}？`, `Remove plugin ${plugin.name}?`), input: { action: 'plugin-remove', id: plugin.id } })}><Trash2 size={13}/>{t('卸载插件', 'Uninstall plugin')}</button>
              </div>
            </CapabilityDisclosure>{confirm(plugin.id)}
          </div>)}
          {!catalog.plugins.length && <div className="cap-empty"><span>{t('没有已安装的插件', 'No installed plugins')}</span><button type="button" onClick={() => { setTab('discover'); setQuery(''); }}>{t('浏览插件', 'Browse plugins')}</button></div>}
          {catalog.plugins.length > 0 && !catalog.plugins.some(plugin => search(`${plugin.name} ${plugin.id} ${plugin.description}`)) && <div className="cap-empty">{t('没有匹配的插件', 'No matching plugins')}</div>}
          {<CapabilityDisclosure className="cap-preparation" label={<>StepPage · {t('内置准备', 'Built-in setup')}</>}>{stepPage}</CapabilityDisclosure>}
        </>}
        {page === 'plugins' && tab === 'discover' && <>
          {catalog.available.filter(plugin => search(`${plugin.name} ${plugin.description} ${plugin.marketplace}`)).map(plugin => <div className="cap-row" key={`${plugin.marketplace}/${plugin.name}`}>
            <CapabilityPluginIconView icon={plugin.icon}/><div><strong>{plugin.name}</strong><small>{plugin.description}</small><small>{plugin.marketplace}</small></div>
            {plugin.installed ? <span className="cap-installed"><Check size={13}/>{t('已安装', 'Installed')}</span>
              : <IconButton title={t(`安装 ${plugin.name}`, `Install ${plugin.name}`)} disabled={mutationLocked({ action: 'plugin-install', name: plugin.name, marketplace: plugin.marketplace, ref: plugin.package?.ref })}
                onClick={() => void mutate({ action: 'plugin-install', name: plugin.name, marketplace: plugin.marketplace, ref: plugin.package?.ref })}><Download size={16}/></IconButton>}
          </div>)}
          {!catalog.available.some(plugin => search(`${plugin.name} ${plugin.description} ${plugin.marketplace}`)) && <div className="cap-empty">{t('没有匹配的插件', 'No matching plugins')}</div>}
        </>}
        {page === 'plugins' && tab === 'sources' && catalog.marketplaces.filter(source => search(`${source.name} ${source.origin}`)).map(source => <div className="cap-row-wrap" key={source.name}>
          <div className="cap-row"><Globe size={18}/><div><strong>{source.name}</strong><small>{source.origin || t('随运行时提供', 'Provided by runtime')}</small>
            <small>{source.kind === 'builtin' ? t('内置', 'Built-in') : source.kind === 'git' ? 'Git' : t('本地', 'Local')}</small></div>
            {source.kind !== 'builtin' && <>
              <IconButton title={t(`更新市场 ${source.name}`, `Update marketplace ${source.name}`)} disabled={operationLocked} onClick={() => void mutate({ action: 'marketplace-update', name: source.name })}><RefreshCw size={15}/></IconButton>
              <IconButton title={t(`移除市场 ${source.name}`, `Remove marketplace ${source.name}`)} disabled={operationLocked} onClick={() => setConfirmation({ key: source.name,
                label: t(`移除市场 ${source.name}？已安装插件将保留。`, `Remove marketplace ${source.name}? Installed plugins will be kept.`),
                input: { action: 'marketplace-remove', name: source.name } })}><Trash2 size={15}/></IconButton>
            </>}
          </div>{confirm(source.name)}
        </div>)}
        {page === 'plugins' && tab === 'sources' && !catalog.marketplaces.some(source => search(`${source.name} ${source.origin}`)) && <div className="cap-empty">{t('没有匹配的市场来源', 'No matching marketplaces')}</div>}
        {page === 'mcp' && <>
          {catalog.mcp.filter(server => search(`${server.name} ${server.pluginName ?? ''}`)).map(server => <div className="cap-row-wrap" key={server.name}>
            <div className="cap-row"><McpIcon size={18}/><div><strong>{server.name}</strong>
              <small>{server.pluginName ?? t('独立配置', 'Standalone')} · {server.transport === 'http' ? 'HTTP' : 'stdio'}</small>
              <small>{server.enabled ? t('配置已启用', 'Enabled in configuration') : t('配置已停用', 'Disabled in configuration')} · {mcpStatus(server.name)}</small></div>
              {server.source === 'user' && <><IconButton title={t(`编辑 ${server.name}`, `Edit ${server.name}`)} disabled={locked} onClick={() => onEditMcp(server.name)}><Pencil size={14}/></IconButton>
                <IconButton title={t(`移除 ${server.name}`, `Remove ${server.name}`)} disabled={locked} onClick={() => setConfirmation({ key: server.name,
                  label: t(`移除 MCP ${server.name}？`, `Remove MCP ${server.name}?`),
                  input: { action: 'mcp-toggle', name: server.name, enabled: false } })}><Trash2 size={14}/></IconButton></>}
              <Switch label={t(`启用 ${server.name}`, `Enable ${server.name}`)} checked={server.enabled} disabled={locked || !server.configurable}
                onChange={() => void mutate({ action: 'mcp-toggle', name: server.name, enabled: !server.enabled })}/>
            </div>
            {confirmation?.key === server.name && <div className="cap-confirm" role="group" aria-label={confirmation.label}><span>{confirmation.label}</span>
              <button type="button" disabled={locked} onClick={() => setConfirmation(undefined)}>{t('取消', 'Cancel')}</button>
              <button type="button" className="cap-danger" disabled={locked} onClick={() => void perform(async () => { await bridge.saveMcp(server.name, null); return { warnings: [] }; })}><Trash2 size={13}/>{t('确认移除', 'Remove')}</button></div>}
          </div>)}
          {!catalog.mcp.length && <div className="cap-empty"><Server size={20}/>{t('没有已配置的 MCP', 'No configured MCP servers')}</div>}
          {catalog.mcp.length > 0 && !catalog.mcp.some(server => search(`${server.name} ${server.pluginName ?? ''}`)) && <div className="cap-empty">{t('没有匹配的 MCP', 'No matching MCP servers')}</div>}
        </>}
        {page === 'skills' && <>
          {catalog.skills.filter(skill => search(`${skill.name} ${skill.description} ${skill.pluginName ?? ''}`)).map(skill => <div className="cap-row-wrap" key={skill.id}>
            <div className="cap-row"><BookOpen size={18}/><div><strong>{skill.name}</strong><small>{skill.description}</small>
              <small>{skill.pluginName ?? t('Desktop 本地', 'Desktop local')} · {skill.location}</small></div>
              {skill.deletable && <IconButton title={t(`删除 ${skill.name}`, `Delete ${skill.name}`)} disabled={locked} onClick={() => setConfirmation({ key: skill.id,
                label: t(`删除 Skill ${skill.name}？`, `Delete Skill ${skill.name}?`), input: { action: 'skill-remove', id: skill.id } })}><Trash2 size={14}/></IconButton>}
              {skill.toggleable ? <Switch checked={skill.enabled} label={t(`启用 ${skill.name}`, `Enable ${skill.name}`)} disabled={locked} onChange={() => void mutate({ action: 'skill-toggle', id: skill.id, enabled: !skill.enabled })}/>
                : <span className="cap-meta">{t('插件管理', 'Plugin-managed')}</span>}
            </div>{confirm(skill.id)}
          </div>)}
          {!catalog.skills.length && <div className="cap-empty"><BookOpen size={20}/>{t('没有已发现的 Skills', 'No discovered Skills')}</div>}
          {catalog.skills.length > 0 && !catalog.skills.some(skill => search(`${skill.name} ${skill.description} ${skill.pluginName ?? ''}`)) && <div className="cap-empty">{t('没有匹配的 Skills', 'No matching Skills')}</div>}
          {commands.length > 0 && <CapabilityDisclosure className="cap-preparation" label={<>{t('会话命令', 'Session commands')} · {commands.length}</>}>
            {commands.filter(command => search(`${command.name} ${command.description ?? ''}`)).map(command => <div className="cap-row" key={command.name}>
              <BookOpen size={16}/><div><strong>/{command.name}</strong><small>{command.description}</small><small>{command.source}</small></div>
            </div>)}
          </CapabilityDisclosure>}
        </>}
        <Notes values={catalog.warnings}/>
      </>}
    </div>
    <footer className="cap-footer"><span>{changed ? t('配置已更改，现有会话尚未应用', 'Configuration changed; existing sessions have not applied it') : t('Desktop 独立配置', 'Desktop profile')}</span>
      <button type="button" disabled={!runtimeId || locked} onClick={() => void restart()}><RotateCcw size={14}/>{t('重启当前会话', 'Restart current session')}</button>
    </footer>
  </section>;
}
