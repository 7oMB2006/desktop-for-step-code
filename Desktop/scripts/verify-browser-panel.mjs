import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
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
await mkdir('test-results', { recursive: true });
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
  page.setDefaultTimeout(15000);
  page.on('pageerror', error => errors.push(error.message));
  await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    window.setOpacity(0); window.setIgnoreMouseEvents(true); window.showInactive(); window.setSize(1706, 1066);
  });
  await page.getByText('Step Code 已连接', { exact: true }).waitFor({ state: 'attached', timeout: 60000 });
  const rail = page.locator('.right-tool-rail').getByRole('button', { name: '浏览器', exact: true });
  const panel = page.locator('#browser-panel');
  const list = () => page.evaluate(() => window.desktop.browserList());
  const viewState = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].contentView.children.map(view =>
    ({ url: view.webContents?.getURL(), visible: view.getVisible(), bounds: view.getBounds() })));
  await rail.click();
  await page.waitForFunction(async () => (await window.desktop.browserList()).tabs.length === 1);
  const first = (await list()).tabs[0].id;
  await panel.getByRole('textbox', { name: '网页地址', exact: true }).fill(`127.0.0.1:${port}`);
  await page.keyboard.press('Enter');
  await page.waitForFunction(async () => (await window.desktop.browserList()).tabs[0].title === '项目预览');
  await page.waitForTimeout(300);
  const standardPageBounds = await panel.locator('.browser-page').boundingBox();
  const conversationBounds = await page.locator('.composer').boundingBox();
  assert.ok(conversationBounds && conversationBounds.x + conversationBounds.width <= standardPageBounds.x + 1,
    'the standard native browser does not overlap the conversation composer');
  // Native navigation/title events can precede Playwright's target attachment.
  let webPage;
  await assert.doesNotReject(async () => {
    await page.waitForFunction(async () => {
      const tab = (await window.desktop.browserList()).tabs[0];
      return tab?.title === '项目预览' && !tab.loading;
    });
    const deadline = Date.now() + 15000;
    while (!(webPage = app.windows().find(value => value.url().startsWith(url)))) {
      if (Date.now() >= deadline) throw new Error('native WebContentsView exposes a real page');
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
    view.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'L', modifiers: ['control'] });
    view.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'L', modifiers: ['control'] });
  });
  await page.waitForFunction(() => document.activeElement === document.querySelector('.browser-address-field input'), undefined, { timeout: 5000 });
  await panel.getByRole('textbox', { name: '网页地址', exact: true }).press('Escape');
  assert.equal(await rail.getAttribute('aria-pressed'), 'true', 'Escape in the URL input does not close the panel');
  await webPage.getByRole('link', { name: '查看项目详情', exact: true }).click();
  await page.waitForFunction(async () => (await window.desktop.browserList()).tabs[0].canGoBack);
  await panel.getByRole('button', { name: '后退', exact: true }).click();
  await webPage.waitForURL(url);
  await page.waitForFunction(async () => (await window.desktop.browserList()).tabs[0].canGoForward);
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
  await page.waitForFunction(async () => !(await window.desktop.browserList()).tabs[0].loading);
  assert.ok(!webPage.url().startsWith('file:'), 'redirects cannot enter the local filesystem');
  if ((await list()).tabs[0].error) {
    assert.equal((await viewState()).filter(view => view.visible && view.url?.startsWith('http:')).length, 0,
      'a failed redirect shows an error instead of an unrelated old page');
  } else assert.equal((await list()).tabs[0].url, webPage.url(), 'aborted redirects retain the actual committed address');
  await page.evaluate(({ first, url }) => window.desktop.browserAction(first, 'navigate', url), { first, url });
  await page.waitForFunction(async () => (await window.desktop.browserList()).tabs[0].title === '项目预览');
  const ease = await panel.evaluate(element => getComputedStyle(element).transitionTimingFunction);
  assert.ok(ease.includes('cubic-bezier(0.22, 1, 0.36, 1)'));
  async function screenshot(name) {
    await page.mouse.move(800, 25);
    await page.waitForTimeout(300);
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
  await chooseWidth('wide');
  const wideFrames = await panel.evaluate(async element => {
    const values = [];
    const start = performance.now();
    while (performance.now() - start < 340) {
      await new Promise(resolve => requestAnimationFrame(resolve));
      values.push(element.getBoundingClientRect().width);
    }
    return values;
  });
  const wideWidth = (await panel.boundingBox()).width;
  assert.ok(wideWidth > initialWidth + 30, 'wide mode adds real webpage space');
  assert.ok(wideFrames.some(width => width > initialWidth + 1 && width < wideWidth - 1), 'wide mode animates intermediate widths');
  assert.equal(await page.locator('main').evaluate(element => element.inert), false, 'wide mode retains conversation interaction');
  assert.ok((await page.locator('main').boundingBox()).width >= 480, 'wide mode leaves a readable conversation');
  await screenshot('wide');
  let wideNative = (await viewState()).find(view => view.url === url && view.visible);
  const wideHost = await panel.locator('.browser-page').boundingBox();
  assert.ok(Math.abs(wideNative.bounds.x - wideHost.x) < 2 && Math.abs(wideNative.bounds.width - wideHost.width) < 2);
  await panel.getByRole('button', { name: '全屏查看', exact: true }).click();
  const frames = await panel.evaluate(async element => {
    const values = [];
    const start = performance.now();
    while (performance.now() - start < 340) {
      await new Promise(resolve => requestAnimationFrame(resolve));
      values.push(element.getBoundingClientRect().width);
    }
    return values;
  });
  assert.ok(frames.some(width => width > wideWidth + 1 && width < frames.at(-1) - 1));
  assert.equal(await widthControl.getAttribute('data-width'), 'fullscreen');
  assert.equal(await page.locator('main').evaluate(element => element.inert), true);
  await screenshot('expanded');
  let native = (await viewState()).find(view => view.url === url && view.visible);
  const host = await panel.locator('.browser-page').boundingBox();
  assert.ok(Math.abs(native.bounds.x - host.x) < 2 && Math.abs(native.bounds.width - host.width) < 2);
  await panel.getByRole('button', { name: '还原侧栏', exact: true }).click();
  await page.waitForTimeout(300);
  assert.equal(await widthControl.getAttribute('data-width'), 'wide');
  assert.ok(Math.abs((await panel.boundingBox()).width - wideWidth) < 2, 'fullscreen restores the previous width');
  await chooseWidth('standard');
  await page.waitForTimeout(300);
  assert.ok(Math.abs((await panel.boundingBox()).width - initialWidth) < 2);
  await chooseWidth('fullscreen');
  await page.waitForTimeout(300);
  assert.equal(await page.locator('main').evaluate(element => element.inert), true);
  await chooseWidth('wide');
  await page.waitForTimeout(300);
  assert.equal(await page.locator('main').evaluate(element => element.inert), false);
  await webPage.getByRole('link', { name: '新标签页打开', exact: true }).click();
  await page.waitForFunction(async () => (await window.desktop.browserList()).tabs.length === 2);
  const second = (await list()).activeId;
  assert.notEqual(second, first);
  await page.evaluate(id => window.desktop.browserSelect(id), first);
  await page.waitForTimeout(100);
  assert.equal((await viewState()).filter(view => view.visible && view.url?.startsWith('http:')).length, 1);
  await page.locator('.right-tool-rail').getByRole('button', { name: '上下文', exact: true }).click();
  await page.waitForTimeout(300);
  assert.equal(await page.locator('.context-region .right-panel-width-control').count(), 0, 'browser width controls do not affect other panels');
  assert.equal((await viewState()).filter(view => view.visible && view.url?.startsWith('http:')).length, 0);
  await rail.click();
  await page.waitForTimeout(300);
  assert.equal(await widthControl.getAttribute('data-width'), 'wide', 'browser width survives panel switching');
  assert.ok((await viewState()).some(view => view.visible && view.url === url));
  await rail.click();
  assert.equal((await viewState()).filter(view => view.visible && view.url?.startsWith('http:')).length, 0,
    'closing hides the opaque native page at the start of the shell fade');
  const closeFrames = await page.evaluate(async () => {
    const track = document.querySelector('.browser-track');
    const frames = [];
    const start = performance.now();
    while (performance.now() - start < 180) {
      await new Promise(resolve => requestAnimationFrame(resolve));
      const style = getComputedStyle(track);
      frames.push({ basis: parseFloat(style.flexBasis), duration: style.transitionDuration,
        opacity: getComputedStyle(document.querySelector('.browser-panel')).opacity });
    }
    return frames;
  });
  assert.ok(closeFrames.length > 2 && closeFrames.every(frame => frame.basis < 1 && frame.duration === '0s'),
    'closing releases the conversation layout in one reflow');
  assert.ok(closeFrames.some(frame => Number(frame.opacity) > 0 && Number(frame.opacity) < 1),
    'the browser shell keeps its fade while the content layout is stable');
  await page.waitForTimeout(150);
  assert.equal((await viewState()).filter(view => view.visible && view.url?.startsWith('http:')).length, 0,
    'the native page stays hidden after the shell exits');
  await rail.click();
  await page.waitForTimeout(300);
  assert.ok((await viewState()).some(view => view.visible && view.url === url));
  await page.locator('.sidebar-bottom button').click();
  await page.waitForTimeout(100);
  assert.equal((await viewState()).filter(view => view.visible && view.url?.startsWith('http:')).length, 0, 'settings hides the native surface');
  await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click();
  await page.waitForTimeout(100);
  assert.ok((await viewState()).some(view => view.visible && view.url === url));
  await page.locator('.window-menu-list').getByRole('button', { name: '文件', exact: true }).click();
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
  await page.waitForTimeout(400);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  native = (await viewState()).find(view => view.visible && view.url === url);
  const size = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
  assert.ok(native.bounds.x >= 0 && native.bounds.x + native.bounds.width <= size.width);
  assert.ok(native.bounds.y >= 0 && native.bounds.y + native.bounds.height <= size.height);
  await screenshot('narrow');
  const narrowWidth = (await panel.boundingBox()).width;
  await chooseWidth('wide');
  await page.waitForTimeout(300);
  assert.ok(Math.abs((await panel.boundingBox()).width - narrowWidth) < 2, 'narrow windows converge standard and wide');
  await screenshot('narrow-wide');
  await chooseWidth('fullscreen');
  await page.waitForTimeout(300);
  await panel.getByRole('button', { name: '还原侧栏', exact: true }).click();
  await page.waitForTimeout(300);
  assert.equal(await widthControl.getAttribute('data-width'), 'wide');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.evaluate(({ first, url }) => window.desktop.browserAction(first, 'navigate', `${url}fail`), { first, url });
  await page.waitForFunction(async () => (await window.desktop.browserList()).tabs[0].error);
  await panel.getByText('网页无法加载', { exact: true }).waitFor();
  assert.equal((await viewState()).filter(view => view.visible && view.url?.startsWith('http:')).length, 0);
  await page.evaluate(({ first, url }) => window.desktop.browserAction(first, 'navigate', url), { first, url });
  await page.waitForFunction(async () => (await window.desktop.browserList()).tabs[0].title === '项目预览');
  await page.reload();
  await page.getByText('Step Code 已连接', { exact: true }).waitFor({ state: 'attached', timeout: 60000 });
  await rail.click();
  for (let i = (await list()).tabs.length; i < 12; i++) await page.evaluate(() => window.desktop.browserCreate());
  await assert.rejects(page.evaluate(() => window.desktop.browserCreate()), /limit/);
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
  assert.deepEqual(errors, []);
  await app.close(); closed = true;
  console.log(JSON.stringify({ profile, isolation, context, permission, screenshots: 'test-results/browser-*.png',
    checks: 'navigation, editable input, image loading, scroll, zoom, popup tabs, reload restore, modal/native layering, cubic expansion, narrow bounds, error/retry, protocol guards, tab limit and real WebContents cleanup' }, null, 2));
} finally {
  if (!closed) await app.close().catch(() => {});
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}
