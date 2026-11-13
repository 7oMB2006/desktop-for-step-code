import { createHash, randomUUID } from 'node:crypto';
import type { RuntimeEvent, UIRequest } from '../src/contracts';
import type { ExternalApprovalAudit, ExternalApprovalLease, ExternalApprovalState, ExternalConnectorAction } from '../src/external-connectors';
import { completionReview, reviewActive } from '../src/completion-review';
import { redactSensitiveText } from '../src/subagent-redact';
import { isUltracodeInput } from '../src/ultracode-input';
import { hasBackgroundWork } from './background-work';
import type { QueueReceiptEvent } from './pending-messages';
import type { SessionRuntime, WorkerTransport } from './session-runtimes';
import { taskOutcome } from './task-outcome';
import { delegatedApproval } from './external-connector-approvals';

export const externalConnectorProtocol = 'dfsc-external-v1';
export const externalConnectorMethods = [
  'system.capabilities', 'task.create', 'run.submit', 'task.list', 'task.get', 'task.stop',
  'approval.list', 'approval.respond',
] as const;
export interface ExternalGrant {
  agentId: string;
  roots: string[];
  validate?(): Promise<void>;
}
export interface ExternalTaskHost {
  validate(cwd: string, roots: string[]): Promise<void>;
  create(cwd: string, valid: () => boolean): Promise<SessionRuntime>;
  submit(worker: SessionRuntime, message: string, accepted: (queueId: string) => void, valid: () => boolean): Promise<void>;
  withdraw(worker: SessionRuntime, queueId: string): boolean;
  stop(worker: SessionRuntime): Promise<void>;
  discard?(worker: SessionRuntime): Promise<void>;
  respond?(worker: SessionRuntime, request: UIRequest, confirmed: boolean): void;
}
type TaskPhase = 'creating' | 'waiting' | 'queued' | 'running' | 'completed' | 'stopped' | 'failed' | 'interrupted' | 'unknown';
interface Submission {
  keyHash: string;
  inputHash: string;
  queueId?: string;
  receipt?: QueueReceiptEvent;
  delivered?: boolean;
}
export interface SavedExternalTask {
  id: string;
  agentId: string;
  cwd: string;
  title: string;
  createKeyHash: string;
  createInputHash: string;
  createdAt: number;
  phase: TaskPhase;
  sessionId?: string;
  runtimeId?: string;
  submission?: Submission;
  stopRequested?: boolean;
  reason?: string;
}
export interface ExternalTasksState { version: 1; tasks: SavedExternalTask[]; approvalAudit?: ExternalApprovalAudit[] }
export interface ExternalTaskStore {
  load(): Promise<unknown>;
  save(value: ExternalTasksState): Promise<void>;
}
interface Attachment { worker: SessionRuntime; rpc: WorkerTransport; task: SavedExternalTask }
const phases: TaskPhase[] = ['creating', 'waiting', 'queued', 'running', 'completed', 'stopped', 'failed', 'interrupted', 'unknown'];
const terminal = (phase: TaskPhase) => ['completed', 'stopped', 'failed', 'interrupted', 'unknown'].includes(phase);
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const object = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === 'object' && !Array.isArray(value));
const ident = (value: unknown) => typeof value === 'string' && /^[a-z0-9][a-z0-9_-]{0,63}$/u.test(value);
const hex = (value: unknown) => typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);
function fail(code: string): never { throw new Error(`connector:${code}`); }
function text(value: unknown, limit: number, multiline = false): string {
  if (typeof value !== 'string' || !value.trim() || value.length > limit
    || (multiline ? /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u : /[\u0000-\u001f\u007f]/u).test(value))
    return fail('invalid-input');
  return value;
}
function key(value: unknown) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,127}$/u.test(value)) return fail('invalid-input');
  return hash(value);
}
function fields(value: unknown, allowed: string[]): Record<string, unknown> {
  if (!object(value) || Object.keys(value).some(field => !allowed.includes(field))) return fail('invalid-input');
  return value;
}
function safe(value: string, limit: number) {
  return redactSensitiveText(value).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u202a-\u202e\u2066-\u2069]/gu, '').slice(0, limit);
}

// This owns only routing metadata. Native runtimes remain the source of execution and approval.
export class ExternalConnectorTasks {
  private tasks: SavedExternalTask[] = [];
  private attachments = new Map<SessionRuntime, Attachment>();
  private summaries = new Map<string, { text: string; truncated: boolean }>();
  private mutations: Promise<unknown> = Promise.resolve();
  private writes: Promise<void> = Promise.resolve();
  private initialized?: Promise<void>;
  private storageFailed = false;
  private cleanups = new Set<Promise<void>>();
  private cleanupFailed = false;
  private leases = new Map<string, ExternalApprovalLease>();
  private leaseDeadlines = new WeakMap<ExternalApprovalLease, number>();
  private delegationRevisions = new Map<string, number>();
  private approvalAudit: ExternalApprovalAudit[] = [];
  private approvalRefs = new WeakMap<UIRequest, { id: string; fingerprint: string; lease: ExternalApprovalLease }>();
  private escalated = new WeakSet<UIRequest>();
  constructor(private host: ExternalTaskHost, private store: ExternalTaskStore) {}

  initialize() {
    return this.initialized ??= (async () => {
      try {
        const raw = await this.store.load();
        if (raw === undefined || raw === null) return;
        if (!object(raw) || raw.version !== 1 || !Array.isArray(raw.tasks) || raw.tasks.length > 100) fail('storage');
        if (raw.approvalAudit !== undefined) {
          if (!Array.isArray(raw.approvalAudit) || raw.approvalAudit.length > 200) fail('storage');
          this.approvalAudit = raw.approvalAudit.map((entry: unknown) => {
            if (!object(entry) || typeof entry.taskId !== 'string' || !/^[a-f0-9-]{36}$/u.test(entry.taskId)
              || !ident(entry.agentId) || typeof entry.at !== 'number' || !Number.isFinite(entry.at)
              || !['grant', 'revoke', 'allow', 'deny', 'escalate'].includes(String(entry.action))
              || !['prepared', 'applied', 'not-applied'].includes(String(entry.outcome))
              || typeof entry.reason !== 'string' || entry.reason.length > 600
              || entry.requestId !== undefined && (typeof entry.requestId !== 'string' || !/^[a-f0-9-]{36}$/u.test(entry.requestId))
              || entry.callId !== undefined && (typeof entry.callId !== 'string' || entry.callId.length > 200)) return fail('storage');
            return { taskId: entry.taskId, agentId: entry.agentId as string, at: entry.at,
              action: entry.action as ExternalApprovalAudit['action'], outcome: entry.outcome as ExternalApprovalAudit['outcome'],
              reason: safe(entry.reason, 600),
              ...(entry.requestId ? { requestId: entry.requestId as string } : {}),
              ...(entry.callId ? { callId: safe(entry.callId as string, 200) } : {}) };
          });
        }
        const seen = new Set<string>(), keys = new Set<string>();
        this.tasks = raw.tasks.map((value: unknown) => {
          if (!object(value) || typeof value.id !== 'string' || !/^[a-f0-9-]{36}$/u.test(value.id)
            || !ident(value.agentId) || typeof value.cwd !== 'string' || value.cwd.length > 4096
            || typeof value.title !== 'string' || value.title.length > 160 || !hex(value.createKeyHash) || !hex(value.createInputHash)
            || typeof value.createdAt !== 'number' || !Number.isFinite(value.createdAt)
            || !phases.includes(value.phase as TaskPhase)
            || value.sessionId !== undefined && (typeof value.sessionId !== 'string' || value.sessionId.length > 200)
            || value.runtimeId !== undefined && (typeof value.runtimeId !== 'string' || value.runtimeId.length > 200)
            || value.stopRequested !== undefined && typeof value.stopRequested !== 'boolean'
            || value.reason !== undefined && (typeof value.reason !== 'string' || !/^[a-z-]{1,64}$/u.test(value.reason)))
            return fail('storage');
          const taskKey = `${value.agentId}:${value.createKeyHash}`;
          if (seen.has(value.id) || keys.has(taskKey)) return fail('storage');
          seen.add(value.id); keys.add(taskKey);
          const task: SavedExternalTask = {
            id: value.id, agentId: value.agentId as string, cwd: value.cwd, title: value.title,
            createKeyHash: value.createKeyHash as string, createInputHash: value.createInputHash as string,
            createdAt: value.createdAt, phase: value.phase as TaskPhase,
            ...(value.sessionId ? { sessionId: value.sessionId as string } : {}),
            ...(value.runtimeId ? { runtimeId: value.runtimeId as string } : {}),
            ...(value.stopRequested ? { stopRequested: true } : {}),
            ...(value.reason ? { reason: value.reason as string } : {}),
          };
          if (value.submission !== undefined) {
            const submission = value.submission;
            if (!object(submission) || !hex(submission.keyHash) || !hex(submission.inputHash)
              || submission.queueId !== undefined && (typeof submission.queueId !== 'string' || submission.queueId.length > 200)
              || submission.receipt !== undefined && !['delivered', 'removed', 'dispatching', 'unknown'].includes(String(submission.receipt))
              || submission.delivered !== undefined && typeof submission.delivered !== 'boolean') return fail('storage');
            task.submission = { keyHash: submission.keyHash as string, inputHash: submission.inputHash as string,
              ...(submission.queueId ? { queueId: submission.queueId as string } : {}),
              ...(submission.receipt ? { receipt: submission.receipt as QueueReceiptEvent } : {}),
              ...(submission.delivered ? { delivered: true } : {}) };
          }
          if (!terminal(task.phase)) { task.phase = 'interrupted'; task.reason = 'desktop-restarted'; }
          return task;
        });
        // Never reattach a prior process or replay a persisted input.
        await this.persist();
      } catch { this.storageFailed = true; fail('storage'); }
    })();
  }

  private persist() {
    const snapshot: ExternalTasksState = { version: 1, tasks: structuredClone(this.tasks),
      ...(this.approvalAudit.length ? { approvalAudit: structuredClone(this.approvalAudit) } : {}) };
    const write = this.writes.then(() => this.store.save(snapshot));
    this.writes = write.catch(() => { this.storageFailed = true; });
    return write.catch(() => fail('storage'));
  }
  private remember() { void this.persist().catch(() => {}); }
  private discard(worker: SessionRuntime) {
    if (!this.host.discard) return Promise.resolve();
    const pending = Promise.resolve().then(() => this.host.discard!(worker)).catch(() => {
      this.cleanupFailed = true;
      fail('cleanup-unconfirmed');
    });
    this.cleanups.add(pending);
    void pending.finally(() => this.cleanups.delete(pending)).catch(() => {});
    return pending;
  }
  private serial<T>(action: () => Promise<T>): Promise<T> {
    const pending = this.mutations.then(action);
    this.mutations = pending.catch(() => {});
    return pending;
  }
  private valid(valid: () => boolean) { if (!valid()) fail('revoked'); }
  private mutable(valid: () => boolean) {
    this.valid(valid);
    if (this.storageFailed) fail('storage');
  }
  private async authorize(grant: ExternalGrant, cwd: string, valid: () => boolean) {
    this.valid(valid);
    if (!grant.roots.includes(cwd)) fail('scope');
    await grant.validate?.();
    this.valid(valid);
    await this.host.validate(cwd, grant.roots);
    this.valid(valid);
    // Host validation can consider other grants; only this grant may authorize this request.
    await grant.validate?.();
    this.valid(valid);
  }
  private task(grant: ExternalGrant, id: unknown) {
    const taskId = text(id, 200);
    const task = this.tasks.find(task => task.id === taskId && task.agentId === grant.agentId);
    if (!task) return fail('task-unavailable');
    return task;
  }
  private attachment(task: SavedExternalTask) {
    const attachment = [...this.attachments.values()].find(value => value.task === task);
    if (!attachment || attachment.worker.rpc !== attachment.rpc
      || attachment.worker.state?.sessionId !== task.sessionId || attachment.worker.cwd !== task.cwd
      || attachment.worker.status !== 'connected') return fail('session-unavailable');
    return attachment;
  }
  private lease(task: SavedExternalTask) {
    const lease = this.leases.get(task.id);
    if (!lease || lease.expiresAt <= Date.now() || (this.leaseDeadlines.get(lease) ?? 0) <= performance.now()
      || terminal(task.phase) || task.stopRequested) return;
    return lease;
  }
  private audit(task: SavedExternalTask, action: ExternalApprovalAudit['action'], reason: string,
    outcome: ExternalApprovalAudit['outcome'] = 'applied') {
    const entry: ExternalApprovalAudit = { taskId: task.id, agentId: task.agentId, at: Date.now(), action, reason: safe(reason, 600), outcome };
    this.approvalAudit.push(entry);
    this.approvalAudit = this.approvalAudit.slice(-200);
    return entry;
  }
  localApprovals(): ExternalApprovalState {
    return { tasks: [...this.attachments.values()].filter(({ task, worker, rpc }) =>
      !terminal(task.phase) && worker.status === 'connected' && worker.rpc === rpc
      && worker.state?.sessionId === task.sessionId && worker.cwd === task.cwd).map(({ task, worker }) => ({
        taskId: task.id, agentId: task.agentId, title: safe(task.title, 160), cwd: task.cwd, phase: task.phase,
        pending: worker.pendingUI.size,
        ...(this.lease(task) ? { delegation: structuredClone(this.lease(task)!) } : {}),
      })), audit: structuredClone(this.approvalAudit).reverse() };
  }
  async delegate(action: Extract<ExternalConnectorAction, { type: 'delegate' | 'undelegate' }>) {
    await this.initialize();
    const task = this.tasks.find(value => value.id === action.taskId);
    if (!task) fail('task-unavailable');
    const revision = (this.delegationRevisions.get(task.id) ?? 0) + 1;
    this.delegationRevisions.set(task.id, revision);
    // Revoking or replacing a scope immediately invalidates any in-flight decision.
    this.leases.delete(task.id);
    if (action.type === 'undelegate') {
      this.audit(task, 'revoke', 'local-user');
      await this.persist();
      return;
    }
    return this.serial(async () => {
      if (this.storageFailed) fail('storage');
      const { worker } = this.attachment(task);
      if (terminal(task.phase) || task.stopRequested || worker.permissionPreset !== 'ask' || !this.host.respond) fail('session-unavailable');
      // Also validate here: this is a local authority boundary, not only an IPC parser.
      if (![15, 30, 60].includes(action.minutes) || !Array.isArray(action.categories) || !action.categories.length
        || action.categories.length > 2 || new Set(action.categories).size !== action.categories.length
        || action.categories.some(value => value !== 'command' && value !== 'file')) fail('invalid-input');
      const lease = { expiresAt: Date.now() + action.minutes * 60000, categories: [...action.categories] };
      this.leaseDeadlines.set(lease, performance.now() + action.minutes * 60000);
      const entry = this.audit(task, 'grant', `${action.minutes}m: ${action.categories.join(',')}; expires=${lease.expiresAt}`, 'prepared');
      await this.persist();
      try {
        this.attachment(task);
        if (this.delegationRevisions.get(task.id) !== revision) fail('revoked');
        if (terminal(task.phase) || task.stopRequested || worker.permissionPreset !== 'ask') fail('session-unavailable');
        this.leases.set(task.id, lease);
        entry.outcome = 'applied';
        await this.persist();
      } catch (error) {
        if (this.leases.get(task.id) === lease) this.leases.delete(task.id);
        entry.outcome = 'not-applied';
        await this.persist();
        throw error;
      }
    });
  }
  private approvals(task: SavedExternalTask) {
    const { worker } = this.attachment(task), lease = this.lease(task);
    if (!lease || worker.permissionPreset !== 'ask' || !this.host.respond) return [];
    return [...worker.pendingUI.values()].flatMap(request => {
      if (this.escalated.has(request)) return [];
      const projection = delegatedApproval(worker, request);
      if (!projection || !lease.categories.includes(projection.category)
        || projection.verificationCommand !== undefined && !lease.categories.includes('command')) return [];
      let ref = this.approvalRefs.get(request);
      if (!ref || ref.fingerprint !== projection.fingerprint || ref.lease !== lease) {
        ref = { id: randomUUID(), fingerprint: projection.fingerprint, lease };
        this.approvalRefs.set(request, ref);
      }
      const { fingerprint: _, ...value } = projection;
      return [{ requestId: ref.id, ...value }];
    }).slice(0, 4);
  }
  private async respond(grant: ExternalGrant, params: unknown, valid: () => boolean) {
    this.mutable(valid);
    const input = fields(params, ['taskId', 'requestId', 'decision', 'reason']);
    const task = this.task(grant, input.taskId), requestId = text(input.requestId, 200), reason = text(input.reason, 500, true);
    if (!['allow', 'deny', 'escalate'].includes(String(input.decision))) fail('invalid-input');
    const decision = input.decision as 'allow' | 'deny' | 'escalate';
    const lease = this.lease(task);
    if (!lease) fail('local-approval');
    await this.authorize(grant, task.cwd, valid); this.mutable(valid);
    const { worker } = this.attachment(task);
    const request = [...worker.pendingUI.values()].find(value => this.approvalRefs.get(value)?.id === requestId);
    if (!request || !this.approvals(task).some(value => value.requestId === requestId)) fail('approval-expired');
    const ref = this.approvalRefs.get(request)!;
    const entry = this.audit(task, decision, reason, 'prepared');
    entry.requestId = requestId;
    entry.callId = this.approvals(task).find(value => value.requestId === requestId)!.callId;
    await this.persist();
    let attempted = false;
    try {
      await this.authorize(grant, task.cwd, valid); this.mutable(valid);
      const current = this.attachment(task);
      if (current.worker !== worker || this.lease(task) !== lease
        || worker.pendingUI.get(request.id) !== request || this.escalated.has(request)
        || delegatedApproval(worker, request)?.fingerprint !== ref.fingerprint
        || worker.permissionPreset !== 'ask') fail('approval-expired');
      if (decision === 'escalate') this.escalated.add(request);
      else {
        // A throwing transport may already have sent the response. Never replay it.
        attempted = true;
        this.escalated.add(request);
        this.host.respond!(worker, request, decision === 'allow');
      }
      entry.outcome = 'applied';
    } catch (error) {
      entry.outcome = attempted ? 'prepared' : 'not-applied';
      await this.persist();
      throw error;
    }
    await this.persist();
    return { taskId: task.id, requestId, decision, outcome: 'applied' };
  }
  private project(task: SavedExternalTask, includeSummary = true) {
    const attached = [...this.attachments.values()].find(value => value.task === task);
    const summary = this.summaries.get(task.id);
    return {
      id: task.id, title: safe(task.title, 160), cwd: task.cwd, origin: { agentProfile: task.agentId },
      phase: task.phase, createdAt: task.createdAt,
      ...(task.sessionId ? { sessionId: task.sessionId } : {}),
      ...(task.runtimeId ? { runtimeId: task.runtimeId } : {}),
      ...(task.reason ? { reason: task.reason } : {}),
      awaitingLocalApproval: Boolean(attached?.worker.pendingUI.size),
      ...(this.lease(task) ? { approvalDelegation: structuredClone(this.lease(task)!) } : {}),
      resultAvailable: summary !== undefined,
      ...(includeSummary && summary !== undefined ? { summary: summary.text, summaryTruncated: summary.truncated } : {}),
      ...(task.submission ? { submitted: true, receipt: task.submission.receipt ?? 'pending' } : { submitted: false }),
    };
  }

  async call(grant: ExternalGrant, method: string, params: unknown, valid: () => boolean = () => true): Promise<unknown> {
    await this.initialize();
    this.valid(valid);
    if (!ident(grant.agentId) || !Array.isArray(grant.roots) || grant.roots.length > 32
      || !grant.roots.every(root => typeof root === 'string' && root.length <= 4096)) fail('invalid-input');
    if (!(externalConnectorMethods as readonly string[]).includes(method)) fail('unsupported-method');
    return this.serial(async () => {
      this.valid(valid);
      switch (method) {
        case 'system.capabilities': {
          fields(params, []);
          await grant.validate?.(); this.valid(valid);
          return { protocol: externalConnectorProtocol, version: 1, agentId: grant.agentId, roots: [...grant.roots],
            methods: [...externalConnectorMethods], approvals: 'local-with-explicit-task-delegation', oneRunPerTask: true,
            completedMeans: 'native-turn-ended-not-user-accepted' };
        }
        case 'task.list': {
          const input = fields(params, ['offset']);
          const offset = input.offset ?? 0;
          if (typeof offset !== 'number' || !Number.isSafeInteger(offset) || offset < 0 || offset > 100) fail('invalid-input');
          return this.tasks.filter(task => task.agentId === grant.agentId).slice(offset, offset + 20).map(task => this.project(task, false));
        }
        case 'task.get': return this.project(this.task(grant, fields(params, ['taskId']).taskId));
        case 'approval.list': {
          const task = this.task(grant, fields(params, ['taskId']).taskId);
          await this.authorize(grant, task.cwd, valid);
          return { taskId: task.id, delegation: this.lease(task) ? structuredClone(this.lease(task)!) : null,
            requests: terminal(task.phase) ? [] : this.approvals(task) };
        }
        case 'approval.respond': return this.respond(grant, params, valid);
        case 'task.create': {
          this.mutable(valid);
          const input = fields(params, ['key', 'cwd', 'title']);
          const keyHash = key(input.key), cwd = text(input.cwd, 4096), title = text(input.title, 160);
          const inputHash = hash({ cwd, title });
          const existing = this.tasks.find(task => task.agentId === grant.agentId && task.createKeyHash === keyHash);
          if (existing) {
            if (existing.createInputHash !== inputHash) fail('key-conflict');
            return this.project(existing);
          }
          if (this.tasks.length >= 100 || this.tasks.filter(task => task.agentId === grant.agentId).length >= 50
            || this.tasks.filter(task => !terminal(task.phase)).length >= 8) fail('task-limit');
          await this.authorize(grant, cwd, valid); this.mutable(valid);
          const task: SavedExternalTask = {
            id: randomUUID(), agentId: grant.agentId, cwd, title, createKeyHash: keyHash, createInputHash: inputHash,
            createdAt: Date.now(), phase: 'creating',
          };
          this.tasks.push(task);
          let created: SessionRuntime | undefined;
          try {
            await this.persist(); this.mutable(valid);
            await this.authorize(grant, cwd, valid); this.mutable(valid);
            const worker = await this.host.create(cwd, valid);
            created = worker;
            this.valid(valid);
            if (worker.status !== 'connected' || worker.cwd !== cwd || !worker.state?.sessionId
              || worker.permissionPreset !== 'ask' || worker.messages.length || this.attachments.has(worker))
              fail('session-unavailable');
            task.sessionId = worker.state.sessionId; task.runtimeId = worker.id; task.phase = 'waiting';
            this.attachments.set(worker, { task, worker, rpc: worker.rpc });
            await this.authorize(grant, cwd, valid); this.mutable(valid);
            await this.persist();
            this.valid(valid);
            return this.project(task);
          } catch (error) {
            this.finish(task, valid() ? 'unknown' : 'interrupted', valid() ? 'creation-unconfirmed' : 'authorization-revoked');
            try { await this.persist(); }
            finally { if (created) await this.discard(created); }
            throw error instanceof Error && /^connector:[a-z-]+$/u.test(error.message) ? error : new Error('connector:creation-unconfirmed');
          }
        }
        case 'run.submit': {
          this.mutable(valid);
          const input = fields(params, ['taskId', 'key', 'message']);
          const task = this.task(grant, input.taskId), keyHash = key(input.key);
          const message = text(input.message, 32000, true);
          // Native slash commands are control input, not external engineering text.
          if (message.trimStart().startsWith('/') || isUltracodeInput(message.trimStart())) fail('control-command');
          const inputHash = hash(message);
          if (task.submission) {
            if (task.submission.keyHash !== keyHash || task.submission.inputHash !== inputHash) fail('key-conflict');
            return this.project(task);
          }
          if (task.phase !== 'waiting') fail('task-not-ready');
          await this.authorize(grant, task.cwd, valid); this.mutable(valid);
          const attachment = this.attachment(task);
          if (attachment.worker.permissionPreset !== 'ask') fail('ask-required');
          task.submission = { keyHash, inputHash }; task.phase = 'queued';
          try {
            await this.persist(); this.mutable(valid);
            await this.authorize(grant, task.cwd, valid); this.mutable(valid);
            const current = this.attachment(task);
            if (current !== attachment || current.worker.permissionPreset !== 'ask') fail('ask-required');
            await this.host.submit(current.worker, message, queueId => {
              task.submission!.queueId = queueId;
              this.remember();
            }, valid);
            this.valid(valid);
            return this.project(task);
          } catch (error) {
            if (!terminal(task.phase)) this.finish(task, valid() ? 'unknown' : 'interrupted', valid() ? 'submission-unconfirmed' : 'authorization-revoked');
            try { await this.persist(); }
            finally { if (!task.submission?.queueId) await this.discard(attachment.worker); }
            throw error instanceof Error && /^connector:[a-z-]+$/u.test(error.message) ? error : new Error('connector:submission-unconfirmed');
          }
        }
        case 'task.stop': {
          this.mutable(valid);
          const task = this.task(grant, fields(params, ['taskId']).taskId);
          if (terminal(task.phase)) return this.project(task);
          const { worker } = this.attachment(task);
          task.stopRequested = true;
          await this.persist(); this.mutable(valid);
          this.attachment(task);
          if (!task.submission || task.submission.queueId && this.host.withdraw(worker, task.submission.queueId)) {
            this.finish(task, 'stopped'); await this.persist();
            await this.discard(worker);
          } else {
            await this.host.stop(worker);
            if (!terminal(task.phase) && !worker.busy && !worker.runActive) {
              this.finish(task, 'stopped'); await this.persist();
            }
          }
          return this.project(task);
        }
        default: return fail('unsupported-method');
      }
    });
  }

  private finish(task: SavedExternalTask, phase: TaskPhase, reason?: string) {
    task.phase = phase;
    this.leases.delete(task.id);
    if (reason) task.reason = reason;
    for (const [worker, attachment] of this.attachments) if (attachment.task === task) this.attachments.delete(worker);
  }
  event(worker: SessionRuntime, event: RuntimeEvent) {
    const attached = this.attachments.get(worker);
    if (!attached) return;
    const { task } = attached;
    if (worker.rpc !== attached.rpc || worker.state?.sessionId !== task.sessionId || worker.cwd !== task.cwd) {
      this.finish(task, 'interrupted', 'session-identity-changed'); this.remember(); return;
    }
    if (!task.submission || terminal(task.phase)) return;
    if (event.type === 'desktop_exit') { this.dispose(worker); return; }
    if (event.type === 'agent_start') { task.phase = 'running'; this.remember(); }
    const review = event.type === 'desktop_completion_review' ? completionReview(event.review) : undefined;
    const reviewEnded = review && review.sessionId === task.sessionId && !reviewActive(review);
    const ended = event.type === 'desktop_task_completed' || (event.type === 'agent_end' || event.desktopRecoverySettled)
      && !event.desktopRecoveryPending && !event.desktopReviewPending || reviewEnded;
    if (!ended) return;
    if (!task.submission.delivered) {
      this.finish(task, 'unknown', 'delivery-unconfirmed'); this.remember(); return;
    }
    const outcome = taskOutcome(worker.messages);
    if (outcome === 'completed' && !task.stopRequested && !worker.failed && !worker.interrupted
      && (worker.launch?.goal?.status === 'active' || hasBackgroundWork(worker))) return;
    const phase = task.stopRequested || worker.interrupted || reviewEnded && review.status === 'cancelled' ? 'stopped'
      : worker.failed || outcome === 'interrupted' || reviewEnded && review.status === 'failed' ? 'failed'
        : outcome === 'completed' ? 'completed' : 'unknown';
    if (phase === 'completed') {
      const assistant = worker.messages.at(-1)!;
      const content = typeof assistant.content === 'string' ? assistant.content
        : assistant.content.filter(block => block.type === 'text').map(block => block.text ?? '').join('\n');
      const redacted = safe(content, 8001);
      this.summaries.set(task.id, { text: redacted.slice(0, 8000), truncated: redacted.length > 8000 });
    }
    this.finish(task, phase, phase === 'unknown' ? 'completion-unconfirmed' : undefined);
    this.remember();
  }
  queueEvent(worker: SessionRuntime, id: string, event: QueueReceiptEvent) {
    const attached = this.attachments.get(worker), submission = attached?.task.submission;
    if (!attached || !submission || submission.queueId !== id || terminal(attached.task.phase)) return;
    submission.receipt = event;
    if (event === 'delivered') submission.delivered = true;
    if (event === 'removed') this.finish(attached.task, 'stopped', 'queued-input-removed');
    this.remember();
  }
  queueFailed(worker: SessionRuntime) {
    const attached = this.attachments.get(worker);
    if (!attached || !attached.task.submission) return;
    this.finish(attached.task, 'unknown', 'submission-unconfirmed'); this.remember();
  }
  // Called only after native abort and clear_queue have both succeeded.
  locallyStopped(worker: SessionRuntime) {
    const attached = this.attachments.get(worker);
    if (!attached) return;
    if (worker.rpc !== attached.rpc || worker.state?.sessionId !== attached.task.sessionId || worker.cwd !== attached.task.cwd)
      this.finish(attached.task, 'interrupted', 'session-identity-changed');
    else this.finish(attached.task, 'stopped', 'locally-stopped');
    this.remember();
  }
  dispose(worker: SessionRuntime) {
    const attached = this.attachments.get(worker);
    if (!attached) return;
    this.finish(attached.task, 'interrupted', 'native-session-disposed'); this.remember();
  }
  retains(worker: SessionRuntime) { return this.attachments.has(worker); }
  invalidate(agentId?: string) {
    for (const task of this.tasks) {
      if (agentId !== undefined && task.agentId !== agentId) continue;
      if (terminal(task.phase)) continue;
      const attachment = [...this.attachments.values()].find(value => value.task === task);
      const removed = attachment && task.submission?.queueId ? this.host.withdraw(attachment.worker, task.submission.queueId) : false;
      this.finish(task, 'interrupted', 'authorization-revoked');
      if (attachment && (!task.submission || removed)) void this.discard(attachment.worker).catch(() => {});
    }
    this.remember();
  }
  async flush() {
    await this.mutations; await Promise.allSettled([...this.cleanups]); await this.writes;
    if (this.storageFailed) fail('storage');
    if (this.cleanupFailed) fail('cleanup-unconfirmed');
  }
}
