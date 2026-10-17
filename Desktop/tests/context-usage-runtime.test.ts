import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { SessionRuntimes } from '../electron/session-runtimes';
import { isolatedEnvironment } from '../electron/runtime';
import type { RuntimeEvent } from '../src/contracts';

test('real runtime publishes growing context after a tool result before the turn completes', { timeout: 60000 }, async () => {
  const errors: unknown[] = [];
  const requests: any[] = [];
  let finish: (() => void) | undefined;
  const server = createServer(async (request, response) => {
    try {
      let body = '';
      for await (const chunk of request) body += chunk;
      requests.push(JSON.parse(body));
      const chunk = (delta: unknown, reason: string, promptTokens: number) =>
        `data: ${JSON.stringify({ id: 'context-usage', object: 'chat.completion.chunk', model: 'fixture',
          choices: [{ index: 0, delta, finish_reason: reason }],
          usage: { prompt_tokens: promptTokens, completion_tokens: 50, total_tokens: promptTokens + 50 } })}\n\n`;
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      if (requests.length === 1) {
        response.end(chunk({ tool_calls: [{ index: 0, id: 'read-context', type: 'function', function: {
          name: 'read_file', arguments: JSON.stringify({ path: 'context-evidence.txt' }),
        } }] }, 'tool_calls', 20000) + 'data: [DONE]\n\n');
      } else {
        finish = () => response.end(chunk({ role: 'assistant', content: 'Read completed.' }, 'stop', 40000) + 'data: [DONE]\n\n');
        response.flushHeaders();
      }
    } catch (error) {
      errors.push(error);
      response.end();
    }
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const profile = await mkdtemp(join(tmpdir(), 'desktop-context-usage-'));
  const workspace = join(profile, 'workspace');
  await mkdir(workspace);
  await writeFile(join(workspace, 'context-evidence.txt'),
    ('Context evidence: preserve protocol fields and verify the implementation. '.repeat(4) + '\n').repeat(100));
  await writeFile(join(profile, 'config.toml'),
    'defaultProvider = "fixture"\ndefaultModel = "fixture"\n[telemetry]\nenabled = false\n[compaction]\ncontextProjection = "clm-v1"\n');
  await writeFile(join(profile, 'models.json'), JSON.stringify({ providers: { fixture: {
    api: 'openai-completions', baseUrl: `http://127.0.0.1:${(server.address() as any).port}/v1`, apiKey: 'isolated-test',
    models: [{ id: 'fixture', name: 'Context usage fixture', contextWindow: 1000000, maxTokens: 8192 }],
  } } }));
  const events: RuntimeEvent[] = [];
  const pool = new SessionRuntimes(event => events.push(event));
  const waitFor = async (condition: () => boolean, label: string) => {
    const deadline = Date.now() + 20000;
    while (!condition() && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20));
    assert.ok(condition(), label);
  };
  try {
    const worker = await pool.open(resolve('runtime/node', process.platform === 'win32' ? 'node.exe' : 'node'), resolve('runtime/step/dist/bundle/step.js'),
      workspace, isolatedEnvironment(profile));
    const initialTokens = worker.stats?.contextUsage?.tokens;
    assert.equal(typeof initialTokens, 'number');
    const firstEvent = events.length;
    await worker.rpc.request('prompt', { message: 'Read context-evidence.txt using read_file, then report completion.' });
    await waitFor(() => Boolean(finish) && events.slice(firstEvent).some(event => event.type === 'desktop_stats'
      && (event.stats?.contextUsage?.tokens ?? 0) > initialTokens!), 'Live context must grow before the second model response');
    const inFlight = events.slice(firstEvent);
    assert.ok(inFlight.some(event => event.type === 'message_end' && event.message?.role === 'toolResult'
      && event.message.toolName === 'read_file'), 'The real file-reading tool must have completed');
    assert.equal(inFlight.some(event => event.type === 'agent_end'), false);
    assert.equal(worker.busy, true);
    assert.equal((await worker.rpc.request('get_state')).isStreaming, true);
    const authoritative = await worker.rpc.request('get_session_stats');
    await waitFor(() => worker.operations === 0, 'Statistics reads must settle without ending the turn');
    assert.deepEqual(worker.stats?.contextUsage, authoritative.contextUsage);
    assert.equal(worker.stats?.contextUsage?.contextWindow, 1000000);
    assert.equal(worker.stats?.contextUsage?.percent,
      worker.stats!.contextUsage!.tokens! / 1000000 * 100);
    assert.ok(requests[1].messages.some((message: any) => message.role === 'tool'
      && message.content.includes('Context evidence:')), 'The next actual model request includes the tool result');
    finish!();
    await waitFor(() => events.slice(firstEvent).some(event => event.type === 'agent_end') && !worker.busy
      && worker.operations === 0, 'The turn must complete and release its final statistics read');
    assert.deepEqual(errors, []);
    assert.equal(requests.length, 2);
  } finally {
    finish?.();
    await pool.stopAll();
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
