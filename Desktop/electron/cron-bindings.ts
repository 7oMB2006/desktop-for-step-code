import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { CronAssociation, CronJobData } from '../src/contracts';
import { normalizedWorkspaceKey } from '../src/workspace-key';
import { cronJobs } from './cron-management';

// Desktop-only associations do not alter upstream's project-shared task format.
export class CronBindings {
  constructor(private root: string) {}
  async created(workspace: string, sessionId: string | undefined, event: Record<string, any>): Promise<boolean> {
    if (!sessionId || event.type !== 'tool_execution_end' || event.toolName !== 'cron_create' || event.isError) return false;
    const jobs = cronJobs([event.result?.details]);
    if (!jobs[0].durable) return false;
    await this.set(workspace, jobs, sessionId, 'created');
    return true;
  }
  private file(workspace: string, job: CronJobData) {
    const key = JSON.stringify([normalizedWorkspaceKey(workspace, process.platform), job.id, job.createdAt]);
    return join(this.root, createHash('sha256').update(key).digest('hex') + '.json');
  }
  async get(workspace: string, job: CronJobData): Promise<CronAssociation | undefined> {
    if (!job.durable) return;
    try {
      const bytes = await readFile(this.file(workspace, job));
      if (bytes.length > 4096) throw new Error('Invalid Cron association');
      const value = JSON.parse(bytes.toString('utf8'));
      if (typeof value.sessionId !== 'string' || !/^[\w-]{1,200}$/.test(value.sessionId)
        || !['created', 'recovered'].includes(value.source) || !Number.isFinite(value.at)) throw new Error('Invalid Cron association');
      return { sessionId: value.sessionId, source: value.source, at: value.at };
    } catch (error: any) {
      if (error.code === 'ENOENT') return;
      throw error;
    }
  }
  async set(workspace: string, jobs: CronJobData[], sessionId: string, source: CronAssociation['source']) {
    if (!/^[\w-]{1,200}$/.test(sessionId)) throw new Error('Invalid Cron session identity');
    await mkdir(this.root, { recursive: true });
    for (const job of jobs.filter(job => job.durable)) {
      const file = this.file(workspace, job);
      const temporary = `${file}.${randomUUID()}.tmp`;
      await writeFile(temporary, JSON.stringify({ sessionId, source, at: Date.now() }));
      await rename(temporary, file);
    }
  }
}
