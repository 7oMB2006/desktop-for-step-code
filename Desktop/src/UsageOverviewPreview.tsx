import { ArrowLeft } from 'lucide-react';
import { lazy, Suspense, useLayoutEffect, useRef } from 'react';
import './usage-overview-preview.css';

const Overview = lazy(() => import('../tests/fixtures/usage-overview-view').then(module => ({ default: module.UsageOverviewView })));

export function UsageOverviewPreview({ onBack, language }: { onBack: () => void; language: string }) {
  const back = useRef<HTMLButtonElement>(null);
  const zh = language === 'zh';
  useLayoutEffect(() => {
    back.current?.focus({ preventScroll: true });
    return () => {
      document.querySelector<HTMLElement>('.sidebar-identity.usage-entry')?.focus({ preventScroll: true });
    };
  }, []);
  return <section className="usage-overview-preview" aria-label={zh ? '用量统计' : 'Usage overview'}>
    <header>
      <button ref={back} onClick={onBack}><ArrowLeft size={15}/>{zh ? '返回会话' : 'Back to conversation'}</button>
      <span>{zh ? '用量统计 · 示例数据' : 'Usage overview · Sample data'}</span>
    </header>
    <div className="usage-overview-scroll"><Suspense fallback={<p role="status">加载中...</p>}><Overview embedded/></Suspense></div>
  </section>;
}
