import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const profile = await mkdtemp(join(tmpdir(), 'desktop-settings-dialog-'));
await mkdir('test-results', { recursive: true });
await writeFile(join(profile, 'preferences.json'), JSON.stringify({ language: 'zh', theme: 'light', workspaces: [] }));
const env = { ...process.env, DESKTOP_TEST_USER_DATA: profile, DESKTOP_TEST_NO_FOCUS: '1' };
delete env.ELECTRON_RUN_AS_NODE;
delete env.STEP_API_KEY;
let app;
try {
  app = await electron.launch({
    ...(process.env.DESKTOP_VERIFY_EXE ? { executablePath: process.env.DESKTOP_VERIFY_EXE } : { args: [resolve('.')] }),
    env, timeout: 60000,
  });
  const page = await app.firstWindow();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const capture = async name => {
    await page.mouse.move(8, 8);
    await page.waitForTimeout(250);
    await page.screenshot({ path: `test-results/${name}.png` });
  };
  await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    window.setOpacity(0); window.setIgnoreMouseEvents(true); window.showInactive();
    window.setSize(1440, 960);
  });
  await page.getByRole('textbox', { name: '消息', exact: true }).fill('Unsent settings fixture');
  await page.locator('.sidebar-bottom > button').click();
  await page.locator('.account-settings').waitFor();
  const dialog = page.locator('.settings-dialog');
  await page.waitForTimeout(250);
  const baseline = await dialog.boundingBox();
  const lightTint = await page.locator('.settings-backdrop').evaluate(element => getComputedStyle(element).backgroundColor);
  assert.equal(await page.locator('.settings-backdrop').evaluate(element => getComputedStyle(element).top), '0px');
  assert.equal(await page.evaluate(() => document.elementFromPoint(85, 22)?.classList.contains('settings-backdrop')), true, 'Application menus are behind the settings backdrop');
  assert.equal(await page.getByRole('button', { name: '最小化', exact: true }).evaluate(element => {
    const bounds = element.getBoundingClientRect();
    return document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)?.classList.contains('settings-backdrop');
  }), true, 'The entire titlebar is behind the settings backdrop');
  for (const title of ['账户', '供应商', 'MCP', '资源', '通用', '外观', '版本更新', '已归档']) {
    await page.getByRole('navigation', { name: '设置分类' }).getByRole('button', { name: title, exact: true }).click();
    const bounds = await dialog.boundingBox();
    assert.deepEqual(bounds, baseline, `${title}: same outer bounds across all categories`);
    assert.equal(await dialog.evaluate(element => element.scrollHeight > element.clientHeight), false);
    assert.equal(await page.locator('.settings-content').evaluate(element => element.scrollWidth > element.clientWidth), false);
    assert.equal(await page.getByRole('button', { name: title, exact: true }).getAttribute('aria-current'), 'page');
  }
  await page.getByRole('button', { name: '外观', exact: true }).click();
  await capture('settings-fixed-appearance-light');
  await page.getByRole('button', { name: '账户', exact: true }).click();
  await capture('settings-fixed-account-light');
  await page.getByRole('button', { name: '供应商', exact: true }).click();
  await page.getByRole('button', { name: '添加供应商', exact: true }).first().click();
  await page.getByLabel('Base URL', { exact: true }).waitFor();
  assert.deepEqual(await dialog.boundingBox(), baseline, 'Provider editor does not resize the shell');
  await capture('settings-fixed-provider-light');
  await page.getByRole('button', { name: '通用', exact: true }).click();
  await dialog.getByLabel(/^主题/).selectOption('dark');
  await page.locator('html[data-theme="dark"]').waitFor();
  assert.equal(await page.locator('.settings-backdrop').evaluate(element => getComputedStyle(element).backgroundColor), lightTint, 'Dark theme must not introduce a pale ink-color veil');
  await page.getByRole('button', { name: '外观', exact: true }).click();
  await capture('settings-fixed-appearance-dark');
  await page.getByRole('button', { name: 'Close', exact: true }).evaluate(button => button.click());
  await page.locator('.settings-backdrop.is-closing').waitFor();
  assert.equal(await dialog.evaluate(element => element.inert), true, 'Closing contents cannot receive duplicate actions');
  assert.equal(await page.locator('.window-bar').evaluate(element => element.inert), true, 'Background titlebar stays blocked throughout exit');
  assert.equal(await dialog.evaluate(element => getComputedStyle(element).animationName), 'settings-dialog-exit');
  assert.equal(await page.locator('.settings-backdrop').evaluate(element => getComputedStyle(element).animationName), 'settings-backdrop-exit');
  await page.locator('.settings-backdrop').waitFor({ state: 'detached' });
  assert.equal(await page.locator('.window-bar').evaluate(element => element.inert), false);
  assert.equal(await page.getByRole('textbox', { name: '消息', exact: true }).inputValue(), 'Unsent settings fixture');
  await page.locator('.sidebar-bottom > button').click();
  await dialog.waitFor();
  await page.waitForTimeout(250);
  assert.equal(await page.locator('.settings-backdrop.is-closing').count(), 0, 'Reopening resets exit state');
  for (const [width, height] of [[800, 650], [640, 720], [480, 600]]) {
    await app.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setSize(...size), [width, height]);
    for (const title of ['账户', '供应商', '外观', '已归档']) {
      await page.getByRole('button', { name: title, exact: true }).click();
      const bounds = await dialog.boundingBox();
      const viewport = page.viewportSize() ?? await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
      assert.ok(bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= viewport.width && bounds.y + bounds.height <= viewport.height);
      assert.equal(await page.locator('.settings-content').evaluate(element => element.scrollWidth > element.clientWidth), false, `${width}: ${title} does not overflow horizontally`);
    }
    await capture(`settings-fixed-${width}`);
  }
  await page.emulateMedia({ reducedMotion: 'reduce' });
  assert.equal(await dialog.evaluate(element => getComputedStyle(element).animationName), 'none');
  await page.getByRole('button', { name: '通用', exact: true }).click();
  await dialog.getByLabel(/^语言/).selectOption('en');
  await page.getByRole('button', { name: 'Appearance', exact: true }).click();
  assert.equal(await page.locator('.settings-content').evaluate(element => element.scrollWidth > element.clientWidth), false);
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  assert.equal(await page.locator('.settings-backdrop').count(), 0, 'Reduced motion dismisses without a delayed exit');
  assert.equal(await page.getByRole('textbox', { name: 'Message', exact: true }).inputValue(), 'Unsent settings fixture');
  assert.deepEqual(errors, []);
  console.log('Fixed settings dialog: all categories, provider editor, light/dark, narrow windows, English, reduced motion and draft retention passed.');
} finally {
  if (app) {
    await app.evaluate(({ BrowserWindow }) => { for (const window of BrowserWindow.getAllWindows()) window.destroy(); }).catch(() => {});
    await app.close();
  }
}
