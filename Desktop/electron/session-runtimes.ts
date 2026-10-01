import { randomUUID } from 'node:crypto';
import { RpcProcess } from './runtime';
import { permissionFromStatus } from './permission-status';
import { applyMessageEvent } from '../src/message-events';
import type { Message, Model, PermissionPreset, RuntimeEvent, RuntimeState, SessionStats, UIRequest } from '../src/contracts';

export interface WorkerTransport {
  start(node: string, entry: string, cwd: string, env: NodeJS.ProcessEnv): void;
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
  permissionPreset?: PermissionPreset;
  messages: Message[];
  models: Model[];
  stats?: SessionStats;
  pendingUI: Map<string, UIRequest>;
  uiTimers: Map<string, NodeJS.Timeout>;
  failed: boolean;
  interrupted: boolean;
  runActive: boolean;
  revision: number;
  touched: number;
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

// A worker never switches history: its identity remains stable until disposal.
export class SessionRuntimes {
  readonly workers = new Map<string, SessionRuntime>();
  readonly unreadSessionIds = new Set<string>();
  activeId?: string;
  constructor(
    private emit: (event: RuntimeEvent) => void,
    private create: (receive: (event: RuntimeEvent) => void) => WorkerTransport = receive => new RpcProcess(receive),
  ) {}
  get active() { return this.activeId ? this.workers.get(this.activeId) : undefined; }
  get running() { return [...this.workers.values()].some(worker => this.isBusy(worker)); }
  isBusy(worker: SessionRuntime) { return worker.busy || worker.submissions > 0 || Boolean(worker.state?.isCompacting || worker.state?.pendingMessageCount) || worker.pendingUI.size > 0; }
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
  async open(node: string, entry: string, cwd: string, env: NodeJS.ProcessEnv, sessionPath?: string) {
    const worker: SessionRuntime = {
      id: randomUUID(), cwd, rpc: undefined!, status: 'connecting', busy: false,
      submissions: 0, operations: 0, mutating: false, messages: [], models: [], pendingUI: new Map(), uiTimers: new Map(), failed: false, interrupted: false, runActive: false, revision: 0, touched: Date.now(),
    };
    worker.rpc = this.create(event => {
      if (this.workers.get(worker.id) !== worker) return;
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
      if (['message_start', 'message_update', 'message_end'].includes(event.type)) worker.messages = applyMessageEvent(worker.messages, event);
      if (event.type === 'message_end' && event.message?.stopReason === 'error') worker.failed = true;
      if (event.type === 'desktop_exit') {
        worker.status = 'disconnected'; worker.busy = false; worker.runActive = false;
        if (worker.state) worker.state = { ...worker.state, isStreaming: false, isCompacting: false, pendingMessageCount: 0 };
        for (const timer of worker.uiTimers.values()) clearTimeout(timer);
        worker.uiTimers.clear();
        worker.pendingUI.clear();
      }
      if (event.type === 'extension_ui_request') {
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
      this.emit({ ...event, runtimeId: worker.id, sessionId: worker.state?.sessionId });
      if (['agent_start', 'agent_end', 'desktop_exit', 'extension_ui_request'].includes(event.type) || event.type === 'message_start' && event.message?.role === 'user') this.publish();
    });
    this.workers.set(worker.id, worker);
    try {
      worker.rpc.start(node, entry, cwd, env);
      await worker.rpc.request('get_state', {}, 60000);
      const result = await worker.rpc.request(sessionPath ? 'switch_session' : 'new_session', sessionPath ? { sessionPath } : {}, 60000);
      if (result.cancelled) throw new Error('Session operation cancelled');
      worker.status = 'connected';
      worker.state = await worker.rpc.request('get_state');
      await this.read(worker);
      this.activate(worker);
      return worker;
    } catch (error) {
      this.workers.delete(worker.id);
      await worker.rpc.stop();
      throw error;
    }
  }
  async read(worker: SessionRuntime) {
    if (worker.status !== 'connected') return;
    worker.operations++;
    const revision = worker.revision;
    try {
      const [state, { messages }, { models }, stats] = await Promise.all([
        worker.rpc.request('get_state'), worker.rpc.request('get_messages'),
        worker.rpc.request('get_available_models'), worker.rpc.request('get_session_stats'),
      ]);
      // Never replace newly received deltas with an older asynchronous snapshot.
      if (revision === worker.revision) {
        worker.state = state;
        // get_messages contains committed history, not the in-flight assistant.
        if (!state.isStreaming) worker.messages = messages;
        worker.busy = Boolean(state.isStreaming);
      }
      worker.models = models; worker.stats = stats; worker.touched = Date.now();
    } finally { worker.operations--; }
  }
  async assertIdle(worker: SessionRuntime) {
    if (this.isBusy(worker)) throw new Error('Stop this session task first');
    if (worker.status === 'connected') {
      const state = await worker.rpc.request('get_state');
      if (state.isStreaming || state.isCompacting || state.pendingMessageCount) throw new Error('Stop this session task first');
    }
  }
  async assertAllIdle() {
    for (const worker of this.workers.values()) {
      if (worker.mutating) throw new Error('Session operation in progress');
      await this.assertIdle(worker);
    }
  }
  clearRequest(worker: SessionRuntime, id: string) {
    clearTimeout(worker.uiTimers.get(id));
    worker.uiTimers.delete(id); worker.pendingUI.delete(id);
  }
  async remove(worker: SessionRuntime) {
    this.workers.delete(worker.id);
    if (this.activeId === worker.id) this.activeId = undefined;
    for (const timer of worker.uiTimers.values()) clearTimeout(timer);
    await worker.rpc.stop();
    this.publish();
  }
  async recycle() {
    const idle = [...this.workers.values()].filter(worker => worker.id !== this.activeId && worker.status === 'connected' && !this.isBusy(worker) && !worker.operations && !worker.mutating && worker.messages.length > 0);
    idle.sort((a, b) => b.touched - a.touched);
    for (const worker of idle) if (idle.indexOf(worker) >= 2 || Date.now() - worker.touched > 5 * 60000) await this.remove(worker);
  }
  async stopAll() {
    const workers = [...this.workers.values()];
    this.workers.clear(); this.activeId = undefined;
    for (const worker of workers) for (const timer of worker.uiTimers.values()) clearTimeout(timer);
    await Promise.all(workers.map(worker => worker.rpc.stop()));
  }
}
