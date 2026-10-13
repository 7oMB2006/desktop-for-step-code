import { _electron as electron } from 'playwright';
import { prepareSessionFixture } from './session-fixture.mjs';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const profile = await mkdtemp(join(tmpdir(), 'step-composer-menu-'));
await writeFile(join(profile, 'preferences.json'), JSON.stringify({ language: 'zh', theme: 'dark', workspaces: [] }));
await mkdir('test-results', { recursive: true });
const env = { ...process.env, DESKTOP_TEST_USER_DATA: profile, DESKTOP_TEST_NO_FOCUS: '1' };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ ...(process.env.DESKTOP_VERIFY_EXE ? { executablePath: process.env.DESKTOP_VERIFY_EXE } : { args: [resolve('.')] }), env, timeout: 60000 });
try {
  const page = await app.firstWindow();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    win.setOpacity(0); win.setIgnoreMouseEvents(true); win.showInactive(); win.setSize(1300, 900);
  });
  const snapshot = await prepareSessionFixture(page);
  await app.evaluate(({ ipcMain }, snapshot) => {
    globalThis.menuFixture = { ...snapshot, messages: [
      { role: 'user', content: '请整理这个项目的结构。' },
      { role: 'assistant', content: '项目包含桌面界面、运行时桥接和验收脚本。可以先从聊天栏交互开始。' },
    ] };
    globalThis.menuPrompts = 0;
    globalThis.menuAttachments = [];
    globalThis.menuPermissionsSupported = false;
    ipcMain.removeHandler('desktop');
    ipcMain.handle('desktop', (_event, method, ...args) => {
      if (method === 'snapshot') return globalThis.menuFixture;
      if (method === 'systemTheme') return { systemDark: true };
      if (method === 'sessions') return snapshot.sessions;
      if (method === 'chooseAttachments') return globalThis.menuAttachments;
      if (method === 'settings') return { account: {}, profiles: [], mcp: {}, skills: [] };
      if (method === 'summary') return { tasks: [], mcp: [], skillCount: 0 };
      if (method === 'command') {
        if (args[0] === 'prompt') globalThis.menuPrompts++;
        if (args[0] === 'get_available_thinking_levels') return { levels: ['low', 'medium', 'high'] };
        if (args[0] === 'get_commands') return { commands: [
          ...(globalThis.menuPermissionsSupported ? [{ name: 'permissions', source: 'extension' }] : []),
          ...['goal', 'plan', 'todo', 'ultracode', 'compact', 'cron', 'init', 'exit', 'theme', 'llama'].map(name => ({ name, source: 'extension', description: `${name} command` })),
          { name: 'review-code', source: 'skill', description: '审查代码变更' },
          { name: 'daily-note', source: 'prompt', description: '整理每日记录' },
        ] };
      }
      return {};
    });
  }, snapshot);
  await page.reload();
  const input = page.locator('.composer > textarea');
  await input.waitFor();
  await input.fill('/');
  const menu = page.locator('.composer-discovery');
  await menu.waitFor();
  assert.equal(await page.locator('.permission-trigger').isDisabled(), true);
  assert.equal(await menu.getByRole('option', { name: /访问权限/ }).count(), 0, 'unsupported permission action is hidden');
  await input.fill('/permissions');
  await input.press('Enter');
  assert.equal(await input.inputValue(), '/permissions', 'unavailable action preserves token');
  await input.fill('/');
  assert.equal(await menu.getByText('/exit', { exact: true }).count(), 0);
  assert.equal(await menu.locator('svg.lucide-goal').count(), 1);
  assert.equal(await menu.locator('svg.lucide-lightbulb').count(), 1);
  assert.equal(await menu.locator('svg.lucide-network').count(), 1);
  await page.waitForTimeout(220);
  const geometry = await page.evaluate(() => {
    const menu = document.querySelector('.composer-discovery').getBoundingClientRect();
    const composer = document.querySelector('.composer').getBoundingClientRect();
    return { gap: composer.top - menu.bottom, left: composer.left - menu.left, right: composer.right - menu.right };
  });
  assert.ok(Math.abs(geometry.gap - 6) <= 1 && Math.abs(geometry.left) <= 1 && Math.abs(geometry.right) <= 1, JSON.stringify(geometry));
  assert.equal(await page.locator('.composer').evaluate(element => getComputedStyle(element).borderTopLeftRadius), '8px');
  assert.equal(await menu.evaluate(element => getComputedStyle(element).borderBottomLeftRadius), '8px');
  await page.screenshot({ path: 'test-results/composer-slash-dark.png' });
  await input.fill('/cl');
  assert.equal(await menu.getByRole('option').count(), 2, 'Core CLM commands are discoverable even when get_commands omits them');
  assert.equal(await menu.getByText('/clm', { exact: true }).count(), 1);
  assert.equal(await menu.getByText('/clm-compact', { exact: true }).count(), 1);
  await page.screenshot({ path: 'test-results/composer-clm-dark.png' });
  await input.press('Enter');
  assert.equal(await input.inputValue(), '/clm ');
  assert.equal(await menu.count(), 0);
  assert.equal(await app.evaluate(() => globalThis.menuPrompts), 0, 'Selecting CLM does not execute it');
  await input.fill('/clm-compact');
  await input.press('Enter');
  assert.equal(await input.inputValue(), '/clm-compact ');
  await input.fill('/clm-compact 保留项目名和关键要求');
  await input.press('End');
  await page.locator('.composer-command-reference .command-reference').waitFor({ state: 'visible' });
  assert.equal(await page.locator('.composer-command-reference svg.lucide-command').count(), 1);
  const prefixGeometry = await input.evaluate(element => {
    const style = getComputedStyle(element);
    const marker = element.parentElement.querySelector('.composer-command-reference');
    return { expected: element.getBoundingClientRect().left + parseFloat(style.paddingLeft),
      actual: marker.getBoundingClientRect().left, indent: parseFloat(style.textIndent) };
  });
  assert.ok(Math.abs(prefixGeometry.actual - prefixGeometry.expected) < 1, 'recognized icon keeps the original text anchor');
  assert.ok(prefixGeometry.indent > 0, 'first-line text reserves the wider icon without covering guidance or caret');
  await page.screenshot({ path: 'test-results/composer-command-reference.png' });
  await input.fill('ordinary text');
  assert.equal(await input.evaluate(element => element.style.textIndent), '', 'plain text restores its original indent');
  await input.fill('/clm-compact 保留项目名和关键要求');
  await input.press('End');
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].webContents.send('runtime-event', {
      type: 'extension_ui_request', method: 'notify', notifyType: 'info',
      message: 'CLM revision 0; ~21089 context tokens.\nIndex: C:/internal/index\nMirror: C:/internal/mirror\nArchive: C:/internal/archive',
    });
  });
  await page.getByText('工作上下文 · 修订 0 · 约 21,089 tokens', { exact: true }).waitFor();
  assert.equal(await page.locator('.notice-toast').innerText().then(text => text.includes('C:/internal')), false);
  assert.equal(await app.evaluate(() => globalThis.menuPrompts), 0, 'Selecting maintenance does not execute it');
  await input.fill('/goal');
  await input.press('Enter');
  assert.equal(await input.inputValue(), '/goal ');
  assert.equal(await menu.count(), 0);
  assert.equal(await app.evaluate(() => globalThis.menuPrompts), 0, 'selection must not send');
  await input.fill('https://example.com/');
  assert.equal(await menu.count(), 0, 'URL slash is not a command');
  await input.fill('mail@example.com');
  assert.equal(await menu.count(), 0, 'email is not a mention');
  await input.fill('/no-such-command');
  await input.press('Enter');
  assert.equal(await app.evaluate(() => globalThis.menuPrompts), 0, 'empty results must not send');
  await input.fill('/plan');
  await input.evaluate(element => element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', isComposing: true, bubbles: true })));
  assert.equal(await input.inputValue(), '/plan');
  await input.press('Escape');
  assert.equal(await menu.count(), 0);
  await input.fill('看看 @');
  await menu.waitFor();
  await page.screenshot({ path: 'test-results/composer-references-dark.png' });
  await menu.getByRole('option', { name: /文件和图片/ }).click();
  assert.equal(await input.inputValue(), '看看 @', 'cancelled picker retains token');
  await input.click();
  await menu.getByRole('option', { name: /项目包含桌面界面/ }).click();
  assert.equal(await input.inputValue(), '看看 ');
  assert.equal(await page.locator('.composer-quotes').count(), 1);
  await input.fill('普通消息');
  await page.getByRole('button', { name: '添加附件', exact: true }).click();
  await menu.waitFor();
  await input.press('Escape');
  assert.equal(await input.inputValue(), '普通消息');
  await app.evaluate(() => { globalThis.menuAttachments = Array.from({ length: 10 }, (_, index) => ({
    kind: 'file', id: `fixture-file-${index}`, name: `file-${index}.txt`, size: 1,
  })); });
  await page.getByRole('button', { name: '添加附件', exact: true }).click();
  await menu.getByRole('option', { name: /文件和图片/ }).click();
  await page.waitForFunction(() => document.querySelectorAll('.attachment-card').length === 10);
  await page.getByRole('button', { name: '添加附件', exact: true }).click();
  assert.equal(await menu.getByRole('option', { name: /文件和图片/ }).isDisabled(), true);
  await input.press('ArrowDown');
  await input.press('Enter');
  assert.equal(await page.locator('.composer-quotes').count(), 1, 'references remain accessible at attachment limit');
  assert.equal(await input.inputValue(), '普通消息');
  assert.equal(await page.locator('.attachment-card').count(), 10);
  await app.evaluate(() => { globalThis.menuPermissionsSupported = true; });
  await page.reload();
  await input.fill('/permissions');
  await menu.getByRole('option', { name: /访问权限/ }).click();
  await page.locator('.permission-trigger[aria-expanded="true"]').waitFor();
  assert.equal(await input.inputValue(), '', 'supported permission action opens the real picker');
  await page.waitForFunction(() => document.activeElement?.closest('.permission-menu'));
  await page.keyboard.press('Escape');
  await page.locator('.permission-trigger[aria-expanded="false"]').waitFor();
  await input.fill('/模型');
  await input.press('Enter');
  await page.locator('.model-effort-trigger[aria-expanded="true"]').waitFor();
  await page.keyboard.press('Escape');
  const verifyModelLayer = async (theme, size) => {
    await app.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setSize(...size), size);
    await page.evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme);
    await input.fill('/');
    await input.click();
    await menu.waitFor();
    await page.locator('.model-effort-trigger').click();
    const popover = page.locator('.model-effort-popover');
    await popover.waitFor();
    await page.waitForTimeout(240);
    const hits = await popover.evaluate(element => {
      const panel = element.getBoundingClientRect();
      const menu = document.querySelector('.composer-discovery').getBoundingClientRect();
      const top = Math.max(panel.top, menu.top), bottom = Math.min(panel.bottom, menu.bottom);
      const left = Math.max(panel.left, menu.left), right = Math.min(panel.right, menu.right);
      if (bottom <= top || right <= left) return [];
      return [.2, .5, .8].map(fraction => element.contains(document.elementFromPoint(
        left + (right - left) * fraction, top + (bottom - top) * .3)));
    });
    assert.equal(hits.length, 3, 'Fixture must overlap discovery and model surfaces');
    assert.ok(hits.every(Boolean), `Model panel must receive pointer hits above discovery: ${hits}`);
    await page.screenshot({ path: `test-results/composer-model-layer-${theme}-${size[0]}.png` });
    const slider = popover.getByRole('slider');
    await slider.focus();
    await slider.press('End');
    assert.equal(await slider.getAttribute('aria-valuenow'), '2', 'Discovery cannot intercept thinking slider keys');
    await popover.getByRole('button', { name: '选择模型', exact: true }).click();
    await popover.locator('.model-effort-list').waitFor({ state: 'visible' });
    await page.keyboard.press('Escape');
    assert.equal(await popover.count(), 0);
    assert.equal(await menu.count(), 1, 'Picker Escape closes only the foreground picker');
    await input.focus();
    await input.press('Escape');
  };
  await verifyModelLayer('dark', [1300, 900]);
  await verifyModelLayer('light', [1300, 900]);
  await verifyModelLayer('dark', [840, 760]);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(840, 760));
  await input.fill('/');
  await input.click();
  await menu.waitFor();
  await page.waitForTimeout(220);
  await page.screenshot({ path: 'test-results/composer-slash-narrow.png' });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1300, 900));
  await page.evaluate(() => { document.documentElement.dataset.theme = 'light'; });
  await page.waitForTimeout(220);
  await page.screenshot({ path: 'test-results/composer-slash-light.png' });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  assert.equal(overflow, false);
  assert.deepEqual(errors, []);
  console.log('Composer discovery acceptance passed: anchor, filtering, selection, IME, cancellation, quotes, model picker and narrow layout.');
} finally { await app.close(); }
