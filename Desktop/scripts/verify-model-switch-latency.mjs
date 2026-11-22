import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron as electron } from 'playwright';
import { closeDesktopFixtureAndWait } from './close-desktop-fixture.mjs';
import { waitForSessionFixtureSnapshot, waitForSessionFixtureTools } from './session-fixture.mjs';
import { mkdtemp } from './test-profile.mjs';

const profile = await realpath(await mkdtemp(join(tmpdir(), 'dfsc-model-switch-latency-')));
const root = join(profile, 'step-runtime'), sessions = join(root, 'sessions');
const requests = [];
const server = createServer(async (req, res) => {
  try {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    requests.push(JSON.parse(Buffer.concat(chunks)));
    const event = (delta, finish_reason) => `data: ${JSON.stringify({
      id: 'model-switch-fixture', object: 'chat.completion.chunk', created: 1, choices: [{ index: 0, delta, finish_reason }],
    })}\n\n`;
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.end(event({ role: 'assistant', content: 'Local fixture reply.' }, null) + event({}, 'stop') + 'data: [DONE]\n\n');
  } catch { res.writeHead(400).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let app;
try {
  await mkdir(sessions, { recursive: true });
  await writeFile(join(profile, 'preferences.json'), JSON.stringify({ language: 'zh', theme: 'dark', workspaces: [], autoCheckUpdates: false }));
  await writeFile(join(root, 'config.toml'), 'defaultProvider = "fixture"\ndefaultModel = "model-a"\n[telemetry]\nenabled = false\n[mcp_servers.steppage__steppage]\nenabled = false\n');
  const names = ['Model switch A', 'Model switch B'];
  await writeFile(join(root, 'models.json'), JSON.stringify({ providers: { fixture: {
    baseUrl: `http://127.0.0.1:${server.address().port}/v1`, api: 'openai-completions', apiKey: 'isolated-fixture',
    models: names.map((name, index) => ({ id: `model-${index ? 'b' : 'a'}`, name, contextWindow: 32768, maxTokens: 2048,
      reasoning: true, thinkingLevelMap: { minimal: null, low: 'low', medium: null, high: 'high', xhigh: null, max: null },
    })),
  } } }));
  const env = { ...process.env, DESKTOP_TEST_USER_DATA: profile, DESKTOP_TEST_NO_FOCUS: '1' };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.STEP_API_KEY;
  app = await electron.launch({
    ...(process.env.DESKTOP_VERIFY_EXE ? { executablePath: process.env.DESKTOP_VERIFY_EXE } : { args: [resolve('.')] }),
    env, timeout: 60000,
  });
  const page = await app.firstWindow();
  await app.evaluate(({ ipcMain, BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    window.setOpacity(0); window.setIgnoreMouseEvents(true); window.setSize(1400, 900); window.showInactive();
    const trace = globalThis.modelSwitchTrace = { scans: 0, snapshots: 0, commands: [] };
    const socket = process.getBuiltinModule('net').Socket.prototype, write = socket.write;
    socket.write = function (chunk, ...args) {
      if (typeof chunk === 'string' && chunk.endsWith('\n') && chunk.includes('"type":"sessions"')) trace.scans++;
      return write.call(this, chunk, ...args);
    };
    const invoke = ipcMain._invokeHandlers.get('desktop');
    ipcMain.removeHandler('desktop');
    ipcMain.handle('desktop', async (event, method, ...args) => {
      if (method === 'snapshot') trace.snapshots++;
      if (method === 'command' || method === 'createDraftSession') trace.commands.push(method === 'command' ? args[0] : method);
      if (method === 'command' && args[0] === 'set_model' && trace.blockNext) {
        trace.blockNext = false;
        await new Promise(resolve => { trace.release = resolve; trace.notifyBlocked(); });
      }
      return invoke(event, method, ...args);
    });
  });
  const snapshot = () => page.evaluate(() => window.desktop.snapshot());
  const readTrace = () => app.evaluate(() => {
    const { scans, snapshots, commands, release } = globalThis.modelSwitchTrace;
    return { scans, snapshots, commands, blocked: Boolean(release) };
  });
  const clear = () => app.evaluate(() => Object.assign(globalThis.modelSwitchTrace, { scans: 0, snapshots: 0, commands: [] }));
  const trigger = page.getByRole('button', { name: '模型与思考强度', exact: true });
  const option = target => page.locator('.model-picker-select').filter({ hasText: target });
  const openPicker = async () => {
    if (await trigger.getAttribute('aria-expanded') === 'false') await trigger.click();
    await page.getByRole('button', { name: '选择模型', exact: true }).click();
  };
  await trigger.waitFor();
  const original = await snapshot();
  assert.ok(original.draftId);
  assert.equal(original.sessions.length, 0);
  assert.ok((await readTrace()).scans > 0, 'the trace detects a real admin scan');

  const measure = async (phase, first = 1) => {
    await clear();
    const times = [];
    for (let i = 0; i < 20; i++) {
      const target = names[(i + first) % 2];
      await openPicker();
      times.push(await option(target).evaluate((button, target) => new Promise((resolve, reject) => {
        const started = performance.now();
        const root = button.closest('.model-effort');
        const observer = new MutationObserver(() => {
          if (root.querySelector('.model-effort-name')?.textContent !== target
            || root.querySelector('.models-view, .model-effort-pending')) return;
          observer.disconnect(); clearTimeout(timer); resolve(performance.now() - started);
        });
        const timer = setTimeout(() => { observer.disconnect(); reject(new Error('Model switch did not settle')); }, 10000);
        observer.observe(root, { childList: true, attributes: true, subtree: true });
        button.click();
      }), target));
    }
    const trace = await readTrace();
    assert.equal(trace.snapshots, 0, `${phase}: no full renderer snapshots`);
    assert.equal(trace.scans, 0, `${phase}: no admin history scans`);
    assert.equal(trace.commands.filter(type => type === 'set_model').length, 20);
    const p95 = [...times].sort((a, b) => a - b)[18];
    console.log(`${phase}: model picker selection p95 ${p95.toFixed(1)} ms, 20 clicks, zero snapshots and history scans`);
    return { times, p95, scans: trace.scans, snapshots: trace.snapshots };
  };
  const emptyDraft = await measure('empty draft, no history');
  for (let index = 0; index < 271; index++) {
    const id = `latency-fixture-${index}`, timestamp = new Date(Date.now() - index * 1000).toISOString();
    const history = [
      { type: 'session', version: 3, id, cwd: profile, timestamp },
      { type: 'message', id: 'user', parentId: null, timestamp,
        message: { role: 'user', content: [{ type: 'text', text: `Fixture ${index}\n${'Prior saved message. '.repeat(1500)}` }], timestamp: Date.parse(timestamp) } },
    ];
    await writeFile(join(sessions, `${id}.jsonl`), history.map(entry => JSON.stringify(entry)).join('\n') + '\n');
  }
  await page.reload();
  await trigger.waitFor();
  assert.equal((await snapshot()).sessions.length, 271);
  const populatedDraft = await measure('empty draft, 271 histories');
  assert.equal(requests.length, 0, 'picking a model never sends a prompt');
  const draft = await snapshot();
  const created = await page.evaluate(id => window.desktop.createDraftSession(id), draft.draftId);
  await page.reload();
  await waitForSessionFixtureTools(page, created.runtimeId);
  await trigger.waitFor();
  const idleSession = await measure('idle conversation, 271 histories');

  const slider = page.getByRole('slider', { name: '思考强度', exact: true });
  const displayedEffort = trigger.locator('.model-effort-level');
  const previousEffort = await displayedEffort.textContent();
  const key = await slider.getAttribute('aria-valuenow') === '0' ? 'End' : 'Home';
  await clear();
  await slider.press(key);
  await displayedEffort.filter({ hasNotText: previousEffort }).waitFor();
  const effort = await readTrace();
  assert.equal(effort.snapshots, 0, 'effort: no full renderer snapshots');
  assert.equal(effort.scans, 0, 'effort: no admin history scans');
  assert.equal(effort.commands.filter(type => type === 'set_thinking_level').length, 1);

  const input = page.locator('.composer > .composer-input');
  await input.fill('Use the selected model even when Enter follows a click.');
  await openPicker();
  await clear();
  await app.evaluate(() => {
    const trace = globalThis.modelSwitchTrace;
    trace.blockNext = true;
    trace.whenBlocked = new Promise(resolve => { trace.notifyBlocked = resolve; });
  });
  await option(names[1]).click();
  await app.evaluate(() => Promise.race([
    globalThis.modelSwitchTrace.whenBlocked,
    new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error('Model command never reached the gate')), 5000); timer.unref(); }),
  ]));
  await input.press('Enter');
  assert.equal((await readTrace()).commands.includes('prompt'), false, 'Enter cannot submit before the held choice');
  assert.equal(requests.length, 0);
  await app.evaluate(() => { const trace = globalThis.modelSwitchTrace; trace.release(); delete trace.release; });
  await waitForSessionFixtureSnapshot(page, state => !state.state.isStreaming
    && state.messages.some(message => message.role === 'assistant' && message.stopReason === 'stop'), 'the immediate send result');
  assert.deepEqual(requests.map(request => request.model), ['model-b']);
  await mkdir('test-results', { recursive: true });
  await writeFile('test-results/model-switch-latency.json', JSON.stringify({
    emptyDraft, populatedDraft, idleSession, effort: { scans: effort.scans, snapshots: effort.snapshots },
    immediateSendModel: requests[0].model,
  }, null, 2));
  console.log('Effort selection caused no snapshot or scan. Immediate Enter waited and used the newly selected model.');
} finally {
  if (app) await app.evaluate(() => globalThis.modelSwitchTrace?.release?.()).catch(() => {});
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  if (app) await closeDesktopFixtureAndWait(app);
}
