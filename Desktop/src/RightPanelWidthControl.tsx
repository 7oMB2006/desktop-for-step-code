import { useCallback, useRef, useState } from 'react';
import { Columns2, Maximize2, PanelRight } from 'lucide-react';
import { DisclosureChevron } from './DisclosureChevron';
import { AppMenu } from './AppMenu';
import './right-panel-width-control.css';

export type RightPanelWidth = 'standard' | 'wide' | 'fullscreen';

export function RightPanelWidthControl({ value, language, panel, onChange, onError }: {
  value: RightPanelWidth;
  language: 'zh' | 'en';
  panel: 'browser' | 'terminal' | 'file';
  onChange: (value: RightPanelWidth) => void;
  onError?: (message: string) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const zh = language === 'zh';
  const closeMenu = useCallback(() => setMenuOpen(false), []);
  const title = panel === 'browser' ? (zh ? '浏览器宽度' : 'Browser width') : panel === 'terminal' ? (zh ? '终端宽度' : 'Terminal width') : (zh ? '文件预览宽度' : 'File preview width');
  const label = value === 'fullscreen' ? (zh ? '全屏' : 'Fullscreen')
    : value === 'wide' ? (zh ? '宽幅' : 'Wide') : (zh ? '标准' : 'Standard');
  const choose = async () => {
    if (panel === 'file') { setMenuOpen(current => !current); return; }
    const button = trigger.current;
    if (!button || !window.desktop || menuOpen) return;
    const rect = button.getBoundingClientRect();
    setMenuOpen(true);
    try {
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
      const selected = await window.desktop.rightPanelWidthMenu(value, { x: rect.left, y: rect.bottom });
      if (selected) onChange(selected);
    } catch {
      onError?.(zh ? '无法打开宽度菜单，请重试' : 'Could not open the width menu. Retry.');
    } finally {
      setMenuOpen(false);
    }
  };
  return <><button ref={trigger} type="button" className={`right-panel-width-control${zh ? ' is-zh' : ''}`}
    aria-label={title} aria-haspopup="menu" aria-expanded={menuOpen} data-width={value} onClick={() => void choose()}>
    <Columns2 className="right-panel-width-icon" size={14} aria-hidden="true"/>
    <span>{label}</span>
    <span className="right-panel-width-chevron"><DisclosureChevron/></span>
  </button>{panel === 'file' && <AppMenu anchor={trigger} open={menuOpen} label={title} selected={value} onClose={closeMenu}
    items={[{ id: 'standard', label: zh ? '标准' : 'Standard', icon: <PanelRight/> },
      { id: 'wide', label: zh ? '宽幅' : 'Wide', icon: <Columns2/> },
      { id: 'fullscreen', label: zh ? '全屏' : 'Fullscreen', icon: <Maximize2/> }]}
    onSelect={id => onChange(id as RightPanelWidth)}/>}</>;
}
