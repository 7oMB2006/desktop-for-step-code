import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron as electron } from 'playwright';

const profile = await mkdtemp(join(tmpdir(), 'desktop-account-routing-'));
await mkdir(join(profile, 'step-runtime'), { recursive: true });
await writeFile(join(profile, 'preferences.json'), JSON.stringify({
  language: 'zh', theme: 'light', workspaces: [], autoCheckUpdates: false,
}));
await writeFile(join(profile, 'step-runtime/models.json'), JSON.stringify({ providers: {
  step: { baseUrl: 'https://api.stepfun.com/v1', api: 'openai-completions',
    models: [{ id: 'step-3.5-flash', name: 'Step Fixture', contextWindow: 256000, maxTokens: 2048 }] },
} }));
const routes = {
  platform_cn: ['api.stepfun.com', '/v1', 'fixture-api-cn'],
  step_plan: ['api.stepfun.com', '/step_plan/v1', 'fixture-plan-cn'],
  platform_oversea: ['api.stepfun.ai', '/v1', 'fixture-api-global'],
  step_plan_oversea: ['api.stepfun.ai', '/step_plan/v1', 'fixture-plan-global'],
};
const seen = [];
const failures = [];
let expected = 'platform_cn';
let rejectPlan = false;
let flow;
let hold = false;
let release;
const server = createServer(async (req, res) => {
  try {
    const original = new URL(new URL(req.url, 'http://fixture').searchParams.get('url'));
    if (original.hostname.startsWith('platform.stepfun.')) {
      res.setHeader('content-type', 'application/json');
      if (original.pathname.endsWith('/init')) {
        let raw = '';
        for await (const chunk of req) raw += chunk;
        const body = JSON.parse(raw);
        assert.ok(['step_plan', 'step_plan_oversea'].includes(body.profile));
        assert.equal(original.hostname, body.profile === 'step_plan' ? 'platform.stepfun.com' : 'platform.stepfun.ai');
        flow = { id: `fixture-${Date.now()}`, profile: body.profile, token: req.headers.authorization, ready: false };
        res.end(JSON.stringify({ flow_id: flow.id, poll_interval_sec: 1, expires_at: Math.floor(Date.now() / 1000) + 60 }));
      } else {
        assert.equal(original.pathname, `/api/stdhttp/v1/cli-login/poll/${flow.id}`);
        assert.equal(req.headers.authorization, flow.token);
        res.end(JSON.stringify(flow.ready
          ? { state: 'ready', uid: '42', credential: { api_key: routes[flow.profile][2] } }
          : { state: 'pending' }));
      }
      return;
    }
    const [host, prefix, key] = routes[expected];
    assert.equal(original.hostname, host, 'region must follow the authenticated profile');
    assert.equal(req.headers.authorization, `Bearer ${key}`, 'credential must match the active billing mode');
    seen.push({ profile: expected, path: original.pathname, method: req.method });
    for await (const _ of req) { /* Consume without persisting prompts or headers. */ }
    if (original.pathname.endsWith('/models')) {
      assert.equal(original.pathname, `${prefix}/models`);
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ data: [{ id: 'step-3.5-flash', name: 'Step Fixture', context_window: 1000000 }] }));
    } else if (original.pathname.endsWith('/models/step-3.5-flash')) {
      assert.equal(original.pathname, '/v1/models/step-3.5-flash');
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ id: 'step-3.5-flash', enable_reason: false, reasoning_effort_support_list: ['off'] }));
    } else if (original.pathname.endsWith('/chat/completions')) {
      assert.equal(original.pathname, `${prefix}/chat/completions`);
      if (hold) await new Promise(resolve => { release = resolve; });
      if (rejectPlan) {
        res.writeHead(403, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'Plan fixture denied', type: 'permission_error' } }));
        return;
      }
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.end(`data: ${JSON.stringify({ id: 'routing', object: 'chat.completion.chunk',
        model: 'step-3.5-flash', choices: [{ index: 0, delta: { role: 'assistant', content: 'Routing verified.' }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`);
    } else if (original.pathname === '/v1/accounts') {
      assert.ok(expected.startsWith('platform_'));
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ object: 'account', type: 'prepaid', balance: 12 }));
    } else if (original.pathname === '/step_plan/v1/usage') {
      assert.ok(expected.startsWith('step_plan'));
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ schema_version: 1, scope: 'personal_account', observed_at_ms: Date.now(),
        account: { id: '42' }, plan: { state: 'known', family: 'none' },
        quota: { state: 'known', allowed: false, reason: 'no_subscription', windows: [], credit_buckets: [] } }));
    } else throw new Error(`Unexpected fixture path: ${original.pathname}`);
  } catch (error) {
    failures.push(error.message);
    res.writeHead(500); res.end('Routing assertion failed');
  }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const address = `http://127.0.0.1:${server.address().port}`;
// Inject transport only in test-owned child processes; keep the real profile resolver.
const preload = join(profile, 'routing-fixture.cjs');
await writeFile(preload, `
const original = globalThis.fetch;
let transport = original;
const routed = (input, init) => {
  const url = String(input instanceof Request ? input.url : input);
  const host = new URL(url).hostname;
  if (!['api.stepfun.com', 'api.stepfun.ai', 'platform.stepfun.com', 'platform.stepfun.ai'].includes(host))
    throw new Error('Non-fixture request blocked');
  return transport(${JSON.stringify(address)} + '/?url=' + encodeURIComponent(url), init);
};
Object.defineProperty(globalThis, 'fetch', { configurable: true, get: () => routed,
  set: value => { if (value !== routed) transport = value; } });
`);
const env = { ...process.env, DESKTOP_TEST_USER_DATA: profile, DESKTOP_TEST_NO_FOCUS: '1' };
delete env.ELECTRON_RUN_AS_NODE;
let app;
try {
  app = await electron.launch({ ...(process.env.DESKTOP_VERIFY_EXE
    ? { executablePath: process.env.DESKTOP_VERIFY_EXE } : { args: [resolve('.')] }), env, timeout: 60000 });
  console.log('Account routing: launched isolated application');
  const page = await app.firstWindow();
  await page.getByRole('heading', { name: /^(让想法阶跃星辰|星辰因你而阶跃)$/ }).waitFor();
  console.log('Account routing: installing isolated transport');
  await app.evaluate(async ({ BrowserWindow, net, shell, dialog }, { preload, address }) => {
    const window = BrowserWindow.getAllWindows()[0];
    window.setOpacity(0); window.setIgnoreMouseEvents(true); window.showInactive();
    dialog.showMessageBox = async () => ({ response: 1 });
    const cp = process.getBuiltinModule('child_process');
    const spawn = cp.spawn;
    cp.spawn = function(file, args, options) {
      if (args?.some(arg => /(?:admin\.mjs|step\.js)$/.test(arg))) args = ['--require', preload, ...args];
      return spawn.call(this, file, args, options);
    };
    process.getBuiltinModule('module').syncBuiltinESMExports();
    net.fetch = (input, init) => fetch(address + '/?url=' + encodeURIComponent(String(input)), init);
    globalThis.routingAuthUrl = undefined;
    shell.openExternal = async url => { globalThis.routingAuthUrl = url; };
  }, { preload, address });
  console.log('Account routing: transport installed');
  await page.evaluate(() => window.desktop.snapshot());
  // Force the test-owned management process to restart with the transport hook.
  await page.evaluate(address => window.desktop.saveProvider({
    id: '', name: 'Disabled routing fixture', baseUrl: address + '/v1',
    api: 'openai-completions', enabled: false, keyless: true,
    models: [{ id: 'unused', name: 'Unused', reasoning: false, vision: false, contextWindow: 32768, maxTokens: 1024 }],
  }), address);
  const settings = () => page.evaluate(() => window.desktop.settings());
  const snapshot = () => page.evaluate(() => window.desktop.snapshot());
  await page.evaluate(() => {
    window.routingEvents = [];
    window.desktop.onEvent(event => {
      const { type, method, runtimeId, message, command, success } = event;
      if (['message_update', 'desktop_stats', 'desktop_runtimes'].includes(type)) return;
      window.routingEvents.push({ type, method, runtimeId, command, success,
        ...(typeof message === 'string' ? { message: message.slice(0, 300) } : {}) });
      window.routingEvents = window.routingEvents.slice(-30);
    });
  });
  async function prompt() {
    let state = await snapshot();
    assert.deepEqual(failures, []);
    if (state.draftId) {
      state = await page.evaluate(() => window.desktop.newIndependentSession());
    }
    assert.deepEqual(failures, []);
    const model = state.models.find(model => model.provider === 'step' && model.id === 'step-3.5-flash');
    assert.ok(model, `Fixture model must be available: ${JSON.stringify(state.models.map(m => ({ id: m.id, provider: m.provider })))}`);
    console.log('Account routing: selecting fixture model');
    await page.evaluate(({ model, id }) => window.desktop.command('set_model', { provider: model.provider, modelId: model.id }, id),
      { model, id: state.runtimeId });
    const replies = state.messages.filter(m => m.role === 'assistant').length;
    console.log('Account routing: sending fixture prompt');
    let timer;
    let receipt;
    try {
      receipt = await Promise.race([
        page.evaluate(id => window.desktop.command('prompt', { message: 'Reply briefly without tools.' }, id), state.runtimeId),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`Fixture prompt timed out: ${JSON.stringify(seen)} ${JSON.stringify(failures)}`)), 15000); }),
      ]);
    } finally { clearTimeout(timer); }
    const until = Date.now() + 20000;
    while (true) {
      const completed = await snapshot();
      const answers = completed.messages.filter(m => m.role === 'assistant' && m.stopReason);
      if (!completed.state?.isStreaming && answers.length > replies) {
        if (!rejectPlan) assert.equal(answers.at(-1).stopReason, 'stop', answers.at(-1).errorMessage);
        break;
      }
      if (Date.now() > until) throw new Error(`Completion timed out: ${JSON.stringify({
        seen, failures, receipt, expectedRuntime: state.runtimeId, runtimeId: completed.runtimeId,
        state: completed.state, pending: completed.pendingMessages, requests: completed.requests,
        messages: completed.messages.map(({ role, stopReason, errorMessage }) => ({ role, stopReason, errorMessage })),
        events: await page.evaluate(() => window.routingEvents),
      })}`);
      await page.waitForTimeout(50);
    }
  }
  async function beginPlan(id) {
    await app.evaluate(() => { globalThis.routingAuthUrl = undefined; });
    await page.evaluate(id => {
      window.routingLoginError = undefined;
      window.routingLogin = window.desktop.login(id).then(() => null, error => {
        window.routingLoginError = error.message;
        return error.message;
      });
    }, id);
    const until = Date.now() + 15000;
    while (!await app.evaluate(() => Boolean(globalThis.routingAuthUrl))) {
      const error = await page.evaluate(() => window.routingLoginError);
      if (error) throw new Error(error);
      if (Date.now() > until) throw new Error('OAuth URL wait timed out');
      await page.waitForTimeout(50);
    }
    return new URL(await app.evaluate(() => globalThis.routingAuthUrl));
  }
  async function completePlan(url, key) {
    assert.equal(url.searchParams.get('flow_id'), flow.id);
    assert.equal(key, routes[flow.profile][2]);
    flow.ready = true;
    assert.equal(await page.evaluate(() => window.routingLogin), null);
  }
  for (const id of ['platform_cn', 'step_plan', 'platform_oversea', 'step_plan_oversea', 'platform_cn']) {
    console.log(`Account routing: signing in ${id}`);
    expected = id;
    const start = seen.length;
    if (id.startsWith('platform_')) {
      await page.evaluate(({ id, key }) => window.desktop.login(id, key), { id, key: routes[id][2] });
    } else {
      const authUrl = await beginPlan(id);
      assert.equal(authUrl.hostname, id === 'step_plan' ? 'platform.stepfun.com' : 'platform.stepfun.ai');
      await assert.rejects(page.evaluate(() => window.desktop.command('prompt', { message: 'Must not run during login' })),
        /Shared settings operation in progress/);
      await completePlan(authUrl, routes[id][2]);
    }
    assert.equal((await settings()).account.profile, id);
    const allowance = await page.evaluate(() => window.desktop.accountAllowance(true));
    assert.equal(allowance.source, id.startsWith('platform_') ? 'api' : 'plan');
    await prompt();
    assert.ok(seen.slice(start).some(request => request.path.endsWith('/chat/completions')),
      'Each authenticated profile must make a real runtime model request');
    assert.deepEqual(failures, []);
    console.log(`Account routing passed: ${id}`);
  }
  hold = true;
  const active = await snapshot();
  await page.evaluate(id => {
    window.routingPrompt = window.desktop.command('prompt', { message: 'Wait for the fixture release.' }, id);
  }, active.runtimeId);
  const holdDeadline = Date.now() + 10000;
  while (!release) {
    if (Date.now() > holdDeadline) throw new Error('Held API request did not start');
    await page.waitForTimeout(50);
  }
  await assert.rejects(page.evaluate(() => window.desktop.login('step_plan')),
    /running|busy|idle|Stop|stop|运行/);
  assert.equal((await settings()).account.profile, 'platform_cn');
  hold = false;
  release();
  release = undefined;
  await page.evaluate(() => window.routingPrompt);
  const drainDeadline = Date.now() + 10000;
  while ((await snapshot()).state?.isStreaming) {
    if (Date.now() > drainDeadline) throw new Error('Held API request did not finish');
    await page.waitForTimeout(50);
  }
  const pending = await beginPlan('step_plan');
  assert.ok(pending.searchParams.get('flow_id'));
  await page.evaluate(() => window.desktop.cancelLogin());
  assert.ok(await page.evaluate(() => window.routingLogin));
  assert.equal((await settings()).account.profile, 'platform_cn');
  await prompt();
  expected = 'step_plan';
  await completePlan(await beginPlan('step_plan'), routes.step_plan[2]);
  rejectPlan = true;
  const start = seen.length;
  await prompt();
  assert.ok(seen.slice(start).some(request => request.path === '/step_plan/v1/chat/completions'));
  assert.ok(seen.slice(start).every(request => request.path !== '/v1/chat/completions'),
    'Plan denial must never fall back to pay-as-you-go API');
  assert.equal((await settings()).account.profile, 'step_plan');
  assert.deepEqual(failures, []);
  console.log('Account routing passed: running API blocks login changes; cancellation preserves API identity; denied Plan never falls back to API.');
} catch (error) {
  console.error(error.message);
  throw error;
} finally {
  release?.();
  await app?.close();
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}
