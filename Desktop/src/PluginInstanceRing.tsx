import { useId } from 'react';
import './plugin-instance-ring.css';

export type PluginInstancePhase = 'idle' | 'occupied' | 'unknown' | 'loading' | 'done' | 'failed' | 'cancelled';

export function PluginInstanceRing({ phases, language, doneLabel }: {
  phases: readonly PluginInstancePhase[]; language: string; doneLabel?: string;
}) {
  const hatchId = useId(), zh = language === 'zh';
  const names = zh
    ? { done: '成功', failed: '失败', loading: '进行中', cancelled: '已取消', idle: '空闲', occupied: '占用', unknown: '待确认' }
    : { done: 'loaded', failed: 'failed', loading: 'loading', cancelled: 'cancelled', idle: 'ready', occupied: 'in use', unknown: 'unconfirmed' };
  const counts = new Map<PluginInstancePhase, number>();
  for (const phase of phases) counts.set(phase, (counts.get(phase) ?? 0) + 1);
  const label = [...counts].map(([phase, count]) => {
    const state = phase === 'done' && doneLabel ? doneLabel : names[phase];
    return zh ? `${count} 个${state}` : `${count} ${state}`;
  }).join(zh ? '，' : ', ');
  const complete = phases.length > 0 && counts.get('done') === phases.length;
  const arc = 100 / Math.max(1, phases.length), gap = phases.length > 1 && !complete ? Math.min(2, arc / 4) : 0;
  return <svg className="lc-instance-ring" viewBox="0 0 24 24" role="img" aria-label={`${zh ? '运行实例：' : 'Instances: '}${label}`}
    data-complete={complete} data-total={phases.length} data-done={counts.get('done') ?? 0}>
    <defs><pattern id={hatchId} className="lc-ring-hatch" width="4" height="4" patternUnits="userSpaceOnUse"
      patternTransform="rotate(45)"><rect width="4" height="4"/><path d="M0 0V4"/></pattern></defs>
    {phases.map((phase, index) => {
      const dash = `${arc - gap} ${100 - arc + gap}`, offset = -(index * arc + gap / 2);
      return <g key={index} className="lc-ring-segment" data-phase={phase}>
        <circle className="lc-ring-base" cx="12" cy="12" r="9" pathLength="100" data-phase={phase}
          strokeDasharray={dash} strokeDashoffset={offset}/>
        <circle className="lc-ring-texture" cx="12" cy="12" r="9" pathLength="100" aria-hidden="true"
          style={{ stroke: `url(#${hatchId})`, opacity: phase === 'occupied' ? 1 : 0 }}
          strokeDasharray={dash} strokeDashoffset={offset}/>
        <g className="lc-ring-activity" aria-hidden="true" style={{ opacity: phase === 'loading' ? 1 : 0 }}>
          <circle cx="12" cy="12" r="9" pathLength="100" strokeDasharray={dash} strokeDashoffset={offset}/>
        </g>
      </g>;
    })}
  </svg>;
}
