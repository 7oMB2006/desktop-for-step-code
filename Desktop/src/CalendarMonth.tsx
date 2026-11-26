import type { ButtonHTMLAttributes } from 'react';
import { usageDateKey } from './usage-range';
import './calendar-month.css';

export const calendarMonthIndex = (date: Date) => date.getFullYear() * 12 + date.getMonth();
export const calendarMonthDate = (index: number) => new Date(Math.floor(index / 12), index % 12, 1, 12);

export function CalendarMonth({ month, zh, dayState, showHeading = true }: {
  month: number; zh: boolean; showHeading?: boolean;
  dayState: (date: string) => { selected: boolean; start?: boolean; end?: boolean; button: ButtonHTMLAttributes<HTMLButtonElement> };
}) {
  const date = calendarMonthDate(month);
  const title = date.toLocaleDateString(zh ? 'zh-CN' : 'en-US', { year: 'numeric', month: 'long' });
  const weekdays = zh ? ['一', '二', '三', '四', '五', '六', '日'] : ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
  const offset = (date.getDay() + 6) % 7;
  const count = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  return <section className="usage-calendar" aria-label={title}>
    {showHeading && <h3>{title}</h3>}
    <div role="grid" aria-label={title}>
      <div className="usage-calendar-row" role="row">{weekdays.map(day => <span key={day} role="columnheader">{day}</span>)}</div>
      {Array.from({ length: 6 }, (_, week) => <div className="usage-calendar-row" role="row" key={week}>
        {Array.from({ length: 7 }, (_, weekday) => {
          const day = week * 7 + weekday - offset + 1;
          if (day < 1 || day > count) return <span role="gridcell" key={weekday}/>;
          const key = usageDateKey(new Date(date.getFullYear(), date.getMonth(), day, 12));
          const { selected, start, end, button } = dayState(key);
          return <span role="gridcell" aria-selected={selected} key={weekday}
            className={`usage-calendar-day${selected ? ' in-range' : ''}${start ? ' range-start' : ''}${end ? ' range-end' : ''}`}>
            <button type="button" data-date={key} aria-label={key} {...button}>{day}</button>
          </span>;
        })}
      </div>)}
    </div>
  </section>;
}
