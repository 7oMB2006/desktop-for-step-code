import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { mkdtemp } from './test-profile.mjs';
import { closeDesktopFixtureAndWait } from './close-desktop-fixture.mjs';

const profile = await mkdtemp(join(tmpdir(), 'desktop-model-catalog-'));
await writeFile(join(profile, 'preferences.json'), JSON.stringify({ language: 'zh', theme: 'dark', workspaces: [] }));
let listing = { data: [{ id: 'catalog-fixture' }, { id: 'catalog-fixture-latest' }] };
const server = createServer((req, res) => {
  assert.equal(req.url, '/v1/models');
  assert.equal(req.headers.authorization, 'Bearer catalog-synthetic-key');
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify(listing));
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const baseUrl = `http://127.0.0.1:${server.address().port}/v1`;
const env = { ...process.env, DESKTOP_TEST_USER_DATA: profile, DESKTOP_TEST_NO_FOCUS: '1' };
delete env.ELECTRON_RUN_AS_NODE;
let app, page;
const errors = [];
const resultDir = resolve('test-results/model-catalog');
await mkdir(resultDir, { recursive: true });
try {
  app = await electron.launch({ ...(process.env.DESKTOP_VERIFY_EXE ? { executablePath: process.env.DESKTOP_VERIFY_EXE } : { args: [resolve('.')] }), env, timeout: 60000 });
  page = await app.firstWindow();
  page.on('pageerror', error => errors.push(error.message));
  await app.evaluate(({ BrowserWindow, session }) => {
    const window = BrowserWindow.getAllWindows()[0];
    window.setOpacity(0); window.setIgnoreMouseEvents(true); window.showInactive(); window.setSize(1360, 900);
    globalThis.catalogFixture = { calls: 0, fail: true };
    session.defaultSession.protocol.handle('https', request => {
      if (request.url !== 'https://models.dev/api.json') return new Response('', { status: 503 });
      const fixture = globalThis.catalogFixture;
      fixture.calls++;
      if (request.headers.has('authorization') || request.headers.has('x-api-key') || request.headers.has('cookie')) throw new Error('Catalog received credentials');
      return fixture.fail ? new Response('', { status: 503 }) : Response.json({
        openai: { models: { 'catalog-fixture': {
          limit: { context: 256000, output: 32000 }, modalities: { input: ['text', 'image'], output: ['text'] },
          reasoning_options: [{ type: 'effort', values: ['none', 'low', 'high'] }],
        } } },
      });
    });
  });
  await page.waitForFunction(() => document.querySelector('.composer .composer-input') && !document.querySelector('.composer-wrap[aria-busy="true"]'));
  await page.locator('.sidebar-settings').click();
  await page.getByRole('button', { name: '供应商', exact: true }).click();
  await page.getByRole('button', { name: '添加供应商', exact: true }).first().click();
  await page.getByRole('button', { name: '创建自定义供应商', exact: true }).click();
  await page.getByLabel('名称', { exact: true }).fill('Catalog fixture');
  await page.getByLabel('Base URL', { exact: true }).fill(baseUrl);
  await page.getByLabel('API Key', { exact: true }).fill('catalog-synthetic-key');
  const fetchModels = async () => {
    await page.getByRole('button', { name: '从上游获取', exact: true }).click();
    await page.locator('.provider-discovery').waitFor();
  };
  await fetchModels();
  assert.equal(await app.evaluate(() => globalThis.catalogFixture.calls), 0, 'unbound relay never requests public catalog');
  await page.getByRole('button', { name: '关闭模型列表', exact: true }).click();
  await page.getByRole('button', { name: /公共模型目录/ }).click();
  await page.getByRole('menuitemradio', { name: 'OpenAI', exact: true }).click();
  await fetchModels();
  await page.getByText('公共目录暂不可用，仅显示上游结果。', { exact: true }).waitFor();
  assert.equal(await page.locator('.provider-discovery label').count(), 2);
  await page.getByRole('button', { name: '关闭模型列表', exact: true }).click();
  await app.evaluate(() => { globalThis.catalogFixture.fail = false; });
  await fetchModels();
  const choice = page.locator('.provider-discovery label').filter({ hasText: /^catalog-fixture思考/ });
  await choice.getByRole('checkbox').check();
  assert.match(await choice.textContent(), /models.dev.*精确匹配/);
  const unmatched = page.locator('.provider-discovery label').filter({ hasText: 'catalog-fixture-latest' });
  assert.doesNotMatch(await unmatched.textContent(), /models.dev/);
  await page.locator('.provider-discovery').getByRole('button', { name: '加入 1', exact: true }).click();
  await page.locator('.provider-model-advanced > summary').first().click();
  assert.equal(await page.getByLabel('上下文容量 1', { exact: true }).inputValue(), '256000');
  assert.match(await page.locator('.provider-thinking-control').textContent(), /models.dev.*接口未验证/);
  await page.getByLabel('上下文容量 1', { exact: true }).fill('64000');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await page.getByText('已保存', { exact: true }).waitFor();
  let saved = (await page.evaluate(() => window.desktop.settings())).providers[0];
  assert.equal(saved.catalogProvider, 'openai');
  assert.equal(saved.models[0].capabilitySources.contextWindow, 'manual');
  assert.equal(saved.models[0].thinkingControl.mapping.off, 'none');
  assert.equal(saved.models[0].thinkingControl.source, 'catalog');
  await fetchModels();
  await page.locator('.provider-discovery label').filter({ hasText: /^catalog-fixture思考/ }).getByRole('checkbox').check();
  await page.locator('.provider-discovery').getByRole('button', { name: '应用 1', exact: true }).click();
  assert.equal(await page.getByLabel('上下文容量 1', { exact: true }).inputValue(), '64000');
  assert.equal(await app.evaluate(() => globalThis.catalogFixture.calls), 2, 'one failed catalog read plus one cached success');
  await page.locator('.provider-thinking-control').scrollIntoViewIfNeeded();
  await page.screenshot({ path: join(resultDir, 'dark.png') });
  const reloadPreferences = async patch => {
    await page.evaluate(patch => window.desktop.preferences(patch), patch);
    await page.reload();
    await page.waitForFunction(() => document.querySelector('.composer .composer-input') && !document.querySelector('.composer-wrap[aria-busy="true"]'));
    const en = patch.language === 'en';
    await page.locator('.sidebar-settings').click();
    await page.getByRole('button', { name: en ? 'Providers' : '供应商', exact: true }).click();
    await page.locator('.provider-model-advanced > summary').first().click();
    await page.locator('.provider-thinking-control').scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
  };
  await reloadPreferences({ theme: 'light' });
  assert.equal(await page.locator('html').getAttribute('data-theme'), 'light');
  await page.screenshot({ path: join(resultDir, 'light.png') });
  await reloadPreferences({ language: 'en' });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(640, 780));
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(resultDir, 'narrow-en.png') });
  assert.equal(await page.locator('.provider-editor').evaluate(element => element.scrollWidth > element.clientWidth), false);
  await page.locator('.provider-thinking-control').scrollIntoViewIfNeeded();
  await page.screenshot({ path: join(resultDir, 'narrow-en-details.png') });
  await page.getByLabel('Model ID 1', { exact: true }).fill('changed-model');
  assert.equal(await page.getByLabel('Context window 1', { exact: true }).inputValue(), '64000');
  assert.equal(await page.getByLabel('Max output 1', { exact: true }).inputValue(), '');
  assert.equal(await page.locator('.provider-thinking-declared').count(), 0);
  assert.equal(errors.length, 0, errors.join('\n'));
  await writeFile(join(resultDir, 'results.json'), JSON.stringify({
    passed: true, packaged: Boolean(process.env.DESKTOP_VERIFY_EXE), catalogRequests: await app.evaluate(() => globalThis.catalogFixture.calls),
    scope: 'Isolated Electron fixture: explicit relay binding, unavailable catalog fallback, exact-only matching, mapping persistence, manual refresh, cache, identity invalidation, Chinese/English and dark/light/narrow UI. No paid provider.',
  }, null, 2));
  console.log('Model catalog Electron acceptance passed.');
} catch (error) {
  if (page && !page.isClosed()) {
    console.error((await page.locator('.settings-content').innerText().catch(() => '')).slice(0, 4000));
    await page.screenshot({ path: join(resultDir, 'failure.png') }).catch(() => {});
  }
  throw error;
} finally {
  if (app) await closeDesktopFixtureAndWait(app);
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}
