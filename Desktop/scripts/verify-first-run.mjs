import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'node:http';
import { assertFocusVisible } from './assert-focus-visible.mjs';
import { closeDesktopFixtureAndWait } from './close-desktop-fixture.mjs';
import { settleLayout } from './settle-layout.mjs';
import { waitForSessionFixtureSnapshot } from './session-fixture.mjs';

const output = resolve('test-results/first-run-native');
await mkdir(output, { recursive: true });
const requests = [];
const officialRequests = [];
const transportErrors = [];
const accounts = {
  platform_cn: { host: 'api.stepfun.com', prefix: '/v1', key: 'isolated-api-cn' },
  platform_oversea: { host: 'api.stepfun.ai', prefix: '/v1', key: 'isolated-api-global' },
  step_plan: { host: 'api.stepfun.com', prefix: '/step_plan/v1', key: 'isolated-plan-cn' },
  step_plan_oversea: { host: 'api.stepfun.ai', prefix: '/step_plan/v1', key: 'isolated-plan-global' },
};
let expectedAccount = 'platform_oversea', loginFlow, rejectKey = false;
const server = createServer(async (request, response) => {
  if (request.url.startsWith('/?url=')) {
    try {
      const url = new URL(new URL(request.url, 'http://fixture').searchParams.get('url'));
      response.setHeader('content-type', 'application/json');
      if (url.hostname.startsWith('platform.stepfun.')) {
        if (url.pathname.endsWith('/init')) {
          let raw = '';
          for await (const chunk of request) raw += chunk;
          const { profile } = JSON.parse(raw);
          assert.ok(profile === 'step_plan' || profile === 'step_plan_oversea');
          assert.equal(url.hostname, profile === 'step_plan' ? 'platform.stepfun.com' : 'platform.stepfun.ai');
          loginFlow = { id: `first-run-${Date.now()}`, profile, ready: false };
          response.end(JSON.stringify({ flow_id: loginFlow.id, poll_interval_sec: 1, expires_at: Math.floor(Date.now() / 1000) + 60 }));
        } else {
          assert.equal(url.pathname, `/api/stdhttp/v1/cli-login/poll/${loginFlow.id}`);
          response.end(JSON.stringify(loginFlow.ready
            ? { state: 'ready', uid: '42', credential: { api_key: accounts[loginFlow.profile].key } }
            : { state: 'pending' }));
        }
        return;
      }
      const account = accounts[expectedAccount];
      assert.equal(url.hostname, account.host);
      if (rejectKey) { response.writeHead(401); response.end(JSON.stringify({ error: { message: 'Invalid key' } })); return; }
      assert.equal(request.headers.authorization, `Bearer ${account.key}`);
      if (url.pathname.endsWith('/models')) {
        assert.equal(url.pathname, `${account.prefix}/models`);
        response.end(JSON.stringify({ data: [{ id: 'step-3.5-flash', name: 'Step Onboarding', context_window: 256000 }] }));
      } else if (url.pathname.includes('/models/')) {
        response.end(JSON.stringify({ id: url.pathname.split('/').at(-1), enable_reason: false, reasoning_effort_support_list: ['off'] }));
      } else if (url.pathname === '/v1/accounts') {
        response.end(JSON.stringify({ object: 'account', type: 'prepaid', balance: 12 }));
      } else if (url.pathname === '/step_plan/v1/usage') {
        response.end(JSON.stringify({ schema_version: 1, scope: 'personal_account', observed_at_ms: Date.now(),
          account: { id: '42' }, plan: { state: 'known', family: 'none' },
          quota: { state: 'known', allowed: false, reason: 'no_subscription', windows: [], credit_buckets: [] } }));
      } else if (url.pathname.endsWith('/chat/completions')) {
        assert.equal(url.pathname, `${account.prefix}/chat/completions`);
        officialRequests.push({ account: expectedAccount, path: url.pathname });
        for await (const _ of request) { /* Never persist credentials or prompts. */ }
        response.writeHead(200, { 'content-type': 'text/event-stream' });
        response.end(`data: ${JSON.stringify({ id: 'first-run-official', object: 'chat.completion.chunk',
          model: 'step-3.5-flash', choices: [{ index: 0, delta: { role: 'assistant', content: 'Official loopback reply.' }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`);
      } else throw new Error(`Unexpected official fixture path: ${url.pathname}`);
    } catch (error) {
      transportErrors.push(error.message);
      if (!response.headersSent) response.writeHead(500);
      response.end('Fixture transport rejected the request');
    }
    return;
  }
  if (request.method === 'GET' && request.url === '/v1/models') {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ data: [
      { id: 'first-run-model', name: 'First-run model', effort: { supported_levels: ['low', 'high'], default_level: 'high' } },
      { id: 'first-run-alternative', name: 'First-run alternative' },
    ] }));
    return;
  }
  try {
    let raw = '';
    for await (const chunk of request) { raw += chunk; assert.ok(raw.length < 2 * 1024 * 1024); }
    const body = JSON.parse(raw);
    requests.push(body);
    assert.equal(body.model, 'first-run-alternative');
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    response.write(`data: ${JSON.stringify({ id: 'onboarding', object: 'chat.completion.chunk', created: 1,
      model: body.model, choices: [{ index: 0, delta: { role: 'assistant', content: 'First-run loopback reply.' }, finish_reason: null }] })}\n\n`);
    // Visible streamed text is not yet a committed, restorable assistant reply.
    await new Promise(resolve => setTimeout(resolve, 300));
    response.write(`data: ${JSON.stringify({ id: 'onboarding', object: 'chat.completion.chunk', created: 1,
      model: body.model, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\n`);
    response.end('data: [DONE]\n\n');
  } catch { if (!response.headersSent) response.writeHead(500); response.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const address = `http://127.0.0.1:${server.address().port}/v1`;
const secret = 'isolated-first-run-fixture-key';
const errors = [];
let app, page, phase = 'launch';
const mark = value => { phase = value; console.log(`First-run acceptance: ${value}`); };
const profile = async () => realpath(await mkdtemp(join(tmpdir(), 'desktop-first-run-native-')));
const launch = async root => {
  const env = { ...process.env, DESKTOP_TEST_USER_DATA: root, DESKTOP_TEST_NO_FOCUS: '1' };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.DESKTOP_TEST_STARTUP_WINDOW;
  delete env.DESKTOP_DEV_URL;
  delete env.STEP_API_KEY;
  app = await electron.launch({
    ...(process.env.DESKTOP_VERIFY_EXE ? { executablePath: process.env.DESKTOP_VERIFY_EXE } : { args: [resolve('.')] }), env, timeout: 60000,
  });
  page = await app.firstWindow();
  page.on('pageerror', error => errors.push(error.message));
  await app.evaluate(({ BrowserWindow, dialog, nativeTheme }) => {
    const window = BrowserWindow.getAllWindows()[0];
    window.setOpacity(0); window.setIgnoreMouseEvents(true); window.showInactive(); window.setSize(1280, 900);
    nativeTheme.themeSource = 'light';
    dialog.showMessageBox = async () => ({ response: 1 });
  });
};
const close = async () => {
  if (!app) return;
  const child = app.process();
  await closeDesktopFixtureAndWait(app);
  assert.equal(child.exitCode, 0, 'first-run launcher exits successfully before reusing its profile');
  assert.equal(app.windows().length, 0, 'first-run windows close before relaunch');
  app = undefined;
};
const snapshot = () => page.evaluate(() => window.desktop.snapshot());
const stopIntro = async () => {
  await page.getByRole('heading', { name: '连接模型服务', exact: true }).waitFor({ timeout: 60000 });
  await page.waitForFunction(() => !document.querySelector('.first-run-skip-motion'));
};
const next = () => page.locator('.first-run-next').click();
const menu = async (name, option) => {
  await page.getByRole('button', { name, exact: true }).click();
  await page.getByRole('menuitemradio', { name: option, exact: true }).click();
  await settleLayout(page.locator('.first-run-production'));
};
const checkImages = async () => {
  assert.equal(await page.locator('.first-run-brand img:visible').count(), 2);
  assert.ok(await page.locator('.first-run-brand img:visible').evaluateAll(images => images.every(image => image.complete && image.naturalWidth > 0)));
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
};
const installOfficialTransport = async root => {
  const preload = join(root, 'first-run-transport.cjs');
  const base = new URL(address).origin;
  await writeFile(preload, `
let transport = globalThis.fetch;
const routed = (input, init) => {
  const url = String(input instanceof Request ? input.url : input);
  if (!['api.stepfun.com', 'api.stepfun.ai', 'platform.stepfun.com', 'platform.stepfun.ai'].includes(new URL(url).hostname))
    throw new Error('External request blocked by first-run fixture');
  return transport(${JSON.stringify(base)} + '/?url=' + encodeURIComponent(url), init);
};
Object.defineProperty(globalThis, 'fetch', { configurable: true, get: () => routed,
  set: value => { if (value !== routed) transport = value; } });
`);
  await app.evaluate(({ net, shell }, { preload, base }) => {
    const cp = process.getBuiltinModule('child_process');
    const spawn = cp.spawn;
    cp.spawn = function(file, args, options) {
      if (args?.some(arg => /(?:admin\.mjs|step\.js)$/.test(arg))) args = ['--require', preload, ...args];
      return spawn.call(this, file, args, options);
    };
    process.getBuiltinModule('module').syncBuiltinESMExports();
    net.fetch = (input, init) => fetch(base + '/?url=' + encodeURIComponent(String(input)), init);
    globalThis.firstRunAuthUrl = undefined;
    shell.openExternal = async url => { globalThis.firstRunAuthUrl = url; };
  }, { preload, base });
  // Restart only the isolated admin child so subsequent login uses the loopback transport.
  await page.evaluate(address => window.desktop.saveProvider({
    id: '', name: 'Disabled transport fixture', baseUrl: address, api: 'openai-completions', enabled: false, keyless: true,
    models: [{ id: 'unused', name: 'Unused', reasoning: false, vision: false, contextWindow: 32768, maxTokens: 1024 }],
  }), address);
};
try {
  mark('fresh profile, real production entry and interrupted setup');
  const root = await profile();
  await launch(root);
  await stopIntro();
  assert.equal((await snapshot()).firstRun.required, true);
  assert.equal((await snapshot()).runtimeId, undefined);
  assert.equal(await page.locator('.first-run-lab').count(), 0, 'production has no mock scenario controls');
  assert.equal(await page.evaluate(() => typeof window.require), 'undefined');
  await checkImages();
  await page.screenshot({ path: join(output, '01-account-light.png') });
  await app.evaluate(({ nativeTheme }) => { nativeTheme.themeSource = 'dark'; });
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
  await checkImages();
  await page.screenshot({ path: join(output, '01-account-dark.png') });
  await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    window.setMinimumSize(320, 480); window.setSize(390, 800);
  });
  await menu('语言', 'English');
  await page.locator('.first-run-service').filter({ hasText: 'Step API' }).click();
  await assertFocusVisible(page, page.getByLabel('API Key', { exact: true }), 'narrow dark onboarding key');
  await checkImages();
  await page.screenshot({ path: join(output, '01-account-dark-narrow-en.png') });
  await app.evaluate(({ nativeTheme }) => { nativeTheme.themeSource = 'light'; });
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'light');
  await assertFocusVisible(page, page.getByLabel('API Key', { exact: true }), 'narrow light onboarding key');
  await page.screenshot({ path: join(output, '01-account-light-narrow-en.png') });
  await menu('Language', '简体中文');
  await app.evaluate(({ BrowserWindow, nativeTheme }) => {
    BrowserWindow.getAllWindows()[0].setSize(1280, 900);
    nativeTheme.themeSource = 'system';
  });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.reload();
  await stopIntro();
  assert.equal(await page.locator('.first-run-brand').evaluate(element => element.getAnimations().length), 0, 'reduced motion bypasses brand movement');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  assert.equal((await snapshot()).firstRun.required, true);
  await close();
  await launch(root);
  await stopIntro();
  assert.equal((await snapshot()).firstRun.required, true, 'partial startup files do not classify pending users as legacy');
  await page.getByRole('button', { name: '稍后设置', exact: true }).click();
  await page.locator('.new-session').waitFor();
  assert.equal((await snapshot()).firstRun.required, false);
  assert.equal(JSON.parse(await readFile(join(root, 'first-run.json'), 'utf8')).outcome, 'skipped');
  await close();
  await launch(root);
  await page.locator('.new-session').waitFor({ timeout: 60000 });
  assert.equal(await page.locator('.first-run-production').count(), 0, 'skip survives relaunch/reinstall with retained data');
  await close();

  mark('real custom-provider configuration, native project chooser and draft handoff');
  const customRoot = await profile();
  await launch(customRoot);
  await stopIntro();
  await page.locator('.first-run-service').filter({ hasText: '其他供应商' }).click();
  await page.getByRole('heading', { name: '自定义供应商', exact: true }).waitFor();
  await page.getByRole('button', { name: '添加供应商', exact: true }).first().click();
  await page.getByRole('textbox', { name: '名称', exact: true }).fill('Onboarding loopback');
  await page.getByLabel('Base URL', { exact: true }).fill(address);
  await page.getByLabel('API Key', { exact: true }).fill(secret);
  await assertFocusVisible(page, page.getByLabel('API Key', { exact: true }), 'onboarding provider key');
  await page.getByRole('button', { name: '从上游获取', exact: true }).click();
  await page.getByRole('checkbox', { name: /first-run-model/ }).check();
  await page.getByRole('checkbox', { name: /first-run-alternative/ }).check();
  await page.getByRole('button', { name: '加入 2', exact: true }).click();
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await page.getByText('已保存', { exact: true }).waitFor();
  assert.equal(requests.length, 0, 'model discovery and saving make no inference request');
  await next();
  await page.getByRole('heading', { name: '从哪里开始？', exact: true }).waitFor();
  const project = join(customRoot, 'User project');
  await mkdir(project);
  await app.evaluate(({ dialog }) => { dialog.showOpenDialog = async () => ({ canceled: true, filePaths: [] }); });
  await page.getByRole('button', { name: '浏览文件夹', exact: true }).click();
  assert.equal(await page.getByLabel('项目目录', { exact: true }).inputValue(), '');
  assert.equal(await page.locator('.first-run-next').isDisabled(), true);
  await app.evaluate(({ dialog }, project) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [project] }); }, project);
  await page.getByRole('button', { name: '浏览文件夹', exact: true }).click();
  await page.waitForFunction(project => document.querySelector('#first-run-directory')?.value === project, project);
  await page.getByRole('button', { name: '访问权限', exact: true }).click();
  await page.getByRole('menuitemradio', { name: /代我批准/ }).click();
  await next();
  await page.getByRole('heading', { name: '开始阶跃。', exact: true }).waitFor();
  let value = await snapshot();
  assert.equal(value.preferences.workspace, project);
  assert.equal(value.permissionPreset, 'approve-for-me');
  assert.equal(value.state.model.id, 'first-run-model');
  const picker = page.locator('.model-effort-trigger');
  await picker.click();
  await page.getByRole('button', { name: '选择模型', exact: true }).click();
  await page.locator('.model-picker-row').filter({ hasText: 'First-run alternative' }).getByRole('button').first().click();
  await page.waitForFunction(() => document.querySelector('.model-effort-trigger')?.textContent.includes('First-run alternative'));
  await settleLayout(page.locator('.first-run-production'));
  assert.equal((await snapshot()).state.model.id, 'first-run-alternative');
  await page.screenshot({ path: join(output, '02-review-light.png') });
  assert.equal(requests.length, 0);
  assert.equal((await snapshot()).runtimeId, undefined, 'setup must not spawn an agent');
  assert.equal((await readdir(join(customRoot, 'step-runtime/sessions'))).length, 0);
  await next();
  await page.locator('.new-session').waitFor();
  value = await snapshot();
  assert.equal(value.firstRun.required, false);
  assert.equal(value.permissionPreset, 'approve-for-me');
  assert.equal(value.state.model.id, 'first-run-alternative');
  assert.equal(value.runtimeId, undefined);
  assert.equal(value.independent, false);
  assert.ok(value.preferences.workspaces.includes(project));
  assert.equal(requests.length, 0);
  assert.equal((await readFile(join(customRoot, 'step-runtime/auth.dpapi'))).includes(Buffer.from(secret)), false);
  assert.ok(!(await page.locator('body').innerText()).includes(secret));
  await page.evaluate(() => {
    window.firstRunCompletion = undefined;
    window.desktop.onEvent(event => {
      if (event.type === 'agent_start') {
        window.firstRunCompletion = { runtimeId: event.runtimeId, replyEnded: false, settled: false };
      }
      const run = window.firstRunCompletion;
      if (!run || run.runtimeId !== event.runtimeId) return;
      if (event.type === 'message_end' && event.message?.role === 'assistant'
        && event.message.stopReason === 'stop' && JSON.stringify(event.message.content).includes('First-run loopback reply.')) {
        run.replyEnded = true;
      }
      if (event.type === 'agent_settled' && run.replyEnded) run.settled = true;
    });
  });
  await page.getByRole('textbox', { name: '消息', exact: true }).fill('Reply using the onboarding provider.');
  await page.getByRole('button', { name: '发送', exact: true }).click();
  await page.getByText('First-run loopback reply.', { exact: true }).waitFor({ timeout: 60000 });
  assert.equal(requests.length, 1, 'only the explicit first send invokes the configured model');
  await page.waitForFunction(() => window.firstRunCompletion?.settled);
  const completion = await page.evaluate(() => window.firstRunCompletion);
  const completed = await waitForSessionFixtureSnapshot(page, value =>
    completion.runtimeId === value.runtimeId && !value.state?.isStreaming
      && value.messages.some(message => message.role === 'assistant'
      && message.stopReason === 'stop' && JSON.stringify(message.content).includes('First-run loopback reply.')),
  'the first completed onboarding reply');
  assert.equal(completed.state.model.id, 'first-run-alternative');
  const saved = (await readFile(completed.state.sessionFile, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
  assert.equal(saved[0].id, completed.state.sessionId, 'the completed session has a durable header');
  assert.ok(saved.some(entry => entry.type === 'message' && entry.message.role === 'assistant'
    && entry.message.stopReason === 'stop' && JSON.stringify(entry.message.content).includes('First-run loopback reply.')),
  'the first reply is saved before quitting');
  await close();
  await launch(customRoot);
  await page.locator('.new-session').waitFor({ timeout: 60000 });
  assert.equal(await page.locator('.first-run-production').count(), 0, 'completed setup never reappears on an update');
  assert.equal((await snapshot()).sessions.length, 1, 'history remains after relaunch');
  assert.equal((await snapshot()).sessions[0].id, completed.state.sessionId, 'relaunch lists the saved session identity');
  mark('restored history keeps runtime controls available after renderer reload');
  await page.evaluate(id => window.desktop.switchSession(id), (await snapshot()).sessions[0].id);
  await page.reload();
  await page.waitForFunction(() => {
    const button = document.querySelector('.permission-trigger');
    return button && !button.disabled;
  }, undefined, { timeout: 60000 });
  assert.equal((await snapshot()).state.model.id, 'first-run-alternative');
  await page.getByRole('button', { name: '访问权限', exact: true }).click();
  await page.getByRole('menuitemradio', { name: /请求批准/ }).click();
  await waitForSessionFixtureSnapshot(page, value => value.permissionPreset === 'ask', 'restored Ask permissions');
  assert.equal(requests.length, 1, 'restoring runtime controls does not send another model request');
  await close();

  mark('official API regions, invalid credentials, Plan cancellation and Full Access safety');
  const accountRoot = await profile();
  await launch(accountRoot);
  await stopIntro();
  await installOfficialTransport(accountRoot);
  await page.locator('.first-run-service').filter({ hasText: '阶跃 API' }).click();
  await page.getByRole('button', { name: '海外', exact: true }).click();
  await page.getByLabel('API Key', { exact: true }).fill('invalid-fixture-key');
  rejectKey = true;
  await next();
  await page.getByRole('alert').waitFor();
  assert.equal((await snapshot()).firstRun.required, true);
  assert.equal((await snapshot()).runtimeId, undefined);
  rejectKey = false;
  await page.getByLabel('API Key', { exact: true }).fill(accounts.platform_oversea.key);
  await next();
  await page.getByRole('heading', { name: '从哪里开始？', exact: true }).waitFor();
  assert.equal((await page.evaluate(() => window.desktop.settings())).account.profile, 'platform_oversea');
  await page.getByRole('button', { name: '更改', exact: true }).click();
  await page.locator('.first-run-service').filter({ hasText: 'Step Plan' }).click();
  await page.getByRole('button', { name: '中国大陆', exact: true }).click();
  await next();
  const waitAuthUrl = async () => {
    const until = Date.now() + 15000;
    while (!await app.evaluate(() => Boolean(globalThis.firstRunAuthUrl))) {
      if (Date.now() > until) throw new Error('Onboarding authorization did not open');
      await page.waitForTimeout(50);
    }
    return new URL(await app.evaluate(() => globalThis.firstRunAuthUrl));
  };
  assert.equal((await waitAuthUrl()).hostname, 'platform.stepfun.com');
  assert.equal(await page.locator('.first-run-next').isDisabled(), true);
  await assert.rejects(page.evaluate(() => window.desktop.finishFirstRun('skipped')), /settings operation in progress/);
  await assert.rejects(page.evaluate(() => window.desktop.pluginSaveConfiguration({})), /settings operation in progress/);
  await assert.rejects(page.evaluate(() => window.desktop.pluginSaveHostSettings({})), /settings operation in progress/);
  await assert.rejects(page.evaluate(() => window.desktop.bvrSaveConfiguration({})), /settings operation in progress/);
  await page.getByRole('button', { name: '取消授权', exact: true }).click();
  await page.getByRole('alert').waitFor();
  assert.equal((await page.evaluate(() => window.desktop.settings())).account.profile, 'platform_oversea', 'cancelled Plan leaves the API account unchanged');
  await page.getByRole('button', { name: '海外', exact: true }).click();
  await app.evaluate(() => { globalThis.firstRunAuthUrl = undefined; });
  await next();
  assert.equal((await waitAuthUrl()).hostname, 'platform.stepfun.ai');
  expectedAccount = 'step_plan_oversea';
  loginFlow.ready = true;
  await page.getByRole('heading', { name: '从哪里开始？', exact: true }).waitFor();
  assert.equal((await page.evaluate(() => window.desktop.settings())).account.profile, 'step_plan_oversea');
  await page.locator('.first-run-scope label').filter({ hasText: '独立会话' }).click();
  await page.getByRole('button', { name: '访问权限', exact: true }).click();
  await page.getByRole('menuitemradio', { name: /完全访问/ }).click();
  await next();
  await page.getByRole('heading', { name: '开始阶跃。', exact: true }).waitFor();
  assert.equal((await snapshot()).permissionPreset, 'full-access');
  assert.equal((await snapshot()).runtimeId, undefined);
  assert.equal(officialRequests.length, 0, 'authorization, no-plan account and setup never send a model request');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await next();
  await page.locator('.new-session').waitFor();
  const message = page.getByRole('textbox', { name: '消息', exact: true });
  await message.fill('Do not send before Full Access is acknowledged.');
  await page.getByRole('button', { name: '发送', exact: true }).click();
  await page.getByRole('dialog', { name: '启用完全访问？', exact: true }).waitFor();
  assert.equal(officialRequests.length, 0);
  await page.getByRole('button', { name: '取消，保持当前权限', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('.full-access-risk-message'));
  assert.equal(officialRequests.length, 0, 'risk cancellation must not submit the message');
  assert.equal((await snapshot()).permissionPreset, 'ask');
  assert.equal((await snapshot()).messages.filter(message => message.role === 'user').length, 0);
  await close();

  mark('legacy upgrade bypass preserves settings');
  const legacy = await profile();
  await writeFile(join(legacy, 'preferences.json'), JSON.stringify({ language: 'en', theme: 'dark', workspaces: [], favoriteModels: [{ provider: 'step', id: 'step-5-preview' }] }));
  await launch(legacy);
  await page.locator('.new-session').waitFor({ timeout: 60000 });
  value = await snapshot();
  assert.equal(value.firstRun.required, false);
  assert.equal(value.preferences.language, 'en');
  assert.equal(value.preferences.theme, 'dark');
  assert.equal(value.preferences.favoriteModels[0].id, 'step-5-preview');
  assert.equal(JSON.parse(await readFile(join(legacy, 'first-run.json'), 'utf8')).outcome, 'existing');
  await close();
  mark('future onboarding metadata never locks an existing profile out');
  const future = await profile();
  const futureRecord = '{"version":2,"outcome":"completed"}';
  await writeFile(join(future, 'first-run.json'), futureRecord);
  await launch(future);
  await page.locator('.new-session').waitFor({ timeout: 60000 });
  assert.equal((await snapshot()).firstRun.required, false);
  assert.equal(await readFile(join(future, 'first-run.json'), 'utf8'), futureRecord);
  await close();
  assert.deepEqual(errors, []);
  assert.deepEqual(transportErrors, []);
  console.log('Production first-run lifecycle, native chooser, saved provider, permissions, model handoff and loopback first send passed.');
} catch (error) {
  console.error(`First-run failure during ${phase}`);
  if (page && !page.isClosed()) {
    await page.screenshot({ path: join(output, 'failure.png'), fullPage: true }).catch(() => {});
    console.error(await page.locator('[role="alert"]').allTextContents().catch(() => []));
  }
  throw error;
} finally {
  await close();
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}
