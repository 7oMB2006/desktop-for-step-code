import type { SessionStats } from './contracts';

export function ContextRing({ usage, language, decorative = false }: { usage?: SessionStats['contextUsage']; language: 'zh' | 'en'; decorative?: boolean }) {
  const percent = usage?.percent;
  const known = typeof percent === 'number' && Number.isFinite(percent);
  const value = known ? Math.max(0, Math.min(100, percent)) : 0;
  const label = known ? (language === 'zh' ? `已用 ${Math.round(value)}%` : `${Math.round(value)}% used`) : undefined;
  const Tag = decorative ? 'span' : 'div';
  return <Tag className={`context-ring${known ? '' : ' is-unknown'}`} role={decorative ? undefined : 'meter'} tabIndex={!decorative && known ? 0 : undefined} aria-hidden={decorative || undefined} aria-label={decorative ? undefined : language === 'zh' ? '上下文用量' : 'Context usage'} aria-valuemin={decorative ? undefined : 0} aria-valuemax={decorative ? undefined : 100} aria-valuenow={!decorative && known ? value : undefined} aria-valuetext={decorative ? undefined : label ?? (language === 'zh' ? '未知' : 'Unknown')} data-tooltip={decorative ? undefined : label} style={{ '--context-percent': `${value}%` } as React.CSSProperties}>
    <span className="context-ring-hole"/>
  </Tag>;
}
