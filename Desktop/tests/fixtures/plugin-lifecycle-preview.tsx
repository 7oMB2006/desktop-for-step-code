import { Fragment, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ArrowDownToLine, ArrowLeft, ArrowRight, ArrowUpRight, Check, CircleAlert, Clock3, LoaderCircle, Plug, RefreshCw, RotateCcw, Search, Settings, Trash2, X } from 'lucide-react';
import { CapabilityDisclosure, CapabilityPluginIconView } from '../../src/CapabilitySettings';
import { PluginCardRequirements } from '../../src/PluginMarketplaceMetadata';
import { NoticeToast, type NoticeToastItem } from '../../src/NoticeToast';
import { PluginInstanceRing, type PluginInstancePhase } from '../../src/PluginInstanceRing';
import type { CapabilityPlugin } from '../../src/capabilities';
import './plugin-lifecycle-preview.css';

type Intent = 'update' | 'reload' | 'remove';
type Occupancy = 'idle' | 'busy' | 'unknown';
type Target = { id: string; name: string; phase: 'waiting' | 'loading' | 'done' | 'failed' | 'cancelled'; readyAt: number };
type Operation = {
  id: string; intent: Intent; phase: 'installing' | 'loading' | 'waiting' | 'done' | 'failed' | 'cancelled';
  from: string; to: string; installed: boolean; readyAt: number; targets: Target[];
};
type Model = {
  versions: Record<string, string>; enabled: Record<string, boolean>; operations: Record<string, Operation>;
  recovered: string[]; removed: string[]; notice: string;
};
const active = (operation?: Operation) => Boolean(operation && ['installing', 'loading', 'waiting'].includes(operation.phase));
const verb = (intent: Intent) => intent === 'update' ? '更新' : intent === 'reload' ? '重新加载' : '卸载';
const nextVersion = (id: string) => id === 'bvr' ? '0.2.0' : '2.0.0';
const targetName = (phase: Target['phase'], occupancy: Occupancy) => phase === 'done' ? '已加载'
  : phase === 'loading' ? '正在加载' : phase === 'failed' ? '连接失败'
    : phase === 'cancelled' ? '等待已取消' : occupancy === 'unknown' ? '状态待确认' : '等待当前调用结束';

function instancePhases(targets: Target[], operation: Operation | undefined, occupancy: Occupancy): PluginInstancePhase[] {
  return targets.map((target, index) => {
    if (!operation || operation.phase === 'installing')
      return index > 0 || occupancy === 'idle' ? 'idle' : occupancy === 'busy' ? 'occupied' : 'unknown';
    return target.phase === 'waiting' ? occupancy === 'unknown' ? 'unknown' : 'occupied' : target.phase;
  });
}

function OperationDialog({ id, label, trigger, onClose, children }: {
  id: string; label: string; trigger: HTMLButtonElement | null; onClose(): void; children: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useLayoutEffect(() => {
    const element = dialog.current!;
    element.showModal();
    return () => {
      element.close();
      if (trigger?.isConnected) trigger.focus({ preventScroll: true });
      else document.querySelector<HTMLInputElement>('.lc-center input')?.focus({ preventScroll: true });
    };
  }, [trigger]);
  return createPortal(<dialog ref={dialog} id={id} className="pc-dialog lc-panel" aria-label={label}
    onCancel={event => { event.preventDefault(); onClose(); }}>{children}</dialog>, document.body);
}

// This fixture models the intended plugin lifecycle; it never invokes native IPC.
function advance(model: Model, occupancy: Occupancy, failure: boolean): Model {
  let next = model;
  const now = Date.now();
  for (const [id, previous] of Object.entries(model.operations)) {
    if (!active(previous)) continue;
    let operation = previous;
    if (operation.phase === 'installing') {
      if (operation.readyAt > now) continue;
      operation = { ...operation, installed: true, phase: 'loading' };
      next = { ...next, versions: { ...next.versions, [id]: operation.to } };
    }
    const targets = operation.targets.map((target, index): Target => {
      if (target.phase === 'waiting' && (index > 0 || occupancy === 'idle'))
        return { ...target, phase: 'loading', readyAt: now + 1100 };
      if (target.phase === 'loading' && target.readyAt <= now)
        return { ...target, phase: failure ? 'failed' : 'done' };
      return target;
    });
    const phase = targets.some(item => item.phase === 'loading') ? 'loading'
      : targets.some(item => item.phase === 'waiting') ? 'waiting'
        : targets.some(item => item.phase === 'failed') ? 'failed'
          : targets.some(item => item.phase === 'cancelled') ? 'cancelled' : 'done';
    if (operation === previous && phase === previous.phase && targets.every((target, index) => target === previous.targets[index])) continue;
    operation = { ...operation, phase, targets };
    next = { ...next, operations: { ...next.operations, [id]: operation } };
    if (phase === 'done' && operation.intent === 'remove') {
      next = { ...next, removed: [...next.removed, id], notice: '插件已卸载，会话记录已保留。' };
    } else if (phase === 'done' && !next.recovered.includes(id)) {
      next = { ...next, recovered: [...next.recovered, id] };
    }
  }
  return next;
}

export function PluginLifecyclePreview({ plugins, visible: isVisible, occupancy, failure, failed, connecting, onBack, onCatalog, onConfigure, onSession }: {
  plugins: CapabilityPlugin[]; visible: boolean; occupancy: Occupancy; failure: boolean; failed: boolean; connecting: boolean;
  onBack(): void; onCatalog(tab: 'discover' | 'sources'): void; onConfigure(): void; onSession(id: string): void;
}) {
  const uid = useId(), focus = useRef<HTMLButtonElement | null>(null);
  const [query, setQuery] = useState(''), [checked, setChecked] = useState(false);
  const [panel, setPanel] = useState<{ id: string; intent: Intent }>();
  const [notice, setNotice] = useState<NoticeToastItem | null>(null);
  const settled = useRef(new Set<string>()), noticeId = useRef(0);
  const [model, setModel] = useState<Model>(() => ({
    versions: Object.fromEntries(plugins.map(plugin => [plugin.id, plugin.version ?? '1.0.0'])),
    enabled: Object.fromEntries(plugins.map(plugin => [plugin.id, true])),
    operations: {}, recovered: [], removed: [], notice: '',
  }));
  const running = Object.values(model.operations).some(active);
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setModel(current => advance(current, occupancy, failure)), 200);
    return () => clearInterval(timer);
  }, [running, occupancy, failure]);
  const close = () => setPanel(undefined);
  useEffect(() => {
    if (!isVisible || panel && model.removed.includes(panel.id)) setPanel(undefined);
  }, [isVisible, panel, model.removed]);
  useEffect(() => {
    for (const [id, operation] of Object.entries(model.operations)) {
      if (operation.intent !== 'reload' || !['done', 'failed'].includes(operation.phase) || settled.current.has(operation.id)) continue;
      settled.current.add(operation.id);
      const name = plugins.find(plugin => plugin.id === id)?.name ?? id;
      setNotice({ id: ++noticeId.current, type: operation.phase === 'done' ? 'success' : 'warning',
        message: operation.phase === 'done' ? `${name} 已重新加载` : `${name} 加载失败，其他工具可继续使用。` });
    }
  }, [model.operations, plugins]);
  const open = (id: string, intent: Intent, button: HTMLButtonElement) => {
    focus.current = button;
    const operation = model.operations[id];
    const actual = active(operation) ? operation!.intent : intent;
    setPanel(current => current?.id === id && current.intent === actual ? undefined : { id, intent: actual });
  };
  const start = (plugin: CapabilityPlugin, intent: Intent, retry = false) => {
    setNotice(null);
    setModel(current => {
      if (active(current.operations[plugin.id])) return current;
      const previous = current.operations[plugin.id], now = Date.now();
      const installed = intent === 'update' && retry && previous?.installed === true;
      const targets: Target[] = [
        { id: 'preview-chat', name: '插件联调记录', phase: occupancy === 'idle' ? 'loading' : 'waiting', readyAt: now + 1500 },
        { id: 'preview-research', name: '每周资料整理', phase: 'loading', readyAt: now + 1500 },
      ];
      const operation: Operation = {
        id: crypto.randomUUID(), intent, from: installed ? previous.from : current.versions[plugin.id],
        to: intent === 'update' ? nextVersion(plugin.id) : current.versions[plugin.id], installed,
        phase: intent === 'update' && !installed ? 'installing' : 'loading', readyAt: now + 1200,
        targets: intent === 'update' && !installed ? targets.map(target => target.phase === 'loading'
          ? { ...target, readyAt: now + 2600 } : target) : targets,
      };
      return { ...current, operations: { ...current.operations, [plugin.id]: operation }, notice: '' };
    });
  };
  const cancelWaiting = (id: string) => setModel(current => {
    const operation = current.operations[id];
    if (!operation || operation.phase === 'installing') return current;
    const targets = operation.targets.map(target => target.phase === 'waiting' ? { ...target, phase: 'cancelled' as const } : target);
    return { ...current, operations: { ...current.operations, [id]: { ...operation, targets,
      phase: targets.some(target => target.phase === 'loading') ? 'loading' : targets.some(target => target.phase === 'failed') ? 'failed' : 'cancelled' } } };
  });
  const visible = plugins.filter(plugin => !model.removed.includes(plugin.id));
  const shown = visible.filter(plugin => `${plugin.name} ${plugin.description}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  const version = (id: string) => model.versions[id];
  return <section className="plugin-center pc-center lc-center" aria-label="插件">
    <header className="pc-page-header">
      <div><button className="icon-button" aria-label="返回会话" data-tooltip="返回会话" onClick={onBack}><ArrowLeft size={17}/></button>
        <Plug size={21}/><h1>插件</h1><span className="pc-count">{visible.length}</span></div>
      <button className="pc-check-updates" onClick={() => setChecked(true)}><RefreshCw size={14}/>{checked ? '已检查' : '检查更新'}</button>
    </header>
    <div className="pc-catalog-toolbar">
      <nav className="lc-tabs" aria-label="插件视图">
        <button type="button" aria-current="page">已安装 <small>{visible.length}</small></button>
        <button type="button" onClick={() => onCatalog('discover')}>发现</button>
        <button type="button" onClick={() => onCatalog('sources')}>市场来源</button>
      </nav>
      <label className="pc-search"><Search size={15}/><input aria-label="搜索插件" placeholder="搜索插件" value={query}
        onChange={event => setQuery(event.target.value)}/>{query && <button className="icon-button" aria-label="清空搜索" onClick={() => setQuery('')}><X size={13}/></button>}</label>
    </div>
    <div className="lc-scroll">
      {model.notice && <p className="lc-notice" role="status"><Check size={14}/>{model.notice}</p>}
      <div className="pc-plugin-grid lc-grid">
        {shown.map(plugin => {
          const operation = model.operations[plugin.id], busy = active(operation), installed = version(plugin.id) === nextVersion(plugin.id);
          const expanded = panel?.id === plugin.id, intent = expanded ? panel.intent : undefined;
          const current = operation?.intent === intent ? operation : undefined;
          const unavailable = failed && plugin.id === plugins[0]?.id && !model.recovered.includes(plugin.id);
          const enabled = model.enabled[plugin.id];
          const working = busy && operation!.phase !== 'waiting';
          const status = !enabled ? '已停用' : busy ? operation!.phase === 'waiting' ? '等待调用结束' : `${verb(operation!.intent)}中`
            : operation?.phase === 'failed' ? '加载失败' : operation?.phase === 'cancelled' ? '部分实例待加载'
              : unavailable ? '当前会话不可用' : connecting && !model.recovered.includes(plugin.id) ? '连接中' : '已连接';
          const updateCaption = operation?.intent === 'update' ? busy ? '更新进度' : operation.phase === 'done' ? '更新结果' : '更新详情' : '更新';
          const hasDetails = Boolean(operation && (busy || operation.phase === 'failed' || operation.phase === 'cancelled'));
          const connection = <span className="lc-connection" data-unavailable={!busy && (unavailable || operation?.phase === 'failed') || undefined}
            role="status">{working ? <LoaderCircle size={12} className="pc-spin"/> : <i aria-hidden="true"/>}{status}</span>;
          const title = !current ? intent === 'update' ? '更新插件' : intent === 'reload' ? '重新加载插件' : '卸载插件'
            : current.phase === 'installing' ? '正在安装新版'
              : current.phase === 'done' ? intent === 'update' ? '更新完成' : intent === 'reload' ? '重新加载完成' : '卸载完成'
                : current.phase === 'failed' ? current.installed ? '新版已安装，加载未完成' : '加载未完成'
                  : current.phase === 'cancelled' ? '等待已取消'
                    : current.phase === 'waiting' ? '等待插件调用结束' : intent === 'update' ? '正在加载新版' : intent === 'remove' ? '正在释放插件' : '正在重新加载';
          const completed = current?.targets.filter(target => target.phase === 'done').length ?? 0;
          const waiting = current?.targets.some(target => target.phase === 'waiting') ?? false;
          const error = current?.phase === 'failed', cancelled = current?.phase === 'cancelled';
          const targets: Target[] = current?.targets ?? [
            { id: 'preview-chat', name: '插件联调记录', phase: occupancy === 'idle' ? 'done' : 'waiting', readyAt: 0 },
            { id: 'preview-research', name: '每周资料整理', phase: 'done', readyAt: 0 },
          ];
          const preparing = !current || current.phase === 'installing';
          const phases = instancePhases(targets, current, occupancy);
          const ready = phases.filter(phase => phase === 'idle').length;
          return <Fragment key={plugin.id}><article className="pc-plugin-row lc-card" data-plugin={plugin.id} data-expanded={expanded || undefined}
            data-operation-id={operation?.id} data-operation-phase={operation?.phase}>
            <header className="lc-identity"><CapabilityPluginIconView icon={plugin.icon}/><div><h2>{plugin.name}</h2>
              <span className="lc-version">v{version(plugin.id)}{!installed && <><ArrowRight size={11}/><span>v{nextVersion(plugin.id)}</span></>}
                {installed && <span className="lc-latest"><Check size={11}/>最新</span>}</span></div></header>
            <p className="lc-description">{plugin.description}</p>
            <PluginCardRequirements pkg={plugin.package} language="zh" active/>
            <div className="lc-status-row">{hasDetails ? <button type="button" className="lc-status-action"
              aria-label={`查看${verb(operation!.intent)}详情 ${plugin.name}`} aria-haspopup="dialog"
              aria-expanded={expanded} aria-controls={`${uid}-${plugin.id}`} data-tooltip="查看操作详情"
              onClick={event => open(plugin.id, operation!.intent, event.currentTarget)}>{connection}</button> : connection}
              <small>来源未确认</small></div>
            <footer className="lc-footer">
              <label className="lc-switch"><button type="button" role="switch" className={`cap-switch${enabled ? ' on' : ''}`}
                aria-label={`启用 ${plugin.name} 服务`} aria-checked={enabled} disabled={busy}
                onClick={() => setModel(current => ({ ...current, enabled: { ...current.enabled, [plugin.id]: !enabled } }))}><span/></button><span>启用</span></label>
              <div className="lc-tools">
                {(!installed || operation?.intent === 'update') && <button type="button" className="lc-update"
                  aria-label={`${updateCaption} ${plugin.name}`} aria-haspopup="dialog" aria-expanded={expanded && intent === 'update'} aria-controls={`${uid}-${plugin.id}`}
                  onClick={event => open(plugin.id, 'update', event.currentTarget)}>{updateCaption}</button>}
                <button type="button" className="icon-button lc-reload" aria-label={`重载 ${plugin.name}`}
                  aria-haspopup={busy ? 'dialog' : undefined}
                  aria-controls={busy ? `${uid}-${plugin.id}` : undefined} aria-expanded={busy ? expanded : undefined}
                  data-tooltip={busy ? `查看${verb(operation!.intent)}进度` : operation?.intent === 'reload' && operation.phase === 'failed' ? '重试加载' : '重新加载插件'}
                  onClick={event => busy ? open(plugin.id, operation!.intent, event.currentTarget) : start(plugin, 'reload')}>
                  {busy && operation!.intent === 'reload' ? operation!.phase === 'waiting' ? <Clock3 size={15}/>
                    : <LoaderCircle size={15} className="pc-spin"/> : <RotateCcw size={15}/>}</button>
                <button type="button" className="icon-button lc-remove" aria-label={`卸载 ${plugin.name}`} data-tooltip="卸载插件"
                  aria-haspopup="dialog"
                  aria-expanded={expanded && intent === 'remove'} aria-controls={`${uid}-${plugin.id}`}
                  onClick={event => open(plugin.id, 'remove', event.currentTarget)}><Trash2 size={15}/></button>
                <button type="button" className="icon-button" aria-label={`配置 ${plugin.name}`} data-tooltip="插件配置" onClick={onConfigure}><Settings size={15}/></button>
              </div>
            </footer>
          </article>
            {expanded && isVisible && <OperationDialog id={`${uid}-${plugin.id}`} label={`${plugin.name} ${verb(intent!)}`}
              trigger={focus.current} onClose={close}>
              <header><div className="lc-dialog-identity"><CapabilityPluginIconView icon={plugin.icon}/><h2>{plugin.name}</h2></div>
                <button type="button" autoFocus className="icon-button" aria-label="关闭操作详情" data-tooltip="关闭"
                  onClick={close}><X size={16}/></button></header>
              <strong className="lc-operation-title" role="status" aria-live="polite">{title}</strong>
              {intent === 'update' ? <>
                <p className="lc-operation-version"><span>v{current?.from ?? version(plugin.id)}</span><ArrowRight size={13}/><strong>v{current?.to ?? nextVersion(plugin.id)}</strong></p>
                <p className="lc-note">{current?.phase === 'done' ? '新版已加载到全部运行实例。' : current?.installed ? '新版已安装，无需重复更新。'
                  : '保留配置与开关，更新后自动加载新版。'}</p>
              </> : <p className="lc-note">{intent === 'reload' ? `重新加载当前版本 v${version(plugin.id)}，不更换版本。`
                : '停止该插件的连接并移除安装，会话记录保留。'}</p>}
              <CapabilityDisclosure key={`${plugin.id}-${intent}`} className="lc-instances" label={<>
                <span className="lc-instance-heading"><span>运行实例</span><PluginInstanceRing phases={phases} language="zh"/>
                  <span key={`${preparing}-${preparing ? ready : completed}-${intent}`} className="lc-instance-count">{preparing ? ready : completed}/{targets.length} {preparing ? '可立即' : '已'}{intent === 'remove' ? '释放' : '加载'}</span></span>
                {phases.includes('unknown') ? <small>1 个待确认</small>
                  : phases.includes('occupied') ? <small>1 个{preparing ? '占用' : '等待'}</small> : null}</>}>
                <ul>{targets.map(target => <li key={target.id}><div><strong>{target.name}</strong><small data-phase={target.phase}>
                  {!current ? target.phase === 'waiting' ? occupancy === 'unknown' ? '状态待确认' : '调用进行中' : '可立即加载'
                    : current.phase === 'installing' ? '等待新版安装' : intent === 'remove' && target.phase === 'done' ? '已释放' : targetName(target.phase, occupancy)}</small></div>
                  <button type="button" className="icon-button" aria-label={`前往会话 ${target.name}`} data-tooltip="前往会话"
                    onClick={() => { close(); onSession(target.id); }}><ArrowUpRight size={14}/></button></li>)}</ul>
              </CapabilityDisclosure>
              {error && <p className="lc-inline-error" role="alert"><CircleAlert size={14}/>目标插件连接失败，其他工具可继续使用。</p>}
              {cancelled && <p className="lc-note">{current?.installed ? '新版保留，未完成的实例可稍后重新加载。' : '已完成的实例不回退，未开始的实例保持原状。'}</p>}
              <div className="lc-panel-actions">
                {!current && <button type="button" className={intent === 'remove' ? 'lc-destructive' : 'primary'}
                  onClick={() => start(plugin, intent!)}>{intent === 'update' ? <ArrowDownToLine size={14}/> : intent === 'remove' ? <Trash2 size={14}/> : <RotateCcw size={14}/>}
                  {intent === 'update' ? '更新并加载' : intent === 'remove' ? '确认卸载' : '重新加载'}</button>}
                {current && (error || cancelled) && <button type="button" className="primary" onClick={() => start(plugin, intent!, true)}>
                  <RotateCcw size={14}/>{intent === 'remove' ? '重试卸载' : '重试加载'}</button>}
                {waiting && current?.phase !== 'installing' && <button type="button" onClick={() => cancelWaiting(plugin.id)}><X size={14}/>取消等待</button>}
                <button type="button" className="lc-dismiss" onClick={close}>{!current ? '取消' : busy ? '关闭' : '完成'}</button>
              </div>
            </OperationDialog>}
          </Fragment>;
        })}
      </div>
      {!shown.length && <p className="pc-list-empty">没有匹配的插件</p>}
    </div>
    {isVisible && <div className="lc-notifications"><NoticeToast notice={notice} language="zh"
      onDismiss={() => setNotice(null)} onDetails={() => {}}/></div>}
  </section>;
}
