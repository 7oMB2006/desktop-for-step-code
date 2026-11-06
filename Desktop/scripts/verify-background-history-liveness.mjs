import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron as electron } from 'playwright';
import { closeDesktopFixture } from './close-desktop-fixture.mjs';

const profile = await realpath(await mkdtemp(join(tmpdir(), 'desktop-background-liveness-')));
const runtime = join(profile, 'step-runtime');
const origin = join(profile, 'origin');
const destination = join(profile, 'destination');
await mkdir(join(runtime, 'sessions'), { recursive: true });
await mkdir(origin); await mkdir(destination);
const sessionId = 'stale-background-history';
const timestamp = new Date().toISOString();
await writeFile(join(runtime, 'sessions', `${sessionId}.jsonl`), [
  { type: 'session', version: 3, id: sessionId, cwd: origin, timestamp },
  { type: 'message', id: 'user', parentId: null, timestamp,
    message: { role: 'user', content: 'Inspect this project', timestamp: Date.now() } },
  { type: 'message', id: 'call', parentId: 'user', timestamp,
    message: { role: 'assistant', content: [{ type: 'toolCall', id: 'subagent-call', name: 'subagent',
      arguments: { agent: 'general', task: 'Historical task', run_in_background: true } }], stopReason: 'toolUse', timestamp: Date.now() } },
  { type: 'message', id: 'result', parentId: 'call', timestamp,
    message: { role: 'toolResult', toolName: 'subagent', toolCallId: 'subagent-call', content: 'Started',
      details: { agentId: 'lane_deadbeef', status: 'running', results: [] }, timestamp: Date.now() } },
  { type: 'session_info', id: 'name', parentId: 'result', timestamp, name: 'Stale background history' },
].map(value => JSON.stringify(value)).join('\n') + '\n');
await writeFile(join(profile, 'preferences.json'), JSON.stringify({ theme: 'dark', language: 'en', workspace: origin,
  workspaces: [origin, destination] }));
await writeFile(join(runtime, 'config.toml'), 'defaultProvider = "fixture"\ndefaultModel = "fixture"\npermissionPreset = "ask"\n[telemetry]\nenabled = false\n');
let modelRequests = 0;
let heldChild;
const failures = [];
const messageText = message => typeof message?.content === 'string' ? message.content
  : message?.content?.filter(block => block.type === 'text').map(block => block.text).join('\n') ?? '';
const server = createServer(async (request, response) => {
  try {
    let raw = ''; for await (const part of request) { raw += part; assert.ok(raw.length < 8 * 1024 * 1024); }
    const body = JSON.parse(raw);
    modelRequests++;
    const task = [...body.messages].reverse().filter(message => message.role === 'user')
      .map(messageText).find(text => /LIVENESS-PARENT|LIVENESS-CHILD/.test(text)) ?? '';
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    const send = (delta, reason = null) => response.write(`data: ${JSON.stringify({ id: 'liveness', object: 'chat.completion.chunk',
      model: body.model, choices: [{ index: 0, delta, finish_reason: reason }] })}\n\n`);
    send({ role: 'assistant', content: '' });
    if (task === 'LIVENESS-CHILD') { heldChild = response; send({ content: 'Held child output.' }); return; }
    if (task === 'LIVENESS-PARENT' && !body.messages.some(message => message.role === 'tool' && message.tool_call_id === 'live-call')) {
      send({ tool_calls: [{ index: 0, id: 'live-call', type: 'function', function: { name: 'subagent',
        arguments: JSON.stringify({ agent: 'general', task: 'LIVENESS-CHILD', run_in_background: true }) } }] }, 'tool_calls');
    } else send({ content: 'Parent idle.' }, 'stop');
    response.end('data: [DONE]\n\n');
  } catch (error) { failures.push(error.message); if (!response.headersSent) response.writeHead(500); response.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
await writeFile(join(runtime, 'models.json'), JSON.stringify({ providers: { fixture: { api: 'openai-completions',
  baseUrl: `http://127.0.0.1:${server.address().port}/v1`, apiKey: 'fixture', models: [{ id: 'fixture', name: 'fixture', contextWindow: 100000, maxTokens: 1024 }] } } }));
const env = { ...process.env, DESKTOP_TEST_USER_DATA: profile, DESKTOP_TEST_NO_FOCUS: '1' };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({
  ...(process.env.DESKTOP_VERIFY_EXE ? { executablePath: process.env.DESKTOP_VERIFY_EXE, args: [] } : { args: [resolve('.')] }),
  env, timeout: 60000,
});
try {
  const page = await app.firstWindow();
  await page.waitForFunction(() => document.querySelector('.new-chat')?.disabled === false);
  const before = await page.evaluate(id => window.desktop.navigateSession(id), sessionId);
  assert.ok(before && before.runtimeId && before.state?.sessionId === sessionId, 'Native navigation returns the exact saved session');
  const owner = before.runtimes?.find(runtime => runtime.runtimeId === before.runtimeId && runtime.sessionId === sessionId);
  assert.ok(owner, 'The navigated host is present in the runtime roster');
  assert.deepEqual(owner.background, { status: 'known', lanes: [] });
  const native = await page.evaluate(({ runtimeId, sessionId }) => window.desktop.backgroundAgents(runtimeId, sessionId),
    { runtimeId: before.runtimeId, sessionId });
  assert.deepEqual(native.lanes, []);
  const current = await page.evaluate(() => window.desktop.snapshot());
  assert.equal(current.state?.sessionId, sessionId);
  const moved = await page.evaluate(({ sessionId, destination }) => window.desktop.moveSessionToProject(sessionId, destination),
    { sessionId, destination });
  assert.equal(moved.sessions.find(session => session.id === sessionId).cwd, destination);
  assert.equal(moved.state.sessionId, sessionId);
  assert.equal(moved.preferences.workspaceSessionRedirects[sessionId], destination);
  assert.equal(modelRequests, 0, 'Reading liveness and moving a saved session never calls the model');
  const history = await readFile(join(runtime, 'sessions', `${sessionId}.jsonl`), 'utf8');
  assert.match(history, /"status":"running"/, 'Movement does not rewrite the unresolved historical record');
  await page.reload();
  await page.waitForFunction(id => window.desktop.snapshot().then(value => value.state?.sessionId === id), sessionId);
  const record = page.getByRole('button', { name: /Open subagent record: Outcome unknown, Historical task/ });
  await record.waitFor();
  await record.click();
  await page.getByText('History has no final state and the current runtime is not executing this record.', { exact: true }).waitFor();
  assert.equal(await page.locator('.lane-row .subagent-status-icon[data-state="running"]').count(), 0);
  await page.locator('#subagent-panel').getByRole('button', { name: 'Close panel', exact: true }).click();
  await page.locator('.right-tool-rail').getByRole('button', { name: 'Summary', exact: true }).click();
  await page.locator('.sb-agent-row[data-agent-status="unknown"]').waitFor();
  await page.getByRole('button', { name: 'Close panel', exact: true }).click();
  await page.evaluate(() => window.desktop.command('prompt', { message: '/permissions approve-for-me' }));
  await page.evaluate(() => window.desktop.command('prompt', { message: 'LIVENESS-PARENT' }));
  const deadline = Date.now() + 30000;
  while (!heldChild) {
    assert.deepEqual(failures, []);
    const snapshot = await page.evaluate(() => window.desktop.snapshot());
    for (const pending of snapshot.requests ?? []) await page.evaluate(request => window.desktop.command('extension_ui_response',
      { id: request.id, confirmed: true }, request.runtimeId), pending);
    assert.ok(Date.now() < deadline, 'The real background child reaches its held provider request');
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  await page.waitForFunction(() => window.desktop.snapshot().then(value => !value.state.isStreaming
    && value.runtimes.some(runtime => runtime.backgroundCount === 1)));
  const running = await page.evaluate(() => window.desktop.snapshot());
  const redirects = running.preferences.workspaceSessionRedirects;
  await assert.rejects(page.evaluate(({ sessionId, origin }) => window.desktop.moveSessionToProject(sessionId, origin),
    { sessionId, origin }), /background agents/);
  assert.deepEqual((await page.evaluate(() => window.desktop.snapshot())).preferences.workspaceSessionRedirects, redirects);
  assert.deepEqual(failures, []);
  console.log('Background history liveness passed: unknown chat/Agent/summary, read-only history, safe movement after reopen and real active-lane movement protection.');
} finally {
  await closeDesktopFixture(app);
  server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
}
