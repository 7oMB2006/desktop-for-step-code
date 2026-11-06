import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { RpcProcess, isolatedEnvironment } from '../electron/runtime';
import type { Message } from '../src/contracts';
import { messageText } from '../src/conversation-presentation';
import { submittedInputContent } from '../src/template-input';
import { PendingMessages } from '../electron/pending-messages';
import type { SessionRuntime } from '../electron/session-runtimes';

test('native template inputs keep source, model expansion and queued receipts through reopen', { timeout: 90000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'desktop-template-input-'));
  const profile = join(directory, 'profile');
  const input = '/bvr video question';
  const body = 'BVR_TEMPLATE_BODY: video question';
  const requests: string[] = [];
  const events: Message[] = [];
  let release: (() => void) | undefined;
  let holding = false;
  const server = createServer(async (request, response) => {
    let data = '';
    for await (const part of request) data += part;
    const payload = JSON.parse(data);
    assert.equal(data.includes('"desktopInput"'), false, 'Presentation metadata is not sent to the provider');
    const content = payload.messages.filter((item: any) => item.role === 'user').at(-1)?.content;
    requests.push(typeof content === 'string' ? content : content?.filter((part: any) => part.type === 'text').map((part: any) => part.text).join('\n'));
    const chunk = (delta: unknown, finish_reason: string | null = null) =>
      `data: ${JSON.stringify({ id: 'fixture', object: 'chat.completion.chunk', model: 'fixture', choices: [{ index: 0, delta, finish_reason }] })}\n\n`;
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    response.flushHeaders();
    const finish = () => response.end(chunk({ role: 'assistant', content: 'Fixture reply.' }) + chunk({}, 'stop') + 'data: [DONE]\n\n');
    if (holding) { holding = false; release = finish; } else finish();
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const runtime = resolve(process.env.DESKTOP_TEST_RUNTIME ?? 'runtime');
  const node = join(runtime, 'node', process.platform === 'win32' ? 'node.exe' : 'node');
  const entry = process.env.DESKTOP_TEST_STEP_ENTRY ?? join(runtime, 'step/dist/bundle/step.js');
  const queue = new PendingMessages(() => {}, () => assert.fail('Unexpected queue failure'));
  let worker: SessionRuntime;
  const rpc = new RpcProcess(event => {
    if (event.type === 'message_start' && event.message?.role === 'user') {
      events.push(event.message);
      queue.delivered(worker, submittedInputContent(event.message), event.message.timestamp);
    }
  });
  worker = { rpc, status: 'connected', busy: false, submissions: 0, operations: 0, pendingUI: new Map() } as unknown as SessionRuntime;
  const wait = async (condition: () => boolean | Promise<boolean>) => {
    const deadline = Date.now() + 15000;
    while (!await condition()) {
      assert.ok(Date.now() < deadline, 'Native fixture timed out');
      await new Promise(resolve => setTimeout(resolve, 25));
    }
  };
  try {
    await mkdir(join(profile, 'agent', 'prompts'), { recursive: true });
    await mkdir(join(profile, 'agent', 'skills', 'fixture-skill'), { recursive: true });
    await writeFile(join(profile, 'agent/prompts/bvr.md'), '---\ndescription: Template input fixture\n---\nBVR_TEMPLATE_BODY: $ARGUMENTS\n');
    await writeFile(join(profile, 'agent/skills/fixture-skill/SKILL.md'), '---\nname: fixture-skill\ndescription: Fixture skill\n---\nSKILL_BODY_SENTINEL\n');
    await writeFile(join(profile, 'config.toml'), 'defaultProvider = "fixture"\ndefaultModel = "fixture"\n[telemetry]\nenabled = false\n');
    await writeFile(join(profile, 'models.json'), JSON.stringify({ providers: { fixture: {
      baseUrl: `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`, api: 'openai-completions',
      apiKey: 'local-fixture-only', models: [{ id: 'fixture', name: 'Fixture', contextWindow: 32768, maxTokens: 1024 }],
    } } }));
    rpc.start(node, entry, directory, isolatedEnvironment(profile));
    await rpc.request('get_state', {}, 60000);
    const commands = (await rpc.request('get_commands')).commands;
    assert.ok(commands.some((command: any) => command.name === 'bvr' && command.source === 'prompt'));
    const send = async (message: string) => {
      const count = events.length;
      await rpc.request('prompt', { message });
      await wait(async () => !(await rpc.request('get_state')).isStreaming && events.length > count);
      return events.at(-1)!;
    };
    const first = await send(input);
    assert.deepEqual(first.desktopInput, { version: 1, text: input });
    assert.equal(messageText(first), input);
    assert.equal(requests.at(-1)?.trim(), body, 'The model still receives the full template');
    assert.equal((await send(body)).desktopInput, undefined, 'Typing template prose by hand stays ordinary text');
    assert.equal((await send('/not-a-template keep this')).desktopInput, undefined, 'Unknown slash input stays intact');
    const skill = await send('/skill:fixture-skill inspect');
    assert.equal(messageText(skill), '/skill:fixture-skill inspect');
    assert.match(requests.at(-1)!, /SKILL_BODY_SENTINEL/);
    for (const mode of ['steer', 'followUp']) {
      holding = true; release = undefined;
      await rpc.request('prompt', { message: `hold-${mode}` });
      await wait(() => Boolean(release));
      const command = `/bvr queued-${mode}`;
      const id = queue.enqueue(worker, command, { message: command });
      if (mode === 'steer') { worker.busy = true; await queue.steer(worker, id, 0); }
      else {
        await rpc.request('prompt', { message: command, streamingBehavior: 'followUp' });
      }
      release!();
      await wait(async () => !(await rpc.request('get_state')).isStreaming && messageText(events.at(-1)!) === command);
      assert.equal(events.at(-1)!.desktopInput?.text, command);
      assert.equal(requests.at(-1)?.trim(), `BVR_TEMPLATE_BODY: queued-${mode}`);
      if (mode === 'steer') assert.equal(queue.list(worker).length, 0, 'Expanded steering acknowledges the slash receipt');
      queue.clear(worker); worker.busy = false;
    }
    const before = (await rpc.request('get_messages')).messages as Message[];
    const state = await rpc.request('get_state');
    const history = await rpc.request('get_entries');
    assert.ok(history.entries.some((entry: any) => entry.message?.desktopInput?.text === input));
    await rpc.request('new_session');
    await rpc.request('switch_session', { sessionPath: state.sessionFile, cwdOverride: directory });
    const reopened = (await rpc.request('get_messages')).messages as Message[];
    assert.deepEqual(reopened.filter(message => message.role === 'user').map(messageText), before.filter(message => message.role === 'user').map(messageText));
    assert.equal(messageText(reopened.find(message => message.desktopInput?.text === input)!), input);
  } finally {
    release?.();
    await rpc.stop();
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
