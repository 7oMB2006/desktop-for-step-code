import type { CronAssociation, CronHistoryEntry, Session } from '../src/contracts';
import type { CronBindings } from './cron-bindings';
import type { CronHistory } from './cron-history';
import { createHash } from 'node:crypto';
import { isAbsolute } from 'node:path';

type OwnerEvidence =
  | { kind: 'unavailable' | 'conflict' }
  | { kind: 'verified'; association: CronAssociation; sessionId: string };

interface MigrationEvidence {
  // The caller must match the sidecar to this exact task and verify a unique
  // saved, non-archived session in the same trusted workspace.
  owner: OwnerEvidence;
  execution: 'clear' | 'unconfirmed' | 'completed-one-shot';
  now: number;
}

type InactiveReason = 'unsupported-record' | 'unconfirmed-execution' | 'completed' | 'already-delivered' | 'expired' |
  'overdue' | 'owner-unavailable' | 'owner-conflict' | 'invalid-clock' | 'duplicate-task-id';

type LegacyCronReview =
  | { kind: 'inactive'; reason: InactiveReason; paused: boolean }
  | { kind: 'candidate'; sessionId: string; status: 'enabled' | 'paused' };

const fields = new Set([
  'schemaVersion', 'id', 'cron', 'prompt', 'recurring', 'durable', 'createdAt',
  'nextFireAt', 'lastFiredAt', 'autoExpireAt', 'desktopPausedAt',
]);
const timestamp = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 8.64e15;
const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const taskId = (value: unknown): value is string => typeof value === 'string' && /^[\w-]{1,24}$/.test(value);

// This is a review result, not authority to write, schedule, or restore a grant.
// Recheck the evidence and trigger time under the native store lock before use.
export function reviewLegacyCronRecord(value: unknown, evidence: MigrationEvidence): LegacyCronReview {
  const row = record(value);
  const paused = Object.hasOwn(row, 'desktopPausedAt');
  const inactive = (reason: InactiveReason): LegacyCronReview => ({ kind: 'inactive', reason, paused });
  if (Object.keys(row).some(key => !fields.has(key))
    || (paused ? row.schemaVersion !== 2 || !timestamp(row.desktopPausedAt) : row.schemaVersion !== 1)
    || !taskId(row.id)
    || typeof row.cron !== 'string' || !row.cron.trim() || row.cron.length > 100
    || typeof row.prompt !== 'string' || row.prompt.length > 4000
    || row.durable !== true || typeof row.recurring !== 'boolean'
    || !timestamp(row.createdAt) || !timestamp(row.nextFireAt)
    || row.autoExpireAt !== undefined && !timestamp(row.autoExpireAt)
    || row.lastFiredAt !== undefined && !timestamp(row.lastFiredAt)) return inactive('unsupported-record');

  const { now, owner, execution } = evidence;
  if (!timestamp(now)) return inactive('invalid-clock');
  if (execution === 'unconfirmed') return inactive('unconfirmed-execution');
  if (execution === 'completed-one-shot') return inactive('completed');
  if (!row.recurring && row.lastFiredAt !== undefined) return inactive('already-delivered');
  if (row.autoExpireAt !== undefined && row.autoExpireAt <= now) return inactive('expired');
  if (!paused && row.nextFireAt <= now) return inactive('overdue');
  if (owner.kind === 'conflict') return inactive('owner-conflict');
  if (owner.kind !== 'verified') return inactive('owner-unavailable');
  if (!/^[\w-]{1,200}$/.test(owner.sessionId) || owner.sessionId !== owner.association.sessionId)
    return inactive('owner-conflict');
  return { kind: 'candidate', sessionId: owner.sessionId, status: paused ? 'paused' : 'enabled' };
}

type SavedSession = Pick<Session, 'id' | 'path' | 'cwd'>;

interface ReviewSources {
  saved: (workspace: string) => Promise<{ trusted: boolean; jobs: unknown }>;
  sessions: () => Promise<readonly SavedSession[]>;
  archived: (sessionId: string) => boolean;
  sameWorkspace: (sessionWorkspace: string, workspace: string) => Promise<boolean>;
  verifyManagedSession: (path: string) => Promise<void>;
  bindings: Pick<CronBindings, 'get'>;
  history: Pick<CronHistory, 'migrationSnapshot'>;
  now?: () => number;
}

type ProjectReview =
  | { kind: 'untrusted' }
  | { kind: 'reviewed'; tasks: { id?: string; createdAt?: number; review: LegacyCronReview }[] };

// Internal preview over the trusted store. No prompts, session paths or grants
// are returned, and a preview must never authorize a later write on its own.
export async function reviewLegacyCronProject(workspace: string, sources: ReviewSources): Promise<ProjectReview> {
  const { trusted, jobs } = await sources.saved(workspace);
  if (trusted !== true) return { kind: 'untrusted' };
  if (!Array.isArray(jobs) || jobs.length > 50) throw new Error('Invalid Cron migration inventory');

  const sessions = await sources.sessions();
  const history = sources.history.migrationSnapshot(workspace);
  const rows = jobs.map(record);
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const { id } of rows) {
    if (!taskId(id)) continue;
    if (seen.has(id)) duplicates.add(id);
    seen.add(id);
  }

  const ownership = async (id: string, createdAt: number): Promise<OwnerEvidence> => {
    try {
      const association = await sources.bindings.get(workspace, { id, createdAt, durable: true });
      if (!association) return { kind: 'unavailable' };
      const matches = sessions.filter(session => session.id === association.sessionId);
      if (matches.length > 1) return { kind: 'conflict' };
      const [target] = matches;
      if (!target?.path || sources.archived(target.id) || !await sources.sameWorkspace(target.cwd, workspace))
        return { kind: 'unavailable' };
      await sources.verifyManagedSession(target.path);
      return { kind: 'verified', association, sessionId: target.id };
    } catch {
      return { kind: 'unavailable' };
    }
  };
  const execution = (id: string, createdAt: number) => {
    if (history.unconfirmed || history.entries.some(entry => unresolvedFor(entry, id, createdAt))) return 'unconfirmed';
    return history.entries.some(entry => entry.jobId === id && entry.createdAt === createdAt && entry.state === 'completed')
      ? 'completed' : 'clear';
  };

  const now = sources.now ?? Date.now;
  const tasks: Extract<ProjectReview, { kind: 'reviewed' }>['tasks'] = [];
  for (const row of rows) {
    const id = taskId(row.id) ? row.id : undefined;
    const createdAt = timestamp(row.createdAt) ? row.createdAt : undefined;
    const baseline = reviewLegacyCronRecord(row, { owner: { kind: 'unavailable' }, execution: 'clear', now: now() });
    let review = baseline;
    if (id && duplicates.has(id)) {
      review = { kind: 'inactive', reason: 'duplicate-task-id', paused: Object.hasOwn(row, 'desktopPausedAt') };
    } else if (id && createdAt !== undefined && baseline.kind === 'inactive' && baseline.reason !== 'unsupported-record') {
      const state = execution(id, createdAt);
      const owner = baseline.reason === 'owner-unavailable' && state !== 'unconfirmed'
        ? await ownership(id, createdAt) : { kind: 'unavailable' } as const;
      review = reviewLegacyCronRecord(row, {
        owner, now: now(), execution: state === 'completed' ? row.recurring ? 'clear' : 'completed-one-shot' : state,
      });
    }
    tasks.push({ id, createdAt, review });
  }
  return { kind: 'reviewed', tasks };
}

function unresolvedFor(entry: CronHistoryEntry, id: string, createdAt: number) {
  return entry.reviewedAt === undefined && ['triggered', 'running', 'waiting', 'unknown', 'interrupted'].includes(entry.state)
    && (entry.jobId === undefined || entry.jobId === id && (entry.createdAt === undefined || entry.createdAt === createdAt));
}

// The native store owns the file lock and preserves rows it cannot parse.
interface LockedCronStore<Row> {
  update(mutate: (jobs: Row[]) => readonly Row[]): void;
}

export interface LegacyCronConversion {
  id: string;
  createdAt: number;
  revision: string;
  sessionId: string;
  status: 'enabled' | 'paused';
}

export function legacyCronRevision(value: unknown): string {
  const row = record(value);
  return createHash('sha256').update(JSON.stringify(Object.keys(row).sort().map(key => [key, row[key]]))).digest('hex');
}

// Internal transaction primitive. The caller must stop older workers before
// conversion and must not arm the new scheduler until upgrade gating is installed.
export function convertLegacyCronRecord<Row extends object>(
  store: LockedCronStore<Row>,
  approved: LegacyCronConversion,
  verify: () => MigrationEvidence & { sessionFile: string },
): void {
  store.update(jobs => {
    const matches = jobs.filter(job => record(job).id === approved.id);
    const [target] = matches;
    if (matches.length !== 1 || record(target).createdAt !== approved.createdAt
      || legacyCronRevision(target) !== approved.revision) throw new Error('Cron record changed; review again');

    // Do not let the native store's ID-indexed rewrite collapse duplicate rows.
    const ids = jobs.map(job => record(job).id);
    if (new Set(ids).size !== ids.length) throw new Error('Duplicate Cron records; review again');
    const evidence = verify();
    const current = reviewLegacyCronRecord(target, evidence);
    if (current.kind !== 'candidate' || current.sessionId !== approved.sessionId || current.status !== approved.status
      || !isAbsolute(evidence.sessionFile)) throw new Error('Cron migration evidence changed; review again');

    const converted = { ...target, schemaVersion: 2, origin: 'legacy',
      sessionId: current.sessionId, sessionFile: evidence.sessionFile, status: current.status };
    delete (converted as Record<string, unknown>).desktopPausedAt;
    return jobs.map(job => job === target ? converted : job);
  });
}
