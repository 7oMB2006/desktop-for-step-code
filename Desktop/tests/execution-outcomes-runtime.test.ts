import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type ServerResponse } from 'node:http';
import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { SessionRuntimes } from '../electron/session-runtimes';
import { isolatedEnvironment } from '../electron/runtime';
import { toolPresentation } from '../src/conversation-presentation';
import { turnChanges } from '../src/turn-changes';
import type { Message, RuntimeEvent } from '../src/contracts';

const runtime = resolve(process.env.DESKTOP_OUTCOMES_RUNTIME ?? 'runtime');

test('native edit receipts remain visible after failed or cancelled then_run', {
  skip: !existsSync(join(runtime, 'step/dist/bundle/index.js')), timeout: 30000,
}, async () => {
  const root = await mkdtemp(join(tmpdir(), 'step-outcome-receipts-'));
  const { createStepToolProfile } = await import(pathToFileURL(join(runtime, 'step/dist/bundle/index.js')).href);
  const shellPath = process.platform === 'win32' ? join(process.env.ProgramFiles ?? 'C:/Program Files', 'Git/bin/bash.exe') : '/bin/bash';
  const tools = createStepToolProfile(root, { agentDir: join(root, 'agent'), bash: { shellPath } });
  const edit = tools.find((tool: { name: string }) => tool.name === 'edit_file');
  const controller = new AbortController();
  try {
    await writeFile(join(root, 'example.txt'), 'old\n');
    const input = { path: 'example.txt', search: 'old', replace: 'new', then_run: 'exit 7' };
    const failed = await edit.execute('failed', input, undefined, undefined, { cwd: root });
    const message: Message = { ...failed, role: 'toolResult', toolName: 'edit_file', toolCallId: 'failed' };
    assert.equal(failed.isError, undefined);
    assert.equal(failed.details.thenRun.execution.exitCode, 7);
    assert.match(toolPresentation('edit_file', message, false, 'zh', input).label, /修改了文件.*验证失败.*退出码 7/);
    const input2 = { path: 'example.txt', search: 'new', replace: 'final', then_run: 'printf ready > cancel-ready; sleep 30' };
    const pending = edit.execute('cancelled', input2, controller.signal, undefined, { cwd: root })
      .then(() => assert.fail('The cancelled check must not resolve'), (error: { result: Message }) => error.result);
    const deadline = Date.now() + 10000;
    while (!existsSync(join(root, 'cancel-ready')) && Date.now() < deadline)
      await new Promise(resolve => setTimeout(resolve, 20));
    assert.ok(existsSync(join(root, 'cancel-ready')));
    controller.abort();
    const receipt = await pending;
    assert.equal(receipt.isError, true);
    assert.equal(await readFile(join(root, 'example.txt'), 'utf8'), 'final\n');
    const cancelled: Message = { ...receipt, role: 'toolResult', toolName: 'edit_file', toolCallId: 'cancelled' };
    assert.equal(toolPresentation('edit_file', cancelled, false, 'zh', input2).state, 'stopped');
    const messages: Message[] = [
      { role: 'assistant', content: [{ type: 'toolCall', name: 'edit_file', id: 'cancelled', arguments: input2 }] },
      cancelled,
    ];
    const changes = turnChanges(messages.map((message, index) => ({ message, index })));
    assert.equal(changes.files.length, 1);
    assert.equal(changes.added, 1);
    assert.equal(changes.removed, 1);
  } finally {
    controller.abort();
    await rm(root, { recursive: true, force: true });
  }
});

test('v017 native empty-turn recovery never announces completion before settlement', {
  skip: !existsSync(join(runtime, 'step/dist/bundle/step.js')), timeout: 60000,
}, async () => {
  const root = await mkdtemp(join(tmpdir(), 'step-outcomes-native-'));
  const profile = join(root, 'profile'), workspace = join(root, 'workspace');
  await mkdir(profile); await mkdir(workspace);
  let mode = 'recover', requests = 0, held: ServerResponse | undefined;
  const events: RuntimeEvent[] = [];
  const answer = (response: ServerResponse, content: string) => {
    response.write(`data: ${JSON.stringify({ id: 'outcomes', object: 'chat.completion.chunk', model: 'fixture',
      choices: [{ index: 0, delta: content ? { content } : {}, finish_reason: 'stop' }],
      usage: { prompt_tokens: 20, completion_tokens: 5, total_tokens: 25 },
    })}\n\n`);
    response.end('data: [DONE]\n\n');
  };
  const server = createServer(async (request, response) => {
    for await (const _chunk of request) { /* Drain this isolated fixture request. */ }
    requests++;
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    if (mode === 'recover' && requests === 2 || mode === 'cancel' && requests === 2) { held = response; return; }
    answer(response, mode === 'recover' && requests > 1 ? 'Recovered answer' : '');
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  await writeFile(join(profile, 'config.toml'), 'defaultProvider = "fixture"\ndefaultModel = "fixture"\n[telemetry]\nenabled = false\n');
  await writeFile(join(profile, 'models.json'), JSON.stringify({ providers: { fixture: {
    api: 'openai-completions', apiKey: 'isolated-outcomes-key',
    baseUrl: `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`,
    models: [{ id: 'fixture', name: 'Outcome fixture', contextWindow: 100000, maxTokens: 2048 }],
  } } }));
  const pool = new SessionRuntimes(event => events.push(event));
  const wait = async (predicate: () => boolean, label: string) => {
    const deadline = Date.now() + 15000;
    while (!predicate() && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20));
    assert.ok(predicate(), label);
  };
  try {
    const host = await pool.open(join(runtime, 'node', process.platform === 'win32' ? 'node.exe' : 'node'),
      join(runtime, 'step/dist/bundle/step.js'), workspace, isolatedEnvironment(profile));
    await host.rpc.request('set_auto_retry', { enabled: false });
    await host.rpc.request('prompt', { message: 'RECOVER' });
    await wait(() => Boolean(held), 'Native recovery starts its second request');
    assert.equal(host.busy, true);
    assert.equal(events.filter(event => event.type === 'desktop_task_completed').length, 0);
    assert.ok(events.some(event => event.type === 'agent_end' && event.desktopRecoveryPending));
    answer(held!, 'Recovered answer'); held = undefined;
    await wait(() => events.some(event => event.desktopRecoverySettled), 'Recovered run settles');
    assert.equal(host.busy, false);
    assert.equal(events.filter(event => event.type === 'desktop_task_completed').length, 1);
    assert.equal(requests, 2);
    const history = await host.rpc.request('get_messages');
    assert.ok(history.messages.some((message: any) => message.incomplete === 'no_visible_output'));
    assert.ok(history.messages.some((message: any) => message.customType === 'step-incomplete-turn-recovery' && message.display === false));
    const sessionFile = host.state!.sessionFile!;
    assert.match(await readFile(sessionFile, 'utf8'), /"incomplete":"no_visible_output"/);
    mode = 'exhaust'; requests = 0; events.length = 0;
    await host.rpc.request('prompt', { message: 'EXHAUST' });
    await wait(() => events.some(event => event.desktopRecoverySettled), 'Repeated empty replies settle as a failure');
    assert.equal(requests, 2, 'Only upstream performs the one allowed recovery');
    assert.equal(host.failed, true);
    assert.equal(host.busy, false);
    assert.ok(events.some(event => event.type === 'agent_settled' && event.failure?.kind === 'incomplete_turn'));
    assert.equal(events.filter(event => event.type === 'desktop_task_completed').length, 0);
    mode = 'cancel'; requests = 0; events.length = 0;
    await host.rpc.request('prompt', { message: 'CANCEL' });
    await wait(() => Boolean(held), 'Cancellable recovery starts');
    host.interrupted = true;
    await host.rpc.request('abort');
    await wait(() => events.some(event => event.desktopRecoverySettled), 'Cancellation settles without a success notification');
    assert.equal(host.busy, false);
    assert.equal(events.filter(event => event.type === 'desktop_task_completed').length, 0);
  } finally {
    await pool.stopAll(); server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    await rm(root, { recursive: true, force: true });
  }
});
