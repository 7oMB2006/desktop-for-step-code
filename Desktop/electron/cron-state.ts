export interface CronState {
  version: 1;
  status: 'ready' | 'unavailable';
  jobs: {
    id: string;
    recurring: boolean;
    durable: boolean;
    nextFireAt: number;
    autoExpireAt?: number;
  }[];
}

export function cronState(text: unknown): CronState | undefined {
  if (typeof text !== 'string' || text.length > 24000) return;
  try {
    const value = JSON.parse(text);
    if (value?.version !== 1 || !['ready', 'unavailable'].includes(value.status)
      || !Array.isArray(value.jobs) || value.jobs.length > 50) return;
    const timestamp = (time: unknown) => typeof time === 'number' && Number.isFinite(time) && Math.abs(time) <= 8.64e15;
    if (value.jobs.some((job: any) => !job || typeof job.id !== 'string' || !/^[\w-]{1,24}$/.test(job.id)
      || typeof job.recurring !== 'boolean' || typeof job.durable !== 'boolean'
      || !timestamp(job.nextFireAt) || job.autoExpireAt !== undefined && !timestamp(job.autoExpireAt))) return;
    if (new Set(value.jobs.map((job: any) => job.id)).size !== value.jobs.length) return;
    return { version: 1, status: value.status, jobs: value.jobs.map((job: CronState['jobs'][number]) => ({
      id: job.id, recurring: job.recurring, durable: job.durable, nextFireAt: job.nextFireAt,
      ...(job.autoExpireAt === undefined ? {} : { autoExpireAt: job.autoExpireAt }),
    })) };
  } catch { return; }
}

export function hasScheduledCron(state: CronState | undefined) {
  return Boolean(state && (state.status !== 'ready' || state.jobs.length));
}
