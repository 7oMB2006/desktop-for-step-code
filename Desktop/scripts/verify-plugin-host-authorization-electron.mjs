import assert from 'node:assert/strict';
import { cp, mkdir, readFile, realpath, unlink, writeFile } from 'node:fs/promises';
import { mkdtemp } from './test-profile.mjs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { _electron as electron } from 'playwright';
import { installationReceipt, packageFingerprint, writeReceipts } from '../electron/plugin-files.mjs';
import { closeDesktopFixtureAndWait } from './close-desktop-fixture.mjs';
import { installRuntimeFixturePreload } from './runtime-transport-fixture.mjs';

const profile = await realpath(await mkdtemp(join(tmpdir(), 'dfsc-host-authorization-')));
const root = join(profile, 'step-runtime'), directory = join(root, 'plugins', 'host-example');
const output = resolve(process.env.DESKTOP_VERIFY_OUTPUT ?? 'test-results/plugin-host-authorization');
await mkdir(join(root, 'plugins'), { recursive: true });
await mkdir(output, { recursive: true });
await cp(resolve('../examples/plugins/sdk-host-starter/plugins/dfsc-host-example'), directory, { recursive: true });
const manifest = JSON.parse(await readFile(join(directory, 'step.plugin.json'), 'utf8'));
manifest.mcpServers.example.command = resolve('runtime/node', process.platform === 'win32' ? 'node.exe' : 'node');
manifest.mcpServers.example.args = [resolve('tests/fixtures/host-sdk-proxy.mjs'), 'dist/server.mjs'];
manifest.mcpServers.example.env = { STEPFUN_API_KEY: 'DFSC_INDEPENDENT_PLUGIN', DFSC_TEST_RETAIN_LAUNCH: '1' };
await writeFile(join(directory, 'step.plugin.json'), JSON.stringify(manifest));
const receipt = installationReceipt({ name: 'host-example' }, { name: 'local-fixture', kind: 'local', path: profile },
  manifest, await packageFingerprint(directory));
receipt.state = 'installed';
await writeReceipts(root, { version: 1, installations: [receipt] });
await writeFile(join(root, 'plugins', '.stepcode-preinstalled'), '["steppage"]');
await writeFile(join(root, 'config.toml'),
  'defaultProvider = "step"\ndefaultModel = "step-5-preview"\n[telemetry]\nenabled = false\n');
await writeFile(join(profile, 'preferences.json'), JSON.stringify({ language: 'zh', theme: 'light', workspaces: [] }));

const keys = { cn: 'isolated-host-account-cn', oversea: 'isolated-host-account-global' };
let region = 'cn', sequence = 0, phase = 'launch', app, page;
const errors = [], transportErrors = [], calls = [], chatCalls = [];
const plainPrompt = 'Reply without the unavailable plugin';
const plainReply = 'Ordinary chat remains available.';
let heldResponse;
const server = createServer(async (request, response) => {
  try {
    const url = new URL(new URL(request.url, 'http://fixture').searchParams.get('url'));
    assert.ok(['api.stepfun.com', 'api.stepfun.ai'].includes(url.hostname), 'Only official fixture routes are accepted');
    assert.equal(request.headers.authorization, `Bearer ${keys[region]}`);
    response.setHeader('content-type', 'application/json');
    if (url.pathname.endsWith('/models')) {
      response.end(JSON.stringify({ data: [{ id: 'step-5-preview', name: 'Isolated Step model', context_window: 256000 }] }));
    } else if (url.pathname.includes('/models/')) {
      response.end(JSON.stringify({ id: 'step-5-preview', enable_reason: false, reasoning_effort_support_list: ['off'] }));
    } else if (url.pathname.endsWith('/accounts')) {
      response.end(JSON.stringify({ object: 'account', type: 'prepaid', balance: 12 }));
    } else {
      assert.equal(url.pathname, '/v1/chat/completions');
      assert.equal(url.hostname, region === 'cn' ? 'api.stepfun.com' : 'api.stepfun.ai');
      let raw = '';
      for await (const chunk of request) { raw += chunk; assert.ok(raw.length < 128 * 1024); }
      const body = JSON.parse(raw);
      assert.equal(body.model, 'step-5-preview');
      if (body.stream === true) {
        assert.equal(phase, 'ordinary chat after failed plugin startup');
        assert.match(JSON.stringify(body.messages.at(-1).content), /Reply without the unavailable plugin/);
        assert.ok(!body.tools?.some(tool => /dfsc-host-example|host_context|summarize_text/.test(tool.function.name)));
        chatCalls.push({ region });
        response.setHeader('content-type', 'text/event-stream');
        const frame = (delta, finish_reason = null) => `data: ${JSON.stringify({
          id: 'fixture-plain-chat', object: 'chat.completion.chunk', created: 1, model: body.model,
          choices: [{ index: 0, delta, finish_reason }],
        })}\n\n`;
        response.end(frame({ role: 'assistant', content: plainReply }) + frame({}, 'stop') + 'data: [DONE]\n\n');
        return;
      }
      assert.equal(body.messages[0].content, 'Summarize the supplied text concisely.');
      const text = body.messages.at(-1).content;
      assert.ok(['approved', 'approved-again', 'cancel-inflight', 'new-account'].includes(text));
      calls.push({ region, text });
      if (text === 'cancel-inflight') heldResponse = response;
      else response.end(JSON.stringify({ choices: [{ message: { content: `Isolated summary: ${text}` } }] }));
    }
  } catch {
    transportErrors.push('Fixture rejected an unexpected route, account or payload');
    if (!response.headersSent) response.writeHead(500);
    response.end('{}');
  }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const preload = join(profile, 'host-loopback.cjs');
// Installed before any fixture credential is saved. Runtime requests cannot
// escape to an official endpoint, while the SDK keeps its real loopback broker.
await writeFile(preload, `
let transport = globalThis.fetch;
const routed = (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (url.hostname === '127.0.0.1') return transport(input, init);
  if (!['api.stepfun.com', 'api.stepfun.ai'].includes(url.hostname))
    throw new Error('External request blocked by host authorization fixture');
  return transport(${JSON.stringify(base)} + '/?url=' + encodeURIComponent(url.href), init);
};
Object.defineProperty(globalThis, 'fetch', { configurable: true, get: () => routed,
  set: value => { if (value !== routed) transport = value; } });
`);
const env = { ...process.env, DESKTOP_TEST_USER_DATA: profile, DESKTOP_TEST_NO_FOCUS: '1',
  DESKTOP_STEPPAGE_BUNDLE: join(profile, 'no-personal-steppage.mjs') };
for (const key of Object.keys(env)) {
  if (/^(ELECTRON_RUN_AS_NODE|DESKTOP_DEV_URL|NODE_OPTIONS|STEP|PI_|AI_AGENT)/i.test(key)
    || /(?:API_KEY|ACCESS_TOKEN|AUTH_TOKEN|SECRET|PASSWORD|COOKIE)$/i.test(key)) delete env[key];
}
const mark = value => { phase = value; console.log(`Host authorization acceptance: ${value}`); };
const until = async (condition, label) => {
  const deadline = Date.now() + 20000;
  while (!await condition()) {
    assert.deepEqual(transportErrors, []);
    assert.ok(Date.now() < deadline, label);
    await delay(20);
  }
};
const data = join(root, 'desktop-plugins', 'data', receipt.instance);
const send = async command => {
  const current = ++sequence;
  await writeFile(join(data, 'command.json'), JSON.stringify({ ...command, sequence: current }));
  return current;
};
const result = async current => {
  let value;
  await until(async () => {
    try { value = JSON.parse(await readFile(join(data, `result-${current}.json`), 'utf8')); return true; }
    catch { return false; }
  }, 'SDK tool result did not arrive');
  return value;
};
const tool = (name, text) => send({ name, arguments: name === 'host_context' ? {} : { text } });
const snapshot = () => page.evaluate(() => window.desktop.snapshot());
const reloadSession = async () => {
  await page.reload();
  await page.locator('.connection .online').waitFor({ timeout: 60000 });
};
let ref;
const settings = () => page.evaluate(ref => window.desktop.pluginHostSettings({ ref }), ref);
const confirmationTitle = '允许插件使用已选额度账户？';
const confirmation = () => page.getByRole('dialog', { name: confirmationTitle, exact: true });
const assertPrivate = value => assert.doesNotMatch(JSON.stringify(value),
  /isolated-host-account-|DFSC_INDEPENDENT_PLUGIN|dfsc-launch-v1|DFSC_LAUNCH_CONTEXT|declarationHash|executionHash|"broker"|"token"/);
try {
  app = await electron.launch({
    ...(process.env.DESKTOP_VERIFY_EXE ? { executablePath: process.env.DESKTOP_VERIFY_EXE } : { args: [resolve('.')] }),
    env, timeout: 60000,
  });
  page = await app.firstWindow();
  page.on('pageerror', error => errors.push(error.message));
  await app.evaluate(installRuntimeFixturePreload, { preload });
  await app.evaluate(({ BrowserWindow, net, dialog }, { base }) => {
    const window = BrowserWindow.getAllWindows()[0];
    window.setOpacity(0); window.setIgnoreMouseEvents(true); window.showInactive(); window.setSize(1280, 900);
    dialog.showMessageBox = async () => ({ response: 1 });
    net.fetch = (input, init) => {
      const url = new URL(String(input));
      if (!['api.stepfun.com', 'api.stepfun.ai'].includes(url.hostname))
        throw new Error('External main-process request blocked by host fixture');
      return fetch(base + '/?url=' + encodeURIComponent(url.href), init);
    };
  }, { base });
  await page.getByRole('heading', { name: /^(让想法阶跃星辰|星辰因你而阶跃)$/ }).waitFor();
  const enabledStepPage = await page.evaluate(async () => Object.entries((await window.desktop.settings()).mcp)
    .some(([name, server]) => /steppage/i.test(name) && server.enabled !== false));
  assert.equal(enabledStepPage, false, 'Isolated acceptance cannot launch a personal StepPage server');
  await page.evaluate(base => window.desktop.saveProvider({
    id: '', name: 'Separate chat fixture', baseUrl: `${base}/v1`, api: 'openai-completions', enabled: true, keyless: true,
    models: [{ id: 'unrelated-chat-model', name: 'Separate chat model', reasoning: false, vision: false, contextWindow: 32768, maxTokens: 1024 }],
  }), base);
  await page.evaluate(key => window.desktop.login('platform_cn', key), keys.cn);
  ref = await page.evaluate(async () => (await window.desktop.capabilityCatalog()).plugins
    .find(plugin => plugin.id === 'dfsc-host-example').package.ref);
  const initial = await settings();
  await page.evaluate(input => window.desktop.pluginSaveHostSettings(input),
    { ref, revision: initial.revision, mode: 'account', accountTicket: initial.account.ticket,
      models: { 'model.text': 'step-5-preview' } });
  await page.evaluate(() => window.desktop.newIndependentSession());
  await reloadSession();
  await until(async () => (await settings()).runtime.status === 'connected', 'Actual SDK consumer did not connect');
  const context = await result(await tool('host_context'));
  assert.match(JSON.stringify(context), /model.text/);
  assert.deepEqual(calls, [], 'Discovery, source selection and availability never call the model');
  assert.equal((await settings()).runtime.capabilities[0].authorization, 'required');
  assert.equal(await page.evaluate(() => typeof window.require), 'undefined');

  mark('production confirmation denial');
  const beforeConfirmation = await snapshot();
  await page.evaluate(confirmationTitle => {
    window.__hostConfirmationEvents = [];
    window.desktop.onEvent(event => {
      if (event.type === 'extension_ui_request' && event.title === confirmationTitle) {
        window.__hostConfirmationEvents.push({ id: event.id, runtimeId: event.runtimeId, runtimeRevision: event.runtimeRevision });
      }
    });
  }, confirmationTitle);
  let pending = await tool('summarize_text', 'denied');
  await until(async () => {
    const early = await readFile(join(data, `result-${pending}.json`), 'utf8').catch(() => undefined);
    if (early) throw new Error('Tool returned before confirmation');
    return (await snapshot()).requests.some(request => request.title === confirmationTitle);
  }, 'No pending host confirmation');
  await confirmation().waitFor();
  const arrival = await page.evaluate(() => window.__hostConfirmationEvents.at(-1));
  assert.equal(arrival.runtimeId, beforeConfirmation.runtimeId);
  assert.ok(Number.isSafeInteger(arrival.runtimeRevision) && arrival.runtimeRevision > beforeConfirmation.runtimeRevision,
    'Host confirmation events must fence delayed pre-confirmation snapshots');
  const waiting = await snapshot();
  const pendingId = waiting.requests.find(request => request.title === confirmationTitle).id;
  await reloadSession();
  await confirmation().waitFor();
  const restored = await snapshot();
  assert.equal(restored.requests.filter(request => request.id === pendingId).length, 1,
    'Renderer reload must restore the original pending confirmation, not discard or duplicate it');
  assert.deepEqual(calls, [], 'Reloading a pending confirmation cannot approve a provider request');
  assert.match(await confirmation().innerText(), /dfsc-host-example.*model.text/s);
  assert.match(await confirmation().innerText(), /开放平台 API（按量计费）.*cn/s);
  assert.match(await confirmation().innerText(), /插件提供的文字.*可能产生按量费用/s);
  assert.deepEqual(calls, []);
  await page.screenshot({ path: join(output, 'confirmation-cn.png') });
  await confirmation().getByRole('button', { name: '取消', exact: true }).click();
  assert.match(JSON.stringify(await result(pending)), /dfsc-host:DENIED/);
  assert.deepEqual(calls, []);
  assert.equal((await settings()).runtime.capabilities[0].authorization, 'required');

  mark('MCP cancellation withdraws a pending production confirmation');
  await unlink(join(data, 'command.json'));
  await page.evaluate(() => window.desktop.restart());
  await reloadSession();
  pending = await tool('summarize_text', 'cancel-pending');
  await confirmation().waitFor();
  assert.equal((await result(await send({ cancelSequence: pending }))).cancelled, true);
  await until(async () => (await snapshot()).requests.length === 0, 'Cancelled tool left a live confirmation');
  await confirmation().waitFor({ state: 'hidden' });
  assert.deepEqual(calls, []);
  assert.equal((await settings()).runtime.capabilities[0].authorization, 'required');

  mark('approval and same-launch reuse');
  pending = await tool('summarize_text', 'approved');
  await confirmation().waitFor();
  assert.deepEqual(calls, []);
  await confirmation().getByRole('button', { name: '确认', exact: true }).click();
  assert.match(JSON.stringify(await result(pending)), /Isolated summary: approved/);
  assert.equal((await settings()).runtime.capabilities[0].authorization, 'approved');
  assert.match(JSON.stringify(await result(await tool('summarize_text', 'approved-again'))), /Isolated summary: approved-again/);
  assert.deepEqual(calls.map(call => call.text), ['approved', 'approved-again']);
  assert.equal((await snapshot()).requests.length, 0, 'Same launch/capability does not ask twice');
  const beforeSwitch = await snapshot();
  const separateModel = beforeSwitch.models.find(model => model.id === 'unrelated-chat-model');
  assert.ok(separateModel && separateModel.provider !== 'step');
  await page.evaluate(model => window.desktop.command('set_model', { provider: model.provider, modelId: model.id }), separateModel);
  await until(async () => (await snapshot()).state?.model?.id === separateModel.id, 'Chat model did not switch');
  assert.equal((await snapshot()).runtimeId, beforeSwitch.runtimeId);
  assert.equal((await settings()).runtime.capabilities[0].authorization, 'approved', 'Chat model switch must not revoke the grant');

  mark('MCP cancellation interrupts an in-flight host request');
  pending = await tool('summarize_text', 'cancel-inflight');
  await until(() => Boolean(heldResponse), 'Provider fixture did not receive the approved invocation');
  assert.equal((await result(await send({ cancelSequence: pending }))).cancelled, true);
  await until(() => heldResponse.destroyed, 'Cancelled provider request remained connected');
  assert.equal(calls.length, 3, 'Cancellation cannot undo a request already received');

  mark('production account replacement revokes approval');
  const before = await snapshot();
  const oldContext = JSON.parse((await result(await tool('host_context'))).content[0].text);
  // Test-only native-side capture, never returned through the renderer bridge.
  const oldLaunch = JSON.parse(await readFile(join(data, 'test-launch.json'), 'utf8'));
  await unlink(join(data, 'test-launch.json'));
  await unlink(join(data, 'command.json'));
  region = 'oversea';
  await page.evaluate(key => window.desktop.login('platform_oversea', key), keys.oversea);
  await reloadSession();
  await until(async () => (await settings()).runtime.status === 'account-changed', 'Replacement must not inherit the old binding');
  const changed = await settings();
  assert.equal(changed.accountMatches, false);
  await until(async () => {
    const startup = (await snapshot()).state?.desktopStartup;
    return startup?.discovery === 'ready' && startup.toolsSettledAt
      && startup.tools.some(tool => tool.hosted && tool.status === 'failed');
  }, 'An invalid binding must settle as a failed tool without blocking session startup');
  assert.equal(calls.length, 3);
  mark('ordinary chat after failed plugin startup');
  const failedRuntime = await snapshot();
  const chatModel = failedRuntime.models.find(model => model.provider === 'step' && model.id === 'step-5-preview');
  assert.ok(chatModel);
  if (failedRuntime.state.model.provider !== chatModel.provider || failedRuntime.state.model.id !== chatModel.id)
    await page.evaluate(model => window.desktop.command('set_model', { provider: model.provider, modelId: model.id }), chatModel);
  await page.evaluate(({ message, runtimeId }) => window.desktop.command('prompt', { message }, runtimeId),
    { message: plainPrompt, runtimeId: failedRuntime.runtimeId });
  await until(async () => {
    const current = await snapshot();
    return !current.state?.isStreaming && current.messages.some(message => message.role === 'assistant'
      && message.content?.some(block => block.type === 'text' && block.text === plainReply));
  }, 'An ordinary first prompt should get a reply despite the failed plugin');
  assert.deepEqual(chatCalls, [{ region: 'oversea' }]);
  assert.equal(calls.length, 3, 'Ordinary chat cannot consume any plugin approval');
  mark('explicit selection and new account approval');
  await page.evaluate(input => window.desktop.pluginSaveHostSettings(input), {
    ref, revision: changed.revision, mode: 'account', accountTicket: changed.account.ticket, models: changed.models,
  });
  await page.evaluate(() => window.desktop.restart());
  await reloadSession();
  await until(async () => (await settings()).runtime.status === 'connected', 'Replacement account SDK did not connect');
  const after = await snapshot(), replaced = await settings();
  assert.notEqual(after.runtimeId, before.runtimeId);
  assert.equal(replaced.runtime.capabilities[0].region, 'oversea');
  assert.equal(replaced.runtime.capabilities[0].authorization, 'required', 'Old account approval cannot authorize the new account');
  for (const [route, body] of [
    ['context', {}],
    ['invoke', { requestId: randomUUID(), revision: oldContext.revision,
      capability: 'model.text', input: { messages: [{ role: 'user', content: 'revoked-account' }] } }],
  ]) {
    const response = await fetch(`${oldLaunch.broker.origin}/v1/${route}`, { method: 'POST', redirect: 'error',
      headers: { authorization: `Bearer ${oldLaunch.broker.token}`, 'content-type': 'application/json' },
      body: JSON.stringify(body), signal: AbortSignal.timeout(10000) });
    assert.equal(response.status, 409, 'Revoked native launch must fail closed');
    assert.deepEqual(await response.json(), { version: 1, error: { code: 'STALE_CONTEXT' } });
  }
  oldLaunch.broker.token = '';
  assert.equal((await snapshot()).requests.length, 0, 'Old launch replay cannot create a confirmation');
  assert.equal(calls.length, 3, 'Old launch replay cannot invoke either account');
  pending = await tool('summarize_text', 'new-account');
  await confirmation().waitFor();
  assert.match(await confirmation().innerText(), /开放平台 API（按量计费）.*oversea/s);
  assert.equal(calls.length, 3, 'Replacement account is not invoked before its own approval');
  await page.screenshot({ path: join(output, 'confirmation-oversea.png') });
  await confirmation().getByRole('button', { name: '确认', exact: true }).click();
  assert.match(JSON.stringify(await result(pending)), /Isolated summary: new-account/);
  assert.deepEqual(calls.map(call => call.region), ['cn', 'cn', 'cn', 'oversea']);
  assertPrivate([initial, before, after, replaced, await settings(), await page.locator('body').innerText()]);
  assert.deepEqual(errors, []);
  assert.deepEqual(transportErrors, []);
  console.log('Production Electron authorization passed: real SDK/native consumer, versioned confirmation and reload restoration, production denial/approval, MCP pending/in-flight cancellation, per-launch reuse and account replacement. Only isolated loopback provider requests were made; no real account or paid model.');
} catch (error) {
  console.error(`Host authorization failure during ${phase}`);
  if (page && !page.isClosed()) await page.screenshot({ path: join(output, 'failure.png') }).catch(() => {});
  throw error;
} finally {
  try { if (app) await closeDesktopFixtureAndWait(app); }
  finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
}
