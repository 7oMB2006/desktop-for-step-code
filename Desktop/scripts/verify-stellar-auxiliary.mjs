import assert from 'node:assert/strict';
import { mkdir, readFile, symlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { build } from 'esbuild';
import { createServer, preview } from 'vite';
import { _electron as electron, chromium } from 'playwright';
import { mkdtemp } from './test-profile.mjs';

const output = resolve(process.argv[2] || 'test-results/stellar-auxiliary');
await mkdir(output, { recursive: true });
const fixture = await mkdtemp(join(output, 'native-'));
const profile = join(fixture, 'profile');
await mkdir(profile);
await symlink(resolve('dist/renderer'), join(fixture, 'renderer'), process.platform === 'win32' ? 'junction' : 'dir');
await Promise.all([
  build({ entryPoints: ['tests/fixtures/stellar-auxiliary-native.ts'], outfile: join(fixture, 'main.cjs'),
    bundle: true, platform: 'node', format: 'cjs', external: ['electron'] }),
  build({ entryPoints: ['electron/preload.ts', 'electron/tray-preload.ts', 'electron/startup-preload.ts'], outdir: fixture,
    outExtension: { '.js': '.cjs' }, bundle: true, platform: 'node', format: 'cjs', external: ['electron'] }),
]);
const server = await preview({ configFile: false, base: './', build: { outDir: 'dist/renderer' },
  preview: { host: '127.0.0.1', port: 0, strictPort: false }, logLevel: 'error' });
const base = server.resolvedUrls.local[0];
const env = { ...process.env, DESKTOP_TEST_USER_DATA: profile, STELLAR_FIXTURE_DESKTOP: resolve('.'),
  STELLAR_FIXTURE_URL: base };
delete env.ELECTRON_RUN_AS_NODE;
let app;
const errors = [];
try {
  app = await electron.launch({ args: [join(fixture, 'main.cjs')], env, timeout: 60000 });
  await app.evaluate(async () => {
    for (let step = 0; step < 100 && !globalThis.stellarFixture; step++) await new Promise(resolve => setTimeout(resolve, 50));
    if (!globalThis.stellarFixture) throw new Error('Fixture not ready');
  });
  const call = (method, ...args) => app.evaluate((_, { method, args }) =>
    globalThis.stellarFixture[method](...args), { method, args });
  const nextWindow = async (method, ...args) => {
    const waiting = app.waitForEvent('window');
    await call(method, ...args);
    const page = await waiting;
    page.on('pageerror', error => errors.push(error.message));
    return page;
  };
  const popup = await nextWindow('openTray');
  await popup.waitForFunction(() => document.querySelector('.tray-menu')?.dataset.visible === 'true');
  assert.equal(await popup.evaluate(() => document.documentElement.dataset.themeMaterial), 'stellar');
  assert.equal(await popup.evaluate(() => document.documentElement.dataset.palette), 'plugin:stellar-cruise');
  assert.equal(await popup.evaluate(() => window.desktopTray.state().colors.tokens['--bg']), '#18191b');
  assert.equal(await popup.evaluate(() => typeof window.desktop), 'undefined');
  assert.equal(await popup.evaluate(() => typeof window.require), 'undefined');
  assert.deepEqual(await popup.getByRole('menuitem').allTextContents(), ['打开 Desktop for Step Code', '退出应用']);
  await popup.waitForFunction(() => getComputedStyle(document.querySelector('.tray-menu')).transform === 'none');
  const geometry = await popup.locator('.tray-menu').evaluate(menu => {
    const labels = [...menu.querySelectorAll('.app-menu-label')].map(label => ({
      scroll: label.scrollWidth, client: label.clientWidth,
    }));
    return { width: menu.getBoundingClientRect().width, height: menu.getBoundingClientRect().height, labels };
  });
  assert.ok(geometry.labels.every(label => label.scroll <= label.client), 'tray labels fit');
  assert.equal(await popup.locator('.tray-stars').evaluate(el => getComputedStyle(el).position), 'absolute');
  assert.equal(await popup.locator('.tray-stars').getAttribute('aria-hidden'), 'true');
  assert.equal(await popup.locator('.tray-stars').evaluate(el => getComputedStyle(el).pointerEvents), 'none');
  assert.equal(await popup.locator('.tray-stars > circle').count(), 120);
  assert.equal(await popup.locator('.tray-stars-light').first().evaluate(el => getComputedStyle(el).animationPlayState), 'running');
  await call('setTrayMotion', false);
  await popup.waitForFunction(() => getComputedStyle(document.querySelector('.tray-stars-light')).animationName === 'none');
  await popup.screenshot({ path: join(output, 'tray-stellar.png'), omitBackground: true });
  await call('setTrayMotion', true);
  await popup.waitForFunction(() => getComputedStyle(document.querySelector('.tray-stars-light')).animationPlayState === 'running');
  await popup.emulateMedia({ reducedMotion: 'reduce' });
  assert.equal(await popup.locator('.tray-stars-light').first().evaluate(el => getComputedStyle(el).animationName), 'none');
  await popup.emulateMedia({ reducedMotion: 'no-preference' });
  await popup.getByRole('menuitem').first().focus();
  await popup.keyboard.press('ArrowDown');
  assert.equal(await popup.getByRole('menuitem').last().evaluate(element => element === document.activeElement), true);
  await popup.keyboard.press('Enter');
  assert.equal((await call('stats')).quitActions, 1);
  await call('openTray');
  await popup.waitForFunction(() => document.querySelector('.tray-menu')?.dataset.visible === 'true');
  await popup.getByRole('menuitem').first().click();
  assert.equal((await call('stats')).openActions, 1);
  await call('setTheme', 'original-light');
  await call('openTray');
  await popup.waitForFunction(() => document.documentElement.dataset.palette === 'original-light');
  await popup.waitForFunction(() => getComputedStyle(document.querySelector('.tray-menu')).transform === 'none');
  assert.equal(await popup.evaluate(() => document.documentElement.dataset.themeMaterial), undefined);
  assert.equal(await popup.locator('.tray-stars').count(), 0, 'built-in menus do not include theme decoration');
  assert.equal(await popup.locator('.tray-menu').evaluate(menu => menu.getBoundingClientRect().width), geometry.width);
  assert.equal(await popup.locator('.tray-menu').evaluate(menu => menu.getBoundingClientRect().height), geometry.height);
  await popup.emulateMedia({ reducedMotion: 'reduce' });
  assert.ok(await popup.locator('.tray-menu').evaluate(menu =>
    getComputedStyle(menu).transitionDuration.split(',').every(value => value.trim() === '0s')));
  await popup.keyboard.press('Escape');
  await call('setTheme', 'plugin:stellar-cruise');
  const plugin = await nextWindow('openPlugin');
  await plugin.locator('.plugin-workspace-document h1').waitFor();
  assert.equal(await plugin.evaluate(() => document.documentElement.dataset.themeMaterial), 'stellar');
  assert.equal(await plugin.locator('.plugin-workspace').evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(24, 25, 27)');
  assert.equal(await plugin.evaluate(() => window.desktop.surface), 'plugin');
  await assert.rejects(plugin.evaluate(() => window.desktop.snapshot()), /capability:invalid-input/);
  await assert.rejects(plugin.evaluate(() => window.desktop.command('prompt', { message: 'must-not-run' })), /capability:invalid-input/);
  await plugin.getByRole('tab').first().focus();
  await plugin.keyboard.press('ArrowRight');
  await plugin.getByRole('heading', { name: '校对记录' }).waitFor();
  for (const [width, height] of [[920, 720], [390, 640]]) {
    await plugin.setViewportSize({ width, height });
    assert.equal(await plugin.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await plugin.screenshot({ path: join(output, `plugin-stellar-${width}.png`) });
  }
  await call('setTheme', 'original-light');
  await plugin.waitForFunction(() => document.documentElement.dataset.palette === 'original-light');
  assert.equal(await plugin.evaluate(() => document.documentElement.dataset.themeMaterial), undefined);
  await call('setTheme', 'plugin:stellar-cruise');
  await plugin.waitForFunction(() => document.documentElement.dataset.themeMaterial === 'stellar');
  await call('setTheme', 'plugin:stellar-cruise', false);
  await plugin.waitForFunction(() => document.documentElement.dataset.palette === 'dark');
  assert.equal(await plugin.evaluate(() => document.documentElement.dataset.themeMaterial), undefined);
  await call('setTheme', 'plugin:stellar-cruise');
  // Observe every pre-paint image state, including before the module has loaded.
  await app.context().addInitScript(() => {
    window.startupFrames = [];
    const record = () => {
      const logo = document.querySelector('.logo'), image = logo?.querySelector('img');
      if (image) window.startupFrames.push({
        at: performance.now(), material: document.documentElement.dataset.startupMaterial,
        imageVisible: getComputedStyle(image).visibility === 'visible',
        ready: logo.dataset.ready === 'true',
        complete: document.documentElement.dataset.startupComplete === 'true',
      });
      if (window.startupFrames.length < 200) requestAnimationFrame(record);
    };
    requestAnimationFrame(record);
  });
  let splash = await nextWindow('splash', true, false, true);
  await splash.waitForFunction(() => document.documentElement.dataset.startupMaterial === 'pending');
  await splash.waitForTimeout(150);
  assert.equal(await splash.locator('img').evaluate(img => getComputedStyle(img).visibility), 'hidden',
    'the early window must not flash the built-in artwork before preferences hydrate');
  await call('configureSplash');
  await splash.locator('.logo[data-ready=true]').waitFor();
  const security = await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows().find(window => window.webContents.getURL().includes('startup-logo.html'));
    const prefs = window.webContents.getLastWebPreferences();
    return { size: window.getSize(), focusable: window.isFocusable(), shadow: window.hasShadow(),
      node: prefs.nodeIntegration, sandbox: prefs.sandbox, isolation: prefs.contextIsolation, preload: prefs.preload };
  });
  assert.ok(Math.abs(security.size[0] - 360) <= 2 && security.size[1] <= 482);
  assert.deepEqual({ ...security, size: undefined }, { size: undefined, focusable: false, shadow: false,
    node: false, sandbox: true, isolation: true, preload: undefined });
  assert.deepEqual(await splash.evaluate(() => Object.keys(window.startupRecovery).sort()), ['command', 'subscribe']);
  assert.equal(await splash.evaluate(() => typeof window.require), 'undefined');
  assert.deepEqual(await splash.locator('img').evaluate(img => [img.offsetWidth, img.offsetHeight]), [88, 88]);
  assert.equal(await splash.evaluate(() => typeof window.desktop), 'undefined');
  const pixels = async () => splash.evaluate(async bytes => {
    const image = await createImageBitmap(new Blob([new Uint8Array(bytes)], { type: 'image/png' }));
    const copy = document.createElement('canvas'); copy.width = image.width; copy.height = image.height;
    const ctx = copy.getContext('2d'); ctx.drawImage(image, 0, 0); image.close();
    const data = ctx.getImageData(0, 0, copy.width, copy.height).data;
    let nonblank = 0, hash = 0;
    for (let i = 0; i < data.length; i++) {
      if (i % 4 === 3 && data[i] > 12) nonblank++;
      // The slow-start surface is opaque: alpha alone cannot measure motion.
      hash = (hash * 31 + data[i]) | 0;
    }
    return { nonblank, hash };
  }, [...await splash.locator('canvas').screenshot({ omitBackground: true })]);
  await splash.waitForFunction(() => document.documentElement.dataset.startupComplete === 'true');
  const firstFrames = await splash.evaluate(() => window.startupFrames);
  assert.ok(firstFrames.some(frame => frame.material === 'pending'));
  assert.ok(firstFrames.some(frame => frame.ready));
  assert.ok(firstFrames.every(frame => !frame.imageVisible), 'no ordinary logo in any recorded first frame');
  const firstComplete = firstFrames.find(frame => frame.complete);
  const firstStars = firstFrames.find(frame => frame.ready);
  if (firstComplete) assert.ok(firstComplete.at - firstStars.at >= 1950, 'assembly and settled hold are not cut short');
  const first = await pixels();
  await splash.waitForTimeout(200);
  const second = await pixels();
  assert.ok(first.nonblank > 150 && second.nonblank > 150, 'settled emblem remains visible stars');
  assert.notEqual(first.hash, second.hash, 'settled emblem continues breathing');
  await splash.screenshot({ path: join(output, 'startup-stellar.png'), omitBackground: true });
  await splash.emulateMedia({ reducedMotion: 'reduce' });
  await splash.waitForTimeout(400);
  const still = await pixels();
  await splash.waitForTimeout(200);
  assert.deepEqual(await pixels(), still, 'reduced motion is static');
  assert.equal(await splash.locator('.logo').evaluate(el => getComputedStyle(el).animationName), 'none');
  const closed = splash.waitForEvent('close');
  await call('finishSplash');
  await closed;
  // The real native window, not the browser demo, owns delays and action gating.
  splash = await nextWindow('splash', false);
  await splash.locator('.startup-surface[data-surface=transparent]').waitFor();
  const anchor = () => splash.locator('.logo').evaluate(el => {
    const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height };
  });
  const originalAnchor = await anchor();
  await call('spoofStartup');
  assert.equal((await call('stats')).startupCloses, 0, 'another window cannot command startup recovery');
  await splash.locator('.startup-surface[data-surface=notice]').waitFor({ timeout: 6000 });
  assert.deepEqual(await anchor(), originalAnchor, 'notice keeps the original emblem anchor');
  await splash.locator('.startup-surface[data-surface=recovery]').waitFor({ timeout: 8000 });
  assert.deepEqual(await anchor(), originalAnchor, 'timeout keeps the original emblem anchor');
  await splash.evaluate(() => document.fonts.ready);
  assert.equal(await splash.evaluate(() => document.fonts.check('11px Orbitron')), true);
  assert.equal(await splash.evaluate(() => getComputedStyle(document.querySelector('.startup-caption > span')).fontFamily.includes('Orbitron')), true);
  await splash.getByRole('button', { name: '继续等待', exact: true }).click();
  await splash.locator('.startup-surface[data-surface=notice]').waitFor();
  await call('splashStage', 'preferences');
  await call('splashStage', 'C:/private/profile');
  await call('failSplash');
  await splash.locator('.startup-surface[data-surface=recovery]').waitFor();
  assert.equal(await splash.getByRole('button', { name: '继续等待', exact: true }).count(), 0);
  await splash.locator('summary').click();
  assert.match(await splash.locator('pre').innerText(), /stage: preferences/);
  assert.match(await splash.locator('pre').innerText(), /code: INIT_FAILED/);
  assert.doesNotMatch(await splash.locator('pre').innerText(), /C:|模拟/);
  await splash.locator('.startup-message').evaluate(el => { el.scrollTop = el.scrollHeight; });
  assert.deepEqual(await anchor(), originalAnchor, 'diagnostic scrolling cannot move the emblem');
  await splash.screenshot({ path: join(output, 'startup-native-recovery.png'), omitBackground: true });
  await splash.getByRole('button', { name: '重试启动', exact: true }).click();
  assert.equal((await call('stats')).startupRetries, 1);
  assert.equal(await splash.getByRole('button', { name: '重试启动', exact: true }).isDisabled(), true);
  await splash.evaluate(() => window.startupRecovery.command('retry'));
  assert.equal((await call('stats')).startupRetries, 1, 'duplicate recovery action is blocked');
  splash = await nextWindow('splash', false);
  await call('failSplash');
  await splash.getByRole('button', { name: '退出应用', exact: true }).click();
  assert.equal((await call('stats')).startupCloses, 1);
  console.log('Native recovery: delays, fixed anchor, diagnostics, continue, retry, close and sender isolation passed');
  splash = await nextWindow('splash', false);
  await splash.locator('.logo[data-ready=true]').waitFor();
  const disabled = await pixels();
  await splash.waitForTimeout(200);
  assert.deepEqual(await pixels(), disabled, 'theme motion preference disables movement');
  assert.equal(await splash.locator('.logo').evaluate(el => getComputedStyle(el).animationName), 'none');
  await splash.waitForFunction(() => document.documentElement.dataset.startupComplete === 'true', undefined, { timeout: 1000 });
  // A shell that is ready immediately still waits for the actual visual timeline.
  splash = await nextWindow('splash');
  await splash.locator('.logo[data-ready=true]').waitFor();
  const finishStart = Date.now();
  const entranceClosed = splash.waitForEvent('close');
  const finishes = (await call('stats')).splashFinishes;
  await call('finishSplash');
  await splash.waitForTimeout(850);
  assert.equal(splash.isClosed(), false, 'the former 650ms native timer must not truncate the stellar entrance');
  await entranceClosed;
  const entranceWait = Date.now() - finishStart;
  assert.ok(entranceWait >= 1700 && entranceWait < 4000, `actual entrance wait: ${entranceWait}ms`);
  assert.equal((await call('stats')).splashFinishes, finishes + 1, 'one shell handoff');
  // A missing module / never-hydrated preference cannot indefinitely block startup.
  splash = await nextWindow('splash', true, false, true);
  const boundedClosed = splash.waitForEvent('close');
  const boundedStart = Date.now();
  await call('finishSplash');
  await boundedClosed;
  const boundedWait = Date.now() - boundedStart;
  assert.ok(boundedWait >= 3200 && boundedWait < 4500, `bounded fallback: ${boundedWait}ms`);
  await call('setTheme', 'original-light');
  splash = await nextWindow('splash');
  await splash.locator('img').waitFor();
  await splash.waitForTimeout(700);
  assert.equal(await splash.locator('.logo').getAttribute('data-ready'), null, 'built-ins retain original image');
  assert.equal(await splash.locator('img').evaluate(img => img.naturalWidth > 0), true);
  const splashUrl = splash.url();
  const splashIdentity = await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows().find(win => win.webContents.getURL().includes('startup-logo.html')).id);
  await splash.evaluate(() => { window.stellarDocumentIdentity = 'early-splash'; });
  await call('setTheme', 'plugin:stellar-cruise');
  await call('configureSplash', false);
  await splash.locator('.logo[data-ready=true]').waitFor();
  assert.equal(splash.url(), splashUrl, 'late theme hydration does not reload the splash');
  assert.equal(await splash.evaluate(() => window.stellarDocumentIdentity), 'early-splash');
  assert.equal(await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows().find(win => win.webContents.getURL().includes('startup-logo.html')).id),
  splashIdentity, 'late hydration keeps the existing native window');
  const lateStatic = await pixels();
  await splash.waitForTimeout(200);
  assert.deepEqual(await pixels(), lateStatic, 'late motion-off preference is static');
  await call('configureSplash', true);
  await splash.locator('.logo[data-ready=true]').waitFor();
  await splash.waitForTimeout(700);
  const lateMoving = await pixels();
  await splash.waitForTimeout(200);
  assert.notEqual((await pixels()).hash, lateMoving.hash, 'late motion-on preference resumes movement');
  await call('setTheme', 'original-light');
  await call('configureSplash');
  await splash.waitForFunction(() => !document.querySelector('.logo').hasAttribute('data-ready'));
  assert.equal(await splash.locator('img').evaluate(img => getComputedStyle(img).visibility), 'visible');
  await call('setTheme', 'plugin:stellar-cruise');
  await call('configureSplash', false);
  await splash.locator('.logo[data-ready=true]').waitFor();
  assert.ok((await pixels()).nonblank > 150, 'returning to the material uses a working WebGL context');
  splash = await nextWindow('splash', false, true);
  await splash.locator('.logo[data-ready=true]').waitFor();
  assert.ok(splash.url().startsWith('file:'), 'exercise the production file-based splash entry');
  assert.ok((await pixels()).nonblank > 150, 'built modules render through the production file loader');
  const stats = await call('stats');
  assert.deepEqual(stats.errors, []);
  assert.deepEqual(stats.network, []);
  assert.deepEqual(errors, []);
  const mainSource = await readFile('electron/main.ts', 'utf8');
  assert.match(mainSource, /themeAppearance: \{ colors: resolvedColors\(\), material: themeMaterial\(\) \}/);
  assert.ok(mainSource.indexOf('new StartupWindow(') < mainSource.indexOf('startupWindow?.setAppearance('),
    'appearance hydration must not delay the early splash');
  await writeFile(join(output, 'acceptance.json'), JSON.stringify({ passed: true, geometry, security,
    canvas: { first, second, reduced: still }, lateAppearanceKeepsWindow: true,
    startup: { firstFrames, entranceWait, boundedWait, noDefaultFlash: true },
    stats, realProfileModified: false, realAccountTested: false }, null, 2));
  console.log('Stellar tray, startup and production plugin window passed in an isolated native harness');
} finally {
  await app?.close();
  await new Promise(resolve => server.httpServer.close(resolve));
}

const visual = await createServer({ configFile: resolve('vite.theme-preview.config.mjs'),
  cacheDir: join(fixture, 'vite-cache'),
  server: { port: 0, strictPort: false }, logLevel: 'error' });
let browser;
try {
  await visual.listen();
  const url = `http://127.0.0.1:${visual.httpServer.address().port}/tests/fixtures/theme-pack.html`;
  browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome', headless: true });
  const visualErrors = [], checks = [];
  const focusFits = async (input, indicator = input, minWidth = 2) => {
    await input.focus();
    const result = await indicator.evaluate(el => {
      const style = getComputedStyle(el), rect = el.getBoundingClientRect();
      const width = parseFloat(style.outlineWidth), extent = Math.max(0, width + parseFloat(style.outlineOffset));
      const box = { left: rect.left - extent, right: rect.right + extent,
        top: rect.top - extent, bottom: rect.bottom + extent };
      const clips = [];
      for (let parent = el.parentElement; parent; parent = parent.parentElement) {
        const css = getComputedStyle(parent), bounds = parent.getBoundingClientRect();
        if (/auto|scroll|hidden|clip/.test(css.overflowX)
          && (box.left < bounds.left - .5 || box.right > bounds.right + .5)) clips.push(parent.className);
        if (/auto|scroll|hidden|clip/.test(css.overflowY)
          && (box.top < bounds.top - .5 || box.bottom > bounds.bottom + .5)) clips.push(parent.className);
        if (parent.matches(':popover-open')) break;
      }
      return { width, color: style.outlineColor, style: style.outlineStyle, clips, focused: el.contains(document.activeElement),
        viewport: box.left >= 0 && box.right <= innerWidth && box.top >= 0 && box.bottom <= innerHeight };
    });
    assert.ok(result.width >= minWidth && result.style === 'solid' && result.color !== 'rgba(0, 0, 0, 0)'
      && result.focused && result.viewport, JSON.stringify(result));
    assert.deepEqual(result.clips, [], 'the full focus indicator fits every clipping ancestor');
  };
  for (const width of [1440, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 960 }, reducedMotion: 'reduce' });
    page.on('pageerror', error => visualErrors.push(error.message));
    await page.addInitScript(() => localStorage.setItem('dfsc-stellar-preview-preferences-v1',
      JSON.stringify({ theme: 'plugin:stellar-cruise', themeMotion: false })));
    const shot = async name => {
      await page.mouse.move(1, 1);
      await page.waitForTimeout(120);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, name);
      await page.screenshot({ path: join(output, `${name}-${width}.png`) });
      checks.push(`${name}-${width}`);
    };
    const showSidebar = async () => {
      const toggle = page.getByRole('button', { name: '侧栏', exact: true });
      if (await toggle.getAttribute('aria-expanded') === 'false') await toggle.click();
    };
    await page.goto(`${url}?view=chat`);
    await page.locator('.composer-input').waitFor();
    await showSidebar();
    await page.locator('.sidebar-settings').click();
    await page.getByRole('button', { name: '全局指令', exact: true }).click();
    const instructions = page.locator('.instructions-editor textarea');
    await instructions.waitFor();
    await instructions.fill('请保持边界清楚，核对证据后给结论。');
    await focusFits(instructions);
    await shot('instructions');
    await page.getByRole('dialog', { name: '设置', exact: true }).getByRole('button', { name: '关闭', exact: true }).click();
    // The narrow sidebar is intentionally collapsed; use the production toggle.
    await showSidebar();
    await page.getByRole('button', { name: '远程访问', exact: true }).click();
    await page.locator('.remote-page').waitFor();
    await shot('remote');
    await page.goto(`${url}?view=mini`);
    await page.locator('.mini-chat-header').waitFor();
    await shot('mini');
    await page.getByRole('button', { name: '切换小窗会话', exact: true }).click();
    const search = page.getByRole('searchbox', { name: '搜索小窗会话', exact: true });
    await search.waitFor();
    await search.fill('主题包');
    await focusFits(search, page.locator('.mini-session-search'), 1);
    await shot('mini-picker');
    await search.press('Escape');
    await page.goto(`${url}?view=plugin`);
    await page.locator('.plugin-workspace-document h1').waitFor();
    await shot('plugin-window');
    await page.getByRole('tab', { name: '校对记录', exact: true }).click();
    await page.getByRole('heading', { name: '校对记录', exact: true }).waitFor();
    await page.goto(`${url}?view=chat`);
    await page.locator('.composer-input').waitFor();
    await showSidebar();
    await page.locator('.sidebar-settings').click();
    await page.getByRole('button', { name: '插件', exact: true }).click();
    await page.locator('.plugin-center').waitFor();
    await shot('market');
    const dependency = page.locator('.pc-extra-requirement').first();
    if (await dependency.count()) {
      await dependency.click();
      await page.locator('.pc-requirements-popover:popover-open').waitFor();
      await shot('requirements');
      await page.keyboard.press('Escape');
    }
    await page.close();
  }
  for (const theme of ['original-light', 'original-dark']) {
    const page = await browser.newPage({ viewport: { width: 920, height: 720 } });
    await page.addInitScript(theme => localStorage.setItem('dfsc-stellar-preview-preferences-v1', JSON.stringify({ theme })), theme);
    await page.goto(`${url}?view=plugin`);
    await page.locator('.plugin-workspace-document h1').waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.dataset.themeMaterial), undefined);
    await page.close();
    checks.push(`${theme}-no-stellar-material`);
  }
  assert.deepEqual(visualErrors, []);
  await writeFile(join(output, 'visual-acceptance.json'), JSON.stringify({ passed: true, checks, errors: visualErrors }, null, 2));
  console.log('Stellar auxiliary visual matrix passed at 1440px and 390px; original themes remain unscoped');
} finally {
  await browser?.close();
  await visual.close();
}
