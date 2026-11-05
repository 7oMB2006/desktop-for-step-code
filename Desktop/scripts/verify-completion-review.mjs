import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron as electron } from 'playwright';
import { closeDesktopFixture } from './close-desktop-fixture.mjs';
import { settleLayout } from './settle-layout.mjs';

const output = process.env.DESKTOP_VERIFY_OUTPUT || 'test-results/completion-review';
await mkdir(output, { recursive: true });
const requests = [];
let original, reviewer;
const send = (response, content, done = false) => {
  response.write(`data: ${JSON.stringify({ id: 'review', object: 'chat.completion.chunk', model: 'fixture',
    choices: [{ index: 0, delta: { content }, finish_reason: done ? 'stop' : null }],
    ...(done ? { usage: { prompt_tokens: 42, completion_tokens: 7, total_tokens: 49 } } : {}),
  })}\n\n`);
  if (done) response.end('data: [DONE]\n\n');
};
const server = createServer(async (request, response) => {
  let raw = ''; for await (const chunk of request) raw += chunk;
  const body = JSON.parse(raw); requests.push(body);
  response.writeHead(200, { 'content-type': 'text/event-stream' });
  const texts = body.messages.map(message => JSON.stringify(message.content));
  const reviewIndex = texts.findLastIndex(text => text.includes('Final self-review:'));
  const taskIndex = texts.findLastIndex(text => text.includes('REVIEW-NATIVE-MAIN'));
  if (reviewIndex > taskIndex) { reviewer = response; send(response, '正在补验最终修改。'); }
  else { original = response; send(response, '已处理主要任务，正在收尾。'); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const profile = await mkdtemp(join(tmpdir(), 'desktop-review-native-'));
const root = join(profile, 'step-runtime');
await mkdir(root);
await writeFile(join(profile, 'preferences.json'), JSON.stringify({ language: 'zh', theme: 'dark' }));
await writeFile(join(root, 'config.toml'), 'defaultProvider = "fixture"\ndefaultModel = "fixture"\npermissionPreset = "ask"\n[telemetry]\nenabled = false\n');
await writeFile(join(root, 'models.json'), JSON.stringify({ providers: { fixture: {
  api: 'openai-completions', baseUrl: `http://127.0.0.1:${server.address().port}/v1`, apiKey: 'isolated-review-native',
  models: [{ id: 'fixture', name: 'Review fixture', contextWindow: 100000, maxTokens: 2048 }],
} } }));
const env = { ...process.env, DESKTOP_TEST_USER_DATA: profile, DESKTOP_TEST_NO_FOCUS: '1' };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ ...(process.env.DESKTOP_VERIFY_EXE ? { executablePath: process.env.DESKTOP_VERIFY_EXE } : { args: [resolve('.')] }),
  env, timeout: 60000 });
const errors = [];
try {
  const page = await app.firstWindow();
  page.on('pageerror', error => errors.push(error.message));
  await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    window.setOpacity(0); window.setIgnoreMouseEvents(true); window.showInactive(); window.setSize(1280, 900);
  });
  await page.waitForFunction(() => !document.querySelector('.composer-wrap[aria-busy="true"]')
    && document.querySelector('.composer > .composer-input')?.getAttribute('contenteditable') === 'true', undefined, { timeout: 60000 });
  await page.evaluate(() => {
    window.reviewEvents = [];
    window.desktop.onEvent(event => { if (['desktop_completion_review', 'desktop_task_completed', 'agent_end'].includes(event.type)) window.reviewEvents.push(event); });
  });
  const permissions = page.getByRole('button', { name: '访问权限', exact: true });
  const choice = page.getByRole('menuitemcheckbox', { name: '完成后自查', exact: true });
  await permissions.click();
  assert.equal(await choice.getAttribute('aria-checked'), 'false');
  await choice.focus();
  await settleLayout(page.locator('.permission-menu'));
  await page.screenshot({ path: join(output, 'menu-dark.png') });
  await choice.press('Enter');
  let snapshot = await page.evaluate(() => window.desktop.snapshot());
  assert.equal(snapshot.launch.reviewArmed, true);
  assert.equal(snapshot.runtimeId, undefined, 'Arming does not start a runtime or model request');
  await permissions.click();
  assert.equal(await page.getByRole('menuitemcheckbox', { name: '计划模式', exact: true }).isDisabled(), true);
  await page.keyboard.press('Escape');
  const input = page.getByRole('textbox', { name: '消息', exact: true });
  await input.fill('REVIEW-NATIVE-MAIN 核对最终修改后再结束。');
  await input.press('Enter');
  const wait = async (predicate, label) => {
    const deadline = Date.now() + 30000;
    while (!await predicate() && Date.now() < deadline) await page.waitForTimeout(40);
    assert.ok(await predicate(), label);
  };
  await wait(() => Boolean(original), 'Original model request arrives');
  assert.equal(requests.length, 1);
  snapshot = await page.evaluate(() => window.desktop.snapshot());
  assert.equal(snapshot.launch.reviewArmed, false);
  assert.equal(snapshot.launch.review.status, 'pending');
  send(original, '原任务回答。', true);
  await wait(() => Boolean(reviewer), 'Automatic reviewer arrives after original settlement');
  snapshot = await page.evaluate(() => window.desktop.snapshot());
  assert.equal(snapshot.state.isStreaming, true);
  assert.equal(snapshot.launch.review.status, 'reviewing');
  const events = await page.evaluate(() => window.reviewEvents);
  assert.equal(events.filter(event => event.type === 'desktop_task_completed').length, 0);
  assert.ok(events.some(event => event.type === 'agent_end' && event.desktopReviewPending));
  await page.getByText('自动自查', { exact: true }).waitFor();
  assert.equal(await page.locator('.messages .message.user').count(), 1, 'Automatic prompt is not a human bubble');
  await page.screenshot({ path: join(output, 'reviewing-dark.png') });
  send(reviewer, '核验结束，保留实际结果。', true);
  await wait(async () => (await page.evaluate(() => window.desktop.snapshot())).launch.review.status === 'ended', 'Review settles');
  await page.getByText('自查流程结束', { exact: true }).waitFor();
  await wait(async () => (await page.evaluate(() => window.reviewEvents)).filter(event => event.type === 'desktop_task_completed').length === 1,
    'Exactly one whole-task completion event arrives');
  assert.equal(requests.length, 2);
  assert.ok(requests.every(request => request.model === 'fixture'));
  assert.equal(await page.getByText('验证通过', { exact: true }).count(), 0);
  assert.equal(await page.locator('.composer-action-icon[data-mode="stop"]').count(), 0);
  for (const [theme, width] of [['dark', 1280], ['light', 1100], ['dark', 640]]) {
    await app.evaluate(({ BrowserWindow }, width) => BrowserWindow.getAllWindows()[0].setSize(width, 900), width);
    await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
    await settleLayout(page.locator('.composer'));
    await page.screenshot({ path: join(output, `ended-${theme}-${width}.png`) });
    assert.equal(await page.locator('.completion-review-note').evaluateAll(elements => elements.some(element =>
      element.scrollWidth > element.clientWidth + 1)), false, 'Review notes wrap at narrow widths');
  }
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await permissions.click();
  await choice.focus();
  await page.screenshot({ path: join(output, 'menu-narrow-reduced-motion.png') });
  await page.keyboard.press('Escape');
  await page.evaluate(() => window.desktop.command('set_launch_mode', { mode: 'plan', enabled: true }));
  await wait(async () => await page.getByRole('button', { name: '计划', exact: true }).count() === 1, 'A later Plan has its own task state');
  assert.equal(await page.getByRole('button', { name: /自查流程结束/ }).count(), 0, 'An old review outcome never labels a later Plan');
  assert.equal(requests.length, 2, 'Changing task options does not call the model');
  await page.evaluate(() => window.desktop.command('set_launch_mode', { mode: 'plan', enabled: false }));
  assert.deepEqual(errors, []);
  console.log('Completion review native menu, provenance, ownership, completion dedup and visual checks passed');
} catch (error) {
  await (await app.firstWindow()).screenshot({ path: join(output, 'failure.png') }).catch(() => {});
  throw error;
} finally {
  for (const response of [original, reviewer]) if (response && !response.writableEnded) send(response, 'Stopped fixture.', true);
  try { await closeDesktopFixture(app); }
  finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    await rm(profile, { recursive: true, force: true });
  }
}
