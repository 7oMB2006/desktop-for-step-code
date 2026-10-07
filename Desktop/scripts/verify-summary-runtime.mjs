import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const profile = await mkdtemp(join(tmpdir(), 'step-summary-runtime-'));
const workspace = join(profile, 'summary-board');
await mkdir(workspace);
const exec = promisify(execFile);
const git = async (...args) => exec('git', ['-C', workspace, ...args], { windowsHide: true });
await git('init', '-b', 'main');
await git('config', 'user.name', 'Summary fixture');
await git('config', 'user.email', 'fixture@example.invalid');
await git('config', 'commit.gpgsign', 'false');
await git('config', 'core.hooksPath', join(profile, 'no-hooks'));
await writeFile(join(workspace, 'summary.txt'), 'Summary board\n');
await git('add', '--', '.');
await git('commit', '-m', 'base');
await git('switch', '-c', 'codex/summary-board');
await writeFile(join(workspace, 'summary.txt'), 'Summary board\nRepository first, then live tasks.\n');
const runtimeProfile = join(profile, 'step-runtime');
const history = join(runtimeProfile, 'sessions');
await mkdir(history, { recursive: true });
await mkdir(join(runtimeProfile, 'agent', 'skills', 'summary-fixture'), { recursive: true });
await writeFile(join(runtimeProfile, 'agent', 'skills', 'summary-fixture', 'SKILL.md'), '---\nname: summary-fixture\ndescription: Local summary fixture\n---\nRead-only fixture.\n');
await writeFile(join(runtimeProfile, 'config.toml'), 'defaultProvider = "fixture"\ndefaultModel = "fixture"\npermissionPreset = "bypass"\n[telemetry]\nenabled = false\n[mcp_servers.reference-library]\ncommand = "disabled-fixture"\nenabled = false\n[mcp_servers.local-search]\ncommand = "does-not-exist-summary-fixture"\n');
const timestamp = new Date().toISOString();
const task = (id, subject, status) => ({ id, subject, status, description: '核对真实运行时数据、会话隔离与界面状态，完成后保留验收结果。', blocks: [], blockedBy: [], createdAt: Date.now(), updatedAt: Date.now() });
await writeFile(join(history, 'summary-fixture.jsonl'), [
  { type: 'session', version: 3, id: 'summary-fixture', cwd: workspace, timestamp },
  { type: 'message', id: 'u', parentId: null, timestamp, message: { role: 'user', content: '把摘要板接入真实会话数据。', timestamp: Date.now() } },
  { type: 'custom', id: 'tasks', parentId: 'u', timestamp, customType: 'step-tasks', data: { nextId: 4, activePlan: { id: 'summary-plan', title: '接入摘要板并验证运行状态' }, tasks: [task('1', '核对仓库变更与比较基线', 'completed'), task('2', '接入清单与完成动画', 'in_progress'), task('3', '验证 MCP 状态和 Skills 数量', 'pending')] } },
  { type: 'message', id: 'a', parentId: 'tasks', timestamp, message: { role: 'assistant', content: [{ type: 'text', text: '仓库概览与推进清单现在共用真实会话的数据来源。\n\n完成的步骤会收进已完成分组，正在推进的步骤保留运行状态。\n\n' + '正文仍然可以独立滚动，摘要板保持非模态。\n\n'.repeat(30) }], usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: { total: 0 } }, timestamp: Date.now() } },
  { type: 'session_info', id: 'name', parentId: 'a', timestamp, name: '摘要板运行时验收' },
].map(value => JSON.stringify(value)).join('\n') + '\n');
let calls = 0;
const chunk = (delta, finish_reason = null) => `data: ${JSON.stringify({ id: 'summary', object: 'chat.completion.chunk', model: 'fixture', created: 1, choices: [{ index: 0, delta, finish_reason }] })}\n\n`;
const server = createServer(async (request, response) => {
  for await (const part of request) { /* fixture consumes requests without logging */ }
  response.writeHead(200, { 'content-type': 'text/event-stream' });
  if (calls++ === 0) {
    response.end(chunk({ role: 'assistant', tool_calls: [
      { index: 0, id: 'summary-update', type: 'function', function: { name: 'task_update', arguments: JSON.stringify({ taskId: '2', status: 'completed' }) } },
      { index: 1, id: 'summary-create', type: 'function', function: { name: 'task_create', arguments: JSON.stringify({ subject: '验证清单生成动画', description: '新增项平顺展开，已有项不重播。' }) } },
    ] }) + chunk({}, 'tool_calls') + 'data: [DONE]\n\n');
  } else response.end(chunk({ role: 'assistant', content: '清单更新完成。' }) + chunk({}, 'stop') + 'data: [DONE]\n\n');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
await writeFile(join(runtimeProfile, 'models.json'), JSON.stringify({ providers: { fixture: { baseUrl: `http://127.0.0.1:${server.address().port}/v1`, api: 'openai-completions', apiKey: 'local-fixture-only', models: [{ id: 'fixture', name: 'Local fixture', contextWindow: 32768, maxTokens: 2048 }] } } }));
await writeFile(join(profile, 'preferences.json'), JSON.stringify({ language: 'zh', theme: 'dark', workspace, workspaces: [workspace] }));
await mkdir('test-results', { recursive: true });
const env = { ...process.env, DESKTOP_TEST_USER_DATA: profile, DESKTOP_TEST_NO_FOCUS: '1' };
delete env.ELECTRON_RUN_AS_NODE;
const executablePath = process.env.DESKTOP_VERIFY_EXE;
const app = await electron.launch({ ...(executablePath ? { executablePath } : {}), args: [...(executablePath ? [] : [resolve('.')]), '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding', '--disable-features=CalculateNativeWinOcclusion'], env, timeout: 60000 });
try {
  const page = await app.firstWindow();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    window.setOpacity(0); window.setIgnoreMouseEvents(true); window.showInactive(); window.setSize(1600, 1000);
  });
  await page.getByRole('button', { name: '摘要板运行时验收', exact: true }).click();
  const board = page.getByRole('complementary', { name: '摘要', exact: true });
  await board.locator('.sb-plan-title').filter({ hasText: '接入摘要板' }).waitFor();
  assert.equal(await board.locator('.sb-task-shell.is-new').count(), 0, 'Historical tasks must not replay entrance');
  await page.waitForFunction(() => document.querySelector('.sb-skills strong')?.textContent === '1');
  await board.locator('.sb-mcp-trigger').click();
  await board.locator('.sb-mcp-server').filter({ hasText: 'local-search' }).getByText('连接失败', { exact: true }).waitFor();
  assert.equal(await board.getByText('已关闭', { exact: true }).count(), 1);
  const services = await page.evaluate(async () => {
    const snapshot = await window.desktop.snapshot();
    return (await window.desktop.summary(snapshot.runtimeId)).mcp;
  });
  assert.ok(services.some(server => server.name === 'reference-library' && server.status === 'disabled'));
  assert.equal(await board.locator('.sb-mcp-count').textContent(), `${services.filter(server => server.status === 'connected').length} / ${services.length}`);
  assert.equal(await board.locator('.sb-repository h3').textContent(), 'summary-board');
  await board.getByRole('button', { name: /已完成 1 项/ }).click();
  await board.getByRole('button', { name: /接入清单与完成动画/ }).click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'test-results/summary-runtime-dark.png' });
  await board.getByRole('button', { name: /已完成 1 项/ }).click();
  await page.evaluate(() => {
    window.summaryMotion = [];
    window.summaryEntrance = [];
    const record = () => {
      const live = [...document.querySelectorAll('.sb-step')].find(element => element.textContent.includes('接入清单与完成动画'));
      window.summaryMotion.push({ settling: live?.querySelector('[data-settling]')?.getAttribute('data-settling'), height: live?.getBoundingClientRect().height, state: live?.className });
      const created = [...document.querySelectorAll('.sb-task-shell')].find(element => element.textContent.includes('验证清单生成动画'));
      if (created) window.summaryEntrance.push({ height: created.getBoundingClientRect().height, opacity: Number(getComputedStyle(created).opacity),
        easing: getComputedStyle(created).transitionTimingFunction });
      if (window.summaryMotion.length < 240) requestAnimationFrame(record);
    };
    requestAnimationFrame(record);
  });
  await page.locator('.composer > textarea').fill('完成第二项');
  await page.locator('.composer > textarea').press('Enter');
  await board.getByRole('button', { name: /已完成 2 项/ }).waitFor();
  await page.waitForTimeout(1500);
  const update = await page.evaluate(async () => {
    const snapshot = await window.desktop.snapshot();
    return window.desktop.summary(snapshot.runtimeId);
  });
  assert.equal(update.tasks.find(task => task.id === '2').status, 'completed', 'Actual task_update must reach the board');
  assert.ok(update.tasks.some(task => task.subject === '验证清单生成动画'), 'Actual task_create must reach the board');
  const entrance = await page.evaluate(() => window.summaryEntrance);
  assert.ok(entrance.some(frame => frame.height > 0 && frame.height < 30 && frame.opacity > 0 && frame.opacity < 1), 'New tasks must have intermediate height and opacity frames');
  assert.ok(entrance.some(frame => frame.easing.includes('cubic-bezier(0.22, 1, 0.36, 1)')), 'Entrance uses shared cubic easing');
  assert.ok(entrance.some(frame => frame.height >= 34 && frame.opacity === 1), 'New tasks settle at full height and opacity');
  const frames = await page.evaluate(() => window.summaryMotion);
  assert.ok(frames.some(frame => frame.settling === 'true' && frame.height > 20), 'mounted completion must animate before folding');
  assert.equal(await board.getByRole('button', { name: /接入清单与完成动画/ }).isVisible(), false, 'completed row collapses after its animation');
  await board.getByRole('button', { name: /已完成 2 项/ }).click();
  await board.getByRole('button', { name: /接入清单与完成动画/ }).waitFor();
  await page.waitForTimeout(350);
  await page.screenshot({ path: 'test-results/summary-runtime-completed.png' });
  await board.locator('.sb-repo-change').click();
  const review = page.getByRole('complementary', { name: '变更', exact: true });
  await review.waitFor();
  assert.equal(await review.getByRole('button', { name: '变更来源', exact: true }).textContent(), '分支');
  await review.getByRole('button', { name: '关闭变更', exact: true }).click();
  await page.locator('.right-tool-rail').getByRole('button', { name: '摘要', exact: true }).click();
  await board.waitFor();
  assert.equal(await board.locator('.sb-task-shell.is-new').count(), 0, 'Reopening the board must not replay existing tasks');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  assert.equal(await board.locator('.sb-task-shell').first().evaluate(element => getComputedStyle(element).transitionDuration), '0s', 'Reduced motion disables task transitions');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.locator('.sidebar-bottom > button').click();
  await page.getByRole('button', { name: '通用', exact: true }).click();
  await page.getByRole('dialog').getByLabel(/主题|Theme/).selectOption('light');
  await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click();
  await board.locator('.sb-mcp-trigger').click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'test-results/summary-runtime-light.png' });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(800, 800));
  await page.waitForTimeout(500);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.screenshot({ path: 'test-results/summary-runtime-narrow.png' });
  await page.evaluate(async () => { await window.desktop.newIndependentSession(); });
  await page.reload();
  await page.locator('.right-tool-rail').getByRole('button', { name: '摘要', exact: true }).click();
  await board.waitFor();
  await board.getByText('暂无任务清单', { exact: true }).waitFor();
  assert.equal(await board.locator('.sb-repository').count(), 0);
  assert.deepEqual(errors, []);
  console.log('Summary runtime acceptance passed: real task_create/update, cubic entrance frames, no history replay, reduced motion, repository link, live MCP/Skills, completion folding, themes, narrow layout and session isolation.');
} finally {
  await app.close();
  await new Promise(resolve => server.close(resolve));
}
