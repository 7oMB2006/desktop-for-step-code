import { RotateCcw } from 'lucide-react';

export function AutoResumeMessage({ language, index }: { language: 'zh' | 'en'; index: number }) {
  const zh = language === 'zh';
  return <div className="client-event-note auto-resume-message" role="note" data-message-index={index}>
    <RotateCcw size={14} aria-hidden="true"/>
    <span><strong>{zh ? '已发起自动续跑' : 'Automatic continuation requested'}</strong>{zh ? '：' : ': '}
      <span className="auto-resume-reason">{zh ? '上次响应中断' : 'Previous response interrupted'}</span></span>
  </div>;
}
