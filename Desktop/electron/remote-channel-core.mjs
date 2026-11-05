import { randomUUID } from 'node:crypto';

const silentLogger = { error() {}, warn() {}, info() {}, debug() {}, trace() {} };
const record = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
const bounded = (value, max = 200) => typeof value === 'string' && value.length > 0 && value.length <= max;

/** Feishu SDK boundary, with no agent, profile, filesystem or model credentials. */
export class RemoteConnection {
  constructor(adapter, emit, now = Date.now) {
    this.adapter = adapter; this.emit = emit; this.now = now;
    this.controller = new AbortController();
    this.tokens = new Map(); this.cards = new Map();
  }
  event(kind, fields = {}) { if (!this.closed) this.emit({ type: 'remote_channel', kind, ...fields }); }
  async authorize() {
    let stage = 'authorization';
    try {
      const signal = this.controller.signal, a = this.adapter;
      const registration = new a.LarkRegistration({ version: 'desktop-for-step-code' });
      const code = await registration.begin(signal);
      signal.throwIfAborted();
      this.event('authorization', { url: code.verificationUrl, expiresAt: this.now() + code.expiresInSeconds * 1000 });
      const result = await registration.waitForAuthorization(code, signal);
      signal.throwIfAborted();
      if (result.status !== 'authorized') throw new Error('Authorization unavailable');
      this.event('connecting');
      stage = 'identity';
      this.api = new a.LarkApi(result.credentials);
      const identity = await this.api.getBotIdentity();
      signal.throwIfAborted();
      this.botId = identity.openId;
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
          appId: result.credentials.appId, appSecret: result.credentials.appSecret,
          domain: a.LARK_OPEN_HOSTS[result.credentials.brand], logger: silentLogger, loggerLevel: a.LoggerLevel.error,
          handshakeTimeoutMs: 15000,
          onReady: () => { if (!this.closed) { this.online = true; finish(); } },
          onReconnecting: () => { this.online = false; this.event('health', { status: 'degraded' }); },
          onReconnected: () => { this.online = true; this.event('health', { status: 'connected' }); },
          onError: () => { this.online = false; if (this.startup) finish(new Error('Transport unavailable')); else this.event('health', { status: 'degraded' }); },
        });
        try { void Promise.resolve(this.socket.start({ eventDispatcher: dispatcher })).catch(() => finish(new Error('Transport unavailable'))); }
        catch { finish(new Error('Transport unavailable')); }
      });
      signal.throwIfAborted();
      this.event('connected', { botName: identity.name, callbackUrl: a.larkCallbackSetupUrl(result.credentials) });
    } catch {
      if (!this.closed) this.event('error', { stage });
      await this.close();
    }
  }
  reset() {
    this.gate?.close(); this.gate = undefined;
    this.arm = undefined; this.candidate = undefined; this.bound = undefined;
    this.tokens.clear(); this.cards.clear();
  }
  command(type, value = {}) {
    if (this.closed) throw new Error('Channel closed');
    if (type === 'connect') {
      if (this.started) throw new Error('Already started');
      this.started = true; void this.authorize(); return;
    }
    if (type === 'disarm') {
      if (value.armId === this.arm?.id) this.reset(); return;
    }
    if (type === 'unbind') {
      if (value.bindingId && value.bindingId === this.bound?.id || value.armId && value.armId === this.arm?.id) this.reset();
      return;
    }
    if (type === 'revoke') { this.tokens.delete(value.token); return; }
    if (!this.online) throw new Error('Transport is not ready');
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
    let text;
    try { text = record(JSON.parse(message.content)).text; } catch { return; }
    if (!bounded(text, 12000) || !text.trim()) return;
    if (!this.bound) {
      if (!this.arm || this.arm.expiresAt <= this.now() || this.candidate || text.trim() !== this.arm.code) return;
    } else if (actor !== this.bound.actor || message.chat_id !== this.bound.chat) return;
    this.gate ??= new this.adapter.LarkInboundGate(this.botId);
    const accepted = this.gate.accept(event, this.now());
    if (accepted.action !== 'accept') return;
    if (!this.bound) {
      this.candidate = { id: randomUUID(), actor, chat: message.chat_id };
      this.event('candidate', { armId: this.arm.id, candidateId: this.candidate.id }); return;
    }
    this.event('input', { bindingId: this.bound.id, id: accepted.message.id, text: accepted.message.text });
  }
  callback(raw) {
    if (this.closed || !this.online || !this.bound) return;
    const event = record(raw), operator = record(event.operator), context = record(event.context), value = record(record(event.action).value);
    if (operator.open_id !== this.bound.actor || context.open_chat_id !== this.bound.chat) return;
    const token = this.tokens.get(value.token);
    if (!token || token.bindingId !== this.bound.id || token.expiresAt <= this.now() || !token.options.includes(value.option)) return;
    this.tokens.delete(value.token);
    if (token.stop) this.event('stop', { bindingId: this.bound.id, runId: token.runId });
    else this.event('decision', { bindingId: this.bound.id, token: value.token, option: value.option });
  }
  async card(value) {
    const bound = this.bound;
    if (!bound || value.bindingId !== bound.id || !bounded(value.key, 100) || !bounded(value.title, 200)
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
    } else if (value.title.startsWith('Working')) {
      const token = randomUUID();
      for (const [id, item] of this.tokens) if (item.stop) this.tokens.delete(id);
      this.tokens.set(token, { bindingId: bound.id, runId: value.key, stop: true, expiresAt: this.now() + 600000, options: ['stop'] });
      actions.push({ tag: 'button', text: { tag: 'plain_text', content: 'Stop / 停止' }, value: { token, option: 'stop' } });
    } else {
      for (const [id, item] of this.tokens) if (item.stop && item.runId === value.key) this.tokens.delete(id);
    }
    const card = { config: { wide_screen_mode: true, update_multi: true },
      header: { title: { tag: 'plain_text', content: value.title } },
      elements: [{ tag: 'div', text: { tag: 'plain_text', content: value.text.slice(-5000) || 'Desktop for Step Code' } },
        ...(actions.length ? [{ tag: 'action', actions }] : [])] };
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
    if (this.closed) return;
    this.closed = true; this.online = false; this.controller.abort();
    this.startup?.(new Error('Channel closed')); this.reset();
    this.socket?.close({ force: true }); this.socket = undefined;
    await this.api?.close(); this.api = undefined;
  }
}
