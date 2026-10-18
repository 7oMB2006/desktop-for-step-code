import { useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, ArrowRight, CalendarRange, X } from 'lucide-react';
import { DisclosureChevron } from './DisclosureChevron';
import { parseUsageDate, usageDateKey, validUsageRange, type UsageRange } from './usage-range';
import './usage-date-range.css';

const monthIndex = (date: Date) => date.getFullYear() * 12 + date.getMonth();
const monthDate = (index: number) => new Date(Math.floor(index / 12), index % 12, 1, 12);
const dayOffset = (value: string, offset: number) => {
  const date = parseUsageDate(value)!; date.setDate(date.getDate() + offset); return usageDateKey(date);
};
export function UsageDateRange({ value, min, max, custom, onChange, language = 'zh' }: {
  value: UsageRange; min: string; max: string; custom: boolean; onChange: (value: UsageRange) => void; language?: string;
}) {
  const t = (zh: string, en: string) => language === 'zh' ? zh : en;
  const locale = language === 'zh' ? 'zh-CN' : 'en-US';
  const weekdays = language === 'zh' ? ['一', '二', '三', '四', '五', '六', '日'] : ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
  const id = useId(), anchor = useRef<HTMLButtonElement>(null), panel = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);
  const [selectingEnd, setSelectingEnd] = useState(false);
  const [hover, setHover] = useState<string>();
  const [cursor, setCursor] = useState(value.end);
  const minMonth = monthIndex(parseUsageDate(min)!), maxMonth = monthIndex(parseUsageDate(max)!);
  const [month, setMonth] = useState(Math.max(minMonth, monthIndex(parseUsageDate(value.end)!) - 1));
  const [position, setPosition] = useState<{ left: number; top: number; origin: string }>();
  const valid = validUsageRange(draft, min, max);
  const close = () => { setOpen(false); anchor.current?.focus({ preventScroll: true }); };
  useLayoutEffect(() => {
    const element = panel.current;
    if (!element) return;
    if (!open) { if (element.matches(':popover-open')) element.hidePopover(); return; }
    element.showPopover();
    const place = () => {
      const trigger = anchor.current?.getBoundingClientRect();
      if (!trigger) return;
      const { width, height } = element.getBoundingClientRect();
      const above = trigger.top - 62, below = innerHeight - trigger.bottom - 10;
      const upwards = below < height && above > below;
      setPosition({ left: Math.max(10, Math.min(trigger.right - width, innerWidth - width - 10)),
        top: Math.max(54, upwards ? trigger.top - height - 7 : Math.min(trigger.bottom + 7, innerHeight - height - 10)),
        origin: upwards ? 'bottom right' : 'top right' });
    };
    place();
    const observer = new ResizeObserver(place); observer.observe(element);
    if (anchor.current) observer.observe(anchor.current);
    window.addEventListener('resize', place); document.addEventListener('scroll', place, true);
    const focus = requestAnimationFrame(() => {
      element.querySelector<HTMLButtonElement>(`button[data-date="${value.end}"]`)?.focus({ preventScroll: true });
    });
    return () => {
      cancelAnimationFrame(focus); observer.disconnect();
      window.removeEventListener('resize', place); document.removeEventListener('scroll', place, true);
    };
  }, [open, value.end]);
  const choose = (date: string) => {
    setCursor(date); setHover(undefined);
    if (!selectingEnd) { setDraft({ start: date, end: date }); setSelectingEnd(true); }
    else {
      setDraft({ start: date < draft.start ? date : draft.start, end: date < draft.start ? draft.start : date });
      setSelectingEnd(false);
    }
  };
  const onDayKey = (event: KeyboardEvent<HTMLButtonElement>, date: string) => {
    let target: string;
    const offsets: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
    if (event.key in offsets) target = dayOffset(date, offsets[event.key]);
    else if (event.key === 'Home' || event.key === 'End') {
      const weekday = (parseUsageDate(date)!.getDay() + 6) % 7;
      target = dayOffset(date, event.key === 'Home' ? -weekday : 6 - weekday);
    } else if (event.key === 'PageUp' || event.key === 'PageDown') {
      const current = parseUsageDate(date)!, day = current.getDate();
      current.setDate(1); current.setMonth(current.getMonth() + (event.key === 'PageUp' ? -1 : 1));
      const last = new Date(current.getFullYear(), current.getMonth() + 1, 0).getDate();
      current.setDate(Math.min(day, last)); target = usageDateKey(current);
    } else return;
    event.preventDefault();
    target = target < min ? min : target > max ? max : target;
    const nextMonth = monthIndex(parseUsageDate(target)!);
    if (nextMonth < month) setMonth(nextMonth);
    else if (nextMonth > month + 1) setMonth(nextMonth - 1);
    setCursor(target);
    requestAnimationFrame(() => panel.current?.querySelector<HTMLButtonElement>(`button[data-date="${target}"]`)?.focus());
  };
  const previewEnd = selectingEnd ? hover ?? draft.start : draft.end;
  const rangeStart = draft.start < previewEnd ? draft.start : previewEnd;
  const rangeEnd = draft.start < previewEnd ? previewEnd : draft.start;
  const firstVisible = usageDateKey(monthDate(month));
  const lastVisible = usageDateKey(new Date(monthDate(month + 2).getFullYear(), monthDate(month + 2).getMonth(), 0, 12));
  const visibleCursor = cursor >= firstVisible && cursor <= lastVisible ? cursor : firstVisible < min ? min : firstVisible;
  return <>
    <button ref={anchor} type="button" className="usage-range-trigger" aria-label={t('自定义日期', 'Custom dates')} aria-haspopup="dialog"
      aria-expanded={open} aria-controls={id} aria-pressed={custom}
      data-tooltip={custom ? `${value.start}${t(' 至 ', ' to ')}${value.end}` : t('自定义日期范围', 'Custom date range')}
      onClick={() => {
        if (open) { close(); return; }
        setDraft(value); setSelectingEnd(false); setHover(undefined); setCursor(value.end);
        setMonth(Math.max(minMonth, monthIndex(parseUsageDate(value.end)!) - 1)); setOpen(true);
      }}>
      <CalendarRange size={14}/><span>{custom ? `${value.start.slice(5).replace('-', '/')}${t(' 至 ', ' to ')}${value.end.slice(5).replace('-', '/')}` : t('自定义日期', 'Custom dates')}</span><DisclosureChevron/>
    </button>
    {createPortal(<div ref={panel} id={id} popover="auto" className="usage-range-panel" role="dialog" aria-label={t('选择日期范围', 'Select date range')}
      aria-hidden={!open} inert={!open} onToggle={event => { if (event.newState === 'closed') setOpen(false); }}
      style={{ left: position?.left ?? 0, top: position?.top ?? 0, visibility: position ? undefined : 'hidden', transformOrigin: position?.origin }}
      onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); } }}
      onBlur={event => {
        if (event.relatedTarget instanceof Node && !event.currentTarget.contains(event.relatedTarget)
          && event.relatedTarget !== anchor.current) setOpen(false);
      }}>
      <header><div><strong>{t('日期范围', 'Date range')}</strong><span>{t('含起止日期 · 本机日期', 'Inclusive · Local dates')}</span></div>
        <button type="button" className="range-icon" aria-label={t('关闭日期选择', 'Close date picker')} onClick={close}><X size={15}/></button></header>
      <div className="usage-range-inputs">
        {(['start', 'end'] as const).map(field => <label key={field}><span>{field === 'start' ? t('开始日期', 'Start date') : t('结束日期', 'End date')}</span>
          <input type="text" inputMode="numeric" placeholder="YYYY-MM-DD" value={draft[field]} aria-invalid={!valid}
            spellCheck={false} maxLength={10} onChange={event => {
              setDraft(current => ({ ...current, [field]: event.target.value })); setSelectingEnd(false); setHover(undefined);
            }}/></label>)}
      </div>
      <div className="usage-calendar-navigation">
        <button type="button" className="range-icon" aria-label={t('上个月', 'Previous month')} disabled={month <= minMonth} onClick={() => setMonth(m => m - 1)}><ArrowLeft size={15}/></button>
        <span aria-live="polite">{monthDate(month).getFullYear()}{t(' 年', '')}</span>
        <button type="button" className="range-icon" aria-label={t('下个月', 'Next month')} disabled={month + 1 >= maxMonth} onClick={() => setMonth(m => m + 1)}><ArrowRight size={15}/></button>
      </div>
      <div className="usage-calendars" onPointerLeave={() => setHover(undefined)}>
        {[month, month + 1].map(index => {
          const date = monthDate(index), title = date.toLocaleDateString(locale, { year: 'numeric', month: 'long' });
          const offset = (date.getDay() + 6) % 7, count = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
          return <section className="usage-calendar" key={index} aria-label={title}><h3>{title}</h3>
            <div role="grid" aria-label={title}>
              <div className="usage-calendar-row" role="row">{weekdays.map(day => <span key={day} role="columnheader">{day}</span>)}</div>
              {Array.from({ length: 6 }, (_, week) => <div className="usage-calendar-row" role="row" key={week}>
                {Array.from({ length: 7 }, (_, weekday) => {
                  const day = week * 7 + weekday - offset + 1;
                  if (day < 1 || day > count) return <span role="gridcell" key={weekday}/>;
                  const key = usageDateKey(new Date(date.getFullYear(), date.getMonth(), day, 12));
                  const disabled = key < min || key > max;
                  const inRange = valid && !disabled && key >= rangeStart && key <= rangeEnd;
                  return <span role="gridcell" aria-selected={inRange} key={weekday}
                    className={`usage-calendar-day${inRange ? ' in-range' : ''}${key === rangeStart ? ' range-start' : ''}${key === rangeEnd ? ' range-end' : ''}`}>
                    <button type="button" data-date={key} aria-label={key} disabled={disabled} tabIndex={key === visibleCursor ? 0 : -1}
                      aria-current={key === max ? 'date' : undefined}
                      onFocus={() => setCursor(key)} onPointerEnter={() => { if (selectingEnd) setHover(key); }}
                      onClick={() => choose(key)} onKeyDown={event => onDayKey(event, key)}>{day}</button>
                  </span>;
                })}
              </div>)}
            </div>
          </section>;
        })}
      </div>
      {!valid && <p className="usage-range-error" role="alert">{t(`请选择 ${min} 至 ${max} 内的有效日期，结束日期不能早于开始日期。`, `Choose valid dates from ${min} to ${max}; the end cannot precede the start.`)}</p>}
      <footer><span>{valid ? `${draft.start}${t(' 至 ', ' to ')}${draft.end}` : t('日期范围无效', 'Invalid date range')}</span>
        <button type="button" onClick={close}>{t('取消', 'Cancel')}</button>
        <button type="button" className="usage-range-apply" disabled={!valid} onClick={() => { onChange(draft); close(); }}>{t('应用', 'Apply')}</button></footer>
    </div>, document.body)}
  </>;
}
