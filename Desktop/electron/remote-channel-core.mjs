import { randomUUID } from 'node:crypto';
import { remoteCard, validRemoteOverview } from './remote-card.mjs';
import { RemoteMediaChannel, imageKey, mediaHttpInstance } from './remote-media-channel.mjs';
import { submitAnswer, cancelAnswer, validRemoteForm, remoteFormAnswers } from './remote-form.mjs';

const silentLogger = { error() {}, warn() {}, info() {}, debug() {}, trace() {} };
const record = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
const bounded = (value, max = 200) => typeof value === 'string' && value.length > 0 && value.length <= max;
const refreshOption = 'Refresh / 刷新';

function messageContent(message) {
  if (typeof message.content !== 'string' || message.content.length > 64000) throw new Error('Unsupported message');
  const content = record(JSON.parse(message.content));
  if (message.message_type === 'text') {
    if (!bounded(content.text, 12000) || !content.text.trim()) throw new Error('Unsupported message');
    return { text: content.text, images: [] };
  }
  if (message.message_type === 'image') {
    if (!imageKey(content.image_key)) throw new Error('Unsupported image');
    return { text: '', images: [content.image_key] };
  }
  if (message.message_type !== 'post') throw new Error('Unsupported message');
  const body = record(content.zh_cn ?? content.en_us ?? content);
  if (body.title !== undefined && typeof body.title !== 'string' || !Array.isArray(body.content) || body.content.length > 200)
    throw new Error('Unsupported post');
  const lines = body.title ? [body.title] : [], images = [];
  let nodes = 0;
  for (const row of body.content) {
    if (!Array.isArray(row)) throw new Error('Unsupported post');
    let line = '';
    for (const raw of row) {
      if (++nodes > 1000) throw new Error('Unsupported post');
      const node = record(raw);
      if (node.tag === 'text' && typeof node.text === 'string') line += node.text;
      else if (node.tag === 'a' && bounded(node.href, 4096)) line += node.href;
      else if (node.tag === 'img' && imageKey(node.image_key) && images.length < 5) images.push(node.image_key);
      else throw new Error('Unsupported post content');
    }
    lines.push(line);
  }
  const text = lines.join('\n').trim();
  if (text.length > 12000 || !text && !images.length) throw new Error('Unsupported post');
  return { text, images: [...new Set(images)] };
}

/** Feishu SDK boundary, with no agent, profile, filesystem or model credentials. */
export class RemoteConnection {
  constructor(adapter, emit, now = Date.now) {
    this.adapter = adapter; this.emit = emit; this.now = now;
    this.controller = new AbortController();
    this.reactionController = new AbortController();
    this.tokens = new Map(); this.cards = new Map(); this.inputs = new Map(); this.reactions = new Map();
    this.scopes = new Map(); this.imageScopes = new Map();
    this.media = new RemoteMediaChannel(this); this.feedback = new Map();
  }
  event(kind, fields = {}) { if (!this.closed) this.emit({ type: 'remote_channel', kind, ...fields }); }
  async authorize(saved) {
    let stage = 'authorization';
    try {
      const signal = this.controller.signal, a = this.adapter;
      let credentials;
      if (saved) {
        const input = record(saved), value = record(input.credentials);
        if (!bounded(input.botId) || !bounded(value.appId) || !bounded(value.appSecret, 4096)
          || !['feishu', 'lark'].includes(value.brand)) throw new Error('Invalid saved identity');
        credentials = { appId: value.appId, appSecret: value.appSecret, brand: value.brand };
      } else {
        const registration = new a.LarkRegistration({ version: 'desktop-for-step-code' });
        const code = await registration.begin(signal);
        signal.throwIfAborted();
        this.event('authorization', { url: code.verificationUrl, expiresAt: this.now() + code.expiresInSeconds * 1000 });
        const result = await registration.waitForAuthorization(code, signal);
        signal.throwIfAborted();
        if (result.status !== 'authorized') throw new Error('Authorization unavailable');
        credentials = result.credentials;
      }
      this.event('connecting');
      stage = 'identity';
      this.api = new a.LarkApi(credentials);
      const identity = await this.api.getBotIdentity();
      signal.throwIfAborted();
      if (!bounded(identity.openId) || saved && identity.openId !== saved.botId) throw new Error('Bot identity changed');
      this.botId = identity.openId; this.credentials = credentials;
      this.reactionApi = new a.Client({ appId: credentials.appId, appSecret: credentials.appSecret,
        domain: a.LARK_OPEN_HOSTS[credentials.brand], logger: silentLogger, loggerLevel: a.LoggerLevel.error });
      stage = 'transport';
      const dispatcher = new a.EventDispatcher({ logger: silentLogger, loggerLevel: a.LoggerLevel.error }).register({
        'im.message.receive_v1': event => { this.message(event); return {}; },
        'im.message.recalled_v1': event => { this.recalled(event); return {}; },
        'card.action.trigger': event => this.callback(event) ?? {},
      });
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Transport unavailable')), 15000);
        const abort = () => reject(new Error('Transport cancelled'));
        signal.addEventListener('abort', abort, { once: true });
        this.startup = error => {
          clearTimeout(timer); signal.removeEventListener('abort', abort);
          this.startup = undefined;
          error ? reject(error) : resolve();
        };
        const finish = this.startup;
        this.socket = new a.WSClient({
          appId: credentials.appId, appSecret: credentials.appSecret,
          domain: a.LARK_OPEN_HOSTS[credentials.brand], logger: silentLogger, loggerLevel: a.LoggerLevel.error,
          handshakeTimeoutMs: 15000,
          onReady: () => { if (!this.closed) { this.online = true; finish(); } },
          onReconnecting: () => { this.online = false; this.event('health', { status: 'degraded' }); },
          onReconnected: () => {
            if (this.closed) return;
            this.acceptAfter = this.now();
            this.online = true; this.event('health', { status: 'connected' });
            for (const reaction of this.reactions.values()) if (!reaction.wanted) void this.syncReaction(reaction).catch(() => {});
          },
          onError: () => { this.online = false; if (this.startup) finish(new Error('Transport unavailable')); else this.event('health', { status: 'degraded' }); },
        });
        try { void Promise.resolve(this.socket.start({ eventDispatcher: dispatcher })).catch(() => finish(new Error('Transport unavailable'))); }
        catch { finish(new Error('Transport unavailable')); }
      });
      signal.throwIfAborted();
      this.event('connected', { botName: identity.name, callbackUrl: a.larkCallbackSetupUrl(credentials) });
    } catch {
      if (!this.closed) this.event('error', { stage });
      await this.close();
    }
  }
  reset() {
    for (const reaction of this.reactions.values()) {
      reaction.wanted = false; void this.syncReaction(reaction).catch(() => {});
    }
    this.gate?.close(); this.gate = undefined;
    this.arm = undefined; this.candidate = undefined; this.bound = undefined;
    for (const token of this.tokens.values()) clearTimeout(token.timer);
    this.media.reset();
    this.tokens.clear(); this.cards.clear(); this.inputs.clear(); this.scopes.clear(); this.imageScopes.clear();
    this.feedback.clear(); this.feedbackAt = undefined;
  }
  mediaClient(signal) {
    const a = this.adapter, credentials = this.credentials;
    if (!credentials || !this.reactionApi?.httpInstance) throw new Error('Image transport unavailable');
    return new a.Client({ appId: credentials.appId, appSecret: credentials.appSecret,
      domain: a.LARK_OPEN_HOSTS[credentials.brand], logger: silentLogger, loggerLevel: a.LoggerLevel.error,
      httpInstance: mediaHttpInstance(this.reactionApi.httpInstance, signal) });
  }
  captureFence(bindingId, sessionKey, required = false) {
    const binding = this.bound;
    if (this.closed || !binding || bindingId !== binding.id || required && !bounded(sessionKey)
      || sessionKey !== undefined && !bounded(sessionKey)) throw new Error('Invalid binding scope');
    const scope = sessionKey === undefined ? undefined : this.scopes.get(sessionKey);
    if (sessionKey !== undefined && !scope?.active) throw new Error('Session is unavailable');
    return { binding, sessionKey, scope };
  }
  validFence(fence) {
    return !this.closed && this.bound === fence.binding && (fence.sessionKey === undefined
      || this.scopes.get(fence.sessionKey) === fence.scope && fence.scope.active)
      && (!fence.imageScope || this.imageScopes.get(fence.sessionKey) === fence.imageScope && fence.imageScope.active);
  }
  captureImageFence(bindingId, sessionKey) {
    const fence = this.captureFence(bindingId, sessionKey, true), imageScope = this.imageScopes.get(sessionKey);
    if (!imageScope?.active || imageScope.scope !== fence.scope) throw new Error('Image run is unavailable');
    return { ...fence, imageScope };
  }
  command(type, value = {}) {
    if (this.closed) throw new Error('Channel closed');
    if (type === 'connect') {
      if (this.started) throw new Error('Already started');
      this.started = true; void this.authorize(value.identity); return;
    }
    if (type === 'disarm') {
      if (value.armId === this.arm?.id) this.reset(); return;
    }
    if (type === 'unbind') {
      if (value.bindingId && value.bindingId === this.bound?.id || value.armId && value.armId === this.arm?.id) this.reset();
      return;
    }
    if (type === 'revoke') {
      if (!bounded(value.token, 80) || value.status !== undefined && !['handled', 'expired', 'unavailable'].includes(value.status))
        throw new Error('Invalid decision status');
      const token = this.tokens.get(value.token);
      if (token) return this.settleToken(token, value.status ?? 'handled');
      return;
    }
    if (type === 'sessionScope') {
      if (!this.bound || value.bindingId !== this.bound.id || !bounded(value.sessionKey) || typeof value.active !== 'boolean')
        throw new Error('Invalid session scope');
      const previous = this.scopes.get(value.sessionKey);
      if (previous?.active === value.active) return;
      if (!previous && this.scopes.size >= 256) throw new Error('Session scope limit reached');
      if (previous) {
        previous.active = false;
        this.media.detach(previous);
        for (const token of this.tokens.values()) if (token.fence.scope === previous) {
          clearTimeout(token.timer); token.status = 'unavailable';
        }
      }
      const imageScope = this.imageScopes.get(value.sessionKey);
      if (imageScope) { imageScope.active = false; this.media.revokeImages(imageScope); this.imageScopes.delete(value.sessionKey); }
      this.scopes.set(value.sessionKey, { active: value.active });
      return;
    }
    if (type === 'imageScope') {
      if (!this.bound || value.bindingId !== this.bound.id || !bounded(value.sessionKey) || !bounded(value.runId)
        || typeof value.active !== 'boolean') throw new Error('Invalid image scope');
      const scope = this.scopes.get(value.sessionKey), previous = this.imageScopes.get(value.sessionKey);
      if (value.active && !scope?.active) throw new Error('Session is unavailable');
      if (!value.active && previous?.runId !== value.runId) return;
      if (previous?.runId === value.runId && previous.active === value.active && previous.scope === scope) return;
      if (previous) { previous.active = false; this.media.revokeImages(previous); }
      this.imageScopes.set(value.sessionKey, { runId: value.runId, active: value.active, scope });
      return;
    }
    if (type === 'imageClose') return this.media.close(value);
    if (type === 'reaction') {
      const input = this.inputs.get(value.messageId);
      if (!this.bound || value.bindingId !== this.bound.id || input?.binding !== this.bound
        || typeof value.active !== 'boolean' || value.active && (input.done || input.recalled)
        || value.phase !== undefined && !['queued', 'running', 'unknown'].includes(value.phase)) throw new Error('Invalid reaction target');
      if (!value.active) input.done = true;
      let reaction = this.reactions.get(value.messageId);
      if (!reaction && value.active) {
        if (this.reactions.size >= 256) throw new Error('Reaction limit reached');
        reaction = { messageId: value.messageId, wanted: true };
        this.reactions.set(value.messageId, reaction);
      }
      if (reaction) { reaction.wanted = value.active; return this.syncReaction(reaction); }
      return;
    }
    if (!this.online) throw new Error('Transport is not ready');
    // Private main/helper RPC result, never a renderer event or environment value.
    if (type === 'snapshot') return { identity: { credentials: { ...this.credentials }, botId: this.botId },
      peer: this.bound ? { actor: this.bound.actor, chat: this.bound.chat } : undefined };
    if (type === 'bindSaved') {
      const peer = record(value.peer);
      if (this.bound || this.arm || !bounded(value.bindingId, 80) || !bounded(peer.actor) || !bounded(peer.chat)
        || peer.actor === this.botId) throw new Error('Invalid saved binding');
      this.reset();
      this.bound = { id: value.bindingId, actor: peer.actor, chat: peer.chat };
      // Dedup state is intentionally not persisted. Never replay pre-recovery messages.
      this.acceptAfter = this.now();
      return;
    }
    if (type === 'arm') {
      if (this.bound || !bounded(value.armId, 80) || !/^\d{8}$/.test(value.code)
        || !Number.isFinite(value.expiresAt) || value.expiresAt <= this.now() || value.expiresAt > this.now() + 121000)
        throw new Error('Invalid binding challenge');
      this.reset(); this.arm = { id: value.armId, code: value.code, expiresAt: value.expiresAt };
      return;
    }
    if (type === 'bind') {
      if (this.bound || !this.arm || this.arm.expiresAt <= this.now() || this.arm.id !== value.armId
        || this.candidate?.id !== value.candidateId || !bounded(value.bindingId, 80)) throw new Error('Binding challenge expired');
      this.bound = { id: value.bindingId, actor: this.candidate.actor, chat: this.candidate.chat };
      this.arm = undefined; this.candidate = undefined; return;
    }
    if (type === 'card') return this.card(value);
    if (type === 'imageOpen') return this.media.open(value);
    if (type === 'imageChunk') return this.media.chunk(value);
    if (type === 'imageUploadOpen') return this.media.uploadOpen(value);
    if (type === 'imageUploadChunk') return this.media.uploadChunk(value);
    if (type === 'imageUploadSend') return this.media.uploadSend(value);
    throw new Error('Unsupported channel operation');
  }
  message(raw) {
    if (this.closed || !this.online) return;
    const event = record(raw), message = record(event.message), sender = record(event.sender), actor = record(sender.sender_id).open_id;
    if (sender.sender_type !== 'user' || !bounded(actor) || actor === this.botId || message.chat_type !== 'p2p'
      || !bounded(message.chat_id) || !bounded(message.message_id)) return;
    if (this.bound && (actor !== this.bound.actor || message.chat_id !== this.bound.chat)) return;
    const timestamp = Number(message.create_time), createdAt = timestamp < 1e12 ? timestamp * 1000 : timestamp;
    if (this.acceptAfter !== undefined && (!Number.isFinite(createdAt) || createdAt <= this.acceptAfter)) return;
    let content;
    try { content = messageContent(message); }
    catch { if (this.bound) this.unsupported(message); return; }
    const { text, images } = content;
    if (!this.bound) {
      if (message.message_type !== 'text' || !this.arm || this.arm.expiresAt <= this.now() || this.candidate || text.trim() !== this.arm.code) return;
    }
    this.gate ??= new this.adapter.LarkInboundGate(this.botId);
    // The pinned gate supports images; this also preserves its dedupe/age checks
    // with older text-only gates. Unsupported message types never enter this path.
    const envelope = message.message_type === 'text' ? event
      : { ...event, message: { ...message, message_type: 'text', content: JSON.stringify({ text: text || '[image]' }) } };
    const accepted = this.gate.accept(envelope, this.now());
    if (accepted.action !== 'accept' || !bounded(accepted.message.id)) return;
    if (!this.bound) {
      this.candidate = { id: randomUUID(), actor, chat: message.chat_id };
      void this.codeMatched(accepted.message.id, message.chat_id, this.candidate);
      this.event('candidate', { armId: this.arm.id, candidateId: this.candidate.id }); return;
    }
    for (const [id, input] of this.inputs) if (input.expiresAt <= this.now() && !this.reactions.has(id)) {
      this.media.recall(id); this.inputs.delete(id);
    }
    if (this.inputs.size >= 4096) return;
    this.inputs.set(accepted.message.id, { binding: this.bound, done: false, images, expiresAt: this.now() + 600000 });
    this.event('input', { bindingId: this.bound.id, id: accepted.message.id,
      text: images.length && !text ? '' : accepted.message.text, ...(images.length ? { images } : {}) });
  }
  unsupported(message) {
    const timestamp = Number(message.create_time), createdAt = timestamp < 1e12 ? timestamp * 1000 : timestamp;
    if (!Number.isFinite(createdAt) || createdAt <= 0 || this.now() - createdAt > 600000 || createdAt - this.now() > 30000) return;
    for (const [id, expiresAt] of this.feedback) if (expiresAt <= this.now()) this.feedback.delete(id);
    if (this.feedback.has(message.message_id) || this.feedback.size >= 64
      || this.feedbackAt !== undefined && this.now() - this.feedbackAt < 3000) return;
    this.feedback.set(message.message_id, this.now() + 600000); this.feedbackAt = this.now();
    const bound = this.bound;
    void this.card({ bindingId: bound.id, key: 'unsupported', title: 'Not supported / 暂不支持',
      text: 'Send text, an image, or a post containing text and up to 5 images. / 请发送文字、图片，或含文字及最多 5 张图片的富文本。' }).catch(() => {});
  }
  recalled(raw) {
    if (this.closed || !this.bound) return;
    const event = record(raw), input = this.inputs.get(event.message_id);
    if (event.recall_type !== 'message_owner' || event.chat_id !== this.bound.chat || input?.binding !== this.bound
      || input.recalled) return;
    input.recalled = true; input.done = true;
    this.media.recall(event.message_id);
    const reaction = this.reactions.get(event.message_id);
    if (reaction) { reaction.wanted = false; void this.syncReaction(reaction).catch(() => {}); }
    this.event('recalled', { bindingId: this.bound.id, id: event.message_id });
  }
  async reactionRequest(messageId, emoji, reactionId) {
    if (!bounded(messageId) || reactionId !== undefined && !bounded(reactionId)) throw new Error('Invalid reaction');
    try {
      const signal = this.reactionController.signal;
      signal.throwIfAborted();
      const response = await this.reactionApi.request({
        url: `/open-apis/im/v1/messages/${encodeURIComponent(messageId)}/reactions${reactionId ? `/${encodeURIComponent(reactionId)}` : ''}`,
        method: reactionId ? 'DELETE' : 'POST', signal, timeout: 3000,
        ...(reactionId ? {} : { data: { reaction_type: { emoji_type: emoji } } }),
      });
      signal.throwIfAborted();
      if (response.code !== 0 || !reactionId && !bounded(response.data?.reaction_id)) throw new Error('Invalid reaction response');
      return response.data?.reaction_id;
    } catch { throw new Error('Reaction delivery failed'); }
  }
  async codeMatched(messageId, chat, candidate) {
    try { await this.reactionRequest(messageId, 'OK'); }
    catch {
      if (this.closed || this.candidate !== candidate) return;
      // Keep pairing observable even when the bot has no reaction permission.
      try {
        await this.api.sendCard(chat, { header: { title: { tag: 'plain_text', content: 'Code matched / 验证码已匹配' } },
          elements: [{ tag: 'div', text: { tag: 'plain_text',
            content: 'Waiting for confirmation in Desktop. Chat access is not authorized yet. / 请在 Desktop 确认，当前尚未授予会话访问权限。' } }] });
      } catch { this.event('error', { stage: 'delivery' }); }
    }
  }
  syncReaction(reaction) {
    if (reaction.pending) return reaction.pending;
    reaction.pending = Promise.resolve().then(async () => {
      try {
        if (reaction.wanted && !reaction.id) reaction.id = await this.reactionRequest(reaction.messageId, 'Typing');
        // Completion can arrive before the POST resolves. Remove its exact returned ID.
        if (!reaction.wanted && reaction.id) {
          await this.reactionRequest(reaction.messageId, undefined, reaction.id); reaction.id = undefined;
        }
      } finally {
        reaction.pending = undefined;
        if (!reaction.id && !reaction.wanted && this.reactions.get(reaction.messageId) === reaction)
          this.reactions.delete(reaction.messageId);
      }
    });
    return reaction.pending;
  }
  callback(raw) {
    if (this.closed || !this.online || !this.bound) return;
    const event = record(raw), operator = record(event.operator), context = record(event.context), value = record(record(event.action).value);
    if (operator.open_id !== this.bound.actor || context.open_chat_id !== this.bound.chat) return;
    const timestamp = Number(event.create_time), createdAt = timestamp < 1e12 ? timestamp * 1000 : timestamp;
    if (this.acceptAfter !== undefined && (!Number.isFinite(createdAt) || createdAt <= this.acceptAfter)) return;
    const token = this.tokens.get(value.token);
    if (!token || token.status !== 'active' || !this.validFence(token.fence) || !token.options.includes(value.option)) return;
    if (token.expiresAt <= this.now()) { this.expireToken(token); return; }
    const form = record(event.action).form_value;
    if (token.form && value.option === submitAnswer && !remoteFormAnswers(token.form, form))
      return { toast: { type: 'error', content: '请完整作答；自行填写时请选择对应选项。 / Complete every answer; select Custom when writing your own.' } };
    void this.settleToken(token, 'handled').catch(() => {});
    this.event('decision', { bindingId: this.bound.id, token: value.token, option: value.option,
      ...(token.form && value.option === submitAnswer ? { form: structuredClone(form) } : {}) });
  }
  expireToken(token) {
    if (token.status !== 'active') return;
    if (!this.validFence(token.fence)) { clearTimeout(token.timer); token.status = 'unavailable'; return; }
    void this.settleToken(token, 'expired').catch(() => {});
    this.event('decisionExpired', { bindingId: token.fence.binding.id, token: token.id });
  }
  settleToken(token, status) {
    clearTimeout(token.timer); token.status = status;
    const entry = token.card;
    if (entry.token !== token || !this.validFence(token.fence)) return Promise.resolve();
    entry.status = status;
    return this.deliverCard(entry);
  }
  async card(value) {
    if (!bounded(value.key, 100) || !bounded(value.title, 200)
      || value.sessionKey !== undefined && !bounded(value.sessionKey, 200)
      || value.reply !== undefined && (!['working', 'completed', 'interrupted'].includes(value.reply) || value.actions !== undefined)
      || value.progress !== undefined && (typeof value.progress !== 'string' || value.progress.length > 200)
      || value.detail !== undefined && (typeof value.detail !== 'string' || value.detail.length > 200)
      || value.truncated !== undefined && typeof value.truncated !== 'boolean'
      || value.overview !== undefined && (!validRemoteOverview(value.overview) || value.reply !== undefined || value.actions !== undefined)
      || value.form !== undefined && (!validRemoteForm(value.form) || value.reply !== undefined || value.overview !== undefined
        || value.actions?.options?.join('\0') !== [submitAnswer, cancelAnswer].join('\0'))
      || typeof value.text !== 'string' || value.text.length > 12000) throw new Error('Invalid card');
    const fence = this.captureFence(value.bindingId, value.sessionKey);
    let entry = this.cards.get(value.key);
    if (entry && (entry.fence.binding !== fence.binding || entry.fence.scope !== fence.scope)) {
      if (this.validFence(entry.fence)) throw new Error('Card belongs to another session');
      entry = undefined;
    }
    const choices = value.actions;
    if (choices) {
      if (!bounded(choices.token, 80) || !Array.isArray(choices.options) || choices.options.length > 3
        || !choices.options.length || !choices.options.every(option => bounded(option, 80))
        || new Set(choices.options).size !== choices.options.length || value.text.length > 5000
        || choices.options.includes(refreshOption) && (choices.options.length !== 1 || entry?.status !== 'expired'))
        throw new Error('Invalid card action');
      const previous = this.tokens.get(choices.token);
      if (previous && (previous.card !== entry || previous.options.join('\0') !== choices.options.join('\0')
        || JSON.stringify(previous.form) !== JSON.stringify(value.form)))
        throw new Error('Decision token already used');
      if (!previous && (this.tokens.size >= 4096 || [...this.tokens.values()].filter(token => token.status === 'active').length >= 128))
        throw new Error('Decision limit reached');
    }
    if (!entry) {
      if (this.cards.size >= 64) {
        const old = [...this.cards.values()].find(item => !item.failed && !item.pending && !item.waiters && item.token?.status !== 'active');
        if (!old) throw new Error('Card limit reached');
        this.cards.delete(old.key);
      }
      entry = { key: value.key, fence, waiters: 0 };
      this.cards.set(value.key, entry);
    }
    if (entry.waiters >= 16) throw new Error('Card update limit reached');
    const previous = entry.token;
    if (previous && previous.id !== choices?.token) { clearTimeout(previous.timer); previous.status = 'unavailable'; }
    entry.value = { title: value.title, text: value.text, reply: value.reply,
      progress: value.progress, detail: value.detail, truncated: value.truncated,
      ...(value.form !== undefined ? { form: structuredClone(value.form) } : {}),
      ...(value.overview !== undefined ? { overview: structuredClone(value.overview) } : {}) };
    if (choices) {
      let token = this.tokens.get(choices.token);
      if (!token) {
        token = { id: choices.token, fence, card: entry, status: 'active',
          expiresAt: this.now() + 600000, options: [...choices.options],
          ...(value.form !== undefined ? { form: structuredClone(value.form) } : {}) };
        this.tokens.set(token.id, token);
        token.timer = setTimeout(() => this.expireToken(token), 600000);
        token.timer.unref?.();
      }
      entry.token = token;
      entry.status = choices.options.includes(refreshOption) ? 'expired' : token.status === 'active' ? undefined : token.status;
      if (token.expiresAt <= this.now() && token.status === 'active') this.expireToken(token);
    } else { entry.token = undefined; entry.status = undefined; }
    return this.deliverCard(entry);
  }
  deliverCard(entry) {
    if (!this.validFence(entry.fence) || this.cards.get(entry.key) !== entry) return Promise.resolve();
    if (entry.pending) {
      if (entry.waiters >= 16) return Promise.reject(new Error('Card update limit reached'));
      entry.waiters++;
      return entry.pending.catch(() => {}).then(() => {
        entry.waiters--; return this.deliverCard(entry);
      });
    }
    const token = entry.token;
    const actions = token?.status === 'active' && token.expiresAt > this.now() && this.validFence(token.fence)
      ? token.options.map(option => ({ tag: 'button', text: { tag: 'plain_text', content: option }, value: { token: token.id, option } })) : [];
    const card = remoteCard({ ...entry.value, status: entry.status }, actions);
    if (Buffer.byteLength(JSON.stringify(card)) > 28000) throw new Error('Card is too large');
    const pending = (async () => {
      try {
        if (entry.failed) throw new Error('Card delivery failed');
        if (entry.id) await this.api.updateCard(entry.id, card);
        else {
          // Unknown POST receipts are terminal for this key; do not duplicate.
          entry.issued = true;
          const id = await this.api.sendCard(entry.fence.binding.chat, card);
          if (!this.validFence(entry.fence) || this.cards.get(entry.key) !== entry) return;
          if (!bounded(id)) throw new Error('Invalid card receipt');
          entry.id = id;
        }
        if (!this.validFence(entry.fence) || this.cards.get(entry.key) !== entry) return;
      } catch {
        if (!entry.id && entry.issued) entry.failed = true;
        if (entry.token) { clearTimeout(entry.token.timer); entry.token.status = 'unavailable'; }
        if (this.validFence(entry.fence)) throw new Error('Card delivery failed');
      }
    })();
    entry.pending = pending;
    void pending.then(() => { if (entry.pending === pending) entry.pending = undefined; },
      () => { if (entry.pending === pending) entry.pending = undefined; });
    return pending;
  }
  async close() {
    if (this.closing) return this.closing;
    this.closed = true; this.online = false; this.controller.abort();
    this.startup?.(new Error('Channel closed')); this.reset();
    this.socket?.close({ force: true }); this.socket = undefined;
    this.credentials = undefined;
    this.closing = (async () => {
      let timer;
      try {
        await Promise.race([Promise.allSettled([...this.reactions.values()].map(reaction => this.syncReaction(reaction))),
          new Promise(resolve => { timer = setTimeout(resolve, 2000); })]);
      } finally { clearTimeout(timer); this.reactionController.abort(); }
      await this.api?.close(); this.api = undefined; this.reactionApi = undefined;
    })();
    return this.closing;
  }
}
