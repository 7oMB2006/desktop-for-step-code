import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron as electron } from 'playwright';

const streams = new Set();
let requestCount = 0;
const chunk = (delta, finish_reason = null, usage) => `data: ${JSON.stringify({
  id: 'performance-fixture', object: 'chat.completion.chunk', created: 1, model: 'fixture',
  choices: [{ index: 0, delta, finish_reason }], ...(usage ? { usage } : {}),
})}\n\n`;
const server = createServer(async (req, res) => {
  for await (const part of req) { /* Drain the isolated model request. */ }
  requestCount++;
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  await new Promise(resolve => setTimeout(resolve, 700));
  if (res.destroyed) return;
  res.write(chunk({ role: 'assistant', reasoning_content: '先确认结构。' }));
  let ticks = 0;
  const timer = setInterval(() => {
    ticks++;
    res.write(chunk({ content: '继续核验。' }));
    if (ticks === 3) {
      clearInterval(timer);
      res.end(chunk({}, 'stop', { prompt_tokens: 1000, completion_tokens: 48, total_tokens: 1048, prompt_tokens_details: { cached_tokens: 800 } }) + 'data: [DONE]\n\n');
    }
  }, 700);
  streams.add(res);
  res.on('close', () => { clearInterval(timer); streams.delete(res); });
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const profile = await mkdtemp(join(tmpdir(), 'desktop-performance-'));
const root = join(profile, 'step-runtime');
await mkdir(root, { recursive: true });
await mkdir('test-results', { recursive: true });
await writeFile(join(profile, 'preferences.json'), JSON.stringify({ theme: 'dark', language: 'zh', workspaces: [], autoCheckUpdates: false }));
await writeFile(join(root, 'config.toml'), 'defaultProvider = "fixture"\ndefaultModel = "fixture"\npermissionPreset = "ask"\n[telemetry]\nenabled = false\n');
await writeFile(join(root, 'models.json'), JSON.stringify({ defaultProvider: 'fixture', defaultModel: 'fixture',
  providers: { fixture: { baseUrl: `http://127.0.0.1:${server.address().port}/v1`, api: 'openai-completions', apiKey: 'isolated-test',
    models: [{ id: 'fixture', name: 'Performance fixture', contextWindow: 32768, maxTokens: 2048 }] } } }));
const env = { ...process.env, DESKTOP_TEST_USER_DATA: profile, DESKTOP_TEST_NO_FOCUS: '1' };
delete env.ELECTRON_RUN_AS_NODE;
let app;
try {
  app = await electron.launch({ ...(process.env.DESKTOP_VERIFY_EXE ? { executablePath: process.env.DESKTOP_VERIFY_EXE } : { args: [resolve('.')] }), env, timeout: 60000 });
  const page = await app.firstWindow();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    win.setOpacity(0); win.setIgnoreMouseEvents(true); win.showInactive(); win.setSize(1280, 900);
  });
  const input = page.getByRole('textbox', { name: '消息', exact: true });
  await input.waitFor();
  await page.waitForFunction(() => !document.querySelector('.composer-input')?.disabled);
  assert.equal(await page.locator('.performance-metric').count(), 4);
  const values = page.locator('.performance-metric > strong');
  assert.equal(await values.nth(0).innerText(), '—');
  assert.equal(await values.nth(1).innerText(), '—');
  await input.fill('回复一段测试文字，不调用任何工具。');
  await input.press('Enter');
  await page.locator('.working .matrix-pulse').waitFor();
  await page.locator('.working-elapsed').waitFor();
  await page.waitForFunction(() => document.querySelector('.working .matrix-pulse')?.dataset.mode === 'responding');
  await page.waitForFunction(() => document.querySelector('.working .matrix-pulse')?.dataset.mode === 'thinking');
  assert.equal(await values.nth(1).innerText(), '—', 'no speed guessed before reported final usage');
  await page.screenshot({ path: 'test-results/performance-runtime-running-dark.png' });
  await page.waitForFunction(() => document.querySelector('.working .matrix-pulse')?.dataset.mode === 'executing');
  await page.waitForFunction(() => !document.querySelector('.working-indicator'), undefined, { timeout: 60000 });
  await page.waitForFunction(() => document.querySelectorAll('.performance-metric > strong')[1].textContent.includes('tok/s'));
  const speed = parseFloat(await values.nth(1).innerText());
  assert.ok(speed > 10 && speed < 80, `real RPC speed must reflect streamed usage, got ${speed}`);
  assert.equal(await values.nth(2).innerText(), '1K / 48');
  assert.equal(await values.nth(3).innerText(), '80%');
  const finished = await page.locator('.performance-summary').innerText();
  await page.waitForTimeout(1100);
  assert.equal(await page.locator('.performance-summary').innerText(), finished);
  await page.screenshot({ path: 'test-results/performance-runtime-complete-dark.png' });
  await page.locator('.new-chat').click();
  await page.waitForFunction(() => document.querySelectorAll('.performance-metric > strong')[1].textContent === '—');
  assert.equal(requestCount, 1);
  assert.deepEqual(errors, []);
  console.log('Built renderer + real pinned RPC: thinking-to-prose mode switch, running clock, reported TPS, tokens/cache, completion freeze and new-session reset passed.');
} finally {
  if (app) await app.close();
  for (const stream of streams) stream.destroy();
  await new Promise(resolve => server.close(resolve));
}
