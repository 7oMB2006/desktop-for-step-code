import { Database, Timer, Zap } from 'lucide-react';
import type { SessionStats } from './contracts';
import { cacheHitRate, displayedUsage, outputTokensPerSecond, type RunMetrics } from './performance';

const tokenCount = (value: number) => value >= 1000
  ? `${(value / 1000).toFixed(1).replace(/\.0$/, '')}K`
  : String(Math.round(value));
const duration = (ms: number) => ms >= 10000 ? `${Math.round(ms / 1000)}s` : `${(ms / 1000).toFixed(1)}s`;

export function PerformanceBar({ run, stats, connected, language, now }: {
  run: RunMetrics | null; stats?: SessionStats; connected: boolean; language: 'zh' | 'en'; now: number;
}) {
  if (!connected) return null;
  const t = (zh: string, en: string) => language === 'zh' ? zh : en;
  const usage = run ? run.usageReported || run.liveUsage ? displayedUsage(run) : undefined : stats && stats.assistantMessages > 0 ? stats.tokens : undefined;
  const hitRate = usage ? cacheHitRate(usage) : undefined;
  const elapsed = run ? Math.max(0, (run.finishedAt ?? now) - run.startedAt) : undefined;
  const speed = outputTokensPerSecond(run);
  const values = [
    { icon: Timer, value: elapsed === undefined ? '—' : duration(elapsed), hint: t('本轮总耗时，包含工具执行与等待', 'Total run duration, including tools and waits') },
    { icon: Zap, value: speed === undefined ? '—' : `${speed.toFixed(1).replace(/\.0$/, '')} tok/s`, hint: t('估算输出速度：本轮已完成响应的输出 Token / 接收输出流时长；不含首 Token 等待、工具执行与审批。缺少用量或有效时长时不计算。', 'Estimated speed: output tokens / received streaming duration for measured completed responses; excludes first-token wait, tools and approvals. Unknown without usage or valid timing.') },
    { icon: Database, value: usage ? `${tokenCount(usage.input + usage.cacheRead + usage.cacheWrite)} / ${tokenCount(usage.output)}` : '— / —', hint: run ? t('本轮 Token：输入 / 输出，输入包含缓存读取与写入', 'Run tokens: input / output; input includes cache reads and writes') : t('会话累计 Token：输入 / 输出，输入包含缓存读取与写入', 'Session tokens: input / output; input includes cache reads and writes') },
    { label: t('缓存命中', 'Cache hit'), value: hitRate === undefined ? '—' : `${Math.round(hitRate * 100)}%`, hint: t('缓存读取 /（输入 + 缓存读取 + 缓存写入）；未报告缓存用量时不计算', 'Cache read / (input + cache read + cache write); unknown without reported cache usage') },
  ];
  return <section className="performance-bar" aria-label={t('性能信息', 'Performance')}>
    <div className="performance-summary">
      {values.map(({ icon: Icon, value, label, hint }) => <span className="performance-metric" key={hint} tabIndex={0} data-tooltip={hint} aria-label={`${hint}: ${value}`}>
        {Icon && <Icon size={13} aria-hidden="true"/>}{label && <span>{label}</span>}<strong>{value}</strong>
      </span>)}
    </div>
  </section>;
}
