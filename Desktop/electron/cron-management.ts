import { isAbsolute } from 'node:path';
import type { CronCreateInput, CronJobData, CronOverview, CronTask, CronUpdateInput } from '../src/contracts';
import type { SessionRuntime, SessionRuntimes } from './session-runtimes';
import { normalizedWorkspaceKey } from '../src/workspace-key';
import type { CronBindings } from './cron-bindings';

export interface CronRuntimeJob extends CronJobData {
  sessionId?: string; sessionFile?: string; status?: 'enabled' | 'paused' | 'expired' | 'completed';
  enabled?: boolean; statusReason?: 'session_missing'; lastStatus?: 'delivered' | 'failed' | 'missed' | 'skipped' | 'blocked';
}
export interface SavedCronJobs { jobs: unknown; trusted: boolean; incomplete?: boolean }
interface CronOwnership {
  sameSessionFile: (actual: string, expected: string) => Promise<boolean>;
}
const time = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 8.64e15;
const idPattern = (owned: boolean) => owned ? /^[\w-]{1,64}$/ : /^[\w-]{1,24}$/;
const sessionPattern = /^[\w-]{1,200}$/;
const revisionPattern = /^[a-f0-9]{64}$/;

export function cronJobs(value: unknown, owned = false, max = 50): CronRuntimeJob[] {
  if (!Array.isArray(value) || value.length > max) throw new Error('Invalid Cron jobs');
  const ids = new Set<string>();
  return value.map(job => {
    if (!job || typeof job.id !== 'string' || !idPattern(owned).test(job.id) || ids.has(job.id)
      || typeof job.cron !== 'string' || job.cron.length > (owned ? 200 : 100)
      || typeof job.prompt !== 'string' || job.prompt.length > (owned ? 16000 : 4000)
      || typeof job.recurring !== 'boolean' || typeof job.durable !== 'boolean' || !time(job.createdAt)
      || !time(job.nextFireAt) || job.autoExpireAt !== undefined && !time(job.autoExpireAt)
      || job.desktopPausedAt !== undefined && !time(job.desktopPausedAt)) throw new Error('Invalid Cron job');
    if (owned && (job.sessionId !== undefined && (typeof job.sessionId !== 'string' || !sessionPattern.test(job.sessionId))
      || job.sessionFile !== undefined && (typeof job.sessionFile !== 'string' || job.sessionFile.length > 32768 || !isAbsolute(job.sessionFile))
      || job.status !== undefined && !['enabled', 'paused', 'expired', 'completed'].includes(job.status)
      || job.enabled !== undefined && typeof job.enabled !== 'boolean'
      || job.statusReason !== undefined && job.statusReason !== 'session_missing'
      || job.lastStatus !== undefined && !['delivered', 'failed', 'missed', 'skipped', 'blocked'].includes(job.lastStatus)
      || job.expiresAt !== undefined && !time(job.expiresAt)
      || job.runAt !== undefined && !time(job.runAt)
      || job.intervalHours !== undefined && (!Number.isInteger(job.intervalHours) || job.intervalHours < 1 || job.intervalHours > 168)
      || job.revision !== undefined && (typeof job.revision !== 'string' || !revisionPattern.test(job.revision))))
      throw new Error('Invalid Cron ownership state');
    ids.add(job.id);
    const autoExpireAt = owned ? job.expiresAt ?? job.autoExpireAt : job.autoExpireAt;
    return { id: job.id, cron: job.cron, prompt: job.prompt, recurring: job.recurring, durable: job.durable,
      createdAt: job.createdAt, nextFireAt: job.nextFireAt, ...(autoExpireAt === undefined ? {} : { autoExpireAt }),
      ...(job.desktopPausedAt === undefined ? {} : { desktopPausedAt: job.desktopPausedAt }),
      ...(owned ? Object.fromEntries(['sessionId', 'sessionFile', 'status', 'enabled', 'statusReason', 'lastStatus',
        'intervalHours', 'runAt', 'revision'].filter(key => job[key] !== undefined).map(key => [key, job[key]])) : {}) };
  });
}

export function cronScheduling(job: CronRuntimeJob, now = Date.now()): CronTask['scheduling'] {
  if (job.status === 'completed') return job.lastStatus === 'missed' ? 'missed' : 'completed';
  if (job.status === 'expired' || job.autoExpireAt !== undefined && job.autoExpireAt <= now) return 'expired';
  if (job.durable && (!job.sessionId || !job.sessionFile) || job.desktopPausedAt !== undefined) return 'parked';
  if (job.statusReason === 'session_missing') return 'session-missing';
  if (job.status === 'paused' || job.enabled === false) return 'paused';
}

function ownedTask(job: CronRuntimeJob, task: Pick<CronTask, 'key' | 'workspace' | 'runtimeId' | 'hostName'>): CronTask {
  const { sessionId, sessionFile, status, enabled, statusReason, lastStatus, ...data } = job;
  const scheduling = cronScheduling(job);
  return { ...data, ...task, scheduling, ...(sessionId && sessionFile && job.durable
    ? { association: { sessionId, source: 'native', at: job.createdAt } } : {}) };
}

export function cronCreation(input: unknown, owned = false): CronCreateInput {
  const value = input as CronCreateInput;
  if (!value || typeof value.runtimeId !== 'string' || value.runtimeId.length > 80
    || value.expectedSessionId !== undefined && (typeof value.expectedSessionId !== 'string'
      || !value.expectedSessionId || value.expectedSessionId.length > 256)
    || typeof value.cron !== 'string' || !value.cron.trim() || value.cron.length > 100
    || typeof value.prompt !== 'string' || !value.prompt.trim() || value.prompt.length > 4000
    || typeof value.recurring !== 'boolean' || typeof value.durable !== 'boolean') throw new Error('Invalid Cron creation parameters');
  const { expectedSessionId, intervalHours, runAt } = value;
  if (intervalHours !== undefined && (!owned || !value.recurring || !Number.isInteger(intervalHours) || intervalHours < 1 || intervalHours > 168)
    || runAt !== undefined && (!owned || value.recurring || !time(runAt) || runAt <= Date.now()))
    throw new Error('Invalid Cron scheduling parameters');
  return { runtimeId: value.runtimeId, cron: value.cron.trim(), prompt: value.prompt.trim(), recurring: value.recurring, durable: value.durable,
    ...(expectedSessionId === undefined ? {} : { expectedSessionId }),
    ...(intervalHours === undefined ? {} : { intervalHours }), ...(runAt === undefined ? {} : { runAt }) };
}

export class CronManagement {
  constructor(private pool: SessionRuntimes,
    private saved: (cwd: string) => Promise<SavedCronJobs>,
    private changed: () => void, private bindings?: CronBindings,
    private beforeUpdate?: (workspace: string, sessionId?: string) => Promise<void>, private ownership?: CronOwnership) {}
  host(runtimeId: unknown): SessionRuntime {
    if (typeof runtimeId !== 'string' || !runtimeId || runtimeId.length > 80) throw new Error('Invalid Cron host');
    const worker = this.pool.require(runtimeId);
    if (worker.status !== 'connected' || worker.stopping || !worker.state?.sessionId)
      throw new Error('Cron host is offline; refresh before opening');
    return worker;
  }
  private key(cwd: string) { return normalizedWorkspaceKey(cwd, process.platform); }
  private taskKey(cwd: string, job: CronJobData, runtimeId?: string) {
    const fields = [job.durable ? this.key(cwd) : runtimeId, job.id];
    return JSON.stringify(this.ownership ? [...fields, job.createdAt] : fields);
  }
  private assertCurrent(worker: SessionRuntime, rpc: SessionRuntime['rpc'], sessionId?: string) {
    if (this.pool.require(worker.id) !== worker || worker.rpc !== rpc || worker.stopping
      || worker.state?.sessionId !== sessionId) throw new Error('Cron host changed; refresh and retry');
  }
  async list(workspaces: string[]): Promise<CronOverview> {
    const tasks = new Map<string, CronTask>();
    const liveDurable = new Map<string, { job: CronRuntimeJob; task: CronTask }>();
    const overview: CronOverview = { tasks: [], hosts: [], issues: [], ...(this.ownership ? { sessionOwned: true } : {}) };
    const liveProjects = new Set<string>();
    const projects = new Map(workspaces.map(cwd => [this.key(cwd), cwd]));
    const residentOwners = new Set<string>();
    for (const worker of this.pool.workers.values()) {
      const sessionId = worker.state?.sessionId;
      if (this.ownership && worker.status !== 'disconnected' && sessionId)
        residentOwners.add(JSON.stringify([this.key(worker.cwd), sessionId]));
      if (worker.status !== 'connected' || worker.stopping || worker.cronGated) continue;
      if (this.ownership && !projects.has(this.key(worker.cwd))) projects.set(this.key(worker.cwd), worker.cwd);
      const rpc = worker.rpc;
      worker.operations++;
      try {
        if (this.ownership && !sessionId) throw new Error('Cron host has no session');
        const result = await rpc.request('desktop_cron', { action: 'list', ...(this.ownership ? { sessionId } : {}) }, 15000);
        this.assertCurrent(worker, rpc, sessionId);
        const jobs = cronJobs(result.jobs, Boolean(this.ownership));
        if (typeof result.trusted !== 'boolean') throw new Error('Invalid Cron trust state');
        const name = worker.state?.sessionName || worker.state?.sessionId?.slice(0, 8) || worker.id.slice(0, 8);
        overview.hosts.push({ runtimeId: worker.id, workspace: worker.cwd, name, sessionId: worker.state?.sessionId, trusted: result.trusted,
          busy: this.pool.isBusy(worker) || worker.mutating || Boolean(worker.launch?.goal?.status === 'active'),
          model: worker.state?.model?.name ?? worker.state?.model?.id, permission: worker.permissionPreset });
        if (result.trusted) liveProjects.add(this.key(worker.cwd));
        for (const job of jobs) {
          const key = this.taskKey(worker.cwd, job, worker.id);
          if (this.ownership) {
            if (job.sessionId !== sessionId || !job.revision)
              throw new Error('Cron task did not match its native owner');
            const task = ownedTask(job, { key, workspace: worker.cwd, runtimeId: worker.id, hostName: name });
            if (!job.durable) tasks.set(key, task);
            else if (result.trusted && job.sessionFile && worker.state?.sessionFile
              && await this.ownership.sameSessionFile(job.sessionFile, worker.state.sessionFile)) {
              this.assertCurrent(worker, rpc, sessionId);
              if (!liveDurable.has(key) || worker.id === this.pool.activeId) liveDurable.set(key, { job, task });
            }
            continue;
          }
          const existing = tasks.get(key);
          if (!existing || existing.runtimeId !== this.pool.activeId && worker.id === this.pool.activeId)
            tasks.set(key, { ...job, key, workspace: worker.cwd, runtimeId: worker.id, hostName: name });
        }
      } catch {
        overview.issues.push({ workspace: worker.cwd, reason: 'unavailable' });
      } finally { worker.operations--; }
    }
    for (const cwd of this.ownership ? projects.values() : new Set(workspaces)) {
      if (!this.ownership && liveProjects.has(this.key(cwd))) continue;
      try {
        const result = await this.saved(cwd);
        if (!result.trusted) { overview.issues.push({ workspace: cwd, reason: 'untrusted' }); continue; }
        if (result.incomplete) overview.issues.push({ workspace: cwd, reason: 'unavailable' });
        for (const job of cronJobs(result.jobs, Boolean(this.ownership), this.ownership ? 500 : 50).filter(job => job.durable)) {
          const key = this.taskKey(cwd, job);
          if (this.ownership) {
            const live = liveDurable.get(key);
            const task = !result.incomplete && live && job.revision === live.job.revision && job.sessionId === live.job.sessionId
              ? { ...live.task, workspace: cwd } : ownedTask(job, { key, workspace: cwd });
            task.recoverable = !result.incomplete && !task.runtimeId && !task.scheduling && job.nextFireAt > Date.now()
              && Boolean(job.revision && task.association?.source === 'native'
                && !residentOwners.has(JSON.stringify([this.key(cwd), task.association.sessionId])));
            tasks.set(key, task);
          } else if (!tasks.has(key)) tasks.set(key, { ...job, key, workspace: cwd });
        }
      } catch { overview.issues.push({ workspace: cwd, reason: 'unavailable' }); }
    }
    overview.tasks = [...tasks.values()].sort((a, b) => a.nextFireAt - b.nextFireAt);
    if (!this.ownership && this.bindings) for (const task of overview.tasks) {
      try { task.association = await this.bindings.get(task.workspace, task); }
      catch { overview.issues.push({ workspace: task.workspace, reason: 'unavailable' }); }
    }
    return overview;
  }
  private async mutate(runtimeId: string, args: Record<string, unknown>, expectedSessionId?: string) {
    const worker = this.pool.require(runtimeId);
    if (worker.mutating || worker.operations || worker.stopping) throw new Error('Cron host is busy; refresh and retry');
    const rpc = worker.rpc;
    const sessionId = worker.state?.sessionId;
    if (expectedSessionId !== undefined && sessionId !== expectedSessionId) throw new Error('Cron host changed; refresh and retry');
    if (this.ownership && !sessionId) throw new Error('Cron host has no session');
    worker.mutating = true;
    try {
      await this.pool.assertIdle(worker);
      this.assertCurrent(worker, rpc, sessionId);
      if (args.action === 'update') {
        await this.beforeUpdate?.(worker.cwd, sessionId);
        this.assertCurrent(worker, rpc, sessionId);
      }
      const result = await rpc.request('desktop_cron', this.ownership ? { ...args, sessionId } : args, 15000);
      this.assertCurrent(worker, rpc, sessionId);
      const jobs = cronJobs(result.jobs, Boolean(this.ownership));
      if (this.ownership && jobs.some(job => job.sessionId !== sessionId || !job.revision))
        throw new Error('Cron task did not match its native owner');
      if (args.action === 'update' || this.ownership && args.action === 'create') {
        const [updated] = cronJobs([result.result], Boolean(this.ownership));
        if (args.action === 'update' && updated.id !== args.jobId
          || this.ownership && (updated.sessionId !== sessionId || !updated.revision))
          throw new Error('Unconfirmed Cron change; refresh');
      }
      if (!this.ownership && args.action === 'create' && args.durable && this.bindings && worker.state?.sessionId) {
        await this.bindings.set(worker.cwd, cronJobs([result.result]), worker.state.sessionId, 'created');
      }
    } finally {
      worker.mutating = false;
      this.pool.publish();
      this.changed();
    }
  }
  create(input: unknown) {
    const { runtimeId, expectedSessionId, ...value } = cronCreation(input, Boolean(this.ownership));
    return this.mutate(runtimeId, { action: 'create', ...value }, expectedSessionId);
  }
  delete(runtimeId: unknown, jobId: unknown, expected?: unknown) {
    if (typeof runtimeId !== 'string' || runtimeId.length > 80 || typeof jobId !== 'string' || !idPattern(Boolean(this.ownership)).test(jobId)
      || this.ownership && (typeof expected !== 'string' || !revisionPattern.test(expected))) throw new Error('Invalid Cron deletion');
    return this.mutate(runtimeId, { action: 'delete', jobId, ...(this.ownership ? { expected } : {}) });
  }
  update(input: unknown) {
    const value = input as CronUpdateInput;
    if (!value || typeof value.runtimeId !== 'string' || !value.runtimeId || value.runtimeId.length > 80
      || typeof value.jobId !== 'string' || !idPattern(Boolean(this.ownership)).test(value.jobId)
      || typeof value.expected !== 'string' || (this.ownership ? !revisionPattern.test(value.expected) : value.expected.length > 20000)
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
