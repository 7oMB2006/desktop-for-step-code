import { settleLayout } from './settle-layout.mjs';
import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { mkdtemp } from './test-profile.mjs';
import { createServer } from 'node:http';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { prepareSessionFixture, restartIdleSessionFixture } from './session-fixture.mjs';
import { previewPdf } from './file-preview-fixtures.mjs';

const profile = await mkdtemp(join(tmpdir(), 'step-file-preview-'));
const chosen = join(profile, 'picked.txt');
await writeFile(chosen, 'Explicitly selected outside the workspace.');
await writeFile(join(profile, 'preferences.json'), JSON.stringify({ language: 'zh', theme: 'light', workspaces: [], fileOpeningApps: { '.md': 'app:missing-application' } }));
await mkdir('test-results', { recursive: true });
const imageRequests = [];
const server = createServer((request, response) => {
  if (request.url.startsWith('/image-resource') || request.url.startsWith('/document-resource')) imageRequests.push(request.url);
  response.end('<title>Web reference</title><h1>Web reference</h1>');
});
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
let page;
const errors = [];
let stage = 'startup';
async function resizeWindow(width, height) {
  const size = await app.evaluate(({ BrowserWindow }, { width, height }) => {
    const window = BrowserWindow.getAllWindows()[0];
    window.setSize(width, height);
    return window.getContentSize();
  }, { width, height });
  // Native setSize returns before the renderer receives its new viewport.
  await page.waitForFunction(([width, height]) => innerWidth === width && innerHeight === height, size);
  await settleLayout(page.locator('.app'));
}
try {
  page = await app.firstWindow();
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    window.filePreviewEvents = [];
    const record = detail => {
      window.filePreviewEvents.push({ time: performance.now(), width: innerWidth, height: innerHeight, ...detail });
      if (window.filePreviewEvents.length > 40) window.filePreviewEvents.shift();
    };
    window.addEventListener('resize', () => record({ type: 'resize' }));
    for (const type of ['pointerdown', 'pointerup', 'click']) document.addEventListener(type, event => {
      const target = event.target instanceof Element ? event.target.closest('a,button') : null;
      record({ type, target: target?.textContent, tag: target?.tagName, x: event.clientX, y: event.clientY });
    }, true);
  });
  await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    window.setOpacity(0); window.setIgnoreMouseEvents(true); window.showInactive(); window.setSize(1680, 880);
  });
  await page.getByText('Step Code 已连接', { exact: true }).waitFor({ timeout: 60000 });
  const snapshot = await prepareSessionFixture(page);
  const runtimeId = snapshot.runtimeId;
  const cwd = snapshot.runtimes.find(item => item.runtimeId === runtimeId).cwd;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="760" height="400" viewBox="0 0 760 400">
<rect id="sample" width="760" height="400" fill="#2563eb"/>
<path fill="#21b388" d="M0 310L195 105 350 260 504 148 760 333V400H0Z"/>
<circle cx="615" cy="104" r="44" fill="#f8cf63"/>
</svg>`;
  const svgWithExternalContent = svg.replace('</svg>', `<image href="${address}image-resource.svg" x="30" y="40" width="120" height="100"/>
<script>document.getElementById('sample').setAttribute('fill', '#f00');</script></svg>`);
  await writeFile(join(cwd, 'landscape.svg'), svg);
  const png = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 320; canvas.height = 180;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#21b388'; ctx.fillRect(0, 0, 320, 180);
    return canvas.toDataURL().split(',')[1];
  });
  await writeFile(join(cwd, 'sample.png'), Buffer.from(png, 'base64'));
  const pdfPath = join(cwd, 'review.pdf');
  await writeFile(pdfPath, previewPdf(`${address}document-resource`));
  const csvPath = join(cwd, 'review.csv');
  const csv = '编号,任务,状态,备注\n001,"检查布局, 窄窗与深色",已通过,"两行备注\n继续保留"\n002,检查公式,已通过,=1+2\n'
    + Array.from({ length: 102 }, (_, i) => `${i + 3},检查交付 ${i + 3},待复核,文本\n`).join('');
  await writeFile(csvPath, csv);
  await writeFile(join(cwd, 'review.tsv'), '编号\t任务\n009\t分隔符');
  await writeFile(join(cwd, 'README.md'), '# 海岸骑行\n\n这是本轮生成的小动画。\n\n## 交付\n\n- 单文件 HTML\n- 支持暂停与继续\n\n```js\nconst speed = 2;\n```\n\n| 文件 | 状态 |\n| --- | --- |\n| index.html | 已完成 |\n');
  await writeFile(join(cwd, 'index.html'), `<!doctype html><meta charset="utf-8"><title>海岸骑行</title>
<style>body{margin:0;background:#ebf6f4;font:20px sans-serif}h1{padding:16px}canvas{width:100%;height:240px}</style>
<h1>海岸骑行</h1><canvas width="400" height="240"></canvas><button onclick="window.paused=!window.paused">暂停 / 继续</button>
<script>let tick=0;window.paused=false;const c=document.querySelector('canvas'),x=c.getContext('2d');
function draw(){if(!window.paused)tick++;x.fillStyle='#85d4be';x.fillRect(0,0,400,240);x.fillStyle='#2646a6';x.fillRect(tick%350,100,40,40);window.tick=tick;requestAnimationFrame(draw)}draw();</script>`);
  if (process.platform !== 'win32') {
    await mkdir(join(cwd, 'path-assets'));
    await writeFile(join(cwd, 'path-assets\\asset.js'), 'window.literalAsset = "literal-backslash";');
    await writeFile(join(cwd, 'path-assets/asset.js'), 'window.nestedAsset = "nested-directory";');
    const html = await readFile(join(cwd, 'index.html'), 'utf8');
    await writeFile(join(cwd, 'index.html'), html + '<script src="path-assets%5Casset.js"></script><script src="path-assets/asset.js"></script>');
  }
  const target = { runtimeId, path: './README.md' };
  const preview = await page.evaluate(target => window.desktop.fileOpen(target), target);
  assert.equal(preview.destination, 'preview');
  assert.match(preview.file.text, /海岸骑行/);
  await assert.rejects(page.evaluate(({ runtimeId, chosen }) => window.desktop.fileOpen({ runtimeId, path: chosen }), { runtimeId, chosen }));
  const messages = [
    { role: 'user', timestamp: Date.now() - 10000, content: '做一个海岸骑行小动画，并写一份交付说明。' },
    { role: 'assistant', timestamp: Date.now(), content: `动画和说明都已经准备好了。\n\n[海岸骑行动画](./index.html)\n\n[交付说明](./README.md)\n\n[网页参考](${address})\n\n[矢量图](./landscape.svg) · [位图](./sample.png)\n\n[审阅 PDF](./review.pdf) · [审阅 CSV](./review.csv) · [审阅 TSV](./review.tsv)` },
  ];
  await app.evaluate(({ ipcMain }, { snapshot, messages }) => {
    const original = ipcMain._invokeHandlers.get('desktop');
    globalThis.fileFixture = { ...snapshot, messages };
    globalThis.filePreviewCalls = [];
    ipcMain.removeHandler('desktop');
    ipcMain.handle('desktop', async (event, method, ...args) => {
      if (method === 'snapshot') return { ...globalThis.fileFixture, preferences: (await original(event, method, ...args)).preferences };
      if (method === 'sessions') return globalThis.fileFixture.sessions;
      if (method === 'browserList' && globalThis.filePreviewDelayNextBrowserRead) {
        globalThis.filePreviewDelayNextBrowserRead = false;
        await new Promise(resolve => setTimeout(resolve, 600));
      }
      if (method !== 'fileOpen') return original(event, method, ...args);
      const call = { time: Date.now(), method, destination: args[1] ?? 'internal', state: 'pending' };
      globalThis.filePreviewCalls.push(call);
      if (globalThis.filePreviewCalls.length > 30) globalThis.filePreviewCalls.shift();
      try {
        const result = await original(event, method, ...args);
        call.state = 'completed'; call.result = result?.destination ?? null;
        return result;
      } catch (error) {
        call.state = 'failed'; call.error = String(error.message ?? error);
        throw error;
      }
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
    await settleLayout(page.locator('.app'));
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
  await settleLayout(page.locator('.app'));
  assert.equal(await page.locator('.file-preview-track').evaluate(element => element.classList.contains('is-wide')), true);
  await handle.click();
  await handleMenu.getByRole('menuitemradio', { name: '标准', exact: true }).click();
  await settleLayout(page.locator('.app'));
  await handle.focus();
  await page.keyboard.press('ArrowLeft');
  await settleLayout(page.locator('.app'));
  assert.equal(await page.locator('.file-preview-track').evaluate(element => element.classList.contains('is-wide')), true);
  await page.keyboard.press('ArrowRight');
  await settleLayout(page.locator('.app'));
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
  await page.waitForFunction(() => {
    const panel = document.querySelector('#file-panel');
    const track = document.querySelector('.file-preview-track');
    return panel && track && !track.classList.contains('is-wide')
      && panel.getBoundingClientRect().width > 0
      && [panel, track, track.parentElement].filter(Boolean).every(element =>
        element.getAnimations().every(animation => animation.playState !== 'running'));
  });
  const standardBox = await page.locator('#file-panel').boundingBox();
  await widthTrigger.click();
  const widthMenu = page.getByRole('menu', { name: '文件预览宽度', exact: true });
  await widthMenu.getByRole('menuitemradio', { name: '宽幅', exact: true }).click();
  await page.waitForFunction(standardWidth => {
    const panel = document.querySelector('#file-panel');
    return document.querySelector('.file-preview-track')?.classList.contains('is-wide')
      && panel?.getBoundingClientRect().width > standardWidth + 50;
  }, standardBox.width);
  assert.ok((await page.locator('#file-panel').boundingBox()).width > standardBox.width + 50);
  await page.screenshot({ path: 'test-results/file-preview-wide.png' });
  await widthTrigger.click();
  await widthMenu.getByRole('menuitemradio', { name: '标准', exact: true }).click();
  await settleLayout(page.locator('.app'));
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
  await settleLayout(page.locator('.app'));
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
      if (!String(args[0]).endsWith('file-applications-macos') && !args[1]?.some(value => typeof value === 'string' && value.endsWith('file-associations.ps1'))) return globalThis.originalFileSpawn(...args);
      const child = new EventEmitter();
      child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.kill = () => true;
      let request = '';
      child.stdin.on('data', chunk => request += chunk);
      child.stdin.on('finish', () => {
        const payload = JSON.parse(request);
        if (payload.action === 'list') {
          child.stdout.end(process.platform === 'darwin' ? JSON.stringify([{ id: '/System/Applications/TextEdit.app', label: 'TextEdit fixture' }]) : '[]');
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
  await page.reload();
  await page.getByRole('link', { name: '交付说明', exact: true }).click();
  await page.locator('.file-preview-markdown h1').waitFor();
  await page.locator('#file-panel').getByRole('button', { name: '选择打开方式', exact: true }).click();
  const openingMenu = page.getByRole('menu', { name: '打开方式', exact: true });
  await openingMenu.getByRole('menuitemradio', { name: '文件预览', exact: true }).waitFor();
  const menuLabels = await openingMenu.getByRole('menuitemradio').allTextContents();
  assert.ok(menuLabels.includes('文件预览'));
  assert.ok(menuLabels.includes('系统默认应用'));
  assert.equal(menuLabels.some(label => label.includes('其他应用')), ['win32', 'darwin'].includes(process.platform), 'native application picker is available on Windows and macOS');
  assert.equal(await openingMenu.getByRole('menuitemradio', { name: '文件预览', exact: true }).getAttribute('aria-checked'), 'true', 'an unavailable saved application falls back to internal preview');
  await settleLayout(openingMenu);
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
  if (process.platform === 'darwin') {
    assert.ok(selection.id.startsWith('app:'));
    assert.equal(await app.evaluate(() => globalThis.openedFileRequest.id), '/System/Applications/TextEdit.app');
    await assert.rejects(page.evaluate(target => window.desktop.fileOpen(target, 'app:unknown'), target), /Unknown associated application/);
    await app.evaluate(({ dialog }) => { globalThis.originalOpenDialog = dialog.showOpenDialog; dialog.showOpenDialog = async () => ({ canceled: false, filePaths: ['/System/Applications/TextEdit.app'] }); });
    await page.evaluate(target => window.desktop.fileOpen(target, 'other'), target);
    assert.equal(await app.evaluate(() => globalThis.openedFileRequest.id), '/System/Applications/TextEdit.app');
    assert.equal(JSON.parse(await readFile(join(profile, 'preferences.json'), 'utf8')).fileOpeningApps['.md'], selection.id, 'one-time picker retains the remembered choice');
    await app.evaluate(({ dialog }) => { dialog.showOpenDialog = async () => ({ canceled: true, filePaths: [] }); });
    assert.equal(await page.evaluate(target => window.desktop.fileOpen(target, 'other'), target), null);
    await app.evaluate(({ dialog }) => { dialog.showOpenDialog = globalThis.originalOpenDialog; });
  }

  await page.reload();
  await page.getByRole('link', { name: '交付说明', exact: true }).click();
  await page.waitForFunction(label => document.querySelector('#file-panel .file-open-control > button:first-child')?.textContent === label, selection.label);
  await page.locator('#file-panel').getByRole('button', { name: '选择打开方式', exact: true }).click();
  await openingMenu.getByRole('menuitemradio', { name: selection.label, exact: true }).waitFor();
  assert.equal(await openingMenu.getByRole('menuitemradio', { name: selection.label, exact: true }).getAttribute('aria-checked'), 'true');
  await page.waitForFunction(() => document.activeElement?.closest('[role="menu"]')?.getAttribute('aria-label') === '打开方式');
  const nextFocusedItem = await openingMenu.getByRole('menuitemradio').evaluateAll(items => {
    const enabled = items.filter(item => !item.disabled);
    return enabled[(enabled.indexOf(document.activeElement) + 1) % enabled.length].textContent;
  });
  await page.keyboard.press('ArrowDown');
  await page.waitForFunction(text => document.activeElement?.getAttribute('role') === 'menuitemradio' && document.activeElement.textContent === text, nextFocusedItem);
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
  await settleLayout(openingMenu);
  await page.screenshot({ path: 'test-results/file-opening-menu-dark.png' });
  await page.keyboard.press('Escape');
  await page.screenshot({ path: 'test-results/file-preview-markdown-dark.png' });
  await resizeWindow(640, 800);
  const narrow = await page.locator('#file-panel').boundingBox();
  assert.ok(narrow.x >= 0 && narrow.x + narrow.width <= 640);
  await widthTrigger.click();
  await widthMenu.getByRole('menuitemradio', { name: '宽幅', exact: true }).click();
  await settleLayout(page.locator('.app'));
  assert.equal(Math.round((await page.locator('#file-panel').boundingBox()).width), Math.round(narrow.width), 'wide overlays do not overflow small windows');
  await page.locator('#file-panel').getByRole('button', { name: '选择打开方式', exact: true }).click();
  await openingMenu.waitFor();
  await settleLayout(openingMenu);
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
  stage = 'image-preview';
  const filePanel = page.locator('#file-panel');
  const image = filePanel.locator('.file-preview-image img');
  const svgLink = page.getByRole('link', { name: '矢量图', exact: true });
  const refresh = filePanel.getByRole('button', { name: '刷新文件', exact: true });
  const imagePixel = async () => image.evaluate(async element => {
    await element.decode();
    const canvas = document.createElement('canvas');
    canvas.width = 1; canvas.height = 1;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(element, 10, 10, 1, 1, 0, 0, 1, 1);
    return [...ctx.getImageData(0, 0, 1, 1).data];
  });
  await svgLink.click();
  await image.waitFor();
  assert.deepEqual(await imagePixel(), [37, 99, 235, 255], 'SVG renders expected pixels');
  const fit = await image.boundingBox();
  assert.ok(fit.width < 640 && Math.abs(fit.width / fit.height - 760 / 400) < .02, 'SVG fits a narrow panel without changing aspect ratio');
  const actual = filePanel.getByRole('button', { name: '原始尺寸', exact: true });
  await actual.click();
  assert.equal((await image.boundingBox()).width, 760);
  assert.equal(await filePanel.locator('.file-preview-scroll').evaluate(el => el.scrollWidth > el.clientWidth), true);
  await actual.click();
  await page.screenshot({ path: 'test-results/file-preview-svg-narrow.png' });
  await resizeWindow(1680, 880);
  await page.evaluate(() => document.documentElement.dataset.theme = 'light');
  await settleLayout(page.locator('.app'));
  await page.screenshot({ path: 'test-results/file-preview-svg.png' });
  await filePanel.getByRole('button', { name: '查看源码', exact: true }).click();
  assert.equal(await filePanel.locator('.file-preview-source').textContent(), svg);
  await page.screenshot({ path: 'test-results/file-preview-svg-source.png' });
  await writeFile(join(cwd, 'landscape.svg'), svgWithExternalContent.replace('#2563eb', '#a855f7'));
  await refresh.click();
  await page.waitForFunction(() => document.querySelector('.file-preview-source')?.textContent.includes('#a855f7'));
  await filePanel.getByRole('button', { name: '图像预览', exact: true }).click();
  assert.deepEqual(await imagePixel(), [168, 85, 247, 255], 'SVG renders the refreshed colors without running its script');
  assert.deepEqual(imageRequests, [], 'SVG image does not request external assets');
  await writeFile(join(cwd, 'landscape.svg'), '<svg malformed');
  await refresh.click();
  await filePanel.getByText('无法显示此图像', { exact: true }).waitFor();
  await writeFile(join(cwd, 'landscape.svg'), svg);
  await refresh.click();
  assert.deepEqual(await imagePixel(), [37, 99, 235, 255], 'refresh recovers after an invalid image');
  await page.getByRole('link', { name: '位图', exact: true }).click();
  await filePanel.getByRole('img', { name: 'sample.png' }).waitFor();
  assert.deepEqual(await imagePixel(), [33, 179, 136, 255]);
  assert.equal(await filePanel.getByRole('button', { name: '查看源码', exact: true }).count(), 0);
  assert.deepEqual(imageRequests, []);
  stage = 'document-previews';
  const documentLink = name => page.getByRole('link', { name, exact: true });
  await documentLink('审阅 PDF').click();
  const pdfSelector = '#file-panel .file-preview-pdf-page canvas[data-ready]';
  const pdfCanvas = page.locator(pdfSelector);
  const assertPdfColor = async (number, expected, message) => {
    const label = `第 ${number} 页`;
    try {
      // A resize can redraw an existing ready canvas asynchronously.
      await page.waitForFunction(({ selector, label, expected }) => {
        const canvas = document.querySelector(selector);
        if (canvas?.getAttribute('aria-label') !== label) return false;
        return canvas.getContext('2d').getImageData(8, 8, 1, 1).data
          .every((value, index) => Math.abs(value - expected[index]) <= 1);
      }, { selector: pdfSelector, label, expected }, { timeout: 10_000, polling: 50 });
    } catch (error) {
      const actual = await pdfCanvas.evaluate(canvas => ({
        page: canvas.getAttribute('aria-label'),
        pixel: [...canvas.getContext('2d').getImageData(8, 8, 1, 1).data],
      }), undefined, { timeout: 1000 }).catch(() => null);
      throw new Error(`${message}: expected ${label} with ${expected}, got ${JSON.stringify(actual)}`, { cause: error });
    }
  };
  await pdfCanvas.waitFor({ timeout: 15000 });
  await assertPdfColor(1, [38, 87, 194, 255], 'first PDF page is rendered');
  assert.equal(await filePanel.locator('.file-preview-pdf-page a, .file-preview-pdf-page iframe').count(), 0);
  const pdfTextPainted = await pdfCanvas.evaluate(el => {
    const { data } = el.getContext('2d').getImageData(0, Math.floor(el.height * .19), el.width, Math.floor(el.height * .09));
    return data.some((value, index) => index % 4 === 0 && value < 100);
  });
  assert.ok(pdfTextPainted, 'PDF text has visible glyph pixels');
  await page.screenshot({ path: 'test-results/file-preview-pdf.png' });
  await resizeWindow(640, 800);
  await page.evaluate(() => document.documentElement.dataset.theme = 'dark');
  await page.waitForFunction(() => document.querySelector('.file-preview-pdf-page canvas')?.getBoundingClientRect().width < 540);
  await settleLayout(page.locator('.app'));
  await page.screenshot({ path: 'test-results/file-preview-pdf-narrow.png' });
  const pdfActual = filePanel.getByRole('button', { name: '原始尺寸', exact: true });
  await pdfActual.click();
  await page.waitForFunction(() => document.querySelector('.file-preview-pdf-page canvas')?.getBoundingClientRect().width > 580);
  assert.ok(await filePanel.locator('.file-preview-scroll').evaluate(el => el.scrollWidth > el.clientWidth));
  await pdfActual.click();
  await resizeWindow(1680, 880);
  await page.evaluate(() => document.documentElement.dataset.theme = 'light');
  await filePanel.getByRole('button', { name: '下一页', exact: true }).click();
  await filePanel.getByRole('img', { name: '第 2 页', exact: true }).waitFor();
  await assertPdfColor(2, [26, 128, 89, 255], 'next page replaces the canvas');
  const pageInput = filePanel.getByRole('textbox', { name: '页码', exact: true });
  await pageInput.fill('1');
  await pageInput.press('Enter');
  await filePanel.getByRole('img', { name: '第 1 页', exact: true }).waitFor();
  await writeFile(pdfPath, previewPdf(`${address}document-resource`, '0.7 0.15 0.1'));
  await refresh.click();
  await filePanel.getByRole('button', { name: '下一页', exact: true }).click();
  await filePanel.getByRole('img', { name: '第 2 页', exact: true }).waitFor();
  await assertPdfColor(2, [179, 38, 26, 255], 'refresh renders new PDF bytes');
  assert.deepEqual(imageRequests, []);
  await writeFile(pdfPath, '%PDF-1.7\nbroken');
  await refresh.click();
  await filePanel.getByText('无法读取此 PDF', { exact: true }).waitFor();

  await documentLink('审阅 CSV').click();
  const grid = filePanel.getByRole('table', { name: 'CSV 表格', exact: true });
  await grid.getByRole('cell', { name: '001', exact: true }).waitFor();
  assert.equal(await grid.getByRole('cell', { name: '=1+2', exact: true }).count(), 1);
  assert.equal(await grid.getByRole('cell', { name: '检查布局, 窄窗与深色', exact: true }).count(), 1);
  const firstRow = filePanel.getByRole('checkbox', { name: '首行作为表头', exact: true });
  await firstRow.uncheck();
  await grid.getByRole('cell', { name: '编号', exact: true }).waitFor();
  await firstRow.check();
  await grid.getByRole('columnheader', { name: '编号', exact: true }).waitFor();
  await page.screenshot({ path: 'test-results/file-preview-csv.png' });
  await filePanel.getByRole('button', { name: '下一批行', exact: true }).click();
  await grid.getByRole('cell', { name: '检查交付 103', exact: true }).waitFor();
  await filePanel.getByRole('button', { name: '查看源码', exact: true }).click();
  assert.equal(await filePanel.locator('.file-preview-source').textContent(), csv);
  await filePanel.getByRole('button', { name: '表格预览', exact: true }).click();
  await grid.getByRole('cell', { name: '001', exact: true }).waitFor();
  await documentLink('审阅 TSV').click();
  await filePanel.getByRole('table', { name: 'TSV 表格', exact: true }).getByRole('cell', { name: '009', exact: true }).waitFor();
  await resizeWindow(640, 800);
  await app.evaluate(({ dialog }, chosen) => {
    globalThis.originalFileDialog = dialog.showOpenDialog;
    globalThis.fileDialogChoice = chosen;
    dialog.showOpenDialog = async (_window, options) => {
      globalThis.filePreviewFilters = options.filters;
      return { canceled: false, filePaths: [globalThis.fileDialogChoice] };
    };
  }, chosen);
  await page.locator('#file-panel .right-panel-header').getByRole('button', { name: '打开文件', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.file-preview-source')?.textContent.includes('Explicitly selected'));
  const filters = await app.evaluate(() => globalThis.filePreviewFilters);
  assert.equal(filters[0].name, '可预览文件');
  assert.ok(['svg', 'png', 'pdf', 'csv', 'tsv'].every(ext => filters[0].extensions.includes(ext)));
  await app.evaluate((_electron, movie) => { globalThis.fileDialogChoice = movie; }, join(profile, 'unsupported.mp4'));
  await writeFile(join(profile, 'unsupported.mp4'), 'Not launched from the preview picker');
  await assert.rejects(page.evaluate(() => window.desktop.fileOpen()), /不支持应用内预览/);
  await app.evaluate(({ dialog }) => { dialog.showOpenDialog = globalThis.originalFileDialog; });
  stage = 'local-html-open';
  await resizeWindow(1322, 880);
  await page.evaluate(() => document.documentElement.dataset.theme = 'light');
  await settleLayout(page.locator('.app'));
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
      tick:window.tick, literalAsset:window.literalAsset, nestedAsset:window.nestedAsset
    })`);
    globalThis.previewContents = view.webContents;
    return result;
  });
  assert.equal(localState.node, 'undefined');
  assert.equal(localState.bridge, 'undefined');
  if (process.platform !== 'win32') {
    assert.equal(localState.literalAsset, 'literal-backslash');
    assert.equal(localState.nestedAsset, 'nested-directory');
  }
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
  stage = 'browser-retention-and-refresh';
  await page.getByRole('link', { name: '海岸骑行动画', exact: true }).click();
  assert.equal((await page.evaluate(() => window.desktop.browserList())).tabs.filter(tab => tab.localFile).length, 1);
  await page.locator('#browser-panel').waitFor({ state: 'hidden' });
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
  await waitBrowser(page, snapshot => snapshot.tabs.some(tab => tab.localFile && !tab.loading));
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
  await waitBrowser(page, snapshot => snapshot.tabs.some(tab => tab.id === snapshot.activeId && tab.url === address && !tab.loading));
  const browserPanel = page.locator('#browser-panel');
  await browserPanel.waitFor({ state: 'visible' });
  await page.waitForFunction(() => document.querySelector('#browser-panel')?.getAttribute('aria-hidden') === 'false');
  assert.equal((await page.evaluate(() => window.desktop.browserList())).tabs.length, 2);
  await app.evaluate(() => { globalThis.filePreviewDelayNextBrowserRead = true; });
  await page.getByRole('link', { name: '网页参考', exact: true }).click();
  // The exit includes IPC, React and a 260ms animation; wait for its outcome, not a fixed delay.
  await browserPanel.waitFor({ state: 'hidden' });
  assert.equal(await browserPanel.isVisible(), false, 'clicking the current web reference closes its panel');
  await page.getByRole('link', { name: '网页参考', exact: true }).click();
  await browserPanel.waitFor({ state: 'visible' });
  assert.equal(await browserPanel.isVisible(), true);
  assert.deepEqual(errors, []);
  stage = 'application-reopen';
  await app.close();
  app = await launch();
  const reopened = await app.firstWindow();
  page = reopened;
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
  if (process.platform !== 'win32') {
    const beforeRestart = await prepareSessionFixture(reopened);
    const pids = await app.evaluate(() => process._getActiveHandles()
      .filter(handle => handle.pid && handle.spawnargs?.some(arg => /[\\/]step\.js$/.test(arg)) && handle.spawnargs.includes('rpc'))
      .map(handle => handle.pid));
    assert.ok(pids.length > 0, 'An actual fixture RPC child is running before restart');
    const restarted = await restartIdleSessionFixture(reopened, beforeRestart.runtimeId);
    assert.notEqual(restarted.runtimeId, beforeRestart.runtimeId);
    assert.equal(restarted.state.isStreaming, false);
    assert.equal(await app.evaluate((_electron, pids) => pids.every(pid => {
      try { process.kill(pid, 0); return false; } catch (error) { return error.code === 'ESRCH'; }
    }), pids), true, 'Session restart waits until the old RPC process is gone');
  }
  console.log('File preview, images, PDF, CSV/TSV, panel widths, opening preferences, chooser permissions and browser integration passed');
} catch (error) {
  const diagnostic = {
    stage, packaged: Boolean(executablePath), rendererErrors: errors,
    renderer: await page?.evaluate(async () => ({
      size: [innerWidth, innerHeight], events: window.filePreviewEvents,
      error: document.querySelector('.app-error-banner')?.textContent,
      tabs: await window.desktop.browserList(),
      links: [...document.querySelectorAll('a.file-reference')].map(element => {
        const { x, y, width, height } = element.getBoundingClientRect();
        return { text: element.textContent, bounds: { x, y, width, height } };
      }),
    })).catch(() => ({ unavailable: true })),
    native: await app.evaluate(({ BrowserWindow }) => ({
      calls: globalThis.filePreviewCalls,
      windows: BrowserWindow.getAllWindows().map(window => ({
        size: window.getContentSize(), views: window.contentView.children.map(view => ({
          destroyed: view.webContents?.isDestroyed(), visible: view.getVisible(), bounds: view.getBounds(),
          url: view.webContents && !view.webContents.isDestroyed() ? view.webContents.getURL() : undefined,
        })),
      })),
    })).catch(() => ({ unavailable: true })),
  };
  const name = `test-results/file-preview-failure-${executablePath ? 'package' : 'source'}`;
  await page?.screenshot({ path: `${name}.png` }).catch(() => {});
  await writeFile(`${name}.json`, JSON.stringify(diagnostic, null, 2) + '\n');
  console.error('File preview diagnostic:', JSON.stringify(diagnostic));
  throw error;
} finally {
  await app.close();
  await new Promise(done => server.close(done));
}
