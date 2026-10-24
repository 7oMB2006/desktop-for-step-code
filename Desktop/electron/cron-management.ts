import type { CronCreateInput, CronJobData, CronOverview, CronUpdateInput } from '../src/contracts';
import type { SessionRuntime, SessionRuntimes } from './session-runtimes';
import { normalizedWorkspaceKey } from '../src/workspace-key';
import type { CronBindings } from './cron-bindings';

export function cronJobs(value: unknown): CronJobData[] {
  if (!Array.isArray(value) || value.length > 50) throw new Error('Invalid Cron jobs');
  const time = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 8.64e15;
  const ids = new Set<string>();
  return value.map(job => {
    if (!job || typeof job.id !== 'string' || !/^[\w-]{1,24}$/.test(job.id) || ids.has(job.id)
      || typeof job.cron !== 'string' || job.cron.length > 100 || typeof job.prompt !== 'string' || job.prompt.length > 4000
      || typeof job.recurring !== 'boolean' || typeof job.durable !== 'boolean' || !time(job.createdAt)
      || !time(job.nextFireAt) || job.autoExpireAt !== undefined && !time(job.autoExpireAt)
      || job.desktopPausedAt !== undefined && !time(job.desktopPausedAt)) throw new Error('Invalid Cron job');
    ids.add(job.id);
    return { id: job.id, cron: job.cron, prompt: job.prompt, recurring: job.recurring, durable: job.durable,
      createdAt: job.createdAt, nextFireAt: job.nextFireAt, ...(job.autoExpireAt === undefined ? {} : { autoExpireAt: job.autoExpireAt }),
      ...(job.desktopPausedAt === undefined ? {} : { desktopPausedAt: job.desktopPausedAt }) };
  });
}

export function cronCreation(input: unknown): CronCreateInput {
  const value = input as CronCreateInput;
  if (!value || typeof value.runtimeId !== 'string' || value.runtimeId.length > 80
    || typeof value.cron !== 'string' || !value.cron.trim() || value.cron.length > 100
    || typeof value.prompt !== 'string' || !value.prompt.trim() || value.prompt.length > 4000
    || typeof value.recurring !== 'boolean' || typeof value.durable !== 'boolean') throw new Error('Invalid Cron creation parameters');
  return { runtimeId: value.runtimeId, cron: value.cron.trim(), prompt: value.prompt.trim(), recurring: value.recurring, durable: value.durable };
}

export class CronManagement {
  constructor(private pool: SessionRuntimes,
    private saved: (cwd: string) => Promise<{ jobs: unknown; trusted: boolean }>,
    private changed: () => void, private bindings?: CronBindings,
    private beforeUpdate?: (workspace: string) => Promise<void>) {}
  host(runtimeId: unknown): SessionRuntime {
    if (typeof runtimeId !== 'string' || !runtimeId || runtimeId.length > 80) throw new Error('Invalid Cron host');
    const worker = this.pool.require(runtimeId);
    if (worker.status !== 'connected' || worker.stopping || !worker.state?.sessionId)
      throw new Error('Cron host is offline; refresh before opening');
    return worker;
  }
  private key(cwd: string) { return normalizedWorkspaceKey(cwd, process.platform); }
  private assertCurrent(worker: SessionRuntime, rpc: SessionRuntime['rpc']) {
    if (this.pool.require(worker.id) !== worker || worker.rpc !== rpc || worker.stopping) throw new Error('Cron host changed; refresh and retry');
  }
  async list(workspaces: string[]): Promise<CronOverview> {
    const tasks = new Map<string, CronOverview['tasks'][number]>();
    const overview: CronOverview = { tasks: [], hosts: [], issues: [] };
    const liveProjects = new Set<string>();
    for (const worker of this.pool.workers.values()) {
      if (worker.status !== 'connected' || worker.stopping) continue;
      const rpc = worker.rpc;
      worker.operations++;
      try {
        const result = await rpc.request('desktop_cron', { action: 'list' }, 15000);
        this.assertCurrent(worker, rpc);
        const jobs = cronJobs(result.jobs);
        if (typeof result.trusted !== 'boolean') throw new Error('Invalid Cron trust state');
        const name = worker.state?.sessionName || worker.state?.sessionId?.slice(0, 8) || worker.id.slice(0, 8);
        overview.hosts.push({ runtimeId: worker.id, workspace: worker.cwd, name, sessionId: worker.state?.sessionId, trusted: result.trusted,
          busy: this.pool.isBusy(worker) || worker.mutating || Boolean(worker.launch?.goal?.status === 'active'),
          model: worker.state?.model?.name ?? worker.state?.model?.id, permission: worker.permissionPreset });
        if (result.trusted) liveProjects.add(this.key(worker.cwd));
        for (const job of jobs) {
          const key = JSON.stringify([job.durable ? this.key(worker.cwd) : worker.id, job.id]);
          const existing = tasks.get(key);
          if (!existing || existing.runtimeId !== this.pool.activeId && worker.id === this.pool.activeId)
            tasks.set(key, { ...job, key, workspace: worker.cwd, runtimeId: worker.id, hostName: name });
        }
      } catch {
        overview.issues.push({ workspace: worker.cwd, reason: 'unavailable' });
      } finally { worker.operations--; }
    }
    for (const cwd of new Set(workspaces)) {
      if (liveProjects.has(this.key(cwd))) continue;
      try {
        const result = await this.saved(cwd);
        if (!result.trusted) { overview.issues.push({ workspace: cwd, reason: 'untrusted' }); continue; }
        for (const job of cronJobs(result.jobs).filter(job => job.durable)) {
          const key = JSON.stringify([this.key(cwd), job.id]);
          if (!tasks.has(key)) tasks.set(key, { ...job, key, workspace: cwd });
        }
      } catch { overview.issues.push({ workspace: cwd, reason: 'unavailable' }); }
    }
    overview.tasks = [...tasks.values()].sort((a, b) => a.nextFireAt - b.nextFireAt);
    if (this.bindings) for (const task of overview.tasks) {
      try { task.association = await this.bindings.get(task.workspace, task); }
      catch { overview.issues.push({ workspace: task.workspace, reason: 'unavailable' }); }
    }
    return overview;
  }
  private async mutate(runtimeId: string, args: Record<string, unknown>) {
    const worker = this.pool.require(runtimeId);
    if (worker.mutating || worker.operations || worker.stopping) throw new Error('Cron host is busy; refresh and retry');
    const rpc = worker.rpc;
    worker.mutating = true;
    try {
      await this.pool.assertIdle(worker);
      this.assertCurrent(worker, rpc);
      if (args.action === 'update') {
        await this.beforeUpdate?.(worker.cwd);
        this.assertCurrent(worker, rpc);
      }
      const result = await rpc.request('desktop_cron', args, 15000);
      this.assertCurrent(worker, rpc);
      cronJobs(result.jobs);
      if (args.action === 'update') {
        const [updated] = cronJobs([result.result]);
        if (updated.id !== args.jobId) throw new Error('Unconfirmed Cron update; refresh');
      }
      if (args.action === 'create' && args.durable && this.bindings && worker.state?.sessionId) {
        const jobs = cronJobs([result.result]);
        await this.bindings.set(worker.cwd, jobs, worker.state.sessionId, 'created');
      }
    } finally {
      worker.mutating = false;
      this.pool.publish();
      this.changed();
    }
  }
  create(input: unknown) {
    const value = cronCreation(input);
    return this.mutate(value.runtimeId, { action: 'create', cron: value.cron, prompt: value.prompt, recurring: value.recurring, durable: value.durable });
  }
  delete(runtimeId: unknown, jobId: unknown) {
    if (typeof runtimeId !== 'string' || runtimeId.length > 80 || typeof jobId !== 'string' || !/^[\w-]{1,24}$/.test(jobId)) throw new Error('Invalid Cron deletion');
    return this.mutate(runtimeId, { action: 'delete', jobId });
  }
  update(input: unknown) {
    const value = input as CronUpdateInput;
    if (!value || typeof value.runtimeId !== 'string' || !value.runtimeId || value.runtimeId.length > 80
      || typeof value.jobId !== 'string' || !/^[\w-]{1,24}$/.test(value.jobId)
      || typeof value.expected !== 'string' || value.expected.length > 20000
      || value.cron !== undefined && (typeof value.cron !== 'string' || !value.cron.trim() || value.cron.length > 100)
      || value.prompt !== undefined && (typeof value.prompt !== 'string' || !value.prompt.trim() || value.prompt.length > 4000)
      || value.paused !== undefined && typeof value.paused !== 'boolean'
      || value.cron === undefined && value.prompt === undefined && value.paused === undefined) throw new Error('Invalid Cron update');
    return this.mutate(value.runtimeId, { action: 'update', jobId: value.jobId, expected: value.expected,
      ...(value.cron === undefined ? {} : { cron: value.cron.trim() }),
      ...(value.prompt === undefined ? {} : { prompt: value.prompt.trim() }),
      ...(value.paused === undefined ? {} : { paused: value.paused }) });
  }
}
