import { _electron as electron } from 'playwright';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, realpath, readFile, writeFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, relative, isAbsolute } from 'node:path';
import assert from 'node:assert/strict';

let modelCalls = 0;
const results = [];
const chunk = (delta, finish_reason = null) => `data: ${JSON.stringify({
  id: 'permission-fixture', object: 'chat.completion.chunk', created: 1, model: 'fixture',
  choices: [{ index: 0, delta, finish_reason }],
})}\n\n`;
const textOf = value => typeof value === 'string' ? value : value?.filter(block => block.type === 'text').map(block => block.text).join('\n') ?? '';
const server = createServer(async (req, res) => {
  let body = ''; for await (const part of req) body += part;
  const payload = JSON.parse(body); modelCalls++;
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  const label = textOf(payload.messages.findLast(message => message.role === 'user' && /^VERIFY-/.test(textOf(message.content)))?.content);
  if (payload.messages.at(-1)?.role === 'tool') {
    results.push({ label, text: textOf(payload.messages.at(-1).content) });
    res.end(chunk({ role: 'assistant', content: `${label} COMPLETE` }) + chunk({}, 'stop') + 'data: [DONE]\n\n');
    return;
  }
  const risky = label.startsWith('VERIFY-RISK');
  const args = risky ? { command: 'rm -rf ./permission-fixture-empty', timeout_ms: 10000 }
    : { path: 'permission-proof.txt', content: label };
  res.end(chunk({ tool_calls: [{ index: 0, id: `permission-tool-${modelCalls}`, type: 'function',
    function: { name: risky ? 'run_command' : 'write_file', arguments: JSON.stringify(args) } }] }, 'tool_calls') + 'data: [DONE]\n\n');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const profile = await realpath(await mkdtemp(join(tmpdir(), 'desktop-permission-tiers-')));
const root = join(profile, 'step-runtime');
const workspace = join(profile, 'workspace');
await mkdir(root, { recursive: true });
await mkdir(workspace);
await mkdir('test-results', { recursive: true });
await writeFile(join(profile, 'preferences.json'), JSON.stringify({ language: 'zh', theme: 'dark', workspaces: [workspace] }));
await writeFile(join(root, 'config.toml'), 'defaultProvider = "fixture"\ndefaultModel = "fixture"\npermissionPreset = "autopilot"\n[telemetry]\nenabled = false\n');
await writeFile(join(root, 'models.json'), JSON.stringify({ providers: {
  fixture: { baseUrl: `http://127.0.0.1:${server.address().port}/v1`, api: 'openai-completions', apiKey: 'isolated-test',
    models: [{ id: 'fixture', name: 'Permission fixture', contextWindow: 32768, maxTokens: 2048 }] },
} }));
const env = { ...process.env, DESKTOP_TEST_USER_DATA: profile, DESKTOP_TEST_NO_FOCUS: '1' };
delete env.ELECTRON_RUN_AS_NODE;
const executablePath = process.env.DESKTOP_VERIFY_EXE;
let app;
const errors = [];
const open = async () => {
  app = await electron.launch({ ...(executablePath ? { executablePath } : { args: [resolve('.')] }), env, timeout: 60000 });
  const page = await app.firstWindow();
  page.on('pageerror', error => errors.push(error.message));
  await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    window.setOpacity(0); window.setIgnoreMouseEvents(true); window.showInactive(); window.setSize(1360, 900);
  });
  await page.waitForFunction(() => !document.querySelector('.composer > .composer-input')?.disabled, undefined, { timeout: 60000 });
  await page.evaluate(() => window.desktop.snapshot());
  return page;
};
const close = async () => {
  await app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false }); });
  await app.close();
};
try {
  let page = await open();
  const snapshot = () => page.evaluate(() => window.desktop.snapshot());
  const choose = async name => {
    await page.getByRole('button', { name: '访问权限', exact: true }).click();
    await page.getByRole('menuitemradio', { name: new RegExp(`^${name}`) }).click();
  };
  const input = () => page.getByRole('textbox', { name: '消息', exact: true });
  const send = async text => {
    await input().fill(text);
    // A menu click can return before the permission RPC releases composer loading.
    await page.waitForFunction(() => {
      const button = document.querySelector('.composer-action-button');
      return button && !button.disabled && button.dataset.action === 'send';
    });
    await input().press('Enter');
  };
  const settled = async label => {
    await page.getByText(`${label} COMPLETE`, { exact: true }).waitFor({ timeout: 60000 });
    await page.waitForFunction(async () => !(await window.desktop.snapshot()).state?.isStreaming);
  };
  const risk = () => page.getByRole('dialog', { name: '启用完全访问？', exact: true });
  assert.equal((await snapshot()).permissionPreset, 'ask', 'Legacy Autopilot is never silently granted');
  const before = await snapshot();
  await page.getByRole('button', { name: '访问权限', exact: true }).click();
  assert.equal(await page.getByRole('menuitemradio').count(), 3);
  await page.waitForTimeout(250);
  await page.screenshot({ path: 'test-results/permission-tiers-menu-dark.png' });
  await page.getByRole('menuitemradio', { name: /^完全访问/ }).click();
  assert.equal((await snapshot()).runtimeId, undefined);
  assert.equal((await snapshot()).sessions.length, before.sessions.length, 'Draft selection creates no history');
  await send('VERIFY-WRITE-CANCELLED');
  await risk().waitFor();
  assert.equal(modelCalls, 0, 'First task must wait for native acknowledgment');
  assert.equal((await snapshot()).permissionPreset, 'ask');
  await page.screenshot({ path: 'test-results/permission-tiers-risk-dark.png' });
  await risk().getByRole('button', { name: '取消，保持当前权限', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.composer > .composer-input')?.value === 'VERIFY-WRITE-CANCELLED');
  assert.equal(modelCalls, 0, 'Cancellation must not submit the task');
  const cancelled = await snapshot();
  assert.equal(cancelled.messages.length, 0);
  assert.equal(cancelled.permissionPreset, 'ask');
  assert.equal(await page.locator('.error-banner, .app-error-banner, .modal-error').count(), 0, 'Intentional draft cancellation is not an error');

  for (const cancel of ['option', 'escape']) {
    await choose('完全访问');
    await risk().waitFor();
    if (cancel === 'option') await risk().getByRole('button', { name: '取消，保持当前权限', exact: true }).click();
    else await page.keyboard.press('Escape');
    await risk().waitFor({ state: 'hidden' });
    await page.waitForFunction(() => {
      const trigger = document.querySelector('.permission-trigger');
      return trigger && !trigger.disabled;
    });
    // Closed native popovers remain mounted with role="dialog".
    assert.equal(await page.getByRole('dialog').count(), 0, 'Cancellation leaves no visible dialog');
    assert.equal((await snapshot()).permissionPreset, 'ask');
    assert.equal(modelCalls, 0, 'Cancelling a live permission change never calls the model');
    assert.equal(await input().evaluate(element => element.value), 'VERIFY-WRITE-CANCELLED');
    assert.equal(await page.locator('.error-banner, .app-error-banner, .modal-error').count(), 0, `${cancel} cancellation is not an error`);
  }
  const changing = page.evaluate(id => window.desktop.command('set_permission_preset', { preset: 'full-access' }, id), cancelled.runtimeId);
  await risk().waitFor();
  await risk().getByRole('button', { name: '取消，保持当前权限', exact: true }).click();
  assert.deepEqual(await changing, { cancelled: true }, 'IPC preserves cancellation as a distinct result');

  await choose('代我批准');
  await send('VERIFY-WRITE-AUTO');
  await settled('VERIFY-WRITE-AUTO');
  const runtimeWorkspace = (await snapshot()).preferences.workspace;
  const canonical = await realpath(runtimeWorkspace);
  const within = relative(profile, canonical);
  assert.ok(within && !within.startsWith('..') && !isAbsolute(within), 'Fixture commands stay in the isolated profile');
  assert.equal(await readFile(join(canonical, 'permission-proof.txt'), 'utf8'), 'VERIFY-WRITE-AUTO');
  assert.equal(await page.getByRole('dialog').count(), 0, 'Routine writes need no approval in Approve for Me');
  await mkdir(join(canonical, 'permission-fixture-empty'));
  await send('VERIFY-RISK-REJECTED');
  const approval = page.locator('.permission-approval');
  await approval.waitFor();
  assert.match(await approval.textContent(), /高风险/);
  await approval.getByRole('button', { name: '拒绝本次操作', exact: true }).click();
  await settled('VERIFY-RISK-REJECTED');
  assert.equal((await stat(join(canonical, 'permission-fixture-empty'))).isDirectory(), true, 'Denied dangerous call does not execute');

  await choose('完全访问');
  await risk().waitFor();
  await risk().getByRole('button', { name: '仅本会话启用', exact: true }).click();
  await page.waitForFunction(async () => (await window.desktop.snapshot()).permissionPreset === 'full-access');
  await send('VERIFY-RISK-FULL');
  await settled('VERIFY-RISK-FULL');
  assert.equal(await page.getByRole('dialog').count(), 0, 'Acknowledged Full Access runs dangerous commands without per-call confirmation');
  await assert.rejects(stat(join(canonical, 'permission-fixture-empty')), /ENOENT/);
  assert.ok(results.some(result => result.label === 'VERIFY-RISK-FULL'));
  assert.equal((await snapshot()).messages.findLast(message => message.role === 'toolResult' && message.toolName === 'run_command')?.isError, false);
  const sessionId = (await snapshot()).state.sessionId;
  const cloned = await page.evaluate(id => window.desktop.cloneSession(id), sessionId);
  assert.notEqual(cloned.permissionPreset, 'full-access', 'Cloning never replays a source session-only grant');
  assert.equal(cloned.requests.length, 0, 'Hidden branch preparation does not demand a new Full Access grant');
  await page.evaluate(id => window.desktop.switchSession(id), sessionId);
  await page.reload();
  await page.waitForFunction(async () => (await window.desktop.snapshot()).permissionPreset === 'full-access');
  await close();

  page = await open();
  await page.evaluate(id => window.desktop.switchSession(id), sessionId);
  await page.reload();
  await page.waitForFunction(() => !document.querySelector('.composer > .composer-input')?.disabled);
  assert.notEqual((await snapshot()).permissionPreset, 'full-access', 'Session-only grant cannot survive process replacement');
  await choose('完全访问');
  await risk().waitFor();
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(680, 760));
  await page.waitForTimeout(250);
  assert.equal(await risk().evaluate(element => element.scrollWidth <= element.clientWidth), true);
  await page.screenshot({ path: 'test-results/permission-tiers-risk-narrow.png' });
  await page.evaluate(() => window.desktop.preferences({ language: 'en', theme: 'light' }));
  await page.reload();
  const english = page.getByRole('dialog', { name: 'Enable full access?', exact: true });
  await english.waitFor();
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1360, 900));
  await page.waitForTimeout(250);
  await page.screenshot({ path: 'test-results/permission-tiers-risk-light-en.png' });
  await english.getByRole('button', { name: 'Enable and remember', exact: true }).click();
  await page.waitForFunction(async () => (await window.desktop.snapshot()).permissionPreset === 'full-access');
  await close();
  page = await open();
  await page.evaluate(id => window.desktop.switchSession(id), sessionId);
  await page.reload();
  await page.waitForFunction(async () => (await window.desktop.snapshot()).permissionPreset === 'full-access');
  assert.equal(await page.getByRole('dialog').count(), 0, 'Remembered acknowledgment does not re-prompt');
  assert.deepEqual(errors, []);
  console.log('Permission tiers passed: native RPC/SSE, legacy reset, three-entry menu, draft consent before sending, cancel restores input, routine writes, hazardous deny/full access, session-only/remembered grants, reload, Chinese/English and narrow layouts.');
} catch (error) {
  const page = await app?.firstWindow().catch(() => undefined);
  if (page) {
    await page.screenshot({ path: 'test-results/permission-tiers-failure.png' }).catch(() => {});
    console.error('Permission fixture state:', JSON.stringify(await page.evaluate(() => window.desktop.snapshot()).catch(() => undefined)));
  }
  throw error;
} finally {
  if (app) await close().catch(() => {});
  await new Promise(resolve => server.close(resolve));
}
