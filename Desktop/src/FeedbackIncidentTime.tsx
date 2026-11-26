import { useId, useLayoutEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, CalendarDays } from 'lucide-react';
import { CalendarMonth, calendarMonthDate, calendarMonthIndex } from './CalendarMonth';
import { parseUsageDate, usageDateKey } from './usage-range';

const offsets: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
const minMonth = 1000 * 12, maxMonth = 9999 * 12 + 11;

export function FeedbackIncidentTime({ date, time, setDate, setTime, zh, disabled, invalid }: {
  date: string; time: string; setDate: (value: string) => void; setTime: (value: string) => void;
  zh: boolean; disabled: boolean; invalid: boolean;
}) {
  const id = useId();
  const anchor = useRef<HTMLDivElement>(null), trigger = useRef<HTMLButtonElement>(null), panel = useRef<HTMLDivElement>(null);
  const today = usageDateKey(new Date());
  const [cursor, setCursor] = useState(today);
  const [expanded, setExpanded] = useState(false);
  const month = calendarMonthIndex(parseUsageDate(cursor)!);
  const close = () => {
    panel.current?.hidePopover();
    setExpanded(false);
    trigger.current?.focus({ preventScroll: true });
  };
  const focusDay = (day: string) => requestAnimationFrame(() => {
    panel.current?.querySelector<HTMLButtonElement>(`button[data-date="${day}"]`)?.focus({ preventScroll: true });
  });
  useLayoutEffect(() => {
    const element = panel.current;
    if (!element || !expanded) return;
    if (!element.matches(':popover-open')) element.showPopover();
    const place = () => {
      const bounds = anchor.current?.getBoundingClientRect();
      if (!bounds) return;
      const gap = 6, gutter = 10;
      const below = innerHeight - bounds.bottom - gap - gutter;
      const above = bounds.top - gap - gutter;
      const up = below < element.scrollHeight && above > below;
      element.style.maxHeight = `${Math.max(0, up ? above : below)}px`;
      element.style.left = `${Math.max(gutter, Math.min(bounds.left, innerWidth - element.offsetWidth - gutter))}px`;
      element.style.top = `${up ? bounds.top - gap - element.offsetHeight : bounds.bottom + gap}px`;
      element.style.transformOrigin = up ? 'bottom left' : 'top left';
    };
    place();
    window.addEventListener('resize', place);
    document.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      document.removeEventListener('scroll', place, true);
    };
  }, [expanded]);
  const moveMonth = (step: number) => setCursor(usageDateKey(calendarMonthDate(month + step)));
  const label = zh ? '选择日期' : 'Choose date';
  return <div className="feedback-incident" role="group" aria-labelledby={`${id}-label`}>
    <span id={`${id}-label`}>{zh ? '出错时间（本地时间，可选）' : 'Incident time (local, optional)'}</span>
    <div className="feedback-incident-fields">
      <div className="feedback-date-field" ref={anchor}>
        <input aria-label={zh ? '出错日期' : 'Incident date'} placeholder="YYYY-MM-DD" spellCheck={false}
          value={date} maxLength={10} disabled={disabled} aria-invalid={invalid} aria-describedby={`${id}-hint`}
          onChange={event => setDate(event.target.value)}/>
        <button type="button" ref={trigger} aria-label={label} title={label} aria-haspopup="dialog" aria-controls={`${id}-calendar`}
          aria-expanded={expanded} disabled={disabled} onClick={() => {
            if (expanded) { close(); return; }
            const day = parseUsageDate(date.trim()) ? date.trim() : today;
            setCursor(day); setExpanded(true); focusDay(day);
          }}><CalendarDays size={16}/></button>
      </div>
      <input aria-label={zh ? '出错时刻' : 'Incident time'} placeholder="HH:mm" spellCheck={false}
        value={time} maxLength={5} disabled={disabled} aria-invalid={invalid} aria-describedby={`${id}-hint`}
        onChange={event => setTime(event.target.value)}/>
    </div>
    <div ref={panel} id={`${id}-calendar`} className="feedback-calendar" popover="auto" role="dialog" aria-label={label}
      onToggle={event => { if (event.newState === 'closed') setExpanded(false); }}
      onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); } }}>
      <header>
        <button type="button" aria-label={zh ? '上个月' : 'Previous month'} disabled={month <= minMonth} onClick={() => moveMonth(-1)}><ArrowLeft size={15}/></button>
        <span aria-live="polite">{calendarMonthDate(month).toLocaleDateString(zh ? 'zh-CN' : 'en-US', { year: 'numeric', month: 'long' })}</span>
        <button type="button" aria-label={zh ? '下个月' : 'Next month'} disabled={month >= maxMonth} onClick={() => moveMonth(1)}><ArrowRight size={15}/></button>
      </header>
      <CalendarMonth month={month} zh={zh} showHeading={false} dayState={day => {
        const selected = day === date.trim();
        return { selected, start: selected, end: selected, button: {
          'aria-current': day === today ? 'date' : undefined, tabIndex: day === cursor ? 0 : -1,
          onFocus: () => setCursor(day), onClick: () => { setDate(day); close(); },
          onKeyDown: event => {
            const offset = offsets[event.key];
            if (!offset) return;
            event.preventDefault();
            const next = parseUsageDate(day)!;
            next.setDate(next.getDate() + offset);
            const nextMonth = calendarMonthIndex(next);
            if (nextMonth < minMonth || nextMonth > maxMonth) return;
            const key = usageDateKey(next);
            setCursor(key); focusDay(key);
          },
        } };
      }}/>
    </div>
    <p id={`${id}-hint`} className="feedback-incident-hint" role={invalid ? 'alert' : undefined}>
      {invalid ? (zh ? '请输入有效的日期和 24 小时时间。' : 'Enter a valid date and 24-hour time.')
        : (zh ? '可选。填写的时间单独记录，不会改变应用记录的事件。' : 'Optional. This time is recorded separately from the app event.')}
    </p>
  </div>;
}
