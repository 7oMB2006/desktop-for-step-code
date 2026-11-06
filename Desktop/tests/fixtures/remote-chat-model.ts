import { RemoteManager, type RemoteChannel, type RemoteHost } from '../../electron/remote-manager-core';
import type { SessionRuntime } from '../../electron/session-runtimes';
import type { RemoteCardButton, RemoteCardValue } from '../../electron/remote-card.mjs';
import type { RuntimeEvent, UIRequest } from '../../src/contracts';
import type { RemoteImage, RemoteSession, RemoteSnapshot } from '../../src/remote';
import type { RemoteListSession } from '../../src/remote-session-list';
import { submitAnswer, remoteFormAnswers, type RemoteFormField } from '../../electron/remote-form.mjs';
import { QUESTION_TITLE } from '../../src/questionnaire';

export const scenes = [
  { id: 'reply', name: '正常回复', prompt: '帮我看看会话切换的边界，整理成一份清单。' },
  { id: 'sessions', name: '项目与会话', prompt: '/session' },
  { id: 'approval', name: '工具审批', prompt: '运行一下测试，确认这次修改没问题。' },
  { id: 'interrupted', name: '中途停止', prompt: '先检查一下远程会话的消息路由。' },
  { id: 'pairing', name: '验证码匹配', prompt: '12345678' },
  { id: 'empty', name: '无文字结果', prompt: '执行这项任务，不需要文字回复。' },
  { id: 'tasks', name: '任务与撤回', prompt: '/tasks' },
  { id: 'images', name: '图片收发', prompt: '查看这张模拟图片，并回传测试图片。' },
  { id: 'questions', name: '提问与回答', prompt: '开始之前，先问我希望采用哪种验证方式。' },
  { id: 'plan', name: '计划审阅', prompt: '先制定计划，等我确认后再实施。' },
  { id: 'markdown', name: 'Markdown 格式', prompt: '看看当前目录有什么，按表格和分类清单整理。' },
] as const;
export type Scene = typeof scenes[number]['id'];
type DecisionStatus = 'handled' | 'expired' | 'unavailable';
interface PreviewCardValue extends RemoteCardValue { progress?: string; truncated?: boolean; status?: DecisionStatus }
export const simulatedImage: Readonly<RemoteImage> = {
  type: 'image', mimeType: 'image/png',
  data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=',
};
export interface ChatMessage {
  id: number; role: 'user' | 'bot'; text: string; reaction?: 'typing' | 'ok';
  card?: PreviewCardValue; actions?: RemoteCardButton[]; recalled?: boolean;
  image?: RemoteImage; imageSession?: string;
  approval?: 'pending' | 'allowed' | 'denied' | 'expired'; token?: string; key?: string;
}
export interface PreviewJob {
  input: number; queueId: string; session: string; scene: Scene; elapsed: number; approved?: boolean;
}
interface Job extends PreviewJob { emitted: string; approvalId?: string; toolPhase?: number; imageSent?: boolean; callId?: string }
interface Resident { worker: SessionRuntime; active?: Job; queue: Job[] }
export interface ChatState {
  messages: ChatMessage[]; events: string[]; jobs: PreviewJob[]; queue: PreviewJob[];
  sessions: RemoteListSession[]; session?: string; connected: boolean;
  awaitingConfirmation: boolean; ready: boolean; remoteStatus: RemoteSnapshot['status']; error?: string;
  imagesAllowed: boolean; sharing: string[];
}
export const projects = [
  { ref: 'p1', name: 'Desktop for Step Code', workspace: '/preview/desktop' },
  { ref: 'p2', name: '文档站', workspace: '/preview/docs' },
  { ref: 'p3', name: '插件实验室', workspace: '/preview/plugins' },
  { ref: 'p4', name: '空白项目', workspace: '/preview/empty' },
];
const sampleSessions: RemoteListSession[] = [
  { ref: 's1', name: '远程访问', project: 'p1' },
  { ref: 's2', name: '发布准备', project: 'p1' },
  { ref: 's3', name: '安装与升级说明', project: 'p2' },
  { ref: 's4', name: '指令参考', project: 'p2' },
  { ref: 's5', name: '主题兼容检查', project: 'p3' },
];
export const sessionLabel = (id: string | undefined, sessions = sampleSessions) =>
  id ? `${id} · ${sessions.find(session => session.ref === id)?.name ?? '新会话'}` : '未选择会话';
export const sampleAnswer = [
  '这几个边界已经整理好了：', '',
  '1. **切换会话**只影响后续消息，正在运行的任务仍属于原会话。',
  '2. **本机草稿**保持不变，不会被远端输入覆盖。',
  '3. **停止与审批**跟随原来的任务，不会误操作新一轮。', '',
  '可以先在一个会话里发起任务，再切换到另一个会话检查。', '',
  '```text', '/session s2', '/status s1', '```',
].join('\n');
export const markdownAnswer = [
  '当前目录 `D:\\阶跃测试` 的内容如下：', '', '### 目录（3 个）', '',
  '| 目录 | 内容 |', '| --- | --- |', '| `.stepcode/` | StepCode 配置与状态 |',
  '| `2026-10-07-Step5/` | `index.html`、`README.md` |',
  '| `emergence-site/` | `app.js`、`index.html`、`styles.css` |', '',
  '### 文件', '', '- **调研/报告类**：`阶段报告.md`、`morning-brief.md`',
  '- **网页/脚本**：`notes.html`、`timer.html`', '', '```powershell', 'Get-ChildItem -LiteralPath .', '```',
].join('\n');
const approvalAnswer = '我先运行测试，确认结果。\n\n测试已经完成，**全部通过**。\n\n修改保持在当前分支，还没有打包或发布。';
interface OutgoingCard extends PreviewCardValue {
  bindingId: string; key: string; sessionKey?: string; actions?: { token: string; options: string[] };
}

/** Only the Feishu transport/gate is fake; no slash parsing or task routing lives here. */
class PreviewChannel implements RemoteChannel {
  private closed = false;
  private binding?: string;
  private arm?: { armId: string; code: string; expiresAt: number };
  private candidate?: string;
  private scopes = new Map<string, { active: boolean }>();
  private inputs = new Map<number, string[]>();
  private tokens = new Map<string, { options: string[]; expiresAt: number; sessionKey?: string; scope?: object; form?: RemoteFormField[] }>();
  constructor(private receive: (event: RuntimeEvent) => void, private preview: RemoteChatPreview) {}
  async request(type: string, args: Record<string, any> = {}) {
    if (this.closed) throw new Error('Preview channel closed');
    if (type === 'connect') {
      this.receive({ type: 'remote_channel', kind: 'connected', botName: 'Desktop for Step Code' });
    } else if (type === 'arm') {
      this.arm = { armId: args.armId, code: args.code, expiresAt: args.expiresAt };
      this.candidate = undefined;
    } else if (type === 'bind') {
      if (!this.arm || this.arm.armId !== args.armId || this.arm.expiresAt <= this.preview.now()
        || this.candidate !== args.candidateId) throw new Error('Preview binding expired');
      this.binding = args.bindingId; this.arm = undefined; this.candidate = undefined;
    } else if (type === 'imageScope') {
      this.requireBinding(args.bindingId);
      if (!this.scopes.get(args.sessionKey)?.active || typeof args.runId !== 'string' || typeof args.active !== 'boolean')
        throw new Error('Invalid preview image scope');
    } else if (type === 'sessionScope') {
      this.requireBinding(args.bindingId);
      if (typeof args.sessionKey !== 'string' || typeof args.active !== 'boolean') throw new Error('Invalid preview scope');
      if (this.scopes.get(args.sessionKey)?.active === args.active) return;
      this.scopes.set(args.sessionKey, { active: args.active });
      for (const [token, decision] of this.tokens) if (decision.sessionKey === args.sessionKey) {
        this.tokens.delete(token); this.preview.revoke(token, 'unavailable');
      }
    } else if (type === 'card') {
      this.requireBinding(args.bindingId, args.sessionKey);
      if (args.actions) this.tokens.set(args.actions.token,
        { options: args.actions.options, form: args.form, expiresAt: this.preview.now() + 600000,
          sessionKey: args.sessionKey, scope: this.scopes.get(args.sessionKey) });
      this.preview.present(args as OutgoingCard);
    } else if (type === 'reaction') {
      if (!this.binding || args.bindingId !== this.binding) throw new Error('Preview reaction is not authorized');
      this.preview.react(args.messageId, args.active);
    } else if (type === 'revoke') {
      this.tokens.delete(args.token); this.preview.revoke(args.token, args.status ?? 'handled');
    } else if (type === 'unbind' || type === 'disarm') {
      this.binding = undefined; this.arm = undefined; this.candidate = undefined;
      for (const token of this.tokens.keys()) this.preview.revoke(token);
      this.tokens.clear(); this.scopes.clear(); this.inputs.clear();
    } else throw new Error(`Unsupported preview channel operation: ${type}`);
  }
  private requireBinding(bindingId: string, sessionKey?: string) {
    if (!this.binding || bindingId !== this.binding || sessionKey !== undefined && !this.scopes.get(sessionKey)?.active)
      throw new Error('Preview chat or session is not authorized');
  }
  deliver(id: number, text: string, images: string[] = []) {
    if (this.closed) return;
    if (!this.binding) {
      if (!this.arm || this.arm.expiresAt <= this.preview.now() || this.candidate || text !== this.arm.code) return;
      this.candidate = 'preview-private-chat';
      this.preview.codeMatched(id);
      this.receive({ type: 'remote_channel', kind: 'candidate', armId: this.arm.armId, candidateId: this.candidate });
      return;
    }
    this.inputs.set(id, [...images]);
    this.receive({ type: 'remote_channel', kind: 'input', bindingId: this.binding, id: String(id), text,
      ...(images.length ? { images } : {}) });
  }
  recall(id: number) {
    if (this.closed || !this.binding || !this.inputs.has(id)) return;
    this.inputs.delete(id);
    this.receive({ type: 'remote_channel', kind: 'recalled', bindingId: this.binding, id: String(id) });
  }
  loadImages(bindingId: string, messageId: string, keys: string[], valid: () => boolean): RemoteImage[] {
    this.requireBinding(bindingId);
    const source = this.inputs.get(Number(messageId));
    if (!valid() || !source || keys.some(key => key !== 'simulated-png' || !source.includes(key)))
      throw new Error('Simulated image input is unavailable');
    return keys.map(() => ({ ...simulatedImage }));
  }
  sendImage(bindingId: string, sessionKey: string, image: RemoteImage, valid: () => boolean) {
    this.requireBinding(bindingId, sessionKey);
    if (!valid() || image.mimeType !== simulatedImage.mimeType || image.data !== simulatedImage.data)
      throw new Error('Simulated image output is unavailable');
    return { messageId: this.preview.presentImage(sessionKey, image) };
  }
  expire() {
    for (const [token, decision] of this.tokens) if (decision.expiresAt <= this.preview.now()) {
      this.tokens.delete(token); this.preview.revoke(token, 'expired');
      if (this.binding) this.receive({ type: 'remote_channel', kind: 'decisionExpired', bindingId: this.binding, token });
    }
  }
  callback(token: string, option: string, form?: Record<string, unknown>) {
    const decision = this.tokens.get(token);
    this.expire();
    if (this.closed || !this.binding || !decision || decision.expiresAt <= this.preview.now()
      || decision.sessionKey !== undefined && this.scopes.get(decision.sessionKey) !== decision.scope
      || !decision.options.includes(option)) return;
    if (decision.form && option === submitAnswer && !remoteFormAnswers(decision.form, form))
      throw new Error('请完整作答；自行填写时请选择对应选项。');
    this.tokens.delete(token);
    this.preview.revoke(token, 'handled');
    this.receive({ type: 'remote_channel', kind: 'decision', bindingId: this.binding, token, option, form });
  }
  async stop() {
    this.closed = true; this.binding = undefined; this.arm = undefined; this.candidate = undefined;
    for (const token of this.tokens.keys()) this.preview.revoke(token);
    this.tokens.clear(); this.scopes.clear(); this.inputs.clear();
  }
}

/** A fake Desktop host drives real RemoteManager commands, receipts and approval capabilities. */
export class RemoteChatPreview {
  private manager: RemoteManager;
  private channel?: PreviewChannel;
  private residents = new Map<string, Resident>();
  private catalog: RemoteSession[] = sampleSessions.map(session => {
    const project = projects.find(project => project.ref === session.project)!;
    return { sessionId: session.ref, name: session.name, workspace: project.workspace, workspaceName: project.name };
  });
  private listeners = new Set<(state: ChatState) => void>();
  private messages: ChatMessage[];
  private events: string[] = [];
  private value!: ChatState;
  private sequence = 0;
  private messageId = 3;
  private clock = Date.UTC(2026, 10, 6, 12);
  private ready = false;
  private disposed = false;
  private bootstrapping = true;
  private accepting?: Job;
  private error?: string;
  readonly inputs: { session: string; text: string; queueId: string; images?: RemoteImage[] }[] = [];
  readonly imageLoads: { messageId: string; keys: string[] }[] = [];
  readonly starts: { session: string; input: number }[] = [];
  readonly answers: { session: string; id: string; allowed: boolean; value?: unknown; cancelled?: boolean }[] = [];
  readonly toolEvents: RuntimeEvent[] = [];
  constructor(readonly scene: Scene = 'reply') {
    this.messages = scene === 'pairing' ? [] : [
      { id: 1, role: 'user', text: '你好，能收到我消息吗？' },
      { id: 2, role: 'bot', text: '可以，我在。\n\n我们继续刚才的任务，还是换个方向？',
        card: { title: sessionLabel('s1'), reply: 'completed', text: '可以，我在。\n\n我们继续刚才的任务，还是换个方向？' } },
    ];
    const host: RemoteHost = {
      sessions: () => this.catalog.map(session => ({ ...session, runtimeId: this.residents.get(session.sessionId)?.worker.id })),
      projects: () => projects.map(({ workspace, name }) => ({ workspace, name })),
      refresh: async () => {},
      validateWorkspaces: async workspaces => {
        if (workspaces.some(workspace => !projects.some(project => project.workspace === workspace))) throw new Error('Unknown preview project');
      },
      prepare: async sessionId => this.prepare(sessionId).worker,
      createSession: async workspace => {
        const project = projects.find(project => project.workspace === workspace);
        if (!project) throw new Error('Unknown preview project');
        const sessionId = `s${this.catalog.length + 1}`;
        this.catalog.push({ sessionId, workspace, workspaceName: project.name, name: '新会话' });
        return this.prepare(sessionId).worker;
      },
      worker: (runtimeId, sessionId) => {
        const worker = this.residents.get(sessionId)?.worker;
        if (!worker || worker.id !== runtimeId) throw new Error('Preview runtime identity changed');
        return worker;
      },
      submit: async (worker, text, accepted, images) => {
        if (worker.pendingUI.size || worker.failed || worker.interrupted || worker.stopping)
          throw new Error('Review the session on Desktop before sending');
        const resident = this.residents.get(worker.state!.sessionId!)!;
        const job: Job = { input: 0, queueId: this.uuid(), session: worker.state!.sessionId!, elapsed: 0, emitted: '',
          scene: this.scene === 'pairing' || this.scene === 'sessions' ? 'reply'
            : this.scene === 'tasks' && worker.state!.sessionId === 's2' ? 'approval' : this.scene };
        resident.queue.push(job); this.queueState(resident);
        this.inputs.push({ session: job.session, text, queueId: job.queueId, ...(images ? { images } : {}) });
        // The core emits the original-message reaction inside its acceptance callback.
        this.accepting = job;
        try { accepted(job.queueId); } finally { this.accepting = undefined; }
        this.drain(resident);
      },
      withdraw: (worker, queueId) => {
        const resident = this.residents.get(worker.state!.sessionId!)!;
        const index = resident.queue.findIndex(job => job.queueId === queueId);
        if (index < 0) return false;
        resident.queue.splice(index, 1); this.queueState(resident);
        this.manager.queueEvent(worker, queueId, 'removed');
        this.log('仅撤回对应的排队输入，当前任务继续');
        return true;
      },
      loadImages: async (channel, bindingId, messageId, keys, valid) => {
        this.imageLoads.push({ messageId, keys: [...keys] });
        return (channel as PreviewChannel).loadImages(bindingId, messageId, keys, valid);
      },
      sendImage: async (channel, bindingId, sessionId, worker, path, valid) => {
        // This exact synthetic file is backed only by fixture bytes, never the real filesystem.
        if (path !== `${worker.cwd}/simulated.png`) throw new Error('Only the simulated workspace image is available');
        return (channel as PreviewChannel).sendImage(bindingId, sessionId, { ...simulatedImage }, valid);
      },
      stop: async worker => {
        const resident = this.residents.get(worker.state!.sessionId!)!;
        if (resident.active) this.end(resident, true);
      },
      respond: (worker, answer) => {
        const id = String(answer.id), resident = this.residents.get(worker.state!.sessionId!)!;
        const job = resident.active;
        const request = worker.pendingUI.get(id);
        if (!request || !job || job.approvalId !== id) throw new Error('Preview request expired');
        worker.pendingUI.delete(id);
        job.approved = job.scene === 'plan' ? answer.value === 'Approve plan'
          : answer.confirmed === true || answer.value !== undefined;
        job.elapsed = 1800;
        this.answers.push({ session: job.session, id, allowed: job.approved,
          ...(answer.value !== undefined ? { value: answer.value } : {}), ...(answer.cancelled ? { cancelled: true } : {}) });
        this.manager.runtimeEvent(worker, { type: 'desktop_ui_expired' });
        if (job.scene === 'questions' && request.method === 'confirm' && answer.confirmed === true) {
          job.approved = false; this.askQuestion(resident); return;
        }
        if (job.scene === 'plan' && answer.value === 'Request refinements') {
          this.dialog(resident, { method: 'input', title: 'Desktop Plan refinements' }); return;
        }
        if (job.scene === 'plan') {
          if (request.method === 'input' && typeof answer.value === 'string') {
            this.log('已提交修改意见 · 仍在规划，等待再次审阅');
            this.reviewPlan(resident, answer.value); return;
          }
          this.log(job.approved ? '已批准计划 · 可以开始实施' : '保留规划模式 · 未批准实施');
          if (!job.approved) this.end(resident, false, '继续保留规划模式，计划尚未批准，也未开始实施。');
          return;
        }
        this.log(job.scene === 'questions' ? job.approved ? '已提交答案 · 不是工具授权' : '已取消提问或回答'
          : job.approved ? '允许一次 · 原始审批已结算' : '拒绝 · 原始审批已结算');
        if (!job.approved) this.end(resident, true);
      },
      open: async () => { throw new Error('External navigation is disabled in the preview'); },
    };
    this.manager = new RemoteManager(host, receive => this.channel = new PreviewChannel(receive, this),
      () => this.publish(), () => this.now(), undefined,
      { uuid: () => this.uuid(), bindingCode: () => '12345678', basename: path => path.split(/[\\/]/).filter(Boolean).at(-1) ?? path });
    this.publish();
  }
  static async create(scene: Scene = 'reply') {
    const preview = new RemoteChatPreview(scene);
    try { await preview.start(); return preview; }
    catch (error) { await preview.dispose(); throw error; }
  }
  now() { return this.clock; }
  private uuid() { return `00000000-0000-4000-8000-${String(++this.sequence).padStart(12, '0')}`; }
  snapshot() { return this.value; }
  subscribe(listener: (state: ChatState) => void) {
    this.listeners.add(listener); listener(this.value);
    return () => { this.listeners.delete(listener); };
  }
  async start() {
    try {
      await this.manager.action({ type: 'connect' });
      if (this.disposed) return;
      await this.manager.action({ type: 'armBinding' });
      if (this.disposed) return;
      if (this.scene !== 'pairing') {
        this.channel!.deliver(0, '12345678');
        await this.confirm();
      }
      this.bootstrapping = false; this.ready = true; this.publish();
      if (this.scene === 'sessions' && !this.disposed) await this.send('/session');
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error);
      this.publish(); throw error;
    }
  }
  private publish() {
    if (!this.manager) return;
    const remote = this.manager.snapshot();
    const jobs = [...this.residents.values()].flatMap(resident => resident.active ? [{ ...resident.active }] : []);
    this.value = {
      messages: this.messages, events: this.events, jobs,
      queue: [...this.residents.values()].flatMap(resident => resident.queue.map(job => ({ ...job }))),
      sessions: this.catalog.map(session => ({ ref: session.sessionId, name: session.name,
        project: projects.find(project => project.workspace === session.workspace)!.ref })),
      session: remote.binding?.sessionId, connected: remote.status === 'connected' && Boolean(remote.authorized),
      awaitingConfirmation: Boolean(remote.candidate && !remote.authorized), ready: this.ready,
      remoteStatus: remote.status, error: this.error,
      imagesAllowed: remote.imagesAllowed === true, sharing: remote.sharing?.map(session => session.sessionId) ?? [],
    };
    if (!this.disposed) for (const listener of this.listeners) listener(this.value);
  }
  private log(text: string) {
    if (this.bootstrapping) return;
    this.events = [...this.events, text].slice(-12);
  }
  present(card: OutgoingCard) {
    if (this.bootstrapping) return;
    const previous = this.messages.find(message => message.key === card.key);
    const actions: RemoteCardButton[] = card.actions?.options.map(option => ({
      tag: 'button', text: { tag: 'plain_text', content: option }, value: { token: card.actions!.token, option },
    })) ?? [];
    const message: ChatMessage = {
      id: previous?.id ?? this.messageId++, key: card.key, role: 'bot', text: card.text,
      card: { title: card.title, text: card.text, ...(card.reply ? { reply: card.reply } : {}),
        progress: card.progress, truncated: card.truncated, overview: card.overview, form: card.form,
        ...(!actions.length && previous?.card?.status ? { status: previous.card.status } : {}) },
      ...(actions.length ? { actions, token: card.actions!.token,
        approval: previous?.token === card.actions!.token ? previous.approval ?? 'pending' : 'pending' }
        : previous?.token ? { token: previous.token, approval: previous.approval === 'pending' ? 'expired' : previous.approval } : {}),
    };
    this.messages = previous ? this.messages.map(item => item.id === previous.id ? message : item) : [...this.messages, message];
    this.publish();
  }
  react(messageId: string, active: boolean) {
    const id = Number(messageId);
    if (active && this.accepting) this.accepting.input = id;
    this.messages = this.messages.map(message => message.id === id ? { ...message, reaction: active ? 'typing' : undefined } : message);
    this.log(active ? `${sessionLabel(this.accepting?.session)} · 接受消息，添加处理反应` : '移除原始消息的处理反应');
    this.publish();
  }
  revoke(token: string, status: DecisionStatus = 'unavailable') {
    this.messages = this.messages.map(message => message.token === token && message.approval === 'pending'
      ? { ...message, approval: 'expired', actions: undefined, card: message.card && { ...message.card, status } } : message);
    this.publish();
  }
  presentImage(session: string, image: RemoteImage) {
    const id = this.messageId++;
    this.messages = [...this.messages, { id, role: 'bot', text: '', image: { ...image }, imageSession: session }];
    this.log(`${sessionLabel(session)} · 模拟图片字节已回传，非任务完成信号`);
    this.publish();
    return String(id);
  }
  codeMatched(id: number) {
    this.messages = this.messages.map(message => message.id === id ? { ...message, reaction: 'ok' } : message);
    this.log('验证码已匹配 · 等待本机确认，尚未授予会话访问权限');
    this.publish();
  }
  // Fake host/channel operations have no I/O; drain the real core's asynchronous routing and card pumps.
  private async flush() {
    for (let turn = 0; turn < 128; turn++) await Promise.resolve();
    this.publish();
  }
  async send(text: string) {
    text = text.trim();
    if (this.disposed || !this.ready || !text || text.length > 12000) return;
    const id = this.messageId++;
    this.messages = [...this.messages, { id, role: 'user', text }];
    this.channel?.deliver(id, text);
    await this.flush();
  }
  async setImagesAllowed(allowed: boolean) {
    await this.manager.action({ type: 'images', allowed });
    await this.flush();
  }
  async sendImageInput(text: string = scenes.find(scene => scene.id === 'images')!.prompt) {
    if (this.disposed || !this.ready) return;
    const id = this.messageId++;
    this.messages = [...this.messages, { id, role: 'user', text, image: { ...simulatedImage } }];
    this.channel?.deliver(id, text, ['simulated-png']);
    await this.flush();
  }
  async sendImage(sessionId = this.manager.snapshot().binding?.sessionId) {
    const resident = sessionId && this.residents.get(sessionId);
    if (!resident) throw new Error('No simulated runtime selected');
    const result = await this.manager.deliverImage(resident.worker, `${resident.worker.cwd}/simulated.png`);
    await this.flush();
    return result;
  }
  async recall(id: number) {
    const message = this.messages.find(message => message.id === id);
    if (this.disposed || !message || message.role !== 'user' || message.recalled) return;
    this.messages = this.messages.map(message => message.id === id ? { ...message, recalled: true } : message);
    this.channel?.recall(id);
    await this.flush();
  }
  async demo() {
    if (this.scene === 'images') { await this.sendImageInput(); return; }
    if (this.scene !== 'tasks') { await this.send(scenes.find(scene => scene.id === this.scene)!.prompt); return; }
    await this.send('检查会话路由');
    await this.send('补充核对队列');
    await this.send('/session s2');
    await this.send('运行测试，等待审批');
    await this.advance(1500);
    await this.send('/tasks');
  }
  async confirm() {
    if (this.disposed) return;
    const candidate = this.manager.snapshot().candidate;
    if (!candidate) return;
    await this.manager.action({ type: 'bind', candidateId: candidate.id, sessionId: 's1',
      workspaces: projects.map(project => project.workspace) });
    this.log('本机确认私聊与项目授权');
    await this.flush();
    // Prime handles through the real list command, without adding setup cards to the scene.
    const bootstrapping = this.bootstrapping;
    this.bootstrapping = true;
    try { this.channel!.deliver(0, '/sessions'); await this.flush(); }
    finally { this.bootstrapping = bootstrapping; }
    this.publish();
  }
  async decide(id: number, allow: boolean) {
    const message = this.messages.find(message => message.id === id);
    const option = message?.actions?.[allow ? 0 : 1]?.value.option;
    if (option) await this.choose(id, option);
  }
  async choose(id: number, option: string, form?: Record<string, unknown>) {
    if (this.disposed) return;
    const message = this.messages.find(message => message.id === id);
    const action = message?.actions?.find(action => action.value.option === option);
    if (!action) return;
    const count = this.answers.length;
    this.channel?.callback(action.value.token, action.value.option, form);
    if (this.answers.length > count) this.messages = this.messages.map(message => message.id === id
      ? { ...message, approval: this.answers.at(-1)?.allowed ? 'allowed' : 'denied' } : message);
    await this.flush();
  }
  private prepare(sessionId: string) {
    let resident = this.residents.get(sessionId);
    if (resident) return resident;
    const session = this.catalog.find(session => session.sessionId === sessionId);
    if (!session) throw new Error('Unknown preview session');
    const worker = {
      id: `preview-runtime-${sessionId}`, cwd: session.workspace, status: 'connected',
      state: { sessionId, sessionName: session.name, isStreaming: false, pendingMessageCount: 0,
        model: { id: 'preview-model', name: 'Preview model', provider: 'preview',
          input: this.scene === 'images' ? ['text', 'image'] : ['text'] }, thinkingLevel: 'high' },
      busy: false, submissions: 0, operations: 0, pendingUI: new Map(), messages: [], rpc: {},
      failed: false, interrupted: false, runActive: false, permissionPreset: 'ask',
    } as unknown as SessionRuntime;
    resident = { worker, queue: [] }; this.residents.set(sessionId, resident);
    return resident;
  }
  private queueState(resident: Resident) {
    resident.worker.queued = resident.queue.length > 0;
    resident.worker.state!.pendingMessageCount = resident.queue.length;
  }
  private drain(resident: Resident) {
    if (resident.active || resident.worker.pendingUI.size || resident.worker.interrupted || !resident.queue.length) return;
    const job = resident.active = resident.queue.shift()!;
    this.queueState(resident);
    resident.worker.busy = true; resident.worker.runActive = true; resident.worker.state!.isStreaming = true;
    this.starts.push({ session: job.session, input: job.input });
    this.manager.queueEvent(resident.worker, job.queueId, 'dispatching');
    this.manager.queueEvent(resident.worker, job.queueId, 'delivered');
    this.manager.runtimeEvent(resident.worker, { type: 'agent_start' });
    this.log(`${sessionLabel(job.session)} · 开始处理消息`);
  }
  private text(resident: Resident, value: string) {
    const job = resident.active!;
    if (value.length < job.emitted.length) return;
    const delta = value.slice(job.emitted.length);
    if (delta) this.manager.runtimeEvent(resident.worker,
      { type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta } });
    job.emitted = value;
  }
  private ask(resident: Resident) {
    const job = resident.active!, id = this.uuid(), callId = `call-${id.slice(-8)}`;
    job.callId = callId;
    const name = job.scene === 'questions' ? 'clarify_user' : job.scene === 'plan' ? 'exit_plan_mode' : 'run_command';
    resident.worker.messages.push({ role: 'assistant',
      content: [{ type: 'toolCall', id: callId, name, arguments: name === 'clarify_user'
        ? { question: '希望采用哪种验证方式？', options: [{ label: '只跑单元测试' }, { label: '同时做界面验收' }] }
        : name === 'exit_plan_mode' ? {} : { command: 'pnpm test' } }] });
    if (job.scene === 'plan') {
      this.reviewPlan(resident); return;
    }
    this.dialog(resident, { method: 'confirm', title: `Approve ${name} [${callId.slice(-8)}]`,
      message: `Call: ${callId}\n${name} can modify the workspace or execute a command\n\npnpm test\n\nBatch calls may ask separately\nbefore approved tools begin running.` });
  }
  private reviewPlan(resident: Resident, feedback?: string) {
    this.dialog(resident, { method: 'select',
      title: 'Desktop Plan review\n/preview/desktop/plan.md\n\n1. 检查消息路由。\n2. 修复提问映射。\n3. 运行测试，不提前打包。'
        + (feedback ? `\n4. 按修改意见补充验证：${feedback}` : ''),
      options: ['Approve plan', 'Request refinements', 'Keep planning'] });
  }
  private askQuestion(resident: Resident) {
    this.dialog(resident, { method: 'input', title: QUESTION_TITLE + JSON.stringify({
      version: 1, callId: resident.active!.callId, questions: [
        { id: 'validation', label: '验证范围', question: '希望采用哪种验证方式？', allowFreeform: true,
          options: [{ label: '只跑单元测试', value: 'unit' }, { label: '同时做界面验收', value: 'ui' }] },
        { id: 'notes', label: '补充要求', question: '还有什么需要注意的？', allowFreeform: true, options: [] },
      ],
    }) });
    this.log('允许提问后，等待真实答案；授权本身不代选');
  }
  private dialog(resident: Resident, fields: Pick<UIRequest, 'method' | 'title' | 'options' | 'message'>) {
    const id = this.uuid();
    resident.active!.approvalId = id;
    const request: UIRequest = { type: 'extension_ui_request', runtimeId: resident.worker.id, id, ...fields };
    resident.worker.pendingUI.set(id, request);
    this.manager.runtimeEvent(resident.worker, request);
    this.log(`${sessionLabel(resident.active!.session)} · 等待本次输入`);
  }
  private tool(resident: Resident, type: 'tool_execution_start' | 'tool_execution_end', name: string, id: string, isError = false) {
    const event: RuntimeEvent = { type, toolName: name, toolCallId: id,
      ...(type === 'tool_execution_start' ? { args: { input: 'SIMULATED_PRIVATE_TOOL_INPUT' } }
        : { isError, result: { content: [{ type: 'text', text: 'SIMULATED_PRIVATE_TOOL_OUTPUT' }] } }) };
    this.toolEvents.push(event);
    this.manager.runtimeEvent(resident.worker, event);
  }
  private end(resident: Resident, interrupted = false, finalText?: string) {
    const job = resident.active;
    if (!job) return;
    const text = interrupted ? job.emitted : finalText ?? (job.scene === 'empty' ? '' : job.scene === 'markdown' ? markdownAnswer : job.scene === 'approval' ? approvalAnswer : sampleAnswer);
    resident.worker.pendingUI.clear();
    const message = { role: 'assistant' as const, content: text, ...(interrupted ? { stopReason: 'aborted' } : {}) };
    resident.worker.messages.push(message);
    resident.worker.interrupted = interrupted;
    resident.worker.busy = false; resident.worker.runActive = false; resident.worker.state!.isStreaming = false;
    this.manager.runtimeEvent(resident.worker, { type: 'message_end', message });
    this.manager.runtimeEvent(resident.worker, { type: 'agent_end' });
    if (!interrupted) this.manager.runtimeEvent(resident.worker, { type: 'desktop_task_completed' });
    resident.active = undefined;
    this.log(`${sessionLabel(job.session)} · ${interrupted ? '回复中断' : '回复结束'}`);
    this.drain(resident);
  }
  async advance(ms: number) {
    if (this.disposed || !Number.isFinite(ms) || ms < 0) return;
    this.clock += ms;
    this.channel?.expire();
    for (const resident of this.residents.values()) {
      const job = resident.active;
      if (!job || resident.worker.pendingUI.size) continue;
      job.elapsed += ms;
      if (job.scene === 'tasks') {
        const phase = job.toolPhase ?? 0, id = `preview-tool-${job.queueId}`;
        if (phase < 1 && job.elapsed >= 650) this.tool(resident, 'tool_execution_start', 'read_file', `${id}-read`);
        if (phase < 2 && job.elapsed >= 1600) {
          this.tool(resident, 'tool_execution_end', 'read_file', `${id}-read`);
          this.tool(resident, 'tool_execution_start', 'run_command', `${id}-command`);
        }
        if (phase < 3 && job.elapsed >= 3200) this.tool(resident, 'tool_execution_end', 'run_command', `${id}-command`);
        job.toolPhase = job.elapsed >= 3200 ? 3 : job.elapsed >= 1600 ? 2 : job.elapsed >= 650 ? 1 : 0;
      }
      if (job.scene === 'images' && !job.imageSent && job.elapsed >= 2600) {
        job.imageSent = true;
        this.tool(resident, 'tool_execution_start', 'desktop_send_image', `preview-image-${job.queueId}`);
        let failed = false;
        try { await this.sendImage(job.session); }
        catch { failed = true; this.log('模拟图片回传未获确认，未自动重试'); }
        this.tool(resident, 'tool_execution_end', 'desktop_send_image', `preview-image-${job.queueId}`, failed);
      }
      if (['approval', 'questions', 'plan'].includes(job.scene) && !job.approvalId && job.elapsed >= 1300) {
        this.text(resident, '我先运行测试，确认结果。\n\n'); this.ask(resident); continue;
      }
      const answer = job.scene === 'approval' ? approvalAnswer : job.scene === 'markdown' ? markdownAnswer : sampleAnswer;
      if (job.elapsed >= 650) this.text(resident, job.scene === 'empty' ? ''
        : answer.slice(0, Math.floor(Math.max(0, job.elapsed - 1500) / 6500 * answer.length)));
      if (job.scene === 'interrupted' && job.elapsed >= 5400) this.end(resident, true);
      else if (job.elapsed >= 8500) this.end(resident);
    }
    await this.flush();
  }
  async finish(sessionId = this.manager.snapshot().binding?.sessionId, text?: string) {
    if (this.disposed || !sessionId) return;
    const resident = this.residents.get(sessionId);
    if (resident?.active && !resident.worker.pendingUI.size
      && !(['approval', 'questions', 'plan'].includes(resident.active.scene) && !resident.active.approved)) this.end(resident, false, text);
    await this.flush();
  }
  async dispose() {
    if (this.disposed) return;
    this.disposed = true; this.listeners.clear();
    await this.manager.shutdown();
  }
}
