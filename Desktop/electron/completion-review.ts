import type { SessionRuntime } from './session-runtimes';
import { emptyLaunch } from '../src/launch-state';

export function reviewPayload(worker: SessionRuntime, payload: Record<string, unknown>, selected = worker.launch) {
  if (!selected?.reviewArmed) return payload;
  if (worker.state?.desktopCompletionReview !== 1) throw new Error('This runtime does not support completion review');
  if (selected.plan || selected.goalArmed || selected.goal?.status === 'active'
    || selected.ultracode || selected.ultracodeArmed || selected.ultracodeTurn
    || String(payload.message ?? '').trimStart().startsWith('/')
    || /^(?:ultracode|ultraloop):/i.test(String(payload.message ?? '').trimStart()))
    throw new Error('Completion review is only available for ordinary main tasks');
  return { ...payload, completionReview: true };
}
export function consumeReview(worker: SessionRuntime, payload: Record<string, unknown>) {
  if (payload.completionReview === true) {
    worker.launch ??= emptyLaunch();
    worker.launch.reviewArmed = false;
  }
}
