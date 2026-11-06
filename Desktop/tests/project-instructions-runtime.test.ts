import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { RpcProcess, isolatedEnvironment } from '../electron/runtime';
import { projectInstructionsMessage } from '../electron/project-instructions';
// @ts-expect-error Staged Node ESM adapter.
import { createDesktopSessionSearch } from '../electron/session-search.mjs';
import { pathToFileURL } from 'node:url';
import register from '../electron/project-instructions-extension';
import { once } from 'node:events';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';

test('native prompt preflight failures do not arm restrictions and permit a later retry', async () => {
  const upstream = await import(pathToFileURL(resolve('runtime/step/dist/bundle/index.js')).href);
  const events = new Map<string, (...args: any[]) => any>();
  let tools = ['read_file', 'write_file', 'run_command'];
  register({
    registerTool() {},
    on: (name: string, handler: (...args: any[]) => any) => events.set(name, handler),
    getActiveTools: () => [...tools],
    setActiveTools: (names: string[]) => { tools = names; },
  });
  const prompt = (await projectInstructionsMessage(process.cwd(), '/init'));
  const host: any = {
    isStreaming: false, model: undefined, _extensionRunner: { hasHandlers: () => false },
    _flushPendingBashMessages() {}, _flushPendingCustomMessages() {}, _expandSkillCommand: (text: string) => text,
    promptTemplates: [], _modelRuntime: { hasConfiguredAuth: () => false, checkAuth: async () => undefined, isUsingOAuth: () => false },
  };
  await assert.rejects(upstream.AgentSession.prototype.prompt.call(host, prompt), /model/i);
  host.model = { provider: 'missing' };
  await assert.rejects(upstream.AgentSession.prototype.prompt.call(host, prompt), /API key|Authentication/i);
  assert.deepEqual(tools, ['read_file', 'write_file', 'run_command']);
  assert.equal(events.get('tool_call')!({ toolName: 'write_file' }), undefined);
  events.get('before_agent_start')!({ prompt, systemPrompt: 'BASE SYSTEM' }, { cwd: process.cwd() });
  assert.equal(events.get('tool_call')!({ toolName: 'write_file' }).block, true, 'A later valid retry still arms its own guard');
  events.get('agent_settled')!();
  assert.deepEqual(tools, ['read_file', 'write_file', 'run_command']);
});

test('real native init creates once, checks read-only, then restores ordinary tools', { timeout: 60000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'desktop-native-rules-'));
  const cwd = join(root, 'workspace');
  await mkdir(cwd);
  const original = '# Project rules\nPreserve human-authored documents.\n';
  const requests: any[] = [];
  const failures: string[] = [];
  let retryReview = true;
  const prose = (message: any): string => typeof message?.content === 'string' ? message.content
    : message?.content?.filter((block: any) => block.type === 'text').map((block: any) => block.text).join('\n') ?? '';
  const server = createServer(async (request, response) => {
    try {
      let raw = '';
      for await (const chunk of request) raw += chunk;
      const body = JSON.parse(raw);
      requests.push(body);
      const latest = [...body.messages].reverse().find((message: any) => message.role === 'user');
      const prompt = prose(latest);
      const system = body.messages.filter((message: any) => message.role === 'system').map(prose).join('\n');
      const last = body.messages.at(-1);
      let delta: any = { content: 'Checked the project; no update was applied.' };
      let reason = 'stop';
      if (last?.role !== 'tool' && system.includes('Mode: create.')) {
        assert.equal(prompt, '/init');
        assert.ok(body.tools.some((tool: any) => tool.function.name === 'desktop_create_project_instructions'));
        assert.ok(!body.tools.some((tool: any) => ['write_file', 'run_command', 'subagent'].includes(tool.function.name)));
        delta = { tool_calls: [{ index: 0, id: 'create-rules', type: 'function',
          function: { name: 'desktop_create_project_instructions', arguments: JSON.stringify({ content: original }) } }] };
        reason = 'tool_calls';
      } else if (last?.role !== 'tool' && system.includes('Mode: review, read-only.')) {
        assert.equal(prompt, '/init');
        assert.ok(!body.tools.some((tool: any) => ['write_file', 'run_command', 'subagent', 'desktop_create_project_instructions'].includes(tool.function.name)));
        if (retryReview) {
          retryReview = false;
          response.writeHead(503, { 'content-type': 'application/json' });
          response.end(JSON.stringify({ error: { message: 'Temporary service failure' } }));
          return;
        }
        // A misbehaving provider must still be unable to overwrite the file.
        delta = { tool_calls: [{ index: 0, id: 'forbidden-overwrite', type: 'function',
          function: { name: 'write_file', arguments: JSON.stringify({ path: 'AGENTS.md', content: 'OVERWRITTEN' }) } }] };
        reason = 'tool_calls';
      } else if (prompt === 'Ordinary work after checking') {
        assert.doesNotMatch(system, /Desktop project AI instructions/);
        assert.ok(body.tools.some((tool: any) => tool.function.name === 'write_file'));
        assert.ok(body.tools.some((tool: any) => tool.function.name === 'run_command'));
        assert.ok(!body.tools.some((tool: any) => tool.function.name === 'desktop_create_project_instructions'));
      }
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      response.end(`data: ${JSON.stringify({ id: `rules-${requests.length}`, object: 'chat.completion.chunk', model: 'fixture',
        choices: [{ index: 0, delta, finish_reason: reason }] })}\n\ndata: [DONE]\n\n`);
    } catch (error) {
      failures.push(String(error));
      if (!response.headersSent) response.writeHead(500);
      response.end();
    }
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  await writeFile(join(root, 'config.toml'), 'defaultProvider = "fixture"\ndefaultModel = "fixture"\n[telemetry]\nenabled = false\n');
  await writeFile(join(root, 'models.json'), JSON.stringify({ providers: { fixture: {
    api: 'openai-completions', baseUrl: `${origin}/v1`, apiKey: 'isolated-fixture',
    models: [{ id: 'fixture', name: 'Rules fixture', contextWindow: 100000, maxTokens: 2048 }],
  } } }));
  const events: any[] = [];
  const rpc = new RpcProcess(event => {
    events.push(event);
    if (event.type === 'extension_ui_request' && event.method === 'confirm') rpc.respond({ id: event.id, confirmed: true });
  });
  try {
    rpc.start(resolve('runtime/node', process.platform === 'win32' ? 'node.exe' : 'node'),
      resolve('runtime/step/dist/bundle/step.js'), cwd, isolatedEnvironment(root),
      ['--include-live-events', '--extension', resolve('electron/project-instructions-extension.ts')]);
    const prompt = async (message: string) => {
      events.length = 0;
      await rpc.request('prompt', { message: await projectInstructionsMessage(cwd, message) });
      const deadline = Date.now() + 15000;
      while (!events.some(event => event.type === 'agent_settled') && Date.now() < deadline)
        await new Promise(resolve => setTimeout(resolve, 20));
      assert.ok(events.some(event => event.type === 'agent_settled'), 'Native project rules task settles fully');
      assert.deepEqual(failures, []);
    };
    await prompt('/init');
    assert.equal(await readFile(join(cwd, 'AGENTS.md'), 'utf8'), original);
    await prompt('/init');
    assert.equal(await readFile(join(cwd, 'AGENTS.md'), 'utf8'), original);
    assert.ok(events.some(event => event.type === 'tool_execution_end' && event.toolName === 'write_file' && event.isError));
    assert.ok(events.some(event => event.type === 'auto_retry_start'), 'Native recovery was actually exercised');
    await prompt('Ordinary work after checking');
    const history = await rpc.request('get_messages');
    const initInputs = history.messages.filter((message: any) => message.role === 'user')
      .map(prose).filter((text: string) => text === '/init');
    assert.equal(initInputs.length, 2, 'Saved init inputs preserve the original visible /init');
    const entries = await rpc.request('get_entries');
    assert.equal(JSON.stringify(entries).includes('Desktop project AI instructions'), false, 'No internal template is persisted');
    const upstream = await import(pathToFileURL(resolve('runtime/step/dist/bundle/index.js')).href);
    const search = createDesktopSessionSearch(upstream, { storageRoot: root, agentDir: join(root, 'agent'), sessions: join(root, 'sessions') });
    try {
      let result;
      for (let attempt = 0; attempt < 80; attempt++) {
        result = await search.query({ id: 'init-search', text: '/init' });
        if (result.index.state === 'ready' && result.hits.length) break;
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      assert.ok(result.hits.some((hit: any) => hit.entryId && hit.snippet.includes('/init')));
      assert.equal((await search.query({ id: 'template-search', text: 'Desktop project AI instructions' })).hits.length, 0);
    } finally { await search.close(); }
  } finally {
    const child = (rpc as unknown as { child?: ChildProcessWithoutNullStreams }).child;
    if (child && child.exitCode === null) {
      const exited = once(child, 'exit');
      const timer = setTimeout(() => { child.kill(); }, 5000);
      child.stdin.end();
      try { await exited; } finally { clearTimeout(timer); }
    }
    await rpc.stop();
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
