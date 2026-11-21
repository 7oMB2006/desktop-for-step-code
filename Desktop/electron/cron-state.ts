export interface CronState {
  version: 1;
  status: 'ready' | 'unavailable';
  jobs: {
    id: string;
    recurring: boolean;
    durable: boolean;
    nextFireAt: number;
    autoExpireAt?: number;
    expiresAt?: number;
    status?: 'enabled' | 'paused' | 'expired' | 'completed';
    statusReason?: 'session_missing';
    enabled?: boolean;
    lastStatus?: 'delivered' | 'failed' | 'missed' | 'skipped' | 'blocked';
  }[];
}

export function cronState(text: unknown): CronState | undefined {
  if (typeof text !== 'string' || text.length > 24000) return;
  try {
    const value = JSON.parse(text);
    if (value?.version !== 1 || !['ready', 'unavailable'].includes(value.status)
      || !Array.isArray(value.jobs) || value.jobs.length > 50) return;
    const timestamp = (time: unknown) => typeof time === 'number' && Number.isFinite(time) && Math.abs(time) <= 8.64e15;
    if (value.jobs.some((job: any) => !job || typeof job.id !== 'string' || !/^[\w-]{1,64}$/.test(job.id)
      || typeof job.recurring !== 'boolean' || typeof job.durable !== 'boolean'
      || !timestamp(job.nextFireAt) || job.autoExpireAt !== undefined && !timestamp(job.autoExpireAt)
      || job.expiresAt !== undefined && !timestamp(job.expiresAt)
      || job.status !== undefined && !['enabled', 'paused', 'expired', 'completed'].includes(job.status)
      || job.statusReason !== undefined && job.statusReason !== 'session_missing'
      || job.enabled !== undefined && typeof job.enabled !== 'boolean'
      || job.lastStatus !== undefined && !['delivered', 'failed', 'missed', 'skipped', 'blocked'].includes(job.lastStatus))) return;
    if (new Set(value.jobs.map((job: any) => job.id)).size !== value.jobs.length) return;
    return { version: 1, status: value.status, jobs: value.jobs.map((job: CronState['jobs'][number]) => ({
      id: job.id, recurring: job.recurring, durable: job.durable, nextFireAt: job.nextFireAt,
      ...(job.autoExpireAt === undefined ? {} : { autoExpireAt: job.autoExpireAt }),
      ...(job.expiresAt === undefined ? {} : { expiresAt: job.expiresAt }),
      ...(job.status === undefined ? {} : { status: job.status }),
      ...(job.statusReason === undefined ? {} : { statusReason: job.statusReason }),
      ...(job.enabled === undefined ? {} : { enabled: job.enabled }),
      ...(job.lastStatus === undefined ? {} : { lastStatus: job.lastStatus }),
    })) };
  } catch { return; }
}

export function pendingCronJob(job: CronState['jobs'][number], now = Date.now()) {
  if (job.status === 'completed' || job.status === 'expired' || job.statusReason === 'session_missing') return false;
  if (job.status !== undefined || job.expiresAt !== undefined) return (job.expiresAt ?? job.autoExpireAt ?? Infinity) > now;
  return true;
}

export function hasScheduledCron(state: CronState | undefined) {
  return Boolean(state && (state.status !== 'ready' || state.jobs.some(job => pendingCronJob(job))));
}
