import assert from 'node:assert/strict';
import { _electron as electron } from 'playwright';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { closeDesktopFixture } from './close-desktop-fixture.mjs';

const profile = await mkdtemp(join(tmpdir(), 'step-task-progress-'));
const workspace = join(profile, 'workspace');
const runtimeProfile = join(profile, 'step-runtime');
await mkdir(workspace);
await mkdir(join(runtimeProfile, 'sessions'), { recursive: true });
await writeFile(join(profile, 'preferences.json'), JSON.stringify({ language: 'zh', theme: 'light', workspace, workspaces: [workspace] }));
await writeFile(join(runtimeProfile, 'config.toml'), [
  'defaultProvider = "fixture"', 'defaultModel = "fixture"', 'permissionPreset = "approve-for-me"',
  '[telemetry]', 'enabled = false', '[mcp_servers.steppage__steppage]', 'enabled = false', '',
].join('\n'));
const timestamp = new Date().toISOString();
const task = (id, subject, status) => ({ id, subject, status, description: subject,
  blocks: [], blockedBy: [], createdAt: Date.now(), updatedAt: Date.now() });
await writeFile(join(runtimeProfile, 'sessions', 'progress-fixture.jsonl'), [
  { type: 'session', version: 3, id: 'progress-fixture', cwd: workspace, timestamp },
  { type: 'message', id: 'u', parentId: null, timestamp, message: { role: 'user', content: '核对日报并归档。', timestamp: Date.now() } },
  { type: 'custom', id: 'tasks', parentId: 'u', timestamp, customType: 'step-tasks', data: {
    nextId: 3, activePlan: { id: 'progress-plan', title: '每日简报' },
    tasks: [task('1', '核对日报', 'completed'), task('2', '验证并归档', 'in_progress')],
  } },
  { type: 'message', id: 'a', parentId: 'tasks', timestamp, message: { role: 'assistant', content: [{ type: 'text', text: '日报已经核对，继续归档。' }],
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: { total: 0 } }, timestamp: Date.now() } },
  { type: 'session_info', id: 'name', parentId: 'a', timestamp, name: '进度条声画验收' },
].map(entry => JSON.stringify(entry)).join('\n') + '\n');
let calls = 0;
const chunk = (delta, finish_reason = null) => `data: ${JSON.stringify({
  id: 'progress', object: 'chat.completion.chunk', model: 'fixture', created: 1,
  choices: [{ index: 0, delta, finish_reason }],
})}\n\n`;
const server = createServer(async (request, response) => {
  for await (const _part of request) { /* Consume fixture data without logging it. */ }
  response.writeHead(200, { 'content-type': 'text/event-stream' });
  if (calls++ === 0) {
    response.end(chunk({ role: 'assistant', tool_calls: [{
      index: 0, id: 'finish-task', type: 'function', function: {
        name: 'task_update', arguments: JSON.stringify({ taskId: '2', status: 'completed' }),
      },
    }] }) + chunk({}, 'tool_calls') + 'data: [DONE]\n\n');
  } else {
    response.write(chunk({ role: 'assistant', content: '归档已完成，正在汇总结果。' }));
    const timer = setTimeout(() => response.end(chunk({ content: '本轮任务已完成。' }) + chunk({}, 'stop') + 'data: [DONE]\n\n'), 2400);
    response.on('close', () => clearTimeout(timer));
  }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
await writeFile(join(runtimeProfile, 'models.json'), JSON.stringify({ providers: { fixture: {
  baseUrl: `http://127.0.0.1:${server.address().port}/v1`, api: 'openai-completions', apiKey: 'local-fixture-only',
  models: [{ id: 'fixture', name: 'Local fixture', contextWindow: 32768, maxTokens: 2048 }],
} } }));
await mkdir('test-results', { recursive: true });
const env = { ...process.env, DESKTOP_TEST_USER_DATA: profile, DESKTOP_TEST_NO_FOCUS: '1' };
delete env.ELECTRON_RUN_AS_NODE;
const executablePath = process.env.DESKTOP_VERIFY_EXE;
let app;
try {
  app = await electron.launch({ ...(executablePath ? { executablePath } : {}),
    args: [...(executablePath ? [] : [resolve('.')]), '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding', '--disable-features=CalculateNativeWinOcclusion'],
    env, timeout: 60000 });
  const page = await app.firstWindow();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    window.setOpacity(0); window.setIgnoreMouseEvents(true); window.showInactive(); window.setSize(1600, 950);
  });
  await page.getByRole('button', { name: '进度条声画验收', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.conversation')?.getAttribute('aria-busy') === 'false'
    && !document.querySelector('.composer-wrap[aria-busy="true"]') && !document.querySelector('.composer > .composer-input')?.disabled);
  await page.locator('.right-tool-rail').getByRole('button', { name: '摘要', exact: true }).click();
  const board = page.getByRole('complementary', { name: '摘要', exact: true });
  const progress = board.getByRole('progressbar');
  await progress.waitFor();
  assert.equal(await progress.getAttribute('aria-valuenow'), '1');
  await page.evaluate(() => {
    window.progressAudio = [];
    window.progressFrames = [];
    HTMLMediaElement.prototype.play = function () {
      window.progressAudio.push({ phase: document.querySelector('.sb-task-progress')?.dataset.phase, at: performance.now() });
      return Promise.resolve();
    };
    window.progressRecording = true;
    const record = () => {
      const root = document.querySelector('.sb-task-progress');
      if (root) {
        const transform = new DOMMatrix(getComputedStyle(root).transform);
        window.progressFrames.push({ phase: root.dataset.phase, y: transform.m42, at: performance.now(),
          width: root.querySelector('.task-progress-fill').getBoundingClientRect().width,
          full: root.getBoundingClientRect().width, dust: root.querySelector('.task-progress-dust').children.length });
      }
      if (window.progressRecording && window.progressFrames.length < 2400) requestAnimationFrame(record);
    };
    requestAnimationFrame(record);
  });
  await page.locator('.composer > .composer-input').fill('完成最后一项，然后总结。');
  await page.locator('.composer > .composer-input').press('Enter');
  await page.waitForFunction(() => document.querySelector('[role=progressbar]')?.getAttribute('aria-valuenow') === '1'
    && document.querySelector('[role=progressbar]')?.getAttribute('aria-valuemax') === '1');
  await board.locator('.sb-task-history').getByRole('button', { name: /已完成任务.*1 项/ }).waitFor();
  assert.equal(await progress.getAttribute('data-phase'), 'running', 'Task completion must wait for round completion');
  assert.equal(await page.evaluate(() => window.progressAudio.length), 0);
  await page.screenshot({ path: 'test-results/task-progress-electron-full-waiting.png' });
  await page.waitForFunction(() => window.progressFrames.some(frame => frame.phase === 'settling'));
  await progress.waitFor();
  await page.waitForFunction(() => document.querySelector('.sb-task-progress')?.dataset.phase === 'complete');
  await page.waitForTimeout(700);
  await page.evaluate(() => { window.progressRecording = false; });
  const evidence = await page.evaluate(() => ({ frames: window.progressFrames, audio: window.progressAudio }));
  assert.equal(evidence.audio.length, 1, 'Real completion event plays one sound');
  assert.equal(evidence.audio[0].phase, 'settling');
  assert.ok(evidence.frames.some(frame => Math.abs(frame.y) > 1.5));
  assert.ok(evidence.frames.some(frame => frame.dust > 0));
  assert.ok(evidence.frames.some(frame => frame.phase === 'running' && Math.abs(frame.full - frame.width) < 1));
  assert.equal(await board.locator('.task-progress-dust i').count(), 0);
  await page.screenshot({ path: 'test-results/task-progress-electron-complete.png' });
  await board.getByRole('button', { name: '关闭侧栏', exact: true }).click();
  await board.waitFor({ state: 'hidden' });
  await page.locator('.right-tool-rail').getByRole('button', { name: '摘要', exact: true }).click();
  await progress.waitFor();
  await page.waitForFunction(() => document.querySelector('.sb-task-progress')?.dataset.phase === 'complete');
  assert.equal(await page.evaluate(() => window.progressAudio.length), 1);
  assert.equal(await progress.evaluate(element => element.getAnimations().length), 0);
  await page.locator('.composer > .composer-input').fill('下一轮只回复确认即可。');
  await page.locator('.composer > .composer-input').press('Enter');
  const history = board.locator('.sb-task-history');
  const trigger = history.getByRole('button', { name: /已完成计划.*2 项/ });
  await trigger.waitFor();
  assert.equal(await progress.count(), 0, 'Next turn retires all previous completed tasks');
  assert.equal(await trigger.getAttribute('aria-expanded'), 'false');
  await trigger.click();
  await history.getByRole('button', { name: /验证并归档/ }).waitFor();
  await page.waitForFunction(() => document.querySelector('.conversation')?.getAttribute('aria-busy') === 'false');
  await page.screenshot({ path: 'test-results/task-history-electron.png' });
  await page.reload();
  await page.waitForFunction(() => document.querySelector('.conversation')?.getAttribute('aria-busy') === 'false');
  if (!await board.isVisible()) await page.locator('.right-tool-rail').getByRole('button', { name: '摘要', exact: true }).click();
  await trigger.waitFor();
  assert.equal(await trigger.getAttribute('aria-expanded'), 'false');
  assert.equal(await progress.count(), 0, 'Reload reconstructs history from persisted runtime/message records');
  assert.deepEqual(errors, []);
  console.log('Real Electron task progress verified: runtime tasks, round event, sound/impact/sweep, next-turn retirement, history and renderer reload.');
} finally {
  if (app) await closeDesktopFixture(app);
  await new Promise(resolve => server.close(resolve));
}
