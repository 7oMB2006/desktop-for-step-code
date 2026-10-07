import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

// Exercise the production renderer with isolated synthetic requests. No
// command, approval or model request reaches a real user session.
const profile = await mkdtemp(join(tmpdir(), 'step-permission-ui-'));
const env = { ...process.env, DESKTOP_TEST_USER_DATA: profile, DESKTOP_TEST_NO_FOCUS: '1' };
delete env.ELECTRON_RUN_AS_NODE;
const executablePath = process.env.DESKTOP_VERIFY_EXE;
const app = await electron.launch({ ...(executablePath ? { executablePath } : { args: [resolve('.')] }), env, timeout: 60000 });
const errors = [];
let page;
try {
  page = await app.firstWindow();
  page.on('pageerror', error => errors.push(error.message));
  await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    window.setOpacity(0); window.setIgnoreMouseEvents(true); window.showInactive();
    window.setMinimumSize(320, 400); window.setSize(1280, 900);
  });
  await page.getByText('Step Code 已连接', { exact: true }).waitFor({ timeout: 60000 });
  const saved = await page.evaluate(() => window.desktop.snapshot());
  await app.evaluate(({ ipcMain }, saved) => {
    globalThis.approvalFixture = { saved, responses: [], revision: saved.runtimeRevision ?? 0 };
    const original = ipcMain._invokeHandlers.get('desktop');
    ipcMain.removeHandler('desktop');
    ipcMain.handle('desktop', async (event, method, ...args) => {
      const fixture = globalThis.approvalFixture;
      if (method === 'snapshot') return fixture.saved;
      if (method === 'command' && args[0] === 'extension_ui_response') {
        fixture.responses.push({ value: args[1], runtimeId: args[2] });
        fixture.saved.requests = fixture.saved.requests.filter(request => request.id !== args[1].id);
        return null;
      }
      if (method === 'command' && args[0] === 'get_commands') return { commands: [] };
      if (method === 'command' && args[0] === 'get_available_thinking_levels') return { levels: [] };
      return original(event, method, ...args);
    });
  }, saved);
  const callId = 'permission-call-3d6009f9';
  const command = `powershell -NoProfile -Command '\nGet-ChildItem *.md | Sort-Object Name | ForEach-Object {\n  $t = Get-Content -Raw -Encoding utf8 $_.FullName\n  [pscustomobject]@{ Name=$_.Name; Lines=(Get-Content -Encoding utf8 $_.FullName).Count; Chars=$t.Length }\n}\n'`;
  const request = {
    type: 'extension_ui_request', method: 'confirm', id: 'approval-ui-1', runtimeId: saved.runtimeId,
    title: 'Approve run_command [3d6009f9]',
    message: `Call: ${callId}\nShell command could not be fully analyzed (unsupported-shell); explicit approval is required.\n\nrun_command command=powershell -NoProfile -Command Get-ChildItem...\n\nBatch calls may ask separately\nbefore approved tools begin running.`,
  };
  const history = [{ role: 'assistant', content: [{ type: 'toolCall', id: callId, name: 'run_command', arguments: { command, run_in_background: false } }] }];
  const load = async (r, messages = history, language = 'zh', theme = 'dark') => app.evaluate(({ BrowserWindow }, input) => {
    const fixture = globalThis.approvalFixture;
    fixture.saved = {
      ...fixture.saved, runtimeRevision: ++fixture.revision,
      status: 'connected', messages: input.messages, requests: [input.request],
      state: { sessionId: 'approval-session', isStreaming: false },
      preferences: { ...fixture.saved.preferences, language: input.language, theme: input.theme },
    };
    BrowserWindow.getAllWindows()[0].webContents.send('runtime-event', { type: 'desktop_sessions_changed' });
  }, { request: r, messages, language, theme });
  const checkBounds = async () => {
    const result = await page.locator('.permission-approval').evaluate(element => {
      const rect = element.getBoundingClientRect();
      return {
        fits: rect.left >= 0 && rect.right <= innerWidth && rect.top >= 0 && rect.bottom <= innerHeight,
        overflow: element.scrollWidth > element.clientWidth,
        buttons: [...element.querySelectorAll('.button-row button')].every(button => {
          const bounds = button.getBoundingClientRect();
          return button.scrollWidth <= button.clientWidth && bounds.top >= rect.top && bounds.bottom <= rect.bottom;
        }),
      };
    });
    assert.deepEqual(result, { fits: true, overflow: false, buttons: true });
  };
  await mkdir('test-results', { recursive: true });
  await load(request);
  const dialog = page.getByRole('dialog', { name: '批准执行命令' });
  await dialog.waitFor();
  assert.equal(await dialog.locator('.permission-approval-input').first().textContent(), command);
  await dialog.getByText('无法自动判断', { exact: true }).waitFor();
  assert.equal(await dialog.getByText('Shell command could not', { exact: false }).count(), 0);
  assert.deepEqual(await app.evaluate(() => globalThis.approvalFixture.responses), []);
  await checkBounds();
  await page.screenshot({ path: 'test-results/permission-approval-zh-dark.png' });
  await dialog.getByRole('button', { name: '原始审批信息' }).click();
  assert.equal(await dialog.locator('.permission-approval-raw').textContent(), request.message);
  await dialog.getByRole('button', { name: '原始审批信息' }).click();
  await dialog.getByRole('button', { name: '稍后处理' }).click();
  await page.getByRole('button', { name: '查看', exact: true }).click();
  await dialog.waitFor();
  assert.deepEqual(await app.evaluate(() => globalThis.approvalFixture.responses), []);
  await dialog.getByRole('button', { name: '拒绝本次操作' }).click();
  assert.deepEqual(await app.evaluate(() => globalThis.approvalFixture.responses), [
    { value: { id: request.id, cancelled: true }, runtimeId: request.runtimeId },
  ]);
  await load({ ...request, id: 'approval-ui-2' }, history, 'zh', 'light');
  await dialog.waitFor();
  await page.screenshot({ path: 'test-results/permission-approval-zh-light.png' });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(640, 680));
  await checkBounds();
  await page.screenshot({ path: 'test-results/permission-approval-zh-narrow.png' });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(360, 640));
  await checkBounds();
  await page.screenshot({ path: 'test-results/permission-approval-zh-small.png' });
  await dialog.getByRole('button', { name: '批准本次操作' }).click();
  assert.equal(await app.evaluate(() => globalThis.approvalFixture.responses.at(-1).value.confirmed), true);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1280, 900));
  await load({ ...request, id: 'approval-ui-3' }, [], 'en', 'dark');
  const english = page.getByRole('dialog', { name: 'Approve command execution' });
  await english.waitFor();
  await english.getByText('Full input is unavailable; the upstream summary may be truncated.').waitFor();
  await page.screenshot({ path: 'test-results/permission-approval-en-summary.png' });
  await load({
    ...request, id: 'approval-ui-4', title: 'Dangerous run_command [3d6009f9]',
    message: request.message.replace('Shell command could not be fully analyzed (unsupported-shell); explicit approval is required.',
      'Dangerous command requires confirmation (destructive-git): run_command command=git reset --hard'),
  }, [{ ...history[0], content: [{ ...history[0].content[0], arguments: { command: 'git reset --hard' } }] }]);
  const dangerous = page.getByRole('dialog', { name: '高风险操作需要批准' });
  await dangerous.waitFor();
  await dangerous.getByText('命中高风险规则', { exact: true }).waitFor();
  await page.screenshot({ path: 'test-results/permission-approval-zh-dangerous.png' });
  await load({ ...request, id: 'approval-ui-5', title: 'Custom extension confirmation', message: 'Keep arbitrary extension text unchanged.' });
  await page.getByRole('dialog', { name: 'Custom extension confirmation' }).getByText('Keep arbitrary extension text unchanged.').waitFor();
  assert.deepEqual(errors, []);
  console.log('Permission approval UI passed: Chinese/English, full input, summary fallback, raw details, defer, deny, approve, high-risk and unknown extension. Screenshots: test-results/permission-approval-*.png');
} finally {
  await app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 1 }); }).catch(() => {});
  await app.close();
}
