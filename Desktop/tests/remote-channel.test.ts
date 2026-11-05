import test from 'node:test';
import assert from 'node:assert/strict';
const { RemoteConnection } = await import(new URL('../electron/remote-channel-core.mjs', import.meta.url).href);
const tick = () => new Promise<void>(resolve => setImmediate(resolve));
function message(text: string, patch: Record<string, unknown> = {}, actor = 'human') {
  return { sender: { sender_type: 'user', sender_id: { open_id: actor } },
    message: { message_id: 'message', chat_type: 'p2p', chat_id: 'chat', message_type: 'text',
      create_time: Date.now(), content: JSON.stringify({ text }), ...patch } };
}
function fixture() {
  const events: any[] = [], cards: any[] = [], updates: any[] = [];
  let socketOptions: any, handlers: any, closed = 0, restClosed = 0, holdAuthorization = false;
  let release!: () => void, failSend = false, holdReady = false, now = Date.now();
  class Gate {
    private seen = new Set<string>();
    accept(raw: any, now: number) {
      if (now - Number(raw.message.create_time) > 600000 || this.seen.has(raw.message.message_id)) return { action: 'ignore' };
      this.seen.add(raw.message.message_id);
      return { action: 'accept', message: { id: raw.message.message_id, text: JSON.parse(raw.message.content).text } };
    }
    close() {}
  }
  const adapter = {
    LarkRegistration: class {
      async begin() { return { verificationUrl: 'https://open.feishu.cn/page/cli?user_code=fixture', expiresInSeconds: 300 }; }
      async waitForAuthorization(_code: unknown, signal: AbortSignal) {
        if (holdAuthorization) await new Promise<void>(resolve => { release = resolve; });
        signal.throwIfAborted();
        return { status: 'authorized', credentials: { appId: 'PRIVATE-APP', appSecret: 'PRIVATE-SECRET', brand: 'feishu' } };
      }
    },
    LarkApi: class {
      async getBotIdentity() { return { openId: 'bot', name: 'Fixture' }; }
      async sendCard(chat: string, card: unknown) { cards.push({ chat, card }); if (failSend) throw new Error('PRIVATE-SECRET'); return 'card-id'; }
      async updateCard(id: string, card: unknown) { updates.push({ id, card }); }
      async close() { restClosed++; }
    },
    EventDispatcher: class { register(value: unknown) { handlers = value; return this; } },
    WSClient: class {
      constructor(options: unknown) { socketOptions = options; }
      start() { if (!holdReady) socketOptions.onReady(); }
      close() { closed++; }
    },
    LarkInboundGate: Gate, LoggerLevel: { error: 0 }, LARK_OPEN_HOSTS: { feishu: 'https://open.feishu.cn' },
    larkCallbackSetupUrl: () => 'https://open.feishu.cn/page/launcher?fixture',
  };
  const connection = new RemoteConnection(adapter, (event: unknown) => events.push(event), () => now);
  const connect = async () => { connection.command('connect'); await tick(); await tick(); };
  const arm = () => connection.command('arm', { armId: 'arm', code: '12345678', expiresAt: now + 120000 });
  const bind = () => {
    arm(); handlers['im.message.receive_v1'](message('12345678'));
    connection.command('bind', { armId: 'arm', candidateId: events.slice().reverse().find(event => event.kind === 'candidate').candidateId, bindingId: 'binding' });
  };
  const callback = (value: any, actor = 'human', chat = 'chat') => handlers['card.action.trigger']({
    operator: { open_id: actor }, context: { open_chat_id: chat }, action: { value },
  });
  return { connection, events, cards, updates, connect, arm, bind, callback,
    inbound: (value: unknown) => handlers['im.message.receive_v1'](value),
    socket: () => socketOptions, closed: () => closed, restClosed: () => restClosed,
    hold: () => { holdAuthorization = true; }, release: () => release(), failSend: () => { failSend = true; },
    holdReady: () => { holdReady = true; }, advance: (ms: number) => { now += ms; } };
}

test('authorization keeps secrets out of events and resolves connected only after readiness', async t => {
  const f = fixture(); t.after(() => f.connection.close()); await f.connect();
  assert.deepEqual(f.events.map(event => event.kind), ['authorization', 'connecting', 'connected']);
  assert.doesNotMatch(JSON.stringify(f.events), /PRIVATE-/);
  f.socket().onReconnecting();
  assert.equal(f.events.at(-1).status, 'degraded');
  f.socket().onReconnected();
  assert.equal(f.events.at(-1).status, 'connected');
});
test('cancelled authorization never creates transport or late connected state', async () => {
  const f = fixture(); f.hold(); await f.connect();
  assert.equal(f.events.length, 1);
  await f.connection.close(); f.release(); await tick();
  assert.equal(f.socket(), undefined); assert.equal(f.events.length, 1);
});
test('transport is not connected before readiness; handshake error closes the helper boundary', async () => {
  const f = fixture(); f.holdReady(); await f.connect();
  assert.deepEqual(f.events.map(event => event.kind), ['authorization', 'connecting']);
  f.socket().onError(new Error('PRIVATE-SECRET'));
  await tick();
  assert.deepEqual(f.events.at(-1), { type: 'remote_channel', kind: 'error', stage: 'transport' });
  assert.doesNotMatch(JSON.stringify(f.events), /PRIVATE-/);
  assert.equal(f.closed(), 1); assert.equal(f.restClosed(), 1);
  f.socket().onReady(); await tick();
  assert.equal(f.events.filter(event => event.kind === 'connected').length, 0);
});
test('only a fresh exact private-chat code becomes a candidate; code is never model input', async t => {
  const f = fixture(); t.after(() => f.connection.close()); await f.connect(); f.arm();
  for (const raw of [
    message('hello'), message('12345678', { chat_type: 'group' }),
    message('12345678', {}, 'bot'), message('12345678', { message_type: 'image' }),
    message('12345678', { create_time: Date.now() - 700000 }),
  ]) f.inbound(raw);
  assert.equal(f.events.filter(event => event.kind === 'candidate').length, 0);
  f.inbound(message('12345678')); f.inbound(message('12345678', { message_id: 'other' }));
  assert.equal(f.events.filter(event => event.kind === 'candidate').length, 1);
  assert.equal(f.events.filter(event => event.kind === 'input').length, 0);
  assert.doesNotMatch(JSON.stringify(f.events), /human|12345678/);
});
test('binding requires local confirmation then fences both actor and chat with duplicate suppression', async t => {
  const f = fixture(); t.after(() => f.connection.close()); await f.connect(); f.bind();
  for (const raw of [
    message('wrong actor', { message_id: 'wrong-actor' }, 'other'),
    message('wrong chat', { message_id: 'wrong-chat', chat_id: 'other' }),
    message('hello', { message_id: 'new' }), message('hello', { message_id: 'new' }),
  ]) f.inbound(raw);
  assert.deepEqual(f.events.filter(event => event.kind === 'input'), [
    { type: 'remote_channel', kind: 'input', bindingId: 'binding', id: 'new', text: 'hello' },
  ]);
  f.connection.command('unbind', { bindingId: 'binding' });
  f.inbound(message('late', { message_id: 'late' }));
  assert.equal(f.events.filter(event => event.kind === 'input').length, 1);
});
test('callbacks require a live single-use token, matching actor, chat and original options', async t => {
  const f = fixture(); t.after(() => f.connection.close()); await f.connect(); f.bind();
  await f.connection.command('card', { bindingId: 'binding', key: 'approval', title: 'Approve', text: 'Operation',
    actions: { token: 'token', options: ['yes', 'no'] } });
  const action = { token: 'token', option: 'yes' };
  f.callback(action, 'other'); f.callback(action, 'human', 'other'); f.callback({ ...action, option: 'anything' });
  assert.equal(f.events.filter(event => event.kind === 'decision').length, 0);
  f.callback(action); f.callback(action);
  assert.equal(f.events.filter(event => event.kind === 'decision').length, 1);
});
test('revoked tokens and tokens from an unbound chat cannot act', async t => {
  const f = fixture(); t.after(() => f.connection.close()); await f.connect(); f.bind();
  const card = { bindingId: 'binding', key: 'approval', title: 'Approve', text: 'Operation', actions: { token: 'token', options: ['yes'] } };
  await f.connection.command('card', card);
  f.connection.command('revoke', { token: 'token' }); f.callback({ token: 'token', option: 'yes' });
  await f.connection.command('card', { ...card, key: 'second' });
  f.connection.command('unbind', { bindingId: 'binding' }); f.callback({ token: 'token', option: 'yes' });
  assert.equal(f.events.filter(event => event.kind === 'decision').length, 0);
});
test('expired verification codes and card tokens do not bind or answer', async t => {
  const f = fixture(); t.after(() => f.connection.close()); await f.connect(); f.arm();
  f.advance(120001); f.inbound(message('12345678'));
  assert.equal(f.events.filter(event => event.kind === 'candidate').length, 0);
  f.bind();
  await f.connection.command('card', { bindingId: 'binding', key: 'approval', title: 'Approve', text: 'Operation',
    actions: { token: 'token', options: ['yes'] } });
  f.advance(600001); f.callback({ token: 'token', option: 'yes' });
  assert.equal(f.events.filter(event => event.kind === 'decision').length, 0);
});
test('streaming updates one card; completion invalidates its stop action', async t => {
  const f = fixture(); t.after(() => f.connection.close()); await f.connect(); f.bind();
  const card = { bindingId: 'binding', key: 'run', title: 'Working', text: 'one' };
  await f.connection.command('card', card);
  const stop = f.cards[0].card.elements[1].actions[0].value;
  await f.connection.command('card', { ...card, text: 'two' });
  f.callback(stop);
  assert.equal(f.events.filter(event => event.kind === 'stop').length, 0);
  const latest = f.updates[0].card.elements[1].actions[0].value;
  f.callback(latest); f.callback(latest);
  assert.equal(f.events.filter(event => event.kind === 'stop').length, 1);
  await f.connection.command('card', { ...card, title: 'Completed' });
  assert.equal(f.cards.length, 1); assert.equal(f.updates.length, 2);
  f.callback(latest); assert.equal(f.events.filter(event => event.kind === 'stop').length, 1);
});
test('old disarm and unbind commands do not clear a newer challenge', async t => {
  const f = fixture(); t.after(() => f.connection.close()); await f.connect(); f.arm();
  f.connection.command('disarm', { armId: 'old-arm' }); f.connection.command('unbind', { bindingId: 'old-binding' });
  f.inbound(message('12345678'));
  assert.equal(f.events.at(-1).kind, 'candidate');
});
test('delivery failures are sanitized and never retried; close stops socket and REST work', async () => {
  const f = fixture(); await f.connect(); f.bind(); f.failSend();
  await assert.rejects(f.connection.command('card', { bindingId: 'binding', key: 'run', title: 'Result', text: 'safe' }), /^Error: Card delivery failed$/);
  assert.equal(f.cards.length, 1);
  await f.connection.close(); await f.connection.close();
  assert.equal(f.closed(), 1); assert.equal(f.restClosed(), 1);
  const before = f.events.length; f.socket().onReady(); f.socket().onReconnected();
  assert.equal(f.events.length, before);
});
