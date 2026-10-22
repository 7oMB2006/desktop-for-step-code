import { randomUUID } from 'node:crypto';
import type { QuitReasons, QuitReviewState } from '../src/quit-confirmation';
import { normalizedWorkspaceKey } from '../src/workspace-key';
import type { SessionRuntimes } from './session-runtimes';

export function quitReasons(pool: Pick<SessionRuntimes, 'workers' | 'isBusy'>, transitioning: boolean): QuitReasons {
  const reasons: QuitReasons = { temporaryJobs: 0, durableJobs: 0, runningTasks: 0, activeGoals: 0,
    unknownCronHosts: 0, transitioning };
  const durable = new Set<string>();
  for (const worker of pool.workers.values()) {
    if (pool.isBusy(worker) || worker.queued) reasons.runningTasks++;
    if (worker.status !== 'connected') continue;
    if (worker.launch?.goal?.status === 'active') reasons.activeGoals++;
    if (worker.cron?.status === 'unavailable') reasons.unknownCronHosts!++;
    for (const job of worker.cron?.jobs ?? []) {
      if (job.durable) durable.add(JSON.stringify([normalizedWorkspaceKey(worker.cwd, process.platform), job.id]));
      else reasons.temporaryJobs++;
    }
  }
  reasons.durableJobs = durable.size;
  return reasons;
}

export const needsQuitReview = (reasons: QuitReasons) => Boolean(reasons.temporaryJobs || reasons.durableJobs
  || reasons.runningTasks || reasons.activeGoals || reasons.unknownCronHosts || reasons.transitioning);

/** The main process owns the decision; renderer snapshots can only answer a current request. */
export class QuitReview {
  private value: QuitReviewState = { revision: 0 };
  private resolve?: (confirmed: boolean) => void;
  private waiting?: Promise<boolean>;
  constructor(private publish: (state: QuitReviewState) => void) {}
  get state(): QuitReviewState { return this.value; }
  private set(request?: QuitReviewState['request']) {
    this.value = { revision: this.value.revision + 1, request };
    this.publish(this.value);
  }
  ask(reasons: QuitReasons): Promise<boolean> {
    if (this.waiting) return this.waiting;
    this.waiting = new Promise(resolve => { this.resolve = resolve; });
    this.set({ id: randomUUID(), reasons, phase: 'review' });
    return this.waiting;
  }
  refresh(reasons: QuitReasons) {
    const request = this.value.request;
    if (!request || request.phase !== 'review' || JSON.stringify(request.reasons) === JSON.stringify(reasons)) return;
    this.set({ id: randomUUID(), reasons, phase: 'review' });
  }
  respond(id: unknown, confirmed: unknown) {
    const request = this.value.request;
    if (!request || request.phase !== 'review' || typeof id !== 'string' || id !== request.id
      || typeof confirmed !== 'boolean' || !this.resolve) throw new Error('Quit confirmation changed; review the current request');
    const resolve = this.resolve;
    this.resolve = undefined;
    this.set(confirmed ? { ...request, phase: 'stopping' } : undefined);
    if (!confirmed) this.waiting = undefined;
    resolve(confirmed);
  }
  reset() {
    const resolve = this.resolve;
    this.resolve = undefined;
    this.waiting = undefined;
    this.set();
    resolve?.(false);
  }
}
