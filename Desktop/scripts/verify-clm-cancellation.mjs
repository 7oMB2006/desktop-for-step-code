import { _electron as electron } from 'playwright';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';

const oldText = 'obsolete successful observation; no new failure\n'.repeat(3500);
const retained = 'KEEP: protocol magic=d371; preserve public API.';
const text = content => typeof content === 'string' ? content : content?.filter(p => p.type === 'text').map(p => p.text).join('\n') ?? '';
let maintenanceCalls = 0;
let held;
const errors = [];
const actorInputs = [];
let summaries = 0;
const chunk = (delta, finish_reason = null, usage) => `data: ${JSON.stringify({ id: 'clm-cancel', object: 'chat.completion.chunk', model: 'fixture',
  choices: [{ index: 0, delta, finish_reason }], ...(usage ? { usage } : {}) })}\n\n`;
const server = createServer(async (req, res) => {
  try {
    let body = ''; for await (const part of req) body += part;
    const payload = JSON.parse(body);
    const all = payload.messages.map(m => text(m.content)).join('\n');
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    if (all.includes('# Automatic context edit index')) {
      maintenanceCalls++;
      const id = /- id=([^ ]+) role=assistant chars=/.exec(all)?.[1];
      assert.ok(id);
      const replacements = [{ id, text: retained }];
      const delta = all.includes('Reply with only JSON') ? { content: JSON.stringify({ replacements }) }
        : { tool_calls: [{ index: 0, id: 'edit-context', type: 'function', function: { name: 'apply_context_edit', arguments: JSON.stringify({ replacements }) } }] };
      const finish = () => res.end(chunk(delta, 'tool_calls' in delta ? 'tool_calls' : 'stop',
        { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 }) + 'data: [DONE]\n\n');
      if (maintenanceCalls === 1) { held = res; res.flushHeaders(); }
      else finish();
    } else if (text(payload.messages[0]?.content).includes('You are a context summarization assistant')) {
      summaries++;
      res.end(chunk({ role: 'assistant', content: retained }, 'stop',
        { prompt_tokens: 200, completion_tokens: 30, total_tokens: 230 }) + 'data: [DONE]\n\n');
    } else {
      assert.ok(all.includes(retained), 'Recovery actor receives retained evidence from native summarization');
      actorInputs.push(all);
      res.end(chunk({ role: 'assistant', content: 'CLM recovery completed.' }, 'stop',
        { prompt_tokens: 200, completion_tokens: 30, total_tokens: 230 }) + 'data: [DONE]\n\n');
    }
  } catch (error) { errors.push(String(error)); res.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const profile = await mkdtemp(join(tmpdir(), 'desktop-clm-cancel-ui-'));
const workspace = join(profile, 'workspace'), root = join(profile, 'step-runtime');
await mkdir(workspace); await mkdir(join(root, 'sessions'), { recursive: true });
await writeFile(join(profile, 'preferences.json'), JSON.stringify({ language: 'en', theme: 'dark', workspaces: [workspace] }));
await writeFile(join(root, 'config.toml'), 'defaultProvider = "fixture"\ndefaultModel = "fixture"\n[telemetry]\nenabled = false\n[compaction]\nreserveTokens = 8192\nkeepRecentTokens = 20000\n[compaction.autoClm]\nsoftThresholdRatio = 0.6\n');
await writeFile(join(root, 'models.json'), JSON.stringify({ providers: { fixture: {
  api: 'openai-completions', baseUrl: `http://127.0.0.1:${server.address().port}/v1`, apiKey: 'isolated-test',
  models: [{ id: 'fixture', name: 'CLM fixture', contextWindow: 64000, maxTokens: 8192 }],
} } }));
const sessionId = randomUUID(), timestamp = new Date().toISOString();
const entries = [{ type: 'session', version: 3, id: sessionId, cwd: workspace, timestamp }];
let parentId = null;
const append = entry => { const id = randomUUID().slice(0, 8); entries.push({ ...entry, id, parentId, timestamp }); parentId = id; };
append({ type: 'model_change', provider: 'fixture', modelId: 'fixture' });
append({ type: 'message', message: { role: 'user', content: 'PROTECTED USER REQUIREMENT: preserve public API.', timestamp: 1 } });
for (const [i, body] of [oldText, 'Current state; implementation and verification remain'].entries())
  append({ type: 'message', message: { role: 'assistant', content: [{ type: 'text', text: body }], timestamp: i + 2,
    provider: 'fixture', model: 'fixture', api: 'openai-completions', stopReason: 'stop',
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } } });
const sessionPath = join(root, 'sessions', `${sessionId}.jsonl`);
await writeFile(sessionPath, entries.map(entry => JSON.stringify(entry)).join('\n') + '\n');
const env = { ...process.env, DESKTOP_TEST_USER_DATA: profile, DESKTOP_TEST_NO_FOCUS: '1' };
delete env.ELECTRON_RUN_AS_NODE;
let app;
try {
  app = await electron.launch({ ...(process.env.DESKTOP_VERIFY_EXE ? { executablePath: process.env.DESKTOP_VERIFY_EXE }
    : { args: [resolve('.')] }), env, timeout: 60000 });
  const page = await app.firstWindow(); page.on('pageerror', error => errors.push(error.message));
  await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0]; window.setOpacity(0); window.setIgnoreMouseEvents(true); window.showInactive();
  });
  await page.waitForFunction(async id => (await window.desktop.snapshot()).sessions.some(s => s.id === id), sessionId, { timeout: 60000 });
  await page.evaluate(id => window.desktop.switchSession(id), sessionId);
  await page.reload(); await page.locator('.messages .message').first().waitFor();
  const input = page.getByRole('textbox', { name: 'Message', exact: true });
  await input.fill('Continue checking the protected requirement.'); await input.press('Enter');
  await page.getByText('Organizing context', { exact: true }).waitFor();
  await page.waitForFunction(async () => (await window.desktop.snapshot()).state.isCompacting);
  await input.fill('RECOVERY QUEUED MESSAGE'); await input.press('Enter');
  await page.waitForFunction(async () => (await window.desktop.snapshot()).pendingMessages.length === 1);
  await input.fill('');
  const stop = page.getByRole('button', { name: 'Stop response', exact: true });
  assert.equal(await stop.isEnabled(), true);
  await stop.click();
  await page.getByText('Organizing context', { exact: true }).waitFor({ state: 'hidden' });
  await page.waitForFunction(async () => { const s = await window.desktop.snapshot(); return !s.state.isStreaming && !s.state.isCompacting; });
  const paused = await page.evaluate(() => window.desktop.snapshot());
  assert.equal(paused.pendingMessages.length, 1);
  assert.equal(Boolean(paused.pendingMessages[0].sending), false);
  assert.equal(actorInputs.length, 0);
  const cancelled = (await readFile(sessionPath, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
  assert.equal(cancelled.some(e => e.type === 'compaction'), false);
  assert.equal(cancelled.some(e => e.customType === 'step-live-context' && !e.data?.reset), false);
  held?.end(); held = undefined;
  // Resume through the same public bridge used by the queue action; CLM remains enabled.
  await page.evaluate(item => window.desktop.command('queue_steer', { id: item.id, version: item.version }), paused.pendingMessages[0]);
  await page.waitForFunction(async () => { const s = await window.desktop.snapshot(); return !s.pendingMessages.length
    && !s.state.isStreaming && !s.state.isCompacting && s.messages.some(m => m.role === 'assistant' && m.content?.some?.(p => p.text === 'CLM recovery completed.')); }, undefined, { timeout: 60000 });
  assert.deepEqual(errors, []);
  assert.equal(maintenanceCalls, 1, 'Recovery honors the upstream maintenance cooldown');
  assert.ok(summaries > 0, 'Native threshold recovery remains available while CLM is cooling down');
  const final = await page.evaluate(() => window.desktop.snapshot());
  assert.equal(final.messages.filter(m => m.role === 'user' && text(m.content) === 'RECOVERY QUEUED MESSAGE').length, 1);
  assert.equal(actorInputs.length, 1);
  const recoveredJournal = (await readFile(sessionPath, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
  assert.equal(recoveredJournal.filter(e => e.type === 'compaction').length, 1,
    'Cancellation itself does not compact; explicit recovery may compact once under context pressure');
  assert.deepEqual(errors, []);
  console.log('Real CLM UI cancellation, IPC abort, retained queue and explicit recovery with native compaction passed.');
} finally {
  const timeout = setTimeout(() => { app?.process()?.kill(); process.exit(1); }, 15000);
  try {
    held?.end(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    if (app) { await app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 1 }); }); await app.close(); }
  } finally { clearTimeout(timeout); }
}
