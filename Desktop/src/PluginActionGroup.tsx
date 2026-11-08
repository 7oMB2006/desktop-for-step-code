import { useCallback, useEffect, useRef, useState } from 'react';
import { BookOpen, Bot, Ellipsis, Plug, Sparkles, Wrench } from 'lucide-react';
import { AppMenu } from './AppMenu';
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

export function PluginActionGroup({ entries, language, activeId, onOpen, maxVisible = 3, onMenuOpenChange }: {
  entries: PluginDesktopEntry[]; language: 'zh' | 'en'; activeId?: string;
  onOpen: (entry: PluginDesktopEntry) => void; maxVisible?: number; onMenuOpenChange?: (open: boolean) => void;
}) {
  const [narrow, setNarrow] = useState(() => matchMedia('(max-width: 900px)').matches);
  const [menu, setMenu] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const closeMenu = useCallback(() => setMenu(false), []);
  useEffect(() => {
    const query = matchMedia('(max-width: 900px)');
    const update = () => setNarrow(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  const { visible, overflow } = pluginActionLayout(entries, narrow, maxVisible);
  useEffect(() => { if (!overflow.length) setMenu(false); }, [overflow.length]);
  useEffect(() => {
    onMenuOpenChange?.(menu && overflow.length > 0);
    return () => onMenuOpenChange?.(false);
  }, [menu, overflow.length, onMenuOpenChange]);
  if (!entries.length) return null;
  const zh = language === 'zh';
  return <div className="plugin-action-group" role="group" aria-label={zh ? '插件快捷入口' : 'Plugin shortcuts'}>
    {visible.map(entry => <button key={entry.id} type="button" className="plugin-action-button"
      data-plugin-action={entry.id} data-tooltip={entry.desktop.title} aria-label={entry.desktop.title}
      aria-pressed={activeId === entry.id} onClick={() => { closeMenu(); onOpen(entry); }}>
      <PluginDesktopIcon entry={entry}/>
    </button>)}
    {overflow.length > 0 && <button ref={trigger} type="button" className="plugin-action-button plugin-action-overflow"
      aria-label={zh ? '更多插件' : 'More plugins'} data-tooltip={zh ? '更多插件' : 'More plugins'}
      aria-haspopup="menu" aria-expanded={menu} data-active={overflow.some(entry => entry.id === activeId) || undefined}
      onClick={() => setMenu(value => !value)}><Ellipsis size={18}/></button>}
    <AppMenu anchor={trigger} open={menu && overflow.length > 0} label={zh ? '更多插件' : 'More plugins'}
      selected={activeId} maxVisibleItems={8} onClose={closeMenu}
      items={overflow.map(entry => ({ id: entry.id, label: entry.desktop.title, icon: <PluginDesktopIcon entry={entry} size={16}/> }))}
      onSelect={id => { const entry = overflow.find(item => item.id === id); if (entry) onOpen(entry); }}/>
  </div>;
}
