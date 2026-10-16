import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const profile = await mkdtemp(join(tmpdir(), 'desktop-appearance-'));
await writeFile(join(profile, 'preferences.json'), JSON.stringify({ theme: 'light', language: 'zh', workspaces: [], autoCheckUpdates: false }));
await mkdir('test-results', { recursive: true });
const env = { ...process.env, DESKTOP_TEST_USER_DATA: profile, DESKTOP_TEST_NO_FOCUS: '1' };
delete env.ELECTRON_RUN_AS_NODE;
let app;
const errors = [];
async function launch() {
  const executablePath = process.env.DESKTOP_VERIFY_EXE;
  app = await electron.launch({ ...(executablePath ? { executablePath } : { args: [resolve('.')] }), env, timeout: 60000 });
  const page = await app.firstWindow();
  if (process.env.DESKTOP_VERIFY_CPU_RATE) {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: Number(process.env.DESKTOP_VERIFY_CPU_RATE) });
  }
  page.on('pageerror', error => errors.push(error.message));
  await app.evaluate(({ BrowserWindow, dialog }) => { dialog.showMessageBox = async () => ({ response: 1 }); const win = BrowserWindow.getAllWindows()[0]; win.setOpacity(0); win.setIgnoreMouseEvents(true); win.showInactive(); win.setSize(1280, 960); });
  await page.waitForFunction(() => {
    const button = document.querySelector('.new-chat');
    return button && !button.disabled;
  });
  await page.locator('.sidebar-bottom > button').click();
  await page.getByRole('button', { name: '外观', exact: true }).click();
  await page.getByRole('region', { name: '文字与排版' }).waitFor();
  return page;
}
try {
  let page = await launch();
  const colors = async () => {
    await page.waitForFunction(() => !document.documentElement.getAnimations().some(animation => animation.playState === 'running'));
    return page.evaluate(() => {
    const style = getComputedStyle(document.documentElement);
    return Object.fromEntries(['--bg', '--primary', '--danger', '--green'].map(name => [name, style.getPropertyValue(name).trim()]));
    });
  };
  const cssColor = hex => `rgb(${[1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16)).join(', ')})`;
  const selectTheme = async (name, id) => {
    await page.getByRole('button', { name, exact: true }).click();
    await page.waitForFunction(expected => document.documentElement.dataset.palette === expected, id);
  };
  const shellBounds = await page.getByRole('dialog').boundingBox();
  await page.waitForFunction(() => document.documentElement.dataset.themeMotion === 'ready');
  const beforeMotion = (await colors())['--bg'];
  await selectTheme('暗', 'dark');
  const motion = await (await page.waitForFunction(() => {
    const root = document.documentElement;
    const animations = root.getAnimations();
    const background = animations.find(animation => animation.transitionProperty === '--bg');
    if (!background) return false;
    for (const animation of animations) { animation.pause(); animation.currentTime = 120; }
    const intermediate = getComputedStyle(root).getPropertyValue('--bg');
    const easing = background.effect.getTiming().easing;
    for (const animation of animations) animation.finish();
    return { intermediate, easing };
  })).jsonValue();
  assert.notEqual(motion.intermediate, beforeMotion);
  assert.notEqual(motion.intermediate, cssColor('#1f222a'));
  assert.match(motion.easing, /cubic-bezier/);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await selectTheme('亮', 'light');
  assert.equal((await colors())['--bg'], cssColor('#f4f7fa'));
  assert.equal(await page.evaluate(() => document.documentElement.getAnimations().length), 0);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  for (const [name, id, bg] of [
    ['原版浅色', 'original-light', '#ffffff'], ['原版深色', 'original-dark', '#141414'],
    ['亮', 'light', '#f4f7fa'], ['素', 'paper', '#eeede7'], ['暗', 'dark', '#1f222a'],
    ['深蓝', 'blue', '#102838'], ['酒红', 'wine', '#3b202d'], ['翠绿', 'jade', '#14352c'],
  ]) {
    await selectTheme(name, id);
    assert.equal((await colors())['--bg'], cssColor(bg));
    assert.equal(await page.getByRole('button', { name, exact: true }).getAttribute('aria-pressed'), 'true');
    assert.deepEqual(await page.getByRole('dialog').boundingBox(), shellBounds, 'theme choice does not resize settings');
    if (id === 'paper') {
      const tint = await page.locator('.settings-layout > nav').evaluate(element => {
        const context = document.createElement('canvas').getContext('2d');
        context.fillStyle = getComputedStyle(element).backgroundColor;
        context.fillRect(0, 0, 1, 1);
        return [...context.getImageData(0, 0, 1, 1).data];
      });
      assert.ok(tint[0] >= tint[1] && tint[1] > tint[2], 'transparent paper sidebar preserves warm hue, not pink');
    }
    await page.screenshot({ path: `test-results/theme-${id}.png`, animations: 'disabled' });
    if (id === 'paper') {
      assert.ok(await page.locator('.theme-tile').first().evaluate(tile => {
        const circle = getComputedStyle(tile, '::after');
        const radius = parseFloat(circle.width) / 2;
        const right = parseFloat(circle.right);
        const bottom = parseFloat(circle.bottom);
        return getComputedStyle(tile).overflow === 'hidden' &&
          right < 0 && bottom < 0 && right > -radius && bottom > -radius;
      }), 'large circle crosses both edges while its center remains inside the card');
      await page.locator('.theme-settings').screenshot({ path: 'test-results/theme-circles-sketch.png', animations: 'disabled' });
    }
  }
  const semantic = await colors();
  // Persistence can finish before the renderer receives its preference reply.
  await app.evaluate(({ ipcMain }) => {
    const handler = ipcMain._invokeHandlers.get('desktop');
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    globalThis.accentReplyFixture = { handler, release };
    ipcMain.removeHandler('desktop');
    ipcMain.handle('desktop', async (event, method, ...args) => {
      const result = await handler(event, method, ...args);
      if (method === 'preferences' && args[0]?.accentColor === '#487bd1') await gate;
      return result;
    });
  });
  await page.getByRole('button', { name: '蓝强调色', exact: true }).click();
  await page.waitForFunction(async () => (await window.desktop.snapshot()).preferences.accentColor === '#487bd1');
  const blueSwatch = page.getByRole('button', { name: '蓝强调色', exact: true });
  assert.equal(await blueSwatch.getAttribute('aria-pressed'), 'false', 'saved preferences do not imply a rendered acknowledgement');
  assert.equal((await colors())['--primary'], semantic['--primary'], 'the held reply leaves the previous rendered accent intact');
  await app.evaluate(({ ipcMain }) => {
    const { handler, release } = globalThis.accentReplyFixture;
    ipcMain.removeHandler('desktop');
    ipcMain.handle('desktop', handler);
    release();
    delete globalThis.accentReplyFixture;
  });
  await page.waitForFunction(() => document.querySelector('.accent-swatch[aria-label="蓝强调色"]')?.getAttribute('aria-pressed') === 'true');
  const preset = await colors();
  assert.notEqual(preset['--primary'], semantic['--primary'], 'capture the acknowledged accent, not the stale pre-reply baseline');
  const primaryTarget = await page.evaluate(() => {
    const root = document.documentElement;
    return root.style.getPropertyValue(`--theme-${root.dataset.theme}-primary`).trim();
  });
  assert.equal(preset['--primary'], cssColor(primaryTarget), 'the baseline is the final target color, not a transition frame');
  assert.equal(preset['--danger'], semantic['--danger']);
  assert.equal(preset['--green'], semantic['--green']);
  const openEditor = async () => {
    await page.getByRole('button', { name: '自定义强调色', exact: true }).click();
    await page.waitForFunction(() => {
      const disclosure = document.querySelector('.accent-disclosure');
      const input = document.querySelector('#accent-hex');
      return disclosure?.classList.contains('is-open') && input &&
        !disclosure.getAnimations().some(animation => animation.playState === 'running');
    });
  };
  await openEditor();
  const hex = page.getByRole('textbox', { name: 'HEX', exact: true });
  await hex.fill('#ffffff');
  try {
    await page.waitForFunction(() => [...document.querySelectorAll('.accent-editor button')].some(button => button.textContent.includes('应用') && !button.disabled));
  } catch (error) {
    console.error('HEX editor state', await page.evaluate(() => ({
      value: document.querySelector('#accent-hex')?.value,
      invalid: document.querySelector('#accent-hex')?.getAttribute('aria-invalid'),
      buttons: [...document.querySelectorAll('.accent-editor button')].map(button => ({ text: button.textContent, disabled: button.disabled })),
      alerts: [...document.querySelectorAll('[role=alert]')].map(element => element.textContent),
    })));
    await page.screenshot({ path: 'test-results/theme-hex-failure.png' });
    throw error;
  }
  assert.equal(await page.getByRole('button', { name: '应用', exact: true }).isEnabled(), true);
  assert.equal((await page.evaluate(() => window.desktop.snapshot())).preferences.accentColor, '#487bd1', 'preview does not write preferences');
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await page.waitForFunction(expected => getComputedStyle(document.documentElement).getPropertyValue('--primary').trim() === expected, preset['--primary']);
  await page.locator('.accent-editor').waitFor({ state: 'detached' });
  for (const close of ['cancel', 'toggle']) {
    await openEditor();
    await hex.fill('#fefefe');
    await page.waitForFunction(() => document.querySelector('#accent-hex')?.value === '#fefefe' &&
      document.querySelector('#accent-hex')?.getAttribute('aria-invalid') === 'false');
    const reopened = await page.evaluate(async close => {
      const previous = document.querySelector('#accent-hex');
      const trigger = document.querySelector('.accent-custom');
      const disclosure = document.querySelector('.accent-disclosure');
      for (const animation of disclosure.getAnimations()) animation.finish();
      if (close === 'cancel') document.querySelector('.accent-editor-actions button').click();
      else trigger.click();
      await new Promise(requestAnimationFrame);
      const retained = document.querySelector('#accent-hex') === previous;
      const closing = !disclosure.classList.contains('is-open');
      trigger.click();
      await new Promise(requestAnimationFrame);
      return { retained, closing, fresh: document.querySelector('#accent-hex') !== previous, value: document.querySelector('#accent-hex')?.value };
    }, close);
    assert.equal(reopened.retained && reopened.closing, true, 'reopen occurs while the exit animation still retains the editor');
    assert.equal(reopened.fresh, true, `${close} then rapid reopen discards the old editor instance`);
    assert.equal(reopened.value, '#487bd1', `${close} then rapid reopen restores the saved HEX`);
    await page.getByRole('button', { name: '取消', exact: true }).click();
    await page.locator('.accent-editor').waitFor({ state: 'detached' });
    assert.equal((await colors())['--primary'], preset['--primary']);
  }
  await openEditor();
  await hex.fill('invalid');
  await page.waitForFunction(() => document.querySelector('#accent-hex')?.getAttribute('aria-invalid') === 'true');
  assert.equal(await page.getByRole('button', { name: '应用', exact: true }).isDisabled(), true);
  await hex.fill('#a7d8c9');
  await page.waitForFunction(() => !document.querySelector('.accent-disclosure').getAnimations().some(animation => animation.playState === 'running'));
  await page.locator('.accent-editor').scrollIntoViewIfNeeded();
  assert.ok(await page.locator('.accent-disclosure').evaluate(element => {
    const bounds = element.getBoundingClientRect();
    const picker = element.querySelector('.react-colorful').getBoundingClientRect();
    return picker.top >= bounds.top && picker.bottom <= bounds.bottom + 1;
  }), 'expanded color picker is not clipped');
  assert.equal(await page.getByRole('button', { name: '应用', exact: true }).evaluate(element =>
    getComputedStyle(element).color), 'rgb(0, 0, 0)', 'pale accent uses dark button text');
  await page.screenshot({ path: 'test-results/theme-custom-accent.png', animations: 'disabled' });
  const assertHexFocusFits = async () => {
    await hex.focus();
    assert.ok(await hex.evaluate(input => {
      const rect = input.getBoundingClientRect();
      const field = input.closest('.accent-hex-field').getBoundingClientRect();
      const clip = input.closest('.accent-disclosure').getBoundingClientRect();
      const style = getComputedStyle(input);
      const outer = Math.max(0, parseFloat(style.outlineWidth) + parseFloat(style.outlineOffset));
      return document.activeElement === input && rect.right + outer <= Math.min(field.right, clip.right) &&
        rect.left - outer >= Math.max(field.left, clip.left) && input.clientWidth >= 90;
    }), 'HEX input and its entire focus outline fit inside field and clipping ancestor');
  };
  await assertHexFocusFits();
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(640, 720));
  await page.locator('.accent-editor').scrollIntoViewIfNeeded();
  assert.ok(await page.locator('.settings-content').evaluate(element => element.scrollWidth <= element.clientWidth + 1));
  assert.ok(await page.locator('.accent-editor').evaluate(element => {
    const bounds = element.getBoundingClientRect();
    return [...element.querySelectorAll('input, button, .react-colorful')].every(child => {
      const rect = child.getBoundingClientRect();
      return rect.left >= bounds.left && rect.right <= bounds.right + 1;
    });
  }), 'color controls fit the narrow settings column');
  await assertHexFocusFits();
  await page.getByText('翠林听雨', { exact: true }).waitFor();
  await page.getByText('色彩系 · 山海之间', { exact: true }).waitFor();
  await page.screenshot({ path: 'test-results/theme-custom-narrow.png', animations: 'disabled' });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1280, 960));
  await page.getByRole('button', { name: '应用', exact: true }).click();
  await page.waitForFunction(async () => (await window.desktop.snapshot()).preferences.accentColor === '#a7d8c9');
  await page.locator('.accent-editor').waitFor({ state: 'detached' });
  const savedAccent = (await colors())['--primary'];
  await page.getByRole('button', { name: '自定义强调色', exact: true }).click();
  await hex.fill('#ff00ff');
  await hex.press('Escape');
  assert.equal(await page.getByRole('dialog').isVisible(), true, 'Escape cancels the picker, not settings');
  await page.locator('.accent-editor').waitFor({ state: 'detached' });
  assert.equal((await colors())['--primary'], savedAccent);
  await page.getByRole('button', { name: '自定义强调色', exact: true }).click();
  await hex.fill('#ffff00');
  await page.getByRole('button', { name: '通用', exact: true }).click();
  assert.equal((await colors())['--primary'], savedAccent, 'leaving Appearance discards the color preview');
  await page.getByRole('button', { name: '外观', exact: true }).click();
  await selectTheme('素', 'paper');
  assert.equal((await page.evaluate(() => window.desktop.snapshot())).preferences.accentColor, '#a7d8c9', 'theme changes preserve custom accent');
  await selectTheme('翠绿', 'jade');
  assert.equal((await colors())['--primary'], savedAccent);
  await page.getByRole('button', { name: '跟随系统', exact: true }).click();
  await page.waitForFunction(async () => (await window.desktop.snapshot()).preferences.theme === 'system');
  await app.evaluate(({ nativeTheme }) => { nativeTheme.themeSource = 'light'; });
  await page.waitForFunction(() => document.documentElement.dataset.palette === 'light');
  await app.evaluate(({ nativeTheme }) => { nativeTheme.themeSource = 'dark'; });
  await page.waitForFunction(() => document.documentElement.dataset.palette === 'dark');
  await selectTheme('翠绿', 'jade');
  await app.evaluate(({ nativeTheme }) => { nativeTheme.themeSource = 'light'; });
  assert.equal(await page.evaluate(() => document.documentElement.dataset.palette), 'jade', 'explicit theme ignores OS changes');
  const body = page.locator('.appearance-preview .message-body');
  assert.equal(await body.evaluate(el => getComputedStyle(el).fontSize), '15px');
  await page.screenshot({ path: 'test-results/appearance-default-light.png' });
  await page.locator('.appearance-preview').scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'test-results/appearance-default-preview.png' });
  // Hold preference acknowledgements so consecutive controls share stale props.
  await app.evaluate(({ ipcMain }) => {
    const handler = ipcMain._invokeHandlers.get('desktop');
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    globalThis.appearanceFixture = { patches: [], release };
    ipcMain.removeHandler('desktop');
    ipcMain.handle('desktop', async (event, method, ...args) => {
      if (method === 'preferences' && args[0]?.appearance) {
        globalThis.appearanceFixture.patches.push(structuredClone(args[0].appearance));
        await gate;
      }
      return handler(event, method, ...args);
    });
  });
  await page.getByRole('spinbutton', { name: '正文字号', exact: true }).fill('18');
  await page.getByRole('spinbutton', { name: '正文字号', exact: true }).press('Enter');
  await page.getByRole('combobox', { name: '正文行间距', exact: true }).selectOption('2');
  await page.getByRole('combobox', { name: '正文字体', exact: true }).selectOption('serif');
  assert.deepEqual(await app.evaluate(() => globalThis.appearanceFixture.patches), [
    { bodySize: 18 }, { lineHeight: 2 }, { bodyFont: 'serif' },
  ]);
  await app.evaluate(() => globalThis.appearanceFixture.release());
  await page.waitForFunction(() => getComputedStyle(document.querySelector('.appearance-preview .message-body')).lineHeight === '36px');
  await page.waitForFunction(() => document.querySelector('[aria-label="正文字体"]').value === 'serif');
  await page.locator('.appearance-preview').scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'test-results/appearance-serif-relaxed.png' });
  assert.equal(await page.locator('.appearance-heading .icon-button').evaluate(el => el.getBoundingClientRect().width), 30);
  await app.close(); app = undefined;
  assert.equal(JSON.parse(await readFile(join(profile, 'preferences.json'), 'utf8')).appearance.bodySize, 18);
  assert.equal(JSON.parse(await readFile(join(profile, 'preferences.json'), 'utf8')).appearance.lineHeight, 2);
  page = await launch();
  assert.equal(await page.evaluate(() => document.documentElement.dataset.palette), 'jade');
  assert.equal((await page.evaluate(() => window.desktop.snapshot())).preferences.accentColor, '#a7d8c9');
  const firstFrame = await page.evaluate(() => window.desktopTheme.firstFrame());
  assert.equal(firstFrame.palette, 'jade');
  assert.equal(firstFrame.background, '#14352c');
  assert.equal(cssColor(firstFrame.primary), savedAccent);
  assert.equal(firstFrame.readyState, 'loading');
  await page.getByRole('button', { name: '恢复主题强调色', exact: true }).click();
  await page.waitForFunction(async () => (await window.desktop.snapshot()).preferences.accentColor === null);
  assert.equal((await page.evaluate(() => window.desktop.snapshot())).preferences.appearance.bodySize, 18);
  assert.equal(await page.getByRole('spinbutton', { name: '正文字号', exact: true }).inputValue(), '18');
  assert.equal(await page.getByRole('combobox', { name: '正文字体', exact: true }).inputValue(), 'serif');
  await page.getByRole('button', { name: '恢复默认排版', exact: true }).click();
  await page.waitForFunction(() => getComputedStyle(document.querySelector('.appearance-preview .message-body')).fontSize === '15px');
  await page.evaluate(() => window.desktop.preferences({ theme: 'dark', appearance: { uiSize: 18, bodySize: 22, codeSize: 20, lineHeight: 2 } }));
  // Refresh the snapshot through the application lifecycle rather than editing React state.
  await page.reload();
  await page.waitForFunction(() => {
    const button = document.querySelector('.new-chat');
    return button && !button.disabled;
  });
  await page.locator('.sidebar-bottom > button').click();
  await page.getByRole('button', { name: '外观', exact: true }).click();
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(760, 880));
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
  const content = page.locator('.settings-content');
  assert.ok(await content.evaluate(el => el.scrollWidth <= el.clientWidth + 1), 'settings must not overflow horizontally');
  await content.evaluate(el => el.scrollTo(0, el.scrollHeight));
  await page.screenshot({ path: 'test-results/appearance-large-narrow-dark.png' });
  assert.deepEqual(errors, []);
  console.log('Appearance: six named themes plus original monochrome, system changes, independent accents, preview/cancel/apply, input validation, semantic colors, first-frame/restart persistence, typography and narrow layout passed.');
} finally { if (app) await app.close(); }
