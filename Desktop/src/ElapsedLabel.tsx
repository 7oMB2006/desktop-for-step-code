import { useEffect, useState } from 'react';
import type { ElapsedTiming } from './contracts';
import { elapsedTime } from './elapsed-time';

export function ElapsedLabel({ timing, language, total = false, active = false }: {
  timing?: ElapsedTiming; language: 'zh' | 'en'; total?: boolean; active?: boolean;
}) {
  const [now, setNow] = useState(Date.now);
  const running = active && timing?.endedAt === undefined;
  useEffect(() => {
    if (!running) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [running, timing?.startedAt]);
  if (!timing || (!active && timing.endedAt === undefined)) return null;
  return <span className={`elapsed-label${total ? ' elapsed-total' : ''}`}>
    {language === 'zh' ? total ? '共耗时 ' : '已耗时 ' : total ? 'Total ' : 'Elapsed '}
    <span>{elapsedTime(timing, now)}</span>
  </span>;
}
