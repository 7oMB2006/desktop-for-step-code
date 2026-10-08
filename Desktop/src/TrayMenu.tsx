import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { TrayMenuBridge } from './tray-menu-contract';
import './style.css';
import './app-menu.css';
import './tray-menu.css';

declare global { interface Window { desktopTray: TrayMenuBridge } }
const bridge = window.desktopTray;
const initial = bridge.state();
document.documentElement.dataset.theme = initial.theme;

function TrayMenu() {
  const [state, setState] = useState(initial);
  const [visible, setVisible] = useState(false);
  const menu = useRef<HTMLDivElement>(null);
  useEffect(() => bridge.onState(setState), []);
  useLayoutEffect(() => {
    document.documentElement.dataset.theme = state.theme;
    document.documentElement.lang = state.language === 'zh' ? 'zh-CN' : 'en';
    if (!state.visible) { setVisible(false); return; }
    const frame = requestAnimationFrame(() => {
      setVisible(true);
      menu.current?.querySelector<HTMLButtonElement>('button')?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [state]);
  const zh = state.language === 'zh';
  return <div className="tray-menu-root" onPointerDown={event => {
    if (event.target === event.currentTarget) bridge.action('dismiss');
  }}>
    <div ref={menu} className="app-menu tray-menu" role="menu" aria-label={zh ? '托盘菜单' : 'Tray menu'}
      data-visible={visible} inert={!state.visible} style={{ transformOrigin: state.origin }}
      onKeyDown={event => {
        const items = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button')];
        const index = items.indexOf(document.activeElement as HTMLButtonElement);
        if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
          event.preventDefault();
          items[event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1
            : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
        } else if (['Escape', 'Tab'].includes(event.key)) {
          event.preventDefault(); bridge.action('dismiss');
        }
      }}>
      <button type="button" role="menuitem" onClick={() => bridge.action('open')}>
        <span className="app-menu-label">{zh ? '打开 Desktop for Step Code' : 'Open Desktop for Step Code'}</span>
      </button>
      <div className="tray-menu-separator" role="separator"/>
      <button type="button" role="menuitem" onClick={() => bridge.action('quit')}>
        <span className="app-menu-label">{zh ? '退出应用' : 'Quit application'}</span>
      </button>
    </div>
  </div>;
}
createRoot(document.getElementById('root')!).render(<TrayMenu/>);
