import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { CronAutomaticRecovery } from '../src/contracts';
import { cronRevision } from '../src/cron-revision';
import { normalizedWorkspaceKey } from '../src/workspace-key';
import type { CronRecoveryPlan } from './cron-recovery';

interface Grant extends CronAutomaticRecovery {
  version: 1; revision: string; key: string; workspace: string; sessionId: string; configurationRef: string;
  model: { id: string; provider: string }; jobs: string[]; expires: number;
}
const fingerprint = (plan: CronRecoveryPlan) => plan.jobs.map(job =>
  createHash('sha256').update(cronRevision(job)).digest('hex')).sort();

// Opt-in, bounded to one reviewed project snapshot. An uncertain attempt is never retried.
export class CronAutoRecovery {
  private busy = false;
  constructor(private root: string, private inspect: (key: string, session: string) => Promise<CronRecoveryPlan>,
    private launch: (plan: CronRecoveryPlan) => Promise<unknown>,
    private safe: (workspace: string) => boolean, private now = Date.now,
    private blocked?: (workspace: string, sessionId: string) => void) {}
  private file(workspace: string) {
    return join(this.root, createHash('sha256').update(normalizedWorkspaceKey(workspace, process.platform)).digest('hex') + '.json');
  }
  private async write(grant: Grant) {
    await mkdir(this.root, { recursive: true });
    const file = this.file(grant.workspace), temporary = `${file}.${randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify(grant), { mode: 0o600 });
    await rename(temporary, file);
  }
  private async read(file: string): Promise<Grant | undefined> {
    try {
      const bytes = await readFile(file);
      if (bytes.length > 400000) throw new Error('Invalid Cron recovery authorization');
      const grant = JSON.parse(bytes.toString('utf8'));
      if (grant?.version !== 1 || typeof grant.workspace !== 'string' || typeof grant.key !== 'string'
        || typeof grant.revision !== 'string' || !/^[\w-]{1,200}$/.test(grant.revision)
        || typeof grant.sessionId !== 'string' || !/^[\w-]{1,200}$/.test(grant.sessionId)
        || typeof grant.configurationRef !== 'string' || !/^[a-f0-9]{64}$/.test(grant.configurationRef)
        || typeof grant.model?.id !== 'string' || typeof grant.model?.provider !== 'string'
        || !Array.isArray(grant.jobs) || !grant.jobs.length || grant.jobs.length > 50
        || grant.jobs.some((row: unknown) => typeof row !== 'string' || !/^[a-f0-9]{64}$/.test(row))
        || !Number.isFinite(grant.expires) || Math.abs(grant.expires) > 8.64e15
        || !['enabled', 'blocked', 'disabled'].includes(grant.state)) throw new Error('Invalid Cron recovery authorization');
      return grant;
    } catch (error: any) { if (error.code === 'ENOENT') return; throw error; }
  }
  async status(workspace: string): Promise<CronAutomaticRecovery | undefined> {
    const grant = await this.read(this.file(workspace));
    if (!grant) return;
    return { state: grant.expires <= this.now() && grant.state === 'enabled' ? 'blocked' : grant.state, expires: grant.expires };
  }
  async enable(key: string, plan: CronRecoveryPlan) {
    await this.write({ version: 1, revision: randomUUID(), key, workspace: plan.workspace, sessionId: plan.sessionId, configurationRef: plan.configurationRef,
      model: { id: plan.model.id, provider: plan.model.provider }, jobs: fingerprint(plan), state: 'enabled',
      expires: Math.min(this.now() + 7 * 86400000, ...plan.jobs.map(job => job.autoExpireAt ?? Infinity)) });
  }
  async disable(workspace: string) {
    const grant = await this.read(this.file(workspace));
    if (grant) await this.write({ ...grant, state: 'disabled' });
  }
  async block(workspace: string) {
    const grant = await this.read(this.file(workspace));
    if (grant?.state === 'enabled' || grant?.state === 'blocked') {
      await this.write({ ...grant, revision: randomUUID(), state: 'blocked' });
      this.blocked?.(workspace, grant.sessionId);
    }
  }
  async run(workspace?: string) {
    if (this.busy) return;
    this.busy = true;
    try {
      let files: string[];
      if (workspace) files = [this.file(workspace)];
      else {
        try { files = (await readdir(this.root)).filter(file => /^[a-f0-9]{64}\.json$/.test(file)).slice(0, 100).map(file => join(this.root, file)); }
        catch (error: any) { if (error.code === 'ENOENT') return; throw error; }
      }
      for (const file of files) {
        const grant = await this.read(file);
        if (!grant || grant.state !== 'enabled') continue;
        // Consume authorization for this attempt before starting a potentially paid runtime.
        await this.write({ ...grant, state: 'blocked' });
        let restored = false;
        try {
          if (grant.expires <= this.now() || !this.safe(grant.workspace)) continue;
          const plan = await this.inspect(grant.key, grant.sessionId);
          if (!this.safe(plan.workspace) || normalizedWorkspaceKey(plan.workspace, process.platform) !== normalizedWorkspaceKey(grant.workspace, process.platform)
            || plan.configurationRef !== grant.configurationRef
            || plan.model.id !== grant.model.id || plan.model.provider !== grant.model.provider
            || JSON.stringify(fingerprint(plan)) !== JSON.stringify(grant.jobs)
            || plan.jobs.some(job => job.autoExpireAt !== undefined && job.autoExpireAt <= this.now()
              || job.desktopPausedAt === undefined && job.nextFireAt <= this.now())) continue;
          await this.launch(plan);
          const current = await this.read(file);
          if (JSON.stringify(current) === JSON.stringify({ ...grant, state: 'blocked' })) await this.write(grant);
          restored = true;
        } catch {
          // Missing/archived session, trust/config changes and uncertain release all require a new review.
        } finally {
          if (!restored) this.blocked?.(grant.workspace, grant.sessionId);
        }
      }
    } finally { this.busy = false; }
  }
}
