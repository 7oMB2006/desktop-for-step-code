import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { inflateSync } from 'node:zlib';
import { remoteCard } from '../electron/remote-card.mjs';
import { RemoteChatPreview, simulatedImage, type Scene } from './fixtures/remote-chat-model';

async function fixture(t: TestContext, scene: Scene = 'reply') {
  const preview = await RemoteChatPreview.create(scene);
  t.after(() => preview.dispose());
  return preview;
}
const pending = (preview: RemoteChatPreview) => preview.snapshot().messages.filter(message => message.approval === 'pending').at(-1)!;
const lastBot = (preview: RemoteChatPreview) => preview.snapshot().messages.filter(message => message.role === 'bot').at(-1)!;
const user = (preview: RemoteChatPreview, text: string) =>
  preview.snapshot().messages.filter(message => message.role === 'user' && message.text === text).at(-1)!;

test('real core emits one outgoing reply without receipt or completion titles', async t => {
  const preview = await fixture(t);
  await preview.send('first');
  assert.equal(user(preview, 'first').reaction, 'typing');
  const reply = lastBot(preview);
  assert.equal(reply.card?.reply, 'working');
  assert.equal(remoteCard(reply.card!).header, undefined);
  await preview.advance(1800);
  await preview.finish();
  assert.equal(preview.snapshot().messages.find(message => message.id === reply.id)?.card?.reply, 'completed');
  assert.equal(user(preview, 'first').reaction, undefined);
  assert.equal(preview.snapshot().messages.filter(message => message.id === reply.id).length, 1);
  assert.equal(preview.snapshot().messages.some(message => /Received|Completed/.test(message.card?.title ?? '')), false);
});

test('exact queue receipts retain the second identical input reaction until its own turn ends', async t => {
  const preview = await fixture(t);
  await preview.send('same content');
  const first = user(preview, 'same content').id;
  await preview.send('same content');
  const second = user(preview, 'same content').id;
  assert.notEqual(first, second);
  assert.equal(preview.snapshot().queue.length, 1);
  await preview.finish();
  const state = preview.snapshot();
  assert.equal(state.messages.find(message => message.id === first)?.reaction, undefined);
  assert.equal(state.messages.find(message => message.id === second)?.reaction, 'typing');
  assert.equal(state.jobs[0].input, second);
  await preview.finish();
  assert.equal(preview.snapshot().messages.find(message => message.id === second)?.reaction, undefined);
});

test('bare stop follows the selected target, not a task running in a previously selected session', async t => {
  const preview = await fixture(t);
  await preview.send('work in s1');
  await preview.advance(3000);
  await preview.send('/session s2');
  await preview.send('/stop');
  assert.equal(preview.snapshot().session, 's2');
  assert.equal(preview.snapshot().jobs[0].session, 's1');
  assert.match(lastBot(preview).text, /No matching task|没有仍在运行/);
  await preview.send('/stop s1');
  assert.equal(preview.snapshot().jobs.length, 0);
  const reply = preview.snapshot().messages.find(message => message.card?.reply === 'interrupted')!;
  assert.match(reply.card!.title, /^s1/);
  assert.ok(reply.text.length > 0);
  assert.equal(preview.snapshot().session, 's2');
});

test('unbound private chat cannot list, create or select sessions before or after code matching', async t => {
  const preview = await fixture(t, 'pairing');
  const count = preview.snapshot().sessions.length;
  for (const text of ['/help', '/session', '/new p2', '/session s3', '/projects']) await preview.send(text);
  assert.equal(preview.snapshot().messages.some(message => message.role === 'bot'), false);
  assert.equal(preview.snapshot().session, undefined);
  assert.equal(preview.snapshot().sessions.length, count);
  await preview.send('wrong code');
  assert.equal(user(preview, 'wrong code').reaction, undefined);
  await preview.send('12345678');
  assert.equal(user(preview, '12345678').reaction, 'ok');
  assert.equal(preview.snapshot().awaitingConfirmation, true);
  for (const text of ['/session', '/new p2', '/session s3']) await preview.send(text);
  assert.equal(preview.snapshot().sessions.length, count);
  assert.equal(preview.inputs.length, 0);
  assert.equal(preview.snapshot().connected, false);
});

test('real arm/candidate/bind confirmation lets pairing scene continue with ordinary messages', async t => {
  const preview = await fixture(t, 'pairing');
  await preview.confirm();
  assert.equal(preview.snapshot().connected, false);
  await preview.send('12345678');
  await preview.confirm();
  assert.equal(preview.snapshot().connected, true);
  assert.equal(preview.snapshot().awaitingConfirmation, false);
  assert.match(lastBot(preview).text, /已授权/);
  await preview.send('hello after confirmation');
  assert.deepEqual(preview.inputs.map(input => [input.session, input.text]), [['s1', 'hello after confirmation']]);
  assert.equal(user(preview, 'hello after confirmation').reaction, 'typing');
  assert.equal(preview.snapshot().jobs[0].scene, 'reply');
  await preview.finish();
  assert.equal(lastBot(preview).card?.reply, 'completed');
});

test('disconnect clears remote receipts and stops further replies or command effects while local work continues', async t => {
  const preview = await fixture(t);
  await preview.send('first');
  await preview.send('queued');
  await preview.advance(3000);
  await preview.send('/disconnect');
  assert.equal(preview.snapshot().connected, false);
  assert.equal(preview.snapshot().jobs.length, 1);
  assert.equal(preview.snapshot().queue.length, 1);
  assert.equal(preview.snapshot().messages.some(message => message.reaction === 'typing'), false);
  const botMessages = preview.snapshot().messages.filter(message => message.role === 'bot');
  const sessions = preview.snapshot().sessions.length;
  for (const text of ['/session', '/new p2', '/session s2', '/help', '/stop s1', 'late input']) await preview.send(text);
  assert.equal(preview.inputs.length, 2);
  assert.equal(preview.snapshot().session, undefined);
  assert.equal(preview.snapshot().sessions.length, sessions);
  await preview.advance(9000);
  assert.equal(preview.snapshot().jobs[0].input, user(preview, 'queued').id);
  await preview.finish('s1');
  assert.equal(preview.snapshot().jobs.length, 0);
  assert.deepEqual(preview.snapshot().messages.filter(message => message.role === 'bot'), botMessages);
});

test('disconnect revokes the original approval without answering its pending local request', async t => {
  const preview = await fixture(t, 'approval');
  await preview.send('test');
  await preview.advance(1500);
  const approval = pending(preview);
  await preview.send('/disconnect');
  await preview.decide(approval.id, true);
  await preview.advance(10000);
  assert.equal(preview.answers.length, 0);
  assert.equal(preview.snapshot().jobs[0].approved, undefined);
  assert.equal(preview.snapshot().messages.find(message => message.id === approval.id)?.approval, 'expired');
});

test('stopped approval cannot approve a replacement task or block its new approval card', async t => {
  const preview = await fixture(t, 'approval');
  await preview.send('first approval');
  await preview.advance(1500);
  const old = pending(preview);
  await preview.send('/stop s1');
  assert.equal(preview.snapshot().messages.find(message => message.id === old.id)?.approval, 'expired');
  await preview.send('/session s2');
  await preview.send('second approval');
  await preview.advance(1500);
  const current = pending(preview);
  assert.notEqual(current.id, old.id);
  assert.notEqual(current.token, old.token);
  await preview.decide(old.id, true);
  assert.equal(preview.answers.length, 0);
  assert.equal(preview.snapshot().jobs[0].approved, undefined);
  await preview.decide(current.id, true);
  assert.deepEqual(preview.answers.map(answer => [answer.session, answer.allowed]), [['s2', true]]);
  await preview.decide(current.id, false);
  assert.equal(preview.answers.length, 1);
  await preview.finish();
  assert.equal(preview.snapshot().jobs.length, 0);
});

test('pending approval rejects new messages instead of adding misleading accepted reactions or queue entries', async t => {
  const preview = await fixture(t, 'approval');
  await preview.send('test');
  await preview.advance(1500);
  const approval = pending(preview);
  await preview.advance(10000);
  await preview.finish();
  assert.equal(preview.snapshot().jobs[0].approved, undefined);
  await preview.send('must not queue');
  assert.equal(preview.inputs.length, 1);
  assert.equal(user(preview, 'must not queue').reaction, undefined);
  assert.equal(preview.snapshot().queue.length, 0);
  assert.match(lastBot(preview).card!.title, /Not accepted/);
  await preview.decide(approval.id, false);
  assert.equal(preview.snapshot().jobs.length, 0);
  assert.equal(preview.snapshot().messages.find(message => message.id === approval.id)?.approval, 'denied');
});

test('two sessions run concurrently and status/stop remain attached to their own workers', async t => {
  const preview = await fixture(t);
  await preview.send('A');
  await preview.send('/session s3');
  await preview.send('B');
  assert.deepEqual(preview.snapshot().jobs.map(job => job.session), ['s1', 's3']);
  assert.equal(preview.snapshot().queue.length, 0);
  await preview.send('/status s3');
  assert.match(lastBot(preview).text, /Running/);
  await preview.send('/stop');
  assert.deepEqual(preview.snapshot().jobs.map(job => job.session), ['s1']);
  assert.equal(user(preview, 'A').reaction, 'typing');
  assert.equal(user(preview, 'B').reaction, undefined);
  await preview.finish('s1');
});

test('same-session FIFO has no idle window in which a later message can overtake a queued one', async t => {
  const preview = await fixture(t);
  await preview.send('A');
  await preview.send('B');
  const b = user(preview, 'B').id;
  await preview.finish();
  await preview.send('C');
  assert.equal(preview.snapshot().jobs[0].input, b);
  assert.equal(preview.snapshot().queue[0].input, user(preview, 'C').id);
  await preview.finish();
  await preview.finish();
  assert.deepEqual(preview.starts.map(start => start.input),
    ['A', 'B', 'C'].map(text => user(preview, text).id));
});

test('empty and interrupted fake runtime outcomes keep the real outgoing completion semantics', async t => {
  const empty = await fixture(t, 'empty');
  await empty.send('empty');
  await empty.finish();
  assert.equal(lastBot(empty).card?.reply, 'completed');
  assert.equal(lastBot(empty).text, '');
  const interrupted = await fixture(t, 'interrupted');
  await interrupted.send('cancel');
  await interrupted.advance(5500);
  assert.equal(lastBot(interrupted).card?.reply, 'interrupted');
  assert.ok(lastBot(interrupted).text.length > 0);
});

test('numeric aliases, invalid slash commands and new-session creation use the production command path', async t => {
  const preview = await fixture(t);
  await preview.send('/session 3');
  assert.equal(preview.snapshot().session, 's3');
  await preview.send('/new 2');
  assert.equal(preview.snapshot().session, 's6');
  assert.equal(preview.snapshot().sessions.at(-1)?.project, 'p2');
  await preview.send('/permissions full-access');
  assert.match(lastBot(preview).text, /Unknown command/);
  assert.equal(preview.inputs.length, 0);
  assert.equal(preview.snapshot().jobs.length, 0);
});

test('first new command in the default reply scene keeps header, footer and list handles consistent', async t => {
  const preview = await fixture(t);
  assert.equal(preview.snapshot().messages.length, 2, 'Handle priming must not add setup cards');
  await preview.send('/new p2');
  const session = preview.snapshot().session;
  assert.equal(session, 's6');
  assert.match(lastBot(preview).text, new RegExp(`${session} · 新会话`));
  await preview.send('first new-session task');
  assert.equal(lastBot(preview).card?.title, `${session} · 新会话`);
  await preview.finish();
  assert.equal(lastBot(preview).card?.title, `${session} · 新会话`);
  await preview.send('/sessions');
  assert.match(lastBot(preview).text, new RegExp(`当前 / Current:[^\\n]*${session} · 新会话`));
  assert.match(lastBot(preview).text, new RegExp(`${session} · 新会话 ← 当前 / Current`));
});

test('production list includes current target, empty project entry and scoped project pagination', async t => {
  const preview = await fixture(t, 'sessions');
  assert.match(lastBot(preview).text, /当前 \/ Current:[^\n]*s1/);
  assert.match(lastBot(preview).text, /p4 · 空白项目 \(0\)[\s\S]*\/new p4/);
  await preview.send('/new p4');
  assert.equal(preview.snapshot().sessions.at(-1)?.project, 'p4');
  for (let index = 0; index < 11; index++) await preview.send('/new p2');
  const current = preview.snapshot().session;
  await preview.send('/sessions p2');
  assert.match(lastBot(preview).text, /p2 · 文档站 \(13\)/);
  assert.doesNotMatch(lastBot(preview).text, /p1 · Desktop for Step Code \(2\)/);
  assert.match(lastBot(preview).text, /\/sessions p2 2/);
  await preview.send('/sessions p2 2');
  assert.match(lastBot(preview).text, new RegExp(`${current} · 新会话 ← 当前`));
  assert.equal(preview.inputs.length, 0);
});

test('expired helper callback cannot grant approval after fake time advances past its capability lifetime', async t => {
  const preview = await fixture(t, 'approval');
  await preview.send('test');
  await preview.advance(1500);
  const approval = pending(preview);
  await preview.advance(600001);
  await preview.decide(approval.id, true);
  assert.equal(preview.answers.length, 0);
  assert.equal(preview.snapshot().jobs[0].approved, undefined);
});

test('disposing a preview unsubscribes notifications and retires the previous core before scene replacement', async t => {
  const preview = await fixture(t);
  await preview.send('work');
  let updates = 0;
  preview.subscribe(() => updates++);
  await preview.dispose();
  const count = updates;
  await preview.advance(9000);
  await preview.send('/new p2');
  assert.equal(updates, count);
  assert.equal(preview.inputs.length, 1);
});

test('tasks demo uses real read-only overview, prioritizes approval and retains the original input target', async t => {
  const preview = await fixture(t, 'tasks');
  await preview.demo();
  assert.equal(preview.snapshot().session, 's2');
  assert.deepEqual(preview.snapshot().jobs.map(job => job.session), ['s1', 's2']);
  assert.equal(preview.snapshot().queue.length, 1);
  const overview = lastBot(preview);
  assert.equal(overview.card!.overview!.total, 2);
  assert.deepEqual(overview.card!.overview!.rows.map(row => [row.ref, row.status, row.queue, row.attention]),
    [['s2', '待审批', 0, true], ['s1', '运行中', 1, false]]);
  const document = remoteCard(overview.card!);
  assert.equal(document.header?.title.content, '会话总览 · 2');
  assert.doesNotMatch(JSON.stringify(document), /Running sessions|Queue:|Read-only;|\/status s1 · \/session s1/);
  const starts = [...preview.starts], inputs = [...preview.inputs], sessions = preview.snapshot().sessions.length;
  await preview.send('/tasks');
  assert.deepEqual(preview.starts, starts);
  assert.deepEqual(preview.inputs, inputs);
  assert.equal(preview.snapshot().sessions.length, sessions);
  assert.equal(preview.snapshot().session, 's2');
});
test('empty tasks overview keeps one language and no invented active task or status shortcut', async t => {
  const preview = await fixture(t, 'tasks');
  await preview.send('/tasks');
  const overview = lastBot(preview);
  assert.equal(overview.card!.overview!.total, 0);
  assert.deepEqual(overview.card!.overview!.rows, []);
  const document = remoteCard(overview.card!);
  assert.equal(document.header?.title.content, '会话总览');
  assert.match(JSON.stringify(document), /暂无进行中的任务/);
  assert.doesNotMatch(JSON.stringify(document), /Remote Beta|Running|\/status|\/session s1|\(0\)/);
  assert.equal(preview.starts.length, 0);
});

test('recall removes only the exact queued duplicate, never the active run or its neighboring queue entry', async t => {
  const preview = await fixture(t);
  await preview.send('active');
  const active = user(preview, 'active').id;
  await preview.send('same');
  const first = user(preview, 'same').id;
  await preview.send('same');
  const second = user(preview, 'same').id;
  const starts = [...preview.starts];
  await preview.recall(first);
  assert.deepEqual(preview.snapshot().queue.map(job => job.input), [second]);
  assert.equal(preview.snapshot().messages.find(message => message.id === first)?.reaction, undefined);
  assert.equal(preview.snapshot().messages.find(message => message.id === first)?.recalled, true);
  assert.equal(preview.snapshot().messages.find(message => message.id === second)?.reaction, 'typing');
  assert.deepEqual(preview.starts, starts);
  await preview.recall(active);
  assert.equal(preview.snapshot().jobs[0].input, active);
  assert.match(lastBot(preview).text, /does not undo dispatched work[\s\S]*no task was stopped/);
  await preview.recall(first);
  assert.equal(preview.snapshot().queue.length, 1);
  await preview.finish();
  assert.equal(preview.snapshot().jobs[0].input, second);
  await preview.finish();
  assert.deepEqual(preview.starts.map(start => start.input), [active, second]);
});

test('sessionScope detach fences forwarding and image output but preserves local work and queued recall', async t => {
  const preview = await fixture(t, 'images');
  await preview.setImagesAllowed(true);
  await preview.send('keep local work');
  const reply = lastBot(preview);
  await preview.send('queued local work');
  const queued = user(preview, 'queued local work').id;
  await preview.send('/session s2');
  assert.deepEqual(preview.snapshot().sharing, ['s1', 's2']);
  await preview.send('/detach s1');
  assert.deepEqual(preview.snapshot().sharing, ['s2']);
  assert.equal(preview.snapshot().jobs[0].session, 's1');
  assert.equal(preview.snapshot().queue.length, 1);
  await assert.rejects(preview.sendImage('s1'), /active forwarding session/);
  await preview.recall(queued);
  assert.equal(preview.snapshot().queue.length, 0);
  await preview.finish('s1');
  assert.equal(preview.snapshot().messages.find(message => message.id === reply.id)?.card?.reply, 'working');
  assert.equal(preview.snapshot().messages.filter(message => message.imageSession).length, 0);
});

test('actual synthetic tool events yield one progress row and truncation on the original shared reply card', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const preview = await fixture(t, 'tasks');
  await preview.send('progress');
  const reply = lastBot(preview);
  await preview.advance(1800);
  t.mock.timers.tick(1001);
  await preview.advance(0);
  const working = preview.snapshot().messages.find(message => message.id === reply.id)!;
  assert.match(working.card!.progress!, /Active: 1.*command.*Returned: 1.*read/);
  const document = remoteCard(working.card!);
  assert.equal(document.elements.filter(element => element.tag === 'div' && element.text.tag === 'plain_text').length, 1);
  assert.deepEqual(preview.toolEvents.map(event => [event.type, event.toolName]), [
    ['tool_execution_start', 'read_file'], ['tool_execution_end', 'read_file'], ['tool_execution_start', 'run_command'],
  ]);
  assert.doesNotMatch(JSON.stringify(preview.snapshot().messages), /SIMULATED_PRIVATE_TOOL_|tests passed/i);
  await preview.advance(1500);
  await preview.finish('s1', 'Synthetic long response. '.repeat(300));
  const completed = preview.snapshot().messages.find(message => message.id === reply.id)!;
  assert.equal(completed.card?.reply, 'completed');
  assert.equal(completed.card?.truncated, true);
  assert.match(completed.card!.progress!, /Returned: 2/);
  assert.doesNotMatch(completed.card!.progress!, /Active|Missing results/);
  assert.match(JSON.stringify(remoteCard(completed.card!)), /Showing latest text \(truncated\)/);
  assert.equal(preview.snapshot().messages.filter(message => message.id === reply.id).length, 1);
});

test('simulated images require explicit opt-in, reach the real submit hook as bytes and do not imply task completion', async t => {
  const preview = await fixture(t, 'images');
  assert.equal(preview.snapshot().imagesAllowed, false);
  await preview.demo();
  assert.equal(preview.inputs.length, 0);
  assert.equal(preview.snapshot().jobs.length, 0);
  assert.match(lastBot(preview).text, /Images are not authorized/);
  await assert.rejects(preview.sendImage(), /image permission/);
  await preview.setImagesAllowed(true);
  await preview.sendImageInput('explicit simulated image');
  assert.deepEqual(preview.inputs[0].images, [simulatedImage]);
  assert.equal(preview.imageLoads.length, 1);
  assert.equal(preview.snapshot().jobs.length, 1);
  const reply = preview.snapshot().messages.find(message => message.card?.reply === 'working')!;
  assert.equal(preview.snapshot().messages.filter(message => message.role === 'bot' && message.image).length, 0);
  await preview.advance(2700);
  const outgoing = preview.snapshot().messages.filter(message => message.role === 'bot' && message.image);
  assert.equal(outgoing.length, 1);
  assert.deepEqual(outgoing[0].image, simulatedImage);
  assert.equal(outgoing[0].imageSession, 's1');
  assert.equal(preview.snapshot().jobs.length, 1);
  assert.equal(preview.snapshot().messages.filter(message => message.card?.reply === 'working').length, 1);
  await preview.advance(0);
  assert.equal(preview.snapshot().messages.filter(message => message.role === 'bot' && message.image).length, 1);
  await preview.finish();
  assert.equal(preview.snapshot().messages.find(message => message.id === reply.id)?.card?.reply, 'completed');
});

test('text-only preview model rejects images before loading bytes or accepting input', async t => {
  const preview = await fixture(t);
  await preview.setImagesAllowed(true);
  await preview.sendImageInput('unsupported model input');
  assert.equal(preview.imageLoads.length, 0);
  assert.equal(preview.inputs.length, 0);
  assert.equal(preview.starts.length, 0);
  assert.equal(preview.snapshot().jobs.length, 0);
  assert.equal(preview.snapshot().queue.length, 0);
  assert.equal(user(preview, 'unsupported model input').reaction, undefined);
  assert.match(lastBot(preview).card!.title, /Not accepted/);
  assert.match(lastBot(preview).text, /does not declare image support[\s\S]*Input was not sent/);
  await preview.send('ordinary text still works');
  assert.equal(preview.inputs.length, 1);
  assert.equal(preview.inputs[0].text, 'ordinary text still works');
  assert.equal(preview.inputs[0].images, undefined);
  assert.equal(preview.imageLoads.length, 0);
});

test('the explicit simulated image contains a complete single-pixel PNG, not an external resource', () => {
  assert.equal(simulatedImage.mimeType, 'image/png');
  const bytes = Buffer.from(simulatedImage.data, 'base64'), checked = Buffer.from(bytes);
  assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  assert.equal(bytes.readUInt32BE(16), 1);
  assert.equal(bytes.readUInt32BE(20), 1);
  for (let offset = 8; offset < bytes.length;) {
    const size = bytes.readUInt32BE(offset), end = offset + 8 + size;
    let crc = 0xffffffff;
    for (const value of bytes.subarray(offset + 4, end)) {
      crc ^= value;
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
    checked.writeUInt32BE((crc ^ 0xffffffff) >>> 0, end);
    if (bytes.toString('ascii', offset + 4, offset + 8) === 'IDAT')
      assert.equal(inflateSync(bytes.subarray(offset + 8, end)).length, 3);
    offset = end + 4;
    assert.ok(offset <= bytes.length);
  }
  assert.equal(simulatedImage.data, checked.toString('base64'));
});

test('revoking image permission blocks a live simulated output without retries and re-enabling does not replay rejected input', async t => {
  const preview = await fixture(t, 'images');
  await preview.sendImageInput('rejected before opt-in');
  await preview.setImagesAllowed(true);
  assert.equal(preview.inputs.length, 0);
  await preview.send('run before permission changes');
  await preview.setImagesAllowed(false);
  await preview.advance(2700);
  assert.equal(preview.snapshot().messages.filter(message => message.role === 'bot' && message.image).length, 0);
  assert.equal(preview.toolEvents.at(-1)?.isError, true);
  await preview.setImagesAllowed(true);
  await preview.advance(1000);
  assert.equal(preview.snapshot().messages.filter(message => message.role === 'bot' && message.image).length, 0);
  assert.equal(preview.inputs.length, 1);
  await preview.sendImage();
  assert.equal(preview.snapshot().messages.filter(message => message.role === 'bot' && message.image).length, 1);
});

test('simulated image delivery retains its source scope after selecting a peer, then rejects after disconnect', async t => {
  const preview = await fixture(t, 'images');
  await preview.setImagesAllowed(true);
  await preview.send('s1 image task');
  await preview.send('/session s2');
  await preview.sendImage('s1');
  assert.equal(lastBot(preview).imageSession, 's1');
  assert.equal(preview.snapshot().session, 's2');
  await preview.send('/disconnect');
  await assert.rejects(preview.sendImage('s1'), /active forwarding session/);
  assert.equal(preview.snapshot().jobs.length, 1);
  assert.equal(preview.snapshot().imagesAllowed, false);
  assert.deepEqual(preview.snapshot().sharing, []);
});

test('handled approval replaces actions with shared status and never answers the original request twice', async t => {
  const preview = await fixture(t, 'approval');
  await preview.send('approval');
  await preview.advance(1500);
  const approval = pending(preview);
  await preview.decide(approval.id, true);
  const handled = preview.snapshot().messages.find(message => message.id === approval.id)!;
  assert.equal(handled.approval, 'allowed');
  assert.equal(handled.card?.status, 'handled');
  assert.equal(handled.actions, undefined);
  const document = remoteCard(handled.card!, handled.actions);
  assert.match(JSON.stringify(document), /Handled \/ 已处理/);
  assert.equal(document.elements.some(element => element.tag === 'action'), false);
  await preview.decide(approval.id, false);
  assert.equal(preview.answers.length, 1);
});

test('expired approval is button-free and status refreshes the same card with a fresh pending capability', async t => {
  const preview = await fixture(t, 'approval');
  await preview.send('approval');
  await preview.advance(1500);
  const approval = pending(preview);
  await preview.advance(600001);
  const expired = preview.snapshot().messages.find(message => message.id === approval.id)!;
  assert.equal(expired.approval, 'expired');
  assert.equal(expired.actions, undefined);
  assert.equal(expired.card?.status, 'expired');
  assert.match(JSON.stringify(remoteCard(expired.card!)), /Expired \/ 已过期/);
  await preview.decide(approval.id, true);
  assert.equal(preview.answers.length, 0);
  await preview.send('/status');
  const refreshed = pending(preview);
  assert.equal(refreshed.id, approval.id);
  assert.notEqual(refreshed.token, approval.token);
  assert.equal(refreshed.card?.status, undefined);
  await preview.decide(refreshed.id, false);
  assert.equal(preview.answers.length, 1);
  assert.equal(preview.answers[0].allowed, false);
});
