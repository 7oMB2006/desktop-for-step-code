import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Columns2, ExternalLink, Globe, LockKeyhole, Plus, RotateCw, X, ZoomIn, ZoomOut } from 'lucide-react';
import type { BrowserAction, BrowserSnapshot } from './contracts';
import { RightPanelExpandButton } from './RightPanelExpandButton';
import { RightPanelWidthControl } from './RightPanelWidthControl';
import './browser-panel.css';

const empty: BrowserSnapshot = { revision: -1, tabs: [] };

export function BrowserPanel({ open, replaced, overlay, expanded, blocked, language, onClose, onToggleExpanded }: {
  open: boolean; replaced: boolean; overlay: boolean; expanded: boolean; blocked: boolean; language: 'zh' | 'en';
  onClose: () => void; onToggleExpanded: () => void;
}) {
  const [snapshot, setSnapshot] = useState(empty);
  const [address, setAddress] = useState('');
  const [error, setError] = useState('');
  const [present, setPresent] = useState(open);
  const [pending, setPending] = useState(false);
  const [width, setWidth] = useState<'standard' | 'wide'>('standard');
  const host = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const initialized = useRef(false);
  const latest = useRef({ open, blocked });
  latest.current = { open, blocked };
  const zh = language === 'zh';
  const t = (cn: string, en: string) => zh ? cn : en;
  const selected = snapshot.tabs.find(tab => tab.id === snapshot.activeId);
  const shownAddress = selected?.localFile ?? (selected?.url === 'about:blank' ? '' : selected?.url ?? '');
  if (open && !present) setPresent(true);
  const accept = (next: BrowserSnapshot) => setSnapshot(previous => next.revision >= previous.revision ? next : previous);
  const focusAddress = () => {
    if (!latest.current.open || latest.current.blocked) return;
    requestAnimationFrame(() => { input.current?.focus(); input.current?.select(); });
  };
  const run = async (operation: () => Promise<BrowserSnapshot>) => {
    try { setError(''); accept(await operation()); }
    catch { setError(t('浏览器操作失败，请检查地址后重试', 'Browser operation failed. Check the address and retry.')); }
  };
  const create = async () => {
    if (!window.desktop || pending) return;
    setPending(true);
    await run(() => window.desktop!.browserCreate());
    setPending(false);
    focusAddress();
  };
  const action = (kind: BrowserAction, value?: string) => {
    if (selected && window.desktop) void run(() => window.desktop!.browserAction(selected.id, kind, value));
  };
  useEffect(() => {
    const bridge = window.desktop;
    if (!bridge) return;
    let live = true;
    const unsubscribe = bridge.onBrowserEvent(event => {
      if (event.type === 'snapshot') accept(event.snapshot);
      else focusAddress();
    });
    void bridge.browserList().then(value => { if (live) accept(value); }).catch(() => {});
    return () => { live = false; unsubscribe(); void bridge.browserLayout(null).catch(() => {}); };
  }, []);
  useEffect(() => {
    if (!open || initialized.current || !window.desktop) return;
    initialized.current = true;
    void window.desktop.browserList().then(value => {
      accept(value);
      if (!value.tabs.length) return create();
    }).catch(() => { initialized.current = false; setError(t('无法打开浏览器', 'Could not open browser')); });
  }, [open]);
  useEffect(() => {
    if (document.activeElement !== input.current) setAddress(shownAddress);
  }, [selected?.id, shownAddress]);
  useEffect(() => {
    setError('');
    setAddress(shownAddress);
    if (open && selected?.url === 'about:blank') focusAddress();
  }, [selected?.id, open]);
  useLayoutEffect(() => {
    const bridge = window.desktop;
    if (!bridge) return;
    // Native web content cannot follow the shell's CSS opacity on exit.
    if (!open || replaced || blocked) { void bridge.browserLayout(null).catch(() => {}); return; }
    let frame = 0;
    let previous = '';
    const measure = () => {
      const rect = host.current?.getBoundingClientRect();
      const bounds = rect && rect.width >= 1 && rect.height >= 1
        ? { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) } : null;
      const key = JSON.stringify(bounds);
      if (key !== previous) {
        previous = key;
        void bridge.browserLayout(bounds).catch(() => {});
      }
      frame = requestAnimationFrame(measure);
    };
    measure();
    return () => { cancelAnimationFrame(frame); void bridge.browserLayout(null).catch(() => {}); };
  }, [open, replaced, blocked]);
  useEffect(() => {
    if (open || !present) return;
    const timer = setTimeout(() => setPresent(false), matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 260);
    return () => clearTimeout(timer);
  }, [open, present]);
  useEffect(() => {
    if (!open || blocked) return;
    const keyboard = (event: KeyboardEvent) => {
      if (!event.ctrlKey || event.altKey || event.metaKey || !host.current?.parentElement?.contains(event.target as Node)) return;
      if (event.key.toLowerCase() === 'l') { event.preventDefault(); focusAddress(); }
      else if (event.key.toLowerCase() === 't') { event.preventDefault(); if (snapshot.tabs.length < 12) void create(); }
    };
    window.addEventListener('keydown', keyboard);
    return () => window.removeEventListener('keydown', keyboard);
  }, [open, blocked, snapshot.tabs.length, pending]);
  const label = (title: string, en: string) => ({ 'aria-label': t(title, en), 'data-tooltip': t(title, en) });
  const chooseWidth = (value: 'standard' | 'wide' | 'fullscreen') => {
    if (!latest.current.open || latest.current.blocked) return;
    if (value === 'standard' || value === 'wide') setWidth(value);
    if ((value === 'fullscreen') !== expanded) onToggleExpanded();
  };
  return <div className={`browser-track${open ? ' is-open' : ''}${!open && present ? ' is-closing' : ''}${width === 'wide' ? ' is-wide' : ''}${overlay ? ' is-overlay' : ''}${replaced ? ' is-replaced' : ''}`}>
    <aside id="browser-panel" className={`browser-panel right-inspector-surface${expanded ? ' is-expanded' : ''}${open ? '' : ' is-closing'}`}
      style={{ visibility: present && !replaced ? undefined : 'hidden' }} aria-label={t('浏览器', 'Browser')} aria-hidden={!open} inert={!open}>
      <header className="right-panel-header"><h2>{t('浏览器', 'Browser')}</h2>
        <RightPanelWidthControl panel="browser" language={language} value={expanded ? 'fullscreen' : width} onChange={chooseWidth}
          onError={setError}/>
        <RightPanelExpandButton expanded={expanded} language={language} onToggle={onToggleExpanded}/>
        <button className="icon-button" aria-label={t('关闭浏览器面板', 'Close browser panel')} onClick={onClose}><X size={16}/></button>
      </header>
      <div className="browser-tabs" role="tablist" aria-label={t('网页标签', 'Browser tabs')}>
        {snapshot.tabs.map(tab => <div className={`browser-tab${tab.id === selected?.id ? ' is-active' : ''}`} key={tab.id}>
          <button role="tab" aria-selected={tab.id === selected?.id} aria-controls="browser-page" title={tab.title || tab.url}
            onClick={() => void run(() => window.desktop!.browserSelect(tab.id))}>
            <Globe size={12}/><span>{tab.title || (tab.url === 'about:blank' ? t('新标签页', 'New tab') : tab.url)}</span>
          </button>
          <button className="icon-button" aria-label={`${t('关闭标签', 'Close tab')} ${tab.title || tab.url}`}
            onClick={() => void run(() => window.desktop!.browserClose(tab.id))}><X size={12}/></button>
        </div>)}
        <button className="icon-button" {...label('新建标签页', 'New tab')} disabled={pending || snapshot.tabs.length >= 12}
          onClick={() => void create()}><Plus size={16}/></button>
      </div>
      <form className={`browser-addressbar${selected?.loading ? ' is-loading' : ''}`} onSubmit={event => { event.preventDefault(); if (address === selected?.localFile) action('reload'); else action('navigate', address); input.current?.blur(); }}>
        <button type="button" className="icon-button" {...label('后退', 'Back')} disabled={!selected?.canGoBack} onClick={() => action('back')}><ArrowLeft size={16}/></button>
        <button type="button" className="icon-button" {...label('前进', 'Forward')} disabled={!selected?.canGoForward} onClick={() => action('forward')}><ArrowRight size={16}/></button>
        <button type="button" className="icon-button" {...label(selected?.loading ? '停止加载' : '刷新', selected?.loading ? 'Stop loading' : 'Reload')}
          disabled={!selected || selected.url === 'about:blank'} onClick={() => action(selected?.loading ? 'stop' : 'reload')}>
          {selected?.loading ? <X size={15}/> : <RotateCw size={15}/>}
        </button>
        <div className="browser-address-field">
          {selected?.url.startsWith('https:') ? <LockKeyhole size={13}/> : <Globe size={13}/>}
          <input ref={input} aria-label={t('网页地址', 'Web address')} placeholder={t('输入网址或 localhost:端口', 'URL or localhost:port')}
            value={address} spellCheck={false} onChange={event => setAddress(event.target.value)}
            onFocus={event => event.target.select()} onKeyDown={event => {
              if (event.key === 'Escape') { event.stopPropagation(); setAddress(shownAddress); event.currentTarget.blur(); }
            }}/>
        </div>
        <button type="button" className="icon-button" {...label('在系统浏览器打开', 'Open in system browser')}
          disabled={!selected || selected.url === 'about:blank'} onClick={() => action('external')}><ExternalLink size={15}/></button>
      </form>
      {error && <p className="browser-action-error" role="alert">{error}</p>}
      <div className="browser-page" ref={host} id="browser-page" role="tabpanel">
        {(!selected || selected.url === 'about:blank' || selected.error) && <div className="browser-empty">
          <Globe size={28} strokeWidth={1.3}/>
          <p>{selected?.error ? t('网页无法加载', 'Could not load page') : t('新标签页', 'New tab')}</p>
          {selected?.error && <><span>{selected.error}</span><button onClick={() => action('reload')}>{t('重新加载', 'Reload')}</button></>}
        </div>}
      </div>
      <footer className="browser-footer"><span>{selected?.loading ? t('加载中', 'Loading') : selected?.error ? t('加载失败', 'Load failed') : selected?.localFile ? t('本地预览', 'Local preview') : t('就绪', 'Ready')}</span>
        <button className="icon-button" {...label('缩小网页', 'Zoom out')} disabled={!selected || selected.zoom <= .5} onClick={() => action('zoomOut')}><ZoomOut size={13}/></button>
        <button className="browser-zoom" {...label('重置缩放', 'Reset zoom')} disabled={!selected} onClick={() => action('zoomReset')}>{Math.round((selected?.zoom ?? 1) * 100)}%</button>
        <button className="icon-button" {...label('放大网页', 'Zoom in')} disabled={!selected || selected.zoom >= 2} onClick={() => action('zoomIn')}><ZoomIn size={13}/></button>
      </footer>
    </aside>
  </div>;
}
