import { Maximize2, Minimize2 } from 'lucide-react';

export function RightPanelExpandButton({ expanded, language, onToggle }: {
  expanded: boolean; language: 'zh' | 'en'; onToggle: () => void;
}) {
  const label = language === 'zh' ? expanded ? '还原侧栏' : '全屏查看' : expanded ? 'Restore sidebar' : 'Expand view';
  return <button type="button" className="icon-button" aria-label={label} aria-pressed={expanded}
    data-tooltip={label} onClick={onToggle}>
    {expanded ? <Minimize2 size={15}/> : <Maximize2 size={15}/>}
  </button>;
}
