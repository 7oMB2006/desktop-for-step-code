import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { BookOpen, Bot, Ellipsis, Plug, Sparkles, Wrench } from 'lucide-react';
import { AppMenu } from './AppMenu';
import { PluginStatusPopover } from './PluginStatusPopover';
import type { PluginConnectionBridge } from './PluginConnectionPanel';
import { pluginActionLayout, pluginDesktopIconUrl, type PluginDesktopEntry } from './plugin-desktop';
import './plugin-action-group.css';

export function PluginDesktopIcon({ entry, size = 17 }: { entry: PluginDesktopEntry; size?: number }) {
  const light = pluginDesktopIconUrl(entry.desktop.icon?.light)
    ?? pluginDesktopIconUrl(entry.plugin.icon?.kind === 'png' ? entry.plugin.icon.dataUrl : undefined);
  const dark = pluginDesktopIconUrl(entry.desktop.icon?.dark);
  const [failed, setFailed] = useState<string[]>([]);
  const Symbol = { plug: Plug, bot: Bot, book: BookOpen, wrench: Wrench, sparkles: Sparkles }[entry.desktop.symbol ?? 'plug'] ?? Plug;
  const variant = (source: string | undefined, theme: 'light' | 'dark') => <span className={`plugin-action-icon-${theme}`}>
    {source && !failed.includes(source)
      ? <img src={source} alt="" width={size} height={size} draggable={false} onError={() => setFailed(value => [...value, source])}/>
      : <Symbol size={size} aria-hidden="true"/>}
  </span>;
  return <span className={`plugin-action-icon${dark ? ' has-dark-icon' : ''}`} style={{ width: size, height: size }} aria-hidden="true">
    {variant(light, 'light')}{dark && variant(dark, 'dark')}
  </span>;
}

export function PluginActionGroup({ entries, language, activeId, onOpen, maxVisible = 3, onMenuOpenChange, bridge, disabled = false }: {
  entries: PluginDesktopEntry[]; language: 'zh' | 'en'; activeId?: string;
  onOpen: (entry: PluginDesktopEntry, toggle?: boolean) => void; maxVisible?: number; onMenuOpenChange?: (open: boolean) => void;
  bridge?: PluginConnectionBridge; disabled?: boolean;
}) {
  const [narrow, setNarrow] = useState(() => matchMedia('(max-width: 900px)').matches);
  const [menu, setMenu] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const group = useRef<HTMLDivElement>(null);
  const statusAnchor = useRef<HTMLButtonElement>(null);
  const [statusSelection, setStatusSelection] = useState<{ id: string; ref: string }>();
  const statusId = useId();
  const statusEntry = !disabled && bridge ? entries.find(entry => entry.id === statusSelection?.id
    && entry.plugin.package?.ref === statusSelection.ref && entry.desktop.connection?.protocol === 'agent-bridge-v1') : undefined;
  const closeMenu = useCallback(() => setMenu(false), []);
  const closeStatus = useCallback(() => setStatusSelection(undefined), []);
  useEffect(() => {
    const query = matchMedia('(max-width: 900px)');
    const update = () => setNarrow(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  const { visible, overflow } = pluginActionLayout(entries, narrow, maxVisible);
  useLayoutEffect(() => {
    if (statusEntry) statusAnchor.current = group.current?.querySelector<HTMLButtonElement>(
      `[data-plugin-action="${CSS.escape(statusEntry.id)}"]`) ?? trigger.current;
  }, [statusEntry, narrow, visible.length]);
  useEffect(() => { if (!statusEntry) closeStatus(); }, [statusEntry, closeStatus]);
  useEffect(() => { if (disabled) closeMenu(); }, [disabled, closeMenu]);
  useEffect(() => { if (!overflow.length) setMenu(false); }, [overflow.length]);
  useEffect(() => {
    onMenuOpenChange?.((menu && overflow.length > 0) || Boolean(statusEntry));
    return () => onMenuOpenChange?.(false);
  }, [menu, overflow.length, statusEntry, onMenuOpenChange]);
  if (!entries.length) return null;
  const zh = language === 'zh';
  const hasStatus = (entry: PluginDesktopEntry) => Boolean(bridge && entry.desktop.connection?.protocol === 'agent-bridge-v1');
  const open = (entry: PluginDesktopEntry, anchor: HTMLButtonElement | null) => {
    closeMenu();
    if (hasStatus(entry)) {
      statusAnchor.current = anchor;
      setStatusSelection(value => value?.id === entry.id ? undefined : { id: entry.id, ref: entry.plugin.package!.ref });
    } else { closeStatus(); onOpen(entry); }
  };
  return <div ref={group} className="plugin-action-group" role="group" aria-label={zh ? '插件快捷入口' : 'Plugin shortcuts'}>
    {visible.map(entry => <button key={entry.id} type="button" className="plugin-action-button" disabled={disabled}
      data-plugin-action={entry.id} data-tooltip={entry.desktop.title} aria-label={entry.desktop.title}
      aria-pressed={hasStatus(entry) || entry.desktop.surface === 'window' ? undefined : activeId === entry.id}
      aria-haspopup={hasStatus(entry) ? 'dialog' : undefined}
      aria-expanded={hasStatus(entry) ? statusEntry?.id === entry.id : undefined}
      aria-controls={hasStatus(entry) ? statusId : undefined}
      onClick={event => open(entry, event.currentTarget)}>
      <PluginDesktopIcon entry={entry}/>
    </button>)}
    {overflow.length > 0 && <button ref={trigger} type="button" className="plugin-action-button plugin-action-overflow" disabled={disabled}
      aria-label={zh ? '更多插件' : 'More plugins'} data-tooltip={zh ? '更多插件' : 'More plugins'}
      aria-haspopup="menu" aria-expanded={menu} data-active={overflow.some(entry => entry.id === (statusEntry?.id ?? activeId)) || undefined}
      onClick={() => { closeStatus(); setMenu(value => !value); }}><Ellipsis size={18}/></button>}
    <AppMenu anchor={trigger} open={menu && overflow.length > 0} label={zh ? '更多插件' : 'More plugins'}
      selected={activeId} maxVisibleItems={8} onClose={closeMenu}
      items={overflow.map(entry => ({ id: entry.id, label: entry.desktop.title, icon: <PluginDesktopIcon entry={entry} size={16}/> }))}
      onSelect={id => { const entry = overflow.find(item => item.id === id); if (entry) open(entry, trigger.current); }}/>
    {statusEntry && bridge && <PluginStatusPopover key={`${statusEntry.id}:${statusEntry.plugin.package!.ref}`}
      id={statusId} entry={statusEntry} anchor={statusAnchor} bridge={bridge} language={language}
      onClose={closeStatus} onOpen={() => onOpen(statusEntry, false)}/>}
  </div>;
}
