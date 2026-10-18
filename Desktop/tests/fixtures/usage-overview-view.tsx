import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Activity, ArrowUpRight, BarChart3, CalendarDays, Check, CircleHelp, Database, HardDrive, LineChart, RefreshCw, SunMoon } from 'lucide-react';
import { AppTooltip } from '../../src/AppTooltip';
import { DailyUsage } from './usage-daily';
import './usage-overview.css';

type Source = 'all' | 'official' | 'custom';
type Day = { date: string; official: number; custom: number; chats: number; plan: number; api: number };
const today = new Date(2026, 9, 18);
const dateKey = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const days: Day[] = Array.from({ length: 365 }, (_, i) => {
  const date = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 364 + i);
  const active = (i * 17 + 13) % 23 > 4 && date.getDay() !== 6;
  const official = active ? Math.round((0.25 + ((i * 37) % 101) / 35) * 1_000_000) : 0;
  const custom = active && i % 3 !== 0 ? Math.round((0.12 + ((i * 19) % 47) / 42) * 1_000_000) : 0;
  return { date: dateKey(date), official, custom, chats: active ? 2 + i % 9 : 0,
    plan: official * 0.00000058, api: official * 0.00000021 };
});
const tokens = (day: Day, source: Source) => source === 'official' ? day.official : source === 'custom' ? day.custom : day.official + day.custom;
const compact = (value: number) => value >= 1e6 ? `${(value / 1e6).toFixed(2)}M` : value >= 1e3 ? `${(value / 1e3).toFixed(1)}K` : value.toLocaleString('zh-CN');
const number = (value: number) => value.toLocaleString('zh-CN', { maximumFractionDigits: 2 });
const prettyDate = (value: string) => new Date(`${value}T12:00:00`).toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'short' });
const sources: [Source, string][] = [['all', '全部'], ['official', '阶跃官方'], ['custom', '自定义第三方']];
const offset = (new Date(`${days[0].date}T12:00:00`).getDay() + 6) % 7;
const cells: (Day | null)[] = [...Array.from({ length: offset }, () => null), ...days];
while (cells.length % 7) cells.push(null);

export function UsageOverviewView({ embedded = false, initialScenario = 'ready' }: { embedded?: boolean; initialScenario?: string }) {
  const [source, setSource] = useState<Source>('all');
  const [selected, setSelected] = useState(days.length - 1);
  const [period, setPeriod] = useState(30);
  const [chart, setChart] = useState<'bar' | 'line'>('bar');
  const [scenario, setScenario] = useState(initialScenario);
  const [refreshed, setRefreshed] = useState(false);
  const [theme, setTheme] = useState(document.documentElement.dataset.theme);
  const heatScroll = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const container = heatScroll.current;
    const selectedCell = container?.querySelector<HTMLElement>('.heat-cell.is-selected');
    if (container && selectedCell && container.scrollWidth > container.clientWidth)
      container.scrollLeft = selectedCell.offsetLeft - container.offsetLeft - container.clientWidth + 24;
  }, [selected, scenario]);
  const data = scenario === 'empty' ? days.map(day => ({ ...day, official: 0, custom: 0, chats: 0, plan: 0, api: 0 })) : days;
  const total = data.reduce((sum, day) => sum + tokens(day, source), 0);
  const active = data.filter(day => tokens(day, source) > 0).length;
  const chats = data.reduce((sum, day) => sum + (tokens(day, source) > 0 ? day.chats : 0), 0);
  const daily = data[selected];
  const trend = data.slice(-period);
  const max = Math.max(1, ...data.map(day => tokens(day, source)));
  const trendMax = Math.max(1, ...trend.map(day => tokens(day, source)));
  const plan = data.reduce((sum, day) => sum + day.plan, 0);
  const api = data.reduce((sum, day) => sum + day.api, 0);
  const points = useMemo(() => trend.map((day, i) => `${34 + i / (trend.length - 1) * 920},${174 - tokens(day, source) / trendMax * 146}`).join(' '), [trend, source, trendMax]);
  const pending = scenario === 'loading';
  const refresh = () => { setScenario('ready'); setRefreshed(true); };
  return <div className={`usage-preview-surface${embedded ? ' is-embedded' : ''}`}><main className="usage-page">
    <header className="usage-header">
      <div className="usage-title"><img src={new URL('../../public/StepCode.svg', import.meta.url).href} alt="" width="27" height="27"/><h1>用量</h1><span className="usage-badge"><HardDrive size={12}/>仅本机</span></div>
      <div className="preview-actions"><span>示例数据</span><select aria-label="预览状态" value={scenario} onChange={event => setScenario(event.target.value)}>
        <option value="ready">正常</option><option value="empty">无记录</option><option value="loading">加载中</option><option value="error">扫描失败</option><option value="partial">覆盖不完整</option>
      </select>{!embedded && <button className="icon-button" aria-label="切换主题" data-tooltip="切换主题" onClick={() => {
        const next = theme === 'dark' ? 'light' : 'dark'; setTheme(next); document.documentElement.dataset.theme = next;
      }}><SunMoon size={17}/></button>}</div>
    </header>
    <nav className="usage-tabs" aria-label="用量页面"><span aria-current="page">统计总览</span>{!embedded && <a href="./usage-account.html?state=token">套餐与余额<ArrowUpRight size={12}/></a>}</nav>
    <div className="usage-toolbar"><div className="segmented" role="group" aria-label="统计来源">{sources.map(([key, label]) =>
      <button key={key} aria-pressed={source === key} onClick={() => setSource(key)}>{label}</button>)}</div>
      <div className="scan-state"><span>{refreshed ? '刚刚更新' : '更新于 14:32'}</span><button className="icon-button" aria-label="刷新统计" data-tooltip="刷新本机统计" onClick={refresh}><RefreshCw size={14}/></button></div>
    </div>
    {scenario === 'error' ? <section className="usage-error" role="alert"><Activity size={24}/><h2>暂时无法读取本机记录</h2><p>会话文件没有改变，请重新扫描。</p><button onClick={refresh}>重新扫描</button></section> :
      <div className={pending ? 'usage-body is-loading' : 'usage-body'} aria-busy={pending}>
        <section className="usage-summary" aria-label="近一年统计">
          <div><span><Database size={14}/>Token 总量</span><strong>{compact(total)}</strong><small>近 365 天</small></div>
          <div><span><CalendarDays size={14}/>活跃天数</span><strong>{active}<small>天</small></strong><small>有用量的本地日期</small></div>
          <div><span><Activity size={14}/>会话数</span><strong>{number(chats)}</strong><small>主会话</small></div>
          <div><span>活跃日均</span><strong>{compact(active ? total / active : 0)}</strong><small>Token / 天</small></div>
        </section>
        <section className="usage-activity" aria-labelledby="activity-title">
          <div className="section-heading"><h2 id="activity-title">活跃记录</h2><span>2025.10.19 — 2026.10.18</span></div>
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
                  data-tooltip={`${prettyDate(day.date)} · ${compact(value)} Token`} onClick={() => setSelected(dayIndex)}
                  onKeyDown={event => {
                    const delta = ({ ArrowLeft: -7, ArrowRight: 7, ArrowUp: -1, ArrowDown: 1 } as Record<string, number>)[event.key];
                    if (delta === undefined) return;
                    event.preventDefault(); const next = Math.max(0, Math.min(364, dayIndex + delta)); setSelected(next);
                    (event.currentTarget.parentElement?.querySelectorAll('button')[next] as HTMLButtonElement)?.focus();
                  }}/>;
              })}</div>
            </div>
          </div>
          <div className="heat-footer"><span>{scenario === 'empty' ? '还没有本机用量记录' : `一年里，${active} 天与你一起工作`}</span><div className="heat-legend"><span>少</span>{[0, 1, 2, 3, 4].map(level => <i key={level} className={`level-${level}`}/>)}<span>多</span></div></div>
        </section>
        <DailyUsage key={`${daily.date}:${source}`} day={daily} source={source}/>
        <section className="usage-trends" aria-labelledby="trend-title">
          <div className="section-heading"><h2 id="trend-title">用量趋势</h2><div className="trend-controls"><div className="segmented compact" role="group" aria-label="趋势时间范围">
            {[7, 30, 90].map(value => <button key={value} aria-pressed={period === value} onClick={() => setPeriod(value)}>近 {value} 天</button>)}</div>
            <div className="chart-switch" role="group" aria-label="图表类型"><button className="icon-button" aria-pressed={chart === 'bar'} aria-label="柱状图" data-tooltip="柱状图" onClick={() => setChart('bar')}><BarChart3 size={16}/></button><button className="icon-button" aria-pressed={chart === 'line'} aria-label="折线图" data-tooltip="折线图" onClick={() => setChart('line')}><LineChart size={16}/></button></div></div>
          </div>
          <div className="chart-legend">{chart === 'line' ? <span><i className="official-dot"/>{sources.find(([key]) => key === source)?.[1]}合计</span> : <>{source !== 'custom' && <span><i className="official-dot"/>阶跃官方</span>}{source !== 'official' && <span><i className="custom-dot"/>自定义第三方</span>}</>}<span className="chart-unit">Token</span></div>
          <div className="chart-scroll"><svg className="usage-chart" viewBox="0 0 980 205" role="img" aria-label={`近${period}天${sources.find(([key]) => key === source)?.[1]} Token ${chart === 'bar' ? '柱状' : '折线'}图`}>
            {[0, 1, 2, 3].map(i => <g key={i}><line x1="34" y1={28 + i * 146 / 3} x2="966" y2={28 + i * 146 / 3} className="chart-gridline"/><text x="0" y={32 + i * 146 / 3}>{compact(trendMax * (1 - i / 3))}</text></g>)}
            {chart === 'line' ? <polyline points={points} fill="none" className="chart-line"/> : trend.map((day, i) => {
              const width = 920 / period, official = source === 'custom' ? 0 : day.official / trendMax * 146;
              const custom = source === 'official' ? 0 : day.custom / trendMax * 146;
              return <g key={day.date}><title>{day.date} · {number(tokens(day, source))} Token</title>
                <rect x={34 + i * width + 2} y={174 - official} width={Math.max(2, width - 4)} height={official} rx="2" className="bar-official"/>
                <rect x={34 + i * width + 2} y={174 - official - custom} width={Math.max(2, width - 4)} height={custom} rx="2" className="bar-custom"/></g>;
            })}
            {[0, Math.floor(period / 2), period - 1].map((i, j) => <text key={i} x={34 + i / (period - 1) * 920} y="199" textAnchor={j === 0 ? 'start' : j === 2 ? 'end' : 'middle'}>{trend[i].date.slice(5).replace('-', '/')}</text>)}
          </svg></div>
          {chart === 'line' && <p className="chart-note">折线展示当前筛选来源的 Token 合计。</p>}
        </section>
        {source !== 'custom' ? <section className="usage-cost" aria-label="近一年阶跃官方费用估算"><div><h2>阶跃官方估算</h2><span>近 365 天 · Desktop 已记录的请求</span></div>
          <div><span>Step Plan</span><strong>{number(plan)} <small>M Credit</small></strong></div>
          <div><span>官方 API · 国内</span><strong>¥{number(api)}</strong></div>
          <button className="icon-button" aria-label="费用估算范围" data-tooltip="M Credit 与金额分别累计，不相加。仅包含 Desktop 已记录的主会话请求，不是官方账单；历史与子代理用量可能未覆盖。"><CircleHelp size={16}/></button>
        </section> : <p className="third-party-note"><CircleHelp size={14}/>第三方仅统计 Token，不提供费用估算。</p>}
        <footer className="usage-footnote"><span><Check size={13}/>数据保存在本机，不上传云端</span><span>不含其他设备记录与官网账单</span></footer>
        {scenario === 'partial' && <p className="coverage-note" role="status">部分历史记录缺少统计元数据，当前结果覆盖不完整。</p>}
      </div>}
    {!embedded && <AppTooltip/>}
  </main></div>;
}
