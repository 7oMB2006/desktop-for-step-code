import { settleLayout } from './settle-layout.mjs';
import { _electron as electron } from 'playwright';
import { prepareSessionFixture } from './session-fixture.mjs';
import assert from 'node:assert/strict';
import { mkdir, writeFile, mkdtemp, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const profile = await realpath(await mkdtemp(join(tmpdir(), 'step-artifact-preview-')));
await writeFile(join(profile, 'preferences.json'), JSON.stringify({ language: 'zh', theme: 'light', workspaces: [] }));
await mkdir('test-results', { recursive: true });
const env = { ...process.env, DESKTOP_TEST_USER_DATA: profile, DESKTOP_TEST_NO_FOCUS: '1' };
delete env.ELECTRON_RUN_AS_NODE;
const executablePath = process.env.DESKTOP_VERIFY_EXE;
let phase = 'Electron launch';
let closing = false;
const mark = value => { phase = value; console.log(`Artifact acceptance: ${phase}`); };
process.on('exit', code => {
  if (code !== 0) console.error(`Artifact acceptance exited (${code}) during ${phase}`);
});
const app = await electron.launch({ ...(executablePath ? { executablePath } : { args: [resolve('.')] }), env, timeout: 60000 });
app.process().on('exit', (code, signal) => {
  if (!closing) console.error(`Unexpected Electron exit during ${phase}: code=${code}, signal=${signal}`);
});
try {
  mark('first window');
  const page = await app.firstWindow();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await app.evaluate(({ BrowserWindow, dialog }) => {
    const window = BrowserWindow.getAllWindows()[0];
    window.setOpacity(0); window.setIgnoreMouseEvents(true); window.showInactive(); window.setSize(1322, 880);
    dialog.showMessageBox = async () => ({ response: 1 });
  });
  mark('runtime ready');
  await page.getByText('Step Code 已连接', { exact: true }).waitFor({ timeout: 60000 });
  const snapshot = await prepareSessionFixture(page);
  mark('file boundary');
  const runtimeId = snapshot.runtimeId;
  const cwd = snapshot.runtimes.find(item => item.runtimeId === runtimeId).cwd;
  await writeFile(join(cwd, 'index.html'), '<!doctype html><title>海岸骑行</title><h1>海岸骑行</h1>');
  await writeFile(join(cwd, '交付说明.md'), '# 交付说明\n动画支持暂停和速度调节。');
  const file = await page.evaluate(({ runtimeId }) => window.desktop.artifactFiles(runtimeId, ['./index.html', './missing.pdf']), { runtimeId });
  assert.equal(file[0].canOpen, true); assert.equal(file[1].exists, false);
  const bashPath = join(cwd, 'index.html').replaceAll('\\', '/').replace(/^([a-z]):\//i, '/$1/');
  const bashFiles = await page.evaluate(({ runtimeId, bashPath }) => window.desktop.artifactFiles(runtimeId, [bashPath]), { runtimeId, bashPath });
  assert.equal(bashFiles[0].canOpen, true, 'Git Bash output paths must resolve through the real main-process boundary');
  assert.equal(bashFiles[0].path, file[0].path);
  await assert.rejects(page.evaluate(({ runtimeId }) => window.desktop.artifactAction(runtimeId, '../outside.html', 'open'), { runtimeId }));
  await page.evaluate(({ runtimeId }) => window.desktop.artifactAction(runtimeId, './index.html', 'copy'), { runtimeId });
  assert.equal(await app.evaluate(({ clipboard }) => clipboard.readText()), file[0].path);
  mark('install presentation fixture');
  const messages = [
    { role: 'user', timestamp: Date.now() - 10000, content: '做一个海岸骑行小动画，附上交付说明。' },
    { role: 'assistant', timestamp: Date.now() - 5000, content: [{ type: 'toolCall', id: 'artifact-edit', name: 'write', arguments: { path: 'index.html' } }] },
    { role: 'toolResult', timestamp: Date.now() - 3000, toolCallId: 'artifact-edit', toolName: 'write', content: '已创建动画', details: { patch: '--- a/index.html\n+++ b/index.html\n@@ -0,0 +1,3 @@\n+<!doctype html>\n+<title>海岸骑行</title>\n+<h1>海岸骑行</h1>\n' } },
    { role: 'assistant', timestamp: Date.now(), content: '海岸骑行动画已完成，支持暂停、继续和速度调节。\n\n[打开「海岸骑行」动画](./index.html)\n\n使用说明和验收记录也放在这里：[交付说明](./交付说明.md)。\n\n动画采用单文件 HTML，浏览器即可打开；交付说明可以继续编辑。' },
  ];
  await app.evaluate(({ ipcMain }, { snapshot, messages }) => {
    globalThis.artifactFixture = { ...snapshot, messages };
    ipcMain.removeHandler('desktop');
    ipcMain.handle('desktop', (_event, method, ...args) => {
      if (method === 'snapshot') return globalThis.artifactFixture;
      if (method === 'sessions') return globalThis.artifactFixture.sessions;
      if (method === 'browserList') return globalThis.artifactBrowser ?? { tabs: [] };
      if (method === 'browserOpenLink') { globalThis.lastPreviewUrl = args[0]; globalThis.artifactBrowser = { tabs: [{ id: 'preview', url: args[0], title: 'Local preview', zoom: 1, loading: false }], activeId: 'preview' }; return globalThis.artifactBrowser; }
      if (method === 'copyText') { globalThis.lastPreviewCopy = args[0]; return; }
      if (method === 'artifactFiles') { (globalThis.artifactFileRequests ??= []).push(args[1]); return args[1].map(path => ({ path, exists: !path.includes('missing'), canOpen: !path.includes('missing'), kind: path.endsWith('.html') ? 'website' : 'document', size: 1024 })); }
      if (method === 'artifactAction') { globalThis.lastArtifactAction = args; return; }
      if (method === 'fileOpen') {
        globalThis.lastArtifactAction = [args[0].runtimeId, args[0].path, 'open'];
        return { destination: 'external' };
      }
      if (method === 'fileOpenOptions') return { choices: [{ id: 'internal', label: args[0].path.endsWith('.html') ? '内置浏览器' : '文件预览' }], selected: 'internal' };
      if (method === 'turnUndo') return { state: 'unavailable' };
      if (method === 'command' && args[0] === 'get_available_thinking_levels') return { levels: ['off', 'low', 'medium', 'high'] };
      if (method === 'command' && args[0] === 'get_commands') return { commands: [] };
      return {};
    });
  }, { snapshot, messages });
  await page.reload();
  mark('artifact cards ready');
  await page.locator('.artifact-main').first().waitFor();
  await page.waitForFunction(() => !document.querySelector('.artifact-main').disabled);
  assert.equal(await page.locator('.artifact-row').count(), 2);
  mark('theme-aware output colors');
  const outputArrow = page.locator('.artifact-main > svg:last-child').first();
  const tokenColor = name => page.evaluate(name => {
    const probe = document.createElement('span');
    probe.style.color = `var(${name})`;
    document.body.append(probe);
    const color = getComputedStyle(probe).color;
    probe.remove();
    return color;
  }, name);
  await page.mouse.move(0, 0);
  assert.equal(await outputArrow.evaluate(element => getComputedStyle(element).color), await tokenColor('--muted'));
  const idleBackground = await page.locator('.artifact-row').first().evaluate(element => getComputedStyle(element).backgroundColor);
  const themeBackground = await page.evaluate(() => {
    const probe = document.createElement('span');
    probe.style.background = 'var(--side)';
    document.body.append(probe);
    const color = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return color;
  });
  assert.equal(idleBackground, themeBackground, 'idle output uses the current theme surface');
  const originalPrimary = await page.evaluate(() => document.documentElement.style.getPropertyValue('--theme-light-primary'));
  await page.evaluate(() => document.documentElement.style.setProperty('--theme-light-primary', '#16734b'));
  await settleLayout(page.locator('.turn-artifacts'));
  assert.equal(await page.locator('.artifact-row').first().evaluate(element => getComputedStyle(element).backgroundColor), idleBackground, 'idle output background is independent of accent color');
  await page.locator('.artifact-main').first().hover();
  await settleLayout(page.locator('.turn-artifacts'));
  assert.equal(await outputArrow.evaluate(element => getComputedStyle(element).color), await tokenColor('--primary'));
  await page.mouse.move(0, 0);
  await page.locator('.artifact-main').first().focus();
  await settleLayout(page.locator('.turn-artifacts'));
  assert.equal(await outputArrow.evaluate(element => getComputedStyle(element).color), await tokenColor('--primary'), 'keyboard focus uses the same accent as hover');
  await page.locator('.artifact-main').first().evaluate(element => element.blur());
  await page.evaluate(value => {
    if (value) document.documentElement.style.setProperty('--theme-light-primary', value);
    else document.documentElement.style.removeProperty('--theme-light-primary');
  }, originalPrimary);
  await settleLayout(page.locator('.turn-artifacts'));
  const artifacts = await page.locator('.turn-artifacts').boundingBox();
  const diff = await page.locator('.turn-changes').boundingBox();
  assert.ok(artifacts.y + artifacts.height <= diff.y);
  mark('open and copy actions');
  await page.getByRole('link', { name: '打开「海岸骑行」动画' }).click();
  assert.equal((await app.evaluate(() => globalThis.lastArtifactAction))[2], 'open');
  await page.screenshot({ path: 'test-results/turn-artifacts-light.png' });
  await page.locator('.artifact-details-trigger').first().click();
  await settleLayout(page.locator('.turn-artifacts'));
  await page.screenshot({ path: 'test-results/turn-artifacts-options-light.png' });
  await page.getByRole('button', { name: '复制路径', exact: true }).click();
  assert.equal((await app.evaluate(() => globalThis.lastArtifactAction))[2], 'copy');
  await page.getByRole('button', { name: '收起产物详情', exact: true }).click();
  await page.waitForTimeout(240);
  assert.equal(await page.locator('.artifact-detail-shell').count(), 0);
  mark('themes and narrow layout');
  await page.evaluate(() => document.documentElement.dataset.theme = 'dark');
  await page.screenshot({ path: 'test-results/turn-artifacts-dark.png' });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(640, 800));
  await settleLayout(page.locator('.turn-artifacts'));
  const box = await page.locator('.artifact-row').first().boundingBox();
  assert.ok(box.x >= 0 && box.x + box.width <= 640);
  await page.screenshot({ path: 'test-results/turn-artifacts-narrow.png' });
  mark('many outputs and long names');
  await app.evaluate(({ BrowserWindow }) => {
    const fixture = globalThis.artifactFixture;
    fixture.messages[fixture.messages.length - 1].content += '\n\n[这是一个用于检验很长产物名称不会把操作按钮挤出去的文件引用](./long-name.pdf)\n\n[附录一](./appendix.pdf)\n\n[数据表](./data.csv)';
    BrowserWindow.getAllWindows()[0].webContents.send('runtime-event', { type: 'desktop_history', runtimeId: fixture.runtimeId, messages: fixture.messages });
  });
  await page.reload();
  await page.getByRole('button', { name: '另 2 项', exact: true }).waitFor();
  assert.equal(await page.locator('.artifact-row').count(), 3);
  await page.getByRole('button', { name: '另 2 项', exact: true }).click();
  assert.equal(await page.locator('.artifact-row').count(), 5);
  for (const entry of await page.locator('.artifact-row').all()) {
    const rect = await entry.boundingBox();
    assert.ok(rect.x >= 0 && rect.x + rect.width <= 640, 'long/many outputs fit the viewport');
  }
  await page.locator('.artifact-details-trigger').first().click();
  await page.waitForTimeout(220);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(240);
  assert.equal(await page.locator('.artifact-detail-shell').count(), 0);
  mark('code filenames and write-only outputs');
  await app.evaluate(({ BrowserWindow }) => {
    const fixture = globalThis.artifactFixture;
    fixture.messages.at(-1).content = '动画已经完成。\n\n| 文件 | 说明 |\n| --- | --- |\n| `index.html` | 网页动画 |\n| `交付说明.md` | 使用说明 |\n\n`missing.pdf` 尚未生成。';
    BrowserWindow.getAllWindows()[0].webContents.send('runtime-event', { type: 'desktop_history', runtimeId: fixture.runtimeId, messages: fixture.messages });
    BrowserWindow.getAllWindows()[0].setSize(1322, 880);
  });
  await page.reload();
  await page.waitForFunction(() => document.querySelectorAll('.artifact-row').length === 2);
  assert.equal(await page.locator('.artifact-main').filter({ hasText: 'missing.pdf' }).count(), 0, 'unverified filenames do not become outputs');
  await page.screenshot({ path: 'test-results/turn-artifacts-code-filenames.png' });
  await app.evaluate(({ BrowserWindow }) => {
    const fixture = globalThis.artifactFixture;
    fixture.messages.at(-1).content = '动画已经完成。';
    BrowserWindow.getAllWindows()[0].webContents.send('runtime-event', { type: 'desktop_history', runtimeId: fixture.runtimeId, messages: fixture.messages });
  });
  await page.waitForFunction(() => document.querySelectorAll('.artifact-row').length === 1);
  assert.match(await page.locator('.artifact-main').textContent(), /index.html/, 'successful write is available without a final Markdown link');
  await page.locator('.artifact-main').click();
  assert.equal((await app.evaluate(() => globalThis.lastArtifactAction))[1], 'index.html');
  mark('local server delivery from a historical code-block URL');
  await app.evaluate(({ BrowserWindow }) => {
    const fixture = globalThis.artifactFixture;
    globalThis.artifactFileRequests = [];
    fixture.messages = [fixture.messages[0], { role: 'assistant', content: '服务已经启动。\n\n```text\nhttp://localhost:8765/\n```' }];
    BrowserWindow.getAllWindows()[0].webContents.send('runtime-event', { type: 'desktop_history', runtimeId: fixture.runtimeId, messages: fixture.messages });
  });
  await page.waitForFunction(() => document.querySelectorAll('.artifact-row').length === 1 && document.querySelector('.artifact-main')?.textContent.includes('localhost:8765'));
  assert.equal(await page.locator('.artifact-main').isEnabled(), true);
  assert.deepEqual(await app.evaluate(() => globalThis.artifactFileRequests), [], 'local preview URLs never enter the filesystem API');
  await page.locator('.artifact-main').click();
  await page.waitForFunction(() => document.querySelector('#browser-panel')?.getAttribute('aria-hidden') === 'false');
  assert.equal(await app.evaluate(() => globalThis.lastPreviewUrl), 'http://localhost:8765/');
  await page.locator('.artifact-details-trigger').click();
  await page.getByRole('button', { name: '复制链接', exact: true }).click();
  assert.equal(await app.evaluate(() => globalThis.lastPreviewCopy), 'http://localhost:8765/');
  assert.equal(await page.getByRole('button', { name: '显示位置', exact: true }).count(), 0);
  await page.screenshot({ path: 'test-results/turn-artifacts-local-server.png' });
  mark('platform-aware case-distinct delivery cards');
  await app.evaluate(({ BrowserWindow }) => {
    const fixture = globalThis.artifactFixture;
    fixture.messages = [fixture.messages[0], { role: 'assistant', content: '[Upper](Report.pdf) [Lower](report.pdf)' }];
    BrowserWindow.getAllWindows()[0].webContents.send('runtime-event', { type: 'desktop_history', runtimeId: fixture.runtimeId, messages: fixture.messages });
  });
  await page.reload();
  const expectedCards = process.platform === 'win32' ? 1 : 2;
  await page.waitForFunction(expected => document.querySelectorAll('.artifact-row').length === expected &&
    [...document.querySelectorAll('.artifact-main')].every(button => !button.disabled), expectedCards);
  await page.locator('.artifact-main').filter({ hasText: 'Upper' }).click();
  assert.equal((await app.evaluate(() => globalThis.lastArtifactAction))[1], 'Report.pdf');
  if (process.platform !== 'win32') {
    await page.locator('.artifact-main').filter({ hasText: 'Lower' }).click();
    assert.equal((await app.evaluate(() => globalThis.lastArtifactAction))[1], 'report.pdf');
  }
  assert.deepEqual(errors, []);
  mark('complete');
  console.log('Artifact references, cards, file boundary and actions passed');
} finally { closing = true; await app.close(); }
