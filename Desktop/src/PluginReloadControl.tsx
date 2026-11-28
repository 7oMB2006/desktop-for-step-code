import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowUpRight, Info, LoaderCircle, RotateCcw, X } from 'lucide-react';
import { CapabilityDisclosure } from './CapabilitySettings';
import { capabilityErrorText } from './capability-errors';
import { PluginInstanceRing, type PluginInstancePhase } from './PluginInstanceRing';
import { pluginReloadPending, pluginReloadReason, type PluginReloadBridge, type PluginReloadSession, type PluginReloadState } from './plugin-reload';

function instancePhase(item: PluginReloadSession): PluginInstancePhase {
  if (item.phase === 'ready') return 'idle';
  if (item.phase === 'waiting') return item.reason === 'occupied' ? 'occupied' : 'unknown';
  if (item.phase === 'applying') return 'loading';
  if (item.phase === 'applied') return 'done';
  if (item.phase === 'failed') return 'failed';
  return item.reason === 'unsupported' ? 'unknown' : 'cancelled';
}

export function PluginReloadControl({ bridge, plugin, language, active, disabled, disabledReason, onFinished, onError, onSession }: {
  bridge: PluginReloadBridge; plugin: { id: string; name: string; ref: string }; language: string;
  active: boolean; disabled?: boolean; disabledReason?: string;
  onFinished(state: PluginReloadState): void; onError?(message: string): void; onSession?(id: string): void;
}) {
  const zh = language === 'zh', t = (cn: string, en: string) => zh ? cn : en;
  const id = useId(), anchor = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLDialogElement>(null), returnFocus = useRef<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false), [checking, setChecking] = useState(false);
  const [state, setState] = useState<PluginReloadState>(), [error, setError] = useState('');
  const revision = useRef(0), requesting = useRef(false), tracked = useRef<string | undefined>(undefined);
  const finished = useRef(onFinished);
  finished.current = onFinished;
  const running = pluginReloadPending(state);

  useEffect(() => {
    const request = ++revision.current;
    setState(undefined); setOpen(false); setChecking(false); setError(''); requesting.current = false;
    tracked.current = undefined;
    if (active) void bridge.pluginReloadState({ id: plugin.id, ref: plugin.ref }).then(next => {
      if (request === revision.current && next) {
        if (pluginReloadPending(next)) tracked.current = next.operationId;
        setState(next);
      }
    }).catch(() => {});
    return () => { revision.current++; };
  }, [active, bridge, plugin.id, plugin.ref]);
  useEffect(() => {
    if (!active || !state?.operationId || !running) return;
    let alive = true, reading = false;
    const poll = async () => {
      if (reading || requesting.current) return;
      reading = true;
      const request = revision.current;
      try {
        const next = await bridge.pluginReloadState({ id: plugin.id, ref: plugin.ref });
        if (alive && request === revision.current) {
          if (next?.operationId !== state.operationId) tracked.current = pluginReloadPending(next) ? next?.operationId : undefined;
          setState(next ?? undefined);
          setError('');
        }
      } catch (reason) {
        if (alive && request === revision.current) setError(capabilityErrorText(reason, zh));
      } finally { reading = false; }
    };
    const timer = window.setInterval(() => void poll(), 350);
    return () => { alive = false; window.clearInterval(timer); };
  }, [active, bridge, plugin.id, plugin.ref, running, state?.operationId, zh]);
  useEffect(() => {
    if (!state?.operationId || tracked.current !== state.operationId || running) return;
    tracked.current = undefined;
    finished.current(state);
  }, [state, running]);
  useLayoutEffect(() => {
    const element = dialog.current;
    if (!open || !active || !element) return;
    element.showModal();
    return () => {
      element.close();
      const trigger = returnFocus.current;
      if (trigger?.isConnected && !trigger.disabled) trigger.focus({ preventScroll: true });
      else anchor.current?.focus({ preventScroll: true });
    };
  }, [open, active]);
  const request = async (action: () => Promise<PluginReloadState>) => {
    if (requesting.current) return;
    const token = ++revision.current;
    requesting.current = true; setChecking(true); setError('');
    try {
      const next = await action();
      if (token === revision.current) {
        tracked.current = next.operationId;
        setState(next);
      }
    } catch (reason) {
      if (token === revision.current) {
        const message = capabilityErrorText(reason, zh);
        setError(message); onError?.(message);
      }
    } finally {
      if (token === revision.current) { requesting.current = false; setChecking(false); }
    }
  };
  const show = (button: HTMLButtonElement) => { returnFocus.current = button; setOpen(true); };
  const sessions = state?.sessions ?? [], phases = sessions.map(instancePhase);
  const ready = phases.filter(phase => phase === 'idle').length;
  const loaded = phases.filter(phase => phase === 'done').length;
  const failed = phases.filter(phase => phase === 'failed').length;
  const preflight = phases.every(phase => ['idle', 'occupied', 'unknown'].includes(phase)) && running;
  const canCancel = sessions.some(item => item.phase === 'waiting' || item.phase === 'ready');
  const count = preflight ? t(`${ready}/${sessions.length} 可立即加载`, `${ready}/${sessions.length} ready`)
    : t(`${loaded}/${sessions.length} 已加载${failed ? `，${failed} 个失败` : ''}`,
      `${loaded}/${sessions.length} loaded${failed ? `, ${failed} failed` : ''}`);
  const details = t(`查看 ${plugin.name} 的重载详情`, `View reload details for ${plugin.name}`);
  const phaseLabel = (item: PluginReloadSession) => item.phase === 'ready' ? t('可立即加载', 'Ready to load')
    : item.phase === 'applying' ? t('正在加载', 'Loading') : item.phase === 'applied' ? t('已加载', 'Loaded')
      : item.reason ? pluginReloadReason(item.reason, zh) : t('已取消', 'Cancelled');
  return <>
    <span className="pc-reload">
      <button ref={anchor} type="button" className="icon-button pc-reload-trigger"
        disabled={!running && disabled} aria-disabled={!running && checking ? true : undefined}
        aria-label={t(`重载 ${plugin.name}`, `Reload ${plugin.name}`)}
        data-tooltip={running ? details : disabledReason ?? t('重载插件', 'Reload plugin')} title={!running ? disabledReason : undefined}
        aria-haspopup={running ? 'dialog' : undefined} aria-expanded={running ? open : undefined}
        onClick={event => running ? show(event.currentTarget) : void request(() => bridge.pluginReloadStart({ id: plugin.id, ref: plugin.ref }))}>
        {checking && !running ? <LoaderCircle size={14} className="pc-spin"/> : <RotateCcw size={14}/>}
      </button>
      <button className="icon-button pc-reload-status" type="button" aria-label={details} aria-description={sessions.length ? count : undefined}
        data-tooltip={sessions.length ? count : details} aria-haspopup="dialog" aria-expanded={open}
        disabled={!state} data-empty={!state || undefined} onClick={event => show(event.currentTarget)}>
        {sessions.length ? <PluginInstanceRing phases={phases} language={language}/> : <Info size={14}/>}
      </button>
    </span>
    {open && active && createPortal(<dialog ref={dialog} id={id} className="pc-dialog pc-reload-dialog"
      aria-labelledby={`${id}-title`} onCancel={event => { event.preventDefault(); setOpen(false); }}>
      <header><h2 id={`${id}-title`}>{t(`重载 ${plugin.name}`, `Reload ${plugin.name}`)}</h2>
        <button type="button" className="icon-button" aria-label={t('关闭重载详情', 'Close reload details')} onClick={() => setOpen(false)}><X size={16}/></button></header>
      {error && <p className="pc-reload-error" role="alert">{error}</p>}
      {!sessions.length ? <p>{t('没有可重载的运行实例。', 'No running instances to reload.')}</p>
        : <CapabilityDisclosure className="pc-reload-instances" label={<span className="pc-reload-heading">
          <span>{t('运行实例', 'Running instances')}</span><PluginInstanceRing phases={phases} language={language}/>
          <span key={count} className="lc-instance-count" role="status">{count}</span>
        </span>}>
          <ul className="pc-reload-sessions">{sessions.map(item => <li key={item.runtimeId}>
            <div><strong>{item.name}</strong><small data-phase={item.phase}>{phaseLabel(item)}</small></div>
            {item.sessionId && onSession && <button type="button" className="icon-button"
              aria-label={t(`查看会话 ${item.name}`, `View session ${item.name}`)} data-tooltip={t('查看会话', 'View session')}
              onClick={() => { setOpen(false); onSession(item.sessionId!); }}><ArrowUpRight size={14}/></button>}
          </li>)}</ul>
        </CapabilityDisclosure>}
      {canCancel && state?.operationId && <footer><button type="button" disabled={checking}
        onClick={() => void request(() => bridge.pluginReloadCancel({ id: plugin.id, operationId: state.operationId! }))}>
        {t('取消等待', 'Cancel waiting')}</button></footer>}
    </dialog>, document.body)}
  </>;
}
