import { _electron as electron } from 'playwright';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';

// Renderer acceptance only; transport lifecycle/races are covered by context-maintenance.test.ts.
const server = createServer(async (req, res) => {
  for await (const _ of req) { /* Consume the isolated request. */ }
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  const chunk = (delta, finish_reason = null) => `data: ${JSON.stringify({ id: 'clm-fixture', object: 'chat.completion.chunk',
    model: 'fixture', choices: [{ index: 0, delta, finish_reason }] })}\n\n`;
  res.end(chunk({ role: 'assistant', content: 'Context fixture ready.' }) + chunk({}, 'stop') + 'data: [DONE]\n\n');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const profile = await mkdtemp(join(tmpdir(), 'desktop-clm-'));
const root = join(profile, 'step-runtime');
await mkdir(root);
await writeFile(join(profile, 'preferences.json'), JSON.stringify({ language: 'en', theme: 'dark' }));
await writeFile(join(root, 'config.toml'), 'defaultProvider = "fixture"\ndefaultModel = "fixture"\n[telemetry]\nenabled = false\n');
await writeFile(join(root, 'models.json'), JSON.stringify({ providers: { fixture: { api: 'openai-completions',
  baseUrl: `http://127.0.0.1:${server.address().port}/v1`, apiKey: 'isolated-test',
  models: [{ id: 'fixture', name: 'Context fixture', contextWindow: 32768, maxTokens: 2048 }] } } }));
const env = { ...process.env, DESKTOP_TEST_USER_DATA: profile, DESKTOP_TEST_NO_FOCUS: '1' };
delete env.ELECTRON_RUN_AS_NODE;
let app;
try {
  app = await electron.launch({ ...(process.env.DESKTOP_VERIFY_EXE ? { executablePath: process.env.DESKTOP_VERIFY_EXE }
    : { args: [resolve('.')] }), env, timeout: 60000 });
  const page = await app.firstWindow();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    window.setOpacity(0); window.setIgnoreMouseEvents(true); window.showInactive();
  });
  await page.waitForFunction(async () => Boolean((await window.desktop.snapshot()).draftId), undefined, { timeout: 60000 });
  await page.evaluate(async () => {
    const draft = await window.desktop.snapshot();
    await window.desktop.createDraftSession(draft.draftId);
    await window.desktop.command('prompt', { message: 'Hello' });
  });
  await page.waitForFunction(async () => !(await window.desktop.snapshot()).state.isStreaming);
  const snapshot = await page.evaluate(() => window.desktop.snapshot());
  await page.reload();
  await page.locator('.messages .message').first().waitFor();
  const send = event => app.evaluate(({ BrowserWindow }, data) => BrowserWindow.getAllWindows()[0].webContents.send('runtime-event', data),
    { ...event, runtimeId: snapshot.runtimeId, sessionId: snapshot.state.sessionId });
  await page.getByRole('button', { name: 'Context', exact: true }).click();
  for (const type of ['auto_clm', 'compaction']) {
    await send({ type: `${type}_start` });
    await page.getByText('Organizing context', { exact: true }).waitFor();
    await send({ type: `${type}_end` });
    await page.getByText('Organizing context', { exact: true }).waitFor({ state: 'hidden' });
  }
  const stats = { toolCalls: 0, assistantMessages: 1, tokens: { input: 100, output: 20, cacheRead: 0, cacheWrite: 0, total: 120 },
    contextUsage: { tokens: 8192, contextWindow: 32768, percent: 25 }, cost: 0 };
  await send({ type: 'desktop_stats', stats });
  await page.waitForFunction(() => document.querySelector('.context-capacity-strip')?.getAttribute('aria-valuenow') === '25');
  await app.evaluate(({ BrowserWindow }, data) => BrowserWindow.getAllWindows()[0].webContents.send('runtime-event', data),
    { type: 'desktop_stats', runtimeId: 'other-session', stats: { ...stats, contextUsage: { ...stats.contextUsage, percent: 99 } } });
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert.equal(await page.getByRole('meter', { name: 'Context occupancy', exact: true }).getAttribute('aria-valuenow'), '25');
  assert.equal(await page.getByRole('meter', { name: 'Context usage', exact: true }).getAttribute('aria-valuenow'), '25');
  assert.deepEqual(errors, []);
  console.log('Context maintenance presentation, live statistics and background-session isolation passed.');
} finally {
  const timeout = setTimeout(() => { app?.process()?.kill(); process.exit(1); }, 15000);
  try {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    if (app) {
      await app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 1 }); });
      await app.close();
    }
  } finally { clearTimeout(timeout); }
}
