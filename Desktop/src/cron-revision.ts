import type { CronJobData } from './contracts';

// Ignore scheduler advancement, but reject edits made against changed task content.
export function cronRevision(job: CronJobData): string {
  return JSON.stringify([job.id, job.createdAt, job.cron, job.prompt, job.recurring, job.durable,
    job.autoExpireAt ?? null, job.desktopPausedAt ?? null]);
}
