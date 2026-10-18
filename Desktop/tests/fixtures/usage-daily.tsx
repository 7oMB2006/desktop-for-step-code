import React, { useState } from 'react';
import { X } from 'lucide-react';

type Source = 'all' | 'official' | 'custom';
type DailyProps = { day: { date: string; official: number; custom: number; chats: number; plan: number; api: number }; source: Source };
type Model = { id: string; label: string; source: Exclude<Source, 'all'>; tokens: number; color: string };
const compact = (value: number) => value >= 1e6 ? `${(value / 1e6).toFixed(2)}M` : value >= 1e3 ? `${(value / 1e3).toFixed(1)}K` : Math.round(value).toLocaleString('zh-CN');
const exact = (value: number) => value.toLocaleString('zh-CN');

// Allocate integer fixture totals without losing tokens to rounding.
function allocate(total: number, weights: number[]) {
  const sum = weights.reduce((a, b) => a + b, 0);
  let assigned = 0;
  let cumulative = 0;
  return weights.map(weight => {
    cumulative += weight;
    const target = Math.floor(total * cumulative / sum);
    const value = target - assigned;
    assigned = target;
    return value;
  });
}

export function DailyUsage({ day, source }: DailyProps) {
  const [showCacheRate, setShowCacheRate] = useState(true);
  const scope = `${day.date}:${source}`;
  const [selection, setSelection] = useState<{ scope: string; id: string }>();
  const official = allocate(day.official, [64, 36]);
  const custom = allocate(day.custom, [51, 31, 18]);
  const models: Model[] = [
    { id: 'official-flash', label: 'step-3.7-flash', source: 'official', tokens: official[0], color: 'var(--primary)' },
    { id: 'official-35', label: 'step-3.5-flash', source: 'official', tokens: official[1], color: '#4c9690' },
    { id: 'custom-a', label: '第三方模型 A', source: 'custom', tokens: custom[0], color: '#b18b36' },
    { id: 'custom-b', label: '第三方模型 B', source: 'custom', tokens: custom[1], color: '#678ac2' },
    { id: 'custom-c', label: '第三方模型 C', source: 'custom', tokens: custom[2], color: '#9c78ac' },
  ].filter(model => (source === 'all' || model.source === source) && model.tokens > 0) as Model[];
  const selected = selection?.scope === scope ? models.find(model => model.id === selection.id) : undefined;
  const total = models.reduce((sum, model) => sum + model.tokens, 0);
  const activeTotal = selected?.tokens ?? total;
  const toggle = (model: Model) => setSelection(selected?.id === model.id ? undefined : { scope, id: model.id });
  const seed = Number(day.date.slice(-2));
  const modelHours = models.map((model, index) => allocate(model.tokens, Array.from({ length: 24 }, (_, hour) => {
    if (hour < 7 || hour === 12 || hour > 22) return 0;
    return 1 + ((hour * 7 + seed * 3 + index * 11) % 19);
  })));
  const hourly = Array.from({ length: 24 }, (_, hour) => {
    const value = models.reduce((sum, model, index) =>
      sum + (!selected || model.id === selected.id ? modelHours[index][hour] : 0), 0);
    const [input, output, cached] = allocate(value, [30 + hour % 5, 8 + hour % 3, 62 - hour % 5 - hour % 3]);
    const cacheRate = input + cached > 0 ? cached / (input + cached) : undefined;
    return { hour, total: value, input, output, cached, cacheRate };
  });
  let previousHasInput = false;
  const cachePath = hourly.map(hour => {
    if (hour.cacheRate === undefined) { previousHasInput = false; return ''; }
    const command = previousHasInput ? 'L' : 'M';
    previousHasInput = true;
    return `${command}${40 + hour.hour * 38.5 + 19},${130 - hour.cacheRate * 100}`;
  }).join(' ');
  const peak = Math.max(1, ...hourly.map(hour => hour.total));
  const percentBefore = (index: number) => models.slice(0, index).reduce((sum, model) => sum + model.tokens / total * 100, 0);
  return <div className="daily-analysis" aria-label="选中日期分析" data-date={day.date} data-model={selected?.id ?? 'all'}>
    <div className="daily-summary">
      <header className="daily-date">
        <span className="daily-date-label">当日记录</span>
        <h2>{new Date(`${day.date}T12:00:00`).toLocaleDateString('zh-CN', { month: 'long', day: 'numeric' })}<small>{new Date(`${day.date}T12:00:00`).toLocaleDateString('zh-CN', { weekday: 'long' })}</small></h2>
        <p>{total ? day.chats : 0} 个会话<span className="dot-separator">·</span>{models.length} 个模型</p>
        {source !== 'custom' && <p className="daily-estimate">{day.plan.toFixed(2)} M Credit<span className="dot-separator">·</span>¥{day.api.toFixed(2)}<small>估算</small></p>}
      </header>
      <div className="model-distribution" aria-label="模型分布">
        <svg className="model-ring" viewBox="0 0 160 160" role="group" aria-label="当日模型 Token 占比">
          <circle cx="80" cy="80" r="62" className="ring-track" fill="none" strokeWidth="16"/>
          {models.map((model, index) => <circle key={model.id} cx="80" cy="80" r="62" pathLength="100" fill="none" strokeWidth="16"
            stroke={model.color} strokeDasharray={`${Math.max(0, model.tokens / total * 100 - .7)} 100`} strokeDashoffset={-percentBefore(index)}
            transform="rotate(-90 80 80)" className="model-segment" opacity={selected && selected.id !== model.id ? .25 : 1}
            role="button" tabIndex={0} aria-label={`筛选 ${model.label}`} aria-pressed={selected?.id === model.id}
            data-tooltip={`${model.label} · ${exact(model.tokens)} Token · ${(model.tokens / total * 100).toFixed(1)}%`}
            onClick={() => toggle(model)} onKeyDown={event => {
              if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); toggle(model); }
            }}/>)}
          <text x="80" y="78" textAnchor="middle" className="ring-total">{compact(activeTotal)}</text>
          <text x="80" y="96" textAnchor="middle" className="ring-caption">{selected ? '已选模型' : 'Token'}</text>
        </svg>
        <div className="model-list" role="group" aria-label="当日模型筛选">
          {models.map(model => <button key={model.id} className="model-row" aria-pressed={selected?.id === model.id} onClick={() => toggle(model)}
            data-tooltip={`${model.label} · ${exact(model.tokens)} Token`} aria-label={`${model.label}，${(model.tokens / total * 100).toFixed(1)}%`}>
            <i style={{ background: model.color }}/><span><strong>{model.label}</strong><small>{compact(model.tokens)} Token</small><span className="model-share-track" aria-hidden="true"><i style={{ width: `${model.tokens / total * 100}%`, background: model.color }}/></span></span>
            <b>{(model.tokens / total * 100).toFixed(1)}%</b>
          </button>)}
          {!models.length && <p className="model-empty">当日暂无模型用量</p>}
        </div>
      </div>
    </div>
    <section className="daily-hours" aria-label="当日逐小时用量">
      <div className="daily-time-heading"><span>24 小时时间轴</span>
        <div className="chart-legend daily-legend"><span><i className="input-dot"/>未缓存输入</span><span><i className="output-dot"/>输出</span><span><i className="cache-dot"/>缓存读取</span>
          <button className="cache-rate-toggle" aria-pressed={showCacheRate} onClick={() => setShowCacheRate(value => !value)}
            data-tooltip="缓存命中率 = 缓存读取 /（未缓存输入 + 缓存读取），不含输出 Token；无输入的时段留空。"><i/>缓存命中率</button>
        </div>
      </div>
      <div className="daily-chart-scroll"><svg className="daily-hour-chart" viewBox="0 0 1030 165" role="img" aria-label={`${day.date} ${selected?.label ?? '全部模型'}逐小时 Token 与缓存命中率图`}>
        {[0, 1, 2].map(i => <g key={i}>
          <line x1="40" x2="970" y1={30 + i * 50} y2={30 + i * 50} className="chart-gridline"/>
          <text x="0" y={34 + i * 50}>{compact(peak * (1 - i / 2))}</text>
        </g>)}
        {hourly.map(hour => {
          let bottom = 130;
          return <g key={hour.hour} className="hour-bar" data-hour={hour.hour} data-tokens={hour.total} tabIndex={hour.total ? 0 : undefined}
            data-input={hour.input} data-cached={hour.cached} data-cache-rate={hour.cacheRate}
            role={hour.total ? 'img' : undefined} aria-label={hour.total ? `${hour.hour}:00，${exact(hour.total)} Token，缓存命中率 ${hour.cacheRate === undefined ? '—' : `${(hour.cacheRate * 100).toFixed(1)}%`}` : undefined}
            data-tooltip={hour.total ? `${hour.hour}:00 · 未缓存输入 ${exact(hour.input)} / 输出 ${exact(hour.output)} / 缓存读取 ${exact(hour.cached)} · 合计 ${exact(hour.total)} Token · 缓存命中率 ${hour.cacheRate === undefined ? '—' : `${(hour.cacheRate * 100).toFixed(1)}%`}` : undefined}>
            {([['input', hour.input], ['output', hour.output], ['cache', hour.cached]] as const).map(([type, value]) => {
              const height = value / peak * 100; bottom -= height;
              return <rect key={type} x={40 + hour.hour * 38.5 + 8} y={bottom} width="22" height={height} rx="1.5" className={`hour-${type}`}/>;
            })}
            <circle cx={40 + hour.hour * 38.5 + 19} cy="138" r="1.4" className={hour.total ? 'hour-active-dot' : 'hour-idle-dot'}/>
          </g>;
        })}
        {showCacheRate && <g className="cache-rate-series" aria-label="缓存命中率">
          {[100, 50, 0].map((value, i) => <text key={value} x="982" y={34 + i * 50} className="cache-rate-axis">{value}%</text>)}
          <path d={cachePath} className="cache-rate-line"/>
          {hourly.filter(hour => hour.cacheRate !== undefined).map(hour => <circle key={hour.hour}
            cx={40 + hour.hour * 38.5 + 19} cy={130 - hour.cacheRate! * 100} r="2.5" className="cache-rate-point"
            data-hour={hour.hour} data-rate={hour.cacheRate}/>)}
        </g>}
        {[0, 6, 12, 18, 23].map(hour => <text key={hour} x={40 + hour * 38.5 + 19} y="159" textAnchor="middle">{String(hour).padStart(2, '0')}:00</text>)}
      </svg></div>
      <div className="daily-chart-footer"><span>{selected ? '当前模型' : '当日合计'} <strong data-testid="daily-hour-total">{compact(activeTotal)}</strong> Token</span>
        {selected && <button className="selected-model" onClick={() => setSelection(undefined)} aria-label="清除模型筛选"><span>{selected.label}</span><X size={12}/></button>}
        {!total && <span>当日暂无记录</span>}
      </div>
    </section>
  </div>;
}
