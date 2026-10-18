import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { _electron as electron } from 'playwright';
import { resolveTheme, themes } from '../src/theme.ts';

const evidence = resolve(process.env.DESKTOP_PREVIEW_EVIDENCE ?? 'test-results/theme-cascade');
await mkdir(evidence, { recursive: true });
const profile = await mkdtemp(join(evidence, 'profile-'));
await writeFile(join(profile, 'preferences.json'), JSON.stringify({ language: 'zh', theme: 'jade', workspaces: [] }));
const env = { ...process.env, DESKTOP_TEST_USER_DATA: profile, DESKTOP_TEST_NO_FOCUS: '1' };
delete env.ELECTRON_RUN_AS_NODE;
delete env.STEP_API_KEY;
let app;
try {
  const executablePath = process.env.DESKTOP_VERIFY_EXE;
  app = await electron.launch({ ...(executablePath ? { executablePath } : { args: [resolve('.')] }), env, timeout: 60000 });
  const page = await app.firstWindow();
  await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    window.setOpacity(0);
    window.setIgnoreMouseEvents(true);
    window.showInactive();
  });
  await page.getByRole('heading', { name: /^(让想法阶跃星辰|星辰因你而阶跃)$/ }).waitFor();
  const checks = [];
  let surface = 'conversation';
  let testLateDefaults = false;
  const baseDefaults = (await readFile(resolve('src/style.css'), 'utf8')).split(/\r?\n/).slice(0, 2).join('\n');
  async function checkTheme(theme, accentColor = null) {
    await page.evaluate(patch => window.desktop.preferences(patch), { theme, accentColor });
    // Preferences IPC persists values; the Settings UI owns its React state update.
    await page.reload();
    await page.getByRole('heading', { name: /^(让想法阶跃星辰|星辰因你而阶跃)$/ }).waitFor();
    if (surface !== 'conversation') {
      await page.getByRole('button', { name: surface === 'usage' ? '用量统计' : '定时任务', exact: true }).click();
      await page.getByRole('heading', { name: surface === 'usage' ? '用量' : '定时任务', exact: true }).waitFor();
    }
    if (testLateDefaults) await page.addStyleTag({ content: baseDefaults });
    const expected = resolveTheme(theme, await page.evaluate(() => window.desktopTheme.systemDark), accentColor);
    await page.waitForFunction(({ id, scheme }) => document.documentElement.dataset.palette === id &&
      document.documentElement.dataset.theme === scheme, expected);
    await page.waitForFunction(tokens => {
      const probe = document.createElement('span');
      document.body.append(probe);
      const root = getComputedStyle(document.documentElement);
      const matches = Object.entries(tokens).every(([name, value]) => {
        probe.style.color = value;
        return root.getPropertyValue(name).trim() === getComputedStyle(probe).color;
      });
      probe.remove();
      return matches;
    }, expected.tokens, { timeout: 5000 }).catch(async error => {
      const actual = await page.evaluate(names => Object.fromEntries(names.map(name =>
        [name, getComputedStyle(document.documentElement).getPropertyValue(name).trim()])), Object.keys(expected.tokens));
      throw new Error(`${theme}/${accentColor}: palette mismatch: ${JSON.stringify({ expected: expected.tokens, actual })}`, { cause: error });
    });
    checks.push({ theme, accentColor, palette: expected.id });
  }
  await checkTheme('jade');
  await page.getByRole('button', { name: '用量统计', exact: true }).click();
  await page.locator('.usage-overview-preview').getByRole('heading', { name: '用量', exact: true }).waitFor();
  // A shared CSS chunk can load after theme.css in a multi-entry production build.
  surface = 'usage';
  testLateDefaults = true;
  for (const theme of ['system', ...themes.map(theme => theme.id)]) {
    await checkTheme(theme);
    await checkTheme(theme, '#12a080');
  }
  await checkTheme('wine');
  await page.screenshot({ path: join(evidence, 'usage-wine.png') });
  await page.getByRole('button', { name: '定时任务', exact: true }).click();
  await page.getByRole('heading', { name: '定时任务', exact: true }).waitFor();
  surface = 'cron';
  await checkTheme('blue', '#12a080');
  await page.getByRole('button', { name: '用量统计', exact: true }).click();
  await page.locator('.usage-overview-preview').getByRole('heading', { name: '用量', exact: true }).waitFor();
  surface = 'usage';
  await checkTheme('jade');
  await page.screenshot({ path: join(evidence, 'usage-jade.png') });
  await page.getByRole('button', { name: '返回会话', exact: true }).click();
  surface = 'conversation';
  await checkTheme('paper');
  await page.locator('.sidebar-bottom > button').click();
  await page.getByRole('button', { name: '外观', exact: true }).click();
  await page.getByRole('button', { name: themes.find(theme => theme.id === 'jade').name[0], exact: true }).click();
  await page.waitForFunction(() => document.documentElement.dataset.palette === 'jade');
  await page.waitForFunction(() => getComputedStyle(document.documentElement).getPropertyValue('--bg').trim() === 'rgb(20, 53, 44)');
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('dialog', { name: '设置', exact: true }).waitFor({ state: 'hidden' });
  await page.screenshot({ path: join(evidence, 'conversation-jade.png') });
  assert.equal((await page.evaluate(() => window.desktop.snapshot())).preferences.theme, 'jade');
  await writeFile(join(evidence, 'theme-checks.json'), JSON.stringify(checks, null, 2));
  console.log(`Theme cascade passed: ${checks.length} palette/accent checks, all nine tokens, late base CSS, Usage/Cron/conversation.`);
} finally {
  if (app) await app.close();
}
