import { _electron as electron } from 'playwright';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { mkdtemp } from './test-profile.mjs';
import { tmpdir, cpus, totalmem } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';
import { readingHistory } from '../tests/fixtures/session-reading-history.mjs';
import { closeDesktopFixtureAndWait } from './close-desktop-fixture.mjs';

const profile = await mkdtemp(join(tmpdir(), 'desktop-session-reading-'));
const project = join(profile, 'project'), root = join(profile, 'step-runtime');
const sessions = join(root, 'sessions'), file = join(sessions, 'large.jsonl');
const started = join(profile, 'mcp-started.log');
const output = resolve(process.env.DESKTOP_VERIFY_OUTPUT ?? 'test-results');
await mkdir(project);
await mkdir(sessions, { recursive: true });
await mkdir(output, { recursive: true });
const before = Buffer.from(readingHistory(project));
await writeFile(file, before);
await writeFile(join(profile, 'preferences.json'), JSON.stringify({
  language: 'zh', theme: 'light', workspaces: [project], workspace: project,
}));
const config = never => [
  'defaultProvider = "fixture"', 'defaultModel = "fixture"', '[telemetry]', 'enabled = false',
  '[mcp_servers.startup_fixture]', 'enabled = true', 'startup_timeout_sec = 180',
  `command = ${JSON.stringify(resolve('runtime/node', process.platform === 'win32' ? 'node.exe' : 'node'))}`,
  `args = [${JSON.stringify(resolve('tests/fixtures/startup-mcp.mjs'))}]`,
  '[mcp_servers.startup_fixture.env]', `FIXTURE_MCP_STARTED = ${JSON.stringify(started)}`,
  `FIXTURE_MCP_NEVER = "${never ? 1 : 0}"`,
].join('\n') + '\n';
await writeFile(join(root, 'config.toml'), config(true));
await writeFile(join(root, 'models.json'), JSON.stringify({ providers: { fixture: {
  baseUrl: 'http://127.0.0.1:1/v1', api: 'openai-completions', apiKey: 'fixture-not-a-real-key',
  models: [{ id: 'fixture', name: 'Reading fixture', contextWindow: 32768, maxTokens: 1024 }],
} } }));
const env = { ...process.env, DESKTOP_TEST_USER_DATA: profile, DESKTOP_TEST_NO_FOCUS: '1' };
delete env.ELECTRON_RUN_AS_NODE;
const executablePath = process.env.DESKTOP_VERIFY_EXE;
const app = await electron.launch({ ...(executablePath ? { executablePath } : { args: [resolve('.')] }), env, timeout: 60000 });
let phase = 'startup';
const errors = [], samples = [], memorySamples = [];
const sampleCount = Number(process.env.DESKTOP_READING_SAMPLES ?? 3);
assert.ok(Number.isSafeInteger(sampleCount) && sampleCount > 0);
try {
  const page = await app.firstWindow();
  page.on('pageerror', error => errors.push(error.message));
  await app.evaluate(({ BrowserWindow, dialog }) => {
    const window = BrowserWindow.getAllWindows()[0];
    window.setOpacity(0); window.setIgnoreMouseEvents(true); window.showInactive();
    dialog.showMessageBox = async () => ({ response: 1 });
    // Preserve legacy-runtime coverage after the Desktop manifest opts in.
    const childProcess = process.getBuiltinModule('child_process'), spawn = childProcess.spawn;
    childProcess.spawn = function (command, args, options) {
      if (options?.env?.DFSC_ASYNC_STARTUP_V1 === '1') {
        const env = { ...options.env };
        delete env.DFSC_ASYNC_STARTUP_V1;
        options = { ...options, env };
      }
      return spawn.call(this, command, args, options);
    };
  });
  const row = () => page.locator('[data-reorder-id="reading-large"] > button').first();
  const readyShell = () => page.waitForFunction(() => document.querySelectorAll('.session-row').length === 1
    && !document.querySelector('.new-chat')?.disabled, undefined, { timeout: 60000 });
  await readyShell();
  phase = `${sampleCount} cold read/paint samples while the legacy MCP never responds`;
  for (let index = 0; index < sampleCount; index++) {
    if (index) { await page.reload(); await readyShell(); }
    const start = performance.now();
    await row().click();
    await page.waitForFunction(() => document.querySelector('.session-reading-preview')?.textContent.includes('READING_HISTORY_END'),
      undefined, { timeout: 10000 });
    samples.push(performance.now() - start);
    assert.equal(await page.locator('.session-reading-preview').evaluate(element => element.textContent.includes('ABANDONED_BRANCH_MUST_NOT_APPEAR')), false);
    assert.ok(await page.locator('.composer-action-button').isDisabled());
    memorySamples.push({
      electron: await app.evaluate(({ app }) => ({
        mainBytes: process.memoryUsage(),
        processesKiB: app.getAppMetrics().map(({ type, memory }) => ({ type, memory })),
      })),
      rendererHeapBytes: await page.evaluate(() => performance.memory ? {
        used: performance.memory.usedJSHeapSize, total: performance.memory.totalJSHeapSize,
      } : null),
    });
  }
  assert.equal((await readFile(started, 'utf8')).trim().split('\n').length, 1,
    'Preview and renderer reloads must not create agents or additional MCP connections');
  assert.deepEqual(await readFile(file), before, 'Reading cannot append or repair the target history');
  const cold = await page.evaluate(() => window.desktop.snapshot());
  assert.notEqual(cold.state?.sessionId, 'reading-large', 'Readable preview cannot acquire authoritative identity');
  const input = page.getByRole('textbox', { name: '消息', exact: true });
  await input.fill('Draft survives an actual MCP startup timeout');
  await input.press('Enter');
  assert.equal(await input.evaluate(element => element.value), 'Draft survives an actual MCP startup timeout');
  await assert.rejects(page.evaluate(() => window.desktop.command('prompt', { message: 'MUST_NOT_EXECUTE' })), /read-only/);
  await assert.rejects(page.evaluate(() => window.desktop.command('abort')), /read-only/);
  await page.screenshot({ path: join(output, 'session-reading-connecting.png') });
  phase = 'real Desktop startup deadline retains history, draft and retry';
  await page.waitForFunction(() => document.querySelector('.session-reading-status')?.textContent.includes('运行时未连接'),
    undefined, { timeout: 75000 });
  assert.ok((await page.locator('.session-reading-preview').textContent()).includes('READING_HISTORY_END'));
  assert.equal(await input.evaluate(element => element.value), 'Draft survives an actual MCP startup timeout');
  assert.ok(await page.locator('.composer-action-button').isDisabled());
  assert.equal(await page.locator('.conversation').getAttribute('aria-busy'), 'false');
  assert.equal(await page.locator('.session-navigation-spinner').count(), 0, 'Failure is not an infinite loading spinner');
  await assert.rejects(page.evaluate(() => window.desktop.command('prompt', { message: 'MUST_NOT_EXECUTE_AFTER_FAILURE' })), /read-only/);
  assert.deepEqual(await readFile(file), before);
  phase = 'dark English narrow reduced-motion failure view';
  await page.evaluate(() => window.desktop.preferences({ theme: 'dark', language: 'en' }));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(700, 700));
  await page.getByRole('button', { name: 'Reconnect conversation', exact: true }).waitFor();
  await page.screenshot({ path: join(output, 'session-reading-failed-narrow.png') });
  assert.ok(await page.locator('.composer-input').evaluate(element => {
    const box = element.getBoundingClientRect();
    return box.left >= 0 && box.right <= innerWidth && box.top >= 0 && box.bottom <= innerHeight;
  }));
  phase = 'explicit reconnect after fixing only the disposable MCP fixture';
  await writeFile(join(root, 'config.toml'), config(false));
  await page.getByRole('button', { name: 'Reconnect conversation', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('.session-reading-status')
    && !document.querySelector('.session-reading-preview')
    && document.querySelector('.window-session-title')?.textContent === 'Reading large'
    && !document.querySelector('.composer-input')?.disabled, undefined, { timeout: 60000 });
  const restored = await page.evaluate(() => window.desktop.snapshot());
  assert.equal(restored.state?.sessionId, 'reading-large');
  assert.equal(await page.getByRole('textbox', { name: 'Message', exact: true }).evaluate(element => element.value),
    'Draft survives an actual MCP startup timeout');
  assert.ok((await readFile(file)).subarray(0, before.length).equals(before), 'Normal runtime append cannot rewrite the original prefix');
  assert.ok(!(await page.locator('.messages').textContent()).includes('MUST_NOT_EXECUTE'));
  assert.deepEqual(errors, []);
  const ordered = [...samples].sort((a, b) => a - b);
  const result = { sourceBytes: before.length, samples, medianMs: ordered[Math.floor(sampleCount / 2)],
    p95Ms: ordered[Math.ceil(sampleCount * .95) - 1], startupProtocol: 'legacy',
    cpu: cpus()[0]?.model, totalmem: totalmem(), memorySamples,
    memorySampling: 'After DOM-ready readability check, not peak memory; Chromium JS heap values may be rounded.',
    realMcpTimeout: true, retry: true, rendererErrors: errors };
  await writeFile(join(output, 'session-reading-results.json'), JSON.stringify(result, null, 2));
  if (process.env.DESKTOP_ASSERT_READING_PERFORMANCE === '1')
    assert.ok(result.p95Ms <= 3000, `First readable paint P95 ${result.p95Ms}ms exceeds the controlled local target`);
  console.log(JSON.stringify(result));
} catch (error) {
  console.error('Session reading acceptance failed during:', phase);
  const page = await app.firstWindow().catch(() => null);
  if (page) {
    await page.screenshot({ path: join(output, 'session-reading-failure.png') }).catch(() => {});
    console.error(await page.evaluate(() => ({
      error: document.querySelector('.app-error-banner')?.textContent,
      status: document.querySelector('.session-reading-status')?.textContent,
      title: document.querySelector('.window-session-title')?.textContent,
    })).catch(() => null));
  }
  throw error;
} finally { await closeDesktopFixtureAndWait(app); }
