import { lazy, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { PageLoadingState } from './PageLoadingState';
import { emptyUsageOverview } from './usage-overview';
import './usage-overview-preview.css';

const Overview = lazy(() => import('./UsageOverviewView').then(module => ({ default: module.UsageOverviewView })));

export function UsageOverviewPanel({ onBack, language }: { onBack: () => void; language: string }) {
  const panel = useRef<HTMLElement>(null);
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
    const surface = panel.current;
    surface?.focus({ preventScroll: true });
    return () => {
      if (!surface?.contains(document.activeElement)) return;
      const entry = document.querySelector<HTMLButtonElement>('.sidebar-utility-links .usage-entry');
      const target = entry?.getClientRects().length && !entry.closest('[inert]')
        ? entry : document.querySelector<HTMLButtonElement>('.window-sidebar-toggle');
      target?.focus({ preventScroll: true });
    };
  }, []);
  return <section ref={panel} tabIndex={-1} className="usage-overview-preview" aria-label={zh ? '用量统计' : 'Usage overview'}
    onKeyDown={event => {
      if (event.key === 'Escape' && event.target === event.currentTarget && !event.nativeEvent.isComposing) {
        event.preventDefault();
        onBack();
      }
    }}>
    <PageLoadingState pending={pending && !overview.scannedAt} message={zh ? '正在加载本机用量统计…' : 'Loading local usage overview...'}>
      <Overview embedded language={language} overview={overview} pending={pending} error={error} onRefresh={() => { void refresh(); }}/>
    </PageLoadingState>
  </section>;
}
