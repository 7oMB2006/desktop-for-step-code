import React, { useState } from 'react';
import { X } from 'lucide-react';
import type { ChartPreviewBinding } from './UsageChartPreview';
import type { UsageDay, UsageSource } from './usage-overview';

type Source = 'all' | 'official' | 'custom';
type DailyProps = { day: UsageDay; source: Source; preview: ChartPreviewBinding };
type Model = { id: string; label: string; source: UsageSource; tokens: number; color: string };
const compact = (value: number) => value >= 1e6 ? `${(value / 1e6).toFixed(2)}M` : value >= 1e3 ? `${(value / 1e3).toFixed(1)}K` : Math.round(value).toLocaleString('zh-CN');
const exact = (value: number) => value.toLocaleString('zh-CN');

export function DailyUsage({ day, source, preview }: DailyProps) {
  const [showCacheRate, setShowCacheRate] = useState(true);
  const scope = `${day.date}:${source}`;
  const [selection, setSelection] = useState<{ scope: string; id: string }>();
  const samples = day.samples.filter(sample => source === 'all' || sample.source === source);
  const modelMap = new Map<string, Model>();
  const colors = ['var(--primary)', '#4c9690', '#b18b36', '#678ac2', '#9c78ac'];
  for (const sample of samples) {
    const id = JSON.stringify([sample.source, sample.model]);
    const model = modelMap.get(id) ?? { id, label: sample.model, source: sample.source, tokens: 0, color: '' };
    model.tokens += sample.total; modelMap.set(id, model);
  }
  const models = [...modelMap.values()].filter(model => model.tokens > 0).sort((a, b) => b.tokens - a.tokens)
    .map((model, i) => ({ ...model, color: colors[i % colors.length] }));
  const selected = selection?.scope === scope ? models.find(model => model.id === selection.id) : undefined;
  const total = source === 'official' ? day.official : source === 'custom' ? day.custom : day.official + day.custom + day.unknown;
  const activeTotal = selected?.tokens ?? total;
  const toggle = (model: Model) => setSelection(selected?.id === model.id ? undefined : { scope, id: model.id });
  const hourly = Array.from({ length: 24 }, (_, hour) => {
    const values = samples.filter(sample => sample.hour === hour && (!selected || JSON.stringify([sample.source, sample.model]) === selected.id));
    const sum = (field: 'total' | 'input' | 'output' | 'cached' | 'written') => values.reduce((n, value) => n + value[field], 0);
    const input = sum('input'), output = sum('output'), cached = sum('cached'), written = sum('written');
    const cacheRate = input + cached + written > 0 ? cached / (input + cached + written) : undefined;
    return { hour, total: sum('total'), input, output, cached, written, cacheRate };
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
  const modelPreview = (model: Model) => ({
    title: model.label, subtitle: `${day.date} · ${model.source === 'official' ? '阶跃官方' : model.source === 'custom' ? '自定义第三方' : '未识别来源'}`,
    rows: [
      { label: 'Token 用量', value: exact(model.tokens), color: model.color },
      { label: '当日占比', value: `${(model.tokens / total * 100).toFixed(1)}%` },
    ],
  });
  return <div className="daily-analysis" aria-label="选中日期分析" data-date={day.date} data-model={selected?.id ?? 'all'}>
    <div className="daily-summary">
      <header className="daily-date">
        <span className="daily-date-label">当日记录</span>
        <h2>{new Date(`${day.date}T12:00:00`).toLocaleDateString('zh-CN', { month: 'long', day: 'numeric' })}<small>{new Date(`${day.date}T12:00:00`).toLocaleDateString('zh-CN', { weekday: 'long' })}</small></h2>
        <p>{source === 'official' ? day.officialChats : source === 'custom' ? day.customChats : day.chats} 个主会话<span className="dot-separator">·</span>{models.length} 个模型</p>
        {source !== 'custom' && <p className="daily-estimate">{day.plan === null ? '—' : day.plan.toFixed(2)} M Credit<span className="dot-separator">·</span>{day.api === null ? '—' : `¥${day.api.toFixed(2)}`}
          {day.usd !== null && <><span className="dot-separator">·</span>${day.usd.toFixed(2)}</>}<small>已记录估算</small></p>}
      </header>
      <div className="model-distribution" aria-label="模型分布">
        <svg className="model-ring" viewBox="0 0 160 160" role="group" aria-label="当日模型 Token 占比">
          <circle cx="80" cy="80" r="62" className="ring-track" fill="none" strokeWidth="16"/>
          {models.map((model, index) => <circle key={model.id} cx="80" cy="80" r="62" pathLength="100" fill="none" strokeWidth="16"
            stroke={model.color} strokeDasharray={`${Math.max(0, model.tokens / total * 100 - .7)} 100`} strokeDashoffset={-percentBefore(index)}
            transform="rotate(-90 80 80)" className="model-segment" opacity={selected && selected.id !== model.id ? .25 : 1}
            role="button" tabIndex={0} aria-label={`筛选 ${model.label}`} aria-pressed={selected?.id === model.id}
            {...preview(`ring-${model.id}`, modelPreview(model))}
            onClick={() => toggle(model)} onKeyDown={event => {
              if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); toggle(model); }
            }}/>)}
          <text x="80" y="78" textAnchor="middle" className="ring-total">{compact(activeTotal)}</text>
          <text x="80" y="96" textAnchor="middle" className="ring-caption">{selected ? '已选模型' : 'Token'}</text>
        </svg>
        <div className="model-list" role="group" aria-label="当日模型筛选">
          {models.map(model => <button key={model.id} className="model-row" aria-pressed={selected?.id === model.id} onClick={() => toggle(model)}
            {...preview(`model-${model.id}`, modelPreview(model))} aria-label={`${model.label}，${(model.tokens / total * 100).toFixed(1)}%`}>
            <i style={{ background: model.color }}/><span><strong>{model.label}</strong><small>{compact(model.tokens)} Token</small><span className="model-share-track" aria-hidden="true"><i style={{ width: `${model.tokens / total * 100}%`, background: model.color }}/></span></span>
            <b>{(model.tokens / total * 100).toFixed(1)}%</b>
          </button>)}
          {!models.length && <p className="model-empty">{total ? '当日明细不可用' : '当日暂无模型用量'}</p>}
        </div>
      </div>
    </div>
    <section className="daily-hours" aria-label="当日逐小时用量">
      <div className="daily-time-heading"><span>24 小时时间轴</span>
        <div className="chart-legend daily-legend"><span><i className="input-dot"/>输入与缓存写入</span><span><i className="output-dot"/>输出</span><span><i className="cache-dot"/>缓存读取</span>
          <button className="cache-rate-toggle" aria-pressed={showCacheRate} onClick={() => setShowCacheRate(value => !value)}
            data-tooltip="缓存命中率 = 缓存读取 /（未缓存输入 + 缓存读取 + 缓存写入），不含输出 Token；无输入的时段留空。"><i/>缓存命中率</button>
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
            {...preview(`hour-${hour.hour}`, {
              title: `${day.date} · ${String(hour.hour).padStart(2, '0')}:00–${String(hour.hour + 1).padStart(2, '0')}:00`,
              subtitle: selected?.label ?? '全部模型',
              rows: [
                { label: '未缓存输入', value: exact(hour.input), color: 'var(--primary)' },
                { label: '缓存写入', value: exact(hour.written), color: 'var(--primary)' },
                { label: '输出', value: exact(hour.output), color: '#4c9690' },
                { label: '缓存读取', value: exact(hour.cached), color: 'color-mix(in srgb,var(--primary) 25%,var(--bg))' },
                { label: '缓存命中率', value: hour.cacheRate === undefined ? '—' : `${(hour.cacheRate * 100).toFixed(1)}%`,
                  color: 'color-mix(in srgb,var(--primary) 55%,#6b80d7)', line: true },
                { label: 'Token 合计', value: exact(hour.total), total: true },
              ],
            })}>
            <rect className="chart-hit-area" x={40 + hour.hour * 38.5} y="26" width="38.5" height="116"/>
            {([['input', hour.input + hour.written], ['output', hour.output], ['cache', hour.cached]] as const).map(([type, value]) => {
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
