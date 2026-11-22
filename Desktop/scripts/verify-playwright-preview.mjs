import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron } from 'playwright';
import { createServer as createViteServer } from 'vite';
import { prepareAgentPreviewFixture } from './agent-preview-fixture.mjs';
import { waitForBrowserFixtureSnapshot } from './browser-fixture.mjs';
import { submitSessionFixture } from './session-fixture.mjs';
import { mkdtemp } from './test-profile.mjs';

const tool = 'desktop_playwright';
const html = `<!doctype html><title>Playwright preview fixture</title><body style="margin:0">
    <canvas width="160" height="160"></canvas><label>Name <input></label>
    <button disabled>Apply example</button><p>Untouched</p><output></output><script type="module">
    import { marker } from './marker.js';
    const output = document.querySelector('output');
    output.textContent = marker;
    import.meta.hot.accept('./marker.js', next => { output.textContent = next.marker; });
    const gl = document.querySelector('canvas').getContext('webgl', { preserveDrawingBuffer: true });
    gl.clearColor(.1, .65, .25, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    document.querySelector('button').onclick = () => {
      document.querySelector('p').textContent = 'Applied: ' + document.querySelector('input').value;
      console.error('fixture-console-message');
      void fetch('/pulse?fixture-secret=mcp-diagnostics');
    };
    </script>`;
let backend;
let frontend;
let app;
let afterStart;
let afterClick;
let afterShow;
let afterHiddenShow;
let afterReconnect;
let releaseBackgroundPage;
let afterBackgroundConnect;
let failure;
let page;
const providerSteps = [];
const resultByOperation = new Map();
const contentText = content => typeof content === 'string' ? content
  : content?.filter(part => part.type === 'text').map(part => part.text).join('') ?? '';
const chunk = (delta, finish_reason = null) => `data: ${JSON.stringify({
  id: 'pw-preview-fixture', object: 'chat.completion.chunk', created: 1, model: 'fixture',
  choices: [{ index: 0, delta, finish_reason }],
})}\n\n`;
const listen = async server => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${server.address().port}`;
};
const close = async server => {
  if (!server?.listening) return;
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
};
const waitFor = async (read, description) => {
  for (let i = 0; i < 300; i++) {
    if (failure) throw failure;
    const output = await read();
    if (output) return output;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out: ${description}`);
};
const ref = (text, label) => {
  const line = text.split('\n').find(value => value.includes(label) && value.includes('[ref='));
  assert.ok(line, text);
  return /\[ref=(e\d+)\]/.exec(line)[1];
};
const profile = await mkdtemp(join(tmpdir(), 'step-playwright-preview-'));
try {
  const frontendRoot = join(profile, 'frontend');
  const marker = join(frontendRoot, 'marker.js');
  await mkdir(frontendRoot);
  await writeFile(join(frontendRoot, 'index.html'), html);
  await writeFile(marker, 'export const marker = "Initial Vite marker";\n');
  frontend = await createViteServer({ configFile: false, root: frontendRoot, logLevel: 'silent',
    server: { host: '127.0.0.1', port: 0, preTransformRequests: false },
    plugins: [{ name: 'fixture-network-response', configureServer(server) {
      server.middlewares.use((request, _response, next) => {
        if (request.url === '/?background-connect' && !releaseBackgroundPage) releaseBackgroundPage = next;
        else next();
      });
      server.middlewares.use('/pulse', (_request, response) => { response.writeHead(418).end(); });
    } }],
  });
  await frontend.listen();
  const origin = `http://127.0.0.1:${frontend.httpServer.address().port}`;
  const stoppedOperations = [
    ['start', () => ({ url: origin })],
    ['snapshot'],
    ['type', () => ({ ref: ref(resultByOperation.get('snapshot'), 'textbox "Name"'), text: 'Right sidebar' })],
    ['snapshot'],
    ['click', () => ({ ref: ref(resultByOperation.get('snapshot'), 'button "Apply example"') })],
    ['console'], ['network'], ['screenshot'], ['show'], ['show'], ['snapshot'], ['start', () => ({ url: origin })],
  ];
  const normalOperations = [['start', () => ({ url: origin })], ['snapshot']];
  const deniedOperations = [['start', () => ({ url: origin })]];
  const backgroundOperations = [['start', () => ({ url: `${origin}/?background-connect` })]];
  const stages = { stopped: 0, normal: 0, denied: 0, background: 0 };
  const scenarios = { stopped: stoppedOperations, normal: normalOperations, denied: deniedOperations, background: backgroundOperations };
  const pendingTools = new Map();
  backend = createServer(async (request, response) => {
    try {
      let data = '';
      for await (const body of request) data += body;
      const payload = JSON.parse(data);
      assert.ok(payload.tools?.some(entry => entry.function.name === tool), 'real Step Code must expose the tool');
      const user = payload.messages.findLast(message => message.role === 'user');
      const prompt = contentText(user?.content);
      const last = payload.messages.findLast(message => message.role === 'tool');
      // Context compaction can omit the latest user prompt from a tool continuation.
      const scenario = pendingTools.get(last?.tool_call_id) ?? (prompt.includes('normal handoff') ? 'normal'
        : prompt.includes('denied approval') ? 'denied' : prompt.includes('background connection') ? 'background' : 'stopped');
      const operations = scenarios[scenario];
      const stage = stages[scenario];
      providerSteps.push([scenario, stage, last?.tool_call_id]);
      if (stage > 0) {
        assert.equal(last?.tool_call_id, `pw-call-${scenario}-${stage - 1}`, 'expected the matching runtime tool result');
        pendingTools.delete(last.tool_call_id);
        resultByOperation.set(`${scenario === 'stopped' ? '' : `${scenario}:`}${operations[stage - 1][0]}`, contentText(last.content));
      }
      const complete = () => response.end(chunk({ role: 'assistant', content: `Fixture ${scenario} verification finished.` })
        + chunk({}, 'stop') + 'data: [DONE]\n\n');
      const send = () => {
        if (stage === operations.length) { complete(); return; }
        const [operation, args] = operations[stage];
        const id = `pw-call-${scenario}-${stage}`;
        pendingTools.set(id, scenario);
        stages[scenario]++;
        response.end(chunk({ tool_calls: [{ index: 0, id, type: 'function',
          function: { name: tool, arguments: JSON.stringify({ operation, ...args?.() }) } }] })
          + chunk({}, 'tool_calls') + 'data: [DONE]\n\n');
      };
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      if (scenario === 'stopped' && stage === 1) { response.write(chunk({ role: 'assistant' })); afterStart = send; }
      else if (scenario === 'stopped' && stage === 5) { response.write(chunk({ role: 'assistant' })); afterClick = send; }
      else if (scenario === 'stopped' && stage === 9) { response.write(chunk({ role: 'assistant' })); afterShow = send; }
      else if (scenario === 'stopped' && stage === 10) { response.write(chunk({ role: 'assistant' })); afterHiddenShow = send; }
      else if (scenario === 'stopped' && stage === stoppedOperations.length) {
        response.write(chunk({ role: 'assistant' })); afterReconnect = send;
      } else if (scenario === 'background' && stage === 1) {
        response.write(chunk({ role: 'assistant' })); afterBackgroundConnect = send;
      } else send();
    } catch (error) { failure = error; response.destroy(); }
  });
  const model = await listen(backend);
  const desktop = resolve('.');
  const executablePath = process.env.DESKTOP_VERIFY_EXE;
  if (!executablePath) await prepareAgentPreviewFixture(profile);
  const root = join(profile, 'step-runtime');
  await mkdir(join(root, 'sessions'), { recursive: true });
  await writeFile(join(profile, 'preferences.json'), JSON.stringify({ language: 'en', workspaces: [] }));
  await writeFile(join(root, 'config.toml'), 'defaultProvider = "fixture"\ndefaultModel = "fixture"\npermissionPreset = "ask"\n[telemetry]\nenabled = false\n[mcp_servers.steppage__steppage]\nenabled = false\n');
  await writeFile(join(root, 'models.json'), JSON.stringify({ providers: { fixture: { baseUrl: `${model}/v1`, api: 'openai-completions',
    apiKey: 'local-test-only', models: [{ id: 'fixture', name: 'Fixture', contextWindow: 32768, maxTokens: 2048 }] } } }));
  for (const id of ['playwright-a', 'playwright-b']) {
    const timestamp = new Date().toISOString();
    await writeFile(join(root, 'sessions', `${id}.jsonl`), [
      { type: 'session', version: 3, id, cwd: profile, timestamp },
      { type: 'message', id: 'seed', parentId: null, timestamp,
        message: { role: 'user', content: [{ type: 'text', text: id }], timestamp: Date.parse(timestamp) } },
    ].map(value => JSON.stringify(value)).join('\n') + '\n');
  }
  const env = { ...process.env, DESKTOP_TEST_USER_DATA: profile, DESKTOP_TEST_NO_FOCUS: '1' };
  delete env.ELECTRON_RUN_AS_NODE;
  if (executablePath) delete env.DESKTOP_EXPERIMENTAL_PLAYWRIGHT_PREVIEW;
  else env.DESKTOP_EXPERIMENTAL_PLAYWRIGHT_PREVIEW = '1';
  app = await _electron.launch({ ...(executablePath ? { executablePath, args: [] } : { args: [desktop] }),
    cwd: profile, env, timeout: 60_000 });
  if (executablePath) assert.equal(await app.evaluate(({ app }) => app.isPackaged), true);
  page = await app.firstWindow();
  page.setDefaultTimeout(15_000);
  await app.evaluate(({ BrowserWindow, app }) => {
    const window = BrowserWindow.getAllWindows()[0];
    const focus = [];
    globalThis.previewFixtureFocus = focus;
    app.on('browser-window-focus', () => focus.push('focus'));
    window.setOpacity(0);
    window.setIgnoreMouseEvents(true);
    window.showInactive();
    window.setSize(1500, 960);
  });
  await page.getByText('Step Code connected', { exact: true }).waitFor({ state: 'attached', timeout: 60_000 });
  await page.evaluate(() => {
    window.previewFixture = { confirmations: [], images: [], reveals: [] };
    window.desktop.onBrowserEvent(event => {
      if (event.type === 'open-preview') window.previewFixture.reveals.push(event.owner);
    });
    window.desktop.onEvent(event => {
      if (event.type === 'extension_ui_request' && event.title === 'Allow Playwright to test this local preview?')
        window.previewFixture.confirmations.push(event);
      if (event.type === 'tool_execution_end' && event.toolName === 'desktop_playwright')
        window.previewFixture.images.push(...event.result?.content?.filter(item => item.type === 'image') ?? []);
    });
  });
  const select = async id => {
    await page.locator(`[data-reorder-kind="session"][data-reorder-id="${id}"]`).locator('button').first().click();
    await waitForBrowserFixtureSnapshot(page, value => value.owner === `session:${id}`, id);
    await page.waitForFunction(() => !document.querySelector('.composer-wrap.session-navigation-pending'));
  };
  await select('playwright-a');
  const input = page.locator('.composer > .composer-input');
  await input.fill('Verify the local frontend with Playwright.');
  await submitSessionFixture(page, () => input.press('Enter'));
  const approval = page.getByRole('dialog', { name: 'Allow Playwright to test this local preview?', exact: true });
  await Promise.race([
    approval.waitFor(),
    waitFor(() => afterStart, 'approval or early tool failure').then(() => { throw new Error(resultByOperation.get('start')); }),
  ]);
  const stop = page.getByRole('button', { name: 'Stop Playwright testing', exact: true });
  const panel = page.getByRole('complementary', { name: 'Browser', exact: true });
  const rail = page.locator('button[aria-controls="browser-panel"]');
  const title = panel.getByRole('tab', { name: 'Playwright preview fixture', exact: true });
  const pulse = title.locator('.matrix-pulse');
  const playingPixel = pulse.locator('.matrix-executing .matrix-pixel').first();
  const reveals = () => page.evaluate(() => window.previewFixture.reveals);
  assert.equal(await panel.count(), 0, 'approval alone must not reveal the browser');
  assert.deepEqual(await reveals(), []);
  await approval.getByRole('button', { name: 'Confirm', exact: true }).click();
  await approval.waitFor({ state: 'hidden' });
  await waitFor(() => afterStart, 'Playwright start acknowledged');
  assert.match(resultByOperation.get('start'), /original preview tab/);
  const nativeTab = () => app.evaluate(({ BrowserWindow }, url) =>
    BrowserWindow.getAllWindows().flatMap(window => window.contentView.children).filter(view => view.webContents?.getURL() === url)
      .map(view => ({ id: view.webContents.id, visible: view.getVisible(), bounds: view.getBounds(),
        attached: view.webContents.debugger.isAttached() })), `${origin}/`);
  const pageState = id => app.evaluate(({ BrowserWindow }, id) => {
    const view = BrowserWindow.getAllWindows().flatMap(window => window.contentView.children).find(view => view.webContents?.id === id);
    return view.webContents.executeJavaScript(`({
      applied: document.querySelector('p').textContent,
      marker: document.querySelector('output').textContent,
    })`);
  }, id);
  await stop.waitFor();
  await page.waitForFunction(() => !document.querySelector('.browser-panel').getAnimations().some(item => item.playState === 'running'));
  const original = await waitFor(async () => {
    const [tab] = await nativeTab();
    return tab?.visible && tab.bounds.width > 0 ? tab : undefined;
  }, 'auto-revealed native guest');
  assert.ok(original, 'expected a native preview guest after approval');
  assert.equal(original.attached, true);
  assert.deepEqual(await reveals(), ['session:playwright-a']);
  assert.equal(await title.getAttribute('aria-description'), 'Playwright connected');
  assert.equal(await title.getAttribute('aria-selected'), 'true');
  assert.equal(await pulse.count(), 0);
  const colored = await title.locator('.browser-tab-title').evaluate(element => {
    const probe = document.createElement('span');
    probe.style.color = 'var(--primary)';
    document.body.append(probe);
    const matches = getComputedStyle(probe).color === getComputedStyle(element).color;
    probe.remove();
    return matches;
  });
  assert.ok(colored, 'the connected title must use the theme accent');
  const idleWidth = (await title.boundingBox()).width;
  afterStart();
  await waitFor(() => stages.stopped === 5, 'fixture requests the held click');
  await pulse.waitFor();
  assert.equal(await title.getAttribute('aria-description'), 'Agent is using this tab');
  assert.equal((await title.boundingBox()).width, idleWidth, 'the activity icon must not resize the tab');
  assert.equal(await playingPixel.evaluate(el => getComputedStyle(el).animationName), 'matrix-clockwise');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  assert.equal(await playingPixel.evaluate(el => getComputedStyle(el).animationName), 'none');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await app.evaluate(({ BrowserWindow }, id) => BrowserWindow.getAllWindows().flatMap(window => window.contentView.children)
    .find(view => view.webContents?.id === id).webContents.executeJavaScript("document.querySelector('button').disabled = false"), original.id);
  await waitFor(() => afterClick, 'foreground click completed');
  await pulse.waitFor({ state: 'hidden' });
  assert.equal((await pageState(original.id)).applied, 'Applied: Right sidebar');
  await select('playwright-b');
  afterClick();
  await waitFor(() => afterShow, 'background Playwright operations and show completed');
  assert.match(resultByOperation.get('console'), /fixture-console-message/);
  assert.match(resultByOperation.get('network'), /GET \/pulse \[418\]/);
  assert.doesNotMatch(resultByOperation.get('network'), /fixture-secret/);
  const shots = await page.evaluate(() => window.previewFixture.images);
  assert.equal(shots.length, 1, 'screenshot must go through the real Step Code tool result');
  const pixel = await app.evaluate(({ nativeImage }, data) => {
    const image = nativeImage.createFromBuffer(Buffer.from(data, 'base64'));
    return { size: image.getSize(), bgra: [...image.crop({ x: 30, y: 30, width: 1, height: 1 }).toBitmap()] };
  }, shots[0].data);
  assert.deepEqual(pixel.size, { width: original.bounds.width, height: original.bounds.height });
  assert.deepEqual(pixel.bgra, [64, 166, 25, 255]);
  assert.deepEqual(await page.evaluate(async () => (await window.desktop.browserList()).tabs), []);
  assert.equal(await panel.count(), 0);
  assert.deepEqual(await reveals(), ['session:playwright-a'], 'background Show must not steal the panel');
  assert.equal((await nativeTab())[0].visible, false);
  assert.deepEqual(await pageState(original.id), { applied: 'Applied: Right sidebar', marker: 'Initial Vite marker' });
  await writeFile(marker, 'export const marker = "Hot updated in the background";\n');
  for (let i = 0; i < 120; i++) {
    if ((await pageState(original.id)).marker === 'Hot updated in the background') break;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert.deepEqual(await pageState(original.id), { applied: 'Applied: Right sidebar', marker: 'Hot updated in the background' });
  await select('playwright-a');
  await stop.waitFor();
  await panel.getByRole('button', { name: 'Close browser panel' }).click();
  await panel.waitFor({ state: 'hidden' });
  assert.equal((await nativeTab())[0].attached, true, 'hiding the panel must not stop Playwright');
  afterShow();
  await waitFor(() => afterHiddenShow, 'legacy Show after manual close');
  assert.equal(await rail.getAttribute('aria-pressed'), 'false');
  assert.deepEqual(await reveals(), ['session:playwright-a'], 'legacy Show must respect manual closure');
  await rail.click();
  await stop.click();
  await stop.waitFor({ state: 'hidden' });
  assert.equal(await title.getAttribute('aria-description'), null, 'stopping returns the tab to ordinary chrome');
  const [retained] = await nativeTab();
  assert.equal(retained.id, original.id);
  assert.equal(retained.attached, false);
  assert.equal(retained.visible, true);
  assert.ok(retained.bounds.width > 0);
  assert.deepEqual(await pageState(original.id), { applied: 'Applied: Right sidebar', marker: 'Hot updated in the background' });
  await panel.getByRole('button', { name: 'Close browser panel' }).click();
  afterHiddenShow();
  await approval.getByRole('button', { name: 'Confirm', exact: true }).click();
  await waitFor(() => afterReconnect, 'same-turn reconnection acknowledged');
  assert.match(resultByOperation.get('start'), /connected to the original preview tab/);
  assert.equal(await rail.getAttribute('aria-pressed'), 'false');
  assert.deepEqual(await reveals(), ['session:playwright-a'], 'reconnecting in the same turn must not reveal twice');
  assert.equal((await nativeTab())[0].id, original.id);
  assert.equal((await nativeTab())[0].attached, true);
  afterReconnect();
  await page.getByText('Fixture stopped verification finished.', { exact: true }).waitFor();
  assert.match(resultByOperation.get('snapshot'), /No approved Playwright preview/);
  assert.equal(await page.evaluate(() => window.previewFixture.confirmations.length), 2);
  await input.fill('Verify normal handoff after the next local frontend check.');
  await submitSessionFixture(page, () => input.press('Enter'));
  await approval.waitFor();
  assert.equal((await nativeTab())[0].attached, false, 'the next turn must wait for a fresh approval');
  await approval.getByRole('button', { name: 'Confirm', exact: true }).click();
  await page.getByText('Fixture normal verification finished.', { exact: true }).waitFor();
  await stop.waitFor({ state: 'hidden' });
  assert.match(resultByOperation.get('normal:start'), /original preview tab/);
  assert.match(resultByOperation.get('normal:snapshot'), /Applied: Right sidebar/);
  assert.match(resultByOperation.get('normal:snapshot'), /Hot updated in the background/);
  assert.equal(await page.evaluate(() => window.previewFixture.confirmations.length), 3);
  assert.deepEqual(await reveals(), ['session:playwright-a', 'session:playwright-a'], 'the next turn can reveal after new approval');
  await panel.waitFor();
  assert.deepEqual(await nativeTab(), [retained]);
  await input.fill('Verify denied approval in a later local turn.');
  await submitSessionFixture(page, () => input.press('Enter'));
  await approval.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByText('Fixture denied verification finished.', { exact: true }).waitFor();
  assert.match(resultByOperation.get('denied:start'), /not approved/);
  assert.equal(await page.evaluate(() => window.previewFixture.confirmations.length), 4);
  assert.equal((await reveals()).length, 2, 'denial must not reveal another panel');
  assert.deepEqual(await nativeTab(), [retained]);

  await panel.getByRole('button', { name: 'Close browser panel' }).click();
  await input.fill('Verify a background connection in the browser.');
  await submitSessionFixture(page, () => input.press('Enter'));
  await approval.getByRole('button', { name: 'Confirm', exact: true }).click();
  await waitFor(() => releaseBackgroundPage, 'held local page loading');
  assert.equal(await rail.getAttribute('aria-pressed'), 'false', 'approval has not yet made a connection');
  await select('playwright-b');
  releaseBackgroundPage();
  await waitFor(() => afterBackgroundConnect, 'approved connection made while viewing B');
  assert.equal(await rail.getAttribute('aria-pressed'), 'false');
  assert.deepEqual(await page.evaluate(async () => (await window.desktop.browserList()).tabs), []);
  await select('playwright-a');
  await stop.waitFor();
  assert.match(await panel.getByRole('textbox', { name: 'Web address' }).inputValue(), /background-connect/);
  assert.deepEqual(await reveals(), Array(3).fill('session:playwright-a'));
  afterBackgroundConnect();
  await page.getByText('Fixture background verification finished.', { exact: true }).waitFor();
  await stop.waitFor({ state: 'hidden' });
  assert.deepEqual(await app.evaluate(() => globalThis.previewFixtureFocus), []);
  console.log('Playwright preview: approval, one reveal per turn, busy and reduced-motion indicators, background WebGL and HMR, and same-tab stop and completion passed.');
} catch (error) {
  if (failure) console.error('Fixture provider failed:', failure);
  console.error('Fixture provider steps:', providerSteps);
  console.error('Fixture tool results:', [...resultByOperation].map(([operation, text]) => [operation, text.slice(0, 200)]));
  if (page) console.error('Fixture conversation tail:', (await page.locator('.messages').innerText({ timeout: 2000 }).catch(() => '')).slice(-2200));
  console.error(error);
  await app?.evaluate(({ app }) => { setTimeout(() => app.exit(1), 50).unref(); }).catch(() => {});
  throw error;
} finally {
  if (backend?.listening) backend.closeAllConnections();
  try { await app?.close(); }
  finally { await Promise.all([frontend?.close(), close(backend)]); }
}
