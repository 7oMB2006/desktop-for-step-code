import { _electron as electron } from 'playwright';
import { mkdir, mkdtemp, realpath, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';
import { closeDesktopFixture } from './close-desktop-fixture.mjs';

const label = process.env.DESKTOP_NAVIGATION_PERF_LABEL ?? 'current';
if (!/^[a-z0-9-]+$/i.test(label)) throw new Error('Invalid performance report label');
const profile = await realpath(await mkdtemp(join(process.env.DESKTOP_PERF_PROFILES ?? tmpdir(), 'desktop-navigation-perf-')));
const project = join(profile, 'project');
const root = join(profile, 'step-runtime');
const sessions = join(root, 'sessions');
await mkdir(project);
await mkdir(sessions, { recursive: true });
await mkdir('test-results', { recursive: true });
await writeFile(join(profile, 'preferences.json'), JSON.stringify({
  language: 'en', theme: 'light', workspaces: [project], workspace: project,
}));
await writeFile(join(root, 'config.toml'), 'defaultProvider = "fixture"\ndefaultModel = "fixture"\n[telemetry]\nenabled = false\n');
await writeFile(join(root, 'models.json'), JSON.stringify({ providers: {
  fixture: { baseUrl: 'http://127.0.0.1:1/v1', api: 'openai-completions', apiKey: 'local-test-only',
    models: [{ id: 'fixture', name: 'Navigation performance fixture' }] },
} }));
for (let index = 0; index < 8; index++) {
  const timestamp = new Date(Date.now() - 10000 - index * 1000).toISOString();
  const entries = [{ type: 'session', version: 3, id: `perf-${index}`, cwd: project, timestamp }];
  let parentId = null;
  for (let turn = 0; turn < 3; turn++) {
    const userId = `user-${turn}`, assistantId = `assistant-${turn}`;
    entries.push({ type: 'message', id: userId, parentId, timestamp,
      message: { role: 'user', content: [{ type: 'text', text: `Question ${index}/${turn}` }], timestamp: Date.parse(timestamp) } });
    entries.push({ type: 'message', id: assistantId, parentId: userId, timestamp,
      message: { role: 'assistant', content: [{ type: 'text', text: `PERF HISTORY ${index}/${turn}` }],
        api: 'openai-completions', provider: 'fixture', model: 'fixture', stopReason: 'stop',
        usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, timestamp: Date.parse(timestamp) } });
    parentId = assistantId;
  }
  entries.push({ type: 'session_info', id: 'name', parentId, timestamp, name: `Performance ${index}` });
  await writeFile(join(sessions, `perf-${index}.jsonl`), entries.map(entry => JSON.stringify(entry)).join('\n') + '\n');
}
const env = { ...process.env, DESKTOP_TEST_USER_DATA: profile, DESKTOP_TEST_NO_FOCUS: '1' };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ args: [resolve('.')], env, timeout: 60000 });
const samples = [], errors = [];
try {
  const page = await app.firstWindow();
  page.on('pageerror', error => errors.push(error.message));
  await app.evaluate(({ BrowserWindow, dialog }) => {
    const window = BrowserWindow.getAllWindows()[0];
    window.setOpacity(0); window.setIgnoreMouseEvents(true); window.showInactive();
    dialog.showMessageBox = async () => ({ response: 1 });
    // Fixture-only instrumentation records command names and durations, never payloads.
    const childProcess = process.getBuiltinModule('child_process');
    const spawn = childProcess.spawn;
    const trace = globalThis.navigationPerformance = { phase: 'startup', runtimes: [], commands: [] };
    childProcess.spawn = function (...args) {
      const child = spawn.apply(this, args);
      if (!args[1]?.includes('--mode') || !args[1]?.includes('rpc')) return child;
      const run = { phase: trace.phase, spawnAt: performance.now(), firstResponseMs: null, exited: false };
      trace.runtimes.push(run);
      const pending = new Map();
      const write = child.stdin.write;
      child.stdin.write = function (...values) {
        try {
          const command = JSON.parse(String(values[0]));
          if (command.id) pending.set(command.id, { command: command.type, at: performance.now(), phase: trace.phase });
        } catch {}
        return write.apply(this, values);
      };
      let buffered = '';
      child.stdout.on('data', chunk => {
        buffered += chunk.toString();
        let newline;
        while ((newline = buffered.indexOf('\n')) >= 0) {
          const line = buffered.slice(0, newline);
          buffered = buffered.slice(newline + 1);
          try {
            const value = JSON.parse(line), request = pending.get(value.id);
            if (!request || value.type !== 'response') continue;
            const at = performance.now();
            run.firstResponseMs ??= at - run.spawnAt;
            trace.commands.push({ phase: request.phase, command: request.command,
              elapsedMs: at - request.at, sinceSpawnMs: at - run.spawnAt, success: value.success });
            pending.delete(value.id);
          } catch {}
        }
      });
      child.once('exit', () => { run.exited = true; });
      return child;
    };
    globalThis.restoreNavigationSpawn = () => { childProcess.spawn = spawn; };
  });
  await page.waitForFunction(() => document.querySelectorAll('.session-row').length === 8
    && !document.querySelector('.new-chat')?.disabled, undefined, { timeout: 60000 });
  const measure = async (indices, phase) => {
    await app.evaluate((_, phase) => { globalThis.navigationPerformance.phase = phase; }, phase);
    const sample = await page.evaluate(async indices => {
      const target = indices.at(-1);
      const started = performance.now();
      let readableMs, editableMs, readyMs;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { observer.disconnect(); reject(new Error('Navigation performance sample timed out')); }, 60000);
        const inspect = () => {
          const messages = document.querySelector('#conversation-scroll .messages');
          if (messages?.textContent.includes(`PERF HISTORY ${target}/2`)) readableMs ??= performance.now() - started;
          const input = document.querySelector('.composer > .composer-input');
          if (document.querySelector('.window-session-title')?.textContent === `Performance ${target}` && input && !input.disabled)
            editableMs ??= performance.now() - started;
          if (editableMs !== undefined && document.querySelector('.composer-wrap')?.getAttribute('aria-busy') !== 'true')
            readyMs ??= performance.now() - started;
          if (readableMs === undefined || readyMs === undefined) return;
          observer.disconnect(); clearTimeout(timer);
          requestAnimationFrame(() => requestAnimationFrame(() => resolve({
            target, readableMs, editableMs, readyMs, paintedMs: performance.now() - started,
          })));
        };
        const observer = new MutationObserver(inspect);
        observer.observe(document.body, { subtree: true, childList: true, attributes: true });
        void (async () => {
          for (const index of indices) {
            document.querySelector(`[data-reorder-id="perf-${index}"] > button`).click();
            if (indices.length > 1) await new Promise(done => setTimeout(done, 40));
          }
          inspect();
        })().catch(reject);
      });
    }, indices);
    const snapshot = await page.evaluate(() => window.desktop.snapshot());
    assert.equal(snapshot.state.sessionId, `perf-${indices.at(-1)}`);
    samples.push({ phase, ...sample, startupTiming: snapshot.runtimeStartupTiming });
    console.log(`${phase}: readable ${Math.round(sample.readableMs)}ms, editable ${Math.round(sample.editableMs)}ms, ready ${Math.round(sample.readyMs)}ms`);
  };
  for (const index of [0, 1, 2]) await measure([index], `cold-${index}`);
  await measure([1], 'resident');
  await measure([3, 4, 5], 'rapid-latest');
  const trace = await app.evaluate(() => globalThis.navigationPerformance);
  const manifest = JSON.parse(await readFile('runtime/manifest.json', 'utf8'));
  const report = { label, node: process.version, platform: process.platform, runtimeCommit: manifest.commit, samples, trace };
  await writeFile(`test-results/session-navigation-performance-${label}.json`, JSON.stringify(report, null, 2));
  await page.screenshot({ path: `test-results/session-navigation-performance-${label}.png` });
  assert.deepEqual(errors, []);
  if (process.env.DESKTOP_NAVIGATION_REQUIRE_FAST_READING === '1') {
    for (const sample of samples.filter(sample => sample.phase.startsWith('cold-')))
      assert.ok(sample.readableMs < 500 && sample.readableMs + 100 < sample.readyMs,
        `Cold history should be readable independently of startup: ${JSON.stringify(sample)}`);
  }
} finally {
  await app.evaluate(() => globalThis.restoreNavigationSpawn?.()).catch(() => {});
  await closeDesktopFixture(app);
}
