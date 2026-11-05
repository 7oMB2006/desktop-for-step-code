import { randomInt, randomUUID } from 'node:crypto';
import type { Message, RuntimeEvent, UIRequest } from '../src/contracts';
import type { RemoteAction, RemoteSession, RemoteSnapshot } from '../src/remote';
import { taskOutcome, type SessionRuntime, type WorkerTransport } from './session-runtimes';
import { permissionApprovalPresentation, redactApprovalText } from '../src/approval-presentation';

export interface RemoteChannel {
  request(type: string, args?: Record<string, unknown>): Promise<any>;
  stop(): Promise<void>;
}
export interface RemoteHost {
  sessions(): RemoteSession[];
  worker(runtimeId: string, sessionId: string): SessionRuntime;
  submit(worker: SessionRuntime, message: string): Promise<void>;
  stop(worker: SessionRuntime): Promise<void>;
  respond(worker: SessionRuntime, answer: Record<string, unknown>): void;
  open(url: string): Promise<void>;
}
interface Binding { id: string; worker: SessionRuntime; rpc: WorkerTransport; session: RemoteSession }
interface Decision { id: string; request: UIRequest; text: string }
interface Card { key: string; title: string; text: string; actions?: { token: string; options: string[] } }
export function parseRemoteAction(value: unknown): RemoteAction {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid Remote action');
  const input = value as Record<string, unknown>;
  if (input.type === 'bind') {
    const string = (key: string) => {
      const value = input[key];
      if (typeof value !== 'string' || !value || value.length > 80) throw new Error('Invalid Remote binding');
      return value;
    };
    return { type: 'bind', candidateId: string('candidateId'), runtimeId: string('runtimeId'), sessionId: string('sessionId') };
  }
  if (!['connect', 'disconnect', 'openAuthorization', 'openCallbacks', 'checkCallbacks', 'armBinding', 'unbind', 'stop'].includes(String(input.type)))
    throw new Error('Unknown Remote action');
  return { type: input.type } as RemoteAction;
}
function assistantText(message?: Message) {
  if (message?.role !== 'assistant') return '';
  return redactApprovalText(typeof message.content === 'string' ? message.content
    : message.content.filter(block => block.type === 'text').map(block => block.text ?? '').join('\n')).slice(-12000);
}
export function remoteDecision(request: UIRequest, worker: SessionRuntime) {
  if (request.runtimeId !== worker.id || request.projectTrust || request.messageStyle || (request.message?.length ?? 0) > 8000) return;
  const parsed = permissionApprovalPresentation(request, worker.messages, 'en', worker.id);
  if (!parsed) return;
  const call = worker.messages.some(message => message.role === 'assistant' && Array.isArray(message.content)
    && message.content.some(block => block.type === 'toolCall' && block.id === parsed.callId && block.name === parsed.toolName));
  const finished = worker.messages.some(message => message.role === 'toolResult' && message.toolCallId === parsed.callId);
  if (!call || finished || parsed.inputKind === 'summary') return;
  const text = [parsed.reason, `Tool: ${parsed.toolName}\nCall: ${parsed.callId}`,
    parsed.target ? `Target: ${parsed.target}` : undefined, parsed.input, parsed.otherParameters,
    parsed.verificationCommand ? `Then run:\n${parsed.verificationCommand}` : undefined].filter(Boolean).join('\n\n');
  // Actionable cards must contain the exact recovered input, never a clipped summary.
  if (text.length > 5000) return;
  return { title: parsed.title, text };
}

// Main owns routing and approvals. The network helper never owns an agent or transcript.
export class RemoteManager {
  private channel?: RemoteChannel;
  private generation = 0;
  private setupBusy = false;
  private binding?: Binding;
  private authorizationUrl?: string;
  private callbackUrl?: string;
  private armId?: string;
  private probe?: string;
  private codeTimer?: NodeJS.Timeout;
  private decisions = new Map<string, Decision>();
  private processed = new Map<string, number>();
  private input = Promise.resolve();
  private inputCount = 0;
  private cards = new Map<string, Card>();
  private pumping?: object;
  private projection = '';
  private runId?: string;
  private projectionTimer?: NodeJS.Timeout;
  private state: Omit<RemoteSnapshot, 'sessions'> = { revision: 0, status: 'idle', approvalReady: false };
  constructor(private host: RemoteHost, private create: (receive: (event: RuntimeEvent) => void) => RemoteChannel,
    private changed: (state: RemoteSnapshot) => void, private now = Date.now) {}
  snapshot(): RemoteSnapshot {
    return structuredClone({ ...this.state, binding: this.binding?.session, sessions: this.host.sessions() });
  }
  private publish() { this.state.revision++; this.changed(this.snapshot()); }
  retains(worker: SessionRuntime) { return this.binding?.worker === worker; }
  private current(): Binding {
    const bound = this.binding;
    if (!bound || this.host.worker(bound.session.runtimeId, bound.session.sessionId) !== bound.worker
      || bound.worker.rpc !== bound.rpc) throw new Error('Remote binding is no longer available');
    return bound;
  }
  private clearCode() {
    clearTimeout(this.codeTimer); this.codeTimer = undefined; this.armId = undefined;
    this.state.bindingCode = undefined; this.state.candidate = undefined;
  }
  private clearBinding() {
    if (this.binding) this.binding.worker.remoteAttached = false;
    this.binding = undefined; this.clearCode(); this.decisions.clear(); this.probe = undefined;
    this.runId = undefined; this.projection = ''; this.cards.clear(); this.pumping = undefined;
    clearTimeout(this.projectionTimer); this.projectionTimer = undefined;
    this.state.approvalReady = false;
  }
  async action(action: RemoteAction): Promise<RemoteSnapshot> {
    if (action.type === 'disconnect') { await this.disconnect(); return this.snapshot(); }
    if (action.type === 'unbind') {
      const bindingId = this.binding?.id, armId = this.armId;
      this.clearBinding(); this.publish();
      await this.channel?.request('unbind', { bindingId, armId }); return this.snapshot();
    }
    if (this.setupBusy) throw new Error('Remote operation in progress');
    this.setupBusy = true;
    const generation = this.generation;
    try {
      switch (action.type) {
        case 'connect': {
          if (this.channel) throw new Error('Disconnect before pairing again');
          const nextGeneration = ++this.generation;
          const channel = this.create(event => {
            if (this.generation === nextGeneration && this.channel === channel) this.receive(event);
          });
          this.channel = channel;
          this.state = { revision: this.state.revision, status: 'pairing', approvalReady: false };
          this.publish();
          try { await channel.request('connect'); }
          catch {
            if (this.generation === nextGeneration && this.channel === channel) this.fail('authorization');
          }
          break;
        }
        case 'openAuthorization':
          if (!this.authorizationUrl || !this.state.authorization || this.state.authorization.expiresAt <= this.now())
            throw new Error('Authorization link has expired');
          await this.host.open(this.authorizationUrl); break;
        case 'openCallbacks':
          if (!this.callbackUrl || this.state.status !== 'connected') throw new Error('Connect Feishu first');
          await this.host.open(this.callbackUrl); break;
        case 'checkCallbacks': {
          this.current();
          if (this.probe) void this.channel?.request('revoke', { token: this.probe }).catch(() => {});
          this.probe = randomUUID();
          this.send({ key: 'probe', title: 'Connection check / 连接检查',
            text: 'This button only verifies the callback. / 此按钮仅验证回调，不批准任何工具操作。',
            actions: { token: this.probe, options: ['Verify / 验证'] } }); break;
        }
        case 'armBinding': {
          const channel = this.channel;
          if (this.state.status !== 'connected' || !channel || this.binding) throw new Error('Unbind before pairing a chat');
          this.clearCode();
          const armId = this.armId = randomUUID();
          const code = String(randomInt(10000000, 100000000)), expiresAt = this.now() + 120000;
          this.state.bindingCode = { code, expiresAt };
          try { await channel.request('arm', { armId, code, expiresAt }); }
          catch (error) {
            if (this.armId === armId) { this.clearCode(); this.publish(); }
            void channel.request('disarm', { armId }).catch(() => {});
            throw error;
          }
          if (generation !== this.generation || this.armId !== armId) break;
          this.codeTimer = setTimeout(() => {
            if (this.armId !== armId) return;
            this.clearCode(); this.publish();
            void channel.request('disarm', { armId }).catch(() => {});
          }, 120000).unref();
          this.publish(); break;
        }
        case 'bind': {
          const channel = this.channel;
          if (!channel || this.state.status !== 'connected' || this.binding || !this.state.bindingCode
            || this.state.bindingCode.expiresAt <= this.now() || this.state.candidate?.id !== action.candidateId)
            throw new Error('Chat verification has expired');
          const worker = this.host.worker(action.runtimeId, action.sessionId);
          if (worker.busy || worker.submissions || worker.pendingUI.size || worker.state?.isCompacting
            || worker.backgroundActive || worker.backgroundLanes?.length || worker.queued || worker.mutating || worker.operations
            || worker.failed || worker.interrupted || worker.launch?.goal?.status === 'active')
            throw new Error('Bind an idle session');
          const session = this.host.sessions().find(item => item.runtimeId === action.runtimeId && item.sessionId === action.sessionId);
          if (!session) throw new Error('Session is unavailable');
          const binding: Binding = { id: randomUUID(), worker, rpc: worker.rpc, session };
          this.binding = binding; worker.remoteAttached = true;
          try {
            await channel.request('bind', { armId: this.armId, candidateId: action.candidateId, bindingId: binding.id });
            if (generation !== this.generation || this.binding !== binding) break;
            this.current(); this.clearCode(); this.publish();
          } catch (error) {
            if (this.binding === binding) { this.clearBinding(); this.publish(); }
            void channel.request('unbind', { bindingId: binding.id }).catch(() => {});
            throw error;
          }
          break;
        }
        case 'stop': await this.host.stop(this.current().worker); break;
        default: throw new Error('Unknown Remote action');
      }
    } finally { this.setupBusy = false; }
    return this.snapshot();
  }
  async disconnect() {
    ++this.generation;
    const channel = this.channel; this.channel = undefined;
    this.clearBinding(); this.processed.clear(); this.authorizationUrl = undefined; this.callbackUrl = undefined;
    this.state = { revision: this.state.revision, status: 'idle', approvalReady: false }; this.publish();
    // Killing the isolated helper also cancels a hung handshake or HTTP request.
    if (channel) await channel.stop();
  }
  private fail(stage: RemoteSnapshot['stage']) {
    void this.disconnect().catch(() => {});
    this.state.status = 'error'; this.state.stage = stage; this.publish();
  }
  private receive(event: RuntimeEvent) {
    if (event.type === 'desktop_exit') { this.fail('transport'); return; }
    if (event.type !== 'remote_channel') return;
    switch (event.kind) {
      case 'authorization': {
        try {
          const url = new URL(event.url);
          if (url.protocol !== 'https:' || url.hostname !== 'open.feishu.cn' || url.pathname !== '/page/cli'
            || url.username || url.password || url.port || !Number.isFinite(event.expiresAt) || event.expiresAt <= this.now()) return;
          this.authorizationUrl = url.href; this.state.authorization = { expiresAt: event.expiresAt }; this.publish();
        } catch {}
        break;
      }
      case 'connecting': this.state.status = 'connecting'; this.state.authorization = undefined; this.authorizationUrl = undefined; this.publish(); break;
      case 'connected':
        this.authorizationUrl = undefined; this.state.authorization = undefined;
        this.state.status = 'connected'; this.state.stage = undefined;
        this.state.botName = typeof event.botName === 'string' ? event.botName.slice(0, 100) : undefined;
        try {
          const url = new URL(event.callbackUrl);
          if (url.protocol === 'https:' && ['open.feishu.cn', 'open.larksuite.com'].includes(url.hostname)
            && !url.username && !url.password && !url.port && url.pathname === '/page/launcher') this.callbackUrl = url.href;
        } catch {}
        this.publish(); break;
      case 'health':
        if (['connected', 'degraded'].includes(this.state.status)) {
          this.state.status = event.status === 'connected' ? 'connected' : 'degraded'; this.publish();
          if (this.state.status === 'connected') this.pump();
        }
        break;
      case 'candidate':
        if (!this.binding && event.armId === this.armId && this.state.bindingCode && this.state.bindingCode.expiresAt > this.now()
          && typeof event.candidateId === 'string' && event.candidateId.length <= 80) {
          this.state.candidate = { id: event.candidateId }; this.publish();
        }
        break;
      case 'input': {
        const binding = this.binding;
        for (const [id, expiresAt] of this.processed) if (expiresAt < this.now()) this.processed.delete(id);
        if (!binding || event.bindingId !== binding.id || typeof event.id !== 'string' || event.id.length > 200
          || this.processed.has(event.id) || this.inputCount >= 20 || this.processed.size >= 4096) return;
        this.processed.set(event.id, this.now() + 600000); this.inputCount++;
        this.input = this.input.then(async () => {
          if (this.binding !== binding) return;
          try {
            this.current();
            if (this.state.status !== 'connected' || typeof event.text !== 'string' || !event.text.trim()
              || event.text.length > 12000 || /^\s*\//.test(event.text)) throw new Error('Unsupported remote input');
            await this.host.submit(binding.worker, event.text);
            if (this.binding === binding) this.send({ key: 'receipt', title: 'Received / 已接收',
              text: 'Queued for this session / 已进入绑定会话的消息队列' });
          } catch {
            if (this.binding === binding) this.send({ key: 'receipt', title: 'Not accepted / 未接收',
              text: 'Review the queue on Desktop. Slash commands and attachments are not supported. / 请在本机检查队列，暂不支持斜杠指令和附件。' });
          }
        }).finally(() => { this.inputCount--; });
        break;
      }
      case 'decision': {
        if (!this.binding || event.bindingId !== this.binding.id || this.state.status !== 'connected') return;
        if (event.token === this.probe && event.option === 'Verify / 验证') {
          this.probe = undefined; this.state.approvalReady = true; this.publish(); return;
        }
        const decision = this.decisions.get(event.token);
        if (!decision || !['Allow once / 允许一次', 'Deny / 拒绝'].includes(event.option)) return;
        try {
          const { worker } = this.current();
          if (worker.pendingUI.get(decision.id) !== decision.request
            || remoteDecision(decision.request, worker)?.text !== decision.text) return;
          this.host.respond(worker, { id: decision.id, confirmed: event.option === 'Allow once / 允许一次' });
          this.decisions.delete(event.token); this.state.approvalReady = true; this.publish();
          this.syncDecisions(worker);
        } catch {}
        break;
      }
      case 'stop':
        if (!this.runId || event.runId !== this.runId || event.bindingId !== this.binding?.id || this.state.status !== 'connected') return;
        try { void this.host.stop(this.current().worker).catch(() => {}); } catch {}
        break;
      case 'error':
        if (event.stage === 'delivery') { this.state.stage = 'delivery'; this.publish(); }
        else this.fail(['authorization', 'identity', 'transport'].includes(event.stage) ? event.stage : 'transport');
        break;
    }
  }
  private send(card: Card) {
    if (!this.binding || !this.channel) return;
    if (!this.cards.has(card.key) && this.cards.size >= 32) { this.state.stage = 'delivery'; this.publish(); return; }
    this.cards.set(card.key, { ...card, text: redactApprovalText(card.text).slice(-12000) });
    this.pump();
  }
  private pump() {
    if (this.pumping || this.state.status !== 'connected') return;
    const owner = {}, binding = this.binding, channel = this.channel;
    if (!binding || !channel) return;
    this.pumping = owner;
    void (async () => {
      while (this.pumping === owner && this.binding === binding && this.channel === channel && this.state.status === 'connected') {
        const card = this.cards.values().next().value;
        if (!card) break;
        this.cards.delete(card.key);
        if (card.actions && !this.decisions.has(card.actions.token) && this.probe !== card.actions.token) continue;
        try { this.current(); await channel.request('card', { ...card, bindingId: binding.id }); }
        catch {
          if (this.binding === binding) { this.state.stage = 'delivery'; this.publish(); }
        }
      }
    })().finally(() => {
      if (this.pumping === owner) { this.pumping = undefined; if (this.cards.size) this.pump(); }
    });
  }
  private syncDecisions(worker: SessionRuntime) {
    for (const [token, decision] of this.decisions) if (worker.pendingUI.get(decision.id) !== decision.request
      || remoteDecision(decision.request, worker)?.text !== decision.text) {
      this.decisions.delete(token); void this.channel?.request('revoke', { token }).catch(() => {});
    }
    for (const [id, request] of worker.pendingUI) {
      if (this.decisions.size >= 16 || [...this.decisions.values()].some(item => item.id === id)) continue;
      const parsed = remoteDecision(request, worker);
      if (!parsed) continue;
      const token = randomUUID();
      this.decisions.set(token, { id, request, text: parsed.text });
      this.send({ key: token, ...parsed, actions: { token, options: ['Allow once / 允许一次', 'Deny / 拒绝'] } });
    }
  }
  runtimeEvent(worker: SessionRuntime, event: RuntimeEvent) {
    if (this.binding?.worker !== worker) return;
    try { this.current(); }
    catch { this.dispose(worker); return; }
    this.syncDecisions(worker);
    if (event.type === 'agent_start') { this.runId = randomUUID(); this.projection = ''; this.project('Working / 正在处理'); }
    if (event.type === 'message_update' && this.runId) {
      const delta = event.assistantMessageEvent;
      if (delta?.type === 'text_delta' && typeof delta.delta === 'string') {
        this.projection = (this.projection + delta.delta).slice(-12000);
        if (!this.projectionTimer) this.projectionTimer = setTimeout(() => {
          this.projectionTimer = undefined; this.project('Working / 正在处理');
        }, 1000).unref();
      }
    }
    if (event.type === 'message_end' && this.runId) {
      const text = assistantText(event.message);
      if (text) this.projection = text;
    }
    if (event.type === 'desktop_task_completed' && this.runId) this.finish('Completed / 已完成');
    if (event.type === 'agent_end' && (worker.failed || worker.interrupted || taskOutcome(worker.messages) === 'interrupted'))
      this.finish('Interrupted / 已中断');
    if (event.type === 'desktop_exit') this.dispose(worker);
  }
  private project(title: string) {
    if (this.runId) this.send({ key: this.runId, title, text: this.projection || 'Desktop for Step Code' });
  }
  private finish(title: string) {
    clearTimeout(this.projectionTimer); this.projectionTimer = undefined;
    this.project(title); this.runId = undefined;
  }
  dispose(worker: SessionRuntime) {
    if (!this.retains(worker)) return;
    const bindingId = this.binding!.id;
    this.clearBinding(); this.state.stage = 'runtime'; this.publish();
    void this.channel?.request('unbind', { bindingId }).catch(() => {});
  }
}
