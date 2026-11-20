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

  async enable(plan: CronRecoveryPlan) {
    if (!plan.owner || !plan.jobs.length || plan.jobs.length > 500) throw new Error('No verified Cron tasks to authorize');
    const { workspace, sessionId, account, sessionPath, configurationRef, model } = plan;
    const grant: CronWakeGrant = { version: 1, workspace, sessionId, accountRef: digest(account), configurationRef,
      sessionFileRef: digest(normalizedWorkspaceKey(sessionPath, process.platform)),
      model: { id: model.id, provider: model.provider }, jobs: plan.jobs.map(cronWakeFingerprint).sort() };
    await this.write(this.file(workspace, sessionId), grant);
  }

  async disable(workspace: string, sessionId: string) {
    await this.write(this.file(workspace, sessionId), { version: 1, disabled: true });
  }

  async activate(grant: CronWakeGrant, launch: () => Promise<unknown>) {
    const file = this.file(grant.workspace, grant.sessionId);
    if (grant.blocked || JSON.stringify(await this.read(file)) !== JSON.stringify(grant))
      throw new Error('Review Cron wake authorization before launching');
    // An interrupted or uncertain launch must not be retried on restart.
    await this.write(file, { ...grant, blocked: true });
    await launch();
    await this.write(file, grant);
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
