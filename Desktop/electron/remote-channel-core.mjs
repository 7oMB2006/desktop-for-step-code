import { randomUUID } from 'node:crypto';
import { remoteCard } from './remote-card.mjs';

const silentLogger = { error() {}, warn() {}, info() {}, debug() {}, trace() {} };
const record = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
const bounded = (value, max = 200) => typeof value === 'string' && value.length > 0 && value.length <= max;

/** Feishu SDK boundary, with no agent, profile, filesystem or model credentials. */
export class RemoteConnection {
  constructor(adapter, emit, now = Date.now) {
    this.adapter = adapter; this.emit = emit; this.now = now;
    this.controller = new AbortController();
    this.reactionController = new AbortController();
    this.tokens = new Map(); this.cards = new Map(); this.inputs = new Map(); this.reactions = new Map();
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
        'card.action.trigger': event => { this.callback(event); return {}; },
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
    this.tokens.clear(); this.cards.clear(); this.inputs.clear();
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
    if (type === 'revoke') { this.tokens.delete(value.token); return; }
    if (type === 'reaction') {
      const input = this.inputs.get(value.messageId);
      if (!this.bound || value.bindingId !== this.bound.id || input?.binding !== this.bound
        || typeof value.active !== 'boolean' || value.active && input.done) throw new Error('Invalid reaction target');
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
    throw new Error('Unsupported channel operation');
  }
  message(raw) {
    if (this.closed || !this.online) return;
    const event = record(raw), message = record(event.message), sender = record(event.sender), actor = record(sender.sender_id).open_id;
    if (sender.sender_type !== 'user' || !bounded(actor) || actor === this.botId || message.chat_type !== 'p2p'
      || message.message_type !== 'text' || !bounded(message.chat_id)) return;
    const timestamp = Number(message.create_time), createdAt = timestamp < 1e12 ? timestamp * 1000 : timestamp;
    if (this.acceptAfter !== undefined && (!Number.isFinite(createdAt) || createdAt <= this.acceptAfter)) return;
    let text;
    try { text = record(JSON.parse(message.content)).text; } catch { return; }
    if (!bounded(text, 12000) || !text.trim()) return;
    if (!this.bound) {
      if (!this.arm || this.arm.expiresAt <= this.now() || this.candidate || text.trim() !== this.arm.code) return;
    } else if (actor !== this.bound.actor || message.chat_id !== this.bound.chat) return;
    this.gate ??= new this.adapter.LarkInboundGate(this.botId);
    const accepted = this.gate.accept(event, this.now());
    if (accepted.action !== 'accept' || !bounded(accepted.message.id)) return;
    if (!this.bound) {
      this.candidate = { id: randomUUID(), actor, chat: message.chat_id };
      void this.codeMatched(accepted.message.id, message.chat_id);
      this.event('candidate', { armId: this.arm.id, candidateId: this.candidate.id }); return;
    }
    for (const [id, input] of this.inputs) if (input.expiresAt <= this.now() && !this.reactions.has(id)) this.inputs.delete(id);
    if (this.inputs.size >= 4096) return;
    this.inputs.set(accepted.message.id, { binding: this.bound, done: false, expiresAt: this.now() + 600000 });
    this.event('input', { bindingId: this.bound.id, id: accepted.message.id, text: accepted.message.text });
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
  async codeMatched(messageId, chat) {
    try { await this.reactionRequest(messageId, 'OK'); }
    catch {
      if (this.closed) return;
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
    const token = this.tokens.get(value.token);
    if (!token || token.bindingId !== this.bound.id || token.expiresAt <= this.now() || !token.options.includes(value.option)) return;
    this.tokens.delete(value.token);
    this.event('decision', { bindingId: this.bound.id, token: value.token, option: value.option });
  }
  async card(value) {
    const bound = this.bound;
    if (!bound || value.bindingId !== bound.id || !bounded(value.key, 100) || !bounded(value.title, 200)
      || value.sessionKey !== undefined && !bounded(value.sessionKey, 200)
      || value.reply !== undefined && (!['working', 'completed', 'interrupted'].includes(value.reply) || value.actions !== undefined)
      || typeof value.text !== 'string' || value.text.length > 12000) throw new Error('Invalid card');
    for (const [token, item] of this.tokens) if (item.expiresAt <= this.now()) this.tokens.delete(token);
    const actions = [];
    const choices = value.actions;
    if (choices) {
      if (!bounded(choices.token, 80) || !Array.isArray(choices.options) || choices.options.length > 3
        || !choices.options.length || !choices.options.every(option => bounded(option, 80)) || this.tokens.size >= 128)
        throw new Error('Invalid card action');
      this.tokens.set(choices.token, { bindingId: bound.id, expiresAt: this.now() + 600000, options: choices.options });
      actions.push(...choices.options.map(option => ({ tag: 'button', text: { tag: 'plain_text', content: option },
        value: { token: choices.token, option } })));
    }
    const card = remoteCard(value, actions);
    const previous = this.cards.get(value.key);
    try {
      if (previous) await this.api.updateCard(previous, card);
      else {
        // Never retry a POST whose receipt is unknown: that could duplicate a card.
        const id = await this.api.sendCard(bound.chat, card);
        if (this.bound === bound && !this.closed) {
          if (this.cards.size >= 64) this.cards.delete(this.cards.keys().next().value);
          this.cards.set(value.key, id);
        }
      }
    } catch { throw new Error('Card delivery failed'); }
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
