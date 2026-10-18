import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { SessionRuntimes } from '../electron/session-runtimes';
import { isolatedEnvironment } from '../electron/runtime';
import { sessionSummary } from '../electron/session-summary';

test('real pinned runtime exposes status without prompts, model calls or instruction content', {
  timeout: 60000, skip: process.platform !== 'win32' && 'The frozen macOS runtime does not expose status details',
}, async () => {
  let modelRequests = 0;
  const server = createServer(async (request, response) => {
    for await (const _ of request) { /* No prompt should arrive. */ }
    modelRequests++;
    response.writeHead(500); response.end();
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const profile = await mkdtemp(join(tmpdir(), 'desktop-session-status-'));
  const workspace = join(profile, 'workspace');
  await mkdir(workspace);
  await writeFile(join(workspace, 'AGENTS.md'), 'Status fixture instruction content must never be returned.');
  await writeFile(join(profile, 'config.toml'),
    'defaultProvider = "fixture"\ndefaultModel = "fixture"\n[telemetry]\nenabled = false\n');
  const endpoint = `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`;
  await writeFile(join(profile, 'models.json'), JSON.stringify({ providers: { fixture: {
    api: 'openai-completions', baseUrl: endpoint, apiKey: 'fixture-key-not-for-display',
    models: [{ id: 'fixture', name: 'Status fixture', contextWindow: 32768, maxTokens: 1024 }],
  } } }));
  const pool = new SessionRuntimes(() => {});
  try {
    const worker = await pool.open(resolve('runtime/node/node.exe'), resolve('runtime/step/dist/bundle/step.js'),
      workspace, isolatedEnvironment(profile));
    const before = await worker.rpc.request('get_state');
    const raw = await worker.rpc.request('get_desktop_summary');
    const result = sessionSummary(raw, before.sessionId);
    assert.equal(typeof result.status?.trusted, 'boolean');
    assert.equal(result.status?.provider, 'fixture');
    assert.equal(result.status?.model, 'fixture');
    assert.equal(result.status?.endpoint, endpoint);
    assert.ok(['fallback', 'embedded', 'override'].includes(result.status!.versionSource!));
    assert.equal(typeof result.status?.version, 'string');
    assert.ok(Array.isArray(result.status?.agents));
    if (result.status?.trusted) assert.ok(result.status.agents?.includes(join(workspace, 'AGENTS.md')));
    assert.equal(JSON.stringify(raw).includes('instruction content must never'), false);
    assert.equal(JSON.stringify(raw).includes('fixture-key-not-for-display'), false);
    const after = await worker.rpc.request('get_state');
    assert.equal(after.sessionId, before.sessionId);
    assert.equal(after.messageCount, before.messageCount);
    assert.equal(modelRequests, 0);
    assert.equal(worker.busy, false);
  } finally {
    await pool.stopAll();
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
