import { randomInt, randomUUID } from 'node:crypto';
import { basename, resolve } from 'node:path';
import type { Message, RuntimeEvent, UIRequest } from '../src/contracts';
import { remoteCommands, remoteWorkspaceLimit, type RemoteAction, type RemoteSession, type RemoteSnapshot } from '../src/remote';
import { taskOutcome, type SessionRuntime, type WorkerTransport } from './session-runtimes';
import { permissionApprovalPresentation, redactApprovalText } from '../src/approval-presentation';
import { parseRemoteCommand, type RemoteCommand } from './remote-commands';
import { remoteIdentity, remotePeer, savedRemote, type RemotePersistence, type SavedRemote } from './remote-store';

export interface RemoteChannel {
  request(type: string, args?: Record<string, unknown>): Promise<any>;
  stop(): Promise<void>;
}
export interface RemoteHost {
  sessions(): RemoteSession[];
  refresh(): Promise<void>;
  validateWorkspaces(workspaces: string[]): Promise<void>;
  prepare(sessionId: string): Promise<SessionRuntime>;
  createSession(workspace: string): Promise<SessionRuntime>;
  worker(runtimeId: string, sessionId: string): SessionRuntime;
  submit(worker: SessionRuntime, message: string, accepted: (queueId: string) => void): Promise<void>;
  stop(worker: SessionRuntime): Promise<void>;
  respond(worker: SessionRuntime, answer: Record<string, unknown>): void;
  open(url: string): Promise<void>;
}
interface Target {
  worker: SessionRuntime; rpc: WorkerTransport; session: RemoteSession;
  projection: string; runId?: string; timer?: NodeJS.Timeout;
  receipts: Map<string, { queueId: string; delivered: boolean }>;
}
interface Binding {
  id: string; workspaces: string[]; current?: Target;
  targets: Map<string, Target>; refs: Map<string, string>;
}
interface Decision { target: Target; id: string; request: UIRequest; text: string }
type ReplyStatus = 'working' | 'completed' | 'interrupted';
interface Card {
  key: string; title: string; text: string; sessionKey?: string; reply?: ReplyStatus;
  actions?: { token: string; options: string[] };
}
export function parseRemoteAction(value: unknown): RemoteAction {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid Remote action');
  const input = value as Record<string, unknown>;
  if (input.type === 'bind' || input.type === 'select') {
    const string = (key: string) => {
      const value = input[key];
      if (typeof value !== 'string' || !value || value.length > 200) throw new Error('Invalid Remote binding');
      return value;
    };
    if (input.type === 'select') return { type: 'select', sessionId: string('sessionId') };
    if (input.workspaces !== undefined && (!Array.isArray(input.workspaces) || !input.workspaces.length || input.workspaces.length > remoteWorkspaceLimit
      || input.workspaces.some(value => typeof value !== 'string' || !value || value.length > 4096)
      || new Set(input.workspaces).size !== input.workspaces.length)) throw new Error('Invalid Remote scope');
    return { type: 'bind', candidateId: string('candidateId'), runtimeId: input.runtimeId === undefined ? undefined : string('runtimeId'),
      sessionId: string('sessionId'), workspaces: input.workspaces as string[] | undefined };
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
  private routing: Promise<Target | undefined> = Promise.resolve(undefined);
  private inputCount = 0;
  private cards = new Map<string, Card>();
  private pumping?: object;
  private remembered?: SavedRemote;
  private savedBinding?: Binding;
  private recovery?: { channel: RemoteChannel; generation: number; access: SavedRemote['access'] };
  private recovering = false;
  private writes: Promise<void> = Promise.resolve();
  private saveRevision = 0;
  private state: Omit<RemoteSnapshot, 'sessions'> = { revision: 0, status: 'idle', approvalReady: false };
  constructor(private host: RemoteHost, private create: (receive: (event: RuntimeEvent) => void) => RemoteChannel,
    private changed: (state: RemoteSnapshot) => void, private now = Date.now, private persistence?: RemotePersistence) {}
  snapshot(): RemoteSnapshot {
    return structuredClone({ ...this.state, binding: this.binding?.current?.session,
      authorized: this.binding ? { workspaces: this.binding.workspaces } : undefined, sessions: this.host.sessions() });
  }
  private publish() { this.state.revision++; this.changed(this.snapshot()); }
  private save(value: SavedRemote | undefined) {
    this.remembered = value ? savedRemote(value) : undefined;
    if (!this.persistence) return Promise.resolve(true);
    const next = this.remembered ? structuredClone(this.remembered) : undefined, revision = ++this.saveRevision;
    const write = this.writes.then(async () => {
      try {
        await this.persistence!.save(next);
        if (revision === this.saveRevision) { this.state.saved = !!next; this.state.storageError = false; this.publish(); }
        return true;
      } catch {
        if (revision === this.saveRevision) { this.state.saved = false; this.state.storageError = true; this.publish(); }
        return false;
      }
    });
    this.writes = write.then(() => {});
    return write;
  }
  private saveSelection(binding: Binding) {
    if (this.savedBinding !== binding || !this.remembered?.access) return;
    return this.save({ ...this.remembered, access: { ...this.remembered.access,
      sessionId: binding.current?.session.sessionId } });
  }
  async resume() {
    if (!this.persistence || this.channel || this.setupBusy) return;
    const generation = ++this.generation;
    try {
      const value = await this.persistence.load();
      if (generation !== this.generation || this.channel || this.setupBusy) return;
      if (!value) return;
      this.remembered = savedRemote(value); this.state.saved = true;
      await this.action({ type: 'connect' });
    } catch {
      if (generation !== this.generation || this.channel) return;
      this.state.status = 'error'; this.state.storageError = true; this.publish();
    }
  }
  private async connected(channel: RemoteChannel, generation: number) {
    if (!this.persistence) { this.publish(); return; }
    this.recovering = true;
    const current = () => this.channel === channel && this.generation === generation;
    try {
      const snapshot = await channel.request('snapshot');
      if (!current()) return;
      const identity = remoteIdentity(snapshot?.identity), access = this.recovery?.access;
      if (access) {
        try { await this.host.validateWorkspaces(access.workspaces); }
        catch {
          if (!current()) return;
          await this.save({ version: 1, identity });
          if (current()) { this.state.stage = 'runtime'; this.publish(); }
          return;
        }
        if (!current()) return;
        const binding: Binding = { id: randomUUID(), workspaces: [...access.workspaces], targets: new Map(), refs: new Map() };
        await channel.request('bindSaved', { bindingId: binding.id, peer: remotePeer(access) });
        if (!current()) return;
        this.binding = this.savedBinding = binding;
        this.remembered = { version: 1, identity, access };
        this.publish();
        // No worker/run/queue/approval is restored. Reopen only the selected history in Ask.
        if (access.sessionId) {
          const selected = this.select(binding, access.sessionId).catch(() => {
            if (current() && this.binding === binding) { this.state.stage = 'runtime'; this.publish(); }
            return undefined;
          });
          this.routing = selected;
          await selected;
        }
        if (!current() || this.binding !== binding) return;
        await this.saveSelection(binding);
      } else await this.save({ version: 1, identity });
    } catch {
      if (current()) this.fail('identity');
    } finally {
      if (current()) { this.recovering = false; this.recovery = undefined; this.publish(); }
    }
  }
  retains(worker: SessionRuntime) { return [...this.binding?.targets.values() ?? []].some(target => target.worker === worker); }
  private current(target: Target | undefined): Target {
    if (!target || this.binding?.targets.get(target.session.sessionId) !== target
      || !this.binding.workspaces.includes(target.session.workspace)
      || this.host.worker(target.worker.id, target.session.sessionId) !== target.worker
      || target.worker.rpc !== target.rpc) throw new Error('Remote session is no longer available');
    return target;
  }
  private ref(binding: Binding, sessionId: string) {
    let ref = binding.refs.get(sessionId);
    if (!ref) { ref = `s${binding.refs.size + 1}`; binding.refs.set(sessionId, ref); }
    return ref;
  }
  private label(target: Target) {
    return `${this.ref(this.binding!, target.session.sessionId)} · ${redactApprovalText(target.session.name).replace(/[\r\n]/g, ' ').slice(0, 70)}`;
  }
  private assertBinding(binding: Binding) {
    if (this.binding !== binding || this.state.status !== 'connected') throw new Error('Remote authorization is no longer available');
  }
  private makeRoom(binding: Binding) {
    if (binding.targets.size < 8) return;
    const idle = [...binding.targets.values()].find(target => target !== binding.current && !target.runId && !target.receipts.size
      && !target.worker.busy && !target.worker.queued && !target.worker.pendingUI.size && !target.worker.operations
      && !target.worker.mutating && !target.worker.stopping && !target.worker.state?.isCompacting
      && !target.worker.state?.isStreaming && !target.worker.state?.pendingMessageCount
      && !target.worker.backgroundActive && !target.worker.backgroundLanes?.length && !target.worker.submissions
      && target.worker.launch?.goal?.status !== 'active');
    if (!idle) throw new Error('Eight sessions are already attached. Finish a task before opening another.');
    binding.targets.delete(idle.session.sessionId); idle.worker.remoteAttached = false;
    for (const [token, decision] of this.decisions) if (decision.target === idle) {
      this.decisions.delete(token); void this.channel?.request('revoke', { token }).catch(() => {});
    }
  }
  private attach(binding: Binding, worker: SessionRuntime, session: RemoteSession) {
    this.assertBinding(binding);
    if (!binding.workspaces.includes(session.workspace) || worker.state?.sessionId !== session.sessionId
      || this.host.worker(worker.id, session.sessionId) !== worker) throw new Error('Session is outside the authorized scope');
    const existing = binding.targets.get(session.sessionId);
    if (existing) return this.current(existing);
    this.makeRoom(binding);
    const target: Target = { worker, rpc: worker.rpc, session: { ...session, runtimeId: worker.id }, projection: '', receipts: new Map() };
    worker.remoteAttached = true; binding.targets.set(session.sessionId, target); this.ref(binding, session.sessionId);
    return target;
  }
  private async select(binding: Binding, sessionId: string) {
    this.assertBinding(binding);
    const session = this.host.sessions().find(item => item.sessionId === sessionId && binding.workspaces.includes(item.workspace));
    if (!session) throw new Error('Session is unavailable or outside the authorized scope');
    const target = binding.targets.get(sessionId);
    if (!target) this.makeRoom(binding);
    const worker = target ? this.current(target).worker : await this.host.prepare(sessionId);
    this.assertBinding(binding);
    const current = this.host.sessions().find(item => item.sessionId === sessionId && item.workspace === session.workspace);
    if (!current) throw new Error('Session changed while opening');
    binding.current = this.attach(binding, worker, current);
    // Observe a resident run from this point, without backfilling its transcript.
    if (!binding.current.runId && (worker.runActive || worker.state?.isStreaming)) {
      binding.current.runId = randomUUID();
      this.project(binding.current, 'working');
    }
    this.syncDecisions(worker);
    if (this.state.stage === 'runtime') this.state.stage = undefined;
    this.publish();
    void this.saveSelection(binding);
    return binding.current;
  }
  private queue(binding: Binding, operation: (target?: Target) => Promise<void>, selects = false) {
    const route = this.routing;
    const pending = this.input.then(async () => {
      const target = await route;
      this.assertBinding(binding);
      await operation(target);
    });
    this.input = pending.catch(() => {});
    // Each accepted message retains the selection barrier before it, not a later global selection.
    if (selects) this.routing = pending.catch(() => {}).then(() => this.binding === binding ? binding.current : undefined);
    return pending;
  }
  private clearCode() {
    clearTimeout(this.codeTimer); this.codeTimer = undefined; this.armId = undefined;
    this.state.bindingCode = undefined; this.state.candidate = undefined;
  }
  private clearBinding(channel = this.channel) {
    const cleanup: Promise<void>[] = [];
    for (const target of this.binding?.targets.values() ?? []) {
      target.worker.remoteAttached = false; clearTimeout(target.timer);
      for (const messageId of target.receipts.keys()) cleanup.push(this.reaction(messageId, false, this.binding, channel));
      target.receipts.clear();
    }
    this.binding = undefined; this.savedBinding = undefined; this.clearCode(); this.decisions.clear(); this.probe = undefined;
    this.routing = Promise.resolve(undefined); this.cards.clear(); this.pumping = undefined;
    this.state.approvalReady = false;
    return cleanup.length ? Promise.all(cleanup) : undefined;
  }
  async action(action: RemoteAction): Promise<RemoteSnapshot> {
    if (action.type === 'disconnect') { await this.disconnect(); return this.snapshot(); }
    if (this.recovering) throw new Error('Remote connection is still being restored');
    if (action.type === 'unbind') {
      const bindingId = this.binding?.id, armId = this.armId;
      const cleanup = this.clearBinding(); this.publish();
      if (this.remembered) await this.save({ version: 1, identity: this.remembered.identity });
      await cleanup;
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
          this.state = { revision: this.state.revision, status: this.remembered ? 'connecting' : 'pairing',
            approvalReady: false, saved: this.state.saved, storageError: this.state.storageError };
          this.recovery = { channel, generation: nextGeneration, access: this.remembered?.access };
          this.publish();
          try { await channel.request('connect', this.remembered ? { identity: this.remembered.identity } : undefined); }
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
          if (!this.binding) throw new Error('Authorize a private chat first');
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
          const session = this.host.sessions().find(item => item.sessionId === action.sessionId
            && (!action.runtimeId || item.runtimeId === action.runtimeId));
          if (!session) throw new Error('Session is unavailable');
          const workspaces = action.workspaces ?? [session.workspace];
          if (!workspaces.includes(session.workspace) || workspaces.some(workspace => !this.host.sessions().some(item => item.workspace === workspace)))
            throw new Error('Choose an available authorization scope');
          const worker = await this.host.prepare(action.sessionId);
          if (generation !== this.generation || this.channel !== channel || this.binding
            || this.state.candidate?.id !== action.candidateId || !this.state.bindingCode
            || this.state.bindingCode.expiresAt <= this.now()) throw new Error('Chat verification has expired');
          if (worker.busy || worker.submissions || worker.pendingUI.size || worker.state?.isCompacting
            || worker.backgroundActive || worker.backgroundLanes?.length || worker.queued || worker.mutating || worker.operations
            || worker.failed || worker.interrupted || worker.launch?.goal?.status === 'active')
            throw new Error('Bind an idle session');
          const binding: Binding = { id: randomUUID(), workspaces: [...workspaces], targets: new Map(), refs: new Map() };
          this.binding = binding;
          try {
            binding.current = this.attach(binding, worker, session);
            this.routing = Promise.resolve(binding.current);
            await channel.request('bind', { armId: this.armId, candidateId: action.candidateId, bindingId: binding.id });
            if (generation !== this.generation || this.binding !== binding) break;
            this.current(binding.current); this.clearCode(); this.publish();
            if (this.persistence) {
              const snapshot = await channel.request('snapshot');
              if (generation !== this.generation || this.binding !== binding) break;
              this.savedBinding = binding;
              await this.save({ version: 1, identity: remoteIdentity(snapshot?.identity),
                access: { ...remotePeer(snapshot?.peer), workspaces: [...workspaces], sessionId: binding.current?.session.sessionId } });
            }
            if (generation !== this.generation || this.binding !== binding) break;
            this.send({ key: 'welcome', title: 'Remote Beta / 远程访问',
              text: `已授权 ${workspaces.length} 个项目 / ${workspaces.length} project(s) authorized\n当前 / Current: ${this.label(binding.current!)}\n\n${this.help()}` });
          } catch (error) {
            if (this.binding === binding) { this.clearBinding(); this.publish(); }
            void channel.request('unbind', { bindingId: binding.id }).catch(() => {});
            throw error;
          }
          break;
        }
        case 'select': {
          const binding = this.binding;
          if (!binding) throw new Error('Authorize a private chat first');
          await this.queue(binding, async () => { await this.select(binding, action.sessionId); }, true);
          break;
        }
        case 'stop': await this.host.stop(this.current(this.binding?.current).worker); break;
        default: throw new Error('Unknown Remote action');
      }
    } finally { this.setupBusy = false; }
    return this.snapshot();
  }
  async disconnect(forget = true) {
    ++this.generation;
    const channel = this.channel; this.channel = undefined;
    this.recovery = undefined; this.recovering = false;
    const cleanup = this.clearBinding(channel);
    this.processed.clear(); this.authorizationUrl = undefined; this.callbackUrl = undefined;
    this.state = { revision: this.state.revision, status: 'idle', approvalReady: false,
      saved: this.state.saved, storageError: this.state.storageError }; this.publish();
    const saved = forget ? this.save(undefined) : this.writes.then(() => true);
    if (cleanup) {
      let timer: NodeJS.Timeout | undefined;
      try { await Promise.race([cleanup, new Promise(resolve => { timer = setTimeout(resolve, 2000); })]); }
      finally { clearTimeout(timer); }
    }
    // Killing the isolated helper also cancels a hung handshake or HTTP request.
    if (channel) await channel.stop();
    if (!await saved) throw new Error('Could not remove the saved Remote connection. Retry disconnect before quitting.');
  }
  shutdown() { return this.disconnect(false); }
  private fail(stage: RemoteSnapshot['stage']) {
    void this.shutdown().catch(() => {});
    this.state.status = 'error'; this.state.stage = stage; this.publish();
  }
  private help() {
    return remoteCommands.map(item => `${item.command}  ${item.zh} / ${item.en}`).join('\n')
      + '\n\n别名 / Aliases: /list, /switch <s1>, /session list, /session new\n登录、信任、权限和模型修改请在 Desktop 完成。 / Sign-in, trust, permissions and model changes stay on Desktop.';
  }
  private available(binding: Binding) {
    return this.host.sessions().filter(session => binding.workspaces.includes(session.workspace));
  }
  private lookup(binding: Binding, ref: string) {
    const sessions = this.available(binding);
    for (const session of sessions) this.ref(binding, session.sessionId);
    const normalized = /^\d+$/.test(ref) ? `s${ref}` : ref.toLowerCase();
    const session = sessions.find(item => item.sessionId === ref || binding.refs.get(item.sessionId) === normalized);
    if (!session) throw new Error('Session is unavailable or outside the authorized scope');
    return session;
  }
  private describe(binding: Binding, session: RemoteSession) {
    return `${this.ref(binding, session.sessionId)} · ${redactApprovalText(session.name).replace(/[\r\n]/g, ' ').slice(0, 70)}`
      + ` (${basename(resolve(session.workspace))})${binding.current?.session.sessionId === session.sessionId ? ' ← 当前 / Current' : ''}`;
  }
  private async command(binding: Binding, command: Exclude<RemoteCommand, { type: 'message' }>, target?: Target,
    stop?: { target: Target; runId?: string }) {
    let text = '';
    switch (command.type) {
      case 'help': text = this.help(); break;
      case 'invalid':
        this.send({ key: randomUUID(), title: 'Not accepted / 未接收', text: `未知指令或参数不正确，未发送给模型。 / Unknown command or invalid arguments; nothing was sent to the model.\n\n${this.help()}` });
        return;
      case 'projects':
        text = binding.workspaces.map((workspace, index) => `p${index + 1} · ${basename(resolve(workspace))}`).join('\n');
        break;
      case 'sessions': {
        await this.host.refresh(); this.assertBinding(binding);
        const sessions = this.available(binding), start = (command.page - 1) * 10;
        for (const session of sessions) this.ref(binding, session.sessionId);
        text = `${command.page} / ${Math.max(1, Math.ceil(sessions.length / 10))}\n\n`
          + (sessions.slice(start, start + 10).map(session => this.describe(binding, session)).join('\n') || '没有会话 / No sessions')
          + '\n\n/session s1  切换 / Switch';
        break;
      }
      case 'select': {
        await this.host.refresh(); this.assertBinding(binding);
        target = await this.select(binding, this.lookup(binding, command.ref).sessionId);
        text = `已切换后续输入 / Future messages target:\n${this.label(target)}\n已有任务不停止，本机视图与草稿不变。 / Existing tasks, local view and drafts are unchanged.`;
        break;
      }
      case 'new': {
        const index = command.ref && /^p?[1-9]\d*$/.test(command.ref) ? Number(command.ref.replace(/^p/, '')) - 1 : -1;
        const workspace = command.ref ? binding.workspaces[index] : target?.session.workspace ?? (binding.workspaces.length === 1 ? binding.workspaces[0] : undefined);
        if (!workspace || !binding.workspaces.includes(workspace)) throw new Error('Choose an authorized project with /projects');
        this.makeRoom(binding);
        const worker = await this.host.createSession(workspace);
        this.assertBinding(binding);
        const session = this.host.sessions().find(item => item.sessionId === worker.state?.sessionId && item.workspace === workspace);
        if (!session) throw new Error('New session identity changed');
        binding.current = target = this.attach(binding, worker, session);
        if (this.state.stage === 'runtime') this.state.stage = undefined;
        this.publish();
        void this.saveSelection(binding);
        text = `新会话已创建，尚未发送模型请求 / New session created; no model request sent:\n${this.label(target)}`;
        break;
      }
      case 'current':
        text = target ? this.describe(binding, this.current(target).session) : '未选择会话，请用 /sessions 和 /session。 / No session selected. Use /sessions and /session.';
        break;
      case 'status': {
        const session = command.ref ? this.lookup(binding, command.ref) : target?.session;
        if (!session) throw new Error('Select a session first');
        let worker: SessionRuntime | undefined;
        try { if (session.runtimeId) worker = this.host.worker(session.runtimeId, session.sessionId); } catch {}
        text = this.describe(binding, session) + '\n'
          + (worker ? [
            worker.pendingUI.size ? '等待本机或审批卡片 / Awaiting input or approval'
              : worker.state?.isCompacting ? '正在整理上下文 / Maintaining context'
              : worker.busy || worker.submissions || worker.backgroundActive || worker.backgroundLanes?.length ? '正在运行 / Running'
              : worker.failed || worker.interrupted ? '已中断 / Interrupted' : '空闲 / Idle',
            `Model: ${worker.state?.model?.id ?? '-'}`,
            `Effort: ${worker.state?.thinkingLevel ?? '-'}`,
            `Permissions: ${worker.permissionPreset ?? '-'}`,
            `Queue: ${worker.state?.pendingMessageCount ?? (worker.queued ? 1 : 0)}`,
          ].join('\n') : '尚未加载运行时 / Runtime not loaded');
        break;
      }
      case 'stop': {
        if (!stop?.runId || this.current(stop.target).runId !== stop.runId)
          text = '收到指令时没有仍在运行的对应任务，未停止其他轮次。 / No matching task remains from when this command was received; no later run was stopped.';
        else {
          await this.host.stop(stop.target.worker);
          text = `已请求停止 / Stop requested: ${this.label(stop.target)}`;
        }
        break;
      }
      case 'disconnect': {
        try {
          await this.channel?.request('card', { bindingId: binding.id, key: randomUUID(), title: 'Disconnected / 已断开',
            text: '飞书连接已关闭，本机已接收的队列和任务继续保留。 / Feishu is disconnected. Accepted local queues and tasks remain.' });
        } finally { if (this.binding === binding) await this.disconnect(); }
        return;
      }
    }
    if (this.binding === binding) this.send({ key: randomUUID(), title: 'Remote Beta / 远程访问', text });
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
        if (this.channel) void this.connected(this.channel, this.generation);
        break;
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
        if (this.state.status !== 'connected' || typeof event.text !== 'string' || !event.text.trim() || event.text.length > 12000) return;
        const command = parseRemoteCommand(event.text);
        const stopTarget = command.type === 'stop' && command.ref
          ? Promise.resolve().then(() => binding.targets.get(this.lookup(binding, command.ref!).sessionId))
          : this.routing;
        const stop = command.type === 'stop' ? stopTarget.then(target => target ? { target, runId: target.runId } : undefined).catch(() => undefined) : undefined;
        this.processed.set(event.id, this.now() + 600000); this.inputCount++;
        void this.queue(binding, async target => {
          if (command.type !== 'message') { await this.command(binding, command, target, await stop); return; }
          const selected = this.current(target);
          if (selected.receipts.size >= 20) throw new Error('Remote receipt limit reached');
          await this.host.submit(selected.worker, command.text, queueId => {
            if (this.binding !== binding || binding.targets.get(selected.session.sessionId) !== selected) return;
            selected.receipts.set(event.id, { queueId, delivered: false });
            void this.reaction(event.id, true);
          });
        }, command.type === 'select' || command.type === 'new').catch(() => {
          for (const target of binding.targets.values()) if (target.receipts.delete(event.id))
            void this.reaction(event.id, false, binding);
          if (this.binding === binding) this.send({ key: 'receipt', title: 'Not accepted / 未接收',
            text: '操作未接收。请用 /sessions、/projects 检查授权范围，或在 Desktop 检查会话状态。未转发为模型指令。 / Not accepted. Check /sessions, /projects or the session on Desktop. No slash command was forwarded to the model.' });
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
          const { worker } = this.current(decision.target);
          if (worker.pendingUI.get(decision.id) !== decision.request
            || remoteDecision(decision.request, worker)?.text !== decision.text) return;
          this.host.respond(worker, { id: decision.id, confirmed: event.option === 'Allow once / 允许一次' });
          this.decisions.delete(event.token); this.state.approvalReady = true; this.publish();
          this.syncDecisions(worker);
        } catch {}
        break;
      }
      case 'error':
        if (event.stage === 'delivery') { this.state.stage = 'delivery'; this.publish(); }
        else this.fail(['authorization', 'identity', 'transport'].includes(event.stage) ? event.stage : 'transport');
        break;
    }
  }
  private async reaction(messageId: string, active: boolean, binding = this.binding, channel = this.channel) {
    if (!binding || !channel) return;
    try { await channel.request('reaction', { bindingId: binding.id, messageId, active }); }
    catch {
      if (this.binding === binding && this.channel === channel) { this.state.stage = 'delivery'; this.publish(); }
    }
  }
  queueEvent(worker: SessionRuntime, queueId: string, event: 'delivered' | 'removed') {
    const target = [...this.binding?.targets.values() ?? []].find(item => item.worker === worker);
    if (!target) return;
    for (const [messageId, receipt] of target.receipts) if (receipt.queueId === queueId) {
      if (event === 'delivered') receipt.delivered = true;
      else { target.receipts.delete(messageId); void this.reaction(messageId, false); }
      break;
    }
  }
  queueFailed(worker: SessionRuntime) {
    const target = [...this.binding?.targets.values() ?? []].find(item => item.worker === worker);
    if (!target) return;
    this.clearReceipts(target, true);
    this.send({ key: randomUUID(), title: `Interrupted / 已中断 · ${this.label(target)}`,
      text: '消息队列已暂停，请在 Desktop 检查后继续。 / The message queue is paused. Review the session in Desktop before continuing.' });
  }
  private clearReceipts(target: Target, all = false) {
    for (const [messageId, receipt] of target.receipts) if (all || receipt.delivered) {
      target.receipts.delete(messageId); void this.reaction(messageId, false);
    }
  }
  private send(card: Card) {
    if (!this.binding || !this.channel) return;
    if (!this.cards.has(card.key) && this.cards.size >= 32) { this.state.stage = 'delivery'; this.publish(); return; }
    this.cards.set(card.key, { ...card, title: redactApprovalText(card.title).slice(0, 200), text: redactApprovalText(card.text).slice(-12000) });
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
        try { await channel.request('card', { ...card, bindingId: binding.id }); }
        catch {
          if (this.binding === binding) { this.state.stage = 'delivery'; this.publish(); }
        }
      }
    })().finally(() => {
      if (this.pumping === owner) { this.pumping = undefined; if (this.cards.size) this.pump(); }
    });
  }
  private syncDecisions(worker: SessionRuntime) {
    const target = [...this.binding?.targets.values() ?? []].find(item => item.worker === worker);
    if (!target || target.worker !== worker) return;
    for (const [token, decision] of this.decisions) if (decision.target === target && (worker.pendingUI.get(decision.id) !== decision.request
      || remoteDecision(decision.request, worker)?.text !== decision.text)) {
      this.decisions.delete(token); void this.channel?.request('revoke', { token }).catch(() => {});
    }
    for (const [id, request] of worker.pendingUI) {
      if (this.decisions.size >= 32 || [...this.decisions.values()].some(item => item.target === target && item.id === id)) continue;
      const parsed = remoteDecision(request, worker);
      if (!parsed) continue;
      const token = randomUUID();
      this.decisions.set(token, { target, id, request, text: parsed.text });
      this.send({ key: token, ...parsed, title: `${parsed.title} · ${this.label(target)}`, actions: { token, options: ['Allow once / 允许一次', 'Deny / 拒绝'] } });
    }
  }
  runtimeEvent(worker: SessionRuntime, event: RuntimeEvent) {
    const target = [...this.binding?.targets.values() ?? []].find(item => item.worker === worker);
    if (!target || target.worker !== worker) return;
    try { this.current(target); }
    catch { this.dispose(worker); return; }
    this.syncDecisions(worker);
    if (event.type === 'agent_start') { target.runId = randomUUID(); target.projection = ''; this.project(target, 'working'); }
    if (event.type === 'message_update' && target.runId) {
      const delta = event.assistantMessageEvent;
      if (delta?.type === 'text_delta' && typeof delta.delta === 'string') {
        target.projection = (target.projection + delta.delta).slice(-12000);
        if (!target.timer) target.timer = setTimeout(() => {
          target.timer = undefined; this.project(target, 'working');
        }, 1000).unref();
      }
    }
    if (event.type === 'message_end' && target.runId) {
      const text = assistantText(event.message);
      if (text) target.projection = text;
    }
    if (event.type === 'agent_end') this.clearReceipts(target,
      worker.failed || worker.interrupted || taskOutcome(worker.messages) === 'interrupted');
    if (event.type === 'desktop_task_completed' && target.runId) this.finish(target, 'completed');
    if (event.type === 'agent_end' && (worker.failed || worker.interrupted || taskOutcome(worker.messages) === 'interrupted'))
      this.finish(target, 'interrupted');
    if (event.type === 'desktop_exit') this.dispose(worker);
  }
  private project(target: Target, reply: ReplyStatus) {
    if (target.runId) this.send({ key: target.runId, sessionKey: target.session.sessionId,
      title: this.label(target), text: target.projection, reply });
  }
  private finish(target: Target, reply: Exclude<ReplyStatus, 'working'>) {
    clearTimeout(target.timer); target.timer = undefined;
    this.clearReceipts(target);
    this.project(target, reply); target.runId = undefined;
  }
  dispose(worker: SessionRuntime) {
    if (!this.retains(worker)) return;
    const binding = this.binding!;
    const target = [...binding.targets.values()].find(item => item.worker === worker)!;
    this.clearReceipts(target, true);
    if (target.runId) this.finish(target, 'interrupted');
    clearTimeout(target.timer); worker.remoteAttached = false;
    binding.targets.delete(target.session.sessionId);
    for (const [token, decision] of this.decisions) if (decision.target === target) {
      this.decisions.delete(token); void this.channel?.request('revoke', { token }).catch(() => {});
    }
    if (binding.current === target) { binding.current = undefined; this.routing = Promise.resolve(undefined); }
    this.state.stage = 'runtime'; this.publish();
    void this.saveSelection(binding);
  }
}
