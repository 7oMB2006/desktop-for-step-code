import { useEffect, useRef, useState } from 'react';
import { Minus, Square, Copy, X, PanelLeft } from 'lucide-react';

export type WindowMenu = { id: string; label: string; items: { label: string; action: () => void; disabled?: boolean }[] };

export function WindowBar({ language, sidebarVisible, toggleSidebar, menus, sessionTitle, onMenuOpenChange }: { language: 'zh' | 'en'; sidebarVisible: boolean; toggleSidebar: () => void; menus: WindowMenu[]; sessionTitle?: string; onMenuOpenChange?: (open: boolean) => void }) {
  const [maximized, setMaximized] = useState(false);
  const [focused, setFocused] = useState(true);
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const zh = language === 'zh';
  const bridge = window.desktop;
  useEffect(() => { onMenuOpenChange?.(Boolean(openMenu)); }, [openMenu, onMenuOpenChange]);
  useEffect(() => {
    let active = true;
    void bridge?.windowControl('state').then(state => { if (active) setMaximized(state.maximized); }).catch(() => {});
    const unsubscribe = bridge?.onEvent(event => {
      if (event.type === 'desktop_window_state') { setMaximized(event.maximized); setFocused(event.focused); }
    });
    return () => { active = false; unsubscribe?.(); };
  }, []);
  useEffect(() => {
    if (!openMenu) return;
    const outside = (event: PointerEvent) => { if (!menuRef.current?.contains(event.target as Node)) setOpenMenu(null); };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); setOpenMenu(null); menuRef.current?.querySelector<HTMLButtonElement>(`[data-menu="${openMenu}"]`)?.focus(); }
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); };
  }, [openMenu]);
  const control = (action: 'minimize' | 'toggleMaximize' | 'close') => {
    setOpenMenu(null);
    void bridge?.windowControl(action).then(state => setMaximized(state.maximized)).catch(() => {});
  };
  return <header className={`window-bar ${focused ? '' : 'window-inactive'}`}>
    <div className="window-tools" ref={menuRef}>
      <button type="button" className="window-sidebar-toggle" data-tooltip={zh ? '侧栏' : 'Sidebar'} aria-label={zh ? '侧栏' : 'Sidebar'} aria-expanded={sidebarVisible} onClick={() => { setOpenMenu(null); toggleSidebar(); }}><PanelLeft size={18}/></button>
      <nav className="window-menu-list" aria-label={zh ? '应用菜单' : 'Application menu'}>
        {menus.map(menu => <div className="window-menu" key={menu.id}>
          <button type="button" data-menu={menu.id} aria-haspopup="menu" aria-expanded={openMenu === menu.id} className={openMenu === menu.id ? 'active' : ''} onClick={() => setOpenMenu(current => current === menu.id ? null : menu.id)} onMouseEnter={() => { if (openMenu && openMenu !== menu.id) setOpenMenu(menu.id); }}>{menu.label}</button>
          {openMenu === menu.id && <div className="window-menu-popover" role="menu" aria-label={menu.label} onKeyDown={event => {
            if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
            event.preventDefault();
            const items = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
            const index = items.indexOf(document.activeElement as HTMLButtonElement);
            items[(index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
          }}>
            {menu.items.map(item => <button type="button" role="menuitem" key={item.label} disabled={item.disabled} onClick={() => { setOpenMenu(null); item.action(); }}>{item.label}</button>)}
          </div>}
        </div>)}
      </nav>
    </div>
    <div className="window-drag-space">{sessionTitle && <span className="window-session-title" data-tooltip={sessionTitle}>{sessionTitle}</span>}</div>
    <div className="window-controls">
      <button type="button" data-tooltip={zh ? '最小化' : 'Minimize'} aria-label={zh ? '最小化' : 'Minimize'} onClick={() => control('minimize')}><Minus size={15}/></button>
      <button type="button" data-tooltip={maximized ? zh ? '还原窗口' : 'Restore window' : zh ? '最大化' : 'Maximize'} aria-label={maximized ? zh ? '还原窗口' : 'Restore window' : zh ? '最大化' : 'Maximize'} onClick={() => control('toggleMaximize')}>{maximized ? <Copy size={12}/> : <Square size={12}/>}</button>
      <button type="button" className="window-close" data-tooltip={zh ? '关闭窗口' : 'Close window'} aria-label={zh ? '关闭窗口' : 'Close window'} onClick={() => control('close')}><X size={16}/></button>
    </div>
  </header>;
}
