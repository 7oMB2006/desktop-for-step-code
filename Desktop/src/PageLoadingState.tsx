import { Suspense, useCallback, useState, type ReactNode } from 'react';
import { MatrixPulse } from './WorkingIndicator';
import './page-loading-state.css';

export function PageLoadingState({ pending, message, children }: {
  pending: boolean; message: string; children: ReactNode;
}) {
  const [contentMounted, setContentMounted] = useState(false);
  const onContentMount = useCallback((node: HTMLDivElement | null) => {
    setContentMounted(node !== null);
  }, []);
  const loading = pending || !contentMounted;

  return <div className="page-loading-pane">
    <div className="page-loading-scroll">
      <Suspense fallback={null}>
        {!pending && <div className="page-loading-content" ref={onContentMount}>{children}</div>}
      </Suspense>
    </div>
    <div className="page-loading-overlay" data-exiting={!loading} aria-hidden={!loading}>
      <div className="page-loading-state" role="status">
        <MatrixPulse/>
        <span>{message}</span>
      </div>
    </div>
  </div>;
}
