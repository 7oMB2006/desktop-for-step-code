import { _electron as electron } from 'playwright';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { mkdtemp } from './test-profile.mjs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import { readingHistory } from '../tests/fixtures/session-reading-history.mjs';
import { closeDesktopFixtureAndWait } from './close-desktop-fixture.mjs';

const profile = await mkdtemp(join(tmpdir(), 'desktop-session-startup-'));
const project = join(profile, 'project'), root = join(profile, 'step-runtime');
const sessions = join(root, 'sessions'), file = join(sessions, 'large.jsonl');
const started = join(profile, 'mcp-started.log');
const output = resolve(process.env.DESKTOP_VERIFY_OUTPUT ?? 'test-results/session-startup');
await mkdir(project);
await mkdir(sessions, { recursive: true });
await mkdir(output, { recursive: true });
const before = Buffer.from(readingHistory(project));
await writeFile(file, before);
await writeFile(join(profile, 'preferences.json'), JSON.stringify({
  language: 'zh', theme: 'light', workspaces: [project], workspace: project,
}));
const config = (kind = 'slow') => [
  'defaultProvider = "fixture"', 'defaultModel = "fixture"', '[telemetry]', 'enabled = false',
  '[mcp_servers."steppage__steppage"]', 'enabled = false',
  '[mcp_servers.startup_fixture]', 'enabled = true', `startup_timeout_sec = ${kind === 'never' ? 1 : 180}`,
  `command = ${JSON.stringify(kind === 'missing' ? join(profile, 'missing-program.exe')
    : resolve('runtime/node', process.platform === 'win32' ? 'node.exe' : 'node'))}`,
  `args = [${JSON.stringify(resolve('tests/fixtures/startup-mcp.mjs'))}]`,
  '[mcp_servers.startup_fixture.env]', `FIXTURE_MCP_STARTED = ${JSON.stringify(started)}`,
  `FIXTURE_MCP_DELAY_MS = "${kind === 'slow' ? 70000 : kind === 'cold' ? 5000 : 0}"`, `FIXTURE_MCP_NEVER = "${kind === 'never' ? 1 : 0}"`,
].join('\n') + '\n';
await writeFile(join(root, 'config.toml'), config());
const payloads = [];
const server = createServer(async (request, response) => {
  let raw = '';
  for await (const part of request) raw += part;
  const payload = JSON.parse(raw);
  payloads.push(payload);
  console.log(JSON.stringify({ providerRequest: payloads.length,
    messages: payload.messages?.length, lastMessage: JSON.stringify(payload.messages?.at(-1)).slice(0, 250) }));
  const chunk = (delta, finish_reason = null) => `data: ${JSON.stringify({
    id: 'startup-fixture', object: 'chat.completion.chunk', created: 1, model: 'fixture',
    choices: [{ index: 0, delta, finish_reason }],
  })}\n\n`;
  response.writeHead(200, { 'content-type': 'text/event-stream' });
  response.end(chunk({ role: 'assistant', content: 'One explicitly accepted task.' })
    + chunk({}, 'stop') + 'data: [DONE]\n\n');
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
await writeFile(join(root, 'models.json'), JSON.stringify({ providers: { fixture: {
  baseUrl: `http://127.0.0.1:${server.address().port}/v1`, api: 'openai-completions', apiKey: 'fixture-not-a-real-key',
  models: [{ id: 'fixture', name: 'Startup fixture', contextWindow: 1000000, maxTokens: 1024 }],
} } }));
const env = { ...process.env, DESKTOP_TEST_USER_DATA: profile, DESKTOP_TEST_NO_FOCUS: '1' };
delete env.ELECTRON_RUN_AS_NODE;
const executablePath = process.env.DESKTOP_VERIFY_EXE;
const errors = [], results = {};
let app;
let phase = 'startup';
const until = async (condition, timeout = 15000) => {
  const deadline = Date.now() + timeout;
  while (!await condition()) {
    assert.ok(Date.now() < deadline, `Timed out during ${phase}`);
    await delay(50);
  }
};
try {
  app = await electron.launch({ ...(executablePath ? { executablePath } : { args: [resolve('.')] }), env, timeout: 60000 });
  const page = await app.firstWindow();
  page.on('pageerror', error => errors.push(error.message));
  await app.evaluate(({ BrowserWindow, dialog }) => {
    const window = BrowserWindow.getAllWindows()[0];
    window.setOpacity(0); window.setIgnoreMouseEvents(true); window.showInactive(); window.setSize(1360, 900);
    dialog.showMessageBox = async () => ({ response: 1 });
  });
  await page.waitForFunction(() => document.querySelectorAll('.session-row').length === 1
    && !document.querySelector('.new-chat')?.disabled, undefined, { timeout: 60000 });
  phase = 'case-sized reading and authoritative handoff while actual MCP waits 70 seconds';
  const start = performance.now();
  await page.locator('[data-reorder-id="reading-large"] > button').first().click();
  await page.waitForFunction(() => document.querySelector('.messages')?.textContent.includes('READING_HISTORY_END'),
    undefined, { timeout: 10000 });
  results.firstReadableMs = performance.now() - start;
  await until(() => page.evaluate(async () => {
    const snapshot = await window.desktop.snapshot();
    return snapshot.state?.sessionId === 'reading-large' && snapshot.state?.desktopStartup?.targetBound
      && snapshot.state.desktopStartup.modelReady && snapshot.state.desktopStartup.discovery === 'ready'
      && !document.querySelector('.session-reading-preview');
  }));
  results.authoritativeMs = performance.now() - start;
  phase = 'authoritative identity and pending-tool execution guard';
  let snapshot = await page.evaluate(() => window.desktop.snapshot());
  results.nativeTiming = snapshot.state.desktopStartup;
  assert.equal(snapshot.state.desktopStartup.discovery, 'ready');
  assert.ok(snapshot.state.desktopStartup.tools.some(tool => tool.status === 'connecting'));
  assert.ok(results.authoritativeMs < 15000, 'History and identity must not wait for the 70s handshake');
  const boundHistory = await readFile(file);
  assert.ok(boundHistory.subarray(0, before.length).equals(before), 'Restoration cannot rewrite the original history');
  console.log(JSON.stringify({ phase, sourceBytes: before.length, restoredBytes: boundHistory.length,
    appendedEntries: boundHistory.subarray(before.length).toString().trim().split('\n').filter(Boolean)
      .map(line => JSON.parse(line).type) }));
  const input = () => page.getByRole('textbox', { name: /^(消息|Message)$/ });
  await input().fill('Draft retained while tools connect');
  await input().press('Enter');
  assert.equal(await input().evaluate(element => element.value), 'Draft retained while tools connect');
  assert.ok(await page.locator('.composer-action-button').isDisabled());
  await assert.rejects(page.evaluate(() => window.desktop.command('prompt', { message: 'MUST_NOT_EXECUTE' })), /STARTUP_NOT_READY/);
  assert.ok((await readFile(file)).equals(boundHistory), 'Rejected execution must not append or repair history');
  assert.ok(await page.locator('.runtime-startup-status').isVisible());
  await page.screenshot({ path: join(output, 'connecting-light.png') });
  phase = 'narrow dark English pending status and editable draft';
  await page.evaluate(() => window.desktop.preferences({ theme: 'dark', language: 'en' }));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(700, 700));
  await page.getByRole('button', { name: 'Reconnect runtime', exact: true }).waitFor();
  assert.ok(await page.locator('.runtime-startup-status').evaluate(element => {
    const box = element.getBoundingClientRect();
    return box.top >= 0 && box.bottom < innerHeight && box.left >= 0 && box.right <= innerWidth;
  }));
  await page.screenshot({ path: join(output, 'connecting-narrow-dark.png') });
  phase = 'actual 70 second MCP completion without replacing history or draft';
  await until(() => page.evaluate(async () => {
    const snapshot = await window.desktop.snapshot();
    return snapshot.state?.desktopStartup?.tools.some(tool => tool.name === 'startup_fixture' && tool.status === 'connected');
  }), 85000);
  results.toolsConnectedMs = performance.now() - start;
  assert.ok(results.toolsConnectedMs >= 70000);
  await page.waitForFunction(() => !document.querySelector('.runtime-startup-status')
    && !document.querySelector('.composer-action-button')?.disabled);
  assert.equal(await input().evaluate(element => element.value), 'Draft retained while tools connect');
  assert.equal((await readFile(started, 'utf8')).trim().split('\n').length, 1);
  assert.ok((await readFile(file)).equals(boundHistory));
  phase = 'protected whole-worker reconnect; unconfirmed cleanup remains a hard gate';
  await writeFile(join(root, 'config.toml'), config('never'));
  await page.getByRole('button', { name: 'View', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Restart runtime', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.runtime-startup-status')?.textContent.includes('cleanup unconfirmed'),
    undefined, { timeout: 15000 });
  assert.ok(await page.locator('.composer-action-button').isDisabled());
  assert.equal(await input().evaluate(element => element.value), 'Draft retained while tools connect');
  const failed = await page.evaluate(() => window.desktop.snapshot());
  assert.equal(failed.state.desktopStartup.cleanupConfirmed, false);
  await assert.rejects(page.evaluate(() => window.desktop.command('prompt', { message: 'MUST_NOT_BYPASS_CLEANUP' })), /STARTUP_NOT_READY/);
  await page.screenshot({ path: join(output, 'cleanup-unconfirmed.png') });
  phase = 'explicit reconnect applies a corrected fixture without losing draft or history';
  await writeFile(join(root, 'config.toml'), config('fast'));
  await page.getByRole('button', { name: 'Reconnect runtime', exact: true }).click();
  await until(() => page.evaluate(async () => {
    const snapshot = await window.desktop.snapshot();
    return snapshot.runtimeId && snapshot.state?.desktopStartup?.cleanupConfirmed
      && snapshot.state.desktopStartup.tools.some(tool => tool.name === 'startup_fixture' && tool.status === 'connected')
      && !document.querySelector('.runtime-startup-status');
  }), 20000);
  snapshot = await page.evaluate(() => window.desktop.snapshot());
  assert.notEqual(snapshot.runtimeId, failed.runtimeId);
  assert.equal(snapshot.state.sessionId, 'reading-large');
  assert.equal(await input().evaluate(element => element.value), 'Draft retained while tools connect');
  assert.ok((await readFile(file)).subarray(0, before.length).equals(before));
  assert.equal(payloads.length, 0);
  phase = 'settled optional failure requires explicit confirmation and cancellation preserves the draft';
  await writeFile(join(root, 'config.toml'), config('missing'));
  await page.getByRole('button', { name: 'View', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Restart runtime', exact: true }).click();
  await until(() => page.evaluate(async () => {
    const snapshot = await window.desktop.snapshot();
    return snapshot.state?.desktopStartup?.tools.some(tool => tool.name === 'startup_fixture' && tool.status === 'failed')
      && !document.querySelector('.composer-action-button')?.disabled;
  }));
  const exclusionHistory = await readFile(file);
  assert.ok(exclusionHistory.subarray(0, before.length).equals(before));
  await input().press('Enter');
  const confirmation = page.getByRole('dialog', { name: 'Unavailable tools', exact: true });
  await confirmation.waitFor();
  assert.ok((await confirmation.textContent()).includes('startup_fixture'));
  assert.equal(payloads.length, 0);
  assert.ok((await readFile(file)).equals(exclusionHistory));
  await page.screenshot({ path: join(output, 'explicit-exclusion.png') });
  await confirmation.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.composer-input')?.value === 'Draft retained while tools connect'
    && !document.querySelector('.composer-action-button')?.disabled);
  assert.equal(payloads.length, 0);
  assert.ok((await readFile(file)).equals(exclusionHistory));
  phase = 'one confirmed submission reaches the local provider exactly once';
  await input().press('Enter');
  await confirmation.waitFor();
  await confirmation.getByRole('button', { name: 'Confirm', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.messages')?.textContent.includes('One explicitly accepted task.'),
    undefined, { timeout: 15000 });
  assert.equal(payloads.length, 1);
  assert.equal((await input().evaluate(element => element.value)), '');
  const after = await readFile(file);
  assert.ok(after.subarray(0, before.length).equals(before));
  const appended = after.subarray(exclusionHistory.length).toString().trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
  const accepted = appended.filter(entry => entry.type === 'message' && entry.message.role === 'user');
  assert.equal(accepted.length, 1);
  assert.match(JSON.stringify(accepted[0].message.content), /Draft retained while tools connect/);
  results.providerRequests = payloads.length;
  phase = 'cold draft first-send refusal retains both input and one-shot launch choice';
  await until(() => page.evaluate(async () => !(await window.desktop.snapshot()).state?.isStreaming));
  await writeFile(join(root, 'config.toml'), config('cold'));
  await page.evaluate(project => window.desktop.beginSession(project), project);
  await page.reload();
  await until(() => page.evaluate(async () => Boolean((await window.desktop.snapshot()).draftId)));
  await page.evaluate(() => window.desktop.command('set_launch_mode', { mode: 'ultracode', enabled: true }));
  await input().fill('Cold draft keeps this one-shot mode');
  await input().press('Enter');
  await until(() => page.evaluate(async () => {
    const snapshot = await window.desktop.snapshot();
    return snapshot.runtimeId && snapshot.state?.desktopStartup?.tools.some(tool => tool.status === 'connecting')
      && snapshot.launch?.ultracodeArmed
      && document.querySelector('.composer-input')?.value === 'Cold draft keeps this one-shot mode';
  }));
  const cold = await page.evaluate(() => window.desktop.snapshot());
  assert.equal(payloads.length, 1);
  assert.match(await page.locator('.app-error-banner').textContent(), /Message not sent\./);
  assert.doesNotMatch(await page.locator('.app-error-banner').textContent(), /STARTUP_NOT_READY|remote method/);
  const coldHistory = await readFile(cold.state.sessionFile, 'utf8').catch(error => {
    if (error.code === 'ENOENT') return '';
    throw error;
  });
  assert.ok(!coldHistory.includes('Cold draft keeps this one-shot mode'));
  await page.screenshot({ path: join(output, 'cold-draft-retained.png') });
  await until(() => page.evaluate(async () => {
    const snapshot = await window.desktop.snapshot();
    return snapshot.state?.desktopStartup?.tools.every(tool => !['pending', 'connecting'].includes(tool.status))
      && !document.querySelector('.composer-action-button')?.disabled;
  }));
  assert.equal(await input().evaluate(element => element.value), 'Cold draft keeps this one-shot mode');
  assert.equal((await page.evaluate(() => window.desktop.snapshot())).launch?.ultracodeArmed, true);
  assert.equal(payloads.length, 1);
  results.coldDraftInputAndModeRetained = true;
  assert.deepEqual(errors, []);
  results.rendererErrors = errors;
  results.complete = true;
  await writeFile(join(output, 'results.json'), JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results));
} catch (error) {
  console.error('Session startup acceptance failed during:', phase);
  console.error(error);
  const page = app && await app.firstWindow().catch(() => null);
  if (page) {
    await page.screenshot({ path: join(output, 'failure.png') }).catch(() => {});
    console.error(await page.evaluate(() => ({
      status: document.querySelector('.runtime-startup-status')?.textContent,
      error: document.querySelector('.app-error-banner')?.textContent,
      reading: document.querySelector('.session-reading-status')?.textContent,
    })).catch(() => null));
    console.error(await page.evaluate(async () => {
      const snapshot = await window.desktop.snapshot();
      return { status: snapshot.status, runtimeId: snapshot.runtimeId, sessionId: snapshot.state?.sessionId,
        startup: snapshot.state?.desktopStartup, timing: snapshot.runtimeStartupTiming, requests: snapshot.requests,
        native: await window.desktop.command('get_state').catch(error => String(error)) };
    }).catch(() => null));
  }
  throw error;
} finally {
  try { if (app) await closeDesktopFixtureAndWait(app); }
  finally {
    server.closeAllConnections();
    await new Promise(done => server.close(done));
  }
}
