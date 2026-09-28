import type { SessionStats } from './contracts';

export function ContextRing({ usage, language }: { usage?: SessionStats['contextUsage']; language: 'zh' | 'en' }) {
  const percent = usage?.percent;
  const known = typeof percent === 'number' && Number.isFinite(percent);
  const value = known ? Math.max(0, Math.min(100, percent)) : 0;
  const label = known ? (language === 'zh' ? `已用 ${Math.round(value)}%` : `${Math.round(value)}% used`) : undefined;
  return <div className={`context-ring${known ? '' : ' is-unknown'}`} role="meter" tabIndex={known ? 0 : undefined} aria-label={language === 'zh' ? '上下文用量' : 'Context usage'} aria-valuemin={0} aria-valuemax={100} aria-valuenow={known ? value : undefined} aria-valuetext={label ?? (language === 'zh' ? '未知' : 'Unknown')} data-tooltip={label} style={{ '--context-percent': `${value}%` } as React.CSSProperties}>
    <span className="context-ring-hole"/>
  </div>;
}
