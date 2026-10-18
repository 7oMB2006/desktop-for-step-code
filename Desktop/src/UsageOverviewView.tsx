import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Activity, ArrowUpRight, BarChart3, CalendarDays, Check, CircleHelp, Database, HardDrive, LineChart, RefreshCw } from 'lucide-react';
import { AppTooltip } from './AppTooltip';
import { DailyUsage } from './UsageDaily';
import { useChartPreview } from './UsageChartPreview';
import { UsageDateRange } from './UsageDateRange';
import { usageRange, type UsageRange } from './usage-range';
import { formatUsageTotal, type UsageUnit } from './usage-unit';
import { UsageUnitButton } from './UsageUnitButton';
import type { UsageDay, UsageOverview } from './usage-overview';
import './usage-overview.css';

type Source = 'all' | 'official' | 'custom';
const tokens = (day: UsageDay, source: Source) => source === 'official' ? day.official : source === 'custom' ? day.custom : day.official + day.custom + day.unknown;
const chatCount = (day: UsageDay, source: Source) => source === 'official' ? day.officialChats : source === 'custom' ? day.customChats : day.chats;
export function UsageOverviewView({ embedded = false, overview, pending = false, error = false, onRefresh, controls, language = 'zh' }: {
  embedded?: boolean; overview: UsageOverview; pending?: boolean; error?: boolean; onRefresh: () => void; controls?: React.ReactNode; language?: string;
}) {
  const t = (zh: string, en: string) => language === 'zh' ? zh : en;
  const locale = language === 'zh' ? 'zh-CN' : 'en-US';
  const number = (value: number) => value.toLocaleString(locale, { maximumFractionDigits: 2 });
  const compact = (value: number) => value >= 1e6 ? `${(value / 1e6).toFixed(2)}M` : value >= 1e3 ? `${(value / 1e3).toFixed(1)}K` : number(value);
  const prettyDate = (value: string) => new Date(`${value}T12:00:00`).toLocaleDateString(locale, { month: 'long', day: 'numeric', weekday: 'short' });
  const sources: [Source, string][] = [['all', t('全部', 'All')], ['official', t('阶跃官方', 'Step official')], ['custom', t('自定义第三方', 'Custom providers')]];
  const data = overview.days;
  const offset = (new Date(`${data[0].date}T12:00:00`).getDay() + 6) % 7;
  const cells: (UsageDay | null)[] = [...Array.from({ length: offset }, () => null), ...data];
  while (cells.length % 7) cells.push(null);
  const [source, setSource] = useState<Source>('all');
  const [selected, setSelected] = useState(data.length - 1);
  const [period, setPeriod] = useState(30);
  const [customRange, setCustomRange] = useState<UsageRange>();
  const [unit, setUnit] = useState<UsageUnit>('default');
  const [chart, setChart] = useState<'bar' | 'line'>('bar');
  const chartPreview = useChartPreview(language);
  const heatScroll = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const container = heatScroll.current;
    if (!container) return;
    const reveal = () => {
      const selectedCell = container.querySelector<HTMLElement>('.heat-cell.is-selected');
      if (selectedCell && container.scrollWidth > container.clientWidth)
        container.scrollLeft = selectedCell.offsetLeft - container.offsetLeft - container.clientWidth + 24;
    };
    reveal();
    const observer = new ResizeObserver(reveal);
    observer.observe(container);
    return () => observer.disconnect();
  }, [selected]);
  const total = data.reduce((sum, day) => sum + tokens(day, source), 0);
  const active = data.filter(day => tokens(day, source) > 0).length;
  const chats = overview.chats[source];
  const daily = data[Math.min(selected, data.length - 1)];
  const filteredTrend = customRange ? usageRange(data, customRange) : [];
  const trend = filteredTrend.length ? filteredTrend : data.slice(-period);
  const currentRange = { start: trend[0].date, end: trend.at(-1)!.date };
  const trendTotal = trend.reduce((sum, day) => sum + tokens(day, source), 0);
  const trendLabel = customRange ? `${currentRange.start}${t(' 至 ', ' to ')}${currentRange.end}` : t(`近${period}天`, `Last ${period} days`);
  const max = Math.max(1, ...data.map(day => tokens(day, source)));
  const trendMax = Math.max(1, ...trend.map(day => tokens(day, source)));
  const estimate = (field: 'plan' | 'api' | 'usd', prefix = '', suffix = '') => {
    const values = data.map(day => day[field]).filter((n): n is number => n !== null);
    return values.length ? `${prefix}${number(values.reduce((a, b) => a + b, 0))}${suffix}` : '—';
  };
  const points = useMemo(() => trend.map((day, i) => `${trend.length === 1 ? 494 : 34 + i / (trend.length - 1) * 920},${174 - tokens(day, source) / trendMax * 146}`).join(' '), [trend, source, trendMax]);
  return <div className={`usage-preview-surface${embedded ? ' is-embedded' : ''}`}><main className="usage-page">
    <header className="usage-header">
      <div className="usage-title"><img src={new URL('../public/StepCode.svg', import.meta.url).href} alt="" width="27" height="27"/><h1>{t('用量', 'Usage')}</h1><span className="usage-badge"><HardDrive size={12}/>{t('仅本机', 'Local only')}</span></div>
      {controls && <div className="preview-actions">{controls}</div>}
    </header>
    <nav className="usage-tabs" aria-label={t('用量页面', 'Usage pages')}><span aria-current="page">{t('统计总览', 'Overview')}</span>{!embedded && <a href="./usage-account.html?state=token">{t('套餐与余额', 'Plan and balance')}<ArrowUpRight size={12}/></a>}</nav>
    <div className="usage-toolbar"><div className="segmented" role="group" aria-label={t('统计来源', 'Usage source')}>{sources.map(([key, label]) =>
      <button key={key} aria-pressed={source === key} onClick={() => setSource(key)}>{label}</button>)}</div>
      <div className="scan-state" role="status"><span>{pending ? t('正在扫描本机记录…', 'Scanning local records...') : overview.scannedAt ? `${t('更新于 ', 'Updated at ')}${new Date(overview.scannedAt).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })}` : t('尚未读取', 'Not loaded')}</span><button className="icon-button" aria-label={t('刷新统计', 'Refresh usage')} data-tooltip={t('刷新本机统计', 'Refresh local usage')} disabled={pending} onClick={onRefresh}><RefreshCw size={14}/></button></div>
    </div>
    {error ? <section className="usage-error" role="alert"><Activity size={24}/><h2>{t('暂时无法读取本机记录', 'Unable to read local records')}</h2><p>{t('会话文件没有改变，请重新扫描。', 'Session files are unchanged. Please scan again.')}</p><button disabled={pending} onClick={onRefresh}>{t('重新扫描', 'Scan again')}</button></section> :
      <div className={pending ? 'usage-body is-loading' : 'usage-body'} aria-busy={pending}>
        <section className="usage-summary" aria-label={t('近一年统计', 'Past year summary')}>
          <div><span><Database size={14}/>{t('Token 总量', 'Total tokens')}</span><strong>{compact(total)}</strong><small>{t('近 365 天', 'Last 365 days')}</small></div>
          <div><span><CalendarDays size={14}/>{t('活跃天数', 'Active days')}</span><strong>{active}<small>{t('天', ' days')}</small></strong><small>{t('有用量的本地日期', 'Local dates with usage')}</small></div>
          <div><span><Activity size={14}/>{t('会话数', 'Sessions')}</span><strong>{number(chats)}</strong><small>{t('主会话', 'Main sessions')}</small></div>
          <div><span>{t('活跃日均', 'Active-day average')}</span><strong>{compact(active ? total / active : 0)}</strong><small>{t('Token / 天', 'Tokens / day')}</small></div>
        </section>
        <section className="usage-activity" aria-labelledby="activity-title">
          <div className="section-heading"><h2 id="activity-title">{t('活跃记录', 'Activity')}</h2><span>{data[0].date.replaceAll('-', '.')} — {data.at(-1)!.date.replaceAll('-', '.')}</span></div>
          <div className="heat-scroll" ref={heatScroll}>
            <div className="heat-months">{cells.filter((_, i) => i % 7 === 0).map((_, week) => {
              const day = cells.slice(week * 7, week * 7 + 7).find(d => d && Number(d.date.slice(-2)) === 1);
              return <span key={week}>{day ? new Date(`${day.date}T12:00:00`).toLocaleDateString(locale, { month: 'short' }) : ''}</span>;
            })}</div>
            <div className="heat-layout"><div className="heat-weekdays"><span>{t('一', 'M')}</span><span/><span>{t('三', 'W')}</span><span/><span>{t('五', 'F')}</span><span/><span/></div>
              <div className="heat-grid" role="group" aria-label={t('每日用量热力图', 'Daily usage heatmap')}>{cells.map((cell, index) => {
                const dayIndex = index - offset, day = data[dayIndex];
                if (!cell) return <span className="heat-placeholder" key={`empty-${index}`}/>;
                const value = tokens(day, source);
                return <button key={day.date} className={`heat-cell level-${value ? Math.min(4, Math.ceil(value / max * 4)) : 0}${dayIndex === selected ? ' is-selected' : ''}`}
                  aria-label={`${day.date}${t('，', ', ')}${number(value)} Token`} aria-pressed={dayIndex === selected} tabIndex={dayIndex === selected ? 0 : -1}
                  {...chartPreview.bind(`day-${day.date}`, { title: day.date, subtitle: prettyDate(day.date), rows: [
                    ...(source !== 'custom' ? [{ label: t('阶跃官方', 'Step official'), value: number(day.official), color: 'var(--primary)' }] : []),
                    ...(source !== 'official' ? [{ label: t('自定义第三方', 'Custom providers'), value: number(day.custom), color: '#4c9690' }] : []),
                    ...(source === 'all' && day.unknown ? [{ label: t('未识别来源', 'Unknown source'), value: number(day.unknown) }] : []),
                    { label: t('主会话数', 'Main sessions'), value: number(chatCount(day, source)) },
                    { label: t('Token 合计', 'Total tokens'), value: number(value), total: true },
                  ] })} onClick={() => setSelected(dayIndex)}
                  onKeyDown={event => {
                    const delta = ({ ArrowLeft: -7, ArrowRight: 7, ArrowUp: -1, ArrowDown: 1 } as Record<string, number>)[event.key];
                    if (delta === undefined) return;
                    event.preventDefault(); const next = Math.max(0, Math.min(data.length - 1, dayIndex + delta)); setSelected(next);
                    (event.currentTarget.parentElement?.querySelectorAll('button')[next] as HTMLButtonElement)?.focus();
                  }}/>;
              })}</div>
            </div>
          </div>
          <div className="heat-footer"><span>{!total ? t('还没有本机用量记录', 'No local usage records yet') : t(`一年里，${active} 天与你一起工作`, `${active} active days together this year`)}</span><div className="heat-legend"><span>{t('少', 'Less')}</span>{[0, 1, 2, 3, 4].map(level => <i key={level} className={`level-${level}`}/>)}<span>{t('多', 'More')}</span></div></div>
        </section>
        <DailyUsage key={`${daily.date}:${source}`} day={daily} source={source} preview={chartPreview.bind} language={language}/>
        <section className="usage-trends" aria-labelledby="trend-title">
          <div className="section-heading trend-heading"><h2 id="trend-title">{t('用量趋势', 'Usage trend')}</h2><div className="trend-controls">
            <UsageDateRange value={currentRange} min={data[0].date} max={data.at(-1)!.date} custom={Boolean(customRange)} onChange={setCustomRange} language={language}/>
            <div className="segmented compact" role="group" aria-label={t('趋势时间范围', 'Trend period')}>
            {[7, 30, 90].map(value => <button key={value} aria-pressed={!customRange && period === value} onClick={() => { setPeriod(value); setCustomRange(undefined); }}>{t(`近 ${value} 天`, `${value} days`)}</button>)}</div>
            <div className="chart-switch" role="group" aria-label={t('图表类型', 'Chart type')}><button className="icon-button" aria-pressed={chart === 'bar'} aria-label={t('柱状图', 'Bar chart')} data-tooltip={t('柱状图', 'Bar chart')} onClick={() => setChart('bar')}><BarChart3 size={16}/></button><button className="icon-button" aria-pressed={chart === 'line'} aria-label={t('折线图', 'Line chart')} data-tooltip={t('折线图', 'Line chart')} onClick={() => setChart('line')}><LineChart size={16}/></button></div></div>
          </div>
          <div className="trend-range-summary" role="status" aria-label={t('趋势区间合计', 'Trend range total')}>
            <div className="trend-total-controls"><span>{t('区间合计', 'Range total')}</span><strong className="trend-total-value" data-testid="trend-total">{formatUsageTotal(trendTotal, unit, language)}</strong><span>Token</span>
              <UsageUnitButton value={unit} onChange={setUnit} language={language === 'zh' ? 'zh' : 'en'}/>
            </div>
            <span>{currentRange.start}{t(' 至 ', ' to ')}{currentRange.end}<i/>{t(`共 ${trend.length} 天`, `${trend.length} days`)}</span>
          </div>
          <div className="chart-legend">{chart === 'line' ? <span><i className="official-dot"/>{sources.find(([key]) => key === source)?.[1]}{t('合计', ' total')}</span> : <>{source !== 'custom' && <span><i className="official-dot"/>{t('阶跃官方', 'Step official')}</span>}{source !== 'official' && <span><i className="custom-dot"/>{t('自定义第三方', 'Custom providers')}</span>}{source === 'all' && data.some(d => d.unknown) && <span>{t('未识别来源', 'Unknown source')}</span>}</>}<span className="chart-unit">Token</span></div>
          <div className="chart-scroll"><svg className="usage-chart" viewBox="0 0 980 205" role="img" aria-label={`${trendLabel} ${sources.find(([key]) => key === source)?.[1]} Token ${chart === 'bar' ? t('柱状图', 'bar chart') : t('折线图', 'line chart')}`}>
            {[0, 1, 2, 3].map(i => <g key={i}><line x1="34" y1={28 + i * 146 / 3} x2="966" y2={28 + i * 146 / 3} className="chart-gridline"/><text x="0" y={32 + i * 146 / 3}>{compact(trendMax * (1 - i / 3))}</text></g>)}
            {chart === 'line' ? <polyline points={points} fill="none" className="chart-line"/> : trend.map((day, i) => {
              const width = 920 / trend.length, official = source === 'custom' ? 0 : day.official / trendMax * 146;
              const custom = source === 'official' ? 0 : day.custom / trendMax * 146;
              const unknown = source === 'all' ? day.unknown / trendMax * 146 : 0;
              return <g key={day.date}>
                <rect x={34 + i * width + 2} y={174 - official} width={Math.max(2, width - 4)} height={official} rx="2" className="bar-official"/>
                <rect x={34 + i * width + 2} y={174 - official - custom} width={Math.max(2, width - 4)} height={custom} rx="2" className="bar-custom"/>
                <rect x={34 + i * width + 2} y={174 - official - custom - unknown} width={Math.max(2, width - 4)} height={unknown} rx="2" fill="var(--muted)"/></g>;
            })}
            {trend.map((day, i) => {
              const step = chart === 'bar' ? 920 / trend.length : 920 / Math.max(1, trend.length - 1);
              const x = trend.length === 1 ? 494 : chart === 'bar' ? 34 + i * step + step / 2 : 34 + i * step;
              const left = Math.max(34, x - step / 2), right = Math.min(966, x + step / 2);
              return <g key={day.date} className="trend-sample" tabIndex={i === trend.length - 1 ? 0 : -1} role="img"
                aria-label={`${day.date}${t('，', ', ')}${number(tokens(day, source))} Token`}
                {...chartPreview.bind(`trend-${day.date}`, { title: day.date, subtitle: t('每日 Token 用量', 'Daily token usage'), rows: [
                  ...(source !== 'custom' ? [{ label: t('阶跃官方', 'Step official'), value: number(day.official), color: 'var(--primary)' }] : []),
                  ...(source !== 'official' ? [{ label: t('自定义第三方', 'Custom providers'), value: number(day.custom), color: '#4c9690' }] : []),
                  ...(source === 'all' && day.unknown ? [{ label: t('未识别来源', 'Unknown source'), value: number(day.unknown) }] : []),
                  { label: t('Token 合计', 'Total tokens'), value: number(tokens(day, source)), total: true },
                ] })}
                onKeyDown={event => {
                  const delta = ({ ArrowLeft: -1, ArrowRight: 1 } as Record<string, number>)[event.key];
                  if (delta === undefined) return;
                  event.preventDefault();
                  const next = Math.max(0, Math.min(trend.length - 1, i + delta));
                  (event.currentTarget.parentElement?.querySelectorAll<SVGElement>('.trend-sample')[next])?.focus();
                }}>
                <rect className="chart-hit-area" x={left} y="28" width={right - left} height="146"/>
                <line className="trend-guide" x1={x} x2={x} y1="28" y2="174"/>
                {chart === 'line' && <circle className="trend-point" cx={x} cy={174 - tokens(day, source) / trendMax * 146} r="3"/>}
              </g>;
            })}
            {chart === 'line' && trend.length === 1 && <circle cx="494" cy={174 - tokens(trend[0], source) / trendMax * 146} r="3" fill="var(--primary)" pointerEvents="none"/>}
            {[...new Set([0, Math.floor((trend.length - 1) / 2), trend.length - 1])].map((i, j, indices) =>
              <text key={i} x={trend.length === 1 ? 494 : 34 + i / (trend.length - 1) * 920} y="199"
                textAnchor={trend.length === 1 ? 'middle' : j === 0 ? 'start' : j === indices.length - 1 ? 'end' : 'middle'}>{trend[i].date.slice(5).replace('-', '/')}</text>)}
          </svg></div>
          {chart === 'line' && <p className="chart-note">{t('折线展示当前筛选来源的 Token 合计。', 'The line shows total tokens for the selected source.')}</p>}
        </section>
        {source !== 'custom' ? <section className="usage-cost" aria-label={t('近一年阶跃官方费用估算', 'Past year Step official cost estimates')}><div><h2>{t('阶跃官方估算', 'Step official estimates')}</h2><span>{t('近 365 天 · Desktop 已记录的请求', 'Last 365 days · Requests recorded by Desktop')}</span></div>
          <div><span>Step Plan</span><strong>{estimate('plan')} <small>M Credit</small></strong></div>
          <div><span>{t('官方 API · 国内', 'Official API · China')}</span><strong>{estimate('api', '¥')}</strong></div>
          {data.some(day => day.usd !== null) && <div><span>{t('官方 API · 海外', 'Official API · Global')}</span><strong>{estimate('usd', '$')}</strong></div>}
          <button className="icon-button" aria-label={t('费用估算范围', 'Cost estimate coverage')} data-tooltip={t('M Credit 与金额分别累计，不相加。仅包含 Desktop 已记录的主会话请求，不是官方账单；历史与子代理用量可能未覆盖。', 'M Credit and currency totals are kept separate. Only main-session requests recorded by Desktop are included, not official bills; history and subagents may be missing.')}><CircleHelp size={16}/></button>
        </section> : <p className="third-party-note"><CircleHelp size={14}/>{t('第三方仅统计 Token，不提供费用估算。', 'Custom providers track tokens only, without cost estimates.')}</p>}
        <footer className="usage-footnote"><span><Check size={13}/>{t('社区版仅保存在本机，暂不支持随账户云端保存或跨设备同步。', 'Community edition data stays on this device; account cloud storage and cross-device sync are not supported.')}</span><span>{t('不含其他设备记录与官网账单', 'Excludes other devices and official bills')}</span></footer>
        {overview.limited.length > 0 && <p className="coverage-note" role="status">{t('部分历史记录缺少统计元数据，当前结果覆盖不完整。无法识别来源的用量仅计入「全部」，不归入官方或第三方。', 'Some historical records lack usage metadata, so coverage is incomplete. Unknown sources count toward All only, not official or custom providers.')}</p>}
        <p className="chart-note">{t('主会话去重计数；Token 包含已记录的子代理、分支与上下文压缩用量。按本机日期统计。', 'Main sessions are deduplicated. Tokens include recorded subagents, branches and context compaction. Grouped by local date.')}</p>
        {source !== 'custom' && <p className="chart-note">{t('费用仅累计 Desktop 已保存的估算记录，沿用请求发生时的计费模式与规则；未记录的历史显示「—」，不追溯套用当前账户。', 'Costs sum saved Desktop estimates using the billing mode and rules at request time. Unrecorded history shows a dash; current account rules are not applied retroactively.')}
          {overview.estimates && t(` 已记录 ${overview.estimates.recorded} 次请求${overview.estimates.unknown ? `，其中 ${overview.estimates.unknown} 次无法估算` : ''}。`, ` ${number(overview.estimates.recorded)} recorded requests${overview.estimates.unknown ? `; ${number(overview.estimates.unknown)} could not be estimated` : ''}.`)}
          {overview.estimates?.limited && t('部分估算文件未能读取。', ' Some estimate files could not be read.')}</p>}
      </div>}
    {!embedded && <AppTooltip/>}
    {chartPreview.preview}
  </main></div>;
}
