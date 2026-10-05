import { useRef, useState } from 'react';
import { Columns2 } from 'lucide-react';
import { DisclosureChevron } from './DisclosureChevron';
import './right-panel-width-control.css';

export type RightPanelWidth = 'standard' | 'wide' | 'fullscreen';

export function RightPanelWidthControl({ value, language, panel, onChange, onError }: {
  value: RightPanelWidth;
  language: 'zh' | 'en';
  panel: 'browser' | 'terminal';
  onChange: (value: RightPanelWidth) => void;
  onError?: (message: string) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const zh = language === 'zh';
  const title = panel === 'browser' ? (zh ? '浏览器宽度' : 'Browser width') : (zh ? '终端宽度' : 'Terminal width');
  const label = value === 'fullscreen' ? (zh ? '全屏' : 'Fullscreen')
    : value === 'wide' ? (zh ? '宽幅' : 'Wide') : (zh ? '标准' : 'Standard');
  const choose = async () => {
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
  return <button ref={trigger} type="button" className={`right-panel-width-control${zh ? ' is-zh' : ''}`}
    aria-label={title} aria-haspopup="menu" aria-expanded={menuOpen} data-width={value} onClick={() => void choose()}>
    <Columns2 className="right-panel-width-icon" size={14} aria-hidden="true"/>
    <span>{label}</span>
    <span className="right-panel-width-chevron"><DisclosureChevron/></span>
  </button>;
}
