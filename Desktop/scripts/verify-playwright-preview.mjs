import assert from 'node:assert/strict';
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron } from 'playwright';
import { createServer as createViteServer } from 'vite';
import { prepareAgentPreviewFixture } from './agent-preview-fixture.mjs';
import { waitForBrowserFixtureSnapshot } from './browser-fixture.mjs';
import { submitSessionFixture } from './session-fixture.mjs';
import { mkdtemp } from './test-profile.mjs';
import { outsideSite, publicBrowserFixture, publicHome } from './public-browser-fixture.mjs';

const tool = 'desktop_playwright';
const handoffHost = 'handoff.dfsc-fixture.test';
const html = `<!doctype html><title>Playwright preview fixture</title><body style="margin:0">
    <canvas width="160" height="160"></canvas>
    <form><label>Name <input required></label><label>Private code <input autocomplete="one-time-code"></label>
    <button disabled>Apply example</button></form>
    <p>Untouched</p><output></output><script type="module">
    import { marker } from './marker.js';
    const output = document.querySelector('output');
    output.textContent = marker;
    import.meta.hot.accept('./marker.js', next => { output.textContent = next.marker; });
    const canvas = document.querySelector('canvas');
    const gl = canvas.getContext('webgl', { preserveDrawingBuffer: true });
    gl.clearColor(.1, .65, .25, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.SCISSOR_TEST);
    gl.scissor(0, 0, 20, 20);
    let frames = 0;
    function draw(time) {
      gl.clearColor(.1, (Math.sin(time / 80) + 1) / 2, .25, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      canvas.dataset.frames = String(++frames);
      requestAnimationFrame(draw);
    }
    requestAnimationFrame(draw);
    document.querySelector('form').onsubmit = event => {
      event.preventDefault();
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
let afterOwnedConnect;
let afterPublicConnect;
let resumeSharedFixture;
let resumeNavigatedFixture;
let publicFixture;
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
  return /\[ref=((?:f\d+)?e\d+)\]/.exec(line)[1];
};
// Vite's file access checks must see the real path, not a Windows TEMP short-name alias.
const profile = await realpath(await mkdtemp(join(tmpdir(), 'step-playwright-preview-')));
try {
  const frontendRoot = join(profile, 'frontend');
  const marker = join(frontendRoot, 'marker.js');
  const ownedPortPath = join(profile, 'owned-preview-port.txt');
  await mkdir(frontendRoot);
  await writeFile(join(frontendRoot, 'index.html'), html);
  await writeFile(marker, 'export const marker = "Initial Vite marker";\n');
  await writeFile(join(profile, 'owned-preview.cjs'), `
    const { createServer } = require('node:http');
    const { writeFileSync } = require('node:fs');
    const server = createServer((_req, res) => res.end('<title>Owned preview fixture</title><h1>Started by this turn</h1>'));
    server.listen(0, '127.0.0.1', () => writeFileSync('owned-preview-port.txt', String(server.address().port)));
  `);
  frontend = await createViteServer({ configFile: false, root: frontendRoot, logLevel: 'silent',
    server: { host: '127.0.0.1', port: 0, preTransformRequests: false, allowedHosts: [handoffHost],
      // Avoid a libuv fs-event assertion on Windows runner temp paths. Vite still watches real edits.
      watch: { usePolling: process.platform === 'win32' },
    },
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
  const index = await fetch(origin, { headers: { Accept: 'text/html' } });
  assert.equal(index.status, 200, 'Vite must serve the isolated frontend index');
  assert.match(await index.text(), /<title>Playwright preview fixture<\/title>/);
  const stoppedOperations = [
    ['start', () => ({ url: origin })],
    ['snapshot'],
    ['type', () => ({ ref: ref(resultByOperation.get('snapshot'), 'textbox "Name"'), text: 'Right sidebar' })],
    ['snapshot'],
    ['click', () => ({ ref: ref(resultByOperation.get('snapshot'), 'button "Apply example"') })],
    ['console'], ['network'], ['screenshot'], ['show'], ['show'], ['snapshot'], ['start', () => ({ url: origin })],
  ];
  const normalOperations = [['start', () => ({ url: origin })], ['snapshot']];
  const deniedOperations = [['start', () => ({ url: origin })], ['start', () => ({ url: 'https://127.0.0.1/' })]];
  const backgroundOperations = [['start', () => ({ url: `${origin}/?background-connect` })]];
  let ownedOrigin;
  const ownedOperations = [['command'], ['start', () => ({ url: ownedOrigin })], ['snapshot'], ['start', () => ({ url: ownedOrigin })]];
  const unrelatedOperations = [['start', () => ({ url: origin })]];
  const publicDeniedOperations = [['start', () => ({ url: publicHome })]];
  const publicOperations = [['start', () => ({ url: publicHome })], ['snapshot'],
    ['type', () => ({ ref: ref(resultByOperation.get('public:snapshot:2'), 'textbox "Search"'), text: 'browser fixture' })],
    ['press', () => ({ key: 'Enter' })], ['snapshot'], ['navigate', () => ({ url: outsideSite })],
    ['click', () => ({ ref: ref(resultByOperation.get('public:snapshot:5'), 'Open profile') })],
    ['snapshot'], ['stop'], ['start', () => ({ url: outsideSite })]];
  const shared = mode => [['attach'], ['snapshot'],
    ['type', () => ({ ref: ref(resultByOperation.get(`${mode}:snapshot`), 'textbox "Name"'), text: 'Agent draft' })],
    ['type', () => ({ ref: ref(resultByOperation.get(`${mode}:snapshot`), 'textbox "Private code"'), text: 'not allowed' })],
    ['press', () => ({ key: 'Enter' })], ['navigate', () => ({ url: origin })], ['stop'],
    ['start', () => ({ url: origin })]];
  const staleOperations = [['attach'], ['start', () => ({ url: origin })]];
  const signedInOperations = [['start', () => ({ url: publicHome })], ['snapshot'],
    ['type', () => ({ ref: ref(resultByOperation.get('signedIn:snapshot'), 'textbox "Search"'), text: 'not allowed' })],
    ['navigate', () => ({ url: publicHome })]];
  const liveUrl = process.env.DESKTOP_VERIFY_PLAYWRIGHT_BILIBILI === '1'
    ? `https://search.bilibili.com/upuser?keyword=${encodeURIComponent('\u67d2\u62fe\u5146\u5b57\u8282')}` : undefined;
  const liveProfile = /space\.bilibili\.com\/506159361/;
  const liveOperations = [['start', () => ({ url: liveUrl })], ['snapshot'], ['snapshot'], ['snapshot']];
  const stages = { stopped: 0, normal: 0, denied: 0, background: 0, owned: 0, unrelated: 0,
    publicDenied: 0, public: 0, live: 0, sharedRead: 0, sharedAgain: 0, sharedFollowup: 0,
    sharedIndependent: 0, sharedOnce: 0, afterDowngrade: 0, afterOnce: 0, stale: 0, navigated: 0, signedIn: 0 };
  const scenarios = { stopped: stoppedOperations, normal: normalOperations, denied: deniedOperations,
    background: backgroundOperations, owned: ownedOperations, unrelated: unrelatedOperations,
    publicDenied: publicDeniedOperations, public: publicOperations, live: liveOperations,
    sharedRead: shared('sharedRead'), sharedAgain: shared('sharedAgain'), sharedFollowup: [['attach'], ['snapshot']],
    sharedIndependent: [['start', () => ({ url: origin })]], sharedOnce: [['attach']], afterDowngrade: [['attach']], afterOnce: [['attach']],
    stale: staleOperations,
    navigated: staleOperations, signedIn: signedInOperations };
  const pendingTools = new Map();
  backend = createServer(async (request, response) => {
    try {
      let data = '';
      for await (const body of request) data += body;
      const payload = JSON.parse(data);
      const playwright = payload.tools?.find(entry => entry.function.name === tool);
      assert.match(playwright?.function.description ?? '', /Default tool for local frontend verification/);
      const user = payload.messages.findLast(message => message.role === 'user');
      const prompt = contentText(user?.content);
      const last = payload.messages.findLast(message => message.role === 'tool');
      // Context compaction can omit the latest user prompt from a tool continuation.
      const explicit = Object.keys(scenarios).find(key => prompt.includes(`browser scenario ${key}.`));
      const scenario = pendingTools.get(last?.tool_call_id) ?? explicit ?? (prompt.includes('normal handoff') ? 'normal'
        : prompt.includes('denied approval') ? 'denied' : prompt.includes('background connection') ? 'background'
          : prompt.includes('same-turn owned preview') ? 'owned' : prompt.includes('unrelated local service') ? 'unrelated'
            : prompt.includes('decline anonymous browsing') ? 'publicDenied'
              : prompt.includes('public browser fixture') ? 'public' : prompt.includes('live Bilibili search') ? 'live' : 'stopped');
      const operations = scenarios[scenario];
      const stage = stages[scenario];
      if (stage === 0) {
        const system = payload.messages.filter(message => ['system', 'developer'].includes(message.role))
          .map(message => contentText(message.content)).join('\n');
        assert.match(system, /use desktop_playwright in the current conversation by default/);
        assert.match(system, /Do not work around that outcome by launching a headed browser/);
        if (['sharedRead', 'sharedAgain', 'sharedFollowup', 'sharedIndependent', 'stale', 'navigated'].includes(scenario))
          assert.match(system, /kept an existing browser tab shared \(view only\)/);
        if (scenario === 'sharedOnce') assert.match(system, /shared an existing browser tab for this turn \(view only\)/);
        if (['afterDowngrade', 'afterOnce'].includes(scenario))
          assert.doesNotMatch(system, /(?:kept|shared) an existing browser tab/);
      }
      providerSteps.push([scenario, stage, last?.tool_call_id]);
      if (stage > 0) {
        assert.equal(last?.tool_call_id, `pw-call-${scenario}-${stage - 1}`, 'expected the matching runtime tool result');
        pendingTools.delete(last.tool_call_id);
        const [operation] = operations[stage - 1];
        resultByOperation.set(scenario === 'denied' && stage === 2 ? 'invalid:start'
          : scenario === 'owned' && stage === 4 ? 'owned:reconnect'
            : scenario === 'public' ? `public:${operation}:${stage}`
            : scenario.startsWith('shared') && operation === 'type' ? `${scenario}:${operation}:${stage}`
            : `${scenario === 'stopped' ? '' : `${scenario}:`}${operation}`, contentText(last.content));
        if (scenario === 'owned' && stage === 1) {
          const port = await waitFor(() => readFile(ownedPortPath, 'utf8').catch(() => ''), 'owned dev server ready');
          ownedOrigin = `http://127.0.0.1:${port}`;
        }
      }
      const complete = () => response.end(chunk({ role: 'assistant', content: `Fixture ${scenario} verification finished.` })
        + chunk({}, 'stop') + 'data: [DONE]\n\n');
      const send = () => {
        if (stage === operations.length || scenario === 'live' && stage > 1 && liveProfile.test(contentText(last?.content))) {
          complete(); return;
        }
        const [operation, args] = operations[stage];
        const id = `pw-call-${scenario}-${stage}`;
        pendingTools.set(id, scenario);
        stages[scenario]++;
        const call = operation === 'command'
          ? { name: 'run_command', arguments: JSON.stringify({ command: 'node owned-preview.cjs', run_in_background: true }) }
          : { name: tool, arguments: JSON.stringify({ operation, ...args?.() }) };
        response.end(chunk({ tool_calls: [{ index: 0, id, type: 'function', function: call }] })
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
      } else if (scenario === 'owned' && stage === 2) {
        response.write(chunk({ role: 'assistant' })); afterOwnedConnect = send;
      } else if (scenario === 'public' && stage === 1) {
        response.write(chunk({ role: 'assistant' })); afterPublicConnect = send;
      } else if (scenario === 'stale' && stage === 0) {
        response.write(chunk({ role: 'assistant' })); resumeSharedFixture = send;
      } else if (scenario === 'navigated' && stage === 0) {
        response.write(chunk({ role: 'assistant' })); resumeNavigatedFixture = send;
      } else if (scenario === 'live' && stage > 1) setTimeout(send, 650);
      else send();
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
  delete env.DESKTOP_EXPERIMENTAL_PLAYWRIGHT_PREVIEW;
  const launch = () => _electron.launch({ ...(executablePath ? { executablePath } : {}),
    args: [...(executablePath ? [] : [desktop]), `--host-resolver-rules=MAP ${handoffHost} 127.0.0.1`],
    cwd: profile, env, timeout: 60_000 });
  app = await launch();
  if (executablePath) assert.equal(await app.evaluate(({ app }) => app.isPackaged), true);
  page = await app.firstWindow();
  page.setDefaultTimeout(15_000);
  await app.evaluate(({ BrowserWindow, app }) => {
    const window = BrowserWindow.getAllWindows()[0];
    const focus = [];
    globalThis.previewFixtureFocus = focus;
    app.on('browser-window-focus', () => focus.push('focus'));
    app.on('browser-window-created', () => focus.push('new window'));
    for (const method of ['focus', 'show', 'moveTop']) {
      const original = window[method].bind(window);
      window[method] = (...args) => { focus.push(method); return original(...args); };
    }
    window.setOpacity(0);
    window.setIgnoreMouseEvents(true);
    window.showInactive();
    window.setSize(1500, 960);
  });
  await page.getByText('Step Code connected', { exact: true }).waitFor({ state: 'attached', timeout: 60_000 });
  await page.evaluate(() => {
    window.previewFixture = { confirmations: [], publicConfirmations: [], images: [], reveals: [] };
    window.desktop.onBrowserEvent(event => {
      if (event.type === 'open-preview') window.previewFixture.reveals.push(event.owner);
    });
    window.desktop.onEvent(event => {
      if (event.type === 'extension_ui_request' && event.title === 'Allow Playwright to test this local preview?')
        window.previewFixture.confirmations.push(event);
      if (event.type === 'extension_ui_request' && event.title === 'Allow the agent to browse this site?')
        window.previewFixture.publicConfirmations.push(event);
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
  const pulse = panel.locator('.browser-tab')
    .filter({ has: page.getByRole('tab', { name: 'Playwright preview fixture', exact: true }) }).locator('.matrix-pulse');
  const activity = panel.locator('.browser-tab-activity');
  const flow = activity.locator('.task-progress-current');
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
        attached: view.webContents.debugger.isAttached(), throttled: view.webContents.getBackgroundThrottling() })), `${origin}/`);
  const pageState = id => app.evaluate(({ BrowserWindow }, id) => {
    const view = BrowserWindow.getAllWindows().flatMap(window => window.contentView.children).find(view => view.webContents?.id === id);
    return view.webContents.executeJavaScript(`({
      applied: document.querySelector('p').textContent,
      marker: document.querySelector('output').textContent,
    })`);
  }, id);
  const webglFrames = id => app.evaluate(({ BrowserWindow }, id) => {
    const view = BrowserWindow.getAllWindows().flatMap(window => window.contentView.children).find(view => view.webContents?.id === id);
    return view.webContents.executeJavaScript("Number(document.querySelector('canvas').dataset.frames)");
  }, id);
  await stop.waitFor();
  await page.waitForFunction(() => !document.querySelector('.browser-panel').getAnimations().some(item => item.playState === 'running'));
  const original = await waitFor(async () => {
    const [tab] = await nativeTab();
    return tab?.visible && tab.bounds.width > 0 ? tab : undefined;
  }, 'auto-revealed native guest');
  assert.ok(original, 'expected a native preview guest after approval');
  assert.equal(original.attached, true);
  assert.equal(original.throttled, false);
  assert.deepEqual(await reveals(), ['session:playwright-a']);
  assert.equal(await title.getAttribute('aria-description'), 'Playwright connected');
  assert.equal(await title.getAttribute('aria-selected'), 'true');
  assert.equal(await pulse.count(), 0);
  await activity.waitFor();
  assert.deepEqual(await flow.evaluate(element => {
    const { width, height, bottom } = element.getBoundingClientRect();
    const tab = element.closest('.browser-tab').getBoundingClientRect();
    return { fillsUnderline: width === tab.width && height === 2 && bottom === tab.bottom,
      animation: getComputedStyle(element).animationName };
  }), { fillsUnderline: true, animation: 'task-progress-flow' }, 'the full-width line animates while the connected tab is idle');
  if (process.env.DESKTOP_TAB_ACTIVITY_SCREENSHOT)
    await panel.locator('.browser-tabs').screenshot({ path: process.env.DESKTOP_TAB_ACTIVITY_SCREENSHOT });
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
  assert.equal(await activity.count(), 1);
  assert.equal(await title.getAttribute('aria-description'), 'Agent is using this tab');
  assert.equal((await title.boundingBox()).width, idleWidth, 'the activity icon must not resize the tab');
  assert.equal(await playingPixel.evaluate(el => getComputedStyle(el).animationName), 'matrix-clockwise');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  assert.equal(await playingPixel.evaluate(el => getComputedStyle(el).animationName), 'none');
  assert.equal(await flow.evaluate(el => getComputedStyle(el).animationName), 'none');
  assert.notEqual(await activity.locator('.task-progress-fill').evaluate(el => getComputedStyle(el).backgroundImage), 'none');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await select('playwright-b');
  assert.equal((await nativeTab())[0].visible, false);
  const frames = await webglFrames(original.id);
  await waitFor(async () => (await webglFrames(original.id)) >= frames + 3, 'WebGL frames advance while the guest is hidden');
  await app.evaluate(({ BrowserWindow }, id) => BrowserWindow.getAllWindows().flatMap(window => window.contentView.children)
    .find(view => view.webContents?.id === id).webContents.executeJavaScript("document.querySelector('button').disabled = false"), original.id);
  await waitFor(() => afterClick, 'hidden test form submitted');
  await pulse.waitFor({ state: 'hidden' });
  assert.equal((await pageState(original.id)).applied, 'Applied: Right sidebar');
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
  assert.equal(pixel.bgra[3], 255, 'the captured WebGL pixel must be opaque');
  // Graphics backends may quantize the same floating-point clear color one byte apart.
  assert.ok([64, 166, 25].every((expected, index) => Math.abs(pixel.bgra[index] - expected) <= 1),
    `Expected the WebGL clear color, got BGRA ${pixel.bgra}`);
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
  await activity.waitFor();
  assert.equal(await pulse.count(), 0, 'the idle icon is restored before the turn-level line ends');
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
  await activity.waitFor({ state: 'detached' });
  assert.equal(await title.getAttribute('aria-description'), null, 'stopping returns the tab to ordinary chrome');
  assert.equal(await title.getAttribute('aria-selected'), 'true');
  const [retained] = await nativeTab();
  assert.equal(retained.id, original.id);
  assert.equal(retained.attached, false);
  assert.equal(retained.throttled, true);
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
  await activity.waitFor({ state: 'detached' });
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
  assert.match(resultByOperation.get('invalid:start'), /loopback|localhost|local HTTP/i);
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
  const publicApproval = page.getByRole('dialog', { name: 'Allow the agent to browse this site?', exact: true });
  const publicConfirmations = () => page.evaluate(() => window.previewFixture.publicConfirmations.length);
  const beforePublicDenial = await page.evaluate(() => window.desktop.browserList());
  await input.fill('Verify that I can decline anonymous browsing.');
  await submitSessionFixture(page, () => input.press('Enter'));
  await publicApproval.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByText('Fixture publicDenied verification finished.', { exact: true }).waitFor();
  assert.match(resultByOperation.get('publicDenied:start'), /not approved/);
  assert.equal(await publicConfirmations(), 1);
  assert.deepEqual((await page.evaluate(() => window.desktop.browserList())).tabs, beforePublicDenial.tabs);
  const totalConfirmations = () => page.evaluate(() => window.previewFixture.confirmations.length);
  const beforeFullAccess = await totalConfirmations();
  const enabling = page.evaluate(async () => {
    const { runtimeId } = await window.desktop.snapshot();
    return window.desktop.command('set_permission_preset', { preset: 'full-access' }, runtimeId);
  });
  await page.getByRole('dialog', { name: 'Enable full access?', exact: true })
    .getByRole('button', { name: 'Enable for this session', exact: true }).click();
  await enabling;
  await input.fill('Verify the same-turn owned preview without confirmation.');
  await submitSessionFixture(page, () => input.press('Enter'));
  await Promise.race([
    waitFor(() => afterOwnedConnect, 'Full Access connection to its own dev server'),
    approval.waitFor().then(() => { throw new Error('Full Access prompted for the same-turn dev server'); }),
  ]);
  assert.match(resultByOperation.get('owned:start'), /original preview tab/);
  assert.equal(await totalConfirmations(), beforeFullAccess);
  await stop.click();
  afterOwnedConnect();
  await approval.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByText('Fixture owned verification finished.', { exact: true }).waitFor();
  assert.match(resultByOperation.get('owned:snapshot'), /No approved Playwright preview/);
  assert.match(resultByOperation.get('owned:reconnect'), /not approved/);
  assert.equal(await totalConfirmations(), beforeFullAccess + 1);
  await input.fill('Try the unrelated local service in Full Access.');
  await submitSessionFixture(page, () => input.press('Enter'));
  await approval.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByText('Fixture unrelated verification finished.', { exact: true }).waitFor();
  assert.match(resultByOperation.get('unrelated:start'), /not approved/);
  assert.equal(await totalConfirmations(), beforeFullAccess + 2);
  await panel.getByRole('button', { name: 'Close browser panel' }).click();
  publicFixture = await publicBrowserFixture(profile);
  const profiles = () => page.evaluate(() => window.desktop.browserProfiles());
  assert.deepEqual(await profiles(), { sites: { personal: [], agent: [] }, presets: [] });
  await publicFixture.attach(app);
  const cookieRows = (await profiles()).sites.personal;
  assert.deepEqual(cookieRows.map(site => site.domain), ['example.com']);
  assert.equal(cookieRows[0].openOrigin, undefined, 'unvisited cookies do not create an openable URL');
  await assert.rejects(page.evaluate(async origin => {
    const { context } = await window.desktop.browserList();
    return window.desktop.browserProfileOpen('personal', { origin }, context);
  }, new URL(publicHome).origin), /No known address/);
  await input.fill('Run the public browser fixture in the built-in browser.');
  await submitSessionFixture(page, () => input.press('Enter'));
  await waitFor(() => afterPublicConnect, 'Full Access public browsing');
  assert.match(resultByOperation.get('public:start:1'), /isolated built-in tab/);
  assert.equal(await panel.count(), 0, 'public browsing must not open the panel');
  assert.equal(await publicConfirmations(), 1, 'Full Access must not prompt for the first public site');
  await rail.click();
  await activity.waitFor();
  assert.equal(await activity.locator('xpath=..').getByRole('tab').getAttribute('aria-selected'), 'false',
    'the line marks the Agent tab even when a different tab is selected');
  assert.equal(await panel.locator('.browser-tab.is-active .browser-tab-activity').count(), 0);
  await panel.getByRole('button', { name: 'Close browser panel' }).click();
  afterPublicConnect();
  await publicApproval.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByText('Fixture public verification finished.', { exact: true }).waitFor();
  assert.match(resultByOperation.get('public:snapshot:2'), /Public CDN loaded/);
  assert.match(resultByOperation.get('public:snapshot:5'), /Anonymous search result/);
  assert.match(resultByOperation.get('public:navigate:6'), /outside the attached browser site/);
  assert.match(resultByOperation.get('public:snapshot:8'), /Public profile opened/);
  assert.match(resultByOperation.get('public:start:10'), /not approved/);
  assert.equal(await panel.count(), 0);
  assert.equal(await publicConfirmations(), 2);
  assert.deepEqual(await reveals(), Array(4).fill('session:playwright-a'));
  assert.ok(publicFixture.requests.some(request => request.path === '/asset.js'));
  assert.ok(publicFixture.requests.some(request => request.path === '/profile'));
  assert.ok(publicFixture.requests.every(request => request.method === 'GET' && !request.cookie
    && request.path !== '/private' && request.host !== new URL(outsideSite).hostname));
  const guest = await page.evaluate(async () =>
    (await window.desktop.browserList()).tabs.find(tab => tab.title === 'Public profile'));
  assert.ok(guest, 'the public guest remains available after the turn');
  const manual = await page.evaluate(async url => {
    const { context } = await window.desktop.browserList();
    return window.desktop.browserOpenLink(url, context);
  }, guest.url);
  assert.ok(manual.activeId && manual.activeId !== guest.id, 'manually opening the same URL must create a separate tab');
  assert.ok(manual.tabs.some(tab => tab.id === guest.id));
  await page.evaluate(({ activeId, context }) => window.desktop.browserClose(activeId, context), manual);
  // Exercise the production settings, including native tab creation in a different partition.
  const runScenario = async (mode, wait = true) => {
    await input.fill(`Run browser scenario ${mode}.`);
    await submitSessionFixture(page, () => input.press('Enter'));
    if (wait) await page.getByText(`Fixture ${mode} verification finished.`, { exact: true }).waitFor();
  };
  const settings = page.locator('.sidebar-settings');
  const presetSection = page.locator('[data-settings-anchor="browser-presets"]');
  await settings.click();
  const search = page.getByRole('searchbox', { name: 'Search settings' });
  await search.fill('Cookie');
  await search.press('Enter');
  await page.locator('[data-settings-anchor="browser-profiles"][data-settings-located]').waitFor();
  await presetSection.getByRole('button', { name: 'Add site preset', exact: true }).click();
  await presetSection.getByRole('textbox', { name: 'Site domain' }).fill(new URL(publicHome).hostname);
  await presetSection.getByRole('button', { name: 'Save', exact: true }).click();
  await presetSection.getByText('example.com', { exact: true }).waitFor();
  const settingsDialog = page.locator('.settings-dialog');
  await settingsDialog.getByRole('button', { name: 'Close', exact: true }).click();
  await settingsDialog.waitFor({ state: 'hidden' });
  await runScenario('signedIn');
  assert.match(resultByOperation.get('signedIn:start'), /configured Agent profile/);
  assert.match(resultByOperation.get('signedIn:snapshot'), /Agent profile sign-in/);
  assert.match(resultByOperation.get('signedIn:snapshot'), /Public CDN loaded/);
  assert.match(resultByOperation.get('signedIn:type'), /does not allow/);
  assert.match(resultByOperation.get('signedIn:navigate'), /does not allow/);
  assert.ok(publicFixture.requests.some(request => request.cookie === 'agent_fixture=isolated'));
  assert.ok(publicFixture.requests.filter(request => request.path === '/asset.js').every(request => !request.cookie));
  assert.ok(publicFixture.requests.every(request => !request.cookie?.includes('manual_fixture')));
  assert.equal(await panel.count(), 0, 'signed-in browsing must not open the panel');
  const { hostname: publicHost, origin: publicOrigin } = new URL(publicHome);
  assert.ok((await profiles()).sites.agent.some(site =>
    site.domain === 'example.com' && site.host === publicHost && site.openOrigin === publicOrigin));
  assert.doesNotMatch(JSON.stringify(await profiles()), /agent_fixture|manual_fixture|asset_fixture/);
  await settings.click();
  await page.getByRole('button', { name: 'Built-in browser', exact: true }).click();
  const agentProfile = page.locator('.bs-profile').filter({ hasText: 'Agent profile' });
  await agentProfile.locator('summary').click();
  const cookieOnly = agentProfile.getByRole('listitem').filter({ hasText: 'example.net' });
  await cookieOnly.getByText('Site data only', { exact: true }).waitFor();
  assert.equal(await cookieOnly.getByRole('button', { name: /^Open / }).count(), 0);
  await agentProfile.getByRole('button', { name: `Open ${publicHost}`, exact: true }).click();
  await panel.waitFor();
  await waitForBrowserFixtureSnapshot(page, snapshot => snapshot.tabs.some(tab =>
    tab.id === snapshot.activeId && tab.profile === 'agent' && tab.url === publicHome && !tab.loading && !tab.error),
  'opening the recorded subdomain in its profile');
  await settings.click();
  await page.getByRole('button', { name: 'Built-in browser', exact: true }).click();
  if (await agentProfile.locator('summary').getAttribute('aria-expanded') === 'false') await agentProfile.locator('summary').click();
  const clearSite = agentProfile.getByRole('button', { name: `Clear site data for ${publicHost}`, exact: true });
  await clearSite.click();
  await page.getByRole('dialog', { name: 'Clear site data?', exact: true })
    .getByText('This also affects other subdomains of example.com.', { exact: true }).waitFor();
  await page.getByRole('dialog', { name: 'Clear site data?', exact: true }).getByRole('button', { name: 'Clear data' }).click();
  await clearSite.waitFor({ state: 'hidden' });
  assert.deepEqual(await app.evaluate(async ({ session }, url) => {
    const list = partition => session.fromPartition(partition).cookies.get({ url }).then(cookies => cookies.map(cookie => cookie.name));
    return Promise.all([list('persist:desktop-browser'), list('persist:desktop-browser-agent')]);
  }, publicHome), [['manual_fixture'], []]);
  assert.ok((await profiles()).sites.agent.some(site => site.domain === 'example.net'), 'clearing one site leaves other domains intact');
  await agentProfile.getByRole('textbox', { name: 'Domain to open' }).fill(new URL(publicHome).hostname);
  await agentProfile.getByRole('button', { name: 'Open site', exact: true }).click();
  await panel.waitFor();
  const agentManual = await page.evaluate(() => window.desktop.browserList());
  assert.equal(agentManual.tabs.find(tab => tab.id === agentManual.activeId)?.profile, 'agent');

  // Use a non-loopback HTTP URL so the localhost preview exception cannot mask a handoff regression.
  const handoffOrigin = origin.replace('127.0.0.1', handoffHost);
  const existingUrl = `${handoffOrigin}/?user-draft`;
  const openManual = async url => page.evaluate(async url => {
    const { context } = await window.desktop.browserList();
    return window.desktop.browserOpenLink(url, context);
  }, url);
  const prefilled = await openManual(existingUrl);
  const findNative = () => app.evaluate(({ webContents }, url) => webContents.getAllWebContents()
    .find(view => view.getURL() === url && !view.isLoading())?.id, existingUrl);
  const samePage = await waitFor(findNative, 'original user tab');
  const setDraft = value => app.evaluate(({ webContents }, { id, value }) => webContents.fromId(id)
    .executeJavaScript(`document.querySelector('input').value = ${JSON.stringify(value)}; document.querySelector('input').value`), { id: samePage, value });
  const inspectDraft = () => app.evaluate(({ webContents }, id) => webContents.fromId(id)
    .executeJavaScript(`({name: document.querySelector('input').value, code: document.querySelectorAll('input')[1].value,
      state: document.querySelector('p').textContent})`), samePage);
  await setDraft('User draft');
  const other = await openManual(`${origin}/?other-tab`);
  await page.evaluate(({ activeId, context }) => window.desktop.browserSelect(activeId, context), prefilled);
  const share = async index => {
    await app.evaluate(({ Menu }, index) => {
      // Select the real menu action without opening a foreground OS menu.
      const popup = Menu.prototype.popup;
      Menu.prototype.popup = function (options) {
        Menu.prototype.popup = popup;
        if (this.items.length !== 2 || !this.items[0].label.endsWith('View only') || this.items[1].label !== 'Remove sharing')
          throw new Error('Unexpected shared-tab permission options');
        this.items[index].click();
        options.callback?.();
      };
    }, index);
    await panel.getByRole('button', { name: 'Share tab with Agent' }).click();
    await panel.getByRole('button', { name: 'Remove sharing' }).waitFor();
  };
  await share(0);
  await page.evaluate(({ activeId, context }) => window.desktop.browserSelect(activeId, context), other);
  await runScenario('sharedRead');
  assert.match(resultByOperation.get('sharedRead:attach'), /view-only/);
  assert.match(resultByOperation.get('sharedRead:snapshot'), /User draft/);
  assert.match(resultByOperation.get('sharedRead:type:3'), /does not allow/);
  assert.match(resultByOperation.get('sharedRead:start'), /shared tab only/);
  assert.deepEqual(await inspectDraft(), { name: 'User draft', code: '', state: 'Untouched' });

  await page.evaluate(({ activeId, context }) => window.desktop.browserSelect(activeId, context), prefilled);
  await share(0);
  await runScenario('sharedAgain');
  assert.match(resultByOperation.get('sharedAgain:attach'), /original shared page/);
  assert.match(resultByOperation.get('sharedAgain:type:3'), /does not allow/);
  assert.match(resultByOperation.get('sharedAgain:type:4'), /does not allow/);
  assert.match(resultByOperation.get('sharedAgain:press'), /does not allow/);
  assert.match(resultByOperation.get('sharedAgain:navigate'), /does not allow/);
  assert.deepEqual(await inspectDraft(), { name: 'User draft', code: '', state: 'Untouched' });
  assert.equal(await findNative(), samePage);
  assert.equal(await app.evaluate(({ webContents }, id) => webContents.fromId(id).debugger.isAttached(), samePage), false);
  await panel.getByText('Kept shared · View only', { exact: true }).waitFor();
  // The next local turn may attach again without a second share; the debugger and activity stay per-turn.
  await runScenario('sharedFollowup');
  assert.match(resultByOperation.get('sharedFollowup:attach'), /original shared page/);
  assert.match(resultByOperation.get('sharedFollowup:snapshot'), /User draft/);
  await panel.getByText('Kept shared · View only', { exact: true }).waitFor();
  await activity.waitFor({ state: 'detached' });
  assert.equal(await findNative(), samePage);
  assert.equal(await app.evaluate(({ webContents }, id) => webContents.fromId(id).debugger.isAttached(), samePage), false);
  await share(0);
  await runScenario('sharedIndependent', false);
  await approval.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByText('Fixture sharedIndependent verification finished.', { exact: true }).waitFor();
  assert.match(resultByOperation.get('sharedIndependent:start'), /not approved/);
  await panel.getByText('Kept shared · View only', { exact: true }).waitFor();
  await runScenario('stale', false);
  await waitFor(() => resumeSharedFixture, 'submitted turn waiting before attach');
  await panel.getByRole('button', { name: 'Remove sharing' }).click();
  resumeSharedFixture();
  await page.getByText('Fixture stale verification finished.', { exact: true }).waitFor();
  assert.match(resultByOperation.get('stale:attach'), /shared tab is no longer available/);
  assert.match(resultByOperation.get('stale:start'), /shared tab only/);
  assert.equal(await findNative(), samePage);
  await share(0);
  await runScenario('navigated', false);
  await waitFor(() => resumeNavigatedFixture, 'submitted turn waiting before same-origin navigation');
  await page.evaluate(async ({ activeId, context, url }) => window.desktop.browserAction(activeId, 'navigate', url, context),
    { ...prefilled, url: `${handoffOrigin}/?different-document` });
  resumeNavigatedFixture();
  await page.getByText('Fixture navigated verification finished.', { exact: true }).waitFor();
  assert.match(resultByOperation.get('navigated:attach'), /shared tab is no longer available/);
  assert.match(resultByOperation.get('navigated:start'), /shared tab only/);
  if (liveUrl) {
    await input.fill('Run a live Bilibili search in the built-in browser.');
    await submitSessionFixture(page, () => input.press('Enter'));
    await page.getByText('Fixture live verification finished.', { exact: true, timeout: 45_000 }).waitFor();
    assert.match(resultByOperation.get('live:start'), /built-in tab for bilibili\.com/);
    assert.match(resultByOperation.get('live:snapshot'), liveProfile);
    console.log('Live Bilibili: anonymous user search returned the requested account in the embedded tab.');
  }
  await page.evaluate(async id => {
    const { context } = await window.desktop.browserList();
    return window.desktop.browserSelect(id, context);
  }, prefilled.activeId);
  await share(0);
  await panel.getByText('Kept shared · View only', { exact: true }).waitFor();
  await page.evaluate(async () => {
    const { runtimeId } = await window.desktop.snapshot();
    return window.desktop.command('set_permission_preset', { preset: 'ask' }, runtimeId);
  });
  const removeShare = panel.getByRole('button', { name: 'Remove sharing' });
  await removeShare.waitFor({ state: 'hidden' });
  await runScenario('afterDowngrade');
  assert.match(resultByOperation.get('afterDowngrade:attach'), /No tab is available/);
  await share(0);
  await panel.getByText('Shared next turn · View only', { exact: true }).waitFor();
  await runScenario('sharedOnce');
  assert.match(resultByOperation.get('sharedOnce:attach'), /view-only/);
  await removeShare.waitFor({ state: 'hidden' });
  await runScenario('afterOnce');
  assert.match(resultByOperation.get('afterOnce:attach'), /No tab is available/);
  assert.deepEqual(await app.evaluate(() => globalThis.previewFixtureFocus), []);
  await app.evaluate(async ({ session }, url) => {
    const agent = session.fromPartition('persist:desktop-browser-agent');
    await agent.cookies.set({ url, name: 'persist_fixture', value: 'restart', expirationDate: Date.now() / 1000 + 86400 });
    await agent.cookies.flushStore();
  }, publicHome);
  await app.close();
  app = await launch();
  page = await app.firstWindow();
  await page.waitForFunction(() => Boolean(window.desktop));
  const restored = await profiles();
  assert.ok(restored.presets.some(preset => preset.domain === 'example.com' && preset.mode === 'agent'));
  assert.ok(restored.sites.agent.some(site => site.domain === 'example.com'));
  assert.ok(await app.evaluate(async ({ session }, url) =>
    (await session.fromPartition('persist:desktop-browser-agent').cookies.get({ url, name: 'persist_fixture' }))
      .some(cookie => cookie.value === 'restart'), publicHome));
  console.log('Playwright browser: local and public browsing, profiles, existing HTTP tab handoff, background form, WebGL, and HMR passed.');
} catch (error) {
  if (failure) console.error('Fixture provider failed:', failure);
  console.error('Fixture provider steps:', providerSteps);
  console.error('Fixture tool results:', [...resultByOperation].map(([operation, text]) => [operation, text.slice(0, 200)]));
  if (page) {
    console.error('Fixture browser snapshot:', await page.evaluate(() => window.desktop.browserList()).catch(() => undefined));
    console.error('Fixture conversation tail:', (await page.locator('.messages').innerText({ timeout: 2000 }).catch(() => '')).slice(-2200));
  }
  console.error(error);
  await app?.evaluate(({ app }) => { setTimeout(() => app.exit(1), 50).unref(); }).catch(() => {});
  throw error;
} finally {
  if (backend?.listening) backend.closeAllConnections();
  try { await app?.close(); }
  finally { await Promise.all([frontend?.close(), publicFixture?.close(), close(backend)]); }
}
