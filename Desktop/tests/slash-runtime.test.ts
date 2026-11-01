import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { RpcProcess, isolatedEnvironment } from '../electron/runtime';

test('pinned slash handlers support read-only commands, cancellable dialogs and normal init delivery', { timeout: 60000 }, async () => {
  const requests: { url?: string; body: any }[] = [];
  const server = createServer(async (request, response) => {
    let body = '';
    for await (const chunk of request) body += chunk;
    requests.push({ url: request.url, body: JSON.parse(body) });
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    response.end(`data: ${JSON.stringify({ id: 'slash-init', object: 'chat.completion.chunk', model: 'fixture',
      choices: [{ index: 0, delta: { content: 'Initialization dispatch verified; no files were written.' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110 },
    })}\n\ndata: [DONE]\n\n`);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const profile = await mkdtemp(join(tmpdir(), 'desktop-slash-handlers-'));
  const workspace = join(profile, 'workspace');
  await mkdir(workspace);
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  await writeFile(join(profile, 'config.toml'), 'defaultProvider = "fixture"\ndefaultModel = "fixture"\n[telemetry]\nenabled = false\n');
  await writeFile(join(profile, 'models.json'), JSON.stringify({ providers: { fixture: {
    api: 'openai-completions', baseUrl: `${origin}/v1`, apiKey: 'isolated-test',
    models: [{ id: 'fixture', name: 'Slash fixture', contextWindow: 100000, maxTokens: 2048 }],
  } } }));
  const events: any[] = [];
  const rpc = new RpcProcess(event => {
    events.push(event);
    if (event.type === 'extension_ui_request' && ['select', 'input', 'confirm', 'editor'].includes(event.method))
      rpc.respond({ id: event.id, cancelled: true });
  });
  try {
    rpc.start(resolve('runtime/node', process.platform === 'win32' ? 'node.exe' : 'node'),
      resolve('runtime/step/dist/bundle/step.js'), workspace,
      { ...isolatedEnvironment(profile), STEPCODE_FEEDBACK_ENDPOINT: `${origin}/feedback` },
      // Desktop workers spawn with the same flag; without it the runtime only sends durable events.
      ['--include-live-events']);
    const { commands } = await rpc.request('get_commands');
    const manifest = JSON.parse(await readFile(resolve('runtime/manifest.json'), 'utf8'));
    assert.equal(manifest.commit, '81e79bc4b699148d6823fedde9b5e70d9a80255f');
    assert.equal(commands.some((command: { name: string }) => command.name === 'usage'), true,
      'Native Usage registration matches the staged baseline; Desktop provides its own Usage mapping');
    for (const name of ['todos', 'workflows', 'cron', 'feedback', 'plugin', 'plan', 'goal', 'ultracode', 'init']) {
      assert.ok(commands.some((command: { name: string }) => command.name === name), `${name} is registered`);
    }
    const prompt = async (message: string) => {
      events.length = 0;
      await rpc.request('prompt', { message });
      return events.filter(event => event.type === 'extension_ui_request');
    };
    const notifications = (events: any[]) => events.filter(event => event.method === 'notify').map(event => event.message).join('\n');
    assert.match(notifications(await prompt('/todos')), /No tasks tracked/);
    assert.match(notifications(await prompt('/workflows')), /Saved workflows: none/);
    assert.match(notifications(await prompt('/clm')), /CLM revision/);
    assert.match(notifications(await prompt('/cron list')), /No cron jobs/);
    assert.match(notifications(await prompt('/goal status')), /No goal is currently set/);
    assert.match(notifications(await prompt('/ultracode status')), /Ultracode|Ultraloop|Ultra/);
    await prompt('/plan');
    assert.ok(events.some(event => event.statusKey === 'plan-mode' && event.statusText), 'Plan mode publishes runtime state');
    assert.match(notifications(await prompt('/plan')), /Plan mode disabled/);
    assert.ok((await prompt('/plugin')).some(event => event.method === 'select' && event.title === 'Plugins'));
    assert.ok((await prompt('/feedback')).some(event => event.method === 'select' && event.title === 'Feedback category'));
    assert.equal(requests.length, 0, 'Read-only commands and cancelled dialogs do not call a model or submit feedback');
    await prompt('/init');
    const deadline = Date.now() + 20000;
    while (!events.some(event => event.type === 'agent_end') && Date.now() < deadline)
      await new Promise(resolve => setTimeout(resolve, 20));
    assert.ok(events.some(event => event.type === 'agent_end'), 'Init completes a normal isolated model turn');
    assert.ok(events.some(event => event.type === 'message_update'),
      'Streaming model frames reach the RPC consumer; the runtime drops them without --include-live-events');
    assert.equal(requests.length, 1);
    assert.match(requests[0].body.messages.map((message: any) => message.content).join('\n'), /AGENTS\.md/);
    assert.ok(!requests.some(request => request.url === '/feedback'));
  } finally {
    await rpc.stop();
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
