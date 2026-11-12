import { useEffect, useId, useRef, useState } from 'react';
import { ArrowLeft, Settings, X } from 'lucide-react';
import type { DesktopBridge } from './contracts';
import { PluginDocumentReader } from './PluginDocumentation';
import { PluginDesktopIcon } from './PluginActionGroup';
import { PluginConnectionPanel, type PluginConnectionBridge } from './PluginConnectionPanel';
import { pluginDesktopDefaultPage, type PluginDesktopEntry } from './plugin-desktop';
import './plugin-center.css';
import './plugin-workspace.css';

export function PluginWorkspace({ entry, bridge, language, onBack, onClose, closeLabel, onConfigure, active = true }: {
  entry: PluginDesktopEntry; bridge: Pick<DesktopBridge, 'pluginDocument'> & PluginConnectionBridge; language: 'zh' | 'en';
  onBack?: () => void; onClose?: () => void; closeLabel?: string; onConfigure?: () => void; active?: boolean;
}) {
  const connected = entry.desktop.connection?.protocol === 'agent-bridge-v1';
  const initialPage = connected ? 'connection' : pluginDesktopDefaultPage(entry.desktop).id;
  const [selected, setSelected] = useState(initialPage);
  const [visited, setVisited] = useState(() => new Set([initialPage]));
  const tabs = useRef<HTMLElement>(null);
  const workspace = useRef<HTMLElement>(null);
  const lastFocused = useRef<HTMLElement | null>(null);
  const id = useId();
  const zh = language === 'zh';
  const pages = [...(connected ? [{ id: 'connection', title: zh ? '连接' : 'Connection', document: '' }] : []), ...entry.desktop.pages];
  const page = pages.find(item => item.id === selected) ?? pages[0];
  useEffect(() => {
    setVisited(value => value.has(page.id) ? value : new Set([...value, page.id]));
  }, [page.id]);
  useEffect(() => {
    if (!active) return;
    const frame = requestAnimationFrame(() => {
      const element = workspace.current;
      if (!element || element.closest('[hidden], [inert]')) return;
      const previous = lastFocused.current;
      const target = previous?.isConnected && element.contains(previous) && previous.getClientRects().length
        && !previous.matches(':disabled') && !previous.closest('[hidden], [inert]')
        ? previous : tabs.current?.querySelector<HTMLButtonElement>('[aria-selected="true"]');
      target?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [active]);
  const selectPage = (pageId: string) => {
    setVisited(value => value.has(pageId) ? value : new Set([...value, pageId]));
    setSelected(pageId);
  };
  const dismissLabel = closeLabel ?? (zh ? '关闭面板' : 'Close panel');
  return <section ref={workspace} className="plugin-workspace" hidden={!active} inert={!active}
    onFocusCapture={event => { lastFocused.current = event.target; }}
    aria-labelledby={`${id}-title`} data-plugin-workspace={entry.id}>
    <header className="plugin-workspace-header">
      {onBack && <button type="button" className="icon-button" aria-label={zh ? '返回工作区' : 'Back to workspace'}
        data-tooltip={zh ? '返回工作区' : 'Back to workspace'} onClick={onBack}><ArrowLeft size={18}/></button>}
      <PluginDesktopIcon entry={entry} size={24}/>
      <div className="plugin-workspace-identity">
        <h1 id={`${id}-title`}>{entry.desktop.title}</h1>
        {(entry.plugin.version || entry.plugin.name !== entry.desktop.title) && <span>
          {entry.plugin.name !== entry.desktop.title && entry.plugin.name}
          {entry.plugin.name !== entry.desktop.title && entry.plugin.version && ' · '}
          {entry.plugin.version && `v${entry.plugin.version}`}
        </span>}
      </div>
      {onConfigure && <button type="button" className="icon-button" aria-label={zh ? '插件设置' : 'Plugin settings'}
        data-tooltip={zh ? '插件设置' : 'Plugin settings'} onClick={onConfigure}><Settings size={17}/></button>}
      {onClose && <button type="button" className="icon-button" aria-label={dismissLabel}
        data-tooltip={dismissLabel} onClick={onClose}><X size={18}/></button>}
    </header>
    <nav ref={tabs} className="plugin-workspace-tabs" role="tablist" aria-label={entry.desktop.title}
      onKeyDown={event => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const index = pages.findIndex(item => item.id === page.id);
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? pages.length - 1
          : (index + (event.key === 'ArrowRight' ? 1 : -1) + pages.length) % pages.length;
        const target = pages[next];
        selectPage(target.id);
        tabs.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
      }}>
      {pages.map(item => <button type="button" role="tab" key={item.id}
        id={`${id}-tab-${item.id}`} aria-controls={`${id}-page-${item.id}`} aria-selected={item.id === page.id}
        tabIndex={item.id === page.id ? 0 : -1} data-tooltip={item.title} onClick={() => selectPage(item.id)}>
        <span>{item.title}</span>
      </button>)}
    </nav>
    <div className="plugin-workspace-pages">
      {pages.filter(item => visited.has(item.id) || item.id === page.id).map(item => <section key={item.id}
        className="plugin-workspace-page" role="tabpanel" id={`${id}-page-${item.id}`}
        aria-labelledby={`${id}-tab-${item.id}`} hidden={item.id !== page.id} inert={item.id !== page.id} tabIndex={0}>
        {connected && item.id === 'connection' ? <PluginConnectionPanel bridge={bridge} packageRef={entry.plugin.package!.ref}
          language={language} active={active && page.id === 'connection'}
          hasFirstTask={Boolean(entry.desktop.connection?.guides?.firstTask)} onGuide={guide => {
            const target = guide && entry.desktop.connection?.guides?.[guide];
            selectPage(target && entry.desktop.pages.some(item => item.id === target)
              ? target : pluginDesktopDefaultPage(entry.desktop).id);
            requestAnimationFrame(() => {
              if (!workspace.current?.closest('[hidden], [inert]'))
                tabs.current?.querySelector<HTMLButtonElement>('[aria-selected="true"]')?.focus({ preventScroll: true });
            });
          }}/>
          : <div className="plugin-workspace-document">
          <PluginDocumentReader bridge={bridge} language={language} kind="readme"
            pkg={{ ...entry.plugin.package!, documentation: { readme: item.document } }}/>
        </div>}
      </section>)}
    </div>
  </section>;
}
