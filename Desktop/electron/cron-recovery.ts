import { createHash, randomUUID } from 'node:crypto';
import type { CronJobData, CronRecoveryPreview, Model } from '../src/contracts';
import { RpcCommandError, type RpcProcess } from './runtime';

export async function resumeCronHost(rpc: Pick<RpcProcess, 'request'>, discard: () => Promise<void>) {
  try {
    await rpc.request('desktop_cron_resume', {}, 15000);
  } catch (error) {
    // Only a negative response proves the gate stayed closed; transport failures are uncertain.
    if (error instanceof RpcCommandError) await discard();
    throw error;
  }
}

export interface CronRecoveryPlan {
  workspace: string;
  jobs: CronJobData[];
  sessionId: string;
  sessionName: string;
  sessionPath: string;
  sessionStamp: string;
  configurationRef: string;
  account: string;
  model: Model;
}
const stamp = (plan: CronRecoveryPlan) => createHash('sha256').update(JSON.stringify(plan)).digest('hex');

// Startup may advance nextFireAt or expire jobs, but must not add or change work.
export function assertRecoveryJobs(approved: CronJobData[], loaded: CronJobData[]) {
  const identity = (job: CronJobData) => JSON.stringify([
    job.id, job.createdAt, job.cron, job.prompt, job.recurring, job.durable, job.autoExpireAt ?? null,
  ]);
  const expected = new Set(approved.map(identity));
  if (loaded.some(job => !job.durable || !expected.has(identity(job))))
    throw new Error('Cron tasks changed while opening the host; review recovery again');
}

// A short-lived, one-use consent binds the whole project, account and history snapshot.
export class CronRecovery {
  private pending = new Map<string, { key: string; plan: CronRecoveryPlan; expires: number }>();
  private recovering = false;
  constructor(private inspect: (key: string, sessionId: string) => Promise<CronRecoveryPlan>,
    private launch: (plan: CronRecoveryPlan) => Promise<{ sessionId: string; runtimeId: string }>,
    private now = Date.now) {}
  async prepare(key: unknown, sessionId: unknown): Promise<CronRecoveryPreview> {
    if (typeof key !== 'string' || key.length > 8192 || typeof sessionId !== 'string' || !/^[\w-]{1,200}$/.test(sessionId))
      throw new Error('Invalid Cron recovery target');
    if (this.recovering) throw new Error('Cron recovery is already in progress');
    const plan = await this.inspect(key, sessionId);
    if (!plan.jobs.length || plan.jobs.some(job => !job.durable)) throw new Error('No durable Cron tasks to recover');
    this.pending.clear();
    const token = randomUUID();
    const expires = this.now() + 120000;
    this.pending.set(token, { key, plan, expires });
    return { token, expires, workspace: plan.workspace, sessionId: plan.sessionId, sessionName: plan.sessionName,
      jobs: plan.jobs.map(job => ({ id: job.id, prompt: job.prompt, nextFireAt: job.nextFireAt })),
      model: { id: plan.model.id, provider: plan.model.provider, name: plan.model.name },
      account: plan.account, permission: 'ask' };
  }
  async recover(token: unknown) {
    if (typeof token !== 'string') throw new Error('Invalid Cron recovery confirmation');
    const pending = this.pending.get(token);
    this.pending.delete(token);
    if (!pending || this.now() >= pending.expires) throw new Error('Cron recovery confirmation expired; review again');
    if (this.recovering) throw new Error('Cron recovery is already in progress');
    this.recovering = true;
    try {
      const latest = await this.inspect(pending.key, pending.plan.sessionId);
      if (this.now() >= pending.expires || stamp(latest) !== stamp(pending.plan))
        throw new Error('Cron tasks, session or account changed; review recovery again');
      return await this.launch(latest);
    } finally { this.recovering = false; }
  }
}
