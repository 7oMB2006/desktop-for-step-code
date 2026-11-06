import type { SessionRuntime } from './session-runtimes';
import { emptyLaunch, type LaunchState } from '../src/launch-state';

function ordinaryLaunch(selected?: LaunchState) {
  return !selected?.plan && !selected?.goalArmed && selected?.goal?.status !== 'active'
    && !selected?.ultracode && !selected?.ultracodeArmed && !selected?.ultracodeTurn;
}
export function reviewPayload(worker: SessionRuntime, payload: Record<string, unknown>, selected = worker.launch) {
  if (!selected?.reviewArmed) return payload;
  if (worker.state?.desktopCompletionReview !== 1) throw new Error('This runtime does not support completion review');
  if (!ordinaryLaunch(selected)
    || String(payload.message ?? '').trimStart().startsWith('/')
    || /^(?:ultracode|ultraloop):/i.test(String(payload.message ?? '').trimStart()))
    throw new Error('Completion review is only available for ordinary main tasks');
  return { ...payload, completionReview: true };
}
export function reserveReview(worker: SessionRuntime, payload: Record<string, unknown>) {
  if (payload.completionReview !== true) return;
  const rpc = worker.rpc, sessionId = worker.state?.sessionId;
  worker.launch ??= emptyLaunch();
  worker.launch.reviewArmed = false;
  // Only the rejected submission can return its choice, never another queued task.
  return () => {
    if (worker.rpc !== rpc || worker.state?.sessionId !== sessionId || !ordinaryLaunch(worker.launch)) return;
    worker.launch ??= emptyLaunch();
    worker.launch.reviewArmed = true;
  };
}
