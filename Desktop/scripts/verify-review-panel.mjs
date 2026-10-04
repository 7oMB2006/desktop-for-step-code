import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import { verifyInspectorExpansion } from './verify-inspector-expansion.mjs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const exec = promisify(execFile);
const profile = await mkdtemp(join(tmpdir(), 'step-review-panel-'));
const repo = join(profile, 'stream-client');
await mkdir(join(repo, 'src'), { recursive: true });
await mkdir(join(repo, 'docs'), { recursive: true });
const git = async (...args) => (await exec('git', ['-C', repo, ...args], { windowsHide: true })).stdout;
await git('init', '-b', 'main');
await git('config', 'user.name', 'Review fixture');
await git('config', 'user.email', 'fixture@example.invalid');
await git('config', 'commit.gpgsign', 'false');
await git('config', 'core.hooksPath', join(profile, 'no-hooks'));
await git('config', 'core.autocrlf', 'false');
const before = [
  'export function consumeEvent(event: StreamEvent) {',
  '  if (event.type === "tool_end") {',
  '    state.running = false;',
  '    return;',
  '  }',
  '  if (event.type === "text_delta") {',
  '    appendText(event.text);',
  '  }',
  '}',
  '',
].join('\n');
const after = [
  'export function consumeEvent(event: StreamEvent) {',
  '  if (event.type === "tool_end") {',
  '    updateTool(event.id, "completed");',
  '    return;',
  '  }',
  '  if (event.type === "agent_end") {',
  '    state.running = false;',
  '    return;',
  '  }',
  '  if (event.type === "text_delta") {',
  '    appendText(event.text);',
  '  }',
  '}',
  '',
].join('\n');
await writeFile(join(repo, 'src/stream.ts'), before);
await writeFile(join(repo, 'src/stream.test.ts'), 'export const events = ["text_delta", "tool_end"];\n');
await writeFile(join(repo, 'docs/review.md'), '# Stream recovery\n');
await git('add', '--', '.'); await git('commit', '-m', 'base');
await git('switch', '-c', 'codex/stream-recovery');
await writeFile(join(repo, 'docs/review.md'), '# Stream recovery\n\nKeep the agent lifecycle separate from individual tool completion.\n');
await git('add', '--', 'docs/review.md'); await git('commit', '-m', 'document lifecycle');
await writeFile(join(repo, 'src/context.ts'), 'export const contextScope = {\n  turn: "recorded edits",\n  branch: "repository changes",\n};\n');
const index = await readFile(join(repo, '.git', 'index'));
const chunk = (delta, finish_reason = null) => `data: ${JSON.stringify({
  id: 'review-fixture', object: 'chat.completion.chunk', model: 'fixture', created: 1,
  choices: [{ index: 0, delta, finish_reason }],
})}\n\n`;
const server = createServer(async (request, response) => {
  let body = '';
  for await (const part of request) body += part;
  const payload = JSON.parse(body);
  const messages = payload.messages.slice(payload.messages.findLastIndex(message => message.role === 'user') + 1);
  const count = messages.filter(message => message.role === 'tool').length;
  response.writeHead(200, { 'content-type': 'text/event-stream' });
  if (count >= 2) {
    response.end(chunk({ role: 'assistant', content:
      '已修复工具结束后正文无法继续输出的问题。\n\n### 调整\n\n- `tool_end` 只更新对应工具，不结束整轮。\n- `agent_end` 统一关闭运行状态。\n- 保留正在输出的文字和原有淡入动画。\n\n新增了工具结束后继续收到文本的回归用例。修改仅涉及事件处理与测试，文档和其他工作区改动保持不动。' })
      + chunk({}, 'stop') + 'data: [DONE]\n\n');
    return;
  }
  const tool = payload.tools.find(item => ['edit', 'edit_file'].includes(item.function.name));
  assert.ok(tool);
  const path = count ? 'src/stream.test.ts' : 'src/stream.ts';
  const oldText = count ? 'export const events = ["text_delta", "tool_end"];' : before.trimEnd();
  const newText = count ? 'export const events = ["text_delta", "tool_end", "text_delta", "agent_end"];' : after.trimEnd();
  const args = tool.function.parameters.properties?.search ? { path, search: oldText, replace: newText }
    : { path, edits: [{ oldText, newText }] };
  response.end(chunk({ tool_calls: [{ index: 0, id: `review-edit-${count}`, type: 'function',
    function: { name: tool.function.name, arguments: JSON.stringify(args) } }] })
    + chunk({}, 'tool_calls') + 'data: [DONE]\n\n');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
await writeFile(join(profile, 'preferences.json'), JSON.stringify({ theme: 'light', language: 'zh', workspaces: [repo] }));
await mkdir(join(profile, 'step-runtime', 'sessions'), { recursive: true });
await writeFile(join(profile, 'step-runtime', 'config.toml'), 'defaultProvider = "fixture"\ndefaultModel = "fixture"\npermissionPreset = "bypass"\n[telemetry]\nenabled = false\n');
await writeFile(join(profile, 'step-runtime', 'models.json'), JSON.stringify({
  providers: { fixture: { baseUrl: `http://127.0.0.1:${server.address().port}/v1`, api: 'openai-completions', apiKey: 'local-test-only',
    models: [{ id: 'fixture', name: 'Review fixture', contextWindow: 32768, maxTokens: 2048 }] } },
}));
await mkdir('test-results', { recursive: true });
const env = { ...process.env, DESKTOP_TEST_USER_DATA: profile, DESKTOP_TEST_NO_FOCUS: '1' };
delete env.ELECTRON_RUN_AS_NODE;
const executablePath = process.env.DESKTOP_VERIFY_EXE;
const app = await electron.launch({ ...(executablePath ? { executablePath } : {}), args: [...(executablePath ? [] : [resolve('.')]), '--disable-backgrounding-occluded-windows',
  '--disable-renderer-backgrounding', '--disable-features=CalculateNativeWinOcclusion'], env, timeout: 60000 });
try {
  const page = await app.firstWindow();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    window.setOpacity(0); window.setIgnoreMouseEvents(true); window.showInactive(); window.setSize(1706, 1000);
  });
  // Native menus live outside the renderer; inspect their real items through main-process hooks.
  await app.evaluate(({ Menu }) => {
    globalThis.reviewMenuFixture = { choice: null, menus: [] };
    Menu.prototype.popup = function (options) {
      const fixture = globalThis.reviewMenuFixture;
      fixture.menus.push(this.items.map(item => ({ label: item.label, checked: item.checked, enabled: item.enabled, type: item.type })));
      const item = this.items.find(item => item.label === fixture.choice);
      if (item) item.click();
      options.callback?.();
    };
  });
  const choose = async (label, choice) => {
    await app.evaluate((_, choice) => { globalThis.reviewMenuFixture.choice = choice; }, choice);
    await panel.getByRole('button', { name: label, exact: true }).click();
  };
  await page.getByText('Step Code 已连接', { exact: true }).waitFor({ timeout: 60000 });
  await page.evaluate(() => { HTMLMediaElement.prototype.play = () => Promise.resolve(); });
  await page.getByRole('region', { name: repo, exact: true }).getByRole('button', { name: '在 stream-client 新建会话', exact: true }).click();
  await page.waitForFunction(repo => document.querySelector('.empty-state p')?.textContent === repo.split(/[\\/]/).at(-1), repo);
  const input = page.locator('.composer > textarea');
  await input.fill('修复工具结束后正文无法继续输出的问题，保留现有的流式动画。');
  await input.press('Enter');
  await page.getByText('已修复工具结束后正文无法继续输出的问题。', { exact: true }).waitFor({ timeout: 60000 });
  await page.waitForFunction(async () => !(await window.desktop.snapshot()).state.isStreaming);
  const snapshot = await page.evaluate(() => window.desktop.snapshot());
  const statusBefore = await git('status', '--porcelain');
  await assert.rejects(page.evaluate(() => window.desktop.repositoryDiff('forged-runtime')));
  await assert.rejects(page.evaluate(runtimeId => window.desktop.repositoryDiff(runtimeId, '--output=outside'), snapshot.runtimeId));
  await assert.rejects(page.evaluate(runtimeId => window.desktop.repositoryFileDiff(runtimeId, 'main', '../outside.txt'), snapshot.runtimeId));
  await assert.rejects(page.evaluate(() => window.desktop.reviewMenu('forged-runtime', 'source', 'turn', { x: 0, y: 0 })));
  await assert.rejects(page.evaluate(() => window.desktop.reviewMenu(undefined, 'source', 'forged', { x: 0, y: 0 })));
  await assert.rejects(page.evaluate(() => window.desktop.reviewMenu(undefined, 'source', 'turn', { x: null, y: 0 })));
  const toggle = page.locator('.right-tool-rail').getByRole('button', { name: '变更', exact: true });
  await toggle.click();
  const panel = page.getByRole('complementary', { name: '变更', exact: true });
  await panel.waitFor();
  await page.waitForFunction(() => !document.querySelector('.review-header button[aria-label="刷新变更"]')?.disabled);
  assert.equal(await panel.locator('.review-file-row').count(), 2);
  await panel.getByRole('button', { name: '预览变更 src/stream.ts', exact: true }).click();
  await panel.locator('.turn-diff-table').waitFor();
  await page.waitForTimeout(400);
  assert.ok((await panel.locator('.turn-diff-table').innerText()).includes('updateTool'));
  await page.mouse.move(700, 25);
  await page.screenshot({ path: 'test-results/review-last-turn-light.png' });
  await panel.screenshot({ path: 'test-results/review-last-turn-detail.png' });
  await choose('变更来源', null);
  assert.equal(await panel.getByLabel('变更来源').innerText(), '上一轮');
  await choose('变更来源', '分支');
  await panel.getByRole('button', { name: '预览变更 docs/review.md', exact: true }).waitFor();
  assert.equal(await panel.locator('.review-file-row').count(), 4);
  await panel.getByRole('button', { name: '预览变更 src/stream.ts', exact: true }).click();
  await panel.locator('.turn-diff-table').waitFor({ timeout: 30000 });
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'test-results/review-branch-light.png' });
  await panel.screenshot({ path: 'test-results/review-branch-detail.png' });
  const openPatch = await panel.locator('.turn-diff-table').innerText();
  await verifyInspectorExpansion(page, panel, 'diff-expanded-light');
  assert.equal(await panel.locator('.turn-diff-table').innerText(), openPatch);
  assert.equal(await panel.getByLabel('变更来源').innerText(), '分支');
  await choose('对比基线', 'HEAD');
  await page.waitForFunction(() => !document.querySelector('.review-scroll')?.textContent.includes('review.md'));
  assert.equal(await panel.locator('.review-file-row').count(), 3);
  await choose('对比基线', 'main');
  await panel.getByRole('button', { name: '预览变更 docs/review.md', exact: true }).waitFor();
  const contextRow = panel.getByRole('button', { name: '预览变更 src/context.ts', exact: true });
  await contextRow.click();
  await panel.locator('.turn-diff-table').waitFor();
  await contextRow.click();
  await panel.locator('.turn-diff-table').waitFor({ state: 'detached' });
  await rename(join(repo, 'src/context.ts'), join(repo, 'src/context-away.ts'));
  await contextRow.click();
  await panel.getByText('读取失败，请刷新后重试', { exact: true }).waitFor();
  assert.equal(await panel.locator('.turn-diff-table').count(), 0);
  await rename(join(repo, 'src/context-away.ts'), join(repo, 'src/context.ts'));
  await contextRow.click();
  await contextRow.click();
  await panel.locator('.turn-diff-table').waitFor();
  await git('branch', 'review-base', 'main');
  await choose('对比基线', 'review-base');
  await page.waitForFunction(() => document.querySelector('[aria-label="对比基线"]')?.textContent.trim() === 'review-base');
  await page.waitForFunction(() => !document.querySelector('.review-header button[aria-label="刷新变更"]')?.disabled);
  await panel.getByRole('button', { name: '预览变更 src/stream.ts', exact: true }).click();
  await panel.locator('.turn-diff-table').waitFor();
  await git('branch', '-D', 'review-base');
  await panel.getByRole('button', { name: '刷新变更', exact: true }).click();
  await panel.getByText('仓库读取失败，请刷新重试', { exact: true }).waitFor();
  assert.equal(await panel.locator('.review-file-row').count(), 0);
  assert.equal(await panel.locator('.turn-diff-table').count(), 0);
  assert.equal(await panel.locator('.review-totals').count(), 0);
  assert.equal(await panel.getByLabel('对比基线').count(), 0);
  assert.equal(await panel.locator('.review-footer > span:last-child').innerText(), '');
  assert.equal(await panel.getByLabel('变更来源').innerText(), '分支');
  await git('branch', 'review-base', 'main');
  await panel.getByRole('button', { name: '刷新变更', exact: true }).click();
  await panel.getByRole('button', { name: '预览变更 docs/review.md', exact: true }).waitFor();
  await choose('对比基线', 'main');
  await page.waitForFunction(() => document.querySelector('[aria-label="对比基线"]')?.textContent.trim() === 'main');
  await page.waitForFunction(() => !document.querySelector('.review-header button[aria-label="刷新变更"]')?.disabled);
  await git('branch', '-D', 'review-base');
  assert.equal(await git('status', '--porcelain'), statusBefore);
  assert.deepEqual(await readFile(join(repo, '.git', 'index')), index);
  await page.locator('.sidebar-bottom > button').click();
  await page.getByRole('button', { name: '通用', exact: true }).click();
  await page.getByRole('dialog').getByLabel(/主题|Theme/).selectOption('dark');
  await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click();
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
  await panel.getByRole('button', { name: '预览变更 src/stream.ts', exact: true }).click();
  await panel.locator('.turn-diff-table').waitFor();
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'test-results/review-branch-dark.png' });
  await verifyInspectorExpansion(page, panel, 'diff-expanded-dark');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(640, 900));
  await page.waitForTimeout(400);
  const box = await panel.boundingBox();
  const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
  assert.ok(box.x >= 0 && box.x + box.width <= viewport.width && box.y + box.height <= viewport.height);
  assert.equal(await panel.locator('.review-scroll').evaluate(element => getComputedStyle(element, '::-webkit-scrollbar').width), '4px');
  await page.screenshot({ path: 'test-results/review-branch-narrow.png' });
  await verifyInspectorExpansion(page, panel, 'diff-expanded-narrow');
  // Sample a real close, including inert content and the retained exit surface.
  const frames = await page.evaluate(async () => {
    document.querySelector('[aria-label="关闭变更"]').click();
    const frames = []; const start = performance.now();
    while (performance.now() - start < 320) {
      await new Promise(resolve => requestAnimationFrame(resolve));
      const panel = document.querySelector('.review-panel');
      if (panel) frames.push({ opacity: Number(getComputedStyle(panel).opacity), inert: panel.inert });
    }
    return frames;
  });
  assert.ok(frames.some(frame => frame.opacity > 0 && frame.opacity < 1 && frame.inert));
  await page.locator('.review-panel').waitFor({ state: 'detached' });
  await toggle.click();
  await panel.waitFor();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  assert.equal(await panel.evaluate(element => getComputedStyle(element).transitionDuration), '0s');
  await panel.getByRole('button', { name: '全屏查看', exact: true }).click();
  assert.equal(await panel.evaluate(element => getComputedStyle(element).transitionDuration), '0s');
  await page.keyboard.press('Escape');
  assert.equal(await panel.getByRole('button', { name: '全屏查看', exact: true }).count(), 1);
  await panel.getByRole('button', { name: '关闭变更', exact: true }).click();
  await panel.waitFor({ state: 'detached' });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1706, 1000));
  await page.getByRole('button', { name: '新建会话', exact: true }).waitFor({ state: 'visible' });
  await page.getByRole('button', { name: '新建会话', exact: true }).click();
  await page.waitForFunction(() => !!document.querySelector('.empty-state'));
  await toggle.click();
  await panel.waitFor();
  await choose('变更来源', '分支');
  await panel.getByText('当前目录不是 Git 仓库，无法查看分支差异。', { exact: true }).waitFor();
  assert.equal(await panel.getByLabel('变更来源').innerText(), '分支');
  assert.equal(await panel.getByLabel('对比基线').count(), 0);
  assert.equal(await panel.locator('.review-totals').count(), 0);
  await panel.getByRole('button', { name: '刷新变更', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('.review-header button[aria-label="刷新变更"]')?.disabled);
  assert.equal(await panel.getByLabel('变更来源').innerText(), '分支');
  await page.screenshot({ path: 'test-results/review-no-git.png' });
  await choose('变更来源', '上一轮');
  assert.equal(await panel.getByLabel('变更来源').innerText(), '上一轮');
  const menus = await app.evaluate(() => globalThis.reviewMenuFixture.menus);
  assert.ok(menus.every(menu => menu.every(item => item.enabled && item.type === 'radio')));
  assert.deepEqual(menus[0].map(item => item.label), ['上一轮', '分支']);
  assert.equal(menus[0][0].checked, true);
  assert.ok(menus.some(menu => menu.some(item => item.label === 'HEAD')));
  await panel.getByRole('button', { name: '全屏查看', exact: true }).click();
  await panel.getByRole('button', { name: '关闭变更', exact: true }).click();
  await panel.waitFor({ state: 'detached' });
  await toggle.click();
  await panel.waitFor();
  assert.equal(await panel.getByRole('button', { name: '全屏查看', exact: true }).count(), 1);
  assert.equal(await page.locator('main').evaluate(element => element.inert), false);
  assert.deepEqual(errors, []);
  await writeFile('test-results/review-close-frames.json', JSON.stringify(frames, null, 2));
  console.log('Review passed: real Git and RPC edits, scopes, base switch, immutable index/history, IPC guards, native radio-menu construction/selection/cancel, themes, narrow layouts, cubic close, reduced motion, and selectable non-Git branch empty state retained after refresh. Native OS menu clicks are simulated through main-process hooks. No paid model or real profile used.');
} catch (error) {
  const page = app.windows()[0];
  if (page) await page.screenshot({ path: 'test-results/review-failure.png' });
  throw error;
} finally {
  await app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false }); }).catch(() => {});
  await app.close();
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}
