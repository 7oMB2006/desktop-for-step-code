import assert from 'node:assert/strict';
import { cp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron as electron } from 'playwright';
import { assertFocusVisible } from './assert-focus-visible.mjs';
import { closeDesktopFixtureAndWait } from './close-desktop-fixture.mjs';
import { mkdtemp } from './test-profile.mjs';

const evidence = resolve(process.env.DESKTOP_PREVIEW_EVIDENCE ?? 'test-results/settings-field-focus');
await mkdir(evidence, { recursive: true });
const executablePath = process.env.DESKTOP_VERIFY_EXE;
const results = [];

for (const [theme, widths] of [['light', [1440]], ['dark', [640]], ['plugin:stellar-cruise', [1440, 640]]]) {
  const profile = await mkdtemp(join(tmpdir(), 'dfsc-settings-focus-'));
  const runtime = join(profile, 'step-runtime');
  await mkdir(join(runtime, 'agent'), { recursive: true });
  await writeFile(join(runtime, 'agent', 'AGENTS.md'), 'Local form focus fixture.\n');
  await writeFile(join(runtime, 'config.toml'), '[telemetry]\nenabled = false\n');
  if (theme.startsWith('plugin:')) {
    await mkdir(join(runtime, 'plugins'), { recursive: true });
    await cp(resolve('../theme-marketplace/plugins/stellar-cruise'), join(runtime, 'plugins/stellar-cruise'), { recursive: true });
  }
  await writeFile(join(profile, 'preferences.json'), JSON.stringify({ language: 'zh', theme, themeMotion: false, workspaces: [] }));
  const env = { ...process.env, DESKTOP_TEST_USER_DATA: profile, DESKTOP_TEST_NO_FOCUS: '1' };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.STEP_API_KEY;
  const app = await electron.launch({ ...(executablePath ? { executablePath } : { args: [resolve('.')] }), env, timeout: 60000 });
  try {
    const page = await app.firstWindow();
    page.setDefaultTimeout(12000);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await app.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0];
      window.setOpacity(0);
      window.setIgnoreMouseEvents(true);
      window.showInactive();
      window.setMinimumSize(390, 540);
    });
    await page.locator('.sidebar-settings').waitFor();
    if (theme.startsWith('plugin:')) await page.locator('html[data-theme-material=stellar]').waitFor({ state: 'attached' });
    await page.locator('.sidebar-settings').click();
    const dialog = page.getByRole('dialog', { name: '设置', exact: true });
    const tab = name => dialog.getByRole('navigation').getByRole('button', { name, exact: true });
    const measure = field => field.evaluate(element => {
      const style = getComputedStyle(element), probe = document.createElement('span');
      const box = element.getBoundingClientRect();
      probe.style.color = 'var(--form-focus-color)';
      element.parentElement.append(probe);
      const expectedColor = getComputedStyle(probe).color;
      probe.remove();
      return { width: style.outlineWidth, offset: style.outlineOffset, color: style.outlineColor,
        expectedColor, border: style.borderColor, shadow: style.boxShadow, widthPx: box.width, heightPx: box.height,
        property: style.transitionProperty, duration: style.transitionDuration, curve: style.transitionTimingFunction };
    });
    for (const width of widths) {
      await app.evaluate(({ BrowserWindow }, width) => BrowserWindow.getAllWindows()[0].setContentSize(width, 840), width);
      await page.waitForFunction(width => innerWidth === width, width);
      const key = `${theme.replace(':', '-')}-${width}`;
      const check = async (field, name, pointer = true) => {
        await field.scrollIntoViewIfNeeded();
        const before = await measure(field);
        if (pointer) await field.click();
        else { await page.keyboard.press('Tab'); await field.focus(); }
        await assertFocusVisible(page, field, `${key}/${name}`, { focus: false });
        const after = await measure(field);
        assert.equal(after.width, '1px', `${key}/${name}: shared ring width`);
        assert.equal(after.offset, '2px', `${key}/${name}: shared ring offset`);
        assert.equal(after.color, after.expectedColor, `${key}/${name}: softened theme color`);
        for (const property of ['border', 'shadow', 'widthPx', 'heightPx'])
          assert.equal(after[property], before[property], `${key}/${name}: no additional border, shadow or resize`);
        results.push(`${key}/${name}`);
        await dialog.screenshot({ path: join(evidence, `${key}-${name}.png`) });
      };

      await tab('供应商').click();
      const model = dialog.getByLabel('模型 ID 1', { exact: true });
      if (!await model.count()) {
        const editor = dialog.locator('.provider-editor');
        if (!await editor.count()) {
          await dialog.getByRole('button', { name: '添加供应商', exact: true }).first().click();
          const custom = dialog.getByRole('button', { name: '创建自定义供应商', exact: true });
          if (await custom.count()) await custom.click();
        }
        await dialog.getByRole('button', { name: '添加模型', exact: true }).click();
      }
      await check(model, 'model-id');
      await check(dialog.getByLabel('API Key', { exact: true }), 'password');

      await tab('全局指令').click();
      await check(dialog.getByLabel('全局指令内容', { exact: true }), 'instructions');
      await tab('外观').click();
      await check(dialog.getByRole('spinbutton', { name: '代码字号', exact: true }), 'code-size');
      await check(dialog.getByRole('combobox', { name: '代码字体', exact: true }), 'font-select', false);
      await tab('会话迁移').click();
      const sources = dialog.getByRole('button', { name: '来源目录', exact: true });
      if (await sources.getAttribute('aria-expanded') !== 'true') await sources.click();
      const codex = dialog.getByLabel('Codex', { exact: true });
      await check(codex, 'migration-source');

      await page.emulateMedia({ reducedMotion: 'no-preference' });
      assert.equal((await measure(codex)).duration, '0.24s', `${key}: fade in`);
      const motion = await measure(codex);
      assert.equal(motion.property, 'outline-color');
      assert.equal(motion.curve, 'cubic-bezier(0.25, 0.65, 0.4, 1)');
      await codex.blur();
      assert.equal((await measure(codex)).duration, '0.18s', `${key}: fade out`);
      await page.emulateMedia({ reducedMotion: 'reduce', forcedColors: 'active' });
      await codex.focus();
      assert.equal((await measure(codex)).width, '2px', `${key}: forced colors remain visible`);
      await page.emulateMedia({ reducedMotion: 'reduce', forcedColors: 'none' });
    }
  } finally {
    await closeDesktopFixtureAndWait(app);
  }
}
await writeFile(join(evidence, 'results.json'), JSON.stringify({ executablePath, results }, null, 2) + '\n');
console.log(`PASS ${results.length} settings focus checks (light, dark, Stellar; wide and narrow).`);
