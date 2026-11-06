import test from 'node:test';
import assert from 'node:assert/strict';
const { RemoteConnection } = await import(new URL('../electron/remote-channel-core.mjs', import.meta.url).href);
const { remoteCard } = await import(new URL('../electron/remote-card.mjs', import.meta.url).href);
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
  let updateGate: Promise<void> | undefined, sendGate: Promise<void> | undefined;
  let reactionGate: Promise<void> | undefined, failReaction = false, reactionId = 0;
  class Gate {
    private seen = new Set<string>();
    accept(raw: any, now: number) {
      if (raw.message.message_type !== 'text' || now - Number(raw.message.create_time) > 600000
        || this.seen.has(raw.message.message_id)) return { action: 'ignore' };
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
      async sendCard(chat: string, card: unknown) {
        cards.push({ chat, card });
        const gate = sendGate; sendGate = undefined; await gate;
        if (failSend) throw new Error('PRIVATE-SECRET');
        return `card-${cards.length}`;
      }
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
  const callback = (value: any, actor = 'human', chat = 'chat', createdAt: number | undefined = now + 1) => handlers['card.action.trigger']({
    create_time: createdAt, operator: { open_id: actor }, context: { open_chat_id: chat }, action: { value },
  });
  return { connection, events, cards, updates, reactions, connect, arm, bind, callback,
    inbound: (value: unknown) => handlers['im.message.receive_v1'](value),
    recall: (value: unknown) => handlers['im.message.recalled_v1'](value),
    socket: () => socketOptions, closed: () => closed, restClosed: () => restClosed,
    now: () => now, registrations: () => registrations, bot: (value: string) => { botId = value; },
    hold: () => { holdAuthorization = true; }, release: () => release(), failSend: () => { failSend = true; },
    holdUpdate: () => {
      let resolve!: () => void, reject!: (error: Error) => void;
      updateGate = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
      return { resolve, reject };
    },
    holdSend: () => {
      let resolve!: () => void, reject!: (error: Error) => void;
      sendGate = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
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
  await assert.rejects(f.connection.command('card', { ...card, key: 'second' }), /already used/);
  await f.connection.command('card', { ...card, key: 'second', actions: { ...card.actions, token: 'second-token' } });
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
test('overview cards group attention first and keep external labels literal with exact per-session commands', async t => {
  const f = fixture(); t.after(() => f.connection.close()); await f.connect(); f.bind();
  const overview = { language: 'zh', current: 's7 · 当前输入', total: 2, rows: [
    { ref: 's7', name: '**literal** <at id=all>not a mention</at>', status: '运行中', queue: 2, attention: false },
    { ref: 's3', name: '等待的会话', status: '待审批', queue: 0, attention: true },
  ] };
  await f.connection.command('card', { bindingId: 'binding', key: 'overview', title: 'Remote Beta', text: '', overview });
  const card = f.cards[0].card;
  assert.equal(card.header.title.content, '会话总览 · 2');
  const text = JSON.stringify(card);
  assert.ok(text.indexOf('s3 · 等待的会话') < text.indexOf('s7 · **literal**'));
  assert.ok(card.elements.some((element: any) => element.text?.tag === 'plain_text' && element.text.content.includes('<at id=all>')));
  assert.ok(card.elements.filter((element: any) => element.text?.tag === 'lark_md')
    .every((element: any) => !element.text.content.includes('literal') && !element.text.content.includes('<at')));
  assert.match(text, /待审批\\n查看 \/status s3/);
  assert.match(text, /运行中 · 排队 2/);
  assert.doesNotMatch(text, /Remote Beta|Queue:|Running|排队 0|action/);
  const highHandle = remoteCard({ title: 'Overview', text: '', overview: { ...overview, total: 1,
    rows: [{ ...overview.rows[0], ref: 's10000' }] } });
  assert.match(JSON.stringify(highHandle), /\/status s10000/);
  await f.connection.command('card', { bindingId: 'binding', key: 'english', title: 'Overview', text: '',
    overview: { language: 'en', total: 0, rows: [] } });
  assert.equal(f.cards[1].card.header.title.content, 'Session overview');
  assert.match(JSON.stringify(f.cards[1].card), /No active tasks/);
  assert.doesNotMatch(JSON.stringify(f.cards[1].card), /会话|任务|\/status/);
});
test('overview payloads are bounded and cannot acquire approval or reply actions', async t => {
  const f = fixture(); t.after(() => f.connection.close()); await f.connect(); f.bind();
  const row = { ref: 's1', name: 'Session', status: 'Running', queue: 1, attention: false };
  const overview = { language: 'en', total: 1, rows: [row] };
  const base = { bindingId: 'binding', key: 'bad-overview', title: 'Overview', text: '' };
  for (const invalid of [null, {}, { ...overview, language: 'bad' }, { ...overview, total: 0 },
    { ...overview, total: 9, rows: Array(9).fill(row) }, { ...overview, rows: [{ ...row, queue: -1 }] },
    { ...overview, rows: [{ ...row, name: 'First\nSecond' }] }])
    await assert.rejects(f.connection.command('card', { ...base, overview: invalid }), /Invalid card/);
  await assert.rejects(f.connection.command('card', { ...base, overview, reply: 'working' }), /Invalid card/);
  await assert.rejects(f.connection.command('card', { ...base, overview, actions: { token: 'not-registered', options: ['yes'] } }), /Invalid card/);
  assert.equal(f.cards.length, 0);
  f.callback({ token: 'not-registered', option: 'yes' });
  assert.equal(f.events.some(event => event.kind === 'decision'), false);
});
test('maximum-size overview keeps complete rows and disclosure inside the card text budget', () => {
  const overview = { language: 'zh', current: 'c'.repeat(200), total: 4096,
    rows: Array.from({ length: 8 }, (_, index) => ({ ref: `${index}`.padEnd(200, 'x'),
      name: 'n'.repeat(70), status: 's'.repeat(60), queue: 1000000, attention: index < 4 })) };
  const card = remoteCard({ title: 'ignored', text: '', overview });
  const visible = card.elements.map((element: any) => element.text?.content ?? element.elements?.[0].content ?? '').join('');
  assert.ok(visible.length <= 5000);
  assert.match(visible, /另有 4088 个会话/);
  assert.doesNotMatch(visible, /\/status|\/session/);
  assert.equal(card.elements.filter((element: any) => element.text?.tag === 'plain_text').length, 8);
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

test('native images and image posts retain only observed keys behind actor and chat authentication', async t => {
  const f = fixture(); t.after(() => f.connection.close()); await f.connect(); f.bind();
  const image = { message_id: 'image', message_type: 'image', content: JSON.stringify({ image_key: 'img_native' }) };
  f.inbound(message('', image, 'other'));
  f.inbound(message('', { ...image, chat_id: 'other' }));
  f.inbound(message('', image)); f.inbound(message('', image));
  const post = { message_id: 'post', message_type: 'post', content: JSON.stringify({ en_us: {
    title: 'Look', content: [[{ tag: 'text', text: '/unknown stays a command' }, { tag: 'img', image_key: 'img_one' }],
      [{ tag: 'img', image_key: 'img_two' }, { tag: 'text', text: 'second row' }]],
  } }) };
  f.inbound(message('', post)); f.inbound(message('', post));
  assert.deepEqual(f.events.filter(event => event.kind === 'input'), [
    { type: 'remote_channel', kind: 'input', bindingId: 'binding', id: 'image', text: '', images: ['img_native'] },
    { type: 'remote_channel', kind: 'input', bindingId: 'binding', id: 'post',
      text: 'Look\n/unknown stays a command\nsecond row', images: ['img_one', 'img_two'] },
  ]);
});

test('pairing stays text-only, even for posts whose text is the exact pairing code', async t => {
  const f = fixture(); t.after(() => f.connection.close()); await f.connect(); f.arm();
  f.inbound(message('', { message_type: 'post', content: JSON.stringify({ content: [[{ tag: 'text', text: '12345678' }]] }) }));
  f.inbound(message('', { message_type: 'image', content: JSON.stringify({ image_key: 'img_native' }) }));
  await tick();
  assert.equal(f.events.some(event => event.kind === 'candidate' || event.kind === 'input'), false);
  assert.equal(f.cards.length, 0);
  f.inbound(message('12345678'));
  assert.equal(f.events.at(-1).kind, 'candidate');
});

test('unsupported authenticated inputs get deduplicated bounded feedback and never become model text', async t => {
  const f = fixture(); t.after(() => f.connection.close()); await f.connect(); f.bind();
  const file = { message_id: 'file', message_type: 'file', content: JSON.stringify({ text: '/stop', file_key: 'file' }) };
  f.inbound(message('', file, 'other')); f.inbound(message('', { ...file, chat_id: 'other' }));
  f.inbound(message('', { ...file, chat_type: 'group' }));
  assert.equal(f.cards.length, 0);
  f.inbound(message('', file)); f.inbound(message('', file)); await tick();
  assert.equal(f.cards.length, 1);
  assert.match(JSON.stringify(f.cards[0].card), /Not supported/);
  assert.doesNotMatch(JSON.stringify(f.cards[0].card), /\/stop|file_key/);
  f.advance(3001);
  f.inbound(message('', { message_id: 'six-images', message_type: 'post', create_time: f.now(),
    content: JSON.stringify({ content: [Array.from({ length: 6 }, (_, index) => ({ tag: 'img', image_key: `img_${index}` }))] }) }));
  await tick();
  assert.equal(f.updates.length, 1);
  f.advance(3001);
  f.inbound(message('', { message_id: 'post-file', message_type: 'post', create_time: f.now(),
    content: JSON.stringify({ content: [[{ tag: 'text', text: '/stop' }, { tag: 'file', file_key: 'secret' }]] }) }));
  await tick();
  assert.equal(f.updates.length, 2);
  assert.equal(f.events.some(event => event.kind === 'input'), false);
});

test('recalls require an accepted current-binding message and owner recall, independent of reconnect cutoff', async t => {
  const f = fixture(); t.after(() => f.connection.close()); await f.connect(); f.bind();
  f.inbound(message('queued locally', { message_id: 'queued' }));
  const recall = { message_id: 'queued', chat_id: 'chat', recall_type: 'message_owner' };
  for (const invalid of [{ ...recall, message_id: 'unknown' }, { ...recall, chat_id: 'other' },
    { ...recall, recall_type: 'group_owner' }, { ...recall, recall_type: 'enterprise_manager' }]) f.recall(invalid);
  assert.equal(f.events.some(event => event.kind === 'recalled'), false);
  f.socket().onReconnecting(); f.advance(10000); f.socket().onReconnected();
  f.inbound(message('/stop', { message_id: 'offline-control', create_time: f.now() - 1 }));
  f.inbound(message('offline text', { message_id: 'offline-text', create_time: f.now() }));
  f.inbound(message('online text', { message_id: 'online-text', create_time: f.now() + 1 }));
  f.recall(recall); f.recall(recall);
  assert.deepEqual(f.events.filter(event => event.kind === 'input').map(event => event.id), ['queued', 'online-text']);
  assert.deepEqual(f.events.filter(event => event.kind === 'recalled'), [
    { type: 'remote_channel', kind: 'recalled', bindingId: 'binding', id: 'queued' },
  ]);
  assert.equal(f.connection.inputs.has('queued'), true);
  f.connection.command('unbind', { bindingId: 'binding' });
  f.connection.command('bindSaved', { bindingId: 'binding-two', peer: { actor: 'human', chat: 'chat' } });
  f.recall(recall);
  assert.equal(f.events.filter(event => event.kind === 'recalled').length, 1);
});

test('reconnect cutoff is renewed on every reconnect without clearing local receipts or reactions', async t => {
  const f = fixture(); t.after(() => f.connection.close()); await f.connect(); f.bind();
  f.inbound(message('local', { message_id: 'local' }));
  await f.connection.command('reaction', { bindingId: 'binding', messageId: 'local', active: true, phase: 'queued' });
  for (const phase of ['running', 'unknown'])
    await f.connection.command('reaction', { bindingId: 'binding', messageId: 'local', active: true, phase });
  assert.equal(f.reactions.at(-1).data.reaction_type.emoji_type, 'Typing');
  for (let index = 0; index < 2; index++) {
    f.socket().onReconnecting(); f.advance(10000); f.socket().onReconnected();
    f.inbound(message('/disconnect', { message_id: `offline-${index}`, create_time: f.now() - 1 }));
    f.inbound(message('fresh', { message_id: `fresh-${index}`, create_time: f.now() + 1 }));
  }
  assert.equal(f.connection.reactions.has('local'), true);
  assert.deepEqual(f.events.filter(event => event.kind === 'input').map(event => event.id), ['local', 'fresh-0', 'fresh-1']);
  assert.throws(() => f.connection.command('reaction', { bindingId: 'binding', messageId: 'local', active: true, phase: 'invented' }));
});

test('callbacks replayed after reconnect cannot consume a live approval token', async t => {
  const f = fixture(); t.after(() => f.connection.close()); await f.connect(); f.bind();
  await f.connection.command('card', { bindingId: 'binding', key: 'approval', title: 'Approve', text: 'Exact operation',
    actions: { token: 'token', options: ['yes'] } });
  f.socket().onReconnecting(); f.advance(10000); f.socket().onReconnected();
  const action = { token: 'token', option: 'yes' };
  f.callback(action, 'human', 'chat', f.now() - 1);
  f.callback(action, 'human', 'chat', f.now());
  assert.equal(f.events.some(event => event.kind === 'decision'), false);
  f.callback(action, 'human', 'chat', f.now() + 1);
  assert.equal(f.events.filter(event => event.kind === 'decision').length, 1);
});

test('revoke replaces the original approval with a button-free handled, expired or unavailable status', async t => {
  const f = fixture(); t.after(() => f.connection.close()); await f.connect(); f.bind();
  for (const status of ['handled', 'expired', 'unavailable'] as const) {
    const token = `token-${status}`;
    await f.connection.command('card', { bindingId: 'binding', key: status, title: 'Approve', text: 'Exact operation',
      actions: { token, options: ['yes', 'no'] } });
    await f.connection.command('revoke', { token, status });
    const update = f.updates.at(-1);
    assert.equal(update.id, `card-${f.cards.length}`);
    assert.equal(update.card.elements.some((element: any) => element.tag === 'action'), false);
    assert.match(JSON.stringify(update.card), new RegExp(status, 'i'));
    f.callback({ token, option: 'yes' });
  }
  assert.equal(f.events.some(event => event.kind === 'decision' || event.kind === 'decisionExpired'), false);
});

test('expiry fallback removes actions and emits once; only an expired same-key card can offer Refresh', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = fixture(); t.after(() => f.connection.close()); await f.connect(); f.bind();
  const card = { bindingId: 'binding', key: 'approval', title: 'Approve', text: 'Exact operation',
    actions: { token: 'approve', options: ['yes'] } };
  await assert.rejects(f.connection.command('card', { ...card, actions: { token: 'premature', options: ['Refresh / 刷新'] } }), /action/);
  await f.connection.command('card', card);
  f.advance(600001); t.mock.timers.tick(600001); await tick();
  assert.deepEqual(f.events.filter(event => event.kind === 'decisionExpired'), [
    { type: 'remote_channel', kind: 'decisionExpired', bindingId: 'binding', token: 'approve' },
  ]);
  assert.equal(f.updates.at(-1).card.elements.some((element: any) => element.tag === 'action'), false);
  f.callback({ token: 'approve', option: 'yes' });
  const refresh = { token: 'refresh', options: ['Refresh / 刷新'] };
  await assert.rejects(f.connection.command('card', { ...card, key: 'different', actions: refresh }), /action/);
  await f.connection.command('card', { ...card, actions: refresh });
  const actions = f.updates.at(-1).card.elements.find((element: any) => element.tag === 'action').actions;
  assert.deepEqual(actions.map((action: any) => action.text.content), ['Refresh / 刷新']);
  f.callback({ token: 'refresh', option: 'yes' });
  f.callback({ token: 'refresh', option: 'Refresh / 刷新' }); f.callback({ token: 'refresh', option: 'Refresh / 刷新' });
  assert.deepEqual(f.events.filter(event => event.kind === 'decision').map(event => [event.token, event.option]), [['refresh', 'Refresh / 刷新']]);
  await f.connection.command('card', { ...card, actions: { ...card.actions, token: 'fresh-approval' } });
  f.callback({ token: 'fresh-approval', option: 'yes' });
  assert.equal(f.events.filter(event => event.kind === 'decision').length, 2);
});

test('revoke during a delayed initial send settles the same receipt without resurrecting actions', async t => {
  const f = fixture(); t.after(() => f.connection.close()); await f.connect(); f.bind();
  const gate = f.holdSend();
  const card = { bindingId: 'binding', key: 'approval', title: 'Approve', text: 'Exact operation',
    actions: { token: 'token', options: ['yes'] } };
  const initial = f.connection.command('card', card);
  const revoked = f.connection.command('revoke', { token: 'token', status: 'unavailable' });
  f.callback({ token: 'token', option: 'yes' });
  gate.resolve(); await Promise.all([initial, revoked]);
  assert.equal(f.cards.length, 1);
  assert.equal(f.updates.length, 1);
  assert.equal(f.updates[0].id, 'card-1');
  assert.equal(f.updates[0].card.elements.some((element: any) => element.tag === 'action'), false);
  await f.connection.command('card', card);
  assert.equal(f.updates.at(-1).card.elements.some((element: any) => element.tag === 'action'), false);
  assert.equal(f.events.some(event => event.kind === 'decision'), false);
});

test('same-key revoke and Refresh queues preserve the newest token against late old-token revokes', async t => {
  const f = fixture(); t.after(() => f.connection.close()); await f.connect(); f.bind();
  const card = { bindingId: 'binding', key: 'approval', title: 'Approve', text: 'Exact operation',
    actions: { token: 'original', options: ['yes', 'no'] } };
  await f.connection.command('card', card);
  const originalGate = f.holdUpdate();
  const originalUpdate = f.connection.command('card', { ...card, text: 'Updated exact operation' });
  const expired = f.connection.command('revoke', { token: 'original', status: 'expired' });
  const refresh = f.connection.command('card', { ...card, actions: { token: 'refresh', options: ['Refresh / 刷新'] } });
  await f.connection.command('revoke', { token: 'original', status: 'handled' });
  f.callback({ token: 'original', option: 'yes' });
  originalGate.resolve(); await Promise.all([originalUpdate, expired, refresh]);
  const buttons = () => f.updates.at(-1).card.elements.find((element: any) => element.tag === 'action')?.actions ?? [];
  assert.deepEqual(buttons().map((button: any) => button.value), [{ token: 'refresh', option: 'Refresh / 刷新' }]);
  const refreshGate = f.holdUpdate();
  f.callback({ token: 'refresh', option: 'Refresh / 刷新' });
  const fresh = f.connection.command('card', { ...card, actions: { token: 'fresh', options: ['yes', 'no'] } });
  await f.connection.command('revoke', { token: 'refresh', status: 'unavailable' });
  refreshGate.resolve(); await fresh;
  assert.deepEqual(buttons().map((button: any) => button.value), [
    { token: 'fresh', option: 'yes' }, { token: 'fresh', option: 'no' },
  ]);
  assert.equal(f.cards.length, 1);
  assert.ok(f.updates.every(update => update.id === 'card-1'));
  f.callback({ token: 'original', option: 'yes' }); f.callback({ token: 'refresh', option: 'Refresh / 刷新' });
  f.callback({ token: 'fresh', option: 'yes' }); f.callback({ token: 'fresh', option: 'yes' });
  assert.deepEqual(f.events.filter(event => event.kind === 'decision').map(event => [event.token, event.option]), [
    ['refresh', 'Refresh / 刷新'], ['fresh', 'yes'],
  ]);
});

test('session detach fences queued cards and callbacks across reactivation without aborting the connection', async t => {
  const f = fixture(); t.after(() => f.connection.close()); await f.connect(); f.bind();
  const scope = { bindingId: 'binding', sessionKey: 'session' };
  f.connection.command('sessionScope', { ...scope, active: true });
  const card = { ...scope, key: 'run', title: 'Session', text: 'one' };
  await f.connection.command('card', card);
  const gate = f.holdUpdate(), issued = f.connection.command('card', { ...card, text: 'issued' });
  const queued = f.connection.command('card', { ...card, text: 'must not issue' });
  f.connection.command('sessionScope', { ...scope, active: false });
  await assert.rejects(f.connection.command('card', { ...card, text: 'late' }), /unavailable/);
  f.connection.command('sessionScope', { ...scope, active: true });
  gate.resolve(); await Promise.all([issued, queued]);
  assert.equal(f.updates.length, 1);
  await f.connection.command('card', { ...card, text: 'new attachment',
    actions: { token: 'token', options: ['yes'] } });
  f.connection.command('sessionScope', { ...scope, active: false });
  f.callback({ token: 'token', option: 'yes' });
  assert.equal(f.events.some(event => event.kind === 'decision'), false);
  assert.equal(f.connection.closed, undefined);
  f.inbound(message('local model remains independent', { message_id: 'still-bound' }));
  assert.equal(f.events.at(-1).kind, 'input');
});

test('late old-binding sends never create cards or follow-up updates for a new peer', async t => {
  const f = fixture(); t.after(() => f.connection.close()); await f.connect(); f.bind();
  const gate = f.holdSend(), card = { bindingId: 'binding', key: 'same-key', title: 'Old', text: 'one' };
  const issued = f.connection.command('card', card);
  const queued = f.connection.command('card', { ...card, text: 'must not issue' });
  f.connection.command('unbind', { bindingId: 'binding' });
  f.connection.command('bindSaved', { bindingId: 'replacement', peer: { actor: 'other', chat: 'other-chat' } });
  gate.resolve(); await Promise.all([issued, queued]);
  assert.equal(f.cards.length, 1); assert.equal(f.updates.length, 0);
  await f.connection.command('card', { ...card, bindingId: 'replacement', text: 'new peer' });
  assert.equal(f.cards[1].chat, 'other-chat');
  assert.equal(f.updates.length, 0);
});

test('ambiguous initial card send is terminal for its key and errors remain sanitized', async t => {
  const f = fixture(); t.after(() => f.connection.close()); await f.connect(); f.bind(); f.failSend();
  const card = { bindingId: 'binding', key: 'receipt-unknown', title: 'Result', text: 'safe' };
  await assert.rejects(f.connection.command('card', card), /^Error: Card delivery failed$/);
  await assert.rejects(f.connection.command('card', card), /^Error: Card delivery failed$/);
  assert.equal(f.cards.length, 1);
});

test('reply cards reserve a visible source, progress row and truncation notice outside the Markdown tail', async t => {
  const f = fixture(); t.after(() => f.connection.close()); await f.connect(); f.bind();
  const text = 'a'.repeat(11000) + 'THE END';
  await f.connection.command('card', { bindingId: 'binding', key: 'run', title: 's1 · Session', text,
    reply: 'working', progress: 'Reading files', truncated: true });
  const elements = f.cards[0].card.elements;
  assert.equal(elements.filter((element: any) => element.tag === 'div').length, 2);
  assert.equal(elements[1].text.content, 'Reading files');
  assert.match(elements[0].text.content, /THE END$/);
  assert.match(elements.at(-1).elements[0].content, /s1 · Session.*truncated/);
  assert.match(elements.at(-1).elements[0].content, /full text in Desktop \/ 全文见 Desktop/);
  const visible = elements.map((element: any) => element.text?.content ?? element.elements?.[0].content ?? '').join('');
  assert.ok(visible.length <= 5000);
  for (const text of ['a'.repeat(12000), 'Short but upstream-truncated']) {
    const card = remoteCard({ title: 's'.repeat(200), text, reply: 'completed', progress: 'p'.repeat(200),
      detail: 'd'.repeat(200), truncated: true });
    const footer = card.elements.at(-1).elements[0].content;
    assert.match(footer, /full text in Desktop \/ 全文见 Desktop$/);
    const visible = card.elements.map((element: any) => element.text?.content ?? element.elements?.[0].content ?? '').join('');
    assert.ok(visible.length <= 5000);
  }
  const settled = remoteCard({ title: 's1 · Session', text: '', reply: 'interrupted', detail: 'Cancelled locally' });
  assert.match(settled.elements[0].text.content, /Reply interrupted; no text response/);
  assert.match(settled.elements.at(-1).elements[0].content, /Cancelled locally/);
  await assert.rejects(f.connection.command('card', { bindingId: 'binding', key: 'bad', title: 'Bad', text: '', progress: 'x'.repeat(201) }), /Invalid card/);
  await assert.rejects(f.connection.command('card', { bindingId: 'binding', key: 'bad', title: 'Bad', text: '', truncated: 'yes' }), /Invalid card/);
});
