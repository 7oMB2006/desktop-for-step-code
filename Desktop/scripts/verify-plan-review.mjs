import { _electron as electron } from 'playwright';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import assert from 'node:assert/strict';

const text = value => typeof value === 'string' ? value : value?.filter(c => c.type === 'text').map(c => c.text).join('\n') ?? '';
const requests = [];
const initialProposal = process.env.DESKTOP_VERIFY_PLAN_FILE
  ? await readFile(process.env.DESKTOP_VERIFY_PLAN_FILE, 'utf8')
  : '# Proposal\n\nCreate approved.txt after approval.\n\nValidation: inspect the file.\nEND OF PROPOSAL';
let stage = 0;
let planPath;
let refining = false;
let checkedRestriction = false;
let finishExecution;
let holdExecution = true;
const chunk = (delta, finish_reason = null) => `data: ${JSON.stringify({ id: 'plan-fixture', object: 'chat.completion.chunk', created: 1, model: 'fixture', choices: [{ index: 0, delta, finish_reason }] })}\n\n`;
const server = createServer(async (req, res) => {
  let body = ''; for await (const part of req) body += part;
  const payload = JSON.parse(body); requests.push(payload);
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  const context = payload.messages.map(m => text(m.content)).join('\n');
  const tool = (name, args) => res.end(chunk({ tool_calls: [{ index: 0, id: `plan-${requests.length}`, type: 'function', function: { name, arguments: JSON.stringify(args) } }] }, 'tool_calls') + 'data: [DONE]\n\n');
  if (stage === 0) {
    assert.match(context, /Desktop Plan mode active/);
    planPath = /Write the proposal to (.*)\. Only this proposal/.exec(context)?.[1];
    assert.ok(planPath);
    if (!checkedRestriction) {
      checkedRestriction = true;
      tool('write_file', { path: 'must-not-write.txt', content: 'Unapproved implementation' });
      return;
    }
    stage = 1; tool('write_file', { path: planPath, content: initialProposal });
  } else if (stage === 1) {
    assert.match(context, /Desktop Plan mode active/); stage = 2; tool('exit_plan_mode', {});
  } else if (stage === 2) {
    if (refining) {
      assert.match(context, /Desktop Plan mode active/);
      assert.match(context, /Add validation/);
      refining = false; stage = 1;
      tool('write_file', { path: planPath, content: '# Revised proposal\n\nAdd validation before creating approved.txt.\nEND OF PROPOSAL' });
      return;
    }
    assert.doesNotMatch(context, /\[Desktop Plan mode active\]/); stage = 3; tool('write_file', { path: 'approved.txt', content: 'Approved execution' });
  } else {
    const finish = () => res.end(chunk({ role: 'assistant', content: 'Completed approved plan.' }) + chunk({}, 'stop') + 'data: [DONE]\n\n');
    if (holdExecution) { holdExecution = false; finishExecution = finish; }
    else finish();
  }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const profile = await mkdtemp(join(tmpdir(), 'desktop-plan-review-'));
const root = join(profile, 'step-runtime'), workspace = join(profile, 'workspace');
await mkdir(root); await mkdir(workspace); await mkdir('test-results', { recursive: true });
await writeFile(join(profile, 'preferences.json'), JSON.stringify({ language: 'zh', theme: 'dark', workspaces: [workspace] }));
await writeFile(join(root, 'config.toml'), 'defaultProvider = "fixture"\ndefaultModel = "fixture"\npermissionPreset = "approve-for-me"\n[telemetry]\nenabled = false\n');
await writeFile(join(root, 'models.json'), JSON.stringify({ providers: { fixture: { baseUrl: `http://127.0.0.1:${server.address().port}/v1`, api: 'openai-completions', apiKey: 'isolated-test', models: [{ id: 'fixture', name: 'Plan fixture', contextWindow: 32768, maxTokens: 2048 }] } } }));
const env = { ...process.env, DESKTOP_TEST_USER_DATA: profile, DESKTOP_TEST_NO_FOCUS: '1' }; delete env.ELECTRON_RUN_AS_NODE;
const launchOptions = { ...(process.env.DESKTOP_VERIFY_EXE ? { executablePath: process.env.DESKTOP_VERIFY_EXE } : { args: [resolve('.')] }), env, timeout: 60000 };
let app = await electron.launch(launchOptions);
const errors = [];
try {
  const page = await app.firstWindow(); page.setDefaultTimeout(30000); page.on('pageerror', e => errors.push(e.message));
  await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.setOpacity(0); w.setIgnoreMouseEvents(true); w.showInactive(); w.setSize(1360, 900); });
  await page.waitForFunction(() => !document.querySelector('.composer > textarea')?.disabled, undefined, { timeout: 60000 });
  await page.getByText('Step Code 已连接', { exact: true }).waitFor({ timeout: 60000 });
  if (process.env.DESKTOP_VERIFY_FULL_ACCESS) {
    await page.evaluate(() => window.desktop.command('set_permission_preset', { preset: 'full-access' }));
  }
  await page.getByRole('button', { name: '访问权限', exact: true }).click();
  await page.getByRole('menuitemcheckbox', { name: '计划模式', exact: true }).click();
  await page.getByRole('textbox', { name: '消息', exact: true }).fill('Plan a small file change.');
  await page.getByRole('textbox', { name: '消息', exact: true }).press('Enter');
  if (process.env.DESKTOP_VERIFY_FULL_ACCESS) {
    const risk = page.getByRole('dialog', { name: '启用完全访问？', exact: true });
    await risk.waitFor({ timeout: 60000 });
    await risk.getByRole('button', { name: '仅本会话启用', exact: true }).click();
    await page.waitForFunction(async () => (await window.desktop.snapshot()).permissionPreset === 'full-access');
  }
  const dialog = page.getByRole('dialog', { name: '审阅计划', exact: true });
  await dialog.waitFor({ timeout: 60000 });
  assert.equal(requests.length, 3, 'Only blocked write, proposal write and submission occur before approval');
  assert.equal((await page.evaluate(() => window.desktop.snapshot())).launch.plan, true);
  const output = join(dirname(dirname(dirname(planPath))), 'approved.txt');
  await assert.rejects(readFile(output), { code: 'ENOENT' });
  await assert.rejects(readFile(join(dirname(output), 'must-not-write.txt')), { code: 'ENOENT' });
  const reviewSnapshot = await page.evaluate(() => window.desktop.snapshot());
  assert.equal(reviewSnapshot.requests[0].timeout, process.argv.includes('--legacy-repro') ? 120000 : 240000, 'Packaged runtime must include the expected Plan review timeout');
  assert.ok(reviewSnapshot.requests[0].title.endsWith(initialProposal), 'The complete proposal reaches the renderer');
  await dialog.locator('.markdown').waitFor();
  assert.ok((await dialog.locator('.markdown').textContent()).trim().length > 0);
  await app.evaluate(({ ipcMain, BrowserWindow }, saved) => {
    const original = ipcMain._invokeHandlers.get('desktop');
    let stale = true;
    ipcMain.removeHandler('desktop');
    ipcMain.handle('desktop', (event, method, ...args) => {
      if (method === 'snapshot' && stale) {
        stale = false;
        return { ...saved, runtimeRevision: saved.runtimeRevision - 1, requests: [] };
      }
      return original(event, method, ...args);
    });
    BrowserWindow.getAllWindows()[0].webContents.send('runtime-event', { type: 'desktop_sessions_changed' });
  }, reviewSnapshot);
  await page.waitForTimeout(200);
  assert.equal(await dialog.isVisible(), true, 'A pre-request snapshot cannot erase the live review drawer');
  assert.equal(await dialog.getAttribute('aria-modal'), 'false');
  await dialog.locator('h1').waitFor();
  assert.equal(await page.locator('.modal-backdrop').count(), 0);
  const compactHeight = (await dialog.boundingBox()).height;
  assert.equal(await page.locator('.composer-underlay').evaluate(el => getComputedStyle(el).visibility), 'hidden', 'Drawer covers the entire composer including runtime metrics');
  const grip = dialog.getByRole('button', { name: '调整计划批阅高度', exact: true });
  const gripBounds = await grip.boundingBox();
  await page.mouse.move(gripBounds.x + gripBounds.width / 2, gripBounds.y + gripBounds.height / 2);
  await page.mouse.down();
  await page.mouse.move(gripBounds.x + gripBounds.width / 2, gripBounds.y + gripBounds.height / 2 - 35, { steps: 4 });
  const dragSize = (await dialog.boundingBox()).height;
  assert.ok(dragSize > compactHeight + 15 && dragSize < compactHeight + 55, 'Dragging changes height continuously rather than switching instantly');
  await page.mouse.up();
  await page.waitForTimeout(220);
  await dialog.getByRole('button', { name: '调整计划批阅高度', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.plan-review-drawer')?.getAttribute('data-size') === 'expanded');
  await page.waitForTimeout(220);
  assert.ok((await dialog.boundingBox()).height > compactHeight * 1.5);
  await dialog.getByRole('button', { name: '稍后批阅', exact: true }).click();
  await dialog.waitFor({ state: 'hidden' });
  const triggerAnimation = await page.getByRole('button', { name: '批阅计划', exact: true }).evaluate(el => getComputedStyle(el).animationName);
  assert.match(triggerAnimation, /permission-review-flow/);
  assert.equal(requests.length, 3, 'Review later does not answer or resume the runtime');
  await page.getByRole('button', { name: '批阅计划', exact: true }).click();
  await dialog.waitFor();
  await page.screenshot({ path: 'test-results/plan-review-dark.png' });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(640, 620));
  await page.waitForTimeout(150);
  const bounds = await dialog.boundingBox();
  const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
  assert.ok(bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= viewport.width && bounds.y + bounds.height <= viewport.height);
  await page.screenshot({ path: 'test-results/plan-review-narrow.png' });
  await page.evaluate(() => window.desktop.preferences({ theme: 'light' }));
  await page.screenshot({ path: 'test-results/plan-review-light.png' });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1360, 900));
  await dialog.getByRole('button', { name: '提出修改', exact: true }).click();
  const initialEdits = page.getByRole('dialog', { name: '修改计划', exact: true });
  await initialEdits.waitFor();
  await initialEdits.getByRole('button', { name: '返回批阅', exact: true }).click();
  await dialog.waitFor();
  await dialog.getByRole('button', { name: '批准并执行', exact: true }).click();
  const runningPlan = page.getByRole('button', { name: '执行计划中', exact: true });
  await runningPlan.waitFor();
  const approvalNote = page.locator('.plan-approval-note');
  assert.equal(await approvalNote.count(), 1, 'A confirmed approval produces exactly one inline note');
  await approvalNote.locator('button').click();
  await approvalNote.locator('.plan-approved-snapshot h1').waitFor();
  await writeFile(planPath, '# Changed after approval');
  assert.doesNotMatch(await approvalNote.textContent(), /Changed after approval/, 'Disclosure uses the approved snapshot, not the mutable file');
  await page.screenshot({ path: 'test-results/plan-execution-running-light.png' });
  await approvalNote.locator('button').click();
  await page.waitForTimeout(220);
  await page.evaluate(() => window.desktop.preferences({ theme: 'dark' }));
  await page.screenshot({ path: 'test-results/plan-execution-running-dark.png' });
  const anchorPosition = locator => locator.evaluate(el => {
    const button = el.getBoundingClientRect(), row = el.closest('.working').getBoundingClientRect();
    return { x: button.left - row.left, y: button.top - row.top };
  });
  const runningAnchor = await anchorPosition(runningPlan);
  await runningPlan.click();
  await page.getByRole('region', { name: '已批准的计划快照', exact: true }).last().waitFor();
  await page.waitForTimeout(220);
  assert.deepEqual(await anchorPosition(runningPlan), runningAnchor, 'Running disclosure does not move the status trigger onto a new line');
  await page.screenshot({ path: 'test-results/plan-execution-running-anchored.png' });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(640, 620));
  await page.waitForTimeout(220);
  const executionBounds = await page.locator('.working:not(.working-idle) .plan-approved-snapshot').boundingBox();
  const executionViewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
  assert.ok(executionBounds.x >= 0 && executionBounds.x + executionBounds.width <= executionViewport.width + 1);
  await page.screenshot({ path: 'test-results/plan-execution-running-narrow.png' });
  await runningPlan.click();
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1360, 900));
  await page.waitForFunction(() => document.querySelector('.plan-approval-note'));
  while (!finishExecution) await new Promise(resolve => setTimeout(resolve, 10));
  finishExecution();
  await page.waitForFunction(async () => !(await window.desktop.snapshot()).state.isStreaming);
  assert.equal(await readFile(output, 'utf8'), 'Approved execution');
  assert.equal((await page.evaluate(() => window.desktop.snapshot())).launch.plan, false);
  assert.equal(await runningPlan.count(), 0);
  const executedPlan = page.getByRole('button', { name: '计划已执行', exact: true });
  await executedPlan.waitFor({ state: 'attached' });
  await page.mouse.move(0, 0);
  await page.locator('.composer textarea').focus();
  await page.waitForTimeout(200);
  assert.equal(await executedPlan.evaluate(el => getComputedStyle(el).opacity), '0', 'Settled plan status is hidden until hover or focus');
  await page.locator('.message.assistant').last().hover();
  await page.waitForTimeout(200);
  assert.equal(await executedPlan.evaluate(el => getComputedStyle(el).opacity), '1');
  await page.screenshot({ path: 'test-results/plan-execution-completed-dark.png' });
  const settledAnchor = await anchorPosition(executedPlan);
  await executedPlan.click();
  await page.waitForTimeout(220);
  assert.deepEqual(await anchorPosition(executedPlan), settledAnchor, 'Settled disclosure stays beside the response actions');
  await page.screenshot({ path: 'test-results/plan-execution-completed-anchored.png' });
  await executedPlan.click();
  await page.waitForTimeout(220);
  assert.deepEqual(await anchorPosition(executedPlan), settledAnchor, 'Closing restores the same settled anchor');
  // The next submission stays in Plan when the user cancels its review.
  stage = 0;
  await page.getByRole('button', { name: '访问权限', exact: true }).click();
  await page.getByRole('menuitemcheckbox', { name: '计划模式', exact: true }).click();
  await page.waitForFunction(async () => (await window.desktop.snapshot()).launch.plan === true);
  await page.getByRole('textbox', { name: '消息', exact: true }).fill('Plan again, but wait for my decision.');
  await page.getByRole('textbox', { name: '消息', exact: true }).press('Enter');
  await dialog.waitFor({ timeout: 60000 });
  assert.equal(await page.locator('.working:not(.working-idle) .plan-execution-status').count(), 0, 'Another planning turn does not inherit execution');
  refining = true;
  await dialog.getByRole('button', { name: '提出修改', exact: true }).click();
  const feedback = page.getByRole('dialog', { name: '修改计划', exact: true });
  await feedback.waitFor();
  await feedback.locator('textarea').fill('Add validation');
  const focusStyle = await feedback.locator('textarea').evaluate(el => { const s = getComputedStyle(el); return { shadow: s.boxShadow, outline: s.outlineStyle }; });
  assert.deepEqual(focusStyle, { shadow: 'none', outline: 'none' });
  const editingSnapshot = await page.evaluate(() => window.desktop.snapshot());
  const callsBeforeBack = requests.length;
  assert.equal(editingSnapshot.requests[0].method, 'select', 'Editing is local until notes are submitted');
  await feedback.getByRole('button', { name: '返回批阅', exact: true }).click();
  await dialog.waitFor();
  const returnedSnapshot = await page.evaluate(() => window.desktop.snapshot());
  assert.equal(returnedSnapshot.requests[0].id, editingSnapshot.requests[0].id, 'Back retains the same pending approval');
  assert.equal(returnedSnapshot.state.isStreaming, true, 'Back does not terminate the turn');
  assert.equal(requests.length, callsBeforeBack, 'Back does not resume the model');
  await dialog.getByRole('button', { name: '提出修改', exact: true }).click();
  await feedback.waitFor();
  assert.equal(await feedback.locator('textarea').inputValue(), 'Add validation', 'Back retains the unsubmitted draft');
  await feedback.getByRole('button', { name: '稍后批阅', exact: true }).click();
  await feedback.waitFor({ state: 'hidden' });
  await page.getByRole('button', { name: '批阅计划', exact: true }).click();
  await feedback.waitFor();
  assert.equal(await feedback.locator('textarea').inputValue(), 'Add validation');
  await feedback.getByRole('button', { name: '提交修改意见', exact: true }).click();
  await dialog.waitFor();
  await dialog.getByText('Revised proposal', { exact: false }).waitFor();
  const beforeCancel = requests.length;
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  await page.waitForFunction(async () => !(await window.desktop.snapshot()).state.isStreaming);
  assert.equal(requests.length, beforeCancel, 'Cancellation terminates without another provider call');
  assert.equal((await page.evaluate(() => window.desktop.snapshot())).launch.plan, true);
  const expired = await page.evaluate(() => window.desktop.command('extension_ui_response', { id: 'expired-review', value: 'Approve plan' }).then(() => false, () => true));
  assert.equal(expired, true, 'Unknown or duplicate review responses cannot grant approval');
  await page.reload();
  await page.waitForFunction(async () => (await window.desktop.snapshot()).launch.plan === true);
  assert.equal(await dialog.count(), 0, 'Renderer reload does not recreate cancelled review');
  await page.getByRole('button', { name: '重新批阅计划', exact: true }).waitFor();
  stage = 3;
  await page.getByRole('textbox', { name: '消息', exact: true }).fill('An ordinary follow-up, not approval.');
  await page.getByRole('textbox', { name: '消息', exact: true }).press('Enter');
  await page.waitForFunction(async () => !(await window.desktop.snapshot()).state.isStreaming);
  await page.getByRole('button', { name: '重新批阅计划', exact: true }).waitFor();
  stage = 0;
  await page.getByRole('button', { name: '重新批阅计划', exact: true }).click();
  await dialog.waitFor({ timeout: 60000 });
  await writeFile(planPath, 'Externally changed proposal');
  const staleCalls = requests.length;
  await dialog.getByRole('button', { name: '批准并执行', exact: true }).click();
  await page.waitForFunction(async () => !(await window.desktop.snapshot()).state.isStreaming);
  assert.equal(requests.length, staleCalls, 'Changed proposal approval does not resume execution');
  assert.equal((await page.evaluate(() => window.desktop.snapshot())).launch.plan, true);
  assert.deepEqual(errors, []);
  const sessionId = (await page.evaluate(() => window.desktop.snapshot())).state.sessionId;
  await app.close();
  app = await electron.launch(launchOptions);
  const restored = await app.firstWindow();
  restored.setDefaultTimeout(30000);
  await restored.waitForFunction(() => !document.querySelector('.composer > textarea')?.disabled, undefined, { timeout: 60000 });
  await restored.evaluate(id => window.desktop.switchSession(id), sessionId);
  await restored.reload();
  await restored.waitForFunction(() => !document.querySelector('.composer > textarea')?.disabled, undefined, { timeout: 60000 });
  await restored.waitForFunction(async id => {
    const s = await window.desktop.snapshot(); return s.state?.sessionId === id && s.launch.plan === true;
  }, sessionId, { timeout: 60000 });
  assert.equal((await restored.evaluate(() => window.desktop.snapshot())).requests.length, 0, 'Restart does not restore a grant or pending approval');
  await restored.getByRole('button', { name: '重新批阅计划', exact: true }).waitFor();
  stage = 0;
  await app.evaluate(() => {
    globalThis.planOriginalTimeout = globalThis.setTimeout;
    globalThis.setTimeout = (callback, delay, ...args) => globalThis.planOriginalTimeout(callback, delay === 240000 ? 1000 : delay, ...args);
  });
  await restored.getByRole('button', { name: '重新批阅计划', exact: true }).click();
  const restoredDialog = restored.getByRole('dialog', { name: '审阅计划', exact: true });
  await restoredDialog.waitFor({ timeout: 60000 });
  const expiryCalls = requests.length;
  await restored.waitForFunction(async () => !(await window.desktop.snapshot()).state.isStreaming);
  await app.evaluate(() => { globalThis.setTimeout = globalThis.planOriginalTimeout; });
  await restoredDialog.waitFor({ state: 'hidden' });
  await restored.getByRole('button', { name: '重新批阅计划', exact: true }).waitFor();
  const expiredSnapshot = await restored.evaluate(() => window.desktop.snapshot());
  assert.equal(expiredSnapshot.launch.plan, true, 'Expiry preserves planning and reentry, not approval');
  assert.equal(expiredSnapshot.requests.length, 0);
  assert.match(text(expiredSnapshot.messages.findLast(m => m.toolName === 'exit_plan_mode').content), /may have expired or been cancelled/);
  assert.equal(requests.length, expiryCalls, 'Expiry never starts another provider call or grants execution');
  await restored.screenshot({ path: 'test-results/plan-review-expired-reentry.png' });
  stage = 0;
  await restored.getByRole('button', { name: '重新批阅计划', exact: true }).click();
  await restoredDialog.waitFor({ timeout: 60000 });
  await restored.screenshot({ path: 'test-results/plan-review-fresh-resubmission.png' });
  await restoredDialog.getByRole('button', { name: '取消', exact: true }).click();
  await restored.waitForFunction(async () => !(await window.desktop.snapshot()).state.isStreaming);
  console.log('Plan context, approval, stale-snapshot protection, expiry and durable fresh-review reentry passed');
} catch (error) {
  const page = await app.firstWindow().catch(() => undefined);
  if (page) {
    await page.screenshot({ path: 'test-results/plan-review-failure.png' }).catch(() => {});
    const snapshot = await page.evaluate(() => window.desktop.snapshot()).catch(() => undefined);
    console.error('Plan acceptance diagnostic', JSON.stringify({
      stage, providerCalls: requests.length, launch: snapshot?.launch, state: snapshot?.state,
      pendingRequests: snapshot?.requests?.map(r => ({ id: r.id, method: r.method })),
      lastResult: text(snapshot?.messages?.at(-1)?.content),
    }));
  }
  throw error;
} finally {
  await app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 1 }); }).catch(() => {});
  await app.close(); await new Promise(resolve => server.close(resolve));
}
