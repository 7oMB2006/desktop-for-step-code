import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile, mkdtemp } from 'node:fs/promises';
import { createServer } from 'node:http';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { prepareSessionFixture } from './session-fixture.mjs';

const profile = await mkdtemp(join(tmpdir(), 'step-file-preview-'));
const chosen = join(profile, 'picked.txt');
await writeFile(chosen, 'Explicitly selected outside the workspace.');
await writeFile(join(profile, 'preferences.json'), JSON.stringify({ language: 'zh', theme: 'light', workspaces: [], fileOpeningApps: { '.md': 'app:missing-application' } }));
await mkdir('test-results', { recursive: true });
const server = createServer((_request, response) => response.end('<title>Web reference</title><h1>Web reference</h1>'));
await new Promise(done => server.listen(0, '127.0.0.1', done));
const address = `http://127.0.0.1:${server.address().port}/`;
const env = { ...process.env, DESKTOP_TEST_USER_DATA: profile, DESKTOP_TEST_NO_FOCUS: '1' };
delete env.ELECTRON_RUN_AS_NODE;
const executablePath = process.env.DESKTOP_VERIFY_EXE;
const launch = () => electron.launch({ ...(executablePath ? { executablePath } : { args: [resolve('.')] }), env, timeout: 60000 });
async function waitBrowser(page, predicate) {
  const deadline = Date.now() + 30000;
  let snapshot;
  do {
    snapshot = await page.evaluate(() => window.desktop.browserList());
    if (predicate(snapshot)) return snapshot;
    await page.waitForTimeout(100);
  } while (Date.now() < deadline);
  assert.fail(`Browser state did not settle: ${JSON.stringify(snapshot)}`);
}
let app = await launch();
try {
  const page = await app.firstWindow();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    window.setOpacity(0); window.setIgnoreMouseEvents(true); window.showInactive(); window.setSize(1680, 880);
  });
  await page.getByText('Step Code 已连接', { exact: true }).waitFor({ timeout: 60000 });
  const snapshot = await prepareSessionFixture(page);
  const runtimeId = snapshot.runtimeId;
  const cwd = snapshot.runtimes.find(item => item.runtimeId === runtimeId).cwd;
  await writeFile(join(cwd, 'README.md'), '# 海岸骑行\n\n这是本轮生成的小动画。\n\n## 交付\n\n- 单文件 HTML\n- 支持暂停与继续\n\n```js\nconst speed = 2;\n```\n\n| 文件 | 状态 |\n| --- | --- |\n| index.html | 已完成 |\n');
  await writeFile(join(cwd, 'index.html'), `<!doctype html><meta charset="utf-8"><title>海岸骑行</title>
<style>body{margin:0;background:#ebf6f4;font:20px sans-serif}h1{padding:16px}canvas{width:100%;height:240px}</style>
<h1>海岸骑行</h1><canvas width="400" height="240"></canvas><button onclick="window.paused=!window.paused">暂停 / 继续</button>
<script>let tick=0;window.paused=false;const c=document.querySelector('canvas'),x=c.getContext('2d');
function draw(){if(!window.paused)tick++;x.fillStyle='#85d4be';x.fillRect(0,0,400,240);x.fillStyle='#2646a6';x.fillRect(tick%350,100,40,40);window.tick=tick;requestAnimationFrame(draw)}draw();</script>`);
  const target = { runtimeId, path: './README.md' };
  const preview = await page.evaluate(target => window.desktop.fileOpen(target), target);
  assert.equal(preview.destination, 'preview');
  assert.match(preview.file.text, /海岸骑行/);
  await assert.rejects(page.evaluate(({ runtimeId, chosen }) => window.desktop.fileOpen({ runtimeId, path: chosen }), { runtimeId, chosen }));
  const messages = [
    { role: 'user', timestamp: Date.now() - 10000, content: '做一个海岸骑行小动画，并写一份交付说明。' },
    { role: 'assistant', timestamp: Date.now(), content: `动画和说明都已经准备好了。\n\n[海岸骑行动画](./index.html)\n\n[交付说明](./README.md)\n\n[网页参考](${address})` },
  ];
  await app.evaluate(({ ipcMain }, { snapshot, messages }) => {
    const original = ipcMain._invokeHandlers.get('desktop');
    globalThis.fileFixture = { ...snapshot, messages };
    ipcMain.removeHandler('desktop');
    ipcMain.handle('desktop', async (event, method, ...args) => {
      if (method === 'snapshot') return { ...globalThis.fileFixture, preferences: (await original(event, method, ...args)).preferences };
      if (method === 'sessions') return globalThis.fileFixture.sessions;
      return original(event, method, ...args);
    });
  }, { snapshot, messages });
  await page.reload();
  await page.getByRole('button', { name: '文件预览', exact: true }).click();
  await page.locator('#file-panel').getByRole('button', { name: '打开文件', exact: true }).last().waitFor();
  await page.screenshot({ path: 'test-results/file-preview-empty.png' });
  await page.getByRole('link', { name: '交付说明', exact: true }).click();
  await page.locator('.file-preview-markdown h1').waitFor();
  assert.equal(await page.locator('.file-preview-markdown h1').textContent(), '海岸骑行');
  const handle = page.getByRole('button', { name: '调整右栏宽度', exact: true });
  await handle.waitFor();
  assert.equal(await handle.getAttribute('data-tooltip'), null);
  const dragHandle = async delta => {
    const rect = await handle.boundingBox();
    await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2);
    await page.mouse.down();
    await page.mouse.move(rect.x + rect.width / 2 + delta, rect.y + rect.height / 2, { steps: 12 });
    const during = await page.locator('#file-panel').boundingBox();
    await page.mouse.up();
    await page.waitForTimeout(350);
    return during;
  };
  const initialWidth = (await page.locator('#file-panel').boundingBox()).width;
  const during = await dragHandle(-800);
  assert.ok(during.width > initialWidth + 500, 'drag follows the pointer across multiple sizes');
  assert.equal(await page.locator('#file-panel').evaluate(element => element.classList.contains('is-expanded')), true, 'one drag can reach fullscreen');
  await page.screenshot({ path: 'test-results/panel-handle-fullscreen.png' });
  await dragHandle(800);
  assert.equal(await page.locator('#file-panel').evaluate(element => element.classList.contains('is-expanded')), false);
  await handle.click();
  const handleMenu = page.getByRole('menu', { name: '右栏宽度', exact: true });
  await handleMenu.getByRole('menuitemradio', { name: '宽幅', exact: true }).click();
  await page.waitForTimeout(350);
  assert.equal(await page.locator('.file-preview-track').evaluate(element => element.classList.contains('is-wide')), true);
  await handle.click();
  await handleMenu.getByRole('menuitemradio', { name: '标准', exact: true }).click();
  await page.waitForTimeout(350);
  await handle.focus();
  await page.keyboard.press('ArrowLeft');
  await page.waitForTimeout(350);
  assert.equal(await page.locator('.file-preview-track').evaluate(element => element.classList.contains('is-wide')), true);
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(350);
  await page.screenshot({ path: 'test-results/panel-handle-standard.png' });
  await page.getByRole('link', { name: '交付说明', exact: true }).click();
  await page.waitForTimeout(350);
  assert.equal(await page.locator('#file-panel').isVisible(), false, 'the same artifact toggles the panel closed');
  await page.getByRole('link', { name: '交付说明', exact: true }).click();
  await page.locator('.file-preview-markdown h1').waitFor();
  await dragHandle(180);
  assert.equal(await page.locator('#file-panel').isVisible(), false, 'a deliberate drag past standard closes the panel');
  await page.getByRole('link', { name: '交付说明', exact: true }).click();
  await page.locator('.file-preview-markdown h1').waitFor();
  assert.equal(await page.locator('.file-preview-source').count(), 0);
  assert.match(await page.locator('#file-panel').evaluate(element => getComputedStyle(element).transitionTimingFunction), /cubic-bezier\(0.22, 1, 0.36, 1\)/);
  const widthTrigger = page.getByRole('button', { name: '文件预览宽度', exact: true });
  const standardBox = await page.locator('#file-panel').boundingBox();
  await widthTrigger.click();
  const widthMenu = page.getByRole('menu', { name: '文件预览宽度', exact: true });
  await widthMenu.getByRole('menuitemradio', { name: '宽幅', exact: true }).click();
  await page.waitForTimeout(350);
  assert.ok((await page.locator('#file-panel').boundingBox()).width > standardBox.width + 50);
  await page.screenshot({ path: 'test-results/file-preview-wide.png' });
  await widthTrigger.click();
  await widthMenu.getByRole('menuitemradio', { name: '标准', exact: true }).click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'test-results/file-preview-markdown-light.png' });
  await page.getByRole('button', { name: '查看源码', exact: true }).click();
  assert.match(await page.locator('.file-preview-source').textContent(), /# 海岸骑行/);
  await page.getByRole('button', { name: '自动换行', exact: true }).click();
  assert.equal(await page.locator('.file-preview-source.is-wrapped').count(), 1);
  await page.getByRole('button', { name: '复制文件内容', exact: true }).click();
  assert.equal(await app.evaluate(({ clipboard }) => clipboard.readText()), preview.file.text);
  await writeFile(join(cwd, 'README.md'), '# 更新后的交付说明\n\n刷新成功。');
  await page.getByRole('button', { name: '刷新文件', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.file-preview-source')?.textContent.includes('刷新成功'));
  await page.getByRole('button', { name: '排版预览', exact: true }).click();
  await widthTrigger.click();
  await widthMenu.getByRole('menuitemradio', { name: '全屏', exact: true }).click();
  await page.waitForTimeout(350);
  const box = await page.locator('#file-panel').boundingBox();
  assert.ok(box.width > 900, 'file preview uses the existing right-panel fullscreen');
  await page.screenshot({ path: 'test-results/file-preview-fullscreen.png' });
  await page.getByRole('button', { name: '关闭文件预览', exact: true }).click();
  await page.waitForTimeout(300);
  assert.equal(await page.locator('#file-panel').isVisible(), false);
  await page.getByRole('link', { name: '交付说明', exact: true }).click();
  await app.evaluate(async ({ shell, Menu }) => {
    globalThis.originalShellOpen = shell.openPath;
    shell.openPath = async path => { globalThis.fileOpenCount = (globalThis.fileOpenCount ?? 0) + 1; globalThis.openedFile = path; return ''; };
    globalThis.originalNativeMenu = Menu.buildFromTemplate;
    Menu.buildFromTemplate = (...args) => { globalThis.nativeFileMenuCalls = (globalThis.nativeFileMenuCalls ?? 0) + 1; return globalThis.originalNativeMenu(...args); };
    const childProcess = process.getBuiltinModule('child_process');
    const { EventEmitter } = process.getBuiltinModule('events');
    const { PassThrough } = process.getBuiltinModule('stream');
    globalThis.originalFileSpawn = childProcess.spawn;
    childProcess.spawn = (...args) => {
      if (!args[1]?.some(value => typeof value === 'string' && value.endsWith('file-associations.ps1'))) return globalThis.originalFileSpawn(...args);
      const child = new EventEmitter();
      child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.kill = () => true;
      let request = '';
      child.stdin.on('data', chunk => request += chunk);
      child.stdin.on('finish', () => {
        const payload = JSON.parse(request);
        if (payload.action === 'list') {
          child.stdout.end('[]');
          child.emit('close', 0);
          return;
        }
        globalThis.fileOpenCount = (globalThis.fileOpenCount ?? 0) + 1;
        globalThis.openedFileRequest = payload;
        child.stdout.end('{"ok":true}');
        child.emit('close', 0);
      });
      return child;
    };
  });
  await page.locator('#file-panel').getByRole('button', { name: '选择打开方式', exact: true }).click();
  const openingMenu = page.getByRole('menu', { name: '打开方式', exact: true });
  await openingMenu.getByRole('menuitemradio', { name: '文件预览', exact: true }).waitFor();
  const menuLabels = await openingMenu.getByRole('menuitemradio').allTextContents();
  assert.ok(menuLabels.includes('文件预览'));
  assert.ok(menuLabels.includes('系统默认应用'));
  assert.ok(menuLabels.some(label => label.includes('其他应用')));
  assert.equal(await openingMenu.getByRole('menuitemradio', { name: '文件预览', exact: true }).getAttribute('aria-checked'), 'true', 'an unavailable saved application falls back to internal preview');
  await page.waitForTimeout(220);
  await page.screenshot({ path: 'test-results/file-opening-menu-light.png' });
  const options = await page.evaluate(target => window.desktop.fileOpenOptions(target), target);
  const selection = options.choices.find(item => item.id.startsWith('app:')) ?? options.choices.find(item => item.id === 'system');
  await openingMenu.getByRole('menuitemradio', { name: selection.label, exact: true }).click();
  await page.waitForFunction(label => document.querySelector('#file-panel .file-open-control > button:first-child')?.textContent === label, selection.label);
  assert.equal(await app.evaluate(() => globalThis.fileOpenCount), 1, 'choosing an application opens once');
  if (selection.icon) assert.equal(await page.locator('#file-panel .file-open-control > button:first-child img').count(), 1);
  await page.locator('#file-panel .file-open-control > button:first-child').click();
  await page.waitForFunction(() => !document.querySelector('#file-panel .file-open-control > button:first-child').disabled);
  assert.equal(await app.evaluate(() => globalThis.fileOpenCount), 2, 'the main half reopens the remembered application');
  const persisted = JSON.parse(await readFile(join(profile, 'preferences.json'), 'utf8'));
  assert.equal(persisted.fileOpeningApps['.md'], selection.id);
  await page.reload();
  await page.getByRole('link', { name: '交付说明', exact: true }).click();
  await page.waitForFunction(label => document.querySelector('#file-panel .file-open-control > button:first-child')?.textContent === label, selection.label);
  await page.locator('#file-panel').getByRole('button', { name: '选择打开方式', exact: true }).click();
  await openingMenu.getByRole('menuitemradio', { name: selection.label, exact: true }).waitFor();
  assert.equal(await openingMenu.getByRole('menuitemradio', { name: selection.label, exact: true }).getAttribute('aria-checked'), 'true');
  await page.keyboard.press('ArrowDown');
  assert.equal(await openingMenu.getByRole('menuitemradio').evaluateAll(items => items.includes(document.activeElement)), true);
  await page.keyboard.press('Escape');
  await openingMenu.waitFor({ state: 'hidden' });
  assert.equal(await page.locator('#file-panel .file-open-options').evaluate(element => element === document.activeElement), true);
  assert.equal(await app.evaluate(() => globalThis.nativeFileMenuCalls ?? 0), 0, 'file opening and width menus do not invoke Windows menus');
  await app.evaluate(async ({ Menu, shell }) => {
    Menu.buildFromTemplate = globalThis.originalNativeMenu;
    shell.openPath = globalThis.originalShellOpen;
    process.getBuiltinModule('child_process').spawn = globalThis.originalFileSpawn;
  });
  await page.evaluate(() => document.documentElement.dataset.theme = 'dark');
  await page.locator('#file-panel').getByRole('button', { name: '选择打开方式', exact: true }).click();
  await openingMenu.waitFor();
  await page.waitForTimeout(220);
  await page.screenshot({ path: 'test-results/file-opening-menu-dark.png' });
  await page.keyboard.press('Escape');
  await page.screenshot({ path: 'test-results/file-preview-markdown-dark.png' });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(640, 800));
  await page.waitForTimeout(400);
  const narrow = await page.locator('#file-panel').boundingBox();
  assert.ok(narrow.x >= 0 && narrow.x + narrow.width <= 640);
  await widthTrigger.click();
  await widthMenu.getByRole('menuitemradio', { name: '宽幅', exact: true }).click();
  await page.waitForTimeout(300);
  assert.equal(Math.round((await page.locator('#file-panel').boundingBox()).width), Math.round(narrow.width), 'wide overlays do not overflow small windows');
  await page.locator('#file-panel').getByRole('button', { name: '选择打开方式', exact: true }).click();
  await openingMenu.waitFor();
  await page.waitForTimeout(220);
  const menuBox = await openingMenu.boundingBox();
  assert.ok(menuBox.x >= 0 && menuBox.x + menuBox.width <= 640 && menuBox.y > 46);
  await page.screenshot({ path: 'test-results/file-preview-narrow.png' });
  await page.locator('#file-panel .file-preview-scroll').click({ position: { x: 12, y: 12 } });
  await openingMenu.waitFor({ state: 'hidden' });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await widthTrigger.click();
  await widthMenu.waitFor();
  assert.equal(await widthMenu.evaluate(element => getComputedStyle(element).transitionDuration), '0s');
  await page.waitForFunction(() => document.activeElement?.closest('[role="menu"]')?.getAttribute('aria-label') === '文件预览宽度');
  await page.keyboard.press('Escape');
  await widthMenu.waitFor({ state: 'hidden' });
  assert.equal(await page.locator('#file-panel').getAttribute('aria-hidden'), 'false', 'dismissing the width menu keeps file preview open');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await app.evaluate(({ dialog }, chosen) => {
    globalThis.originalFileDialog = dialog.showOpenDialog;
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [chosen] });
  }, chosen);
  await page.locator('#file-panel .right-panel-header').getByRole('button', { name: '打开文件', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.file-preview-source')?.textContent.includes('Explicitly selected'));
  await app.evaluate(({ dialog }) => { dialog.showOpenDialog = globalThis.originalFileDialog; });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1322, 880));
  await page.evaluate(() => document.documentElement.dataset.theme = 'light');
  await page.getByRole('link', { name: '海岸骑行动画', exact: true }).click();
  const tabs = await waitBrowser(page, snapshot => snapshot.tabs.some(tab => tab.localFile && !tab.loading));
  const local = tabs.tabs.find(tab => tab.localFile);
  assert.ok(local, `local HTML tab is retained: ${JSON.stringify(tabs)}`);
  assert.equal(local.localFile, join(cwd, 'index.html'));
  await page.waitForTimeout(450);
  const localState = await app.evaluate(async ({ BrowserWindow }) => {
    const view = BrowserWindow.getAllWindows()[0].contentView.children.find(view => view.webContents?.getURL().includes('127.0.0.1'));
    const result = await view.webContents.executeJavaScript(`({
      node:typeof require, bridge:typeof window.desktop,
      pixel:[...document.querySelector('canvas').getContext('2d').getImageData(0,0,1,1).data],
      tick:window.tick
    })`);
    globalThis.previewContents = view.webContents;
    return result;
  });
  assert.equal(localState.node, 'undefined');
  assert.equal(localState.bridge, 'undefined');
  assert.ok(localState.pixel[1] > 100);
  await page.waitForTimeout(120);
  const tick = await app.evaluate(() => globalThis.previewContents.executeJavaScript('window.tick'));
  assert.ok(tick > localState.tick, 'the generated HTML animation moves');
  const denied = await app.evaluate(async () => globalThis.previewContents.executeJavaScript(`Promise.all([
    fetch('private.json').then(r=>r.status),
    fetch('https://example.com/').then(()=>false,()=>true)
  ])`));
  assert.deepEqual(denied, [404, true]);
  const shellImage = await page.screenshot({ path: 'test-results/file-preview-html-shell.png' });
  const capture = await app.evaluate(async ({ BrowserWindow }) => {
    const view = BrowserWindow.getAllWindows()[0].contentView.children.find(view => view.webContents === globalThis.previewContents);
    return { image: (await view.webContents.capturePage()).toPNG().toString('base64'), bounds: view.getBounds(), visible: view.getVisible() };
  });
  assert.equal(capture.visible, true);
  await writeFile('test-results/file-preview-html-page.png', Buffer.from(capture.image, 'base64'));
  const composite = await page.evaluate(async ({ shell, capture }) => {
    const load = src => new Promise((done, fail) => { const image = new Image(); image.onload = () => done(image); image.onerror = fail; image.src = src; });
    const base = await load(`data:image/png;base64,${shell}`);
    const web = await load(`data:image/png;base64,${capture.image}`);
    const canvas = document.createElement('canvas');
    canvas.width = base.naturalWidth; canvas.height = base.naturalHeight;
    const context = canvas.getContext('2d'), scale = base.naturalWidth / innerWidth;
    context.drawImage(base, 0, 0);
    const { x, y, width, height } = capture.bounds;
    context.drawImage(web, x * scale, y * scale, width * scale, height * scale);
    return canvas.toDataURL('image/png').split(',')[1];
  }, { shell: shellImage.toString('base64'), capture });
  await writeFile('test-results/file-preview-html-browser.png', Buffer.from(composite, 'base64'));
  await page.getByRole('link', { name: '海岸骑行动画', exact: true }).click();
  assert.equal((await page.evaluate(() => window.desktop.browserList())).tabs.filter(tab => tab.localFile).length, 1);
  await page.waitForTimeout(300);
  assert.equal(await page.locator('#browser-panel').isVisible(), false, 'clicking the current HTML artifact closes its panel');
  await app.evaluate(() => globalThis.previewContents.executeJavaScript('window.previewRetained = 42'));
  await page.getByRole('link', { name: '海岸骑行动画', exact: true }).click();
  await page.waitForTimeout(350);
  assert.equal(await app.evaluate(() => globalThis.previewContents.executeJavaScript('window.previewRetained')), 42, 'reopening local HTML preserves its page state');
  const updatedHtml = (await readFile(join(cwd, 'index.html'), 'utf8')) + '<h2 id="refresh-result">Updated HTML preview</h2><script src="refresh-result.js"></script>';
  await writeFile(join(cwd, 'refresh-result.js'), 'window.refreshedAsset = "Updated local asset";');
  await writeFile(join(cwd, 'index.html'), updatedHtml);
  assert.equal(await app.evaluate(() => globalThis.previewContents.executeJavaScript('document.getElementById("refresh-result")?.textContent ?? null')), null);
  await page.locator('#browser-panel').getByRole('button', { name: '刷新', exact: true }).click();
  await page.waitForFunction(async () => {
    const snapshot = await window.desktop.browserList();
    return snapshot.tabs.some(tab => tab.localFile && !tab.loading);
  });
  await app.evaluate(async () => {
    const contents = globalThis.previewContents;
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      if (await contents.executeJavaScript('window.refreshedAsset === "Updated local asset"')) return;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error('Explicit refresh did not load the updated local asset');
  });
  const refreshed = await app.evaluate(() => globalThis.previewContents.executeJavaScript('({ text: document.getElementById("refresh-result")?.textContent, retained: typeof window.previewRetained })'));
  assert.deepEqual(refreshed, { text: 'Updated HTML preview', retained: 'undefined' }, 'explicit refresh reloads HTML and resets page state');
  assert.equal((await page.evaluate(() => window.desktop.browserList())).tabs.find(tab => tab.localFile)?.id, local.id, 'explicit refresh retains the existing tab');
  await page.getByRole('link', { name: '网页参考', exact: true }).click();
  await waitBrowser(page, snapshot => snapshot.tabs.some(tab => tab.url === address && !tab.loading));
  assert.equal((await page.evaluate(() => window.desktop.browserList())).tabs.length, 2);
  await page.getByRole('link', { name: '网页参考', exact: true }).click();
  await page.waitForTimeout(300);
  assert.equal(await page.locator('#browser-panel').isVisible(), false, 'clicking the current web reference closes its panel');
  await page.getByRole('link', { name: '网页参考', exact: true }).click();
  await page.waitForTimeout(350);
  assert.equal(await page.locator('#browser-panel').isVisible(), true);
  assert.deepEqual(errors, []);
  await app.close();
  app = await launch();
  const reopened = await app.firstWindow();
  await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    window.setOpacity(0); window.setIgnoreMouseEvents(true); window.showInactive();
  });
  await reopened.getByText('Step Code 已连接', { exact: true }).waitFor({ timeout: 60000 });
  assert.equal((await reopened.evaluate(() => window.desktop.snapshot())).preferences.filePreviewWidth, 'wide');
  await app.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }); }, join(cwd, 'README.md'));
  const reopenedFile = await reopened.evaluate(() => window.desktop.fileOpen());
  const reopenedOptions = await reopened.evaluate(grantId => window.desktop.fileOpenOptions({ grantId }), reopenedFile.file.id);
  assert.equal(reopenedOptions.selected, selection.id, 'opening preference survives a full application restart');
  console.log('File preview, three widths, in-app menus, selection/open/reopen persistence, chooser permissions and browser integration passed');
} finally {
  await app.close();
  await new Promise(done => server.close(done));
}
