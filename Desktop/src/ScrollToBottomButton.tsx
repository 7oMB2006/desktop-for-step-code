import { ArrowDown } from 'lucide-react';

export function ScrollToBottomButton({ language, onClick }: { language: 'zh' | 'en'; onClick: () => void }) {
  const label = language === 'zh' ? '回到底部' : 'Scroll to bottom';
  return <button type="button" className="jump-to-bottom" aria-label={label} data-tooltip={label} onClick={onClick}>
    <ArrowDown size={17}/>
  </button>;
}
