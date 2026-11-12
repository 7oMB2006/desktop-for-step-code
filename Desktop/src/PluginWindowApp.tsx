import { useCallback, useEffect, useRef, useState } from 'react';
import { CircleAlert, RotateCcw } from 'lucide-react';
import { AppTooltip } from './AppTooltip';
import { WindowBar } from './WindowBar';
import { PluginWorkspace } from './PluginWorkspace';
import { applyTheme } from './theme';
import { applyAppearance } from './appearance';
import { getPluginDesktopEntries, type PluginDesktopEntry } from './plugin-desktop';
import type { DesktopBridge, PluginWindowSnapshot } from './contracts';
import './plugin-window.css';

type PluginWindowBridge = Pick<DesktopBridge, 'pluginWindowState' | 'pluginWindowConfigure' | 'pluginDocument' | 'onEvent' | 'windowControl'>;

export function PluginWindowApp({ bridge = window.desktop }: { bridge?: PluginWindowBridge }) {
  const [entry, setEntry] = useState<PluginDesktopEntry>();
  const [preferences, setPreferences] = useState<PluginWindowSnapshot['preferences']>({
    language: 'zh', theme: window.desktopTheme?.preference ?? window.desktopTheme?.resolved ?? 'system',
  });
  const [systemDark, setSystemDark] = useState(window.desktopTheme?.systemDark ?? false);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [actionError, setActionError] = useState(false);
  const mounted = useRef(false);
  const sequence = useRef(0);
  const zh = preferences.language === 'zh';
  const refresh = useCallback(async (preserve = false) => {
    const request = ++sequence.current;
    if (!preserve) { setEntry(undefined); setLoading(true); }
    setFailed(false); setActionError(false);
    try {
      if (!bridge) throw new Error('Unavailable');
      const snapshot = await bridge.pluginWindowState();
      if (!mounted.current || request !== sequence.current) return;
      const available = getPluginDesktopEntries({
        plugins: [snapshot.plugin], available: [], marketplaces: [], mcp: [], skills: [], warnings: [],
      })[0];
      if (!available || available.desktop.surface !== 'window') throw new Error('Unavailable');
      setPreferences(snapshot.preferences);
      setEntry(available);
    } catch {
      if (mounted.current && request === sequence.current) { setEntry(undefined); setFailed(true); }
    } finally {
      if (mounted.current && request === sequence.current) setLoading(false);
    }
  }, [bridge]);
  useEffect(() => {
    mounted.current = true;
    let queued = false;
    let preserveQueued = true;
    const schedule = (preserve = false) => {
      preserveQueued = preserveQueued && preserve;
      if (queued) return;
      queued = true;
      queueMicrotask(() => {
        const keep = preserveQueued;
        queued = false; preserveQueued = true;
        if (mounted.current) void refresh(keep);
      });
    };
    const unsubscribe = bridge?.onEvent(event => {
      if (event.type === 'desktop_system_theme') {
        setSystemDark(Boolean(event.dark));
        schedule(true);
      } else if (event.type === 'desktop_plugin_catalog_changed') schedule();
      else if (event.type === 'desktop_plugin_preferences_changed') schedule(true);
    });
    void refresh();
    return () => { mounted.current = false; sequence.current++; unsubscribe?.(); };
  }, [bridge, refresh]);
  useEffect(() => {
    applyTheme(preferences.theme, systemDark, preferences.accentColor);
    applyAppearance(preferences.appearance);
    document.documentElement.lang = zh ? 'zh-CN' : 'en';
  }, [preferences, systemDark, zh]);
  useEffect(() => {
    if (entry) document.title = entry.desktop.title;
    if (!loading) window.dispatchEvent(new Event('desktop-shell-ready'));
  }, [entry, loading]);
  const configure = () => {
    setActionError(false);
    void bridge?.pluginWindowConfigure().catch(() => { if (mounted.current) setActionError(true); });
  };
  return <div className={`app plugin-window-shell sidebar-hidden${window.desktop?.platform === 'darwin' ? ' platform-macos' : ''}`}>
    <WindowBar language={preferences.language} sidebarVisible={false} showSidebarToggle={false}
      toggleSidebar={() => {}} menus={[]} sessionTitle={entry?.desktop.title ?? (zh ? '插件' : 'Plugin')}/>
    {loading ? <div className="plugin-window-loading" role="status" aria-label={zh ? '正在读取插件' : 'Loading plugin'} aria-busy="true">
      <span/><span/><span/>
    </div> : failed || !entry || !bridge ? <div className="plugin-window-unavailable" role="alert">
      <CircleAlert size={24}/>
      <h1>{zh ? '插件暂不可用' : 'Plugin unavailable'}</h1>
      <p>{zh ? '请重试。若插件已更新，请关闭此窗口，从主窗口重新打开；已卸载的插件需重新安装。' : 'Retry. If the plugin was updated, close this window and reopen it from the main window. Removed plugins must be installed again.'}</p>
      <button type="button" onClick={() => void refresh()}><RotateCcw size={15}/>{zh ? '重新读取' : 'Retry'}</button>
    </div> : <div className="plugin-window-content">
      {actionError && <div className="plugin-window-action-error" role="alert">
        <CircleAlert size={15}/><span>{zh ? '操作未完成，请重试。' : 'The action could not be completed. Please retry.'}</span>
      </div>}
      <PluginWorkspace key={`${entry.id}:${entry.plugin.package!.ref}`} entry={entry} bridge={bridge} language={preferences.language}
        onConfigure={configure} closeLabel={zh ? '关闭插件窗口' : 'Close plugin window'}
        onClose={() => { void bridge.windowControl('close').catch(() => { if (mounted.current) setActionError(true); }); }}/>
    </div>}
    <AppTooltip/>
  </div>;
}
