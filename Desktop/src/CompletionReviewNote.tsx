import { ScanLine } from 'lucide-react';
import { reviewLabel, reviewReason, type CompletionReview } from './completion-review';

export function CompletionReviewNote({ language, index, result }: { language: 'zh' | 'en'; index: number; result?: CompletionReview }) {
  const zh = language === 'zh';
  return <div className="client-event-note completion-review-note" role="note" data-message-index={index}>
    <ScanLine size={14} aria-hidden="true"/><span><strong>{result ? reviewLabel(result.status, zh) : zh ? '自动自查' : 'Automatic self-review'}</strong>
      {result ? <>: {reviewReason(result.reason, zh) || (zh ? '同会话自查已结束，不代表独立验证通过' : 'Same-session review ended; not independent verification')}</>
        : <>: {zh ? '同一会话核对原任务，补验证与修复' : 'Checking the original task in the same session, including verification and fixes'}</>}</span>
  </div>;
}
