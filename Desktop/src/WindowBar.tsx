import { useEffect, useState } from 'react';
import { Minus, Square, Copy, X } from 'lucide-react';

export function WindowBar({ language }: { language: 'zh' | 'en' }) {
  const [maximized, setMaximized] = useState(false);
  const [focused, setFocused] = useState(true);
  const zh = language === 'zh';
  const bridge = window.desktop;
  useEffect(() => {
    let active = true;
    void bridge?.windowControl('state').then(state => { if (active) setMaximized(state.maximized); }).catch(() => {});
    const unsubscribe = bridge?.onEvent(event => {
      if (event.type === 'desktop_window_state') { setMaximized(event.maximized); setFocused(event.focused); }
    });
    return () => { active = false; unsubscribe?.(); };
  }, []);
  const control = (action: 'minimize' | 'toggleMaximize' | 'close') => {
    void bridge?.windowControl(action).then(state => setMaximized(state.maximized)).catch(() => {});
  };
  return <header className={`window-bar ${focused ? '' : 'window-inactive'}`}>
    <div className="window-identity"><img src="./StepCode.svg" width="22" height="22" alt=""/><span>Desktop for Step Code</span><span className="window-edition">Community</span></div>
    <div className="window-drag-space"/>
    <div className="window-controls">
      <button type="button" title={zh ? '最小化' : 'Minimize'} aria-label={zh ? '最小化' : 'Minimize'} onClick={() => control('minimize')}><Minus size={15}/></button>
      <button type="button" title={maximized ? zh ? '还原窗口' : 'Restore window' : zh ? '最大化' : 'Maximize'} aria-label={maximized ? zh ? '还原窗口' : 'Restore window' : zh ? '最大化' : 'Maximize'} onClick={() => control('toggleMaximize')}>{maximized ? <Copy size={12}/> : <Square size={12}/>}</button>
      <button type="button" className="window-close" title={zh ? '关闭窗口' : 'Close window'} aria-label={zh ? '关闭窗口' : 'Close window'} onClick={() => control('close')}><X size={16}/></button>
    </div>
  </header>;
}
