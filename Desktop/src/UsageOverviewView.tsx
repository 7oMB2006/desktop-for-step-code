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
const compact = (value: number) => value >= 1e6 ? `${(value / 1e6).toFixed(2)}M` : value >= 1e3 ? `${(value / 1e3).toFixed(1)}K` : value.toLocaleString('zh-CN');
const number = (value: number) => value.toLocaleString('zh-CN', { maximumFractionDigits: 2 });
const prettyDate = (value: string) => new Date(`${value}T12:00:00`).toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'short' });
const sources: [Source, string][] = [['all', '全部'], ['official', '阶跃官方'], ['custom', '自定义第三方']];
export function UsageOverviewView({ embedded = false, overview, pending = false, error = false, onRefresh, controls }: {
  embedded?: boolean; overview: UsageOverview; pending?: boolean; error?: boolean; onRefresh: () => void; controls?: React.ReactNode;
}) {
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
  const chartPreview = useChartPreview();
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
  const trendLabel = customRange ? `${currentRange.start} 至 ${currentRange.end}` : `近${period}天`;
  const max = Math.max(1, ...data.map(day => tokens(day, source)));
  const trendMax = Math.max(1, ...trend.map(day => tokens(day, source)));
  const estimate = (field: 'plan' | 'api' | 'usd', prefix = '', suffix = '') => {
    const values = data.map(day => day[field]).filter((n): n is number => n !== null);
    return values.length ? `${prefix}${number(values.reduce((a, b) => a + b, 0))}${suffix}` : '—';
  };
  const points = useMemo(() => trend.map((day, i) => `${trend.length === 1 ? 494 : 34 + i / (trend.length - 1) * 920},${174 - tokens(day, source) / trendMax * 146}`).join(' '), [trend, source, trendMax]);
  return <div className={`usage-preview-surface${embedded ? ' is-embedded' : ''}`}><main className="usage-page">
    <header className="usage-header">
      <div className="usage-title"><img src={new URL('../public/StepCode.svg', import.meta.url).href} alt="" width="27" height="27"/><h1>用量</h1><span className="usage-badge"><HardDrive size={12}/>仅本机</span></div>
      {controls && <div className="preview-actions">{controls}</div>}
    </header>
    <nav className="usage-tabs" aria-label="用量页面"><span aria-current="page">统计总览</span>{!embedded && <a href="./usage-account.html?state=token">套餐与余额<ArrowUpRight size={12}/></a>}</nav>
    <div className="usage-toolbar"><div className="segmented" role="group" aria-label="统计来源">{sources.map(([key, label]) =>
      <button key={key} aria-pressed={source === key} onClick={() => setSource(key)}>{label}</button>)}</div>
      <div className="scan-state" role="status"><span>{pending ? '正在扫描本机记录…' : overview.scannedAt ? `更新于 ${new Date(overview.scannedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}` : '尚未读取'}</span><button className="icon-button" aria-label="刷新统计" data-tooltip="刷新本机统计" disabled={pending} onClick={onRefresh}><RefreshCw size={14}/></button></div>
    </div>
    {error ? <section className="usage-error" role="alert"><Activity size={24}/><h2>暂时无法读取本机记录</h2><p>会话文件没有改变，请重新扫描。</p><button disabled={pending} onClick={onRefresh}>重新扫描</button></section> :
      <div className={pending ? 'usage-body is-loading' : 'usage-body'} aria-busy={pending}>
        <section className="usage-summary" aria-label="近一年统计">
          <div><span><Database size={14}/>Token 总量</span><strong>{compact(total)}</strong><small>近 365 天</small></div>
          <div><span><CalendarDays size={14}/>活跃天数</span><strong>{active}<small>天</small></strong><small>有用量的本地日期</small></div>
          <div><span><Activity size={14}/>会话数</span><strong>{number(chats)}</strong><small>主会话</small></div>
          <div><span>活跃日均</span><strong>{compact(active ? total / active : 0)}</strong><small>Token / 天</small></div>
        </section>
        <section className="usage-activity" aria-labelledby="activity-title">
          <div className="section-heading"><h2 id="activity-title">活跃记录</h2><span>{data[0].date.replaceAll('-', '.')} — {data.at(-1)!.date.replaceAll('-', '.')}</span></div>
          <div className="heat-scroll" ref={heatScroll}>
            <div className="heat-months">{cells.filter((_, i) => i % 7 === 0).map((_, week) => {
              const day = cells.slice(week * 7, week * 7 + 7).find(d => d && Number(d.date.slice(-2)) === 1);
              return <span key={week}>{day ? `${Number(day.date.slice(5, 7))}月` : ''}</span>;
            })}</div>
            <div className="heat-layout"><div className="heat-weekdays"><span>一</span><span/><span>三</span><span/><span>五</span><span/><span/></div>
              <div className="heat-grid" role="group" aria-label="每日用量热力图">{cells.map((cell, index) => {
                const dayIndex = index - offset, day = data[dayIndex];
                if (!cell) return <span className="heat-placeholder" key={`empty-${index}`}/>;
                const value = tokens(day, source);
                return <button key={day.date} className={`heat-cell level-${value ? Math.min(4, Math.ceil(value / max * 4)) : 0}${dayIndex === selected ? ' is-selected' : ''}`}
                  aria-label={`${day.date}，${number(value)} Token`} aria-pressed={dayIndex === selected} tabIndex={dayIndex === selected ? 0 : -1}
                  {...chartPreview.bind(`day-${day.date}`, { title: day.date, subtitle: prettyDate(day.date), rows: [
                    ...(source !== 'custom' ? [{ label: '阶跃官方', value: number(day.official), color: 'var(--primary)' }] : []),
                    ...(source !== 'official' ? [{ label: '自定义第三方', value: number(day.custom), color: '#4c9690' }] : []),
                    ...(source === 'all' && day.unknown ? [{ label: '未识别来源', value: number(day.unknown) }] : []),
                    { label: '主会话数', value: number(chatCount(day, source)) },
                    { label: 'Token 合计', value: number(value), total: true },
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
          <div className="heat-footer"><span>{!total ? '还没有本机用量记录' : `一年里，${active} 天与你一起工作`}</span><div className="heat-legend"><span>少</span>{[0, 1, 2, 3, 4].map(level => <i key={level} className={`level-${level}`}/>)}<span>多</span></div></div>
        </section>
        <DailyUsage key={`${daily.date}:${source}`} day={daily} source={source} preview={chartPreview.bind}/>
        <section className="usage-trends" aria-labelledby="trend-title">
          <div className="section-heading trend-heading"><h2 id="trend-title">用量趋势</h2><div className="trend-controls">
            <UsageDateRange value={currentRange} min={data[0].date} max={data.at(-1)!.date} custom={Boolean(customRange)} onChange={setCustomRange}/>
            <div className="segmented compact" role="group" aria-label="趋势时间范围">
            {[7, 30, 90].map(value => <button key={value} aria-pressed={!customRange && period === value} onClick={() => { setPeriod(value); setCustomRange(undefined); }}>近 {value} 天</button>)}</div>
            <div className="chart-switch" role="group" aria-label="图表类型"><button className="icon-button" aria-pressed={chart === 'bar'} aria-label="柱状图" data-tooltip="柱状图" onClick={() => setChart('bar')}><BarChart3 size={16}/></button><button className="icon-button" aria-pressed={chart === 'line'} aria-label="折线图" data-tooltip="折线图" onClick={() => setChart('line')}><LineChart size={16}/></button></div></div>
          </div>
          <div className="trend-range-summary" role="status" aria-label="趋势区间合计">
            <div className="trend-total-controls"><span>区间合计</span><strong className="trend-total-value" data-testid="trend-total">{formatUsageTotal(trendTotal, unit)}</strong><span>Token</span>
              <UsageUnitButton value={unit} onChange={setUnit}/>
            </div>
            <span>{currentRange.start} 至 {currentRange.end}<i/>共 {trend.length} 天</span>
          </div>
          <div className="chart-legend">{chart === 'line' ? <span><i className="official-dot"/>{sources.find(([key]) => key === source)?.[1]}合计</span> : <>{source !== 'custom' && <span><i className="official-dot"/>阶跃官方</span>}{source !== 'official' && <span><i className="custom-dot"/>自定义第三方</span>}{source === 'all' && data.some(d => d.unknown) && <span>未识别来源</span>}</>}<span className="chart-unit">Token</span></div>
          <div className="chart-scroll"><svg className="usage-chart" viewBox="0 0 980 205" role="img" aria-label={`${trendLabel}${sources.find(([key]) => key === source)?.[1]} Token ${chart === 'bar' ? '柱状' : '折线'}图`}>
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
                aria-label={`${day.date}，${number(tokens(day, source))} Token`}
                {...chartPreview.bind(`trend-${day.date}`, { title: day.date, subtitle: '每日 Token 用量', rows: [
                  ...(source !== 'custom' ? [{ label: '阶跃官方', value: number(day.official), color: 'var(--primary)' }] : []),
                  ...(source !== 'official' ? [{ label: '自定义第三方', value: number(day.custom), color: '#4c9690' }] : []),
                  ...(source === 'all' && day.unknown ? [{ label: '未识别来源', value: number(day.unknown) }] : []),
                  { label: 'Token 合计', value: number(tokens(day, source)), total: true },
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
          {chart === 'line' && <p className="chart-note">折线展示当前筛选来源的 Token 合计。</p>}
        </section>
        {source !== 'custom' ? <section className="usage-cost" aria-label="近一年阶跃官方费用估算"><div><h2>阶跃官方估算</h2><span>近 365 天 · Desktop 已记录的请求</span></div>
          <div><span>Step Plan</span><strong>{estimate('plan')} <small>M Credit</small></strong></div>
          <div><span>官方 API · 国内</span><strong>{estimate('api', '¥')}</strong></div>
          {data.some(day => day.usd !== null) && <div><span>官方 API · 海外</span><strong>{estimate('usd', '$')}</strong></div>}
          <button className="icon-button" aria-label="费用估算范围" data-tooltip="M Credit 与金额分别累计，不相加。仅包含 Desktop 已记录的主会话请求，不是官方账单；历史与子代理用量可能未覆盖。"><CircleHelp size={16}/></button>
        </section> : <p className="third-party-note"><CircleHelp size={14}/>第三方仅统计 Token，不提供费用估算。</p>}
        <footer className="usage-footnote"><span><Check size={13}/>社区版仅保存在本机，暂不支持随账户云端保存或跨设备同步。</span><span>不含其他设备记录与官网账单</span></footer>
        {overview.limited.length > 0 && <p className="coverage-note" role="status">部分历史记录缺少统计元数据，当前结果覆盖不完整。无法识别来源的用量仅计入「全部」，不归入官方或第三方。</p>}
        <p className="chart-note">主会话去重计数；Token 包含已记录的子代理、分支与上下文压缩用量。按本机日期统计。</p>
        {source !== 'custom' && <p className="chart-note">费用仅累计 Desktop 已保存的估算记录，沿用请求发生时的计费模式与规则；未记录的历史显示「—」，不追溯套用当前账户。
          {overview.estimates && ` 已记录 ${overview.estimates.recorded} 次请求${overview.estimates.unknown ? `，其中 ${overview.estimates.unknown} 次无法估算` : ''}。`}
          {overview.estimates?.limited && '部分估算文件未能读取。'}</p>}
      </div>}
    {!embedded && <AppTooltip/>}
    {chartPreview.preview}
  </main></div>;
}
