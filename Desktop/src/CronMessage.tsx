import { useId, useState } from 'react';
import { Clock3 } from 'lucide-react';
import { DisclosureChevron } from './DisclosureChevron';
import type { CronNotice } from './cron-message';
import './cron-message.css';

export function CronMessage({ notice, language, index, onLayoutChange }: {
  notice: CronNotice; language: 'zh' | 'en'; index: number; onLayoutChange?: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const id = useId();
  const zh = language === 'zh';
  const label = notice.kind === 'missed'
    ? zh ? '定时任务错过提醒' : 'Missed scheduled tasks'
    : zh ? '定时任务触发' : 'Scheduled task triggered';
  const title = notice.kind === 'missed'
    ? notice.count ? zh ? `${notice.count} 个单次任务` : `${notice.count} one-shot task(s)` : zh ? '查看原始提醒' : 'View original notice'
    : notice.prompt.replace(/\s+/gu, ' ').trim() || (zh ? '查看任务指令' : 'View task instruction');
  const date = notice.timestamp === undefined ? undefined : new Date(notice.timestamp);
  return <section className="cron-message" data-message-index={index} data-cron-kind={notice.kind}>
    <button type="button" className="cron-message-trigger" aria-expanded={expanded} aria-controls={id}
      onClick={() => setExpanded(value => !value)}>
      <Clock3 size={15} aria-hidden="true"/>
      <span className="cron-message-label">{label}</span><span className="cron-message-separator" aria-hidden="true">·</span>
      <span className="cron-message-title">{title}</span>
      {date && <time dateTime={date.toISOString()}>{date.toLocaleTimeString(zh ? 'zh-CN' : 'en-GB', {
        hour: '2-digit', minute: '2-digit', hour12: false,
      })}</time>}
      <span className="cron-message-chevron"><DisclosureChevron/></span>
    </button>
    <div id={id} className={`cron-message-details${expanded ? ' is-expanded' : ''}`} inert={!expanded} aria-hidden={!expanded}
      onTransitionEnd={event => { if (event.target === event.currentTarget) onLayoutChange?.(); }}>
      <div><dl className="cron-message-fields">
        <div><dt>{zh ? notice.kind === 'missed' ? '原始提醒' : '任务指令' : notice.kind === 'missed' ? 'Original notice' : 'Instruction'}</dt>
          <dd className="cron-message-prompt">{notice.kind === 'missed' ? notice.original : notice.prompt}</dd></div>
        {date && <div><dt>{zh ? '消息时间' : 'Message time'}</dt><dd>{date.toLocaleString(zh ? 'zh-CN' : 'en-GB', { hour12: false })}</dd></div>}
        {notice.cron && <div><dt>{zh ? '调度表达式' : 'Schedule'}</dt><dd><code>{notice.cron}</code></dd></div>}
        {notice.id && <div><dt>{zh ? '任务 ID' : 'Task ID'}</dt><dd><code>{notice.id}</code></dd></div>}
      </dl></div>
    </div>
  </section>;
}
