import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'node:http';
import { SessionRuntimes } from '../electron/session-runtimes';
import { isolatedEnvironment } from '../electron/runtime';
import { ConversationTiming } from '../electron/conversation-timing';
import type { SessionRuntime } from '../electron/session-runtimes';
import type { RuntimeEvent } from '../src/contracts';
import { applyMessageEvent } from '../src/message-events';
import { elapsedTime } from '../src/elapsed-time';

const worker = (id: string) => ({ id, state: { sessionId: id }, messages: [] } as unknown as SessionRuntime);
function send(timing: ConversationTiming, target: SessionRuntime, event: RuntimeEvent, now: number) {
  const decorated = timing.event(target, event, now);
  target.messages = applyMessageEvent(target.messages, decorated);
  return decorated;
}

test('duration formatting covers zero, hours, and clock rollback', () => {
  assert.equal(elapsedTime({ startedAt: 1000 }, 1000), '0s');
  assert.equal(elapsedTime({ startedAt: 1000 }, 18000), '17s');
  assert.equal(elapsedTime({ startedAt: 1000 }, 84000), '1m23s');
  assert.equal(elapsedTime({ startedAt: 1000 }, 3601000), '1h0m0s');
  assert.equal(elapsedTime({ startedAt: 1000, endedAt: 3662000 }, 9000000), '1h1m1s');
  assert.equal(elapsedTime({ startedAt: 2000 }, 1000), '0s');
});

test('thinking freezes independently; total includes tools and steering; sidecar survives reopening', async () => {
  const root = await mkdtemp(join(tmpdir(), 'step-timing-'));
  try {
    const timing = new ConversationTiming(root);
    const a = worker('a');
    send(timing, a, { type: 'agent_start' }, 1000);
    send(timing, a, { type: 'message_start', message: { role: 'assistant', timestamp: 1100, content: [] } }, 1100);
    const delta = (type: string, contentIndex: number) => ({ type: 'message_update', assistantMessageEvent: { type, contentIndex } });
    send(timing, a, delta('thinking_start', 0), 2000);
    send(timing, a, delta('thinking_end', 0), 5000);
    send(timing, a, { type: 'message_end', message: { role: 'assistant', timestamp: 1100, content: [
      { type: 'thinking', thinking: 'first' }, { type: 'toolCall', id: 'tool' },
    ] } }, 5500);
    send(timing, a, { type: 'message_start', message: { role: 'toolResult', content: 'tool' } }, 6000);
    send(timing, a, { type: 'message_start', message: { role: 'user', content: 'steer', timestamp: 10000 } }, 10000);
    send(timing, a, { type: 'message_start', message: { role: 'assistant', timestamp: 12000, content: [] } }, 12000);
    send(timing, a, delta('thinking_start', 0), 13000);
    send(timing, a, delta('text_start', 1), 16000);
    send(timing, a, { type: 'message_end', message: { role: 'assistant', timestamp: 12000,
      content: [{ type: 'thinking', thinking: 'second' }, { type: 'text', text: 'done' }] } }, 18000);
    send(timing, a, { type: 'agent_end' }, 21000);
    const first = a.messages[0].desktopTiming!;
    const last = a.messages.at(-1)!.desktopTiming!;
    assert.deepEqual(first.thinking[0], { startedAt: 2000, endedAt: 5000 });
    assert.deepEqual(last.thinking[0], { startedAt: 13000, endedAt: 16000 });
    assert.deepEqual(last.run, { startedAt: 1000, endedAt: 21000 });
    await timing.flush();
    const restored = await new ConversationTiming(root).decorate('a', a.messages.map(({ desktopTiming, ...message }) => message));
    assert.deepEqual(restored, a.messages);
    const old = [{ role: 'assistant', timestamp: 1, content: 'old' }];
    assert.deepEqual(await timing.decorate('a', old), old);
    await timing.remove('a');
    assert.deepEqual(await new ConversationTiming(root).decorate('a', old), old);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('concurrent workers and unexpected exit keep independent frozen records', async () => {
  const root = await mkdtemp(join(tmpdir(), 'step-timing-concurrent-'));
  try {
    const timing = new ConversationTiming(root);
    const a = worker('a'), b = worker('b');
    for (const [target, now] of [[a, 1000], [b, 4000]] as const) {
      send(timing, target, { type: 'agent_start' }, now);
      send(timing, target, { type: 'message_start', message: { role: 'assistant', timestamp: now, content: [] } }, now);
      send(timing, target, { type: 'message_update', assistantMessageEvent: { type: 'thinking_start', contentIndex: 0 } }, now);
    }
    send(timing, a, { type: 'desktop_exit' }, 6000);
    assert.equal(a.messages[0].desktopTiming!.run.endedAt, 6000);
    assert.equal(b.messages[0].desktopTiming!.run.endedAt, undefined);
    send(timing, b, { type: 'agent_end' }, 10000);
    assert.deepEqual(b.messages[0].desktopTiming!.thinking[0], { startedAt: 4000, endedAt: 10000 });
    await timing.flush();
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('failed timing persistence settles the queue and recovers on the next write', async () => {
  const root = await mkdtemp(join(tmpdir(), 'step-timing-failure-'));
  const reported: unknown[] = [];
  try {
    // A file at the configured root makes the sidecar path unwritable without
    // relying on platform-specific permissions or a full volume.
    await rm(root, { recursive: true, force: true });
    await writeFile(root, 'temporarily unavailable', 'utf8');
    const timing = new ConversationTiming(root, error => reported.push(error));
    const first = worker('failed-write');
    send(timing, first, { type: 'agent_start' }, 1000);
    send(timing, first, { type: 'message_start', message: { role: 'assistant', timestamp: 1100, content: [] } }, 1100);
    send(timing, first, { type: 'agent_end' }, 2000);
    await timing.flush();
    assert.equal(reported.length, 1);

    await rm(root, { force: true });
    await mkdir(root);
    const second = worker('recovered-write');
    send(timing, second, { type: 'agent_start' }, 3000);
    send(timing, second, { type: 'message_start', message: { role: 'assistant', timestamp: 3100, content: [] } }, 3100);
    send(timing, second, { type: 'agent_end' }, 4000);
    await timing.flush();
    assert.equal(reported.length, 1);
    const restored = await new ConversationTiming(root).decorate('recovered-write', second.messages.map(({ desktopTiming, ...message }) => message));
    assert.equal(restored[0].desktopTiming?.run.endedAt, 4000);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('authoritative snapshots preserve the active later thinking block', () => {
  const timing = new ConversationTiming('');
  const a = worker('a');
  send(timing, a, { type: 'agent_start' }, 1000);
  const message = { role: 'assistant', timestamp: 2000, content: [
    { type: 'thinking', thinking: 'one' }, { type: 'text', text: 'text' }, { type: 'thinking', thinking: 'two' },
  ] };
  send(timing, a, { type: 'message_start', message }, 2000);
  send(timing, a, { type: 'message_update', message }, 4000);
  assert.equal(a.messages[0].desktopTiming!.thinking[2].endedAt, undefined);
  assert.equal(a.messages[0].desktopTiming!.thinking[0].endedAt, 2000);
});

test('real RPC thinking events retain timing through authoritative messages and history refresh', { timeout: 60000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'step-timing-rpc-'));
  const server = createServer(async (request, response) => {
    for await (const _ of request) { /* discard fixture input */ }
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    const chunk = (delta: unknown, finish: string | null = null) => `data: ${JSON.stringify({
      id: 'elapsed', object: 'chat.completion.chunk', created: 1, model: 'fixture',
      choices: [{ index: 0, delta, finish_reason: finish }],
    })}\n\n`;
    response.write(chunk({ role: 'assistant', reasoning_content: 'Checking the clock.' }));
    await new Promise(resolve => setTimeout(resolve, 200));
    response.write(chunk({ reasoning_content: ' Thinking is still active.' }));
    await new Promise(resolve => setTimeout(resolve, 200));
    response.write(chunk({ content: 'Done.' }));
    await new Promise(resolve => setTimeout(resolve, 200));
    response.end(chunk({}, 'stop') + 'data: [DONE]\n\n');
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const profile = join(root, 'profile');
  await mkdir(profile);
  const config = join(profile, 'fixture.json');
  await writeFile(config, JSON.stringify({ defaultProvider: 'fixture', defaultModel: 'fixture', providers: {
    fixture: { baseUrl: `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`, api: 'openai-completions',
      apiKey: 'local-test-only', models: [{ id: 'fixture', name: 'Fixture', contextWindow: 32768, maxTokens: 1024, reasoning: true }] },
  } }));
  const timing = new ConversationTiming(join(root, 'timing'));
  const events: RuntimeEvent[] = [];
  const runtimes = new SessionRuntimes(event => events.push(event), undefined, {
    event: (worker, event) => timing.event(worker, event),
    messages: (worker, messages) => timing.decorate(worker.state!.sessionId!, messages),
  });
  try {
    const target = await runtimes.open(resolve('runtime/node/node.exe'), resolve('runtime/step/dist/bundle/step.js'), root,
      { ...isolatedEnvironment(profile), STEPCODE_CONFIG_PATH: config });
    await target.rpc.request('prompt', { message: 'Acknowledge the fixture.' });
    const deadline = Date.now() + 15000;
    while (!events.some(event => event.type === 'agent_end') && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20));
    assert.ok(events.some(event => event.type === 'agent_end'));
    const observed = target.messages.find(message => message.role === 'assistant')!.desktopTiming!;
    const thinking = Object.values(observed.thinking)[0];
    assert.ok(thinking, 'upstream thinking events must be recorded');
    assert.ok(thinking.endedAt! - thinking.startedAt >= 200);
    assert.ok(observed.run.endedAt! >= thinking.endedAt!);
    await runtimes.read(target);
    assert.deepEqual(target.messages.find(message => message.role === 'assistant')!.desktopTiming, observed);
    await timing.flush();
    const restored = await new ConversationTiming(join(root, 'timing')).decorate(target.state!.sessionId!, target.messages);
    assert.deepEqual(restored, target.messages);
  } finally {
    await runtimes.stopAll();
    await new Promise<void>(resolve => server.close(() => resolve()));
    await rm(root, { recursive: true, force: true });
  }
});
