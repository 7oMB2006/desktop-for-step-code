import { settleLayout } from './settle-layout.mjs';
import { sampleMotion } from './sample-motion.mjs';
import { waitForBrowserFixtureSnapshot } from './browser-fixture.mjs';
import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { mkdtemp } from './test-profile.mjs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const icon = await readFile('public/StepCode.svg');
const server = createServer((request, response) => {
  if (request.url === '/icon.png') {
    response.writeHead(200, { 'Content-Type': 'image/svg+xml' });
    response.end(icon);
    return;
  }
  if (request.url === '/redirect') { response.writeHead(302, { Location: 'file:///C:/Windows/win.ini' }); response.end(); return; }
  if (request.url === '/fail') { request.socket.destroy(); return; }
  const second = request.url === '/details';
  response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Set-Cookie': 'browser_fixture=isolated; SameSite=Lax' });
  response.end(`<!doctype html><html lang="zh"><meta charset="utf-8"><title>${second ? '项目详情' : '项目预览'}</title>
    <style>*{box-sizing:border-box}body{margin:0;font:14px/1.6 "Segoe UI",sans-serif;color:#20242a;background:#fff}
    header{padding:22px 28px;border-bottom:1px solid #e7e9ed;display:flex;justify-content:space-between;align-items:center}
    header strong{font-size:15px}header span{font-size:11px;color:#697383}main{padding:30px 28px;max-width:850px}
    h1{font-size:26px;font-weight:600;margin:0 0 14px}p{color:#5f6875}a{color:#3c66a3}
    .stats{display:flex;gap:36px;margin:28px 0;border-bottom:1px solid #e7e9ed;padding-bottom:24px}
    .stats b{font-size:22px;display:block}.stats span{font-size:11px;color:#697383}
    article{display:flex;align-items:center;gap:14px;border-bottom:1px solid #edf0f2;padding:18px 0}
    article img{width:40px;height:40px}article div{flex:1}article strong{font-size:13px}article p{margin:3px 0;font-size:12px}
    .status{color:#287751;font-size:11px}input{padding:9px;border:1px solid #d8dce3;border-radius:4px;width:100%;font:inherit}
    footer{margin-top:34px;color:#737e8c;font-size:12px}button{font:inherit}</style>
    <header><strong>Step Code / 本地预览</strong><span>DEVELOPMENT</span></header>
    <main><h1>${second ? '项目详情' : '工作区概览'}</h1><p>这个页面来自独立的本地 HTTP 服务。</p>
    <div class="stats"><div><b>12</b><span>文件</span></div><div><b>4</b><span>测试</span></div><div><b>100%</b><span>通过率</span></div></div>
    <input aria-label="测试输入" placeholder="在网页中输入文字"/>
    <p><a href="${second ? '/' : '/details'}">${second ? '返回概览' : '查看项目详情'}</a> · <a href="/details" target="_blank">新标签页打开</a></p>
    ${Array.from({ length: 18 }, (_, index) => `<article><img src="/icon.png" alt=""/><div><strong>${['界面组件', '运行时连接', '协议验证'][index % 3]} ${index + 1}</strong><p>本地项目 · 检查完成</p></div><span class="status">已通过</span></article>`).join('')}
    <footer>本地验收页面</footer></main></html>`);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
const url = `http://127.0.0.1:${port}/`;
const profile = await mkdtemp(join(tmpdir(), 'step-browser-panel-'));
await writeFile(join(profile, 'preferences.json'), JSON.stringify({ language: 'zh', theme: 'light', workspaces: [] }));
const root = join(profile, 'step-runtime');
const sessions = join(root, 'sessions');
await mkdir(sessions, { recursive: true });
await writeFile(join(root, 'config.toml'), 'defaultProvider = "fixture"\ndefaultModel = "fixture"\n[telemetry]\nenabled = false\n[mcp_servers.steppage__steppage]\nenabled = false\n');
await writeFile(join(root, 'models.json'), JSON.stringify({ providers: {
  fixture: { baseUrl: `${url}v1`, api: 'openai-completions', apiKey: 'local-test-only',
    models: [{ id: 'fixture', name: 'Browser fixture' }] },
} }));
for (const id of ['browser-a', 'browser-b', 'browser-c']) {
  const timestamp = new Date().toISOString();
  await writeFile(join(sessions, `${id}.jsonl`), [
    { type: 'session', version: 3, id, cwd: profile, timestamp },
    { type: 'message', id: 'message-1', parentId: null, timestamp,
      message: { role: 'user', content: [{ type: 'text', text: id }], timestamp: Date.parse(timestamp) } },
  ].map(value => JSON.stringify(value)).join('\n') + '\n');
}
await mkdir('test-results', { recursive: true });
// WebContentsView targets can be classified as "other", not a BrowserWindow page.
// Keep Playwright attached to those real native renderers in this isolated test.
process.env.PW_CHROMIUM_ATTACH_TO_OTHER = '1';
const env = { ...process.env, DESKTOP_TEST_USER_DATA: profile, DESKTOP_TEST_NO_FOCUS: '1' };
delete env.ELECTRON_RUN_AS_NODE;
const executablePath = process.env.DESKTOP_VERIFY_EXE;
const app = await electron.launch({ ...(executablePath ? { executablePath } : {}),
  args: [...(executablePath ? [] : [resolve('.')]), '--disable-backgrounding-occluded-windows',
  '--disable-renderer-backgrounding', '--disable-features=CalculateNativeWinOcclusion'], env, timeout: 60000 });
let closed = false;
const errors = [];
try {
  const page = await app.firstWindow();
  await app.evaluate(({ app, BrowserWindow, webContents }) => {
    globalThis.browserFixtureLifecycle = [];
    const record = (event, detail = {}) => {
      globalThis.browserFixtureLifecycle.push({ event, ...detail });
      if (globalThis.browserFixtureLifecycle.length > 100) globalThis.browserFixtureLifecycle.shift();
    };
    const watch = contents => {
      const id = contents.id;
      record('created', { id, type: contents.getType() });
      contents.on('did-navigate', (_event, url) => record('navigated', { id, url }));
      contents.on('did-fail-load', (_event, code, _description, url, mainFrame) => {
        if (mainFrame) record('load-failed', { id, code, url });
      });
      contents.on('render-process-gone', (_event, detail) => record('renderer-exited', { id, reason: detail.reason, exitCode: detail.exitCode }));
      contents.once('destroyed', () => record('destroyed', { id }));
    };
    for (const contents of webContents.getAllWebContents()) watch(contents);
    app.on('web-contents-created', (_event, contents) => watch(contents));
    app.on('before-quit', () => record('before-quit'));
    for (const window of BrowserWindow.getAllWindows()) window.on('close', () => record('window-close', { id: window.id }));
  });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  page.setDefaultTimeout(15000);
  page.on('pageerror', error => errors.push(error.message));
  await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    window.setOpacity(0); window.setIgnoreMouseEvents(true); window.showInactive(); window.setSize(1706, 1066);
  });
  await page.getByText('Step Code 已连接', { exact: true }).waitFor({ state: 'attached', timeout: 60000 });
  const rail = page.locator('.right-tool-rail').getByRole('button', { name: '浏览器', exact: true });
  const panel = page.locator('#browser-panel');
  const summary = page.locator('.right-tool-rail').getByRole('button', { name: '摘要', exact: true });
  const list = () => page.evaluate(() => window.desktop.browserList());
  const viewState = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].contentView.children.map(view =>
    ({ url: view.webContents?.getURL(), visible: view.getVisible(), bounds: view.getBounds() })));
  const selectSession = async id => {
    const row = page.locator(`[data-reorder-kind="session"][data-reorder-id="${id}"]`);
    await row.locator('button').first().click();
    await page.waitForFunction(id => document.querySelector('.session-row.selected')?.dataset.reorderId === id &&
      document.querySelector('.new-chat')?.disabled === false &&
      !document.querySelector('.composer-wrap.session-navigation-pending'), id);
  };
  await selectSession('browser-a');
  await rail.click();
  await waitForBrowserFixtureSnapshot(page, snapshot => snapshot.tabs.length === 1, 'the first native tab');
  await panel.getByRole('tab', { selected: true }).waitFor();
  const first = (await list()).tabs[0].id;
  await panel.getByRole('textbox', { name: '网页地址', exact: true }).fill(`127.0.0.1:${port}`);
  await panel.getByRole('textbox', { name: '网页地址', exact: true }).press('Enter');
  await waitForBrowserFixtureSnapshot(page, snapshot => snapshot.tabs[0]?.title === '项目预览', 'the initial page title');
  const nativePageId = () => app.evaluate(({ webContents }, url) =>
    webContents.getAllWebContents().find(contents => contents.getURL() === url)?.id, url);
  const originalPageId = await nativePageId();
  assert.ok(originalPageId);
  await selectSession('browser-b');
  assert.equal(await rail.getAttribute('aria-pressed'), 'false');
  if (await summary.getAttribute('aria-pressed') === 'true') await summary.click();
  await summary.click();
  await page.locator('.summary-board').waitFor({ state: 'visible' });
  await selectSession('browser-a');
  await panel.locator('.browser-page').waitFor({ state: 'visible' });
  assert.equal((await list()).activeId, first);
  assert.equal(await nativePageId(), originalPageId, 'returning to the conversation retained its native tab');
  await selectSession('browser-b');
  await page.locator('.summary-board').waitFor({ state: 'visible' });
  await summary.click();
  await selectSession('browser-a');
  await panel.locator('.browser-page').waitFor({ state: 'visible' });
  await selectSession('browser-b');
  assert.equal(await summary.getAttribute('aria-pressed'), 'false', 'explicit closure survives returning');
  const contextPanel = page.locator('#context-panel');
  const contextTool = page.locator('.right-tool-rail').getByRole('button', { name: '上下文', exact: true });
  const turns = page.locator('#conversation-navigation-panel');
  const turnsTool = page.locator('.right-tool-rail').getByRole('button', { name: '会话导航', exact: true });
  await contextTool.click();
  await contextPanel.getByRole('tab', { name: '状态', exact: true }).click();
  await selectSession('browser-a');
  await panel.locator('.browser-page').waitFor({ state: 'visible' });
  await turnsTool.click();
  await turns.getByText('browser-a', { exact: true }).waitFor();
  await selectSession('browser-b');
  await contextPanel.getByRole('tab', { name: '状态', exact: true, selected: true }).waitFor();
  await contextPanel.getByRole('button', { name: '关闭上下文', exact: true }).click();
  await selectSession('browser-a');
  await turns.getByText('browser-a', { exact: true }).waitFor();
  assert.equal(await turns.getByText('browser-b', { exact: true }).count(), 0, 'navigation lists only the restored conversation');
  await selectSession('browser-b');
  assert.equal(await contextTool.getAttribute('aria-pressed'), 'false', 'closed Context stays closed');
  await contextTool.click();
  await contextPanel.getByRole('tab', { name: '上下文', exact: true, selected: true }).waitFor();
  await selectSession('browser-a');
  await turns.getByText('browser-a', { exact: true }).waitFor();
  await turnsTool.click();
  await selectSession('browser-b');
  await contextPanel.getByRole('tab', { name: '上下文', exact: true, selected: true }).waitFor();
  await selectSession('browser-a');
  assert.equal(await turnsTool.getAttribute('aria-pressed'), 'false', 'closed navigation stays closed');
  await rail.click();
  await panel.locator('.browser-page').waitFor({ state: 'visible' });
  assert.equal(await nativePageId(), originalPageId, 'other right panels did not reload the browser');
  await settleLayout(page.locator('.app'));
  await page.waitForFunction(() => {
    const composer = document.querySelector('.composer')?.getBoundingClientRect();
    const browser = document.querySelector('#browser-panel .browser-page')?.getBoundingClientRect();
    return composer && browser && composer.right <= browser.left + 1;
  });
  const standardPageBounds = await panel.locator('.browser-page').boundingBox();
  const conversationBounds = await page.locator('.composer').boundingBox();
  assert.ok(conversationBounds && conversationBounds.x + conversationBounds.width <= standardPageBounds.x + 1,
    'the standard native browser does not overlap the conversation composer');
  // Native navigation/title events can precede Playwright's target attachment.
  let webPage;
  await assert.doesNotReject(async () => {
    await waitForBrowserFixtureSnapshot(page, snapshot => {
      const tab = snapshot.tabs[0];
      return tab?.title === '项目预览' && !tab.loading;
    }, 'a loaded native page');
    const deadline = Date.now() + 15000;
    while (!(webPage = app.windows().find(value => value.url().startsWith(url)))) {
      if (Date.now() >= deadline) {
        const native = await app.evaluate(({ webContents }) => webContents.getAllWebContents().map(contents => ({
          id: contents.id, type: contents.getType(), url: contents.getURL(), loading: contents.isLoading(),
        })));
        throw new Error(`Native page attachment failed: ${JSON.stringify({
          native, attached: app.windows().map(value => ({ url: value.url(), closed: value.isClosed() })),
        })}`);
      }
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    await webPage.getByRole('textbox', { name: '测试输入' }).waitFor();
    await webPage.waitForFunction(() => {
      const image = document.querySelector('img');
      return image?.complete && image.naturalWidth > 0;
    });
  }, 'native WebContentsView exposes a loaded real page');
  const isolation = await webPage.evaluate(() => ({
    require: typeof window.require, desktop: typeof window.desktop, process: typeof window.process,
    image: document.querySelector('img').complete && document.querySelector('img').naturalWidth > 0,
  }));
  assert.deepEqual(isolation, { require: 'undefined', desktop: 'undefined', process: 'undefined', image: true });
  assert.equal(await page.evaluate(() => typeof window.require), 'undefined');
  const isolationSettings = await app.evaluate(({ BrowserWindow }) => {
    const view = BrowserWindow.getAllWindows()[0].contentView.children.find(view => view.webContents?.getURL().startsWith('http:'));
    const preferences = view.webContents.getLastWebPreferences();
    return { sandbox: preferences.sandbox, nodeIntegration: preferences.nodeIntegration,
      contextIsolation: preferences.contextIsolation, preload: preferences.preload || '' };
  });
  assert.deepEqual(isolationSettings, { sandbox: true, nodeIntegration: false, contextIsolation: true, preload: '' });
  await webPage.getByRole('textbox', { name: '测试输入' }).fill('网页输入正常');
  assert.equal(await webPage.getByRole('textbox').inputValue(), '网页输入正常');
  await app.evaluate(({ BrowserWindow }) => {
    const view = BrowserWindow.getAllWindows()[0].contentView.children.find(view => view.webContents?.getURL().startsWith('http:'));
    view.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'L', modifiers: [process.platform === 'darwin' ? 'meta' : 'control'] });
    view.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'L', modifiers: [process.platform === 'darwin' ? 'meta' : 'control'] });
  });
  await page.waitForFunction(() => document.activeElement === document.querySelector('.browser-address-field input'), undefined, { timeout: 5000 });
  await panel.getByRole('textbox', { name: '网页地址', exact: true }).press('Escape');
  assert.equal(await rail.getAttribute('aria-pressed'), 'true', 'Escape in the URL input does not close the panel');
  await webPage.getByRole('link', { name: '查看项目详情', exact: true }).click();
  await waitForBrowserFixtureSnapshot(page, snapshot => snapshot.tabs[0]?.canGoBack, 'back navigation');
  await panel.getByRole('button', { name: '后退', exact: true }).click();
  await webPage.waitForURL(url);
  await waitForBrowserFixtureSnapshot(page, snapshot => snapshot.tabs[0]?.canGoForward, 'forward navigation');
  await panel.getByRole('button', { name: '前进', exact: true }).click();
  await webPage.waitForURL(`${url}details`);
  await panel.getByRole('button', { name: '后退', exact: true }).click();
  await webPage.waitForURL(url);
  await webPage.evaluate(() => window.scrollTo(0, 700));
  assert.ok(await webPage.evaluate(() => window.scrollY) > 0);
  await webPage.evaluate(() => window.scrollTo(0, 0));
  await panel.getByRole('button', { name: '放大网页', exact: true }).click();
  assert.equal(Math.round((await list()).tabs[0].zoom * 100), 110);
  await panel.getByRole('button', { name: '重置缩放', exact: true }).click();
  assert.equal((await list()).tabs[0].zoom, 1);
  const context = await app.evaluate(async ({ session }) => ({
    browser: (await session.fromPartition('persist:desktop-browser').cookies.get({ name: 'browser_fixture' })).length,
    desktop: (await session.defaultSession.cookies.get({ name: 'browser_fixture' })).length,
  }));
  assert.deepEqual(context, { browser: 1, desktop: 0 });
  const permission = await webPage.evaluate(async () => {
    try { await navigator.mediaDevices.getUserMedia({ audio: true }); return 'allowed'; }
    catch (error) { return error.name; }
  });
  assert.notEqual(permission, 'allowed');
  for (const address of ['file:///C:/Windows/win.ini', 'javascript:alert(1)', 'data:text/html,hello', 'https://u:p@example.com/'])
    await assert.rejects(page.evaluate(({ first, address }) => window.desktop.browserAction(first, 'navigate', address), { first, address }));
  await assert.rejects(page.evaluate(() => window.desktop.browserSelect('missing')), /Unknown browser/);
  await assert.rejects(page.evaluate(() => window.desktop.browserLayout({ x: NaN, y: 0, width: 1, height: 1 })), /bounds/);
  await assert.rejects(page.evaluate(id => window.desktop.browserAction(id, 'unknown'), first), /action/);
  await webPage.evaluate(() => window.open('file:///C:/Windows/win.ini', '_blank'));
  assert.equal((await list()).tabs.length, 1, 'unsupported popup targets cannot create a tab');
  await page.evaluate(({ first, url }) => window.desktop.browserAction(first, 'navigate', `${url}redirect`), { first, url });
  await waitForBrowserFixtureSnapshot(page, snapshot => snapshot.tabs[0] && !snapshot.tabs[0].loading, 'the settled redirect');
  assert.ok(!webPage.url().startsWith('file:'), 'redirects cannot enter the local filesystem');
  if ((await list()).tabs[0].error) {
    assert.equal((await viewState()).filter(view => view.visible && view.url?.startsWith('http:')).length, 0,
      'a failed redirect shows an error instead of an unrelated old page');
  } else assert.equal((await list()).tabs[0].url, webPage.url(), 'aborted redirects retain the actual committed address');
  await page.evaluate(({ first, url }) => window.desktop.browserAction(first, 'navigate', url), { first, url });
  await waitForBrowserFixtureSnapshot(page, snapshot => snapshot.tabs[0]?.title === '项目预览', 'the restored page title');
  const ease = await panel.evaluate(element => getComputedStyle(element).transitionTimingFunction);
  assert.ok(ease.includes('cubic-bezier(0.22, 1, 0.36, 1)'));
  async function screenshot(name) {
    await page.mouse.move(800, 25);
    await settleLayout(page.locator('.app'));
    await panel.locator('.right-panel-header').screenshot({ path: `test-results/browser-header-${name}.png` });
    const shellImage = await page.screenshot({ path: `test-results/browser-shell-${name}.png` });
    // capturePage is the actual native web page, independent of the React shell.
    const data = await app.evaluate(async ({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0];
      const native = window.contentView.children.find(view => view.webContents?.getURL().startsWith('http:') && view.getVisible());
      const image = await native.webContents.capturePage();
      return { image: image.toPNG().toString('base64'), bounds: native.getBounds() };
    });
    await writeFile(`test-results/browser-web-${name}.png`, Buffer.from(data.image, 'base64'));
    // Playwright captures each WebContents separately. Composite those real
    // captures at the measured native bounds, retaining both originals.
    const combined = await page.evaluate(async ({ shellImage, data }) => {
      const load = src => new Promise((resolve, reject) => {
        const image = new Image(); image.onload = () => resolve(image); image.onerror = reject; image.src = src;
      });
      const base = await load(`data:image/png;base64,${shellImage}`);
      const web = await load(`data:image/png;base64,${data.image}`);
      const canvas = document.createElement('canvas');
      canvas.width = base.naturalWidth; canvas.height = base.naturalHeight;
      const context = canvas.getContext('2d');
      context.drawImage(base, 0, 0);
      const scale = base.naturalWidth / innerWidth;
      context.drawImage(web, Math.round(data.bounds.x * scale), Math.round(data.bounds.y * scale),
        Math.round(data.bounds.width * scale), Math.round(data.bounds.height * scale));
      return canvas.toDataURL('image/png').split(',')[1];
    }, { shellImage: shellImage.toString('base64'), data });
    await writeFile(`test-results/browser-composite-${name}.png`, Buffer.from(combined, 'base64'));
  }
  await screenshot('light');
  const initialWidth = (await panel.boundingBox()).width;
  const widthControl = panel.getByRole('button', { name: '浏览器宽度', exact: true });
  await app.evaluate(({ Menu }) => {
    globalThis.browserWidthMenuFixture = { choice: undefined, hold: false, menus: [], pending: undefined };
    Menu.prototype.popup = function (options) {
      const fixture = globalThis.browserWidthMenuFixture;
      fixture.menus.push({ items: this.items.map(item => ({ label: item.label, checked: item.checked, type: item.type })),
        x: options.x, y: options.y });
      const finish = () => {
        const item = this.items.find(item => item.label === fixture.choice);
        if (item) item.click();
        options.callback?.();
        fixture.pending = undefined;
      };
      if (fixture.hold) fixture.pending = finish;
      else finish();
    };
  });
  const chooseWidth = async value => {
    await app.evaluate((_, choice) => {
      globalThis.browserWidthMenuFixture.choice = choice;
      globalThis.browserWidthMenuFixture.hold = false;
    }, { standard: '标准', wide: '宽幅', fullscreen: '全屏' }[value]);
    await widthControl.click();
    await page.waitForFunction(() => document.querySelector('#browser-panel .right-panel-width-control').getAttribute('aria-expanded') === 'false');
  };
  const controlBounds = await widthControl.boundingBox();
  const expandBounds = await panel.getByRole('button', { name: '全屏查看', exact: true }).boundingBox();
  assert.ok(Math.abs(controlBounds.y + controlBounds.height / 2 - expandBounds.y - expandBounds.height / 2) < 2,
    'width selector aligns with the header icon buttons');
  assert.equal(await widthControl.getAttribute('data-width'), 'standard');
  assert.equal(await panel.locator('.right-panel-width-chevron svg path').getAttribute('d'), 'M3.5 5.25 7 8.75 10.5 5.25');
  const layoutIcon = await panel.locator('.right-panel-width-icon').boundingBox();
  assert.ok(layoutIcon.x >= controlBounds.x && layoutIcon.x + layoutIcon.width <= controlBounds.x + controlBounds.width,
    'layout icon is inside the same menu-button hit area');
  assert.ok(controlBounds.width <= 84, 'Chinese labels use a compact control');
  await webPage.getByRole('textbox').fill('宽度交互保留输入');
  await app.evaluate(() => { globalThis.browserWidthMenuFixture.hold = true; });
  await page.mouse.click(layoutIcon.x + layoutIcon.width / 2, layoutIcon.y + layoutIcon.height / 2);
  await page.waitForFunction(() => document.querySelector('#browser-panel .right-panel-width-control').getAttribute('aria-expanded') === 'true');
  for (let index = 0; index < 5; index++) {
    await page.waitForTimeout(60);
    assert.ok((await viewState()).some(view => view.visible && view.url === url),
      'the native page stays visible throughout width-menu interaction');
  }
  assert.equal(await webPage.getByRole('textbox').inputValue(), '宽度交互保留输入', 'menu opening does not reload the page');
  await screenshot('menu-open');
  await app.evaluate(() => globalThis.browserWidthMenuFixture.pending());
  await page.waitForTimeout(100);
  assert.equal(await rail.getAttribute('aria-pressed'), 'true', 'native-menu cancellation does not close the panel');
  assert.equal(await widthControl.getAttribute('data-width'), 'standard', 'cancellation leaves the width unchanged');
  assert.ok((await viewState()).some(view => view.visible && view.url === url));
  const widthMenus = await app.evaluate(() => globalThis.browserWidthMenuFixture.menus);
  assert.deepEqual(widthMenus[0].items, [
    { label: '标准', checked: true, type: 'radio' },
    { label: '宽幅', checked: false, type: 'radio' },
    { label: '全屏', checked: false, type: 'radio' },
  ]);
  await assert.rejects(page.evaluate(() => window.desktop.rightPanelWidthMenu('invalid', { x: 0, y: 0 })));
  await assert.rejects(page.evaluate(() => window.desktop.rightPanelWidthMenu('standard', { x: null, y: 0 })));
  const widthMotion = async (mode, action) => sampleMotion(page, {
    label: `Browser ${mode}`,
    state: { selector: '#browser-panel .right-panel-width-control', attribute: 'data-width', value: mode },
    targets: [
      { name: 'track', selector: '.browser-track', properties: mode === 'wide' ? ['flex-basis'] : [] },
      { name: 'panel', selector: '#browser-panel', properties: ['width'] },
      { name: 'main', selector: 'main' },
    ],
    duration: 260, easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
  }, action);
  const wideSample = await widthMotion('wide', () => chooseWidth('wide'));
  const wideFrames = wideSample.frames.map(frame => frame.panel.width);
  await settleLayout(page.locator('.app'));
  const wideWidth = (await panel.boundingBox()).width;
  assert.ok(wideWidth > initialWidth + 30, 'wide mode adds real webpage space');
  assert.ok(wideFrames.some(width => width > initialWidth + 1 && width < wideWidth - 1), 'wide mode animates intermediate widths');
  assert.equal(await page.locator('.main-content').evaluate(element => element.inert), false, 'wide mode retains conversation interaction');
  assert.ok((await page.locator('main').boundingBox()).width >= 480, 'wide mode leaves a readable conversation');
  await screenshot('wide');
  let wideNative = (await viewState()).find(view => view.url === url && view.visible);
  const wideHost = await panel.locator('.browser-page').boundingBox();
  assert.ok(Math.abs(wideNative.bounds.x - wideHost.x) < 2 && Math.abs(wideNative.bounds.width - wideHost.width) < 2);
  const expandedSample = await widthMotion('fullscreen', () => panel.getByRole('button', { name: '全屏查看', exact: true }).click());
  const frames = expandedSample.frames.map(frame => frame.panel.width);
  await settleLayout(page.locator('.app'));
  assert.ok(frames.some(width => width > wideWidth + 1 && width < frames.at(-1) - 1));
  assert.equal(await widthControl.getAttribute('data-width'), 'fullscreen');
  assert.equal(await page.locator('.main-content').evaluate(element => element.inert), true);
  await screenshot('expanded');
  let native = (await viewState()).find(view => view.url === url && view.visible);
  const host = await panel.locator('.browser-page').boundingBox();
  assert.ok(Math.abs(native.bounds.x - host.x) < 2 && Math.abs(native.bounds.width - host.width) < 2);
  await panel.getByRole('button', { name: '还原侧栏', exact: true }).click();
  await settleLayout(page.locator('.app'));
  assert.equal(await widthControl.getAttribute('data-width'), 'wide');
  assert.ok(Math.abs((await panel.boundingBox()).width - wideWidth) < 2, 'fullscreen restores the previous width');
  await chooseWidth('standard');
  await settleLayout(page.locator('.app'));
  const handle = page.getByRole('button', { name: '调整右栏宽度', exact: true });
  const grip = await handle.boundingBox();
  await page.mouse.move(grip.x + 4, grip.y + grip.height / 2);
  await page.mouse.down();
  await page.mouse.move(grip.x - 650, grip.y + grip.height / 2, { steps: 20 });
  await page.mouse.up();
  await settleLayout(page.locator('.app'));
  assert.equal(await widthControl.getAttribute('data-width'), 'fullscreen', 'browser drag crosses multiple sizes');
  await handle.click();
  const gripMenu = page.getByRole('menu', { name: '右栏宽度', exact: true });
  await gripMenu.waitFor();
  assert.equal((await viewState()).filter(view => view.visible).length, 0, 'native page yields to the grip menu');
  await gripMenu.getByRole('menuitemradio', { name: '标准', exact: true }).click();
  await settleLayout(page.locator('.app'));
  assert.equal(await widthControl.getAttribute('data-width'), 'standard');
  assert.ok((await viewState()).some(view => view.visible), 'native page returns after grip selection');
  assert.ok(Math.abs((await panel.boundingBox()).width - initialWidth) < 2);
  await chooseWidth('fullscreen');
  await page.waitForTimeout(300);
  assert.equal(await page.locator('.main-content').evaluate(element => element.inert), true);
  await chooseWidth('wide');
  await page.waitForTimeout(300);
  assert.equal(await page.locator('.main-content').evaluate(element => element.inert), false);
  await webPage.getByRole('link', { name: '新标签页打开', exact: true }).click();
  await waitForBrowserFixtureSnapshot(page, snapshot => snapshot.tabs.length === 2, 'the popup tab');
  const second = (await list()).activeId;
  assert.notEqual(second, first);
  await page.evaluate(id => window.desktop.browserSelect(id), first);
  await webPage.getByRole('textbox', { name: '测试输入' }).fill('保留在会话 A');
  const originalContext = (await list()).context;
  await selectSession('browser-b');
  assert.equal(await rail.getAttribute('aria-pressed'), 'false', 'B does not adopt A’s open panel');
  assert.deepEqual((await list()).tabs, [], 'two conversations in the same directory do not share browser tabs');
  await assert.rejects(page.evaluate(id => window.desktop.browserSelect(id), first), /Unknown browser tab/);
  await assert.rejects(page.evaluate(id => window.desktop.browserClose(id), second), /Unknown browser tab/);
  await assert.rejects(page.evaluate(({ url, context }) => window.desktop.browserOpenLink(url, context),
    { url, context: originalContext }), /Browser conversation changed/);
  await rail.click();
  const other = await waitForBrowserFixtureSnapshot(page, snapshot => snapshot.tabs.length === 1, 'B starts with a blank tab');
  assert.ok(other.tabs.every(tab => tab.id !== first && tab.id !== second));
  await page.evaluate(url => window.desktop.browserOpenLink(url), `${url}details`);
  const otherPage = await waitForBrowserFixtureSnapshot(page, snapshot =>
    snapshot.tabs.some(tab => tab.id === snapshot.activeId && tab.url === `${url}details` && !tab.loading), 'B opens the same URL in its own tab');
  const otherPageId = otherPage.activeId;
  assert.notEqual(otherPageId, second, 'opening the same URL never reuses A’s tab');
  await page.evaluate(context => window.desktop.browserLayout(null, context), originalContext);
  assert.ok((await viewState()).some(view => view.visible && view.url === `${url}details`), 'A’s stale layout cannot hide B');
  await app.evaluate(async ({ webContents }, id) => {
    await webContents.fromId(id).executeJavaScript("window.open('/background', '_blank'); void 0");
  }, originalPageId);
  assert.deepEqual((await list()).tabs.map(tab => tab.id), [other.activeId, otherPageId], 'a background popup does not enter B');
  assert.equal((await list()).activeId, otherPageId, 'a background popup does not steal selection');
  await selectSession('browser-a');
  const background = await waitForBrowserFixtureSnapshot(page, snapshot =>
    snapshot.tabs.some(tab => tab.url === `${url}background`), 'the hidden popup stays with A');
  assert.equal(background.activeId, first);
  await page.evaluate(id => window.desktop.browserClose(id), background.tabs.find(tab => tab.url === `${url}background`).id);
  assert.equal(await nativePageId(), originalPageId, 'returning to A does not recreate its native page');
  assert.equal(await webPage.getByRole('textbox', { name: '测试输入' }).inputValue(), '保留在会话 A',
    'returning to A retains unsaved in-page input rather than reloading');
  await selectSession('browser-b');
  assert.equal(await rail.getAttribute('aria-pressed'), 'true', 'B restores its open browser');
  assert.equal((await list()).activeId, otherPageId, 'B restores its own selection');
  await panel.getByRole('button', { name: '关闭浏览器面板', exact: true }).click();
  await selectSession('browser-a');
  assert.equal(await rail.getAttribute('aria-pressed'), 'true', 'closing in B does not close A');
  assert.deepEqual((await list()).tabs.map(tab => tab.id), [first, second]);
  await selectSession('browser-b');
  assert.equal(await rail.getAttribute('aria-pressed'), 'false', 'B restores its explicit closure');
  assert.equal((await list()).activeId, otherPageId, 'panel closure retains B’s selection');
  for (const tab of (await list()).tabs) await page.evaluate(id => window.desktop.browserClose(id), tab.id);
  await selectSession('browser-a');
  await page.waitForTimeout(100);
  assert.equal((await viewState()).filter(view => view.visible && view.url?.startsWith('http:')).length, 1);
  await page.locator('.right-tool-rail').getByRole('button', { name: '上下文', exact: true }).click();
  await page.waitForTimeout(300);
  const contextWidthControl = page.locator('.context-region').getByRole('button', { name: '上下文宽度', exact: true });
  assert.equal(await contextWidthControl.getAttribute('data-width'), 'standard',
    'context starts at its own standard width rather than inheriting the browser width');
  assert.equal((await viewState()).filter(view => view.visible && view.url?.startsWith('http:')).length, 0);
  for (const [label, value] of [['宽幅', 'wide'], ['全屏', 'fullscreen'], ['标准', 'standard']]) {
    await contextWidthControl.click();
    const menu = page.getByRole('menu', { name: '上下文宽度', exact: true });
    await menu.getByRole('menuitemradio', { name: label, exact: true }).click();
    await page.waitForFunction(value =>
      document.querySelector('.context-region .right-panel-width-control')?.getAttribute('data-width') === value, value);
    assert.equal((await viewState()).filter(view => view.visible && view.url?.startsWith('http:')).length, 0,
      'context width changes must not reveal the inactive native browser');
  }
  await rail.click();
  await page.waitForTimeout(300);
  assert.equal(await widthControl.getAttribute('data-width'), 'wide', 'browser width survives independent context width changes');
  assert.equal(await page.locator('.main-content').evaluate(element => element.inert), false,
    'context fullscreen does not leave the browser wide view fullscreen');
  assert.ok((await viewState()).some(view => view.visible && view.url === url));
  for (const mode of ['wide', 'standard']) {
    await chooseWidth(mode);
    await settleLayout(page.locator('.app'));
    const before = await page.evaluate(() => ({
      basis: parseFloat(getComputedStyle(document.querySelector('.browser-track')).flexBasis),
      main: document.querySelector('main').getBoundingClientRect().width,
    }));
    const closeSample = await sampleMotion(page, {
      label: `Browser ${mode} close`, state: { selector: '.browser-track.is-closing' },
      targets: [
        { name: 'track', selector: '.browser-track', properties: ['flex-basis'] },
        { name: 'panel', selector: '#browser-panel', properties: ['opacity'] },
        { name: 'main', selector: 'main' },
      ],
      duration: 260, easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
    }, () => rail.click());
    assert.equal((await viewState()).filter(view => view.visible && view.url?.startsWith('http:')).length, 0,
      'closing hides the opaque native page at the start of the shell fade');
    const closeFrames = closeSample.frames.map(frame => ({ basis: frame.track.basis,
      main: frame.main.width, opacity: frame.panel.opacity }));
    await settleLayout(page.locator('.app'));
    const final = closeFrames.at(-1);
    assert.ok(before.basis > 1 && final.basis < 1, `${mode} closes the layout reservation completely`);
    assert.ok(closeFrames.some(frame => frame.basis > 1 && frame.basis < before.basis - 1),
      `${mode} animates intermediate layout reservations on close`);
    assert.ok(closeFrames.some(frame => frame.main > before.main + 1 && frame.main < final.main - 1),
      `${mode} returns the conversation smoothly instead of snapping`);
    assert.ok(Math.abs(final.main - before.main - before.basis) < 2,
      `${mode} restores all reserved conversation space`);
    assert.ok(closeFrames.some(frame => frame.opacity > 0 && frame.opacity < 1),
      'the browser shell fades alongside the conversation layout');
    assert.equal((await viewState()).filter(view => view.visible && view.url?.startsWith('http:')).length, 0,
      'the native page stays hidden after the shell exits');
    await rail.click();
    await page.waitForTimeout(300);
  }
  await page.waitForTimeout(300);
  assert.ok((await viewState()).some(view => view.visible && view.url === url));
  await page.locator('.sidebar-settings').click();
  await page.waitForTimeout(100);
  assert.equal((await viewState()).filter(view => view.visible && view.url?.startsWith('http:')).length, 0, 'settings hides the native surface');
  await page.locator('.settings-dialog > header').getByRole('button', { name: /^(?:Close|\u5173\u95ed)$/u }).click();
  await page.locator('.settings-backdrop').waitFor({ state: 'detached' });
  await assert.doesNotReject(async () => {
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      if ((await viewState()).some(view => view.visible && view.url === url)) return;
      await page.waitForTimeout(25);
    }
    throw new Error('Native browser did not return after settings dismissal');
  });
  assert.ok((await viewState()).some(view => view.visible && view.url === url));
  await page.getByRole('button', { name: process.platform === 'darwin' ? '应用菜单' : '文件', exact: true }).click();
  await page.waitForTimeout(100);
  assert.equal((await viewState()).filter(view => view.visible && view.url?.startsWith('http:')).length, 0);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(100);
  assert.ok((await viewState()).some(view => view.visible && view.url === url));
  await page.evaluate(() => window.desktop.preferences({ theme: 'dark' }));
  await page.reload();
  await page.getByText('Step Code 已连接', { exact: true }).waitFor({ state: 'attached', timeout: 60000 });
  await rail.click();
  await page.waitForTimeout(300);
  assert.equal((await list()).tabs.length, 2, 'renderer reload does not leak or destroy tabs');
  await screenshot('dark');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(640, 720));
  await settleLayout(page.locator('.app'));
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  native = (await viewState()).find(view => view.visible && view.url === url);
  const size = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
  assert.ok(native.bounds.x >= 0 && native.bounds.x + native.bounds.width <= size.width);
  assert.ok(native.bounds.y >= 0 && native.bounds.y + native.bounds.height <= size.height);
  await screenshot('narrow');
  const narrowWidth = (await panel.boundingBox()).width;
  await chooseWidth('wide');
  await settleLayout(page.locator('.app'));
  assert.ok(Math.abs((await panel.boundingBox()).width - narrowWidth) < 2, 'narrow windows converge standard and wide');
  await screenshot('narrow-wide');
  await chooseWidth('fullscreen');
  await page.waitForTimeout(300);
  await panel.getByRole('button', { name: '还原侧栏', exact: true }).click();
  await settleLayout(page.locator('.app'));
  assert.equal(await widthControl.getAttribute('data-width'), 'wide');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.evaluate(({ first, url }) => window.desktop.browserAction(first, 'navigate', `${url}fail`), { first, url });
  await waitForBrowserFixtureSnapshot(page, snapshot => snapshot.tabs[0]?.error, 'the failed page');
  await panel.getByText('网页无法加载', { exact: true }).waitFor();
  assert.equal((await viewState()).filter(view => view.visible && view.url?.startsWith('http:')).length, 0);
  await page.evaluate(({ first, url }) => window.desktop.browserAction(first, 'navigate', url), { first, url });
  await waitForBrowserFixtureSnapshot(page, snapshot => snapshot.tabs[0]?.title === '项目预览', 'the retried page title');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1706, 1066));
  await page.reload();
  await page.getByText('Step Code 已连接', { exact: true }).waitFor({ state: 'attached', timeout: 60000 });
  await rail.click();
  for (let i = (await list()).tabs.length; i < 12; i++) await page.evaluate(() => window.desktop.browserCreate());
  await assert.rejects(page.evaluate(() => window.desktop.browserCreate()), /limit/);
  await selectSession('browser-c');
  await rail.click();
  await panel.getByText('已达标签页上限，请先关闭其他标签页', { exact: true }).waitFor({ state: 'visible' });
  assert.equal((await list()).canCreate, false, 'the limit counts other conversations without showing their tabs');
  assert.equal((await list()).tabs.length, 0);
  await selectSession('browser-a');
  for (const tab of (await list()).tabs) await page.evaluate(id => window.desktop.browserClose(id), tab.id);
  await page.waitForTimeout(200);
  assert.equal((await list()).tabs.length, 0);
  assert.equal((await viewState()).filter(view => view.url?.startsWith('http:')).length, 0);
  assert.equal(await app.evaluate(({ webContents }) => webContents.getAllWebContents().some(view => view.getURL().startsWith('http://127.0.0.1:'))), false);
  assert.equal(await app.evaluate(({ webContents }) => webContents.getAllWebContents().length), 1, 'blank tabs are also truly released');
  await rail.click(); await rail.click();
  assert.equal((await list()).tabs.length, 0, 'closing the last tab does not silently create another');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  assert.equal(await panel.evaluate(element => getComputedStyle(element).transitionDuration), '0s');
  await page.locator('.new-chat').click();
  const draft = await waitForBrowserFixtureSnapshot(page, snapshot => snapshot.owner.startsWith('draft:'), 'a new proposal owns its browser');
  assert.deepEqual(draft.tabs, []);
  await rail.click();
  await page.evaluate(url => window.desktop.browserOpenLink(url), `${url}draft`);
  const draftPage = await waitForBrowserFixtureSnapshot(page, snapshot =>
    snapshot.tabs.some(tab => tab.id === snapshot.activeId && tab.url === `${url}draft` && !tab.loading), 'the proposal page');
  const draftPageId = await app.evaluate(({ webContents }, url) =>
    webContents.getAllWebContents().find(contents => contents.getURL() === url)?.id, `${url}draft`);
  assert.ok(draftPageId);
  await selectSession('browser-a');
  assert.deepEqual((await list()).tabs, [], 'proposal pages do not enter an existing conversation');
  await page.locator('.new-chat').click();
  const resumed = await waitForBrowserFixtureSnapshot(page, snapshot => snapshot.owner === draft.owner, 'the same parked proposal');
  assert.equal(resumed.activeId, draftPage.activeId);
  await panel.getByRole('tab', { selected: true }).waitFor();
  const created = await page.evaluate(id => window.desktop.createDraftSession(id), draft.owner.slice('draft:'.length));
  assert.ok(created.state?.sessionId);
  const promoted = await waitForBrowserFixtureSnapshot(page, snapshot =>
    snapshot.owner === `session:${created.state.sessionId}`, 'the promoted proposal browser');
  assert.deepEqual(promoted.tabs.map(tab => tab.id), draftPage.tabs.map(tab => tab.id));
  assert.equal(promoted.activeId, draftPage.activeId, 'first creation transfers the original tab selection');
  await panel.getByRole('tab', { selected: true }).waitFor();
  assert.equal(await app.evaluate(({ webContents }, id) => webContents.fromId(id)?.isDestroyed(), draftPageId), false,
    'first creation keeps the native proposal page');
  assert.deepEqual(errors, []);
  await app.close(); closed = true;
  console.log(JSON.stringify({ profile, isolation, context, permission, screenshots: 'test-results/browser-*.png',
    checks: 'navigation, same-directory tab isolation, per-conversation panel and selection restore, live page retention, draft promotion, stale IPC, scoped popup tabs, editable input, image loading, scroll, zoom, reload restore, modal/native layering, cubic expansion, narrow bounds, error/retry, protocol guards, global tab limit and real WebContents cleanup' }, null, 2));
} catch (error) {
  console.error('Browser fixture failed:', error);
  const diagnostic = {
    packaged: Boolean(executablePath),
    rendererErrors: errors,
    native: await app.evaluate(({ BrowserWindow, webContents }) => ({
      lifecycle: globalThis.browserFixtureLifecycle,
      contents: webContents.getAllWebContents().map(contents => ({
        id: contents.id, type: contents.getType(), url: contents.getURL(), loading: contents.isLoading(),
      })),
      windows: BrowserWindow.getAllWindows().map(window => ({
        id: window.id, visible: window.isVisible(), views: window.contentView.children.map(view => ({
          destroyed: view.webContents?.isDestroyed(), visible: view.getVisible(), bounds: view.getBounds(),
          url: view.webContents && !view.webContents.isDestroyed() ? view.webContents.getURL() : undefined,
        })),
      })),
    })).catch(() => ({ unavailable: true })),
  };
  const page = app.windows().find(value => !value.isClosed() && value.url().startsWith('file:'));
  diagnostic.tabs = await page?.evaluate(() => window.desktop.browserList()).catch(() => undefined);
  await page?.screenshot({ path: 'test-results/browser-failure.png' }).catch(() => {});
  console.error('Browser fixture diagnostic:', JSON.stringify(diagnostic));
  await writeFile('test-results/browser-failure.json', JSON.stringify(diagnostic, null, 2) + '\n').catch(() => {});
  throw error;
} finally {
  if (!closed) await app.close().catch(() => {});
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}
