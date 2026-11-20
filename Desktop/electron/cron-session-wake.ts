import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { CronJobData } from '../src/contracts';
import { cronRevision } from '../src/cron-revision';
import { normalizedWorkspaceKey } from '../src/workspace-key';
import type { CronRecoveryPlan } from './cron-recovery';
import { cronScheduling, type CronRuntimeJob } from './cron-management';

export const cronWakeLeadMs = 120_000;
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const hashPattern = /^[a-f0-9]{64}$/;
const ownerPattern = /^[\w-]{1,200}$/;

export function cronWakeFingerprint(job: CronJobData) {
  return digest(JSON.stringify([cronRevision(job), job.intervalHours ?? null, job.runAt ?? null]));
}

export interface CronWakeGrant {
  version: 1;
  workspace: string;
  sessionId: string;
  accountRef: string;
  sessionFileRef: string;
  configurationRef: string;
  model: { id: string; provider: string };
  jobs: string[];
  blocked?: true;
}

export function matchesCronWake(grant: CronWakeGrant, plan: CronRecoveryPlan) {
  return Boolean(plan.owner && plan.jobs.length && grant.sessionId === plan.sessionId
    && normalizedWorkspaceKey(grant.workspace, process.platform) === normalizedWorkspaceKey(plan.workspace, process.platform)
    && grant.accountRef === digest(plan.account) && grant.configurationRef === plan.configurationRef
    && grant.sessionFileRef === digest(normalizedWorkspaceKey(plan.sessionPath, process.platform))
    && grant.model.id === plan.model.id && grant.model.provider === plan.model.provider
    && plan.jobs.every(job => grant.jobs.includes(cronWakeFingerprint(job))));
}

export function nextCronWake(grant: CronWakeGrant, rows: CronRuntimeJob[], now: number) {
  const active = rows.filter(row => row.durable && row.sessionId === grant.sessionId && !cronScheduling(row, now));
  const next = active.reduce<CronRuntimeJob | undefined>((first, job) =>
    !first || job.nextFireAt < first.nextFireAt ? job : first, undefined);
  if (next && next.nextFireAt > now && next.nextFireAt - now <= cronWakeLeadMs
    && active.every(job => grant.jobs.includes(cronWakeFingerprint(job)))) return next;
}

export class CronSessionWake {
  private writes = new Map<string, Promise<unknown>>();
  private attempts = new Map<string, object>();

  constructor(private root: string) {}

  private file(workspace: string, sessionId: string) {
    return join(this.root, digest(JSON.stringify([normalizedWorkspaceKey(workspace, process.platform), sessionId])) + '.json');
  }

  private async read(file: string): Promise<CronWakeGrant | undefined> {
    try {
      const bytes = await readFile(file);
      if (bytes.length > 65_536) throw new Error('Invalid Cron wake authorization');
      const grant = JSON.parse(bytes.toString('utf8'));
      // Revocation is an atomic replacement, not an update of a legacy grant.
      if (grant?.version === 1 && grant.disabled === true) return;
      if (grant?.version !== 1 || typeof grant.workspace !== 'string'
        || typeof grant.sessionId !== 'string' || !ownerPattern.test(grant.sessionId)
        || typeof grant.accountRef !== 'string' || !hashPattern.test(grant.accountRef)
        || typeof grant.sessionFileRef !== 'string' || !hashPattern.test(grant.sessionFileRef)
        || typeof grant.configurationRef !== 'string' || !hashPattern.test(grant.configurationRef)
        || grant.blocked !== undefined && grant.blocked !== true
        || typeof grant.model?.id !== 'string' || typeof grant.model?.provider !== 'string'
        || !Array.isArray(grant.jobs) || !grant.jobs.length || grant.jobs.length > 500
        || grant.jobs.some((job: unknown) => typeof job !== 'string' || !hashPattern.test(job))
        || this.file(grant.workspace, grant.sessionId) !== file) throw new Error('Invalid Cron wake authorization');
      return grant;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw error;
    }
  }

  private async write(file: string, value: object) {
    await mkdir(this.root, { recursive: true });
    const temporary = `${file}.${randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify(value), { mode: 0o600 });
    await rename(temporary, file);
  }

  get(workspace: string, sessionId: string) {
    return this.read(this.file(workspace, sessionId));
  }

  private mutate<T>(file: string, operation: () => Promise<T>): Promise<T> {
    const pending = (this.writes.get(file) ?? Promise.resolve()).catch(() => {}).then(operation);
    this.writes.set(file, pending);
    void pending.finally(() => { if (this.writes.get(file) === pending) this.writes.delete(file); }).catch(() => {});
    return pending;
  }

  async enable(plan: CronRecoveryPlan) {
    if (!plan.owner || !plan.jobs.length || plan.jobs.length > 500) throw new Error('No verified Cron tasks to authorize');
    const { workspace, sessionId, account, sessionPath, configurationRef, model } = plan;
    const grant: CronWakeGrant = { version: 1, workspace, sessionId, accountRef: digest(account), configurationRef,
      sessionFileRef: digest(normalizedWorkspaceKey(sessionPath, process.platform)),
      model: { id: model.id, provider: model.provider }, jobs: plan.jobs.map(cronWakeFingerprint).sort() };
    const file = this.file(workspace, sessionId);
    this.attempts.delete(file);
    await this.mutate(file, () => this.write(file, grant));
  }

  async disable(workspace: string, sessionId: string) {
    const file = this.file(workspace, sessionId);
    this.attempts.delete(file);
    await this.mutate(file, () => this.write(file, { version: 1, disabled: true }));
  }

  async block(workspace: string, sessionId: string) {
    const file = this.file(workspace, sessionId);
    this.attempts.delete(file);
    await this.mutate(file, async () => {
      const grant = await this.read(file);
      if (grant && !grant.blocked) await this.write(file, { ...grant, blocked: true });
    });
  }

  async activate(grant: CronWakeGrant, launch: (isCurrent: () => boolean) => Promise<unknown>) {
    const file = this.file(grant.workspace, grant.sessionId);
    const attempt = {};
    if (this.attempts.has(file)) throw new Error('Cron wake is already in progress');
    this.attempts.set(file, attempt);
    const isCurrent = () => this.attempts.get(file) === attempt;
    try {
      await this.mutate(file, async () => {
        if (grant.blocked || JSON.stringify(await this.read(file)) !== JSON.stringify(grant) || !isCurrent())
          throw new Error('Review Cron wake authorization before launching');
        // Persist the uncertain state before opening the native gate.
        await this.write(file, { ...grant, blocked: true });
      });
      if (!isCurrent()) throw new Error('Cron wake authorization changed');
      await launch(isCurrent);
      await this.mutate(file, async () => { if (isCurrent()) await this.write(file, grant); });
    } finally {
      if (isCurrent()) this.attempts.delete(file);
    }
  }

  async *grants(onError: (error: unknown) => void) {
    let names: string[];
    try { names = await readdir(this.root); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw error;
    }
    for (const name of names) {
      if (!/^[a-f0-9]{64}\.json$/.test(name)) continue;
      try {
        const grant = await this.read(join(this.root, name));
        if (grant && !grant.blocked) yield grant;
      } catch (error) { onError(error); }
    }
  }
}

// Reserve the owner immediately, but never make a scan wait for host startup.
export class CronWakeLaunches {
  private pending = new Map<string, string>();
  has(sessionId: string | undefined) { return sessionId !== undefined && this.pending.has(sessionId); }
  get busy() { return this.pending.size > 0; }
  hasWorkspace(workspace: string) {
    const key = normalizedWorkspaceKey(workspace, process.platform);
    return [...this.pending.values()].includes(key);
  }

  async scan<T extends { sessionId: string; workspace: string }>(candidates: AsyncIterable<T>,
    prepare: (candidate: T) => Promise<(() => Promise<void>) | undefined>,
    available: () => boolean, report: (error: unknown) => void) {
    for await (const candidate of candidates) {
      if (!available()) break;
      const { sessionId } = candidate;
      if (this.has(sessionId)) continue;
      try {
        const launch = await prepare(candidate);
        if (!launch || !available() || this.has(sessionId)) continue;
        this.pending.set(sessionId, normalizedWorkspaceKey(candidate.workspace, process.platform));
        void Promise.resolve().then(launch).catch(report).finally(() => this.pending.delete(sessionId));
      } catch (error) { report(error); }
    }
  }
}
