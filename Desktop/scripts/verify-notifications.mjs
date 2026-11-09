import { _electron as electron } from 'playwright';
import { prepareSessionFixture, waitForSessionFixtureSnapshot } from './session-fixture.mjs';
import { closeDesktopFixtureAndWait } from './close-desktop-fixture.mjs';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, writeFile, readFile, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const output = resolve(process.env.DESKTOP_NOTIFICATION_RESULTS ?? 'test-results/notifications');
await mkdir(output, { recursive: true });
const streams = new Map();
const checks = [];
const requestLabels = [];
const chunk = (delta, finish_reason = null) => `data: ${JSON.stringify({
  id: 'notification-fixture', object: 'chat.completion.chunk', created: 1, model: 'fixture',
  choices: [{ index: 0, delta, finish_reason }],
})}\n\n`;
const finish = (label, approval = false) => {
  const response = streams.get(label);
  assert.ok(response, `Missing stream ${label}`);
  streams.delete(label);
  response.end((approval ? chunk({ tool_calls: [{ index: 0, id: `tool-${label}`, type: 'function', function: {
    name: 'write_file', arguments: JSON.stringify({ path: 'never-auto-approved.txt', content: 'fixture only' }),
  } }] }) + chunk({}, 'tool_calls') : chunk({}, 'stop')) + 'data: [DONE]\n\n');
};
const server = createServer(async (request, response) => {
  let body = '';
  for await (const part of request) body += part;
  const payload = JSON.parse(body);
  response.writeHead(200, { 'content-type': 'text/event-stream' });
  const label = [...payload.messages].reverse().filter(message => message.role === 'user')
    .map(message => /NOTIFY-[A-Z]/.exec(JSON.stringify(message))?.[0]).find(Boolean);
  requestLabels.push(label ?? 'auxiliary');
  if (!label || payload.messages.at(-1)?.role === 'tool') {
    response.end(chunk({ role: 'assistant', content: 'Request resolved.' }) + chunk({}, 'stop') + 'data: [DONE]\n\n');
    return;
  }
  response.write(chunk({ role: 'assistant', content: `${label} fixture output.` }));
  streams.set(label, response);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const profile = await mkdtemp(join(tmpdir(), 'desktop-notifications-'));
const root = join(profile, 'step-runtime');
await mkdir(join(root, 'sessions'), { recursive: true });
await writeFile(join(profile, 'preferences.json'), JSON.stringify({ language: 'zh', theme: 'light', workspaces: [] }));
await writeFile(join(root, 'config.toml'), [
  'defaultProvider = "fixture"', 'defaultModel = "fixture"', 'permissionPreset = "ask"',
  '[telemetry]', 'enabled = false', '[mcp_servers.steppage__steppage]', 'enabled = false', '',
].join('\n'));
await writeFile(join(root, 'models.json'), JSON.stringify({ providers: { fixture: {
  baseUrl: `http://127.0.0.1:${server.address().port}/v1`, api: 'openai-completions', apiKey: 'local-fixture-only',
  models: [{ id: 'fixture', name: 'Notification fixture', contextWindow: 32768, maxTokens: 2048 }],
} } }));
const env = { ...process.env, DESKTOP_TEST_USER_DATA: profile, DESKTOP_TEST_NO_FOCUS: '1' };
delete env.ELECTRON_RUN_AS_NODE;
delete env.STEP_API_KEY;
let app;
let page;
let mini;
let passed = false;
let shutdown = false;
const errors = [];
try {
  const executablePath = process.env.DESKTOP_VERIFY_EXE;
  app = await electron.launch({
    ...(executablePath ? { executablePath } : {}), env, timeout: 60000,
    args: [...(executablePath ? [] : [resolve('.')]), '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding', '--disable-features=CalculateNativeWinOcclusion'],
  });
  page = await app.firstWindow();
  page.setDefaultTimeout(30000);
  page.on('pageerror', error => errors.push(error.message));
  const mainId = await app.evaluate(({ BrowserWindow, Notification }) => {
    const window = BrowserWindow.getAllWindows()[0];
    window.setOpacity(0); window.setIgnoreMouseEvents(true); window.showInactive(); window.setSize(1200, 850);
    globalThis.noticeFixture = { notices: [], nativeShow: Notification.prototype.show, nativeClose: Notification.prototype.close,
      focusedId: undefined };
    // Exercise the real foreground predicate without stealing the owner's OS focus.
    BrowserWindow.prototype.isFocused = function () { return globalThis.noticeFixture.focusedId === this.id; };
    Notification.prototype.show = function () { globalThis.noticeFixture.notices.push(this); };
    Notification.prototype.close = function () { this.testClosed = true; this.emit('close', { reason: 'applicationHidden' }); };
    return window.id;
  });
  await prepareSessionFixture(page);
  const snapshot = () => page.evaluate(() => window.desktop.snapshot());
  const preferences = patch => page.evaluate(patch => window.desktop.preferences(patch), patch);
  const count = () => app.evaluate(() => globalThis.noticeFixture.notices.length);
  const waitNotices = async expected => {
    await page.waitForFunction(() => document.readyState === 'complete');
    const deadline = Date.now() + 30000;
    while (await count() !== expected && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 40));
    assert.equal(await count(), expected);
  };
  const start = async label => {
    const input = page.locator('main .composer-input');
    await input.fill(label); await input.press('Enter');
    await page.getByText(`${label} fixture output.`, { exact: true }).waitFor();
    return snapshot();
  };
  const idle = () => waitForSessionFixtureSnapshot(page, value =>
    !value.state?.isStreaming && !value.runtimes?.some(runtime => ['running', 'waiting'].includes(runtime.status)), 'idle tasks');
  const focus = id => app.evaluate(({ BrowserWindow }, id) => {
    globalThis.noticeFixture.focusedId = id;
    if (id !== null) BrowserWindow.fromId(id).emit('focus');
  }, id);
  const openGeneral = async name => {
    await page.locator('.sidebar-settings').click();
    await page.getByRole('button', { name, exact: true }).click();
  };
  await openGeneral('通用');
  assert.equal(await page.getByLabel('审批请求通知', { exact: true }).isChecked(), true);
  assert.equal(await page.getByLabel('任务完成通知', { exact: true }).isChecked(), false);
  assert.equal(await page.getByLabel('完成提示音', { exact: true }).isChecked(), false);
  await page.getByLabel('审批请求通知', { exact: true }).uncheck();
  await page.getByLabel('任务完成通知', { exact: true }).check();
  await page.getByLabel('完成提示音', { exact: true }).check();
  await page.screenshot({ path: join(output, 'settings-light-zh.png') });
  await preferences({ theme: 'dark', language: 'en' });
  await app.evaluate(({ BrowserWindow }, id) => {
    const window = BrowserWindow.fromId(id);
    window.setMinimumSize(390, 400); window.setSize(390, 720);
  }, mainId);
  const sound = page.getByLabel('Completion sound', { exact: true });
  await sound.focus(); await sound.press('Space'); await sound.check();
  await page.waitForFunction(() => !document.querySelector('section[aria-label="Notifications and sound"] input:disabled'));
  await sound.focus();
  await sound.press('Tab'); await page.keyboard.press('Shift+Tab');
  assert.equal(await sound.evaluate(element => element === document.activeElement), true);
  const focusBounds = await sound.evaluate(element => {
    const box = element.getBoundingClientRect();
    const outline = getComputedStyle(element);
    const ancestors = [];
    for (let parent = element.parentElement; parent; parent = parent.parentElement) {
      const style = getComputedStyle(parent);
      if (/(auto|scroll|hidden|clip)/.test(`${style.overflowX} ${style.overflowY}`)) {
        const rect = parent.getBoundingClientRect();
        ancestors.push({ left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom });
      }
    }
    return { left: box.left, right: box.right, top: box.top, bottom: box.bottom,
      extent: Math.max(4, parseFloat(outline.outlineWidth) + parseFloat(outline.outlineOffset)), ancestors };
  });
  for (const ancestor of focusBounds.ancestors) {
    assert.ok(focusBounds.left - focusBounds.extent >= ancestor.left && focusBounds.right + focusBounds.extent <= ancestor.right
      && focusBounds.top - focusBounds.extent >= ancestor.top && focusBounds.bottom + focusBounds.extent <= ancestor.bottom,
    'Four-sided keyboard focus must fit clipping ancestors');
  }
  assert.equal(await page.locator('.settings-content').evaluate(element => element.scrollWidth > element.clientWidth), false);
  await page.screenshot({ path: join(output, 'settings-dark-narrow-en.png') });
  const saved = JSON.parse(await readFile(join(profile, 'preferences.json'), 'utf8'));
  assert.equal(saved.approvalNotifications, false);
  assert.equal(saved.completionNotifications, true);
  assert.equal(saved.completionSound, true);
  await app.evaluate(({ BrowserWindow }, id) => BrowserWindow.fromId(id).setSize(1200, 850), mainId);
  await page.reload();
  await openGeneral('General');
  assert.equal(await page.getByLabel('Approval request notifications', { exact: true }).isChecked(), false);
  assert.equal(await page.getByLabel('Task completion notifications', { exact: true }).isChecked(), true);
  assert.equal(await page.getByLabel('Completion sound', { exact: true }).isChecked(), true);
  await preferences({ language: 'zh' });
  await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click();
  await page.locator('.settings-backdrop').waitFor({ state: 'hidden' });
  checks.push('defaults, independent controls, persistence/reload, keyboard, dark/narrow English focus');
  await page.evaluate(() => {
    window.completionPlays = [];
    HTMLMediaElement.prototype.play = function () { window.completionPlays.push(this.src); return Promise.resolve(); };
  });
  for (const key of ['approvalNotifications', 'completionNotifications', 'completionSound']) {
    await assert.rejects(preferences({ [key]: 'true' }), /Invalid notification preference/);
  }
  await mkdir(join(profile, 'preferences.json.tmp'));
  try {
    await assert.rejects(preferences({ completionNotifications: false, completionSound: false }));
    const rejected = (await snapshot()).preferences;
    assert.equal(rejected.completionNotifications, true, 'Failed saves restore authoritative notification preferences');
    assert.equal(rejected.completionSound, true);
    const persisted = JSON.parse(await readFile(join(profile, 'preferences.json'), 'utf8'));
    assert.equal(persisted.completionNotifications, true);
    assert.equal(persisted.completionSound, true);
  } finally { await rmdir(join(profile, 'preferences.json.tmp')); }
  checks.push('strict IPC validation and real filesystem save-failure rollback');
  await preferences({ approvalNotifications: true, completionNotifications: false, completionSound: false });
  await start('NOTIFY-A');
  await page.getByRole('button', { name: '新建会话', exact: true }).click();
  finish('NOTIFY-A'); await idle();
  assert.equal(await count(), 0);
  assert.equal(await page.evaluate(() => window.completionPlays.length), 0);
  checks.push('default silent background completion');

  await preferences({ completionSound: true });
  const b = await start('NOTIFY-B');
  const opened = app.waitForEvent('window');
  await page.getByRole('button', { name: 'MiniChat', exact: true }).click();
  mini = await opened;
  mini.on('pageerror', error => errors.push(error.message));
  await mini.waitForFunction(() => window.desktop?.surface === 'mini' && document.querySelector('main .composer-input'));
  const miniId = await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows().find(window => window.getTitle() === 'MiniChat');
    window.setOpacity(0); window.setIgnoreMouseEvents(true); window.showInactive();
    return window.id;
  });
  await mini.evaluate(() => {
    window.completionPlays = [];
    HTMLMediaElement.prototype.play = function () { window.completionPlays.push(this.src); return Promise.resolve(); };
  });
  finish('NOTIFY-B'); await idle();
  await page.waitForFunction(() => window.completionPlays.length === 1);
  assert.equal(await mini.evaluate(() => window.completionPlays.length), 0);
  assert.equal(await count(), 0);
  checks.push('completion sound independent of banners and played once across main/MiniChat');

  await preferences({ completionSound: false, completionNotifications: true });
  await start('NOTIFY-E');
  await focus(mainId); finish('NOTIFY-E'); await idle();
  assert.equal(await count(), 0, 'Focused main conversation must stay quiet');
  await focus(null);
  const f = await start('NOTIFY-F');
  await mini.evaluate(id => window.desktop.navigateSession(id), f.state.sessionId);
  await mini.reload();
  await mini.waitForFunction(() => document.querySelector('main .composer-input'));
  await focus(miniId);
  await page.getByRole('button', { name: '新建会话', exact: true }).click();
  finish('NOTIFY-F'); await idle();
  assert.equal(await count(), 0, 'Focused MiniChat source must stay quiet even when main selects another session');
  await focus(null);
  checks.push('actual main/MiniChat foreground selection suppresses redundant banners');

  const c = await start('NOTIFY-C');
  await page.locator('main .composer-input').fill('Draft preserved across notification click');
  await page.getByRole('button', { name: '新建会话', exact: true }).click();
  finish('NOTIFY-C'); await waitNotices(1);
  assert.equal(await page.evaluate(() => window.completionPlays.length), 1);
  assert.equal(await app.evaluate(() => globalThis.noticeFixture.notices[0].silent), true);
  await app.evaluate(({ BrowserWindow }, id) => {
    BrowserWindow.fromId(id).hide();
    const notice = globalThis.noticeFixture.notices[0];
    notice.emit('close', { reason: 'timedOut' }); notice.emit('click', {});
  }, mainId);
  await page.waitForFunction(() => document.querySelector('main .composer-input')?.textContent === 'Draft preserved across notification click');
  assert.equal((await snapshot()).state.sessionId, c.state.sessionId);
  assert.equal(await app.evaluate(({ BrowserWindow }, id) => BrowserWindow.fromId(id).isVisible(), mainId), true);
  await page.locator('main .composer-input').fill('');
  checks.push('timed-out notification-center click, tray restore, exact session and shared draft retention');

  const d = await start('NOTIFY-D');
  await page.getByRole('button', { name: '新建会话', exact: true }).click();
  finish('NOTIFY-D', true); await waitNotices(2);
  assert.equal(await page.getByRole('dialog').count(), 0);
  const approvalPayload = await app.evaluate(() => {
    const notice = globalThis.noticeFixture.notices[1];
    return { title: notice.title, body: notice.body, silent: notice.silent };
  });
  assert.equal(approvalPayload.title, '需要审批');
  assert.equal(approvalPayload.silent, true);
  assert.ok(!JSON.stringify(approvalPayload).includes('never-auto-approved'));
  await app.evaluate(() => globalThis.noticeFixture.notices[1].emit('click', {}));
  await page.locator('.permission-approval[role="dialog"]').waitFor();
  const waiting = await snapshot();
  assert.equal(waiting.state.sessionId, d.state.sessionId);
  assert.ok(waiting.requests.length > 0, 'Notification clicks do not approve requests');
  await assert.rejects(readFile(join(d.preferences.workspace, 'never-auto-approved.txt')), { code: 'ENOENT' });
  await page.screenshot({ path: join(output, 'opens-scoped-approval-zh.png') });
  await page.evaluate(async ({ runtimeId, id }) => window.desktop.command('extension_ui_response', { id, cancelled: true }, runtimeId),
    { runtimeId: waiting.runtimeId, id: waiting.requests[0].id });
  await idle();
  assert.equal(await app.evaluate(() => globalThis.noticeFixture.notices[1].testClosed), true);
  checks.push('real runtime write approval, privacy, scoped drawer navigation, no automatic authorization');

  if (process.argv.includes('--native-smoke')) {
    const result = await app.evaluate(async () => {
      const fixture = globalThis.noticeFixture;
      const notice = fixture.notices[0];
      return new Promise(resolve => {
        const timer = setTimeout(() => resolve('timeout'), 10000);
        const finish = result => { clearTimeout(timer); fixture.nativeClose.call(notice); resolve(result); };
        notice.once('show', () => finish('shown'));
        notice.once('failed', (_event, error) => finish(`failed: ${error}`));
        fixture.nativeShow.call(notice);
      });
    });
    assert.equal(result, 'shown', 'The OS must acknowledge the native toast');
    checks.push('native show acknowledgment only; no claim of visible banner or physical click');
  }
  assert.equal((await snapshot()).runtimes.filter(runtime => runtime.sessionId === b.state.sessionId).length <= 1, true);
  assert.deepEqual(errors, []);
  passed = true;
} catch (error) {
  if (page && !page.isClosed()) {
    const diagnostic = await page.evaluate(async () => {
      const value = await window.desktop.snapshot();
      const input = document.querySelector('main .composer-input');
      return { status: value.status, runtimeId: value.runtimeId, draftId: value.draftId,
        sessionId: value.state?.sessionId, streaming: value.state?.isStreaming,
        model: value.state?.model?.id, requests: value.requests?.map(request => request.method),
        input: input?.textContent, error: document.querySelector('.error')?.textContent,
        messageCount: value.messages.length };
    }).catch(cause => ({ unavailable: String(cause) }));
    console.error('Notification fixture failure:', JSON.stringify({ checks, requestLabels, diagnostic }));
    await page.screenshot({ path: join(output, 'failure.png') }).catch(() => {});
  }
  throw error;
} finally {
  for (const response of streams.values()) response.end();
  if (page && app) {
    await page.evaluate(async () => {
      const snapshot = await window.desktop.snapshot();
      for (const runtime of snapshot.runtimes ?? []) {
        if (['running', 'waiting'].includes(runtime.status)) await window.desktop.command('abort', {}, runtime.runtimeId).catch(() => {});
      }
    }).catch(() => {});
  }
  try {
    if (app) {
      const child = app.process();
      await closeDesktopFixtureAndWait(app);
      shutdown = child.exitCode === 0 && app.windows().length === 0;
    }
  }
  finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    await writeFile(join(output, 'verification.json'), JSON.stringify({ passed: passed && shutdown, profile, checks, errors, shutdown }, null, 2));
  }
}
console.log(`Notifications passed: ${checks.length} groups, isolated local HTTP fixture, confirmed orderly shutdown. Evidence: ${output}`);
