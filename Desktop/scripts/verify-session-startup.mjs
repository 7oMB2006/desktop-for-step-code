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

const scratch = resolve(process.env.DESKTOP_TEST_SCRATCH ?? tmpdir());
await mkdir(scratch, { recursive: true });
const profile = await mkdtemp(join(scratch, 'desktop-session-startup-'));
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
const config = (kind = 'slow', release) => [
  'defaultProvider = "fixture"', 'defaultModel = "fixture"', '[telemetry]', 'enabled = false',
  '[mcp_servers."steppage__steppage"]', 'enabled = false',
  '[mcp_servers.startup_fixture]', `enabled = ${kind !== 'disabled'}`, `startup_timeout_sec = ${kind === 'never' ? 1 : 180}`,
  `command = ${JSON.stringify(kind === 'missing' ? join(profile, 'missing-program.exe')
    : resolve('runtime/node', process.platform === 'win32' ? 'node.exe' : 'node'))}`,
  `args = [${JSON.stringify(resolve('tests/fixtures/startup-mcp.mjs'))}]`,
  '[mcp_servers.startup_fixture.env]', `FIXTURE_MCP_STARTED = ${JSON.stringify(started)}`,
  `FIXTURE_MCP_DELAY_MS = "${kind === 'slow' ? 70000 : 0}"`, `FIXTURE_MCP_NEVER = "${kind === 'never' ? 1 : 0}"`,
  ...(release ? [`FIXTURE_MCP_RELEASE = ${JSON.stringify(release)}`] : []),
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
const entry = process.env.DESKTOP_VERIFY_ENTRY;
const executionRoot = resolve(process.env.DESKTOP_VERIFY_ROOT ?? '.');
assert.ok(!executablePath || !entry, 'Choose an executable or a main entry, not both');
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
  app = await electron.launch({ ...(executablePath ? { executablePath } : { args: [entry ?? executionRoot] }),
    cwd: executionRoot, env, timeout: 60000 });
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
  const openPlugins = async () => {
    if (await page.locator('.window-sidebar-toggle').getAttribute('aria-expanded') === 'false')
      await page.locator('.window-sidebar-toggle').click();
    await page.locator('.sidebar-plugins-entry').click();
  };
  await input().fill('Draft retained while tools connect');
  await input().press('Enter');
  assert.equal(await input().evaluate(element => element.value), 'Draft retained while tools connect');
  assert.ok(await page.locator('.composer-action-button').isDisabled());
  await assert.rejects(page.evaluate(() => window.desktop.command('prompt', { message: 'MUST_NOT_EXECUTE' })), /STARTUP_NOT_READY/);
  assert.ok((await readFile(file)).equals(boundHistory), 'Rejected execution must not append or repair history');
  assert.equal(await page.locator('.runtime-startup-trigger').count(), 0, 'No tool status control in the composer');
  assert.equal(await page.locator('.sidebar-plugins-dot').count(), 0, 'Connecting is not an error');
  assert.ok(!await page.locator('.runtime-startup-status').isVisible(), 'Tool details stay outside the conversation');
  await openPlugins();
  assert.ok(await page.locator('.runtime-startup-status').isVisible());
  assert.equal(await page.locator('.runtime-startup-status summary').getAttribute('aria-expanded'), 'false');
  await page.locator('.runtime-startup-status summary').click();
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
  await page.getByRole('button', { name: 'Back to conversation', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('.runtime-startup-status')
    && !document.querySelector('.composer-action-button')?.disabled);
  assert.equal(await input().evaluate(element => element.value), 'Draft retained while tools connect');
  assert.equal((await readFile(started, 'utf8')).trim().split('\n').length, 1);
  assert.ok((await readFile(file)).equals(boundHistory));
  phase = 'protected whole-worker reconnect; unconfirmed cleanup remains a hard gate';
  await writeFile(join(root, 'config.toml'), config('never'));
  await page.getByRole('button', { name: process.platform === 'darwin' ? 'Application menu' : 'View', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Restart runtime', exact: true }).click();
  await page.waitForFunction(() => Boolean(document.querySelector('.sidebar-plugins-dot')),
    undefined, { timeout: 15000 });
  assert.ok(await page.locator('.composer-action-button').isDisabled());
  assert.equal(await input().evaluate(element => element.value), 'Draft retained while tools connect');
  const failed = await page.evaluate(() => window.desktop.snapshot());
  assert.equal(failed.state.desktopStartup.cleanupConfirmed, false);
  await assert.rejects(page.evaluate(() => window.desktop.command('prompt', { message: 'MUST_NOT_BYPASS_CLEANUP' })), /STARTUP_NOT_READY/);
  await openPlugins();
  await page.locator('.runtime-startup-status summary').click();
  await page.waitForFunction(() => document.querySelector('.runtime-startup-status')?.textContent.includes('cleanup unconfirmed'));
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
  await page.getByRole('button', { name: 'Back to conversation', exact: true }).click();
  assert.equal(snapshot.state.sessionId, 'reading-large');
  assert.equal(await input().evaluate(element => element.value), 'Draft retained while tools connect');
  assert.ok((await readFile(file)).subarray(0, before.length).equals(before));
  assert.equal(payloads.length, 0);
  phase = 'settled optional failure permits degraded execution without confirmation';
  await writeFile(join(root, 'config.toml'), config('missing'));
  await page.getByRole('button', { name: process.platform === 'darwin' ? 'Application menu' : 'View', exact: true }).click();
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
  await page.waitForFunction(() => document.querySelector('.messages')?.textContent.includes('One explicitly accepted task.'),
    undefined, { timeout: 15000 });
  assert.equal(await confirmation.count(), 0);
  await page.screenshot({ path: join(output, 'degraded-execution.png') });
  assert.equal(payloads.length, 1);
  assert.equal((await input().evaluate(element => element.value)), '');
  const after = await readFile(file);
  assert.ok(after.subarray(0, before.length).equals(before));
  const appended = after.subarray(exclusionHistory.length).toString().trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
  const accepted = appended.filter(entry => entry.type === 'message' && entry.message.role === 'user');
  assert.equal(accepted.length, 1);
  assert.match(JSON.stringify(accepted[0].message.content), /Draft retained while tools connect/);
  results.providerRequests = payloads.length;
  const getSnapshot = () => page.evaluate(() => window.desktop.snapshot());
  const preparing = page.locator('.composer-prepare-status');
  const cancelFirstSend = page.getByRole('button', { name: /^(取消首次发送|Cancel first send)$/ });
  const sendButton = page.getByRole('button', { name: /^(发送|Send)$/ });
  const draftValue = () => input().evaluate(element => element.value);
  const userMessages = async snapshot => (await readFile(snapshot.state.sessionFile, 'utf8').catch(error => {
    if (error.code === 'ENOENT') return '';
    throw error;
  })).trim().split('\n').filter(Boolean).map(line => JSON.parse(line))
    .filter(entry => entry.type === 'message' && entry.message.role === 'user');
  const newDraft = async (kind, release, message) => {
    await until(async () => !(await getSnapshot()).state?.isStreaming);
    await writeFile(join(root, 'config.toml'), config(kind, release));
    await page.evaluate(project => window.desktop.beginSession(project), project);
    await page.reload();
    await until(async () => Boolean((await getSnapshot()).draftId));
    await input().fill(message);
  };
  const ready = async () => (await getSnapshot()).state?.desktopStartup?.tools
    .some(tool => tool.name === 'startup_fixture' && tool.status === 'connected');
  const pending = async message => {
    await cancelFirstSend.waitFor();
    await until(async () => (await getSnapshot()).state?.desktopStartup?.tools.some(tool => tool.status === 'connecting')
      && await draftValue() === message);
    const snapshot = await getSnapshot();
    const label = snapshot.preferences.language === 'zh' ? '正在准备会话' : 'Preparing session';
    assert.equal(await preparing.textContent(), label);
    assert.equal(await page.locator('.composer-prepare-announcement').textContent(), label);
    assert.ok(await input().isEnabled());
    assert.ok(!await page.locator('.app-error-banner').isVisible());
    assert.equal((await userMessages(snapshot)).length, 0);
    return snapshot;
  };
  const assertSent = async (message, count) => {
    await until(async () => payloads.length >= count && !(await getSnapshot()).state?.isStreaming
      && (await getSnapshot()).messages.some(entry => entry.role === 'assistant'));
    const snapshot = await getSnapshot();
    const users = await userMessages(snapshot);
    assert.equal(users.length, 1);
    assert.match(JSON.stringify(users[0].message.content), new RegExp(message));
    assert.equal(payloads.length, count);
    assert.equal(await draftValue(), '');
    await preparing.waitFor({ state: 'detached' });
    assert.ok(!await page.locator('.app-error-banner').isVisible());
    return snapshot;
  };
  phase = 'cold draft sends once after handshake without a retry';
  const release = join(profile, 'allow-first-send');
  const coldMessage = '帮我梳理一下这个项目的目录结构';
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.evaluate(() => window.desktop.preferences({ theme: 'dark', language: 'zh' }));
  await newDraft('gated', release, coldMessage);
  await page.evaluate(() => window.desktop.command('set_launch_mode', { mode: 'ultracode', enabled: true }));
  await page.evaluate(() => {
    document.addEventListener('transitionrun', event => {
      if (event.propertyName === 'opacity' && event.target.matches('.composer-prepare-status')) {
        const phase = event.target.matches('.is-leaving') ? 'left' : 'entered';
        document.documentElement.dataset.prepareFade = phase;
      }
    });
  });
  const sendBox = await sendButton.boundingBox();
  await sendButton.click();
  const cold = await pending(coldMessage);
  assert.equal(cold.launch.ultracodeArmed, true);
  await input().press('Enter');
  assert.equal(payloads.length, 1);
  await page.waitForFunction(() => document.documentElement.dataset.prepareFade === 'entered'
    && getComputedStyle(document.querySelector('.composer-prepare-status')).opacity === '1');
  assert.ok(await preparing.evaluate(element => {
    const chip = element.querySelector('.composer-context-chip');
    const { x, width, bottom } = chip.getBoundingClientRect();
    const composer = document.querySelector('.composer').getBoundingClientRect();
    return Math.abs(x + width / 2 - (composer.x + composer.width / 2)) <= 1
      && bottom <= composer.top && chip.scrollWidth <= chip.clientWidth;
  }));
  assert.deepEqual(await cancelFirstSend.boundingBox(), sendBox);
  await page.screenshot({ path: join(output, 'cold-draft-preparing-zh.png') });
  await writeFile(release, '');
  assert.equal((await assertSent(coldMessage, 2)).runtimeId, cold.runtimeId);
  assert.equal(await page.evaluate(() => document.documentElement.dataset.prepareFade), 'left');
  results.coldFirstSend = true;
  results.centeredPreparationFade = true;

  phase = 'cancel first send without consuming the draft or sending after readiness';
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.evaluate(() => window.desktop.preferences({ theme: 'light', language: 'en' }));
  const releaseCancelled = join(profile, 'allow-cancelled');
  const cancelledMessage = 'Keep this cancelled draft';
  await newDraft('gated', releaseCancelled, cancelledMessage);
  await input().press('Enter');
  const cancelled = await pending(cancelledMessage);
  assert.deepEqual(await preparing.evaluate(element => ({
    transition: getComputedStyle(element).transitionDuration,
    pulse: getComputedStyle(element.querySelector('.working-dot')).animationName,
  })), { transition: '0s', pulse: 'none' });
  await cancelFirstSend.click();
  assert.equal(await draftValue(), cancelledMessage);
  await preparing.waitFor({ state: 'detached' });
  await writeFile(releaseCancelled, '');
  await until(ready);
  await until(() => sendButton.isEnabled());
  assert.equal((await userMessages(cancelled)).length, 0);
  assert.equal(payloads.length, 2);
  await sendButton.click();
  await assertSent(cancelledMessage, 3);
  results.cancelAndResend = true;

  phase = 'editing the draft disarms the original send';
  const releaseEdited = join(profile, 'allow-edited');
  const editedMessage = 'Do not send the old draft';
  await newDraft('gated', releaseEdited, editedMessage);
  await input().press('Enter');
  const edited = await pending(editedMessage);
  await input().fill('Keep the edited version');
  await preparing.waitFor({ state: 'detached' });
  await writeFile(releaseEdited, '');
  await until(ready);
  await until(() => sendButton.isEnabled());
  assert.equal(await draftValue(), 'Keep the edited version');
  assert.equal((await userMessages(edited)).length, 0);
  assert.equal(payloads.length, 3);
  results.editDisarmsFirstSend = true;

  phase = 'navigation disarms the send even if the old runtime becomes ready';
  const releaseDeparted = join(profile, 'allow-departed');
  const departedMessage = 'Do not send after leaving';
  await newDraft('gated', releaseDeparted, departedMessage);
  await input().press('Enter');
  const departed = await pending(departedMessage);
  assert.notEqual(departed.runtimeId, edited.runtimeId, 'A new chat cannot reuse an empty runtime that owns another draft');
  if (await page.locator('.window-sidebar-toggle').getAttribute('aria-expanded') === 'false')
    await page.locator('.window-sidebar-toggle').click();
  await page.locator('[data-reorder-id="reading-large"] > button').first().click();
  await until(async () => (await getSnapshot()).state?.sessionId === 'reading-large');
  await writeFile(releaseDeparted, '');
  await until(() => page.evaluate(async id => (await window.desktop.summary(id)).mcp
    ?.some(tool => tool.name === 'startup_fixture' && tool.status === 'connected'), departed.runtimeId));
  await preparing.waitFor({ state: 'detached' });
  assert.equal((await userMessages(departed)).length, 0);
  assert.equal(await page.evaluate(id => window.desktop.composerRead({ sessionId: id }).then(value => value.value.text),
    departed.state.sessionId), departedMessage);
  assert.equal(await page.evaluate(id => window.desktop.composerRead({ sessionId: id }).then(value => value.value.text),
    edited.state.sessionId), 'Keep the edited version');
  assert.equal(payloads.length, 3);
  results.navigationDisarmsFirstSend = true;

  phase = 'unconfirmed cleanup blocks a cold first send and keeps the draft';
  const brokenMessage = 'Keep this draft after startup failure';
  await newDraft('never', undefined, brokenMessage);
  await input().press('Enter');
  await until(async () => (await getSnapshot()).state?.desktopStartup?.cleanupConfirmed === false);
  await until(() => page.locator('.app-error-banner').isVisible());
  assert.match(await page.locator('.app-error-banner').textContent(), /Message not sent\./);
  assert.doesNotMatch(await page.locator('.app-error-banner').textContent(), /STARTUP_NOT_READY|remote method/);
  await preparing.waitFor({ state: 'detached' });
  assert.equal(await draftValue(), brokenMessage);
  assert.equal((await userMessages(await getSnapshot())).length, 0);
  assert.equal(payloads.length, 3);
  results.failureRetainsDraft = true;

  phase = 'cold first send without an enabled MCP';
  const noToolsMessage = 'Cold send with no enabled MCP';
  await newDraft('disabled', undefined, noToolsMessage);
  await input().press('Enter');
  await assertSent(noToolsMessage, 4);
  results.coldFirstSendWithoutMcp = true;
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
