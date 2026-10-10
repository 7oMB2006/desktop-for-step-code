import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { RpcProcess } from './runtime';
import { permissionFromStatus } from './permission-status';
import { WORKSPACE_POLICY } from './workspace-policy';
import { applyMessageEvent } from '../src/message-events';
import { activeHistory, messagesWithEntryIds, type BranchOperation } from './session-branching';
import type { Message, Model, ModelSelection, PermissionPreset, RuntimeEvent, RuntimeState, SessionStats, UIRequest } from '../src/contracts';

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
  messages: Message[];
  models: Model[];
  pendingModel?: ModelSelection;
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
}
export function firstUserText(messages: Message[]) {
  const content = messages.find(message => message.role === 'user')?.content;
  return (typeof content === 'string' ? content : content?.filter(block => block.type === 'text').map(block => block.text ?? '').join('\n') ?? '').slice(0, 200);
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
  private confirmations = new Map<string, { worker: SessionRuntime; resolve: (approved: boolean) => void }>();
  constructor(
    private emit: (event: RuntimeEvent) => void,
    private create: (receive: (event: RuntimeEvent) => void) => WorkerTransport = receive => new RpcProcess(receive),
    private hooks: { launch?: (worker: SessionRuntime) => { env: Record<string, string>; args: string[] }; dispose?: (worker: SessionRuntime) => void;
      event?: (worker: SessionRuntime, event: RuntimeEvent) => RuntimeEvent;
      messages?: (worker: SessionRuntime, messages: Message[]) => Promise<Message[]>;
      beforePrompt?: (worker: SessionRuntime, message: string) => Promise<void> } = {},
  ) {}
  get active() { return this.activeId ? this.workers.get(this.activeId) : undefined; }
  get running() { return [...this.workers.values()].some(worker => this.isBusy(worker) || worker.queued); }
  isBusy(worker: SessionRuntime) { return worker.busy || worker.submissions > 0 || Boolean(worker.state?.isCompacting || worker.state?.pendingMessageCount) || worker.pendingUI.size > 0; }
  async preparePrompt(worker: SessionRuntime, message: string) { await this.hooks.beforePrompt?.(worker, message); }
  summaries() {
    return [...this.workers.values()].filter(worker => worker.state?.sessionId).map(worker => ({
      runtimeId: worker.id, sessionId: worker.state!.sessionId!, cwd: worker.cwd,
      firstMessage: firstUserText(worker.messages), name: worker.state?.sessionName,
      status: worker.status === 'disconnected' ? 'failed' as const : worker.pendingUI.size ? 'waiting' as const : this.isBusy(worker) ? 'running' as const : worker.failed ? 'failed' as const : worker.interrupted || taskOutcome(worker.messages) === 'interrupted' ? 'interrupted' as const : this.unreadSessionIds.has(worker.state!.sessionId!) ? 'completed' as const : 'idle' as const,
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
        !worker.messages.length && !worker.state.isStreaming && !this.isBusy(worker) && !worker.mutating &&
        !worker.failed && !worker.interrupted);
      const empty = candidates.find(worker => !worker.operations);
      if (empty) {
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
  private async openWorker(node: string, entry: string, cwd: string, env: NodeJS.ProcessEnv, sessionPath?: string, branch?: BranchOperation, activate = true) {
    const worker: SessionRuntime = {
      id: randomUUID(), cwd, rpc: undefined!, status: 'connecting', busy: false,
      submissions: 0, operations: 0, mutating: false, messages: [], models: [], pendingUI: new Map(), uiTimers: new Map(), failed: false, interrupted: false, runActive: false, revision: 0, touched: Date.now(),
    };
    worker.rpc = this.create(event => {
      if (this.workers.get(worker.id) !== worker) return;
      event = this.hooks.event?.(worker, event) ?? event;
      worker.revision++;
      if (event.type === 'agent_start') { worker.busy = true; worker.runActive = true; worker.failed = false; worker.interrupted = false; if (worker.state) { this.unreadSessionIds.delete(worker.state.sessionId!); worker.state = { ...worker.state, isStreaming: true }; } }
      if (event.type === 'auto_compaction_start' && worker.state) worker.state = { ...worker.state, isCompacting: true };
      if (event.type === 'auto_compaction_end' && worker.state) worker.state = { ...worker.state, isCompacting: false };
      if (event.type === 'agent_end') {
        const completed = worker.runActive && !worker.failed && !worker.interrupted && taskOutcome(worker.messages) === 'completed';
        worker.runActive = false; worker.busy = false; worker.touched = Date.now();
        if (worker.state) worker.state = { ...worker.state, isStreaming: false, pendingMessageCount: 0 };
        if (completed) {
          if (worker.id !== this.activeId && worker.state?.sessionId) this.unreadSessionIds.add(worker.state.sessionId);
          this.emit({ type: 'desktop_task_completed', runtimeId: worker.id, sessionId: worker.state?.sessionId });
        }
      }
      if (['message_start', 'message_update', 'message_end', 'agent_end', 'desktop_exit'].includes(event.type)) worker.messages = applyMessageEvent(worker.messages, event);
      if (event.type === 'message_end' && event.message?.stopReason === 'error') worker.failed = true;
      if (event.type === 'desktop_exit') {
        worker.status = 'disconnected'; worker.busy = false; worker.runActive = false;
        this.hooks.dispose?.(worker);
        if (worker.state) worker.state = { ...worker.state, isStreaming: false, isCompacting: false, pendingMessageCount: 0 };
        for (const id of worker.pendingUI.keys()) this.clearRequest(worker, id);
      }
      if (event.type === 'extension_ui_request') {
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
          if (Number.isFinite(event.timeout) && event.timeout > 0) worker.uiTimers.set(event.id, setTimeout(() => {
            if (this.workers.get(worker.id) !== worker || !worker.pendingUI.has(event.id)) return;
            try { worker.rpc.respond({ id: event.id, cancelled: true }); } catch {}
            this.clearRequest(worker, event.id);
            this.emit({ type: 'desktop_ui_expired', id: event.id, runtimeId: worker.id });
            this.publish();
          }, Math.min(event.timeout, 2147483647)).unref());
        }
      }
      this.emit({ ...event, runtimeId: worker.id, runtimeRevision: worker.revision, sessionId: worker.state?.sessionId });
      if (['agent_start', 'agent_end', 'desktop_exit', 'extension_ui_request'].includes(event.type) || event.type === 'message_start' && event.message?.role === 'user') this.publish();
    });
    this.workers.set(worker.id, worker);
    try {
      const launch = this.hooks.launch?.(worker);
      worker.rpc.start(node, entry, cwd, { ...env, ...launch?.env }, ['--append-system-prompt', WORKSPACE_POLICY, ...(launch?.args ?? [])]);
      await worker.rpc.request('get_state', {}, 60000);
      const result = await worker.rpc.request(sessionPath ? 'switch_session' : 'new_session', sessionPath ? { sessionPath } : {}, 60000);
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
        if (permissionPreset) {
          const { commands } = await worker.rpc.request('get_commands');
          if (!commands?.some((command: { name: string; source: string }) => command.name === 'permissions' && command.source === 'extension')) throw new Error('Cannot preserve session permissions');
          await worker.rpc.request('prompt', { message: `/permissions ${permissionPreset}` });
        }
        if (branch.name) await worker.rpc.request('set_session_name', { name: branch.name });
      }
      worker.status = 'connected';
      worker.state = await worker.rpc.request('get_state');
      await this.read(worker);
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
    const [state, { messages }, { models }, stats, history] = await Promise.all([
      worker.rpc.request('get_state'), worker.rpc.request('get_messages'),
      worker.rpc.request('get_available_models'), worker.rpc.request('get_session_stats'),
      worker.rpc.request('get_entries'),
    ]);
    const savedMessages = messagesWithEntryIds(messages, history.entries ?? [], history.leafId ?? null);
    const decorated = this.hooks.messages ? await this.hooks.messages(worker, savedMessages) : savedMessages;
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
    worker.models = models; worker.stats = stats; worker.touched = Date.now();
  }
  async assertIdle(worker: SessionRuntime) {
    if (worker.queued) throw new Error('Send or withdraw the pending messages first');
    if (this.isBusy(worker)) throw new Error('Stop this session task first');
    if (worker.status === 'connected') {
      const state = await worker.rpc.request('get_state');
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
        const restored = await worker.rpc.request('switch_session', { sessionPath: sessionFile }, 60000);
        if (restored.cancelled) throw new Error('Submission failed and history restoration was cancelled');
        if (permissionPreset) await worker.rpc.request('prompt', { message: `/permissions ${permissionPreset}` });
        await this.read(worker);
        if (worker.state?.sessionId !== sessionId || worker.leafId !== history.leafId) throw new Error('Submission failed and history could not be restored');
        this.emit({ type: 'desktop_history', runtimeId: worker.id, runtimeRevision: ++worker.revision, sessionId, messages: worker.messages });
      }
      throw error;
    } finally { worker.submissions--; this.publish(); }
  }
  async assertAllIdle() {
    for (const worker of this.workers.values()) {
      if (worker.mutating) throw new Error('Session operation in progress');
      await this.assertIdle(worker);
    }
  }
  clearRequest(worker: SessionRuntime, id: string) {
    const confirmation = this.confirmations.get(id);
    if (confirmation?.worker === worker) { this.confirmations.delete(id); confirmation.resolve(false); }
    clearTimeout(worker.uiTimers.get(id));
    worker.uiTimers.delete(id); worker.pendingUI.delete(id);
  }
  confirm(worker: SessionRuntime, title: string, message: string, signal?: AbortSignal): Promise<boolean> {
    if (signal?.aborted || this.workers.get(worker.id) !== worker) return Promise.resolve(false);
    const id = randomUUID();
    return new Promise(resolve => {
      const cancel = () => {
        this.clearRequest(worker, id);
        this.emit({ type: 'desktop_ui_expired', id, runtimeId: worker.id });
        this.publish();
      };
      this.confirmations.set(id, { worker, resolve: approved => { signal?.removeEventListener('abort', cancel); resolve(approved); } });
      const request: UIRequest = { type: 'extension_ui_request', method: 'confirm', id, runtimeId: worker.id, title, message, messageStyle: 'preformatted', timeout: 120000 };
      worker.pendingUI.set(id, request);
      worker.uiTimers.set(id, setTimeout(cancel, 120000).unref());
      signal?.addEventListener('abort', cancel, { once: true });
      this.emit({ ...request, sessionId: worker.state?.sessionId });
      this.publish();
    });
  }
  respondToRequest(worker: SessionRuntime, answer: Record<string, unknown>) {
    const id = String(answer.id);
    if (!worker.pendingUI.has(id)) throw new Error('This request has expired');
    const confirmation = this.confirmations.get(id);
    if (confirmation?.worker === worker) {
      this.confirmations.delete(id);
      confirmation.resolve(answer.confirmed === true && answer.cancelled !== true);
    } else worker.rpc.respond(answer);
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
  async recycle() {
    const recyclable = (worker: SessionRuntime) => this.workers.get(worker.id) === worker &&
      worker.id !== this.activeId && worker.status === 'connected' && !this.isBusy(worker) &&
      !worker.operations && !worker.mutating && !worker.pendingModel && !worker.queued && worker.messages.length > 0;
    const idle = [...this.workers.values()].filter(recyclable);
    idle.sort((a, b) => b.touched - a.touched);
    for (const worker of idle) if (recyclable(worker) &&
      (idle.indexOf(worker) >= 2 || Date.now() - worker.touched > 5 * 60000)) await this.remove(worker);
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
