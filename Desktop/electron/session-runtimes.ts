import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { RpcProcess } from './runtime';
import { permissionFromStatus } from './permission-status';
import { projectLaunch, ultracodeNotification } from './launch-state';
import { emptyLaunch, type LaunchState } from '../src/launch-state';
import { isUltracodeInput, visibleInputBlocks } from '../src/ultracode-input';
import { isUserMessage } from '../src/user-message';
import { desktopSystemPolicy } from './workspace-policy';
import { applyMessageEvent } from '../src/message-events';
import { activeHistory, messagesWithEntryIds, type BranchOperation } from './session-branching';
import { importedHistoryMessages } from './imported-history';
import type { Message, Model, ModelSelection, PermissionPreset, RuntimeEvent, RuntimeState, RuntimeStartupTiming, SessionStats, UIRequest } from '../src/contracts';
import { isFullAccessRisk } from '../src/full-access-risk';
import { questionnaire } from '../src/questionnaire';
import { cronState, hasScheduledCron, type CronState } from './cron-state';
import { restoreSelectedModel, UnavailableModelError } from './model-preference';
import { backgroundState, hasBackgroundWork } from './background-work';

export interface WorkerTransport {
  start(node: string, entry: string, cwd: string, env: NodeJS.ProcessEnv, args?: string[]): void;
  request(type: string, args?: Record<string, unknown>, timeout?: number): Promise<any>;
  respond(value: Record<string, unknown>): void;
  stop(): Promise<void>;
}
export interface SessionRuntime {
  id: string;
  cwd: string;
  rpc: WorkerTransport;
  status: string;
  busy: boolean;
  submissions: number;
  operations: number;
  mutating: boolean;
  state?: RuntimeState;
  leafId?: string;
  permissionPreset?: PermissionPreset;
  fullAccessCancellationRevision?: number;
  launch?: LaunchState;
  messages: Message[];
  models: Model[];
  pendingModel?: ModelSelection;
  modelUnavailable?: boolean;
  stats?: SessionStats;
  pendingUI: Map<string, UIRequest>;
  uiTimers: Map<string, NodeJS.Timeout>;
  failed: boolean;
  interrupted: boolean;
  runActive: boolean;
  revision: number;
  touched: number;
  queued?: boolean;
  stopping?: boolean;
  cron?: CronState;
  backgroundActive?: boolean;
  cronScopeDirectory?: string;
  startupTiming?: RuntimeStartupTiming;
}
export function firstUserText(messages: Message[]) {
  const message = messages.find(isUserMessage);
  return message ? visibleInputBlocks({ ...message, role: 'user' }).filter(block => block.type === 'text').map(block => block.text ?? '').join('\n').slice(0, 200) : '';
}
export function taskOutcome(messages: Message[]) {
  const last = messages.at(-1);
  if (last?.role !== 'assistant') return 'idle' as const;
  if (last.stopReason === 'stop') return 'completed' as const;
  if (['error', 'aborted', 'length'].includes(last.stopReason ?? '')) return 'interrupted' as const;
  return 'idle' as const;
}
function workspaceKey(cwd: string) {
  const path = resolve(cwd);
  return process.platform === 'win32' ? path.toLowerCase() : path;
}

// A worker owns one session identity until disposal; edits move its history leaf.
export class SessionRuntimes {
  readonly workers = new Map<string, SessionRuntime>();
  readonly unreadSessionIds = new Set<string>();
  activeId?: string;
  private openingEmpty = new Map<string, Promise<SessionRuntime>>();
  private reads = new Map<SessionRuntime, Set<Promise<void>>>();
  private statsVersions = new WeakMap<SessionRuntime, number>();
  private statsReads = new WeakMap<SessionRuntime, {
    rpc: WorkerTransport; sessionId: string; dirty: boolean; reading?: Promise<void>;
  }>();
  private launchReads = new Map<SessionRuntime, Promise<void>>();
  private launchDirty = new Set<SessionRuntime>();
  private confirmations = new Map<string, { worker: SessionRuntime; resolve: (approved: boolean) => void }>();
  constructor(
    private emit: (event: RuntimeEvent) => void,
    // Reviewed imports can contain 128 MiB of source history plus embedded
    // images. Keep history RPC bounded without disconnecting at 32 MiB.
    private create: (receive: (event: RuntimeEvent) => void) => WorkerTransport = receive =>
      new RpcProcess(receive, 256 * 1024 * 1024),
    private hooks: { launch?: (worker: SessionRuntime) => { env: Record<string, string>; args: string[] }; dispose?: (worker: SessionRuntime) => void;
      event?: (worker: SessionRuntime, event: RuntimeEvent) => RuntimeEvent;
      messages?: (worker: SessionRuntime, messages: Message[]) => Promise<Message[]>;
      initializeModel?: (worker: SessionRuntime, restoring: boolean) => Promise<void>;
      idleLimit?: () => number;
      beforePrompt?: (worker: SessionRuntime, message: string) => Promise<void> } = {},
  ) {}
  get active() { return this.activeId ? this.workers.get(this.activeId) : undefined; }
  get running() { return [...this.workers.values()].some(worker => this.isBusy(worker) || hasBackgroundWork(worker) || worker.queued
    || worker.status === 'connected' && (worker.launch?.goal?.status === 'active' || hasScheduledCron(worker.cron))); }
  isBusy(worker: SessionRuntime) { return worker.busy || worker.submissions > 0 || Boolean(worker.state?.isCompacting || worker.state?.pendingMessageCount) || worker.pendingUI.size > 0; }
  async preparePrompt(worker: SessionRuntime, message: string) { await this.hooks.beforePrompt?.(worker, message); }
  summaries() {
    return [...this.workers.values()].filter(worker => worker.state?.sessionId).map(worker => ({
      runtimeId: worker.id, sessionId: worker.state!.sessionId!, cwd: worker.cwd,
      firstMessage: firstUserText(worker.messages), name: worker.state?.sessionName,
      status: worker.status === 'disconnected' ? 'failed' as const : worker.pendingUI.size ? 'waiting' as const : this.isBusy(worker) || hasBackgroundWork(worker) ? 'running' as const : worker.failed ? 'failed' as const : worker.interrupted || taskOutcome(worker.messages) === 'interrupted' ? 'interrupted' as const : this.unreadSessionIds.has(worker.state!.sessionId!) ? 'completed' as const : 'idle' as const,
    }));
  }
  publish() { this.emit({ type: 'desktop_runtimes', runtimes: this.summaries(), unreadSessionIds: [...this.unreadSessionIds] }); }
  activate(worker: SessionRuntime) {
    this.activeId = worker.id;
    if (worker.state?.sessionId) this.unreadSessionIds.delete(worker.state.sessionId);
    worker.touched = Date.now();
    this.publish();
  }
  require(id = this.activeId) {
    const worker = id && this.workers.get(id);
    if (!worker || worker.status !== 'connected') throw new Error('This session runtime is not connected');
    return worker;
  }
  async open(node: string, entry: string, cwd: string, env: NodeJS.ProcessEnv, sessionPath?: string, branch?: BranchOperation) {
    if (sessionPath || branch) return this.openWorker(node, entry, cwd, env, sessionPath, branch);
    const key = workspaceKey(cwd);
    for (;;) {
      // Wait only for startup or snapshot reads, then recheck all live state.
      while (this.openingEmpty.has(key)) await this.openingEmpty.get(key);
      const candidates = [...this.workers.values()].filter(worker =>
        workspaceKey(worker.cwd) === key && worker.status === 'connected' && worker.state?.sessionId &&
        !worker.messages.length && !worker.state.isStreaming && !this.isBusy(worker) && !hasBackgroundWork(worker) && !worker.mutating &&
        !worker.failed && !worker.interrupted);
      const empty = candidates.find(worker => !worker.operations);
      if (empty) {
        await this.hooks.initializeModel?.(empty, false);
        this.activate(empty);
        return empty;
      }
      const refreshing = candidates.find(worker => worker.operations === this.reads.get(worker)?.size);
      if (!refreshing) break;
      await Promise.all(this.reads.get(refreshing)!);
    }
    const opening = this.openWorker(node, entry, cwd, env);
    this.openingEmpty.set(key, opening);
    try { return await opening; }
    finally { if (this.openingEmpty.get(key) === opening) this.openingEmpty.delete(key); }
  }
  prepare(node: string, entry: string, cwd: string, env: NodeJS.ProcessEnv, sessionPath: string) {
    return this.openWorker(node, entry, cwd, env, sessionPath, undefined, false);
  }
  private async openWorker(node: string, entry: string, cwd: string, env: NodeJS.ProcessEnv, sessionPath?: string, branch?: BranchOperation, activate = true, existing?: SessionRuntime) {
    const worker: SessionRuntime = existing ?? {
      id: randomUUID(), cwd, rpc: undefined!, status: 'connecting', busy: false,
      submissions: 0, operations: 0, mutating: false, messages: [], models: [], pendingUI: new Map(), uiTimers: new Map(), fullAccessCancellationRevision: 0, failed: false, interrupted: false, runActive: false, revision: 0, touched: Date.now(),
    };
    worker.cronScopeDirectory = env.DESKTOP_CRON_SCOPE_DIR ?? existing?.cronScopeDirectory;
    worker.status = 'connecting';
    worker.cron = undefined;
    worker.backgroundActive = false;
    // A transport-local Full Access grant must not survive process replacement.
    if (existing?.permissionPreset === 'full-access') worker.permissionPreset = undefined;
    worker.launch = { ...worker.launch ?? emptyLaunch(), ultracode: false, ultracodeTurn: false };
    let runGeneration = 0;
    let notifiedGeneration = 0;
    const transport = this.create(event => {
      if (this.workers.get(worker.id) !== worker || worker.rpc !== transport || worker.status === 'disconnected') return;
      event = this.hooks.event?.(worker, event) ?? event;
      worker.revision++;
      if (event.type === 'agent_start') { if (!worker.runActive) runGeneration++; worker.busy = true; worker.runActive = true; worker.failed = false; worker.interrupted = false; if (worker.state) { this.unreadSessionIds.delete(worker.state.sessionId!); worker.state = { ...worker.state, isStreaming: true }; } }
      if (event.type === 'agent_settled' && !worker.runActive) {
        worker.busy = false;
        if (worker.state) worker.state = { ...worker.state, isStreaming: false };
      }
      if (event.type === 'message_start' && event.message?.role === 'user') {
        const content = event.message.content;
        const text = typeof content === 'string' ? content : content?.find((block: any) => block.type === 'text')?.text ?? '';
        if (isUltracodeInput(text)) {
          worker.launch = { ...worker.launch ?? emptyLaunch(), ultracodeTurn: true };
          this.publishLaunch(worker);
        }
      }
      if (['compaction_start', 'auto_compaction_start', 'auto_clm_start'].includes(event.type) && worker.state) worker.state = { ...worker.state, isCompacting: true };
      if (['compaction_end', 'auto_compaction_end', 'auto_clm_end'].includes(event.type) && worker.state) worker.state = { ...worker.state, isCompacting: false };
      if (event.type === 'agent_end') {
        const completedGeneration = runGeneration;
        const completed = worker.runActive && !worker.failed && !worker.interrupted && taskOutcome(worker.messages) === 'completed';
        worker.runActive = false; worker.busy = false; worker.touched = Date.now();
        if (worker.state) worker.state = { ...worker.state, isStreaming: false, pendingMessageCount: 0 };
        if (worker.launch?.ultracodeTurn) { worker.launch.ultracodeTurn = false; this.publishLaunch(worker); }
        const notifyCompleted = () => {
          // A shared launch read can settle after several runs; only its latest owner may notify.
          if (this.workers.get(worker.id) !== worker || worker.rpc !== transport || worker.status !== 'connected'
            || worker.runActive || hasBackgroundWork(worker) || completedGeneration !== runGeneration || notifiedGeneration === completedGeneration) return;
          notifiedGeneration = completedGeneration;
          if (worker.id !== this.activeId && worker.state?.sessionId) this.unreadSessionIds.add(worker.state.sessionId);
          this.emit({ type: 'desktop_task_completed', runtimeId: worker.id, sessionId: worker.state?.sessionId });
        };
        if (completed && worker.launch?.goal?.status !== 'active') notifyCompleted();
        else if (completed) {
          const goalId = worker.launch?.goal?.id;
          void this.readLaunch(worker).then(() => {
            if (this.workers.get(worker.id) === worker && worker.rpc === transport
              && !worker.runActive && worker.launch?.goal?.id === goalId
              && ['complete', 'blocked', 'usage_limited', 'budget_limited'].includes(worker.launch?.goal?.status ?? '')) { notifyCompleted(); this.publish(); }
          }).catch(() => {});
        }
      }
      if (event.type === 'tool_execution_end' || event.type === 'agent_end') {
        for (const [id, request] of worker.pendingUI) {
          const question = questionnaire(request);
          if (question && (event.type === 'agent_end' || question.callId === event.toolCallId)) {
            this.clearRequest(worker, id);
            // Reserve a newer revision for the original completion emitted below.
            this.emit({ type: 'desktop_ui_expired', id, runtimeId: worker.id, runtimeRevision: worker.revision++ });
          }
        }
      }
      if (['message_start', 'message_update', 'message_end', 'agent_end', 'desktop_exit'].includes(event.type)) worker.messages = applyMessageEvent(worker.messages, event);
      if (event.type === 'message_end' && event.message?.stopReason === 'error') worker.failed = true;
      if (event.type === 'desktop_exit') {
        worker.status = 'disconnected'; worker.busy = false; worker.runActive = false;
        worker.cron = undefined;
        worker.backgroundActive = false;
        this.hooks.dispose?.(worker);
        if (worker.state) worker.state = { ...worker.state, isStreaming: false, isCompacting: false, pendingMessageCount: 0 };
        for (const id of worker.pendingUI.keys()) this.clearRequest(worker, id);
      }
      if (event.type === 'extension_ui_request') {
        if (event.method === 'setStatus' && event.statusKey === 'desktop-subagents') {
          const background = backgroundState(event.statusText);
          worker.backgroundActive = background.active;
          // The native wake-up can run CLM before emitting agent_start.
          if (background.parentActive) {
            worker.busy = true;
            if (worker.state) worker.state = { ...worker.state, isStreaming: true };
          }
          this.publish();
          return;
        }
        // Only Desktop's explicit confirmation can carry project-trust UI metadata.
        if ('projectTrust' in event) {
          const { projectTrust: _projectTrust, ...nativeEvent } = event;
          event = nativeEvent;
        }
        if (event.method === 'setStatus' && event.statusKey === 'desktop-cron') {
          // A malformed or newer snapshot must not silently release a live host.
          worker.cron = cronState(event.statusText) ?? { version: 1, status: 'unavailable', jobs: worker.cron?.jobs ?? [] };
          this.publish();
          this.emit({ type: 'desktop_cron_changed', runtimeId: worker.id });
          return;
        }
        const ultra = ultracodeNotification({ method: event.method, message: event.message, statusKey: event.statusKey, statusText: event.statusText });
        if (ultra !== undefined) {
          worker.launch = { ...worker.launch ?? emptyLaunch(), ultracode: ultra };
          this.publishLaunch(worker);
        }
        // Preparing a branch is not an active chat. Decline hidden extension prompts.
        if (branch && worker.status === 'connecting' && ['select', 'confirm', 'input', 'editor'].includes(event.method)) {
          worker.rpc.respond({ id: event.id, cancelled: true });
          return;
        }
        const preset = permissionFromStatus({ method: event.method, statusKey: event.statusKey, statusText: event.statusText });
        if (preset) {
          worker.permissionPreset = preset;
          this.emit({ type: 'desktop_permission', preset, runtimeId: worker.id, sessionId: worker.state?.sessionId });
        }
        if (['select', 'confirm', 'input', 'editor'].includes(event.method)) {
          this.clearRequest(worker, event.id);
          worker.pendingUI.set(event.id, { ...event, runtimeId: worker.id } as UIRequest);
          const timeout = isFullAccessRisk({ method: event.method, title: event.title, options: event.options })
            ? Math.min(Number.isFinite(event.timeout) && event.timeout > 0 ? event.timeout : 120000, 120000) : event.timeout;
          if (Number.isFinite(timeout) && timeout > 0) worker.uiTimers.set(event.id, setTimeout(() => {
            if (this.workers.get(worker.id) !== worker || !worker.pendingUI.has(event.id)) return;
            try { worker.rpc.respond({ id: event.id, cancelled: true }); } catch {}
            this.clearRequest(worker, event.id);
            this.emit({ type: 'desktop_ui_expired', id: event.id, runtimeId: worker.id, runtimeRevision: ++worker.revision });
            this.publish();
          }, Math.min(timeout, 2147483647)).unref());
        }
      }
      this.emit({ ...event, runtimeId: worker.id, runtimeRevision: worker.revision, sessionId: worker.state?.sessionId });
      // Long-running turns may contain many model/tool messages before agent_end.
      if (['message_end', 'agent_end', 'compaction_end', 'auto_compaction_end', 'auto_clm_end'].includes(event.type))
        void this.refreshStats(worker).catch(() => {});
      if (worker.state?.sessionId && (event.type === 'agent_end'
        || event.type === 'tool_execution_end' && ['create_goal', 'get_goal', 'update_goal', 'enter_plan_mode', 'exit_plan_mode'].includes(event.toolName)
        || event.type === 'extension_ui_request' && (event.method === 'setStatus' && ['step-goal', 'plan-mode'].includes(event.statusKey)
          || event.method === 'notify' && /^(?:Goal|Plan mode|Ultraloop)/.test(event.message ?? ''))))
        void this.readLaunch(worker).catch(() => {});
      if (['agent_start', 'agent_end', 'agent_settled', 'desktop_exit', 'extension_ui_request', 'compaction_start', 'compaction_end', 'auto_compaction_start', 'auto_compaction_end', 'auto_clm_start', 'auto_clm_end'].includes(event.type) || event.type === 'message_start' && event.message?.role === 'user') this.publish();
    });
    worker.rpc = transport;
    this.workers.set(worker.id, worker);
    try {
      const launch = this.hooks.launch?.(worker);
      const startedAt = performance.now();
      worker.rpc.start(node, entry, cwd, { ...env, ...launch?.env, DESKTOP_CRON_SCOPE_DIR: worker.cronScopeDirectory,
        STEPCODE_DESKTOP_BRANCH_SOURCE: branch && branch.kind !== 'open-copy' && sessionPath ? resolve(sessionPath) : undefined,
      }, ['--include-live-events', '--append-system-prompt', desktopSystemPolicy(cwd),
        ...(existing && !sessionPath && worker.state?.sessionId ? ['--session-id', worker.state.sessionId] : []), ...(launch?.args ?? [])]);
      await worker.rpc.request('get_state', {}, 60000);
      const processReadyAt = performance.now();
      const result = existing && !sessionPath ? { cancelled: false }
        : await worker.rpc.request(sessionPath ? 'switch_session' : 'new_session', sessionPath ? { sessionPath, cwdOverride: cwd } : {}, 60000);
      if (result.cancelled) throw new Error('Session operation cancelled');
      if (branch) {
        const sourceState = await worker.rpc.request('get_state');
        if (branch.kind === 'open-copy') {
          if (sourceState.sessionId !== branch.sessionId) throw new Error('Copied session identity changed');
        } else {
          const history = await worker.rpc.request('get_entries');
          if (history.leafId !== branch.leafId) throw new Error('Session history changed; reopen it and try again');
          const selected = activeHistory(history.entries, history.leafId).find(item => item.id === branch.entryId);
          if (selected?.type !== 'message' || selected.message?.role !== (branch.kind === 'fork' ? 'user' : 'assistant')) throw new Error('Invalid branch point');
          const response = await worker.rpc.request(branch.kind, branch.kind === 'fork' ? { entryId: branch.entryId } : {}, 60000);
          if (response.cancelled) throw new Error('Session operation cancelled');
          const nextState = await worker.rpc.request('get_state');
          if (!nextState.sessionId || nextState.sessionId === sourceState.sessionId) throw new Error('Runtime did not create a new session');
        }
        const permissionPreset = branch.permissionPreset ?? worker.permissionPreset;
        if (permissionPreset && permissionPreset !== 'full-access') {
          const { commands } = await worker.rpc.request('get_commands');
          if (!commands?.some((command: { name: string; source: string }) => command.name === 'permissions' && command.source === 'extension')) throw new Error('Cannot preserve session permissions');
          await worker.rpc.request('prompt', { message: `/permissions ${permissionPreset}` });
        }
        if (branch.name) await worker.rpc.request('set_session_name', { name: branch.name });
      }
      const sessionRestoredAt = performance.now();
      worker.status = 'connected';
      worker.state = await worker.rpc.request('get_state');
      await this.read(worker);
      const snapshotAt = performance.now();
      // Recovery is already explicitly confirmed with its own model, and refresh
      // below restores the captured live selection rather than a global default.
      if (!existing && env.DESKTOP_CRON_RECOVERY !== '1')
        await this.hooks.initializeModel?.(worker, Boolean(sessionPath || branch));
      const modelRestoredAt = performance.now();
      worker.startupTiming = {
        processReadyMs: processReadyAt - startedAt,
        sessionRestoreMs: sessionRestoredAt - processReadyAt,
        snapshotMs: snapshotAt - sessionRestoredAt,
        modelRestoreMs: modelRestoredAt - snapshotAt,
        totalMs: modelRestoredAt - startedAt,
      };
      if (activate) this.activate(worker);
      else this.publish();
      return worker;
    } catch (error) {
      this.hooks.dispose?.(worker);
      this.workers.delete(worker.id);
      await worker.rpc.stop();
      throw error;
    }
  }
  read(worker: SessionRuntime): Promise<void> {
    if (worker.status !== 'connected') return Promise.resolve();
    const reads = this.reads.get(worker) ?? new Set<Promise<void>>();
    this.reads.set(worker, reads);
    worker.operations++;
    const reading = this.readSnapshot(worker).finally(() => {
      worker.operations--;
      reads.delete(reading);
      if (!reads.size) this.reads.delete(worker);
    });
    reads.add(reading);
    return reading;
  }
  private async readSnapshot(worker: SessionRuntime) {
    const revision = worker.revision;
    const rpc = worker.rpc;
    const statsVersion = this.nextStatsVersion(worker);
    const [state, { messages }, { models }, stats, history] = await Promise.all([
      worker.rpc.request('get_state'), worker.rpc.request('get_messages'),
      worker.rpc.request('get_available_models'), worker.rpc.request('get_session_stats'),
      worker.rpc.request('get_entries'),
    ]);
    if (worker.rpc !== rpc || worker.status !== 'connected' || this.workers.get(worker.id) !== worker) return;
    const projected = importedHistoryMessages(messages, history.entries ?? [], history.leafId ?? null);
    const savedMessages = projected === messages
      ? messagesWithEntryIds(messages, history.entries ?? [], history.leafId ?? null) : projected;
    if (revision === worker.revision && state.sessionId)
      worker.launch = projectLaunch(history.entries ?? [], history.leafId ?? null, state.sessionId, worker.launch);
    const decorated = this.hooks.messages ? await this.hooks.messages(worker, savedMessages) : savedMessages;
    if (worker.rpc !== rpc || worker.status !== 'connected' || this.workers.get(worker.id) !== worker) return;
    // Never replace newly received deltas with an older asynchronous snapshot.
    if (revision === worker.revision) {
      worker.state = state;
      // get_messages contains committed history, not the in-flight assistant.
      if (!state.isStreaming) {
        worker.messages = decorated;
        worker.leafId = history.leafId ?? undefined;
      }
      worker.busy = Boolean(state.isStreaming);
    }
    worker.models = models;
    if (this.statsVersions.get(worker) === statsVersion) worker.stats = stats;
    worker.touched = Date.now();
  }
  private nextStatsVersion(worker: SessionRuntime) {
    const version = (this.statsVersions.get(worker) ?? 0) + 1;
    this.statsVersions.set(worker, version);
    return version;
  }
  private async refreshStats(worker: SessionRuntime) {
    if (worker.status !== 'connected' || !worker.state?.sessionId) return;
    const rpc = worker.rpc;
    const sessionId = worker.state.sessionId;
    this.nextStatsVersion(worker);
    const existing = this.statsReads.get(worker);
    if (existing?.rpc === rpc && existing.sessionId === sessionId) {
      existing.dirty = true;
      return existing.reading;
    }
    const pending = { rpc, sessionId, dirty: true, reading: undefined as Promise<void> | undefined };
    this.statsReads.set(worker, pending);
    pending.reading = (async () => {
      worker.operations++;
      try {
        while (pending.dirty) {
          if (this.workers.get(worker.id) !== worker || worker.rpc !== rpc || worker.status !== 'connected'
            || worker.state?.sessionId !== sessionId) return;
          pending.dirty = false;
          const version = this.nextStatsVersion(worker);
          let stats: SessionStats;
          try {
            // Upstream owns both its working-context estimate and cumulative usage.
            stats = await rpc.request('get_session_stats');
          } catch (error) {
            if (pending.dirty) continue;
            throw error;
          }
          if (this.workers.get(worker.id) !== worker || worker.rpc !== rpc || worker.status !== 'connected'
            || worker.state?.sessionId !== sessionId) return;
          if (this.statsVersions.get(worker) !== version) continue;
          worker.stats = stats;
          this.emit({ type: 'desktop_stats', runtimeId: worker.id, sessionId, stats });
        }
      } finally {
        worker.operations--;
        if (this.statsReads.get(worker) === pending) this.statsReads.delete(worker);
      }
    })();
    return pending.reading;
  }
  publishLaunch(worker: SessionRuntime) {
    this.emit({ type: 'desktop_launch', runtimeId: worker.id, sessionId: worker.state?.sessionId, launch: worker.launch });
  }
  readLaunch(worker: SessionRuntime): Promise<void> {
    this.launchDirty.add(worker);
    const existing = this.launchReads.get(worker);
    if (existing) return existing;
    const rpc = worker.rpc;
    const sessionId = worker.state?.sessionId;
    const read = (async () => {
      while (this.launchDirty.delete(worker)) {
        if (!sessionId || this.workers.get(worker.id) !== worker || worker.rpc !== rpc || worker.status !== 'connected') return;
        const history = await rpc.request('get_entries');
        if (this.workers.get(worker.id) !== worker || worker.rpc !== rpc || worker.state?.sessionId !== sessionId) return;
        const next = projectLaunch(history.entries ?? [], history.leafId ?? null, sessionId, worker.launch);
        if (JSON.stringify(next) !== JSON.stringify(worker.launch)) { worker.launch = next; this.publishLaunch(worker); }
      }
    })().finally(() => { this.launchReads.delete(worker); this.launchDirty.delete(worker); });
    this.launchReads.set(worker, read);
    return read;
  }
  async assertIdle(worker: SessionRuntime, options: { stopHost?: boolean } = {}) {
    const assertHost = () => {
      if (hasBackgroundWork(worker)) throw new Error('Stop background agents before changing this session runtime');
      if (options.stopHost && hasScheduledCron(worker.cron)) throw new Error('Delete scheduled Cron jobs before restarting or changing this runtime; Cron state must be available');
    };
    assertHost();
    if (worker.launch?.goal?.status === 'active') throw new Error('Pause the active goal first');
    if (worker.queued) throw new Error('Send or withdraw the pending messages first');
    if (this.isBusy(worker)) throw new Error('Stop this session task first');
    if (worker.status === 'connected') {
      const state = await worker.rpc.request('get_state');
      assertHost();
      if (state.isStreaming || state.isCompacting || state.pendingMessageCount) throw new Error('Stop this session task first');
    }
  }
  async retryLatest(worker: SessionRuntime, entryId: string, message: string) {
    await this.assertIdle(worker);
    await this.read(worker);
    const latest = [...worker.messages].reverse().find(item => item.role === 'user');
    if (!latest?.entryId || latest.entryId !== entryId) throw new Error('Only the most recent saved message can be edited');
    const images = typeof latest.content === 'string' ? [] : latest.content.filter(block => block.type === 'image');
    if (!message.trim() && !images.length) throw new Error('Message is empty');
    const { commands } = await worker.rpc.request('get_commands');
    if (!commands?.some((command: { name: string; source: string }) => command.name === '_desktop_retry' && command.source === 'extension')) {
      throw new Error('This runtime does not support editing messages');
    }
    const history = await worker.rpc.request('get_entries');
    if (history.leafId !== worker.leafId) throw new Error('Session history changed; try again');
    const selected = activeHistory(history.entries, history.leafId).find(item => item.id === entryId);
    if (!selected || selected.type !== 'message' || selected.message?.role !== 'user') throw new Error('Invalid edit point');
    const sessionId = worker.state?.sessionId;
    const sessionFile = worker.state?.sessionFile;
    const permissionPreset = worker.permissionPreset;
    await worker.rpc.request('prompt', { message: `/_desktop_retry ${entryId}` }, 60000);
    await this.read(worker);
    if (worker.state?.sessionId !== sessionId || (worker.leafId ?? null) !== selected.parentId) {
      throw new Error('Runtime did not restore the edit point');
    }
    this.emit({ type: 'desktop_history', runtimeId: worker.id, runtimeRevision: ++worker.revision, sessionId, messages: worker.messages });
    worker.submissions++;
    this.publish();
    try {
      await this.preparePrompt(worker, message);
      await worker.rpc.request('prompt', { message, ...(images.length ? { images } : {}) }, 600000);
    } catch (error) {
      const current = await worker.rpc.request('get_entries');
      // A rejected submission may not append anything. Restore the saved leaf
      // so the original question remains editable instead of stranding its draft.
      if ((current.leafId ?? null) === selected.parentId && sessionFile) {
        const restored = await worker.rpc.request('switch_session', { sessionPath: sessionFile, cwdOverride: worker.cwd }, 60000);
        if (restored.cancelled) throw new Error('Submission failed and history restoration was cancelled');
        if (permissionPreset && permissionPreset !== 'full-access') await worker.rpc.request('prompt', { message: `/permissions ${permissionPreset}` });
        await this.read(worker);
        if (worker.state?.sessionId !== sessionId || worker.leafId !== history.leafId) throw new Error('Submission failed and history could not be restored');
        this.emit({ type: 'desktop_history', runtimeId: worker.id, runtimeRevision: ++worker.revision, sessionId, messages: worker.messages });
      }
      throw error;
    } finally { worker.submissions--; this.publish(); }
  }
  async assertAllIdle(options: { stopHost?: boolean } = {}) {
    for (const worker of this.workers.values()) {
      if (worker.mutating) throw new Error('Session operation in progress');
      await this.assertIdle(worker, { stopHost: options.stopHost !== false });
    }
  }
  async refresh(worker: SessionRuntime, node: string, entry: string, env: NodeJS.ProcessEnv,
    options: { allowUnavailableModel?: boolean } = {}) {
    await this.assertIdle(worker, { stopHost: true });
    if (worker.operations || worker.mutating || worker.stopping) throw new Error('Session operation in progress');
    const sessionFile = worker.state?.sessionFile && existsSync(worker.state.sessionFile) ? worker.state.sessionFile : undefined;
    const sessionId = worker.state?.sessionId;
    const model = worker.state?.model;
    const thinkingLevel = worker.state?.thinkingLevel;
    const permissionPreset = worker.permissionPreset;
    const previousState = worker.state;
    worker.modelUnavailable = false;
    worker.mutating = true;
    // Ignore late exit events from the old transport without changing the UI identity.
    this.workers.delete(worker.id);
    try {
      this.hooks.dispose?.(worker);
      await worker.rpc.stop();
      await this.openWorker(node, entry, worker.cwd, env, sessionFile, undefined, false, worker);
      if (worker.state?.sessionId !== sessionId) throw new Error('Runtime changed session identity');
      await restoreSelectedModel(worker, model);
      if (model && thinkingLevel) {
        const { levels } = await worker.rpc.request('get_available_thinking_levels');
        if (levels?.includes(thinkingLevel)) await worker.rpc.request('set_thinking_level', { level: thinkingLevel });
      }
      if (permissionPreset && permissionPreset !== 'full-access') await worker.rpc.request('prompt', { message: `/permissions ${permissionPreset}` });
      await this.read(worker);
    } catch (error) {
      worker.state = previousState;
      await this.suspend([worker]);
      if (error instanceof UnavailableModelError) {
        worker.modelUnavailable = true;
        if (options.allowUnavailableModel) return;
      }
      throw error;
    } finally { worker.mutating = false; this.publish(); }
  }
  async suspend(workers: SessionRuntime[] = [...this.workers.values()]) {
    // Keep history and navigation identities, but expose no usable mixed-config transport.
    for (const worker of workers) {
      worker.status = 'disconnected'; worker.busy = false; worker.runActive = false;
      worker.cron = undefined;
      worker.backgroundActive = false;
      worker.failed = true;
      if (worker.state) worker.state = { ...worker.state, isStreaming: false, isCompacting: false, pendingMessageCount: 0 };
      this.workers.set(worker.id, worker);
      this.hooks.dispose?.(worker);
      for (const id of worker.pendingUI.keys()) this.clearRequest(worker, id);
    }
    const stopped = await Promise.allSettled(workers.map(worker => worker.rpc.stop()));
    this.publish();
    const failed = stopped.find(result => result.status === 'rejected');
    if (failed?.status === 'rejected') throw failed.reason;
  }
  clearRequest(worker: SessionRuntime, id: string) {
    const confirmation = this.confirmations.get(id);
    if (confirmation?.worker === worker) { this.confirmations.delete(id); confirmation.resolve(false); }
    clearTimeout(worker.uiTimers.get(id));
    worker.uiTimers.delete(id); worker.pendingUI.delete(id);
  }
  confirm(worker: SessionRuntime, title: string, message: string, signal?: AbortSignal, projectTrust?: UIRequest['projectTrust']): Promise<boolean> {
    if (signal?.aborted || this.workers.get(worker.id) !== worker) return Promise.resolve(false);
    const id = randomUUID();
    return new Promise(resolve => {
      const cancel = () => {
        this.clearRequest(worker, id);
        this.emit({ type: 'desktop_ui_expired', id, runtimeId: worker.id });
        this.publish();
      };
      this.confirmations.set(id, { worker, resolve: approved => { signal?.removeEventListener('abort', cancel); resolve(approved); } });
      const request: UIRequest = { type: 'extension_ui_request', method: 'confirm', id, runtimeId: worker.id, title, message, messageStyle: 'preformatted', timeout: 120000,
        ...(projectTrust ? { projectTrust } : {}) };
      worker.pendingUI.set(id, request);
      worker.uiTimers.set(id, setTimeout(cancel, 120000).unref());
      signal?.addEventListener('abort', cancel, { once: true });
      this.emit({ ...request, sessionId: worker.state?.sessionId });
      this.publish();
    });
  }
  respondToRequest(worker: SessionRuntime, answer: Record<string, unknown>) {
    const id = String(answer.id);
    const request = worker.pendingUI.get(id);
    if (!request) throw new Error('This request has expired');
    const confirmation = this.confirmations.get(id);
    if (confirmation?.worker === worker) {
      this.confirmations.delete(id);
      confirmation.resolve(answer.confirmed === true && answer.cancelled !== true);
    } else {
      worker.rpc.respond(answer);
      if (isFullAccessRisk(request) && (answer.cancelled === true || answer.value === request.options?.[2]))
        worker.fullAccessCancellationRevision = (worker.fullAccessCancellationRevision ?? 0) + 1;
    }
    this.clearRequest(worker, id);
    this.publish();
  }
  async remove(worker: SessionRuntime) {
    this.hooks.dispose?.(worker);
    this.workers.delete(worker.id);
    if (this.activeId === worker.id) this.activeId = undefined;
    for (const id of worker.pendingUI.keys()) this.clearRequest(worker, id);
    await worker.rpc.stop();
    this.publish();
  }
  async recycle(retain: (worker: SessionRuntime) => boolean = () => false) {
    const recyclable = (worker: SessionRuntime) => this.workers.get(worker.id) === worker &&
      !retain(worker) && worker.id !== this.activeId && worker.status === 'connected' && !this.isBusy(worker) &&
      !hasBackgroundWork(worker) &&
      worker.launch?.goal?.status !== 'active' &&
      !hasScheduledCron(worker.cron) &&
      !worker.operations && !worker.mutating && !worker.pendingModel && !worker.queued && worker.messages.length > 0;
    const idle = [...this.workers.values()].filter(recyclable);
    const requestedLimit = this.hooks.idleLimit?.() ?? 2;
    const idleLimit = Number.isFinite(requestedLimit) ? Math.max(0, Math.min(4, Math.floor(requestedLimit))) : 2;
    idle.sort((a, b) => b.touched - a.touched);
    for (const worker of idle) if (recyclable(worker) &&
      (idle.indexOf(worker) >= idleLimit || Date.now() - worker.touched > 5 * 60000)) await this.remove(worker);
  }
  async stopAll() {
    const workers = [...this.workers.values()];
    this.workers.clear(); this.activeId = undefined;
    for (const worker of workers) {
      this.hooks.dispose?.(worker);
      for (const id of worker.pendingUI.keys()) this.clearRequest(worker, id);
    }
    await Promise.all(workers.map(worker => worker.rpc.stop()));
  }
}
