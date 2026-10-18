import { ArrowLeft } from 'lucide-react';
import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { emptyUsageOverview } from './usage-overview';
import './usage-overview-preview.css';

const Overview = lazy(() => import('./UsageOverviewView').then(module => ({ default: module.UsageOverviewView })));

export function UsageOverviewPanel({ onBack, language }: { onBack: () => void; language: string }) {
  const back = useRef<HTMLButtonElement>(null);
  const zh = language === 'zh';
  const [overview, setOverview] = useState(emptyUsageOverview);
  const [pending, setPending] = useState(true);
  const [error, setError] = useState(false);
  const alive = useRef(false);
  const refresh = useCallback(async () => {
    setPending(true); setError(false);
    try {
      const value = await window.desktop!.usageOverview();
      if (alive.current) setOverview(value);
    } catch { if (alive.current) setError(true); }
    finally { if (alive.current) setPending(false); }
  }, []);
  useEffect(() => {
    alive.current = true; void refresh();
    return () => { alive.current = false; };
  }, [refresh]);
  useLayoutEffect(() => {
    back.current?.focus({ preventScroll: true });
    return () => {
      document.querySelector<HTMLElement>('.sidebar-identity.usage-entry')?.focus({ preventScroll: true });
    };
  }, []);
  return <section className="usage-overview-preview" aria-label={zh ? '用量统计' : 'Usage overview'}>
    <header>
      <button ref={back} onClick={onBack}><ArrowLeft size={15}/>{zh ? '返回会话' : 'Back to conversation'}</button>
      <span>{zh ? '用量统计 · 本机记录' : 'Usage overview · Local records'}</span>
    </header>
    <div className="usage-overview-scroll"><Suspense fallback={<p role="status">加载中...</p>}>
      {pending && !overview.scannedAt ? <p role="status">正在读取本机用量记录…</p>
        : <Overview embedded overview={overview} pending={pending} error={error} onRefresh={() => { void refresh(); }}/>}
    </Suspense></div>
  </section>;
}
