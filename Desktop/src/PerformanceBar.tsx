import { Activity } from 'lucide-react';
import { useLayoutEffect, useRef } from 'react';
import type { SessionStats, Usage } from './contracts';
import { cacheHitRate, displayedUsage, type RunMetrics } from './performance';

const tokenCount = (value: number) => value >= 1000
  ? `${(value / 1000).toFixed(1).replace(/\.0$/, '')}K`
  : String(Math.round(value));
const duration = (ms: number) => ms >= 10000 ? `${Math.round(ms / 1000)}s` : `${(ms / 1000).toFixed(1)}s`;

export function PerformanceBar({ run, stats, connected, language, now }: {
  run: RunMetrics | null; stats?: SessionStats; connected: boolean; language: 'zh' | 'en'; now: number;
}) {
  const summaryRef = useRef<HTMLDivElement>(null);
  const t = (zh: string, en: string) => language === 'zh' ? zh : en;
  useLayoutEffect(() => {
    const element = summaryRef.current;
    if (!element) return;
    const measure = () => {
      const ellipsis = element.querySelector<HTMLElement>('.performance-ellipsis');
      if (!ellipsis) return;
      const metrics = Array.from(element.children).filter((child): child is HTMLElement => child instanceof HTMLElement && child !== ellipsis);
      metrics.forEach(metric => metric.style.removeProperty('display'));
      ellipsis.style.removeProperty('display');
      const rows = (items: HTMLElement[]) => {
        const centers = items.map(item => item.offsetTop + item.offsetHeight / 2).sort((a, b) => a - b);
        return centers.reduce((count, center, index) => count + (index === 0 || center - centers[index - 1] > 8 ? 1 : 0), 0);
      };
      if (rows(metrics) <= 2) return;
      ellipsis.style.display = 'inline-flex';
      for (let index = metrics.length - 1; index >= 0; index--) {
        const visible = metrics.slice(0, index + 1);
        if (rows([...visible, ellipsis]) <= 2 && !metrics[index].classList.contains('performance-divider')) break;
        metrics[index].style.display = 'none';
      }
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    window.addEventListener('resize', measure);
    return () => { observer.disconnect(); window.removeEventListener('resize', measure); };
  }, [run, stats, connected, language, now]);
  if (!connected) return null;
  const usage: Usage = run ? displayedUsage(run) : stats?.tokens ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  const hitRate = cacheHitRate(usage);
  const elapsed = run ? (run.finishedAt ?? now) - run.startedAt : undefined;
  const hasUsage = Boolean(run || stats && (stats.assistantMessages > 0 || stats.toolCalls > 0));
  return <section className="performance-bar" aria-label={t('性能信息', 'Performance')}>
    <div ref={summaryRef} className="performance-summary">
      <span className="performance-title"><Activity size={14}/><strong>{run ? run.finishedAt === undefined ? t('本轮执行中', 'Running') : t('最近一轮', 'Last run') : t('会话用量', 'Session usage')}</strong></span>
      {run && <>
        <span>{run.turns} {t('轮', 'turns')}</span>
        <span>{run.tools} {t('次工具', 'tools')}</span>
        <span title={t('从本轮开始到结束，由桌面端测量', 'Measured locally from run start to finish')}>{t('耗时', 'Elapsed')} <strong>{duration(elapsed!)}</strong></span>
        <span title={t('从本轮开始到首段可见文字，由桌面端测量', 'Locally measured time to first visible text')}>{t('首段文字', 'First text')} <strong>{run.firstTextAt === undefined ? '—' : duration(run.firstTextAt - run.startedAt)}</strong></span>
        <span title={t('每次工具执行时长之和，并行工具也分别计入', 'Sum of tool execution durations, including parallel tools')}>{t('工具累计', 'Tool time')} <strong>{run.tools ? duration(run.toolTimeMs) : '—'}</strong></span>
      </>}
      {hasUsage ? <>
        <span className="performance-divider" aria-hidden="true"/>
        <span>{t('输入', 'In')} <strong>{tokenCount(usage.input + usage.cacheRead + usage.cacheWrite)}</strong></span>
        <span>{t('输出', 'Out')} <strong>{tokenCount(usage.output)}</strong></span>
      </> : <span>{t('尚无用量', 'No usage yet')}</span>}
      <span>{t('缓存读取', 'Cache read')} <strong>{tokenCount(usage.cacheRead)}</strong></span>
      <span title={t('缓存读取 / (输入 + 缓存读取 + 缓存写入)；未报告缓存用量时不计算', 'Cache read / (input + cache read + cache write); unavailable without reported cache usage')}>{t('缓存命中', 'Cache hit')} <strong>{hitRate === undefined ? '—' : `${Math.round(hitRate * 100)}%`}</strong></span>
      <span className="performance-divider" aria-hidden="true"/>
      <span title={t('当前会话的累计用量，包含已压缩的历史', 'Total usage for this session, including compacted history')}>{t('会话累计', 'Session total')} <strong>{stats ? `${tokenCount(stats.tokens.total)} tok · ${stats.toolCalls} ${t('次工具', 'tools')}` : '—'}</strong></span>
      <span className="performance-ellipsis" aria-hidden="true">…</span>
    </div>
  </section>;
}
