import { _electron as electron } from 'playwright';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, writeFile, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';

const text = value => typeof value === 'string' ? value : value?.filter(c => c.type === 'text').map(c => c.text).join('\n') ?? '';
const questions = [
  { id: 'scope', label: 'Scope', question: 'Choose the implementation scope', reason: 'This changes the proposal.',
    options: [{ label: 'Small change', value: 'small', description: 'Keep existing behavior' }, { label: 'Broader change', value: 'large', description: 'Include related improvements' }], allow_freeform: false },
  { id: 'constraints', label: 'Constraints', question: 'What constraints should the plan follow?', allow_freeform: true },
  { id: 'format', label: 'Format', question: 'Choose the delivery format',
    options: [{ label: 'Markdown report', value: 'md' }, { label: 'Plain text', value: 'text' }], allow_freeform: true },
];
const payloads = [], fixtureErrors = [];
const chunk = (delta, finish_reason = null) => `data: ${JSON.stringify({ id: 'question-fixture', object: 'chat.completion.chunk', created: 1, model: 'fixture', choices: [{ index: 0, delta, finish_reason }] })}\n\n`;
const server = createServer(async (req, res) => {
  try {
    let body = ''; for await (const part of req) body += part;
    const payload = JSON.parse(body); payloads.push(payload);
    const boundary = payload.messages.findLastIndex(m => m.role === 'user'
      && !text(m.content).includes('This is runtime state, not an additional user message.'));
    const prompt = text(payload.messages[boundary]?.content);
    const current = payload.messages.slice(boundary + 1);
    const hasResult = name => current.some(m => m.role === 'tool' && current.some(a =>
      a.tool_calls?.some(call => call.id === m.tool_call_id && call.function.name === name)));
    const context = payload.messages.map(m => text(m.content)).join('\n');
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    const tool = (name, args) => res.end(chunk({ tool_calls: [{ index: 0, id: `question-${payloads.length}`, type: 'function', function: { name, arguments: JSON.stringify(args) } }] }, 'tool_calls') + 'data: [DONE]\n\n');
    if (!hasResult('clarify_user')) {
      assert.ok(payload.tools.some(t => t.function.name === 'clarify_user'), 'Clarification is exposed to the model');
      if (prompt.includes('PLAN')) assert.match(context, /Desktop Plan mode active/);
      return tool('clarify_user', prompt.includes('LEGACY')
        ? { question: 'Choose one answer', options: [{ label: 'Yes', value: 'yes' }], allow_freeform: false } : { questions });
    }
    if (prompt.includes('PLAN') && !hasResult('write_file')) {
      assert.match(context, /Desktop Plan mode active/);
      assert.match(context, /answer: large/);
      const path = /Write the proposal to (.*)\. Only this proposal/.exec(context)?.[1];
      assert.ok(path);
      return tool('write_file', { path, content: '# Proposal\n\nUse a broader change with no dependencies.\n\nValidation: run tests.' });
    }
    if (prompt.includes('PLAN') && !hasResult('exit_plan_mode')) return tool('exit_plan_mode', {});
    if (prompt.includes('PLAN')) assert.doesNotMatch(context, /\[Desktop Plan mode active\]/);
    if (prompt.includes('CANCEL')) assert.match(context, /User clarification cancelled/);
    res.end(chunk({ role: 'assistant', content: prompt.includes('PLAN') ? 'Approved plan complete.' : 'Question answers received.' }) + chunk({}, 'stop') + 'data: [DONE]\n\n');
  } catch (error) { fixtureErrors.push(String(error)); res.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const profile = await realpath(await mkdtemp(join(tmpdir(), 'desktop-question-review-')));
const root = join(profile, 'step-runtime'), workspace = join(profile, 'workspace');
await mkdir(root); await mkdir(workspace); await mkdir('test-results', { recursive: true });
await writeFile(join(profile, 'preferences.json'), JSON.stringify({ language: 'zh', theme: 'dark', workspaces: [workspace] }));
await writeFile(join(root, 'config.toml'), 'defaultProvider = "fixture"\ndefaultModel = "fixture"\npermissionPreset = "approve-for-me"\n[telemetry]\nenabled = false\n');
await writeFile(join(root, 'models.json'), JSON.stringify({ providers: { fixture: {
  baseUrl: `http://127.0.0.1:${server.address().port}/v1`, api: 'openai-completions', apiKey: 'isolated-test',
  models: [{ id: 'fixture', name: 'Question fixture', contextWindow: 32768, maxTokens: 2048 }],
} } }));
const env = { ...process.env, DESKTOP_TEST_USER_DATA: profile, DESKTOP_TEST_NO_FOCUS: '1' };
delete env.ELECTRON_RUN_AS_NODE;
const executablePath = process.env.DESKTOP_VERIFY_EXE;
const app = await electron.launch({ ...(executablePath ? { executablePath } : { args: [resolve('.')] }), env, timeout: 60000 });
const errors = [];
try {
  const page = await app.firstWindow(); page.setDefaultTimeout(30000); page.on('pageerror', e => errors.push(e.message));
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0]; w.setOpacity(0); w.setIgnoreMouseEvents(true); w.showInactive(); w.setSize(1360, 900);
  });
  await page.evaluate(() => window.desktop.snapshot());
  await page.getByText('Step Code 已连接', { exact: true }).waitFor({ timeout: 60000 });
  const dialog = page.getByRole('dialog', { name: '回答问题', exact: true });
  const send = async (prompt, approval = false) => {
    await page.waitForFunction(() => document.querySelector('.composer-action-button')?.getAttribute('data-action') === 'send');
    await page.getByRole('textbox', { name: '消息', exact: true }).fill(prompt);
    await page.locator('.composer-action-button[data-action="send"]').click();
    if (approval) {
      const permission = page.locator('.permission-approval');
      await permission.waitFor();
      await permission.getByRole('button', { name: '批准本次操作', exact: true }).click();
    }
    await dialog.waitFor({ timeout: 60000 });
  };
  const answer = async () => {
    await dialog.getByRole('radio', { name: /Broader change/ }).click();
    await dialog.getByRole('textbox', { name: '你的回答', exact: true }).fill('No dependencies');
    await dialog.getByRole('button', { name: '下一题', exact: true }).last().click();
    await dialog.getByRole('radio', { name: '其他回答', exact: true }).check();
    await dialog.getByRole('textbox', { name: '你的回答', exact: true }).fill('HTML preview');
  };
  await send('ASK');
  assert.equal(await page.getByRole('dialog').count(), 1, 'No generic second-level modal accompanies the drawer');
  assert.equal(await dialog.getAttribute('aria-modal'), 'false');
  assert.equal(await dialog.getByText('Beta', { exact: true }).count(), 1);
  await page.locator('.working .matrix-pulse[data-mode="waiting"]').waitFor();
  assert.equal(await page.locator('.working .matrix-pulse').count(), 1, 'Question waits use the merged matrix component');
  assert.equal(await page.locator('.working .working-dot').count(), 0, 'Do not reintroduce the old pulse alongside the matrix');
  await page.locator('.working .working-elapsed').waitFor();
  const questionStatus = page.locator('.working > .question-review-trigger.turn-status-trigger');
  await questionStatus.waitFor();
  assert.equal(await page.locator('.working-indicator .question-review-trigger').count(), 0, 'Questions sit alongside task controls, not inside the primary pulse');
  assert.equal(await questionStatus.locator('.turn-status-icon svg circle').count(), 1, 'Question control uses the circle-help icon');
  const placement = await questionStatus.evaluate(button => {
    const indicator = button.parentElement.querySelector('.working-indicator');
    return indicator.getBoundingClientRect().right <= button.getBoundingClientRect().left;
  });
  assert.equal(placement, true, 'Question status follows the working indicator');
  const snapshot = await page.evaluate(() => window.desktop.snapshot());
  const request = snapshot.requests[0];
  assert.equal(request.timeout, undefined, 'No unattended timeout invented by Desktop');
  assert.equal(snapshot.launch.plan, false);
  await assert.rejects(page.evaluate(async saved => {
    await window.desktop.command('extension_ui_response', { id: saved.id, value: JSON.stringify([
      { id: 'scope', value: 'forged', wasCustom: false },
      { id: 'constraints', value: 'Text', wasCustom: true },
      { id: 'format', value: 'md', wasCustom: false },
    ]) }, saved.runtimeId);
  }, request));
  assert.equal((await page.evaluate(() => window.desktop.snapshot())).requests[0].id, request.id);
  await page.screenshot({ path: 'test-results/questions-choice-dark.png' });
  await page.evaluate(() => { document.documentElement.dataset.theme = 'light'; });
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'test-results/questions-choice-light.png' });
  await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; });
  await page.waitForTimeout(300);
  await dialog.getByRole('radio', { name: /Small change/ }).click();
  await dialog.getByRole('textbox', { name: '你的回答', exact: true }).fill('Retain this draft');
  await dialog.getByRole('button', { name: '稍后回答', exact: true }).click();
  await dialog.waitFor({ state: 'hidden' });
  const count = payloads.length;
  await page.waitForTimeout(800);
  assert.equal(payloads.length, count, 'Unanswered question blocks the model, not an implicit default');
  await page.getByRole('button', { name: '打开待回答问题', exact: true }).click();
  assert.equal(await dialog.getByRole('textbox', { name: '你的回答', exact: true }).inputValue(), 'Retain this draft');
  await dialog.getByRole('button', { name: '稍后回答', exact: true }).click();
  await dialog.waitFor({ state: 'hidden' });
  await page.getByRole('button', { name: '新建会话', exact: true }).click();
  await page.waitForFunction(async () => Boolean((await window.desktop.snapshot()).draftId));
  await page.locator('.session-row').filter({ hasText: 'ASK' }).locator('button').first().click();
  await dialog.waitFor();
  assert.equal(await dialog.getByRole('textbox', { name: '你的回答', exact: true }).inputValue(), 'Retain this draft', 'Draft survives session navigation');
  await dialog.getByRole('button', { name: '上一题', exact: true }).click();
  assert.equal(await dialog.getByRole('radio', { name: /Small change/ }).isChecked(), true);
  const selectedRadio = dialog.getByRole('radio', { name: /Small change/ });
  await selectedRadio.press('Tab');
  await selectedRadio.press('Shift+Tab');
  await page.waitForTimeout(250);
  assert.deepEqual(await selectedRadio.evaluate(el => ({
    letter: el.nextElementSibling.textContent,
    transform: getComputedStyle(el.nextElementSibling).transform,
    easing: getComputedStyle(el.nextElementSibling).transitionTimingFunction.split('),')[0] + ')',
  })), { letter: 'A', transform: 'matrix(1.12, 0, 0, 1.12, 0, 0)', easing: 'cubic-bezier(0.215, 0.61, 0.355, 1)' });
  await page.screenshot({ path: 'test-results/questions-selected-dark.png' });
  await page.evaluate(() => { document.documentElement.dataset.theme = 'light'; });
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'test-results/questions-selected-light.png' });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(900, 740));
  await page.waitForTimeout(220);
  await page.screenshot({ path: 'test-results/questions-selected-narrow.png' });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1360, 900));
  await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; });
  await page.waitForTimeout(300);
  await answer();
  await dialog.getByRole('button', { name: '上一题', exact: true }).click();
  assert.equal(await dialog.getByRole('textbox', { name: '你的回答', exact: true }).inputValue(), 'No dependencies');
  await dialog.getByRole('button', { name: '下一题', exact: true }).last().click();
  assert.equal(await dialog.getByRole('textbox', { name: '你的回答', exact: true }).inputValue(), 'HTML preview');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(900, 740));
  await dialog.getByRole('button', { name: '调整提问高度', exact: true }).press('Enter');
  await page.waitForTimeout(220);
  await page.screenshot({ path: 'test-results/questions-freeform-narrow.png' });
  const bounds = await dialog.boundingBox(); assert.ok(bounds.x >= 0 && bounds.width <= 900 && bounds.y >= 0);
  const covered = await page.locator('.composer-underlay').evaluate(el => getComputedStyle(el).visibility);
  assert.equal(covered, 'hidden', 'Drawer covers the composer parameters');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1360, 900));
  await page.screenshot({ path: 'test-results/questions-freeform-dark.png' });
  await app.evaluate(({ ipcMain }) => {
    const original = ipcMain._invokeHandlers.get('desktop'); let failOnce = true;
    ipcMain.removeHandler('desktop');
    ipcMain.handle('desktop', (event, method, ...args) => {
      if (failOnce && method === 'command' && args[0] === 'extension_ui_response') {
        failOnce = false; throw new Error('Fixture submission failure');
      }
      return original(event, method, ...args);
    });
  });
  await dialog.getByRole('button', { name: '提交回答', exact: true }).click();
  await dialog.getByRole('alert').waitFor();
  assert.equal(await dialog.getByRole('textbox', { name: '你的回答', exact: true }).inputValue(), 'HTML preview');
  await dialog.getByRole('button', { name: '提交回答', exact: true }).click();
  await dialog.waitFor({ state: 'hidden' });
  await page.waitForFunction(async () => !(await window.desktop.snapshot()).state.isStreaming);
  const result = (await page.evaluate(() => window.desktop.snapshot())).messages.find(m => m.toolName === 'clarify_user');
  assert.equal(result.details.cancelled, false);
  assert.deepEqual(result.details.answers.map(a => a.value), ['large', 'No dependencies', 'HTML preview']);
  assert.deepEqual(result.details.answers.map(a => a.wasCustom), [false, true, true]);
  await page.locator('.process-tool > summary').filter({ hasText: '已回答问题' }).click();
  await page.screenshot({ path: 'test-results/questions-answered-dark.png' });

  await page.getByRole('button', { name: '访问权限', exact: true }).click();
  await page.getByRole('menuitemcheckbox', { name: '计划模式', exact: true }).click();
  await page.waitForFunction(async () => (await window.desktop.snapshot()).launch.planArmed === true);
  await send('PLAN');
  assert.equal((await page.evaluate(() => window.desktop.snapshot())).launch.plan, true);
  assert.equal(await page.locator('.working > .launch-status-trigger:not(.question-review-trigger)').count(), 1, 'Plan and question controls share the working status row');
  await dialog.getByRole('button', { name: '稍后回答', exact: true }).click();
  await dialog.waitFor({ state: 'hidden' });
  await page.locator('.working').scrollIntoViewIfNeeded();
  await page.waitForTimeout(220);
  await page.screenshot({ path: 'test-results/questions-plan-status-dark.png' });
  await questionStatus.click();
  await dialog.waitFor();
  await page.waitForTimeout(220);
  await page.screenshot({ path: 'test-results/questions-plan-drawer-dark.png' });
  await answer();
  await dialog.getByRole('button', { name: '提交回答', exact: true }).click();
  const plan = page.getByRole('dialog', { name: '审阅计划', exact: true });
  await plan.waitFor({ timeout: 60000 }); await dialog.waitFor({ state: 'hidden' });
  assert.equal((await page.evaluate(() => window.desktop.snapshot())).launch.plan, true, 'Answering does not approve the plan');
  await plan.getByRole('button', { name: '批准并执行', exact: true }).click();
  await page.waitForFunction(async () => !(await window.desktop.snapshot()).state.isStreaming);
  assert.equal((await page.evaluate(() => window.desktop.snapshot())).launch.plan, false);

  await send('CANCEL');
  await dialog.getByRole('button', { name: '取消提问', exact: true }).click();
  await page.waitForFunction(async () => !(await window.desktop.snapshot()).state.isStreaming);
  const cancelled = (await page.evaluate(() => window.desktop.snapshot())).messages.filter(m => m.toolName === 'clarify_user').at(-1);
  assert.equal(cancelled.details.cancelled, true);
  await send('STOP');
  const stopOwner = (await page.evaluate(() => window.desktop.snapshot())).runtimeId;
  await page.evaluate(owner => window.desktop.command('abort', undefined, owner), stopOwner);
  await dialog.waitFor({ state: 'hidden' });
  assert.equal((await page.evaluate(() => window.desktop.snapshot())).requests.length, 0, 'Abort clears the exact pending question');
  await page.evaluate(() => window.desktop.command('set_permission_preset', { preset: 'ask' }));
  await send('LEGACY', true);
  await page.waitForTimeout(200);
  assert.equal(await page.locator('.composer-underlay').evaluate(el => getComputedStyle(el).visibility), 'hidden',
    'Question remains covered after the prior permission drawer finishes closing');
  await dialog.getByRole('radio', { name: 'Yes', exact: true }).check();
  assert.equal(await dialog.isVisible(), true, 'Final single choice does not submit');
  await dialog.getByRole('button', { name: '提交回答', exact: true }).click();
  await page.waitForFunction(async () => !(await window.desktop.snapshot()).state.isStreaming);
  assert.deepEqual(errors, []); assert.deepEqual(fixtureErrors, []);
  console.log('Clarification Beta: real RPC tool, single/multi-question draft, validation/retry, Plan gating, cancel and abort passed.');
} catch (error) {
  const page = await app.firstWindow().catch(() => undefined);
  await page?.screenshot({ path: 'test-results/questions-failure.png' }).catch(() => {});
  const snapshot = await page?.evaluate(() => window.desktop.snapshot()).catch(() => undefined);
  console.error('Question acceptance diagnostic', JSON.stringify({ calls: payloads.length, fixtureErrors,
    requests: snapshot?.requests, pending: snapshot?.pendingMessages, state: snapshot?.state,
    lastResult: text(snapshot?.messages?.at(-1)?.content) }));
  throw error;
} finally {
  await app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 1 }); }).catch(() => {});
  await app.close(); await new Promise(resolve => server.close(resolve));
}
