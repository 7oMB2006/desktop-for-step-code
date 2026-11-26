// Run with tsx. Uses the real conversation window and export implementation with
// synthetic sessions and a local substitute for Electron's native save dialog.
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { FeedbackPreview, feedbackReport } from '../electron/feedback-export.ts';
import { mkdtemp, removeTestProfile } from './test-profile.mjs';

const profile = await mkdtemp(join(tmpdir(), 'dfsc-feedback-ui-'));
const server = await createServer({ configFile: resolve('vite.theme-preview.config.mjs'),
  server: { host: '127.0.0.1', port: 0, hmr: false }, logLevel: 'error' });
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ executablePath: process.env.DESKTOP_TEST_CHROMIUM, headless: true });
  const page = await browser.newPage();
  page.setDefaultTimeout(12000);
  page.on('pageerror', error => console.error('Renderer:', error.message));
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/theme-pack.html?view=chat`);
  const more = page.getByRole('button', { name: '更多会话操作' });
  await more.waitFor({ timeout: 120000 });
  const sessionA = await page.evaluate(async () => (await window.desktop.snapshot()).state.sessionId);
  const messages = [{ role: 'user', content: 'MARKER_A' }, { role: 'toolResult', isError: true, content: 'Failure: fixture secret tail' }];
  let current = sessionA, preview, canceled = false;
  const target = join(profile, 'report.json.gz');
  await page.exposeFunction('fixturePreview', (runtimeId, sessionId, options) => {
    assert.equal(runtimeId, 'preview-' + current);
    assert.equal(sessionId, current);
    const content = feedbackReport(options, current === sessionA ? messages : [{ role: 'user', content: 'MARKER_B' }],
      { desktop: 'fixture', stepCode: null, platform: 'linux', arch: 'x64' }, 'req-fixture');
    preview = new FeedbackPreview('fixture', current, content);
    return { token: preview.token, content };
  });
  await page.exposeFunction('fixtureSave', (runtimeId, id, token) => {
    assert.equal(runtimeId, 'preview-' + current);
    assert.equal(id, current);
    return preview.save('fixture', id, token, async () => canceled ? undefined : target, () => assert.equal(current, id));
  });
  await page.evaluate(() => {
    window.desktop.previewFeedback = window.fixturePreview;
    window.desktop.saveFeedback = window.fixtureSave;
  });
  const requests = [];
  await page.route('**/*', route => { requests.push(route.request().url()); return route.abort(); });
  const open = async () => {
    await more.click();
    await page.getByRole('menuitemradio', { name: '导出反馈包' }).click();
  };
  const dialog = page.getByRole('dialog', { name: '导出反馈包' });
  await open();
  await dialog.getByRole('button', { name: '取消' }).click();
  assert.deepEqual(await readdir(profile), []);
  await open();
  await dialog.getByLabel('预期行为').fill('Expected synthetic result');
  await dialog.getByRole('button', { name: '预览' }).click();
  const minimal = await dialog.locator('pre').innerText();
  assert.deepEqual(JSON.parse(minimal).excerpts, []);
  await dialog.getByRole('button', { name: '另存为…' }).click();
  await dialog.waitFor({ state: 'hidden' });
  assert.equal(gunzipSync(await readFile(target)).toString(), minimal);
  await open();
  await dialog.getByLabel('包含相关会话片段').check();
  await dialog.getByLabel('包含失败工具输出片段').check();
  await dialog.getByRole('button', { name: '预览' }).click();
  const shown = await dialog.locator('pre').innerText();
  assert.match(shown, /MARKER_A/);
  messages.push({ role: 'user', content: 'LATE_A' }, { role: 'assistant', stopReason: 'error', content: 'New synthetic failure' });
  canceled = true;
  await dialog.getByRole('button', { name: '另存为…' }).click();
  await dialog.getByRole('button', { name: '另存为…' }).and(page.locator(':enabled')).waitFor();
  assert.equal(gunzipSync(await readFile(target)).toString(), minimal);
  canceled = false;
  await dialog.getByRole('button', { name: '另存为…' }).click();
  await dialog.waitFor({ state: 'hidden' });
  const saved = gunzipSync(await readFile(target)).toString();
  assert.equal(saved, shown);
  assert.doesNotMatch(saved, /LATE_A|MARKER_B|secret tail/);
  await open();
  await dialog.getByLabel('包含相关会话片段').check();
  await dialog.getByRole('button', { name: '预览' }).click();
  assert.match(await dialog.locator('pre').innerText(), /LATE_A/);
  // A different selected session invalidates this preview during native Save As.
  current = 'sample-controls';
  await dialog.getByRole('button', { name: '另存为…' }).click();
  await dialog.getByRole('alert').waitFor();
  assert.equal(gunzipSync(await readFile(target)).toString(), shown);
  assert.deepEqual(requests, []);
  console.log('Conversation menu, preview, cancel, diagnostics, frozen archive and session change passed.');
} finally {
  await browser?.close();
  await server.close();
  await removeTestProfile(profile);
}
