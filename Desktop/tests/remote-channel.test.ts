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
  const events: any[] = [], cards: any[] = [], updates: any[] = [], reactions: any[] = [];
  let socketOptions: any, handlers: any, closed = 0, restClosed = 0, holdAuthorization = false, registrations = 0, botId = 'bot';
  let release!: () => void, failSend = false, holdReady = false, now = Date.now();
  let updateGate: Promise<void> | undefined;
  let reactionGate: Promise<void> | undefined, failReaction = false, reactionId = 0;
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
    Client: class {
      async request(value: any) {
        reactions.push(value);
        const gate = reactionGate; reactionGate = undefined; await gate;
        if (failReaction) throw new Error('PRIVATE-SECRET');
        return { code: 0, data: { reaction_id: `reaction-${++reactionId}` } };
      }
    },
    LarkRegistration: class {
      async begin() { registrations++; return { verificationUrl: 'https://open.feishu.cn/page/cli?user_code=fixture', expiresInSeconds: 300 }; }
      async waitForAuthorization(_code: unknown, signal: AbortSignal) {
        if (holdAuthorization) await new Promise<void>(resolve => { release = resolve; });
        signal.throwIfAborted();
        return { status: 'authorized', credentials: { appId: 'PRIVATE-APP', appSecret: 'PRIVATE-SECRET', brand: 'feishu' } };
      }
    },
    LarkApi: class {
      async getBotIdentity() { return { openId: botId, name: 'Fixture' }; }
      async sendCard(chat: string, card: unknown) { cards.push({ chat, card }); if (failSend) throw new Error('PRIVATE-SECRET'); return 'card-id'; }
      async updateCard(id: string, card: unknown) {
        updates.push({ id, card });
        const gate = updateGate; updateGate = undefined; await gate;
      }
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
  return { connection, events, cards, updates, reactions, connect, arm, bind, callback,
    inbound: (value: unknown) => handlers['im.message.receive_v1'](value),
    socket: () => socketOptions, closed: () => closed, restClosed: () => restClosed,
    now: () => now, registrations: () => registrations, bot: (value: string) => { botId = value; },
    hold: () => { holdAuthorization = true; }, release: () => release(), failSend: () => { failSend = true; },
    holdUpdate: () => {
      let resolve!: () => void, reject!: (error: Error) => void;
      updateGate = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
      return { resolve, reject };
    },
    failReaction: (value = true) => { failReaction = value; },
    holdReaction: () => {
      let resolve!: () => void, reject!: (error: Error) => void;
      reactionGate = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
      return { resolve, reject };
    },
    holdReady: () => { holdReady = true; }, advance: (ms: number) => { now += ms; } };
}

test('saved credentials reconnect without registration and keep private snapshots out of events', async t => {
  const first = fixture(); await first.connect(); first.bind();
  const saved = first.connection.command('snapshot');
  assert.equal(saved.identity.credentials.appSecret, 'PRIVATE-SECRET');
  await first.connection.close();
  const f = fixture(); t.after(() => f.connection.close());
  f.connection.command('connect', { identity: saved.identity }); await tick(); await tick();
  assert.equal(f.registrations(), 0);
  assert.deepEqual(f.events.map(event => event.kind), ['connecting', 'connected']);
  f.inbound(message('unbound', { message_id: 'unbound', create_time: f.now() + 1 }));
  assert.equal(f.events.some(event => event.kind === 'input'), false);
  f.connection.command('bindSaved', { bindingId: 'new-binding', peer: saved.peer });
  f.inbound(message('offline', { message_id: 'offline', create_time: f.now() - 10 }));
  f.inbound(message('new', { message_id: 'new', create_time: f.now() + 1 }));
  f.callback({ token: 'pre-restart-token', option: 'yes' });
  assert.deepEqual(f.events.filter(event => event.kind === 'input'), [
    { type: 'remote_channel', kind: 'input', bindingId: 'new-binding', id: 'new', text: 'new' },
  ]);
  assert.equal(f.events.some(event => event.kind === 'decision'), false);
  assert.doesNotMatch(JSON.stringify(f.events), /PRIVATE-|human|"chat"/);
});
test('saved credentials never restore a different bot identity', async () => {
  const f = fixture(); f.bot('replacement-bot');
  f.connection.command('connect', { identity: { botId: 'original-bot',
    credentials: { appId: 'PRIVATE-APP', appSecret: 'PRIVATE-SECRET', brand: 'feishu' } } });
  await tick(); await tick();
  assert.equal(f.socket(), undefined);
  assert.deepEqual(f.events.at(-1), { type: 'remote_channel', kind: 'error', stage: 'identity' });
  assert.doesNotMatch(JSON.stringify(f.events), /PRIVATE-/);
  await f.connection.close();
});
test('malformed saved identities cannot initiate transport or registration', async () => {
  const f = fixture();
  f.connection.command('connect', { identity: { botId: 'bot', credentials: { appId: 'app', appSecret: 'secret', brand: 'elsewhere' } } });
  await tick();
  assert.equal(f.socket(), undefined); assert.equal(f.registrations(), 0);
  await f.connection.close();
});

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
test('streaming updates one card without an unsolicited Stop button', async t => {
  const f = fixture(); t.after(() => f.connection.close()); await f.connect(); f.bind();
  const card = { bindingId: 'binding', key: 'run', title: 's1 · Session', text: '**one**', reply: 'working' };
  await f.connection.command('card', card);
  assert.equal(f.cards[0].card.header, undefined);
  assert.deepEqual(f.cards[0].card.elements[0], { tag: 'div', text: { tag: 'lark_md', content: '**one**' } });
  assert.deepEqual(f.cards[0].card.elements[1], { tag: 'note', elements: [{ tag: 'plain_text', content: 's1 · Session' }] });
  assert.equal(f.cards[0].card.elements.some((element: any) => element.tag === 'action'), false);
  const text = '**Answer**\n\n- First\n- Second\n\n`code`';
  await f.connection.command('card', { ...card, text });
  assert.equal(f.updates[0].card.elements[0].text.content, text);
  assert.equal(f.updates[0].card.elements.some((element: any) => element.tag === 'action'), false);
  await f.connection.command('card', { ...card, text, reply: 'completed' });
  assert.equal(f.updates[1].card.header, undefined);
  assert.doesNotMatch(JSON.stringify(f.updates[1].card), /Completed|已完成|Working|正在处理/);
  assert.equal(f.cards.length, 1); assert.equal(f.updates.length, 2);
  f.callback({ token: 'legacy-stop', option: 'stop' });
  assert.equal(f.events.some(event => event.kind === 'stop'), false);
});
test('empty replies distinguish waiting from no text, while interruption keeps the partial answer', async t => {
  const f = fixture(); t.after(() => f.connection.close()); await f.connect(); f.bind();
  const card = { bindingId: 'binding', key: 'run', title: 's2 · Session', text: '', reply: 'working' };
  await f.connection.command('card', card);
  assert.match(f.cards[0].card.elements[0].text.content, /Replying/);
  await f.connection.command('card', { ...card, reply: 'completed' });
  assert.match(f.updates[0].card.elements[0].text.content, /No text response/);
  assert.doesNotMatch(JSON.stringify(f.updates[0].card), /Replying|Completed/);
  await f.connection.command('card', { ...card, reply: 'interrupted', text: 'Partial **answer**' });
  assert.equal(f.updates[1].card.header, undefined);
  assert.equal(f.updates[1].card.elements[0].text.content, 'Partial **answer**');
  assert.match(f.updates[1].card.elements[1].elements[0].content, /Reply interrupted · s2 · Session/);
});
test('system notices and approvals retain literal content, and malformed reply kinds cannot register actions', async t => {
  const f = fixture(); t.after(() => f.connection.close()); await f.connect(); f.bind();
  const card = { bindingId: 'binding', key: 'notice', title: 'Help', text: '**literal**' };
  await f.connection.command('card', card);
  assert.equal(f.cards[0].card.header.title.content, 'Help');
  assert.deepEqual(f.cards[0].card.elements[0].text, { tag: 'plain_text', content: '**literal**' });
  const actions = { token: 'invalid-reply-action', options: ['yes'] };
  for (const reply of ['unknown', '', null, {}, true])
    await assert.rejects(f.connection.command('card', { ...card, reply }), /^Error: Invalid card$/);
  await assert.rejects(f.connection.command('card', { ...card, reply: 'completed', actions }), /^Error: Invalid card$/);
  f.callback({ token: actions.token, option: 'yes' });
  assert.equal(f.events.some(event => event.kind === 'decision'), false);
  assert.equal(f.cards.length, 1); assert.equal(f.updates.length, 0);
  await f.connection.command('card', { ...card, key: 'approval', title: 'Approve', actions });
  assert.equal(f.cards[1].card.header.title.content, 'Approve');
  assert.deepEqual(f.cards[1].card.elements[0].text, { tag: 'plain_text', content: '**literal**' });
  assert.equal(f.cards[1].card.elements[1].tag, 'action');
});
test('explicit approval actions remain single-use during a delayed card update', async t => {
  const f = fixture(); t.after(() => f.connection.close()); await f.connect(); f.bind();
  const card = { bindingId: 'binding', key: 'approval', title: 'Approve', text: 'one',
    actions: { token: 'approval-token', options: ['yes', 'no'] } };
  await f.connection.command('card', card);
  const action = f.cards[0].card.elements[1].actions[0].value;
  const gate = f.holdUpdate(), pending = f.connection.command('card', { ...card, text: 'two' });
  assert.deepEqual(f.updates[0].card.elements[1].actions[0].value, action);
  f.callback(action); f.callback(action);
  assert.deepEqual(f.events.filter(event => event.kind === 'decision'), [
    { type: 'remote_channel', kind: 'decision', bindingId: 'binding', token: 'approval-token', option: 'yes' },
  ]);
  gate.resolve(); await pending;
  f.callback(action);
  assert.equal(f.events.filter(event => event.kind === 'decision').length, 1);
});
test('failed streaming updates never introduce a Stop button or expose SDK errors', async t => {
  const f = fixture(); t.after(() => f.connection.close()); await f.connect(); f.bind();
  const card = { bindingId: 'binding', key: 'run', title: 'Working', text: 'one' };
  await f.connection.command('card', card);
  const gate = f.holdUpdate(), pending = f.connection.command('card', { ...card, text: 'two' });
  gate.reject(new Error('PRIVATE-SECRET'));
  await assert.rejects(pending, /^Error: Card delivery failed$/);
  assert.equal(f.cards[0].card.elements.some((element: any) => element.tag === 'action'), false);
  assert.equal(f.updates[0].card.elements.some((element: any) => element.tag === 'action'), false);
  assert.doesNotMatch(JSON.stringify(f.events), /PRIVATE-/);
});
test('a matched pairing code receives one confirmation reaction without authorizing the chat', async t => {
  const f = fixture(); t.after(() => f.connection.close()); await f.connect(); f.bind();
  await tick();
  assert.equal(f.reactions.length, 1);
  assert.equal(f.reactions[0].data.reaction_type.emoji_type, 'OK');
  assert.equal(f.cards.length, 0);
  f.connection.command('unbind', { bindingId: 'binding' }); f.arm();
  f.inbound(message('wrong', { message_id: 'wrong' }));
  f.inbound(message('12345678', { message_id: 'proof' }));
  f.inbound(message('12345678', { message_id: 'duplicate-code' }));
  f.inbound(message('must not run', { message_id: 'not-authorized' }));
  await tick();
  assert.equal(f.reactions.length, 2);
  assert.match(f.reactions[1].url, /\/messages\/proof\/reactions$/);
  assert.equal(f.events.some(event => event.kind === 'input'), false);
});
test('pairing has an explicit pending-confirmation fallback if reactions are unavailable', async t => {
  const f = fixture(); t.after(() => f.connection.close()); await f.connect(); f.failReaction(); f.arm();
  f.inbound(message('12345678')); await tick();
  assert.equal(f.cards.length, 1);
  assert.match(f.cards[0].card.header.title.content, /^Code matched/);
  assert.match(f.cards[0].card.elements[0].text.content, /not authorized yet/);
  assert.equal(f.events.some(event => event.kind === 'input'), false);
  assert.doesNotMatch(JSON.stringify(f.events), /PRIVATE-/);
});
test('only a known message in the current binding can receive and lose its own processing reaction', async t => {
  const f = fixture(); t.after(() => f.connection.close()); await f.connect(); f.bind();
  await tick(); f.reactions.length = 0;
  const value = { bindingId: 'binding', messageId: 'original / message', active: true };
  assert.throws(() => f.connection.command('reaction', value), /target/);
  f.inbound(message('hello', { message_id: value.messageId }));
  assert.throws(() => f.connection.command('reaction', { ...value, bindingId: 'old-binding' }), /target/);
  await f.connection.command('reaction', value);
  await f.connection.command('reaction', value);
  assert.equal(f.reactions.length, 1);
  assert.equal(f.reactions[0].method, 'POST');
  assert.match(f.reactions[0].url, /original%20%2F%20message\/reactions$/);
  assert.deepEqual(f.reactions[0].data, { reaction_type: { emoji_type: 'Typing' } });
  await f.connection.command('reaction', { ...value, active: false });
  assert.equal(f.reactions.length, 2);
  assert.equal(f.reactions[1].method, 'DELETE');
  assert.match(f.reactions[1].url, /\/reactions\/reaction-2$/);
  assert.throws(() => f.connection.command('reaction', value), /target/);
  await f.connection.command('reaction', { ...value, active: false });
  assert.equal(f.reactions.length, 2);
});
test('completion during a delayed reaction POST removes the exact late result once', async t => {
  const f = fixture(); t.after(() => f.connection.close()); await f.connect(); f.bind(); await tick();
  f.reactions.length = 0; f.inbound(message('quick answer', { message_id: 'quick' }));
  const gate = f.holdReaction(), value = { bindingId: 'binding', messageId: 'quick', active: true };
  const added = f.connection.command('reaction', value); await tick();
  const removed = f.connection.command('reaction', { ...value, active: false });
  assert.equal(f.reactions.length, 1);
  gate.resolve(); await Promise.all([added, removed]);
  assert.deepEqual(f.reactions.map(value => value.method), ['POST', 'DELETE']);
});
test('unbind cleans late processing reactions without granting the old message to a new binding', async t => {
  const f = fixture(); t.after(() => f.connection.close()); await f.connect(); f.bind(); await tick();
  f.reactions.length = 0; f.inbound(message('working', { message_id: 'old' }));
  const gate = f.holdReaction(), value = { bindingId: 'binding', messageId: 'old', active: true };
  const added = f.connection.command('reaction', value); await tick();
  f.connection.command('unbind', { bindingId: 'binding' }); f.arm();
  gate.resolve(); await added;
  assert.deepEqual(f.reactions.map(value => value.method), ['POST', 'DELETE']);
  assert.throws(() => f.connection.command('reaction', value), /target/);
});
test('reaction failures are sanitized; failed deletion can recover without another POST', async t => {
  const f = fixture(); t.after(() => f.connection.close()); await f.connect(); f.bind(); await tick();
  f.reactions.length = 0; f.inbound(message('working', { message_id: 'retry-delete' }));
  const value = { bindingId: 'binding', messageId: 'retry-delete', active: true };
  await f.connection.command('reaction', value); f.failReaction();
  await assert.rejects(f.connection.command('reaction', { ...value, active: false }), /^Error: Reaction delivery failed$/);
  f.failReaction(false); f.socket().onReconnected(); await tick();
  assert.deepEqual(f.reactions.map(value => value.method), ['POST', 'DELETE', 'DELETE']);
  assert.equal(f.connection.reactions.size, 0);
  assert.doesNotMatch(JSON.stringify(f.events), /PRIVATE-/);
});
test('old disarm and unbind commands do not clear a newer challenge', async t => {
  const f = fixture(); t.after(() => f.connection.close()); await f.connect(); f.arm();
  f.connection.command('disarm', { armId: 'old-arm' }); f.connection.command('unbind', { bindingId: 'old-binding' });
  f.inbound(message('12345678'));
  assert.equal(f.events.at(-1).kind, 'candidate');
});
test('concurrent message reactions are removed independently, including during a degraded transport', async t => {
  const f = fixture(); t.after(() => f.connection.close()); await f.connect(); f.bind();
  await tick(); f.reactions.length = 0;
  for (const messageId of ['a', 'b']) {
    f.inbound(message('working', { message_id: messageId }));
    await f.connection.command('reaction', { bindingId: 'binding', messageId, active: true });
  }
  f.socket().onReconnecting();
  await f.connection.command('reaction', { bindingId: 'binding', messageId: 'a', active: false });
  assert.equal(f.connection.reactions.has('a'), false);
  assert.equal(f.connection.reactions.has('b'), true);
  assert.equal(f.reactions.filter(value => value.method === 'DELETE').length, 1);
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
