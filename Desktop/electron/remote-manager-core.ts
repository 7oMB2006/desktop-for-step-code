import type { Message, RuntimeEvent, UIRequest } from '../src/contracts';
import { remoteCommands, remoteWorkspaceLimit, type RemoteAction, type RemoteImage, type RemoteProject, type RemoteSession, type RemoteSnapshot } from '../src/remote';
import { remoteSessionList, type RemoteListProject, type RemoteListSession } from '../src/remote-session-list';
import type { SessionRuntime, WorkerTransport } from './session-runtimes';
import { taskOutcome } from './task-outcome';
import { permissionApprovalPresentation, redactApprovalText } from '../src/approval-presentation';
import { parseRemoteCommand, type RemoteCommand } from './remote-commands';
import { remoteIdentity, remotePeer, remoteSessionRefLimit, savedRemote, type RemotePersistence, type SavedRemote } from './remote-schema';
import type { QueueReceiptEvent } from './pending-messages';
import { RemoteToolProgress, remoteWorkerStatus } from './remote-progress';
import { remoteOverviewLimit, type RemoteOverview } from './remote-card.mjs';
import { questionnaire, serializeAnswers } from '../src/questionnaire';
import { planReview } from '../src/plan-review';
import { completionReview, reviewActive } from '../src/completion-review';
import { submitAnswer, cancelAnswer, validRemoteForm, remoteFormAnswers, type RemoteFormField } from './remote-form.mjs';

export interface RemotePlatform {
  uuid(): string;
  bindingCode(): string;
  basename(path: string): string;
}

export interface RemoteChannel {
  request(type: string, args?: Record<string, unknown>): Promise<any>;
  stop(): Promise<void>;
}
export interface RemoteHost {
  language?(): 'zh' | 'en';
  sessions(): RemoteSession[];
  projects?(): RemoteProject[];
  refresh(): Promise<void>;
  validateWorkspaces(workspaces: string[]): Promise<void>;
  prepare(sessionId: string): Promise<SessionRuntime>;
  createSession(workspace: string): Promise<SessionRuntime>;
  worker(runtimeId: string, sessionId: string): SessionRuntime;
  queued?(worker: SessionRuntime): number;
  submit(worker: SessionRuntime, message: string, accepted: (queueId: string) => void, images?: RemoteImage[]): Promise<void>;
  withdraw?(worker: SessionRuntime, queueId: string): boolean;
  loadImages?(channel: RemoteChannel, bindingId: string, messageId: string, keys: string[], valid: () => boolean): Promise<RemoteImage[]>;
  sendImage?(channel: RemoteChannel, bindingId: string, sessionId: string, worker: SessionRuntime, path: string, valid: () => boolean, signal?: AbortSignal): Promise<{ messageId: string }>;
  stop(worker: SessionRuntime): Promise<void>;
  respond(worker: SessionRuntime, answer: Record<string, unknown>): void;
  open(url: string): Promise<void>;
}
interface Target {
  worker: SessionRuntime; rpc: WorkerTransport; session: RemoteSession;
  projection: string; runId?: string; timer?: NodeJS.Timeout;
  receipts: Map<string, { queueId: string; delivered: boolean }>;
  progress: RemoteToolProgress;
  truncated?: boolean;
  imageActive?: boolean;
}
interface Binding {
  id: string; workspaces: string[]; current?: Target;
  targets: Map<string, Target>; refs: Map<string, string>; confirmedRefs: Map<string, string>;
  refsReady: boolean; nextRef: number;
  lists: Map<string, { projects: RemoteListProject[]; sessions: RemoteListSession[] }>;
  imagesAllowed?: boolean;
  imageSetting?: boolean;
  selectionRevision?: number;
  unconfirmed?: boolean;
}
interface Decision { target: Target; id: string; request: UIRequest; signature: string; key: string; expiresAt: number; expired?: boolean; timer?: NodeJS.Timeout }
interface InputReceipt {
  target: Target; queueId?: string; state: 'receiving' | 'queued' | 'dispatching' | 'delivered' | 'unknown' | 'removed';
  recalled?: boolean;
}
type ReplyStatus = 'working' | 'completed' | 'interrupted';
interface Card {
  key: string; title: string; text: string; sessionKey?: string; reply?: ReplyStatus;
  actions?: { token: string; options: string[] };
  progress?: string;
  truncated?: boolean;
  overview?: RemoteOverview;
  form?: RemoteFormField[];
}
export function parseRemoteAction(value: unknown): RemoteAction {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid Remote action');
  const input = value as Record<string, unknown>;
  if (input.type === 'images') {
    if (typeof input.allowed !== 'boolean') throw new Error('Invalid image permission');
    return { type: 'images', allowed: input.allowed };
  }
  if (input.type === 'bind' || input.type === 'select' || input.type === 'detach') {
    const string = (key: string) => {
      const value = input[key];
      if (typeof value !== 'string' || !value || value.length > 200) throw new Error('Invalid Remote binding');
      return value;
    };
    if (input.type === 'select' || input.type === 'detach') return { type: input.type, sessionId: string('sessionId') };
    if (input.imagesAllowed !== undefined && typeof input.imagesAllowed !== 'boolean') throw new Error('Invalid image permission');
    if (input.workspaces !== undefined && (!Array.isArray(input.workspaces) || !input.workspaces.length || input.workspaces.length > remoteWorkspaceLimit
      || input.workspaces.some(value => typeof value !== 'string' || !value || value.length > 4096)
      || new Set(input.workspaces).size !== input.workspaces.length)) throw new Error('Invalid Remote scope');
    return { type: 'bind', candidateId: string('candidateId'), runtimeId: input.runtimeId === undefined ? undefined : string('runtimeId'),
      sessionId: string('sessionId'), workspaces: input.workspaces as string[] | undefined,
      ...(input.imagesAllowed !== undefined ? { imagesAllowed: input.imagesAllowed as boolean } : {}) };
  }
  if (!['connect', 'disconnect', 'openAuthorization', 'openCallbacks', 'checkCallbacks', 'armBinding', 'unbind', 'stop'].includes(String(input.type)))
    throw new Error('Unknown Remote action');
  return { type: input.type } as RemoteAction;
}
function assistantText(message?: Message) {
  if (message?.role !== 'assistant') return '';
  return redactApprovalText(typeof message.content === 'string' ? message.content
    : message.content.filter(block => block.type === 'text').map(block => block.text ?? '').join('\n'));
}
function liveCall(worker: SessionRuntime, name: string, id?: string) {
  const finished = new Set(worker.messages.filter(message => message.role === 'toolResult').map(message => message.toolCallId));
  const calls = worker.messages.flatMap(message => message.role === 'assistant' && Array.isArray(message.content)
    ? message.content.filter(block => block.type === 'toolCall' && block.name === name && block.id
      && !finished.has(block.id) && (id === undefined || block.id === id)) : []);
  return calls.length === 1 ? calls[0] : undefined;
}
export function remoteDecision(request: UIRequest, worker: SessionRuntime): {
  title: string; text: string; options: string[]; signature: string; form?: RemoteFormField[];
} | undefined {
  if (request.runtimeId !== worker.id || request.projectTrust || request.messageStyle || (request.message?.length ?? 0) > 8000) return;
  const question = questionnaire(request), plan = planReview(request);
  const refinements = request.method === 'input' && request.title === 'Desktop Plan refinements';
  if (question || plan || refinements) {
    const call = liveCall(worker, question ? 'clarify_user' : 'exit_plan_mode', question?.callId);
    if (!call) return;
    const signature = JSON.stringify({ request, call });
    if (plan) {
      const text = `批准后将退出规划并开始实施；不是普通工具授权。\nApproving exits planning and starts implementation.\n\n${plan.path}\n\n${plan.content}`;
      if (!plan.content.trim() || text.length > 5000) return;
      return { title: '审阅计划 / Review plan', text, signature,
        options: ['Approve plan / 批准计划', 'Request refinements / 要求修改', 'Keep planning / 继续规划'] };
    }
    const form: RemoteFormField[] = question ? question.questions.map((item, index) => ({
      text: redactApprovalText([`${index + 1}. ${item.label}`, item.question, item.reason,
        ...item.options.map((option, index) => `${index + 1}. ${option.label}${option.description ? `: ${option.description}` : ''}`)].filter(Boolean).join('\n')),
      options: item.options.map(option => redactApprovalText(option.label)), custom: item.allowFreeform,
    })) : [{ text: '需要如何修改计划？ / What should change in the plan?', options: [], custom: true }];
    if (!validRemoteForm(form)) return;
    return { title: question ? '请回答问题 / Answer questions' : '计划修改意见 / Plan refinements',
      text: question ? '这是正式回答，不是权限批准。 / Submit your answers, not a tool approval.'
        : '提交修改意见不会批准计划。 / Submitting feedback does not approve the plan.',
      signature, form, options: [submitAnswer, cancelAnswer] };
  }
  const parsed = permissionApprovalPresentation(request, worker.messages, 'en', worker.id);
  if (!parsed) return;
  const call = liveCall(worker, parsed.toolName, parsed.callId);
  if (!call || parsed.inputKind === 'summary') return;
  const asking = parsed.operation === 'question';
  const text = asking ? [
    '当前权限设置要求先允许 Agent 提问。此操作不选择答案，也不批准命令或文件修改。',
    'This only permits asking; it does not answer the question or authorize workspace changes.',
    parsed.preview, ...(parsed.choices ?? []).map(choice => `${choice.label}${choice.description ? `: ${choice.description}` : ''}`),
  ].filter(Boolean).join('\n\n') : [parsed.reason, `Tool: ${parsed.toolName}\nCall: ${parsed.callId}`,
    parsed.target ? `Target: ${parsed.target}` : undefined, parsed.input, parsed.otherParameters,
    parsed.verificationCommand ? `Then run:\n${parsed.verificationCommand}` : undefined].filter(Boolean).join('\n\n');
  // Actionable cards must contain the exact recovered input, never a clipped summary.
  if (text.length > 5000) return;
  return { title: asking ? '允许 Agent 提问？ / Allow a question?' : parsed.title, text,
    options: asking ? ['Allow question / 允许提问', 'Deny question / 拒绝提问'] : ['Allow once / 允许一次', 'Deny / 拒绝'],
    signature: JSON.stringify({ request, call }) };
}

function remoteAnswer(request: UIRequest, parsed: NonNullable<ReturnType<typeof remoteDecision>>, option: string, form: unknown) {
  if (!parsed.options.includes(option)) return;
  if (request.method === 'confirm') return { id: request.id, confirmed: option === parsed.options[0] };
  if (planReview(request)) return { id: request.id, value: request.options![parsed.options.indexOf(option)] };
  if (!parsed.form) return;
  if (option === cancelAnswer) return { id: request.id, cancelled: true };
  const answers = remoteFormAnswers(parsed.form, form);
  if (!answers) return;
  const question = questionnaire(request);
  return { id: request.id, value: question ? serializeAnswers(question, answers.map((answer, index) => ({
    id: question.questions[index].id, wasCustom: answer.custom !== undefined,
    value: answer.custom ?? question.questions[index].options[answer.index!].value,
  }))) : answers[0].custom };
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
  private approvalKeys = new WeakMap<UIRequest, string>();
  private processed = new Map<string, number>();
  private receipts = new Map<string, InputReceipt>();
  private recalledInputs = new Set<string>();
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
    private changed: (state: RemoteSnapshot) => void, private now: () => number, private persistence: RemotePersistence | undefined,
    private platform: RemotePlatform) {}
  snapshot(): RemoteSnapshot {
    return structuredClone({ ...this.state, binding: this.binding?.current ? this.metadata(this.binding.current) : undefined,
      targetUnconfirmed: this.binding?.unconfirmed || undefined, imagesAllowed: this.binding?.imagesAllowed || false,
      sharing: [...this.binding?.targets.values() ?? []].map(target => this.metadata(target)),
      authorized: this.binding ? { workspaces: this.binding.workspaces } : undefined,
      projects: this.projects(), sessions: this.host.sessions() });
  }
  private projects() {
    return this.host.projects?.() ?? [...new Set(this.host.sessions().map(session => session.workspace))]
      .map(workspace => ({ workspace, name: this.host.sessions().find(session => session.workspace === workspace)?.workspaceName
        || this.platform.basename(workspace) }));
  }
  private metadata(target: Target) {
    const latest = this.host.sessions().find(session => session.sessionId === target.session.sessionId
      && session.workspace === target.session.workspace);
    if (latest) target.session = { ...target.session, name: latest.name, workspaceName: latest.workspaceName };
    return target.session;
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
  private async saveSelection(binding: Binding) {
    if (!this.persistence) { binding.confirmedRefs = new Map(binding.refs); return true; }
    if (this.savedBinding !== binding || !this.remembered?.access) return false;
    const refs = binding.refsReady ? [...binding.refs] : this.remembered.access.sessionRefs;
    const saved = await this.save({ ...this.remembered, access: { ...this.remembered.access,
      sessionId: binding.current?.session.sessionId, sessionRefs: refs, imagesAllowed: (binding.imageSetting ?? binding.imagesAllowed) === true } });
    // Failed writes must neither publish provisional handles nor erase the reliable map.
    if (saved && this.binding === binding && refs) binding.confirmedRefs = new Map(refs);
    return saved;
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
        const binding: Binding = { id: this.platform.uuid(), workspaces: [...access.workspaces], targets: new Map(),
          refs: new Map(access.sessionRefs), refsReady: access.sessionRefs !== undefined, lists: new Map(),
          confirmedRefs: new Map(access.sessionRefs), imagesAllowed: access.imagesAllowed === true,
          nextRef: Math.max(0, ...(access.sessionRefs ?? []).map(([, ref]) => Number(ref.slice(1)))) + 1 };
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
        if (current()) this.send({ key: 'recovery', title: 'Connection restored / 连接已恢复',
          text: `当前 / Current: ${binding.current ? this.label(binding.current) : '未选择 / Not selected'}\n已恢复连接与会话选择，未恢复执行、旧审批或离线消息。 / Connection and selection restored, not execution, approvals or offline input.` });
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
    this.metadata(target);
    return target;
  }
  private ref(binding: Binding, sessionId: string) {
    let ref = binding.refs.get(sessionId);
    if (!ref) {
      if (binding.refs.size >= remoteSessionRefLimit || binding.nextRef > remoteSessionRefLimit)
        throw new Error('Remote session handle limit reached. Pair again locally.');
      ref = `s${binding.nextRef++}`; binding.refs.set(sessionId, ref);
    }
    return ref;
  }
  private label(target: Target) {
    return `${this.handle(this.binding!, target.session.sessionId)} · ${redactApprovalText(this.metadata(target).name).replace(/[\r\n]/g, ' ').slice(0, 70)}`;
  }
  private handle(binding: Binding, sessionId: string) {
    return binding.refsReady ? binding.confirmedRefs.get(sessionId) ?? sessionId : sessionId;
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
    void this.channel?.request('sessionScope', { bindingId: binding.id, sessionKey: idle.session.sessionId, active: false }).catch(() => {});
    for (const [token, decision] of this.decisions) if (decision.target === idle) {
      clearTimeout(decision.timer);
      this.decisions.delete(token); void this.channel?.request('revoke', { token, status: 'unavailable' }).catch(() => {});
    }
  }
  private attach(binding: Binding, worker: SessionRuntime, session: RemoteSession) {
    this.assertBinding(binding);
    if (!binding.workspaces.includes(session.workspace) || worker.state?.sessionId !== session.sessionId
      || this.host.worker(worker.id, session.sessionId) !== worker) throw new Error('Session is outside the authorized scope');
    const existing = binding.targets.get(session.sessionId);
    if (existing) return this.current(existing);
    this.makeRoom(binding);
    const target: Target = { worker, rpc: worker.rpc, session: { ...session, runtimeId: worker.id }, projection: '', receipts: new Map(), progress: new RemoteToolProgress() };
    worker.remoteAttached = true; binding.targets.set(session.sessionId, target); this.ref(binding, session.sessionId);
    void this.channel?.request('sessionScope', { bindingId: binding.id, sessionKey: session.sessionId, active: true }).catch(() => {});
    return target;
  }
  private async select(binding: Binding, sessionId: string, revision = binding.selectionRevision) {
    this.assertBinding(binding);
    const session = this.host.sessions().find(item => item.sessionId === sessionId && binding.workspaces.includes(item.workspace));
    if (!session) throw new Error('Session is unavailable or outside the authorized scope');
    const target = binding.targets.get(sessionId);
    if (!target) this.makeRoom(binding);
    const worker = target ? this.current(target).worker : await this.host.prepare(sessionId);
    this.assertBinding(binding);
    if (binding.selectionRevision !== revision) throw new Error('Selection was superseded by a forwarding change');
    const current = this.host.sessions().find(item => item.sessionId === sessionId && item.workspace === session.workspace);
    if (!current) throw new Error('Session changed while opening');
    binding.current = this.attach(binding, worker, current);
    binding.unconfirmed = false;
    // Observe a resident run from this point, without backfilling its transcript.
    if (!binding.current.runId && (worker.runActive || worker.state?.isStreaming)) {
      binding.current.runId = this.platform.uuid();
      binding.current.imageActive = true;
      this.imageScope(binding.current);
      this.project(binding.current, 'working');
    }
    this.syncDecisions(worker);
    if (this.state.stage === 'runtime') this.state.stage = undefined;
    this.publish();
    await this.saveSelection(binding);
    return binding.current;
  }
  private queue(binding: Binding, operation: (target?: Target) => Promise<void>, selects = false, detaches = false) {
    const route = this.routing;
    const revision = binding.selectionRevision;
    const pending = this.input.then(async () => {
      const target = await route;
      this.assertBinding(binding);
      if (selects && revision !== binding.selectionRevision) throw new Error('Selection was superseded by a forwarding change');
      await operation(target);
    });
    this.input = pending.catch(() => {});
    // Each accepted message retains the selection barrier before it, not a later global selection.
    if (selects || detaches) this.routing = pending.then(
      () => this.binding === binding && !binding.unconfirmed ? binding.current : undefined,
      () => {
        if (!selects) return route;
        if (this.binding === binding) { binding.unconfirmed = true; this.publish(); }
        return undefined;
      });
    return pending;
  }
  private async detach(binding: Binding, target: Target, invalidateSelections = true) {
    this.assertBinding(binding);
    this.current(target);
    if (invalidateSelections) binding.selectionRevision = (binding.selectionRevision ?? 0) + 1;
    clearTimeout(target.timer);
    this.clearReceipts(target, true);
    target.worker.remoteAttached = false;
    binding.targets.delete(target.session.sessionId);
    for (const [key, card] of this.cards) if (card.sessionKey === target.session.sessionId) this.cards.delete(key);
    for (const [token, decision] of this.decisions) if (decision.target === target) {
      clearTimeout(decision.timer); this.decisions.delete(token);
      void this.channel?.request('revoke', { token, status: 'unavailable' }).catch(() => {});
    }
    if (binding.current === target) {
      binding.current = undefined; binding.unconfirmed = true;
      if (invalidateSelections) this.routing = Promise.resolve(undefined);
    }
    this.publish();
    await this.channel?.request('sessionScope', { bindingId: binding.id, sessionKey: target.session.sessionId, active: false });
    await this.saveSelection(binding);
  }
  async deliverImage(worker: SessionRuntime, path: string, caption?: string, signal?: AbortSignal) {
    const binding = this.binding, channel = this.channel;
    const target = [...binding?.targets.values() ?? []].find(item => item.worker === worker);
    if (!binding || !channel || !target || !binding.imagesAllowed || !target.runId || !target.imageActive || !this.host.sendImage)
      throw new Error('Image delivery requires an active forwarding session and image permission in Desktop Remote.');
    if (caption !== undefined && (typeof caption !== 'string' || caption.length > 500)) throw new Error('Invalid image caption');
    const runId = target.runId;
    const valid = () => !signal?.aborted && this.binding === binding && this.channel === channel
      && binding.imagesAllowed === true && binding.targets.get(target.session.sessionId) === target && target.runId === runId
      && target.imageActive === true
      && this.state.status === 'connected' && worker.rpc === target.rpc;
    if (!valid()) throw new Error('Image delivery scope expired');
    const result = await this.host.sendImage(channel, binding.id, target.session.sessionId, worker, path, valid, signal);
    if (!valid()) throw new Error('Image delivery status is unknown after connection or session change');
    let captionDelivered: boolean | undefined;
    if (caption?.trim()) {
      try {
        await channel.request('card', { bindingId: binding.id, key: `image-${result.messageId}`,
          sessionKey: target.session.sessionId, title: this.label(target), text: redactApprovalText(caption) });
        captionDelivered = true;
      } catch { captionDelivered = false; }
    }
    return { delivered: true, messageId: result.messageId, ...(captionDelivered !== undefined ? { captionDelivered } : {}),
      note: 'Image message sent, not task completion.' };
  }
  private clearCode() {
    clearTimeout(this.codeTimer); this.codeTimer = undefined; this.armId = undefined;
    this.state.bindingCode = undefined; this.state.candidate = undefined;
  }
  private clearBinding(channel = this.channel) {
    // Every cleanup path must keep failed writes out of same-process recovery.
    if (this.binding?.refsReady && this.remembered?.access)
      this.remembered.access.sessionRefs = [...this.binding.confirmedRefs];
    const cleanup: Promise<void>[] = [];
    for (const target of this.binding?.targets.values() ?? []) {
      target.worker.remoteAttached = false; clearTimeout(target.timer);
      for (const messageId of target.receipts.keys()) cleanup.push(this.reaction(messageId, false, this.binding, channel));
      target.receipts.clear();
    }
    for (const decision of this.decisions.values()) clearTimeout(decision.timer);
    this.binding = undefined; this.savedBinding = undefined; this.clearCode(); this.decisions.clear(); this.probe = undefined;
    this.receipts.clear();
    this.recalledInputs.clear();
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
    if (action.type === 'images') {
      const binding = this.binding;
      if (!binding) throw new Error('Authorize a private chat first');
      if (binding.imageSetting !== undefined) throw new Error('Image permission is still being saved');
      binding.imageSetting = action.allowed;
      // Revocation is immediate; a new grant is usable only after durable confirmation.
      if (!action.allowed) {
        binding.imagesAllowed = false;
        for (const target of binding.targets.values()) this.imageScope(target);
        this.publish();
      }
      try {
        if (!await this.saveSelection(binding)) {
          if (this.remembered?.access && this.binding === binding) this.remembered.access.imagesAllowed = false;
          throw new Error(action.allowed ? 'Could not save image permission'
            : 'Images disabled for this connection, but the change could not be saved. Retry or disconnect before quitting.');
        }
        if (this.binding !== binding) throw new Error('Remote authorization changed');
        binding.imagesAllowed = action.allowed;
        if (action.allowed) for (const target of binding.targets.values()) this.imageScope(target);
        this.publish();
      } finally {
        binding.imageSetting = undefined;
      }
      return this.snapshot();
    }
    if (action.type === 'detach') {
      const binding = this.binding, target = binding?.targets.get(action.sessionId);
      if (!binding || !target) throw new Error('Session is not forwarding');
      await this.detach(binding, target);
      return this.snapshot();
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
          this.probe = this.platform.uuid();
          this.send({ key: 'probe', title: 'Connection check / 连接检查',
            text: 'This button only verifies the callback. / 此按钮仅验证回调，不批准任何工具操作。',
            actions: { token: this.probe, options: ['Verify / 验证'] } }); break;
        }
        case 'armBinding': {
          const channel = this.channel;
          if (this.state.status !== 'connected' || !channel || this.binding) throw new Error('Unbind before pairing a chat');
          this.clearCode();
          const armId = this.armId = this.platform.uuid();
          const code = this.platform.bindingCode(), expiresAt = this.now() + 120000;
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
          }, 120000);
          this.codeTimer.unref?.();
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
          if (!workspaces.includes(session.workspace) || workspaces.some(workspace => !this.projects().some(item => item.workspace === workspace)))
            throw new Error('Choose an available authorization scope');
          const worker = await this.host.prepare(action.sessionId);
          if (generation !== this.generation || this.channel !== channel || this.binding
            || this.state.candidate?.id !== action.candidateId || !this.state.bindingCode
            || this.state.bindingCode.expiresAt <= this.now()) throw new Error('Chat verification has expired');
          if (worker.busy || worker.submissions || worker.pendingUI.size || worker.state?.isCompacting
            || worker.backgroundActive || worker.backgroundLanes?.length || worker.queued || worker.mutating || worker.operations
            || worker.failed || worker.interrupted || worker.launch?.goal?.status === 'active')
            throw new Error('Bind an idle session');
          const binding: Binding = { id: this.platform.uuid(), workspaces: [...workspaces], targets: new Map(),
            refs: new Map(), confirmedRefs: new Map(), refsReady: true, lists: new Map(), nextRef: 1,
            imagesAllowed: !this.persistence && action.imagesAllowed === true,
            imageSetting: this.persistence ? action.imagesAllowed === true : undefined };
          this.binding = binding;
          try {
            binding.current = this.attach(binding, worker, session);
            this.routing = Promise.resolve(binding.current);
            await channel.request('bind', { armId: this.armId, candidateId: action.candidateId, bindingId: binding.id });
            if (generation !== this.generation || this.binding !== binding) break;
            await channel.request('sessionScope', { bindingId: binding.id, sessionKey: session.sessionId, active: true });
            this.current(binding.current); this.clearCode(); this.publish();
            if (this.persistence) {
              const snapshot = await channel.request('snapshot');
              if (generation !== this.generation || this.binding !== binding) break;
              this.savedBinding = binding;
              const refs = [...binding.refs];
              const saved = await this.save({ version: 1, identity: remoteIdentity(snapshot?.identity),
                access: { ...remotePeer(snapshot?.peer), workspaces: [...workspaces], sessionId: binding.current?.session.sessionId,
                  sessionRefs: refs, ...((binding.imageSetting ?? binding.imagesAllowed) ? { imagesAllowed: true } : {}) } });
              if (this.binding === binding) {
                if (saved) binding.confirmedRefs = new Map(refs);
                binding.imagesAllowed = saved && binding.imageSetting === true;
                binding.imageSetting = undefined;
                if (!saved && this.remembered?.access) this.remembered.access.imagesAllowed = false;
                for (const target of binding.targets.values()) this.imageScope(target);
                this.publish();
              }
            } else binding.confirmedRefs = new Map(binding.refs);
            if (generation !== this.generation || this.binding !== binding) break;
            this.send({ key: 'welcome', title: 'Remote Beta / 远程访问',
              text: `已授权 ${workspaces.length} 个项目 / ${workspaces.length} project(s) authorized\n当前 / Current: ${binding.current
                ? this.label(binding.current) : '未选择 / Not selected'}\n\n${this.help()}` });
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
    const normalized = /^\d+$/.test(ref) ? `s${ref}` : ref.toLowerCase();
    const session = sessions.find(item => item.sessionId === ref || binding.refsReady && binding.confirmedRefs.get(item.sessionId) === normalized);
    if (!session) throw new Error('Session is unavailable or outside the authorized scope');
    return session;
  }
  private describe(binding: Binding, session: RemoteSession) {
    return `${this.handle(binding, session.sessionId)} · ${redactApprovalText(session.name).replace(/[\r\n]/g, ' ').slice(0, 70)}`
      + ` (${this.projectName(session.workspace)})${binding.current?.session.sessionId === session.sessionId ? ' ← 当前 / Current' : ''}`;
  }
  private projectName(workspace: string) {
    const nameOf = (path: string) => this.projects().find(project => project.workspace === path)?.name || this.platform.basename(path) || path;
    const name = nameOf(workspace), peers = this.binding?.workspaces.filter(path => nameOf(path) === name) ?? [];
    let suffix = '';
    if (peers.length > 1) {
      const parts = (path: string) => path.split(/[\\/]+/).filter(Boolean);
      const own = parts(workspace);
      for (let depth = 2; depth <= own.length; depth++) {
        const tail = own.slice(-depth).join('/');
        if (!peers.some(path => path !== workspace && parts(path).slice(-depth).join('/') === tail)) { suffix = ` · ${tail}`; break; }
      }
      if (!suffix) suffix = ` · ${workspace}`;
    }
    const clean = (value: string) => redactApprovalText(value).replace(/[\r\n]/g, ' ');
    return suffix ? `${clean(name).slice(0, 32)}${clean(suffix).slice(0, 105)}` : clean(name).slice(0, 70);
  }
  private async command(binding: Binding, command: Exclude<RemoteCommand, { type: 'message' }>, target?: Target,
    stop?: { target: Target; runId?: string }) {
    let text = '';
    if ('ref' in command && command.type !== 'new' && command.ref && /^(?:s)?[1-9]\d*$/i.test(command.ref) && !binding.refsReady) {
      if (command.type === 'select') { binding.unconfirmed = true; this.publish(); }
      this.send({ key: this.platform.uuid(), title: 'Refresh session handles / 刷新会话编号',
        text: '此连接升级前没有保存编号。请先发送 /sessions 获取新列表；旧编号尚未用于操作。\nThis older connection has no saved handles. Send /sessions before using a short handle.' });
      return;
    }
    switch (command.type) {
      case 'help': text = this.help(); break;
      case 'invalid':
        if (command.selection) { binding.unconfirmed = true; this.publish(); }
        this.send({ key: this.platform.uuid(), title: 'Not accepted / 未接收', text: `未知指令或参数不正确，未发送给模型。 / Unknown command or invalid arguments; nothing was sent to the model.\n\n${this.help()}` });
        return;
      case 'sharing':
        text = `当前输入目标 / Input target: ${binding.current && !binding.unconfirmed ? this.label(binding.current) : '待选择确认 / Select to confirm'}\n\n`
          + ([...binding.targets.values()].map(item => `${this.label(item)}\n/detach ${this.handle(binding, item.session.sessionId)}`).join('\n\n')
            || '没有会话正在回传。 / No sessions are forwarding.')
          + '\n\n退出回传不停止本机任务或删除排队消息。 / Detach does not stop local work or remove queued input.';
        break;
      case 'detach': {
        const selected = command.ref ? binding.targets.get(this.lookup(binding, command.ref).sessionId) : target;
        if (!selected) throw new Error('Choose a forwarding session');
        const label = this.label(selected);
        await this.detach(binding, selected, false);
        text = `已停止回传 / Forwarding stopped: ${label}\n本机任务与已接收队列保留；再次 /session 选择才恢复回传。 / Local work and accepted queues remain. Select again with /session to resume forwarding.`;
        break;
      }
      case 'tasks': {
        const rows = this.available(binding).flatMap(session => {
          if (!session.runtimeId) return [];
          try {
            const worker = this.host.worker(session.runtimeId, session.sessionId);
            const status = remoteWorkerStatus(worker, this.host.queued?.(worker));
            return status.kind === 'idle' ? [] : [{ session, status }];
          } catch { return []; }
        }).sort((a, b) => Number(b.status.attention) - Number(a.status.attention));
        for (const { session } of rows) this.ref(binding, session.sessionId);
        await this.saveSelection(binding); this.assertBinding(binding);
        const language = this.host.language?.() === 'en' ? 'en' : 'zh';
        const overview: RemoteOverview = {
          language, total: rows.length,
          current: binding.current && !binding.unconfirmed ? this.label(binding.current).slice(0, 200) : undefined,
          rows: rows.slice(0, remoteOverviewLimit).map(({ session, status }) => ({
            ref: this.handle(binding, session.sessionId),
            name: redactApprovalText(session.name).replace(/[\r\n]/g, ' ').slice(0, 70) || (language === 'zh' ? '未命名会话' : 'Untitled session'),
            status: status.label.split(' / ')[language === 'en' ? 1 : 0], queue: status.queue, attention: status.attention,
          })),
        };
        this.send({ key: this.platform.uuid(), title: language === 'zh' ? '会话总览' : 'Session overview', text: '', overview });
        return;
      }
      case 'projects':
        await this.host.refresh(); this.assertBinding(binding);
        text = binding.workspaces.map((workspace, index) =>
          `p${index + 1} · ${this.projectName(workspace)} (${this.available(binding).filter(session => session.workspace === workspace).length})\n/sessions p${index + 1}`).join('\n\n');
        break;
      case 'sessions': {
        const key = command.project ?? '';
        const selectedProject = command.project ? binding.workspaces[Number(command.project.slice(1)) - 1] : undefined;
        if (command.project && !selectedProject) throw new Error('Project is outside the authorized scope');
        let list = binding.lists.get(key);
        if (command.page === 1 || !list) {
          await this.host.refresh(); this.assertBinding(binding);
          const sessions = this.available(binding);
          // Assign before filtering; project navigation never changes existing handles.
          const rows = sessions.map(session => ({ ref: this.ref(binding, session.sessionId),
            name: redactApprovalText(session.name), project: `p${binding.workspaces.indexOf(session.workspace) + 1}` }));
          list = { projects: binding.workspaces.map((workspace, index) =>
            ({ ref: `p${index + 1}`, name: this.projectName(workspace) })).filter(project => !command.project || project.ref === command.project),
          sessions: rows.filter(session => !command.project || session.project === command.project) };
          binding.lists.set(key, list);
        }
        binding.refsReady = true;
        if (!await this.saveSelection(binding)) {
          throw new Error('Could not save Remote session handles');
        }
        this.assertBinding(binding);
        text = remoteSessionList(list.projects, list.sessions,
          binding.current ? this.handle(binding, binding.current.session.sessionId) : undefined, command.page, command.project,
          binding.current ? `p${binding.workspaces.indexOf(binding.current.session.workspace) + 1} · ${this.projectName(binding.current.session.workspace)} / ${this.label(binding.current)}` : undefined);
        break;
      }
      case 'select': {
        const revision = binding.selectionRevision;
        await this.host.refresh(); this.assertBinding(binding);
        if (revision !== binding.selectionRevision) throw new Error('Selection was superseded by a forwarding change');
        target = await this.select(binding, this.lookup(binding, command.ref).sessionId, revision);
        text = `已切换后续输入 / Future messages target:\n${this.label(target)}\n已有任务不停止，本机视图与草稿不变。 / Existing tasks, local view and drafts are unchanged.`;
        break;
      }
      case 'new': {
        const revision = binding.selectionRevision;
        const index = command.ref && /^p?[1-9]\d*$/.test(command.ref) ? Number(command.ref.replace(/^p/, '')) - 1 : -1;
        const workspace = command.ref ? binding.workspaces[index] : target?.session.workspace ?? (binding.workspaces.length === 1 ? binding.workspaces[0] : undefined);
        if (!workspace || !binding.workspaces.includes(workspace)) throw new Error('Choose an authorized project with /projects');
        this.makeRoom(binding);
        const worker = await this.host.createSession(workspace);
        this.assertBinding(binding);
        if (revision !== binding.selectionRevision) throw new Error('Creation was superseded by a forwarding change');
        const session = this.host.sessions().find(item => item.sessionId === worker.state?.sessionId && item.workspace === workspace);
        if (!session) throw new Error('New session identity changed');
        binding.current = target = this.attach(binding, worker, session);
        binding.unconfirmed = false;
        if (this.state.stage === 'runtime') this.state.stage = undefined;
        this.publish();
        await this.saveSelection(binding);
        text = `新会话已创建，尚未发送模型请求 / New session created; no model request sent:\n${this.label(target)}`;
        break;
      }
      case 'current':
        text = target && !binding.unconfirmed ? this.describe(binding, this.current(target).session)
          : '目标待确认。请用 /session <s1> 明确选择；当前正文不会发送。 / Target unconfirmed. Select with /session <s1>; prose is not being sent.';
        break;
      case 'status': {
        const session = command.ref ? this.lookup(binding, command.ref) : target?.session;
        if (!session) throw new Error('Select a session first');
        let worker: SessionRuntime | undefined;
        try { if (session.runtimeId) worker = this.host.worker(session.runtimeId, session.sessionId); } catch {}
        if (worker) this.syncDecisions(worker, true);
        const receipts = [...this.receipts.values()].filter(receipt => receipt.target.worker === worker);
        text = this.describe(binding, session) + '\n'
          + (worker ? [
            remoteWorkerStatus(worker, this.host.queued?.(worker)).label,
            `Model: ${worker.state?.model?.id ?? '-'}`,
            `Effort: ${worker.state?.thinkingLevel ?? '-'}`,
            `Permissions: ${worker.permissionPreset ?? '-'}`,
            `Queue: ${remoteWorkerStatus(worker, this.host.queued?.(worker)).queue}`,
            `Remote: receiving ${receipts.filter(item => item.state === 'receiving').length} · queued ${receipts.filter(item => item.state === 'queued').length} · dispatched ${receipts.filter(item => item.state === 'dispatching' || item.state === 'delivered').length} · unknown ${receipts.filter(item => item.state === 'unknown').length}`,
            '排队输入将在后续轮次处理，不修改正在执行的本轮。 / Queued input is for a later turn, not an edit to the active run.',
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
          await this.channel?.request('card', { bindingId: binding.id, key: this.platform.uuid(), title: 'Disconnected / 已断开',
            text: '飞书连接已关闭，本机已接收的队列和任务继续保留。 / Feishu is disconnected. Accepted local queues and tasks remain.' });
        } finally { if (this.binding === binding) await this.disconnect(); }
        return;
      }
    }
    if (this.binding === binding) {
      await this.saveSelection(binding);
      if (this.binding === binding) this.send({ key: this.platform.uuid(), title: 'Remote Beta / 远程访问', text });
    }
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
          const reconnecting = this.state.status === 'degraded' && event.status === 'connected';
          this.state.status = event.status === 'connected' ? 'connected' : 'degraded'; this.publish();
          if (this.state.status === 'connected') {
            this.pump();
            if (reconnecting && this.binding) this.send({ key: 'recovery', title: 'Reconnected / 已重新连接',
              text: `当前 / Current: ${this.binding.current && !this.binding.unconfirmed ? this.label(this.binding.current) : '待选择确认 / Select to confirm'}\n断网前已接收的本机任务与队列保留；离线消息不补跑，漏送回复不保证补发。 / Previously accepted local work remains. Offline input is not replayed; missed replies may not be recovered.` });
          }
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
        for (const [id, expiresAt] of this.processed) if (expiresAt < this.now() && !this.receipts.has(id)) {
          this.processed.delete(id); this.recalledInputs.delete(id);
        }
        if (!binding || event.bindingId !== binding.id || typeof event.id !== 'string' || event.id.length > 200
          || this.processed.has(event.id) || this.inputCount >= 20 || this.processed.size >= 4096) return;
        const keys: string[] = Array.isArray(event.images) ? event.images : [];
        if (this.state.status !== 'connected' || typeof event.text !== 'string' || (!event.text.trim() && !keys.length) || event.text.length > 12000
          || keys.length > 5 || keys.some(key => typeof key !== 'string' || !key || key.length > 200)) return;
        const command = parseRemoteCommand(event.text);
        let imageUnsupported = false;
        const stopTarget = command.type === 'stop' && command.ref
          ? Promise.resolve().then(() => binding.targets.get(this.lookup(binding, command.ref!).sessionId))
          : this.routing;
        const stop = command.type === 'stop' ? stopTarget.then(target => target ? { target, runId: target.runId } : undefined).catch(() => undefined) : undefined;
        this.processed.set(event.id, this.now() + 600000); this.inputCount++;
        void this.queue(binding, async target => {
          if (this.recalledInputs.has(event.id)) return;
          if (command.type !== 'message') {
            if (keys.length) throw new Error('Send commands without images');
            await this.command(binding, command, target, await stop); return;
          }
          const selected = this.current(target);
          if (selected.receipts.size >= 20) throw new Error('Remote receipt limit reached');
          const receipt: InputReceipt = { target: selected, state: 'receiving' };
          this.receipts.set(event.id, receipt);
          const valid = () => this.binding === binding && binding.targets.get(selected.session.sessionId) === selected
            && !receipt.recalled && !this.recalledInputs.has(event.id) && (!keys.length || binding.imagesAllowed === true);
          let images: RemoteImage[] | undefined;
          if (keys.length) {
            if (!binding.imagesAllowed || !this.host.loadImages || !this.channel) throw new Error('Enable images in Desktop Remote first');
            if (!(selected.worker.pendingModel?.model ?? selected.worker.state?.model)?.input?.includes('image')) {
              imageUnsupported = true;
              throw new Error('The selected model does not declare image support');
            }
            images = await this.host.loadImages(this.channel, binding.id, event.id, keys, valid);
            if (!images.length || !valid()) throw new Error('Image input was withdrawn or authorization changed');
          }
          if (!valid()) return;
          await this.host.submit(selected.worker, command.text, queueId => {
            if (!valid()) return;
            receipt.queueId = queueId; receipt.state = 'queued';
            selected.receipts.set(event.id, { queueId, delivered: false });
            void this.reaction(event.id, true, binding, this.channel, 'queued');
          }, images);
        }, command.type === 'select' || command.type === 'new' || command.type === 'invalid' && command.selection === true, command.type === 'detach').catch(() => {
          const receipt = this.receipts.get(event.id);
          if (receipt?.recalled) { this.receipts.delete(event.id); return; }
          if (receipt?.queueId) receipt.state = 'unknown';
          else this.receipts.delete(event.id);
          if (this.binding === binding) this.send({ key: 'receipt', title: receipt?.queueId ? 'Delivery unknown / 派发状态未知' : 'Not accepted / 未接收',
            text: receipt?.queueId
              ? '消息曾被本机接收，执行情况无法确认。请检查 /status 或 Desktop，不要盲目重发。 / Previously accepted; execution is uncertain. Check /status or Desktop before resending.'
              : binding.unconfirmed
                ? '目标待确认，后续正文和图片未发送或缓存。请用 /session <s1> 成功选择会话后重新发送。 / Target unconfirmed. Input was not sent or saved for replay. Select with /session <s1>, then send again.'
                : keys.length && !binding.imagesAllowed
                  ? '尚未授权图片收发。请在 Desktop 的 Remote 中开启；此输入未发送。 / Images are not authorized. Enable them in Desktop Remote; this input was not sent.'
                  : imageUnsupported
                    ? '当前模型未声明支持图片。此输入未发送，请在 Desktop 选择支持图片的模型后重新发送。 / This model does not declare image support. Input was not sent; select an image-capable model in Desktop, then resend.'
                  : '操作未接收。请用 /status 检查阻塞原因，或在 Desktop 检查会话。输入未自动重试。 / Not accepted. Check /status or Desktop. Input was not retried.' });
        }).finally(() => { this.inputCount--; });
        break;
      }
      case 'recalled': {
        const binding = this.binding, receipt = this.receipts.get(event.id);
        if (!binding || event.bindingId !== binding.id || !this.processed.has(event.id)) return;
        this.recalledInputs.add(event.id);
        if (!receipt) return;
        if (receipt.state === 'receiving') { receipt.recalled = true; receipt.state = 'removed'; return; }
        let removed = false;
        if (receipt.state === 'queued' && receipt.queueId) {
          try {
            if (this.host.worker(receipt.target.worker.id, receipt.target.session.sessionId) === receipt.target.worker
              && receipt.target.worker.rpc === receipt.target.rpc) removed = this.host.withdraw?.(receipt.target.worker, receipt.queueId) === true;
          } catch {}
        }
        if (removed) {
          this.receipts.delete(event.id); receipt.target.receipts.delete(event.id);
          void this.reaction(event.id, false);
        } else this.send({ key: 'withdrawal', title: 'Input already dispatched / 输入已进入派发',
          text: `消息撤回不等于任务取消。该输入已开始派发或状态无法确认；未停止任务。 / Recalling a message does not undo dispatched work. Execution may have started; no task was stopped.\n/status ${this.handle(binding, receipt.target.session.sessionId)}` });
        break;
      }
      case 'decisionExpired': this.expireDecision(event.token); break;
      case 'decision': {
        if (!this.binding || event.bindingId !== this.binding.id || this.state.status !== 'connected') return;
        if (event.token === this.probe && event.option === 'Verify / 验证') {
          this.probe = undefined; this.state.approvalReady = true; this.publish(); return;
        }
        const decision = this.decisions.get(event.token);
        if (!decision) return;
        if (decision.expired || decision.expiresAt <= this.now()) { this.expireDecision(event.token); return; }
        try {
          const { worker } = this.current(decision.target);
          const parsed = remoteDecision(decision.request, worker);
          if (worker.pendingUI.get(decision.id) !== decision.request || parsed?.signature !== decision.signature) return;
          const answer = remoteAnswer(decision.request, parsed, event.option, event.form);
          if (!answer) return;
          this.host.respond(worker, answer);
          clearTimeout(decision.timer);
          this.decisions.delete(event.token); this.state.approvalReady = true; this.publish();
          void this.channel?.request('revoke', { token: event.token, status: 'handled' }).catch(() => {});
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
  private async reaction(messageId: string, active: boolean, binding = this.binding, channel = this.channel,
    phase?: 'queued' | 'running' | 'unknown') {
    if (!binding || !channel) return;
    try { await channel.request('reaction', { bindingId: binding.id, messageId, active, ...(phase ? { phase } : {}) }); }
    catch {
      if (this.binding === binding && this.channel === channel) { this.state.stage = 'delivery'; this.publish(); }
    }
  }
  queueEvent(worker: SessionRuntime, queueId: string, event: QueueReceiptEvent) {
    for (const [messageId, receipt] of this.receipts) if (receipt.target.worker === worker && receipt.queueId === queueId) {
      receipt.state = event === 'removed' ? 'removed' : event === 'delivered' ? 'delivered' : event;
      if (event === 'removed') this.receipts.delete(messageId);
      if ((event === 'dispatching' || event === 'delivered' || event === 'unknown')
        && this.binding?.targets.get(receipt.target.session.sessionId) === receipt.target)
        void this.reaction(messageId, true, this.binding, this.channel, event === 'unknown' ? 'unknown' : 'running');
    }
    const target = [...this.binding?.targets.values() ?? []].find(item => item.worker === worker);
    if (!target) return;
    for (const [messageId, receipt] of target.receipts) if (receipt.queueId === queueId) {
      if (event === 'delivered') receipt.delivered = true;
      else if (event === 'removed') { target.receipts.delete(messageId); void this.reaction(messageId, false); }
      break;
    }
  }
  queueFailed(worker: SessionRuntime) {
    const target = [...this.binding?.targets.values() ?? []].find(item => item.worker === worker);
    if (!target) return;
    this.clearReceipts(target, true);
    this.send({ key: this.platform.uuid(), title: `Queue paused / 队列已暂停 · ${this.label(target)}`,
      text: '消息队列已暂停，请在 Desktop 检查后继续。 / The message queue is paused. Review the session in Desktop before continuing.' });
  }
  private clearReceipts(target: Target, all = false) {
    for (const [messageId, receipt] of target.receipts) if (all || receipt.delivered) {
      target.receipts.delete(messageId); void this.reaction(messageId, false);
      if (!all && this.receipts.get(messageId)?.state === 'delivered') this.receipts.delete(messageId);
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
  private expireDecision(token: string) {
    const decision = this.decisions.get(token);
    if (!decision || decision.expired) return;
    decision.expired = true; clearTimeout(decision.timer);
    const binding = this.binding;
    void this.channel?.request('revoke', { token, status: 'expired' }).catch(() => {}).then(() => {
      if (this.binding !== binding || this.decisions.get(token) !== decision) return;
      this.send({ key: decision.key, sessionKey: decision.target.session.sessionId, title: 'Approval expired / 审批卡已过期',
        text: `远程按钮已失效，未批准操作。原请求是否仍待处理以本机状态为准。\nRemote buttons expired; nothing was approved. Check the original request with:\n/status ${this.handle(binding!, decision.target.session.sessionId)}` });
    });
  }
  private syncDecisions(worker: SessionRuntime, refresh = false) {
    const target = [...this.binding?.targets.values() ?? []].find(item => item.worker === worker);
    if (!target || target.worker !== worker) return;
    for (const [token, decision] of this.decisions) if (decision.target === target && (worker.pendingUI.get(decision.id) !== decision.request
      || remoteDecision(decision.request, worker)?.signature !== decision.signature)) {
      clearTimeout(decision.timer); this.decisions.delete(token);
      void this.channel?.request('revoke', { token, status: 'handled' }).catch(() => {});
    }
    for (const [token, decision] of this.decisions) if (decision.target === target) {
      if (decision.expiresAt <= this.now()) this.expireDecision(token);
      if (refresh && decision.expired) {
        clearTimeout(decision.timer); this.decisions.delete(token);
        this.cards.delete(decision.key);
      }
    }
    for (const [id, request] of worker.pendingUI) {
      if (this.decisions.size >= 32 || [...this.decisions.values()].some(item => item.target === target && item.id === id)) continue;
      const parsed = remoteDecision(request, worker);
      if (!parsed) continue;
      const token = this.platform.uuid();
      const key = this.approvalKeys.get(request) ?? token;
      this.approvalKeys.set(request, key);
      const decision: Decision = { target, id, request, signature: parsed.signature, key, expiresAt: this.now() + 600000 };
      decision.timer = setTimeout(() => this.expireDecision(token), 600000); decision.timer.unref?.();
      this.decisions.set(token, decision);
      this.send({ key, sessionKey: target.session.sessionId, title: `${parsed.title} · ${this.label(target)}`,
        text: parsed.text, form: parsed.form, actions: { token, options: parsed.options } });
    }
  }
  runtimeEvent(worker: SessionRuntime, event: RuntimeEvent) {
    const review = event.type === 'desktop_completion_review' ? completionReview(event.review) : undefined;
    const reviewEnded = review && review.sessionId === worker.state?.sessionId && !reviewActive(review);
    const ended = (event.type === 'agent_end' || event.desktopRecoverySettled)
      && !event.desktopRecoveryPending && !event.desktopReviewPending;
    // Receipt ownership outlives forwarding, but settled detached inputs must not
    // pin deduplication entries forever.
    if (ended || reviewEnded || event.type === 'desktop_exit') {
      for (const [id, receipt] of this.receipts) if (receipt.target.worker === worker
        && (event.type === 'desktop_exit' || receipt.state === 'delivered')) this.receipts.delete(id);
    }
    const target = [...this.binding?.targets.values() ?? []].find(item => item.worker === worker);
    if (!target || target.worker !== worker) return;
    try { this.current(target); }
    catch { this.dispose(worker); return; }
    this.syncDecisions(worker);
    if ((event.type === 'agent_end' || event.desktopRecoverySettled)
      && (event.desktopRecoveryPending || event.desktopReviewPending)) return;
    const continuingRun = event.type === 'agent_start'
      && (event.desktopReviewContinuation || event.desktopRecoveryContinuation) && target.runId;
    if (!continuingRun) target.progress.update(event);
    if (event.type === 'agent_start' && !continuingRun) {
      target.runId = this.platform.uuid(); target.imageActive = true; this.imageScope(target);
      target.projection = ''; target.truncated = false; this.project(target, 'working');
    }
    if (event.type === 'message_update' && target.runId) {
      const delta = event.assistantMessageEvent;
      if (delta?.type === 'text_delta' && typeof delta.delta === 'string') {
        target.truncated ||= target.projection.length + delta.delta.length > 5000;
        target.projection = (target.projection + delta.delta).slice(-12000);
        if (!target.timer) target.timer = setTimeout(() => {
          target.timer = undefined; this.project(target, 'working');
        }, 1000);
        target.timer.unref?.();
      }
    }
    if (event.type === 'message_end' && target.runId) {
      const text = assistantText(event.message);
      if (text) { target.projection = text.slice(-12000); target.truncated ||= text.length > 5000; }
    }
    if (target.runId && ['tool_execution_start', 'tool_execution_end'].includes(event.type) && !target.timer) {
      target.timer = setTimeout(() => { target.timer = undefined; this.project(target, 'working'); }, 1000);
      target.timer.unref?.();
    }
    if (ended || reviewEnded) {
      target.imageActive = false;
      this.imageScope(target, false);
      this.clearReceipts(target, worker.failed || worker.interrupted || taskOutcome(worker.messages) === 'interrupted');
    }
    if (event.type === 'desktop_task_completed' && target.runId) this.finish(target, 'completed');
    if (ended && (worker.failed || worker.interrupted || taskOutcome(worker.messages) === 'interrupted')
      || reviewEnded && ['failed', 'cancelled'].includes(review.status))
      this.finish(target, 'interrupted');
    if (event.type === 'desktop_exit') this.dispose(worker);
  }
  private project(target: Target, reply: ReplyStatus) {
    if (target.runId) this.send({ key: target.runId, sessionKey: target.session.sessionId,
      title: this.label(target), text: target.projection, reply, progress: target.progress.summary(reply !== 'working'), truncated: target.truncated });
  }
  private imageScope(target: Target, active = this.binding?.imagesAllowed === true && target.imageActive === true) {
    const binding = this.binding;
    if (!binding || !target.runId) return;
    void this.channel?.request('imageScope', { bindingId: binding.id, sessionKey: target.session.sessionId,
      runId: target.runId, active }).catch(() => {
      if (this.binding === binding) { this.state.stage = 'delivery'; this.publish(); }
    });
  }
  private finish(target: Target, reply: Exclude<ReplyStatus, 'working'>) {
    clearTimeout(target.timer); target.timer = undefined;
    target.imageActive = false;
    this.imageScope(target, false);
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
    void this.channel?.request('sessionScope', { bindingId: binding.id, sessionKey: target.session.sessionId, active: false }).catch(() => {});
    for (const [token, decision] of this.decisions) if (decision.target === target) {
      clearTimeout(decision.timer); this.decisions.delete(token); void this.channel?.request('revoke', { token, status: 'unavailable' }).catch(() => {});
    }
    if (binding.current === target) { binding.current = undefined; this.routing = Promise.resolve(undefined); }
    this.state.stage = 'runtime'; this.publish();
    void this.saveSelection(binding);
  }
}
