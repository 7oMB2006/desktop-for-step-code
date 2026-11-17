import { _electron as electron } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { mkdtemp } from './test-profile.mjs';
import { closeDesktopFixtureAndWait, releaseExitedFixturePipes } from './close-desktop-fixture.mjs';
import { waitForSessionFixtureSnapshot } from './session-fixture.mjs';

const output = resolve(process.env.DESKTOP_PREVIEW_OUTPUT ?? 'test-results/tool-status-preview');
await mkdir(output, { recursive: true });
const profile = await mkdtemp(join(output, 'profile-'));
const project = join(profile, 'project'), root = join(profile, 'step-runtime');
await mkdir(project);
await mkdir(join(root, 'sessions'), { recursive: true });
const timestamp = '2026-11-16T00:00:00.000Z';
const history = [
  { type: 'session', version: 3, id: 'tool-status-preview', cwd: project, timestamp },
  { type: 'message', id: 'question', parentId: null, timestamp, message: { role: 'user',
    content: [{ type: 'text', text: '整理一下这周的插件联调记录和下一步要核对的事项。' }], timestamp: 1 } },
  { type: 'message', id: 'answer', parentId: 'question', timestamp, message: { role: 'assistant',
    content: [{ type: 'text', text: '## 本周联调记录\n\n先把插件资源、独立运行时和账户授权分开核对。资源版本一致，不代表外部运行时也已同步更新。\n\n| 核对项 | 记录 |\n| --- | --- |\n| 插件资源 | 已记录安装来源与版本 |\n| 独立运行时 | 待检查协议和依赖 |\n| 模型账户 | 尚未进行真实调用 |\n\n### 下一步\n\n1. 检查本体路径指向的实际版本。\n2. 对照宿主协议确认适配范围。\n3. 在隔离环境完成连接验证，再安排真实账户验收。\n\n当前记录只覆盖本地联调，不代表已发布或已完成真实调用。' }],
    provider: 'fixture', model: 'fixture', api: 'openai-completions', stopReason: 'stop', timestamp: 2,
    usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } } },
  { type: 'session_info', id: 'name', parentId: 'answer', timestamp, name: '工具状态 · 隔离预览' },
];
await writeFile(join(root, 'sessions', 'preview.jsonl'), history.map(value => JSON.stringify(value)).join('\n') + '\n');
await writeFile(join(profile, 'preferences.json'), JSON.stringify({
  language: 'zh', theme: 'dark', workspaces: [project], workspace: project, closeToTray: false,
}));
await writeFile(join(root, 'config.toml'), [
  'defaultProvider = "fixture"', 'defaultModel = "fixture"', '[telemetry]', 'enabled = false',
  '[mcp_servers."steppage__steppage"]', 'enabled = false',
  '[mcp_servers."preview__bvr"]', 'enabled = true',
  `command = ${JSON.stringify(join(profile, 'missing-preview-mcp.exe'))}`,
].join('\n') + '\n');
const revealToken = randomUUID();
let app;
const reveal = () => app.evaluate(({ BrowserWindow }) => {
  const window = BrowserWindow.getAllWindows()[0];
  if (window.isMinimized()) window.restore();
  window.setOpacity(1); window.show(); window.moveTop(); window.focus();
  return { pid: process.pid, title: window.getTitle(), visible: window.isVisible(), minimized: window.isMinimized() };
});
const server = createServer(async (request, response) => {
  if (request.url === '/preview/reveal') {
    if (request.method !== 'POST' || request.headers['x-preview-token'] !== revealToken) {
      response.writeHead(403); response.end(); return;
    }
    try {
      const result = await reveal();
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify(result));
    } catch {
      response.writeHead(503); response.end();
    }
    return;
  }
  for await (const _ of request) { /* Drain only the isolated preview request. */ }
  response.writeHead(200, { 'content-type': 'text/event-stream' });
  const chunk = (delta, finish_reason = null) => `data: ${JSON.stringify({
    id: 'preview', object: 'chat.completion.chunk', model: 'fixture', created: 1,
    choices: [{ index: 0, delta, finish_reason }],
  })}\n\n`;
  response.end(chunk({ role: 'assistant', content: '这是本地隔离预览回复，没有调用真实模型。' })
    + chunk({}, 'stop') + 'data: [DONE]\n\n');
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
await writeFile(join(root, 'models.json'), JSON.stringify({ providers: { fixture: {
  baseUrl: `http://127.0.0.1:${server.address().port}/v1`, api: 'openai-completions', apiKey: 'preview-not-a-real-key',
  models: [{ id: 'fixture', name: '本地预览模型', contextWindow: 128000, maxTokens: 1024 }],
} } }));
try {
  const env = { ...process.env, DESKTOP_TEST_USER_DATA: profile, DESKTOP_TEST_NO_FOCUS: '1' };
  delete env.ELECTRON_RUN_AS_NODE;
  app = await electron.launch({ args: [resolve('.')], env, timeout: 60000 });
  const page = await app.firstWindow();
  await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    window.setOpacity(0); window.setSize(1280, 840);
    window.on('page-title-updated', event => event.preventDefault());
    window.setTitle('DFSC 工具状态预览（隔离）');
    if (process.platform === 'win32') window.setAppDetails({ appId: 'community.stepcode.desktop.tool-status-preview' });
  });
  await page.locator('[data-reorder-id="tool-status-preview"] > button').first().click({ timeout: 60000 });
  await waitForSessionFixtureSnapshot(page, value =>
    value.state?.desktopStartup?.tools.some(tool => tool.name === 'preview__bvr' && tool.status === 'failed'),
  'isolated failed tool preview');
  const toast = page.locator('.notice-toast');
  if (await toast.isVisible()) await toast.getByRole('button').last().click();
  await page.getByRole('textbox', { name: '消息', exact: true }).fill('继续核对独立运行时的版本和适配范围。');
  await page.locator('.sidebar-plugins-dot').waitFor();
  await page.screenshot({ path: join(output, 'conversation.png') });
  await page.locator('.sidebar-plugins-entry').screenshot({ path: join(output, 'plugin-entry.png') });
  await page.locator('.sidebar-plugins-entry').click();
  await page.locator('.runtime-startup-status').waitFor({ state: 'visible' });
  await page.locator('.pc-plugin-grid').waitFor({ state: 'visible' });
  await page.screenshot({ path: join(output, 'plugin-collapsed.png') });
  await page.locator('.runtime-startup-status summary').click();
  await page.locator('.runtime-startup-status ul').waitFor({ state: 'visible' });
  await page.waitForFunction(() => !document.querySelector('.runtime-startup-status .cap-disclosure-body')?.getAnimations().length);
  await page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))));
  await page.screenshot({ path: join(output, 'plugin-center.png') });
  await page.locator('.runtime-startup-status summary').click();
  await page.locator('.runtime-startup-status ul').waitFor({ state: 'hidden' });
  const window = await reveal();
  await writeFile(join(output, 'preview-control.json'), JSON.stringify({
    project: resolve('.'), port: server.address().port, token: revealToken, ...window,
  }));
  console.log(JSON.stringify({ ready: true, pid: window.pid, profile, output, title: window.title }));
  releaseExitedFixturePipes(app);
  await new Promise(done => app.once('close', done));
} finally {
  if (app?.process().exitCode === null) await closeDesktopFixtureAndWait(app);
  server.closeAllConnections();
  await new Promise(done => server.close(done));
}
