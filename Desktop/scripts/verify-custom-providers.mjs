import { assertFocusVisible } from './assert-focus-visible.mjs';
import { settleLayout } from './settle-layout.mjs';
import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { mkdtemp } from './test-profile.mjs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'node:http';
import { submitSessionFixture, waitForSessionFixtureSnapshot, waitForSessionFixtureTools } from './session-fixture.mjs';
import { closeDesktopFixtureAndWait } from './close-desktop-fixture.mjs';

const profile = await mkdtemp(join(tmpdir(), 'desktop-custom-providers-'));
const releaseCommand = join(profile, 'release-provider-background-command');
const backgroundPrompt = 'Hold an idle background command';
await writeFile(join(profile, 'preferences.json'), JSON.stringify({ language: 'zh', theme: 'dark', workspaces: [] }));
await mkdir(join(profile, 'step-runtime'), { recursive: true });
await writeFile(join(profile, 'step-runtime/config.toml'), 'permissionPreset = "approve-for-me"\n[telemetry]\nenabled = false\n[mcp_servers.steppage__steppage]\nenabled = false\n');
const requests = [];
const textOfMessage = message => typeof message.content === 'string' ? message.content
  : message.content?.filter(block => block.type === 'text').map(block => block.text ?? '').join('\n') ?? '';
let expectedKey = 'isolated-provider-fixture';
let expectNoAuth = false;
let release;
let hold = false;
let diagnosticMode = 'reply';
const server = createServer(async (req, res) => {
  try {
    if (expectNoAuth && (req.headers.authorization !== undefined || req.headers['x-api-key'] !== undefined)) {
      console.log('No-auth fixture rejected unexpected authentication:', req.url?.split('?')[0]);
      res.writeHead(400); res.end('Unexpected authentication'); return;
    }
    if (req.method === 'GET' && req.url === '/v1/models') {
      if (!expectNoAuth) assert.equal(req.headers.authorization, `Bearer ${expectedKey}`);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ data: [{ id: 'fixture-custom', name: 'Fixture Custom', input_modalities: ['text', 'image', 'audio'], output_modalities: ['text'], effort: { supported_levels: ['off', 'low', 'high', 'ultra', 'future-effort'], default_level: 'ultra' }, context_window: 200000, max_output_tokens: 30000 }, { id: 'fixture-second' }] }));
      return;
    }
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw);
    requests.push({ path: req.url, body, keyMatches: req.headers.authorization === `Bearer ${expectedKey}` || req.headers['x-api-key'] === expectedKey,
      noAuth: req.headers.authorization === undefined && req.headers['x-api-key'] === undefined });
    if (body.stream === false) {
      assert.equal(body.messages?.[0]?.content ?? body.input, 'Reply with OK only.');
      if (diagnosticMode === 'hold') { await new Promise(resolve => res.once('close', resolve)); return; }
      if (diagnosticMode === 'auth') { res.writeHead(401); res.end(JSON.stringify({ error: { message: expectedKey } })); return; }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(req.url.startsWith('/v1/responses')
        ? { object: 'response', status: 'completed', output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'OK' }] }] }
        : req.url.startsWith('/v1/messages')
          ? { type: 'message', role: 'assistant', content: [{ type: 'text', text: 'OK' }] }
          : { choices: [{ message: { role: 'assistant', content: 'OK' } }] }));
      return;
    }
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    const sse = (data, event = false) => res.write(`${event ? `event: ${data.type}\n` : ''}data: ${JSON.stringify(data)}\n\n`);
    if (req.url.startsWith('/v1/responses')) {
      sse({ type: 'response.created', response: { id: 'resp_fixture' } });
      sse({ type: 'response.output_item.added', output_index: 0, item: { type: 'message', id: 'msg_fixture', status: 'in_progress', role: 'assistant', content: [] } });
      sse({ type: 'response.output_text.delta', output_index: 0, item_id: 'msg_fixture', content_index: 0, delta: 'Responses fixture reply.' });
      sse({ type: 'response.output_item.done', output_index: 0, item: { type: 'message', id: 'msg_fixture', status: 'completed', role: 'assistant', content: [{ type: 'output_text', text: 'Responses fixture reply.', annotations: [] }] } });
      sse({ type: 'response.completed', response: { id: 'resp_fixture', status: 'completed', usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15, input_tokens_details: { cached_tokens: 0 } } } });
      res.end(); return;
    }
    if (req.url.startsWith('/v1/messages')) {
      sse({ type: 'message_start', message: { id: 'msg_fixture', type: 'message', role: 'assistant', content: [], model: body.model, usage: { input_tokens: 10, output_tokens: 0 } } }, true);
      sse({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }, true);
      sse({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Anthropic fixture reply.' } }, true);
      sse({ type: 'content_block_stop', index: 0 }, true);
      sse({ type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 5 } }, true);
      sse({ type: 'message_stop' }, true);
      res.end(); return;
    }
    const send = (delta, finish_reason = null) => res.write(`data: ${JSON.stringify({
      id: 'provider-fixture', object: 'chat.completion.chunk', created: 1, model: body.model,
      choices: [{ index: 0, delta, finish_reason }],
    })}\n\n`);
    send({ role: 'assistant', content: '' });
    const textOf = m => typeof m.content === 'string' ? m.content : m.content?.filter(c => c.type === 'text').map(c => c.text).join('\n');
    const userIndex = body.messages.findLastIndex(m => m.role === 'user' && textOf(m) === 'Test custom provider');
    const user = body.messages[userIndex]?.content;
    const userText = typeof user === 'string' ? user : user?.filter(c => c.type === 'text').map(c => c.text).join('\n');
    if (userText === 'Test custom provider' && !body.messages.slice(userIndex + 1).some(m => m.role === 'tool')) {
      const tool = body.tools.find(t => t.function?.name === 'task_list');
      assert.ok(tool, 'configured provider receives real runtime tool schemas');
      send({ tool_calls: [{ index: 0, id: 'provider-task-list', type: 'function', function: { name: tool.function.name, arguments: '{}' } }] });
      send({}, 'tool_calls'); res.end('data: [DONE]\n\n'); return;
    }
    const latestUser = body.messages.findLast(message => message.role === 'user');
    if (textOfMessage(latestUser ?? {}) === backgroundPrompt
      && !body.messages.some(message => message.tool_call_id === 'provider-background-command')) {
      assert.ok(body.tools.some(tool => tool.function?.name === 'run_command'));
      const marker = Buffer.from(releaseCommand).toString('base64');
      const child = `const fs=require("node:fs"),path=Buffer.from("${marker}","base64").toString();let t=setInterval(()=>{if(fs.existsSync(path))process.exit(0)},50);setTimeout(()=>clearInterval(t),20000);`;
      const node = JSON.stringify(process.execPath.replaceAll('\\', '/'));
      send({ tool_calls: [{ index: 0, id: 'provider-background-command', type: 'function', function: { name: 'run_command',
        arguments: JSON.stringify({ command: `${node} -e '${child}'`, run_in_background: true }),
      } }] });
      send({}, 'tool_calls'); res.end('data: [DONE]\n\n'); return;
    }
    if (hold) await new Promise(resolve => { release = resolve; });
    send({ content: 'Custom provider fixture reply.' });
    send({}, 'stop');
    res.end('data: [DONE]\n\n');
  } catch { if (!res.headersSent) res.writeHead(500); res.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const address = `http://127.0.0.1:${server.address().port}/v1`;
const env = { ...process.env, DESKTOP_TEST_USER_DATA: profile, DESKTOP_TEST_NO_FOCUS: '1' };
delete env.ELECTRON_RUN_AS_NODE;
let app;
let page;
const launch = async () => {
  app = await electron.launch({ ...(process.env.DESKTOP_VERIFY_EXE ? { executablePath: process.env.DESKTOP_VERIFY_EXE } : { args: [resolve('.')] }), env, timeout: 60000 });
  page = await app.firstWindow();
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    w.setOpacity(0); w.setIgnoreMouseEvents(true); w.showInactive(); w.setSize(1360, 900);
  });
  await page.waitForFunction(() => document.querySelector('.composer .composer-input') && !document.querySelector('.composer-wrap[aria-busy="true"]') && !document.querySelector('.composer .composer-input').disabled);
};
const settings = async () => {
  await page.locator('.sidebar-settings').click();
  await page.getByRole('button', { name: '供应商', exact: true }).click();
  await page.getByRole('heading', { name: '自定义供应商', exact: true }).waitFor();
};
const snapshot = () => page.evaluate(() => window.desktop.snapshot());
const waitFor = async predicate => {
  const until = Date.now() + 60000;
  while (Date.now() < until) {
    const state = await snapshot();
    if (await predicate(state)) return state;
    await page.waitForTimeout(100);
  }
  throw new Error('Provider snapshot wait timed out');
};
try {
  await launch();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await settings();
  const presets = page.locator('.provider-preset-picker');
  const openPresets = () => page.locator('.provider-heading').getByRole('button', { name: '添加供应商', exact: true }).click();
  const format = page.locator('#provider-api-value');
  const input = label => page.getByLabel(label, { exact: true });
  const evidence = resolve('test-results/provider-presets');
  const dialog = page.locator('.settings-dialog');
  await settleLayout(dialog);
  const shell = await dialog.boundingBox();
  await mkdir(evidence, { recursive: true });
  await openPresets();
  await presets.waitFor();
  const kimi = presets.locator('[data-preset-brand="kimi"]');
  const variants = presets.locator('.provider-preset-variants[aria-labelledby$="-kimi-name"]');
  const platformChoice = variants.getByRole('button', { name: /Kimi 开放平台 国内.*按量/ });
  const subscriptionChoice = variants.getByRole('button', { name: /Kimi Code 国内.*套餐/ });
  assert.deepEqual(await dialog.boundingBox(), shell, 'picker uses the same settings shell');
  assert.deepEqual(await presets.locator('[data-preset-brand]').evaluateAll(tiles => tiles.map(tile => tile.dataset.presetBrand)),
    ['stepfun', 'deepseek', 'kimi', 'zhipu', 'bailian', 'minimax', 'openai', 'anthropic', 'gemini', 'siliconflow', 'ark']);
  await page.waitForFunction(() => [...document.querySelectorAll('.provider-preset-tile img')].every(img => img.naturalWidth > 0));
  const stepfun = presets.locator('[data-preset-brand="stepfun"]');
  const stepfunChoices = presets.locator('.provider-preset-variants[aria-labelledby$="-stepfun-name"]');
  await assertFocusVisible(page, stepfun, 'StepFun tile');
  await page.keyboard.press('Enter');
  for (const [region, host] of [['中国大陆', 'api.stepfun.com'], ['海外', 'api.stepfun.ai']]) {
    const choice = stepfunChoices.getByRole('button', { name: new RegExp(`^阶跃开放平台（${region}）.*按量$`) });
    await assertFocusVisible(page, choice, `StepFun ${region}`);
    await page.keyboard.press('Enter');
    assert.equal(await input('Base URL').inputValue(), `https://${host}/v1`);
    assert.match(await format.textContent(), /^Chat Completions/);
    assert.equal(await input('API Key').inputValue(), '');
    await page.getByRole('button', { name: '返回供应商预设' }).press('Enter');
    await assertFocusVisible(page, stepfun, 'return to StepFun tile', { focus: false });
  }
  assert.equal(await variants.evaluate(el => el.inert), true);
  assert.equal(await variants.evaluate(el => getComputedStyle(el).transitionDuration), '0.24s, 0.24s');
  await assertFocusVisible(page, kimi, 'Kimi tile');
  await page.keyboard.press('Enter');
  assert.equal(await kimi.getAttribute('aria-expanded'), 'true');
  await assertFocusVisible(page, platformChoice, 'Kimi Open Platform variant');
  await assertFocusVisible(page, subscriptionChoice, 'Kimi Code variant');
  const gridBounds = await presets.locator('.provider-preset-grid').boundingBox();
  const variantsBounds = await variants.boundingBox();
  assert.equal(variantsBounds.x, gridBounds.x, 'Kimi choices start at the first tile column');
  assert.equal(variantsBounds.width, gridBounds.width, 'Kimi choices span both tile columns');
  await page.screenshot({ path: join(evidence, 'picker-dark.png') });
  await page.keyboard.press('Escape');
  assert.equal(await kimi.getAttribute('aria-expanded'), 'false');
  assert.equal(await kimi.evaluate(el => document.activeElement === el), true);
  assert.equal(await variants.evaluate(el => el.inert), true);
  for (const [brand, name, baseUrl, api, recommendation] of [
    ['zhipu', '智谱 GLM', 'https://open.bigmodel.cn/api/paas/v4', /^Chat Completions/, 'glm-5.3'],
    ['bailian', '阿里云百炼', 'https://dashscope.aliyuncs.com/compatible-mode/v1', /^Chat Completions/, 'qwen-plus'],
    ['minimax', 'MiniMax', 'https://api.minimax.cn/v1', /^Chat Completions/],
    ['openai', 'OpenAI', 'https://api.openai.com/v1', /^Responses/],
    ['anthropic', 'Anthropic', 'https://api.anthropic.com', /^Anthropic Messages.*\/v1\/messages$/],
    ['gemini', 'Gemini', 'https://generativelanguage.googleapis.com/v1beta/openai', /^Chat Completions/],
    ['siliconflow', '硅基流动', 'https://api.siliconflow.cn/v1', /^Chat Completions/],
    ['ark', '火山方舟', 'https://ark.cn-beijing.volces.com/api/v3', /^Chat Completions/],
  ]) {
    const tile = presets.locator(`[data-preset-brand="${brand}"]`);
    await assertFocusVisible(page, tile, `${name} tile`);
    await page.keyboard.press('Enter');
    if (brand === 'bailian' || brand === 'minimax') {
      assert.equal(await tile.getAttribute('aria-expanded'), 'true');
      const choices = presets.locator('.provider-preset-variants[aria-hidden="false"]');
      await choices.getByRole('button', { name: /按量$/ }).click();
    }
    assert.equal(await input('名称').inputValue(), name);
    assert.equal(await input('Base URL').inputValue(), baseUrl);
    assert.match(await format.textContent(), api);
    assert.equal(await input('API Key').inputValue(), '');
    assert.equal(await page.getByRole('checkbox', { name: '无需密钥（本地服务）' }).count(), 0);
    assert.equal(await input('模型 ID 1').count(), 0);
    const discover = page.getByRole('button', { name: '从上游获取', exact: true });
    if (recommendation) {
      assert.equal(await discover.count(), 0);
      const suggested = page.getByRole('button', { name: '推荐模型', exact: true });
      await suggested.click();
      await page.getByRole('menuitemradio', { name: recommendation, exact: true }).waitFor();
      await page.keyboard.press('Escape');
    } else {
      assert.equal(await discover.isDisabled(), true);
    }
    if (brand === 'ark') {
      await page.getByRole('button', { name: '添加模型', exact: true }).click();
      assert.match(await input('模型 ID 1').getAttribute('placeholder'), /ep-/);
      await input('模型 ID 1').fill('ep-fixture');
      await page.getByRole('button', { name: '返回供应商预设' }).press('Enter');
      await page.getByRole('button', { name: '放弃', exact: true }).press('Enter');
    } else {
      await page.getByRole('button', { name: '返回供应商预设' }).press('Enter');
    }
    await assertFocusVisible(page, tile, `return to ${name} tile`, { focus: false });
  }
  for (const [brand, name, baseUrl] of [
    ['bailian', '百炼 Token Plan', 'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1'],
    ['minimax', 'MiniMax M Plan', 'https://api.minimax.cn/v1'],
  ]) {
    const tile = presets.locator(`[data-preset-brand="${brand}"]`);
    if (await tile.getAttribute('aria-expanded') !== 'true') await tile.click();
    const choice = presets.locator('.provider-preset-variants[aria-hidden="false"]').getByRole('button', { name: new RegExp(`^${name}.*套餐$`) });
    await assertFocusVisible(page, choice, `${name} variant`);
    await page.keyboard.press('Enter');
    assert.equal(await input('名称').inputValue(), name);
    assert.equal(await input('Base URL').inputValue(), baseUrl);
    assert.equal(await input('Base URL').evaluate(el => el.readOnly), true);
    assert.equal(await input('套餐 API Key').inputValue(), '');
    await input('套餐 API Key').fill('wrong-fixture-key');
    await page.getByText('请输入该套餐的专属 API Key。', { exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: '测试连接', exact: true }).isDisabled(), true);
    await page.getByRole('button', { name: '返回供应商预设' }).press('Enter');
    await page.getByRole('button', { name: '放弃', exact: true }).press('Enter');
    assert.equal(await tile.getAttribute('aria-expanded'), 'true');
    await assertFocusVisible(page, tile, `return to ${name} tile`, { focus: false });
  }
  await presets.locator('[data-preset-brand="deepseek"]').click();
  assert.equal(await input('名称').inputValue(), 'DeepSeek');
  assert.equal(await input('Base URL').inputValue(), 'https://api.deepseek.com');
  assert.match(await format.textContent(), /^Chat Completions/);
  assert.equal(await input('API Key').inputValue(), '');
  await page.getByRole('button', { name: '返回供应商预设' }).click();
  await kimi.click();
  await platformChoice.click();
  assert.equal(await input('Base URL').inputValue(), 'https://api.moonshot.cn/v1');
  await page.getByRole('button', { name: '返回供应商预设' }).click();
  assert.equal(await kimi.getAttribute('aria-expanded'), 'true');
  await subscriptionChoice.click();
  assert.equal(await input('Base URL').inputValue(), 'https://api.kimi.com/coding/v1');
  assert.match(await format.textContent(), /^Responses/);
  assert.equal(await page.getByRole('button', { name: '从上游获取', exact: true }).count(), 0);
  await page.getByRole('button', { name: '推荐模型', exact: true }).click();
  await page.getByRole('menuitemradio', { name: 'kimi-for-coding', exact: true }).click();
  await page.locator('.app-menu').filter({ has: page.getByText('k3.1-pro', { exact: true }) }).waitFor({ state: 'hidden' });
  assert.equal(await input('模型 ID 1').inputValue(), 'kimi-for-coding');
  assert.equal(await page.getByRole('button', { name: '测试连接', exact: true }).isDisabled(), true);
  await page.screenshot({ path: join(evidence, 'subscription-form.png') });
  await page.getByRole('button', { name: '返回供应商预设' }).click();
  await page.getByRole('button', { name: '放弃', exact: true }).click();
  assert.equal(await kimi.getAttribute('aria-expanded'), 'true');
  assert.equal((await page.evaluate(() => window.desktop.settings())).providers.length, 0, 'preset selection never saves a provider');
  assert.equal(requests.length, 0);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(640, 760));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.evaluate(() => window.desktop.preferences({ theme: 'light' }));
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'light' && innerWidth < 700);
  await assertFocusVisible(page, kimi, 'Kimi tile in narrow light settings');
  assert.equal(await variants.evaluate(el => getComputedStyle(el).transitionDuration), '0s');
  await assertFocusVisible(page, platformChoice, 'Kimi Open Platform variant in narrow light settings');
  await assertFocusVisible(page, subscriptionChoice, 'Kimi Code variant in narrow light settings');
  assert.equal(await presets.evaluate(el => el.scrollWidth > el.clientWidth), false);
  assert.equal(await presets.locator('.provider-preset-grid').evaluate(el => getComputedStyle(el).gridTemplateColumns.split(' ').length), 1);
  await page.screenshot({ path: join(evidence, 'picker-narrow-light.png') });
  await assertFocusVisible(page, presets.locator('[data-preset-brand="ark"]'), 'Volcengine Ark tile in narrow light settings');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.evaluate(() => window.desktop.preferences({ theme: 'dark' }));
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1360, 900));
  await presets.getByRole('button', { name: '返回', exact: true }).click();
  assert.equal(await page.locator('.provider-heading button').evaluate(el => document.activeElement === el), true);
  await page.getByRole('button', { name: '添加供应商', exact: true }).first().click();
  await page.getByRole('button', { name: '创建自定义供应商', exact: true }).click();
  await page.getByLabel('名称', { exact: true }).fill('我的测试供应商');
  await page.getByLabel('Base URL', { exact: true }).fill(address);
  await page.getByLabel('API Key', { exact: true }).fill('isolated-provider-fixture');
  await page.getByRole('button', { name: '从上游获取', exact: true }).click();
  await page.locator('.provider-discovery').waitFor();
  await mkdir(resolve('test-results'), { recursive: true });
  await page.screenshot({ path: 'test-results/custom-providers-discovery.png' });
  await page.locator('.provider-discovery label').filter({ hasText: 'fixture-custom' }).getByRole('checkbox').check();
  await page.locator('.provider-discovery').getByRole('button', { name: '加入 1', exact: true }).click();
  assert.equal(await page.getByLabel('模型 ID 1', { exact: true }).evaluate(element => element.value), 'fixture-custom');
  assert.equal(await page.getByLabel('显示名 1', { exact: true }).evaluate(element => element.value), 'Fixture Custom');
  assert.equal(await page.locator('.provider-model-advanced').first().getAttribute('open'), null);
  assert.match(await page.locator('.provider-thinking-summary').first().textContent(), /上游声明.*4 档/);
  await page.getByRole('button', { name: '从上游获取', exact: true }).click();
  const refreshChoice = page.locator('.provider-discovery label').filter({ hasText: 'fixture-custom' }).getByRole('checkbox');
  assert.equal(await refreshChoice.isEnabled(), true, 'existing models can refresh their declarations');
  await refreshChoice.check();
  await page.locator('.provider-discovery').getByRole('button', { name: '应用 1', exact: true }).click();
  assert.equal(await page.locator('.provider-model').count(), 1, 'refresh does not duplicate the existing model');
  const beforeTest = await snapshot();
  await page.getByRole('button', { name: '测试连接', exact: true }).click();
  await page.getByText('收到有效模型回复', { exact: true }).waitFor();
  await page.waitForFunction(() => document.querySelector('.provider-test-result .subagent-status-icon')?.getAttribute('data-state') === 'done' && document.querySelector('.provider-test-result .subagent-status-icon')?.getAttribute('data-settling') === 'false');
  assert.equal((await snapshot()).messages.length, beforeTest.messages.length);
  assert.equal((await page.evaluate(() => window.desktop.settings())).providers.length, 0, 'testing an unsaved provider never saves it');
  await page.getByText('诊断详情', { exact: true }).click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'test-results/provider-diagnostic-dark.png' });
  assert.equal((await page.locator('.provider-test-result').textContent()).includes(expectedKey), false);
  assert.equal(await page.getByRole('button', { name: '复制诊断', exact: true }).count(), 1);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(640, 760));
  await page.screenshot({ path: 'test-results/provider-diagnostic-narrow.png' });
  assert.equal(await page.locator('.provider-editor').evaluate(e => e.scrollWidth > e.clientWidth), false);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1360, 900));
  diagnosticMode = 'auth';
  await page.getByRole('button', { name: '测试连接', exact: true }).click();
  await page.getByText('认证失败，请检查密钥或权限', { exact: true }).waitFor();
  await page.waitForFunction(() => document.querySelector('.provider-test-result .subagent-status-icon')?.getAttribute('data-state') === 'failed' && document.querySelector('.provider-test-result .subagent-status-icon')?.getAttribute('data-settling') === 'false');
  await page.screenshot({ path: 'test-results/provider-diagnostic-failed.png' });
  assert.match(await page.locator('.provider-test-meta').textContent(), /HTTP 401/);
  assert.equal((await page.locator('.provider-test-result').textContent()).includes(expectedKey), false);
  diagnosticMode = 'hold';
  await page.getByRole('button', { name: '测试连接', exact: true }).click();
  await page.getByRole('button', { name: '取消测试', exact: true }).click();
  await page.getByText('测试已取消', { exact: true }).waitFor();
  diagnosticMode = 'reply';
  await page.getByRole('button', { name: '收起诊断', exact: true }).click();
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await page.getByText('已保存', { exact: true }).waitFor();
  let state = await snapshot();
  const provider = await page.evaluate(async () => (await window.desktop.settings()).providers[0]);
  assert.ok(provider.hasKey);
  assert.equal(provider.models[0].thinkingControl.defaultLevel, 'ultra');
  assert.equal(state.models.find(m => m.id === 'fixture-custom')?.providerName, '我的测试供应商');
  assert.deepEqual(state.models.find(m => m.id === 'fixture-custom')?.thinkingLevels, ['off', 'low', 'high', 'ultra']);
  assert.deepEqual(state.models.find(m => m.id === 'fixture-custom')?.input, ['text', 'image']);
  assert.deepEqual(state.models.find(m => m.id === 'fixture-custom')?.declaredInput, ['text', 'image', 'audio']);
  assert.equal(state.models.find(m => m.id === 'fixture-custom')?.contextWindow, 200000);
  assert.equal(state.state.model.id, 'fixture-custom');
  const encrypted = await readFile(join(profile, 'step-runtime/auth.dpapi'));
  assert.equal(encrypted.includes(Buffer.from('isolated-provider-fixture')), false);
  assert.equal((await readFile(join(profile, 'step-runtime/models.json'), 'utf8')).includes('isolated-provider-fixture'), false);
  assert.equal(JSON.stringify(provider).includes('isolated-provider-fixture'), false);
  assert.equal(await page.getByLabel('API Key', { exact: true }).evaluate(element => element.value), '');
  await mkdir('test-results', { recursive: true });
  await page.locator('.provider-editor fieldset').evaluate(e => { e.scrollTop = 0; });
  const verifyFocusGutter = async (label, file) => {
    const input = page.getByLabel(label, { exact: true });
    await assertFocusVisible(page, input, label);
    await page.screenshot({ path: `test-results/${file}.png` });
  };
  await verifyFocusGutter('Base URL', 'provider-focus-url');
  await verifyFocusGutter('模型 ID 1', 'provider-focus-model');
  await page.locator('.provider-model-advanced summary').first().click();
  await page.waitForTimeout(280);
  await verifyFocusGutter('上下文容量 1', 'provider-focus-capacity');
  await page.screenshot({ path: 'test-results/provider-thinking-declared.png' });
  await page.locator('.provider-model-advanced summary').first().click();
  await page.locator('.provider-editor fieldset').evaluate(e => { e.scrollTop = 0; });
  await page.screenshot({ path: 'test-results/custom-providers-dark.png' });
  await page.getByRole('button', { name: /API 格式/ }).click();
  await page.getByRole('menuitemradio', { name: 'Responses · /responses', exact: true }).waitFor();
  await page.screenshot({ path: 'test-results/custom-providers-protocol-menu.png' });
  await page.keyboard.press('Escape');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(640, 760));
  for (const theme of ['light', 'dark']) {
    await page.evaluate(theme => window.desktop.preferences({ theme }), theme);
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('runtime-event', { type: 'desktop_sessions_changed' }));
    await page.waitForFunction(theme => document.documentElement.dataset.theme === theme, theme);
    await page.waitForTimeout(300); // Capture settled palette transitions, not the dark-to-light intermediate frame.
    for (const label of ['名称', 'Base URL', 'API Key', '模型 ID 1']) {
      await verifyFocusGutter(label, `provider-focus-${theme}-${label === '名称' ? 'name' : label === 'Base URL' ? 'url' : label === 'API Key' ? 'key' : 'model'}-narrow`);
    }
    await page.locator('.provider-model-advanced summary').first().click();
    await page.waitForTimeout(280);
    await verifyFocusGutter('上下文容量 1', `provider-focus-${theme}-capacity-narrow`);
    await verifyFocusGutter('最大输出 1', `provider-focus-${theme}-output-narrow`);
    await page.locator('.provider-model-advanced summary').first().click();
  }
  await page.screenshot({ path: 'test-results/custom-providers-narrow.png' });
  assert.equal(await page.locator('.settings-content').evaluate(e => e.scrollWidth > e.clientWidth), false);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1360, 900));
  await page.locator('.settings-dialog > header').getByRole('button', { name: /^(?:Close|\u5173\u95ed)$/u }).click();
  await page.locator('.settings-backdrop').waitFor({ state: 'detached' });
  await page.getByRole('button', { name: '模型与思考强度' }).click();
  await page.getByRole('button', { name: '模型参数', exact: true }).click();
  await page.waitForTimeout(350);
  assert.match(await page.locator('.model-parameters-modalities').textContent(), /音频未启用/);
  await page.screenshot({ path: 'test-results/custom-model-parameters.png' });
  await page.keyboard.press('Escape');
  state = await snapshot();
  await page.getByRole('button', { name: '模型与思考强度' }).click();
  await page.getByRole('slider', { name: '思考强度' }).press('End');
  await waitFor(s => s.state?.thinkingLevel === 'ultra');
  assert.equal(await page.getByRole('slider', { name: '思考强度' }).getAttribute('aria-valuetext'), 'Ultra');
  await page.keyboard.press('Escape');
  const invalidLevel = await page.evaluate(async runtimeId => {
    try { await window.desktop.command('set_thinking_level', { level: 'xhigh' }, runtimeId); return false; } catch { return true; }
  }, state.runtimeId);
  assert.equal(invalidLevel, true, 'undeclared thinking level is rejected');
  assert.equal((await snapshot()).state.thinkingLevel, 'ultra', 'draft keeps Ultra before its first message');
  await page.getByRole('textbox', { name: '消息', exact: true }).fill('Test custom provider');
  // Native fill can finish before the editor transaction and controlled draft agree.
  await page.waitForFunction(text => {
    const element = document.querySelector('.composer > .composer-input');
    return element?.value === text && element.dataset.empty === 'false'
      && element.ownerDocument.activeElement === element && !element.disabled;
  }, 'Test custom provider', { timeout: 5000 });
  await submitSessionFixture(page, () => page.getByRole('textbox', { name: '消息', exact: true }).press('Enter'));
  state = await waitFor(s => s.messages.some(m => m.role === 'assistant' && m.stopReason === 'stop'));
  assert.equal(state.state.model.provider, provider.id);
  assert.equal(requests.at(-1).path, '/v1/chat/completions');
  assert.equal(requests.at(-1).keyMatches, true);
  assert.equal(requests.at(-1).body.model, 'fixture-custom');
  assert.equal(state.state.thinkingLevel, 'ultra', 'draft promotion preserves the selected effort');
  assert.equal(requests.at(-1).body.reasoning_effort, 'ultra');
  assert.ok(state.messages.some(m => m.role === 'toolResult' && m.toolCallId === 'provider-task-list' && !m.isError), 'real tool call completes through the custom provider');
  const sessionId = state.state.sessionId;
  await page.locator('.right-tool-rail').getByRole('button', { name: '上下文', exact: true }).click();
  const context = page.getByRole('complementary', { name: '上下文', exact: true });
  await context.waitFor();
  await context.evaluate(async element => {
    const animations = element.getAnimations({ subtree: true })
      .filter(animation => Number.isFinite(animation.effect?.getComputedTiming().endTime));
    await Promise.all(animations.map(animation => animation.finished.catch(() => {})));
  });
  assert.equal(await context.locator('.context-estimate > strong').textContent(), '--');
  const estimateInfo = context.getByRole('button', { name: '估算明细', exact: true });
  await estimateInfo.scrollIntoViewIfNeeded();
  // Deliver any scroll/resize tooltip dismissal before entering the stable target.
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await page.mouse.move(0, 0);
  await estimateInfo.hover();
  await page.getByRole('tooltip').filter({ hasText: '第三方模型不提供费用估算，Token 用量照常统计。' }).waitFor();
  await context.getByRole('button', { name: '关闭上下文', exact: true }).click();
  await page.evaluate(runtimeId => window.desktop.command('set_permission_preset', { preset: 'approve-for-me' }, runtimeId), state.runtimeId);
  await settings();
  await page.getByLabel('名称', { exact: true }).fill('重新命名的供应商');
  expectedKey = '!literal$VALUE';
  await page.getByLabel('API Key', { exact: true }).fill(expectedKey);
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await page.getByText('已保存', { exact: true }).waitFor();
  assert.equal((await snapshot()).state.sessionId, sessionId);
  assert.equal((await snapshot()).state.thinkingLevel, 'ultra', 'provider refresh keeps the active session effort');
  assert.equal((await snapshot()).permissionPreset, 'approve-for-me');
  await page.evaluate(async () => {
    await window.desktop.logout();
    if (!(await window.desktop.settings()).providers[0].hasKey) throw new Error('Step logout erased provider key');
  });
  await page.locator('.settings-dialog > header').getByRole('button', { name: /^(?:Close|\u5173\u95ed)$/u }).click();
  await page.locator('.settings-backdrop').waitFor({ state: 'detached' });
  await closeDesktopFixtureAndWait(app); app = undefined;
  await launch();
  await settings();
  const restored = await page.evaluate(async () => (await window.desktop.settings()).providers[0]);
  assert.equal(restored.name, '重新命名的供应商');
  assert.equal(restored.hasKey, true);
  await page.locator('.settings-dialog > header').getByRole('button', { name: /^(?:Close|\u5173\u95ed)$/u }).click();
  await page.locator('.settings-backdrop').waitFor({ state: 'detached' });
  await page.locator(`.session-row[data-reorder-id="${sessionId}"] > button:first-child`).click();
  state = await waitFor(s => s.state?.sessionId === sessionId && s.status === 'connected');
  assert.equal(state.state.thinkingLevel, 'ultra', 'Ultra survives relaunch and explicit session restore');
  hold = true;
  const prompt = page.getByRole('textbox', { name: '消息', exact: true });
  await prompt.fill('Hold this response');
  await submitSessionFixture(page, () => prompt.press('Enter'));
  await waitFor(s => s.state?.isStreaming && typeof release === 'function');
  await prompt.fill('Queued before saving provider');
  await prompt.press('Enter');
  await waitFor(s => s.pendingMessages?.length === 1);
  const oldRuntime = await snapshot();
  const beforeProjection = await readFile(join(profile, 'step-runtime/models.json'), 'utf8');
  const latestName = '运行中再次保存的供应商';
  await settings();
  await page.getByLabel('名称', { exact: true }).fill('运行中保存的供应商');
  assert.equal(await page.getByRole('button', { name: '保存', exact: true }).isEnabled(), true);
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await page.getByText('已保存，待任务空闲后应用', { exact: true }).waitFor();
  const pending = await snapshot();
  assert.equal(pending.providerSettingsPending, true);
  assert.equal(pending.pendingMessages.length, 1);
  assert.equal(pending.runtimeId, oldRuntime.runtimeId);
  assert.equal(pending.state.sessionId, oldRuntime.state.sessionId);
  assert.equal(pending.state.isStreaming, true);
  assert.equal(await readFile(join(profile, 'step-runtime/models.json'), 'utf8'), beforeProjection,
    'in-flight parent and child model projection remains untouched');
  assert.equal((await page.evaluate(() => window.desktop.settings())).providers[0].name,
    '运行中保存的供应商');
  const updated = await page.evaluate(({ provider, name }) =>
    window.desktop.saveProvider({ ...provider, name }), { provider: restored, name: latestName });
  assert.equal(updated.providerSettingsPending, true);
  const addedId = await page.evaluate(async p => {
    await window.desktop.saveProvider({ ...p, id: '', name: '运行中新增供应商' }, 'isolated-extra-fixture');
    return (await window.desktop.settings()).providers.find(provider => provider.name === '运行中新增供应商').id;
  }, restored);
  assert.equal((await snapshot()).models.some(model => model.provider === addedId), false,
    'a saved addition does not alter an in-flight registry');
  const removed = await page.evaluate(id => window.desktop.deleteProvider(id), addedId);
  assert.equal(removed.providerSettingsPending, true, 'pending additions can be removed without stopping the agent');
  assert.equal(removed.runtimeId, oldRuntime.runtimeId);
  assert.equal(await readFile(join(profile, 'step-runtime/models.json'), 'utf8'), beforeProjection);
  hold = false; release();
  const applied = await waitFor(s => !s.state?.isStreaming && !s.providerSettingsPending);
  assert.equal(applied.pendingMessages.length, 0);
  assert.ok(requests.some(({ body, keyMatches }) => keyMatches && body.messages?.some(message =>
    message.role === 'user' && textOfMessage(message) === 'Queued before saving provider')),
    'the queued turn still reaches the original route');
  assert.equal(applied.runtimeId, oldRuntime.runtimeId, 'idle reload keeps renderer runtime identity');
  assert.equal(applied.state.sessionId, oldRuntime.state.sessionId);
  assert.equal(applied.models.find(m => m.provider === provider.id)?.providerName, latestName);
  assert.ok(applied.messages.some(m => textOfMessage(m).includes('Custom provider fixture reply.')),
    'the held response finishes normally and survives reload');
  await page.locator('.settings-dialog > header').getByRole('button', { name: /^(?:Close|\u5173\u95ed)$/u }).click();
  await page.locator('.settings-backdrop').waitFor({ state: 'detached' });
  const runtimeRoot = await app.evaluate(({ app }) => app.isPackaged ? process.resourcesPath : process.cwd());
  const manifest = JSON.parse(await readFile(join(runtimeRoot, 'runtime', 'manifest.json'), 'utf8'));
  if (manifest.patches?.includes('desktop-background-command-state')) {
    await prompt.fill(backgroundPrompt);
    await submitSessionFixture(page, () => prompt.press('Enter'));
    const background = await waitFor(s => !s.state?.isStreaming && s.state?.desktopBackgroundCommands?.count === 1);
    const before = await readFile(join(profile, 'step-runtime/models.json'), 'utf8');
    const name = '保存后等待后台命令结束';
    const pending = await page.evaluate(({ provider, name }) => window.desktop.saveProvider({ ...provider, name }), { provider: restored, name });
    assert.equal(pending.providerSettingsPending, true);
    assert.equal(pending.state.desktopBackgroundCommands.count, 1);
    assert.equal(await readFile(join(profile, 'step-runtime/models.json'), 'utf8'), before);
    await writeFile(releaseCommand, '');
    const applied = await waitFor(s => !s.providerSettingsPending);
    assert.equal(applied.runtimeId, background.runtimeId);
    assert.equal(applied.models.find(m => m.provider === provider.id)?.providerName, name);
  }
  await settings();
  const beforeDisable = await snapshot();
  const requestsBeforeDisable = requests.length;
  await page.getByRole('switch', { name: '启用供应商' }).click();
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await page.getByText('已保存', { exact: true }).waitFor();
  assert.equal((await snapshot()).models.some(m => m.provider === provider.id), false);
  const disabled = await snapshot();
  assert.equal(disabled.status, 'disconnected', 'disabled selection cannot run on an alternative model');
  assert.equal(disabled.state.model.provider, provider.id, 'history keeps the explicitly selected model');
  assert.equal(requests.length, requestsBeforeDisable, 'disabling a provider sends no generation request');
  await page.getByRole('switch', { name: '启用供应商' }).click();
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await page.getByText('已保存', { exact: true }).waitFor();
  const reenabled = await snapshot();
  assert.equal(reenabled.status, 'connected');
  assert.equal(reenabled.state.model.provider, provider.id);
  assert.equal(reenabled.state.sessionId, beforeDisable.state.sessionId, 'reenabling restores the same conversation');
  assert.equal(requests.length, requestsBeforeDisable, 'reenabling restores identity without generating');
  for (const [label, promptText, path, reply] of [
    ['Responses · /responses', 'Test Responses provider', '/v1/responses', 'Responses fixture reply.'],
    ['Anthropic Messages · /messages', 'Test Anthropic provider', '/v1/messages', 'Anthropic fixture reply.'],
  ]) {
    await page.getByRole('button', { name: /API 格式/ }).click();
    await page.getByRole('menuitemradio', { name: label, exact: true }).click();
    await page.getByRole('button', { name: '测试连接', exact: true }).click();
    await page.getByText('收到有效模型回复', { exact: true }).waitFor();
    assert.equal(requests.at(-1).path, path);
    await page.getByRole('button', { name: '收起诊断', exact: true }).click();
    await page.getByRole('button', { name: '保存', exact: true }).click();
    await page.getByText('已保存', { exact: true }).waitFor();
    await page.locator('.settings-dialog > header').getByRole('button', { name: /^(?:Close|\u5173\u95ed)$/u }).click();
    await page.locator('.settings-backdrop').waitFor({ state: 'detached' });
    await page.getByRole('textbox', { name: '消息', exact: true }).fill(promptText);
    await submitSessionFixture(page, () => page.getByRole('textbox', { name: '消息', exact: true }).press('Enter'));
    await page.getByText(reply, { exact: true }).waitFor({ timeout: 60000 });
    await waitFor(s => !s.state?.isStreaming);
    assert.equal(requests.at(-1).path.split('?')[0], path);
    assert.equal(requests.at(-1).keyMatches, true);
    await settings();
  }
  expectNoAuth = true;
  await page.getByRole('checkbox', { name: '无需密钥（本地服务）', exact: true }).check();
  await page.getByRole('button', { name: '从上游获取', exact: true }).click();
  await page.locator('.provider-discovery').waitFor();
  await page.getByRole('button', { name: '关闭模型列表', exact: true }).click();
  for (const [label, path] of [
    ['Chat Completions · /chat/completions', '/v1/chat/completions'],
    ['Responses · /responses', '/v1/responses'],
    ['Anthropic Messages · /messages', '/v1/messages'],
  ]) {
    console.log('No-auth acceptance:', label);
    await page.getByRole('button', { name: /API 格式/ }).click();
    await page.getByRole('menuitemradio', { name: label, exact: true }).click();
    await page.getByRole('button', { name: '测试连接', exact: true }).click();
    await page.getByText('收到有效模型回复', { exact: true }).waitFor();
    assert.equal(requests.at(-1).noAuth, true, 'keyless diagnostics omit authentication');
    await page.getByRole('button', { name: '收起诊断', exact: true }).click();
    await page.getByRole('button', { name: '保存', exact: true }).click();
    await page.getByText('已保存', { exact: true }).waitFor();
    assert.equal((await page.evaluate(() => window.desktop.settings())).providers[0].hasKey, true, 'keyless keeps the saved real key');
    await page.locator('.settings-dialog > header').getByRole('button', { name: /^(?:Close|\u5173\u95ed)$/u }).click();
    await page.locator('.settings-backdrop').waitFor({ state: 'detached' });
    const before = await snapshot();
    const beforeReplies = before.messages.filter(m => m.role === 'assistant' && m.stopReason === 'stop').length;
    const beforeUsers = before.messages.filter(m => m.role === 'user').length;
    const beforeRequests = requests.length;
    await page.getByRole('textbox', { name: '消息', exact: true }).fill(`Test no-auth ${label}`);
    // Protocol labels end in slash tokens; Enter belongs to command completion.
    await submitSessionFixture(page, () => page.getByRole('button', { name: '发送', exact: true }).click());
    try {
      const finished = await waitFor(s => !s.state?.isStreaming && (s.messages.filter(m => m.role === 'assistant' && m.stopReason === 'stop').length > beforeReplies
        || (s.messages.filter(m => m.role === 'user').length > beforeUsers && s.messages.at(-1)?.stopReason === 'error')));
      assert.equal(finished.messages.at(-1)?.stopReason, 'stop', 'no-auth runtime generation must succeed');
    } catch (error) {
      const s = await snapshot();
      console.log('No-auth generation state:', { status: s.status, streaming: s.state?.isStreaming,
        lastRole: s.messages.at(-1)?.role, stopReason: s.messages.at(-1)?.stopReason, requestCount: requests.length,
        lastRequestNoAuth: requests.at(-1)?.noAuth, lastRequestPath: requests.at(-1)?.path?.split('?')[0] });
      throw error;
    }
    assert.ok(requests.length > beforeRequests, 'a new keyless generation reaches the fixture');
    assert.equal(requests.at(-1).path.split('?')[0], path);
    assert.equal(requests.at(-1).noAuth, true, 'real runtime generation omits authentication');
    await settings();
  }
  await page.getByRole('checkbox', { name: '无需密钥（本地服务）', exact: true }).uncheck();
  expectNoAuth = false;
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await page.getByText('已保存', { exact: true }).waitFor();
  await page.getByRole('button', { name: '测试连接', exact: true }).click();
  await page.getByText('收到有效模型回复', { exact: true }).waitFor();
  assert.equal(requests.at(-1).keyMatches, true, 'leaving keyless mode restores the saved credential');
  await page.getByRole('button', { name: '收起诊断', exact: true }).click();
  await page.locator('.settings-dialog > header').getByRole('button', { name: /^(?:Close|\u5173\u95ed)$/u }).click();
  await page.locator('.settings-backdrop').waitFor({ state: 'detached' });
  const configured = await page.evaluate(async () => (await window.desktop.settings()).providers[0]);
  const generate = async message => {
    const before = await snapshot();
    const replies = before.messages.filter(m => m.role === 'assistant' && m.stopReason === 'stop').length;
    const requestCount = requests.length;
    await waitForSessionFixtureTools(page, before.runtimeId);
    await page.evaluate(async ({ message, id }) => window.desktop.command('prompt', { message }, id), { message, id: before.runtimeId });
    await waitFor(s => !s.state?.isStreaming && s.messages.filter(m => m.role === 'assistant' && m.stopReason === 'stop').length > replies);
    assert.ok(requests.length > requestCount, 'a new generation request must reach the fixture');
    return requests.at(-1).body;
  };
  for (const api of ['openai-completions', 'openai-responses', 'anthropic-messages']) {
    const unknown = { ...configured, api, models: [{ ...configured.models[0], reasoning: true, thinkingLevels: undefined, thinkingControl: undefined, declaredThinkingLevels: undefined }] };
    await page.evaluate(p => window.desktop.saveProvider(p), unknown);
    state = await snapshot();
    assert.equal(state.state.model.thinkingServiceDefault, true);
    assert.deepEqual(state.models.find(m => m.id === 'fixture-custom').thinkingLevels, []);
    const selectionEvents = await page.evaluate(async ({ provider, id }) => {
      const events = [];
      const unsubscribe = window.desktop.onEvent(event => {
        if (event.type === 'desktop_model_selection' && event.runtimeId === id) events.push(event);
      });
      try {
        await window.desktop.command('set_model', { provider, modelId: 'fixture-custom' }, id);
        // Wait for IPC delivery only; no snapshot or UI command refresh can mask a raw event.
        const until = Date.now() + 5000;
        while (events.length < 2 && Date.now() < until) await new Promise(resolve => setTimeout(resolve, 20));
        return events;
      } finally { unsubscribe(); }
    }, { provider: configured.id, id: state.runtimeId });
    assert.ok(selectionEvents.length >= 2, `${api}: selection and application both emit events`);
    for (const event of selectionEvents) {
      assert.equal(event.state.model.thinkingServiceDefault, true, `${api}: selection events preserve service-default state`);
      assert.deepEqual(event.state.model.thinkingLevels, []);
    }
    await page.waitForFunction(() => document.querySelector('.model-effort-level')?.textContent === '服务默认');
    const body = await generate('Unknown thinking control fixture');
    for (const field of ['reasoning_effort', 'reasoning', 'thinking', 'output_config'])
      assert.equal(body[field], undefined, `${api}: no invented ${field}`);
  }
  await settings();
  if (await page.locator('.provider-model-advanced').first().getAttribute('open') === null)
    await page.locator('.provider-model-advanced > summary').first().click();
  await page.getByText('未提供可用的思考控制信息。不附加思考参数，使用服务默认。', { exact: true }).waitFor();
  await page.screenshot({ path: 'test-results/provider-thinking-unknown.png' });
  await page.locator('.provider-thinking-override > summary').first().click();
  await page.getByRole('button', { name: '添加档位 1 high', exact: true }).click();
  await page.getByLabel('发送值 1 high', { exact: true }).fill('medium');
  await page.getByRole('button', { name: '添加档位 1 ultra', exact: true }).click();
  assert.equal(await page.getByLabel('发送值 1 ultra', { exact: true }).inputValue(), 'ultra');
  await page.getByRole('checkbox', { name: '接口支持 adaptive 思考与 effort 参数', exact: true }).check();
  await page.screenshot({ path: 'test-results/provider-thinking-manual.png' });
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await page.getByText('已保存', { exact: true }).waitFor();
  const manualControl = (await page.evaluate(async () => (await window.desktop.settings()).providers[0])).models[0].thinkingControl;
  assert.equal(manualControl.mapping.high, 'medium');
  assert.equal(manualControl.mapping.ultra, 'ultra');
  assert.deepEqual(manualControl.levels, ['high', 'ultra']);
  await page.locator('.settings-dialog > header').getByRole('button', { name: /^(?:Close|\u5173\u95ed)$/u }).click();
  await page.locator('.settings-backdrop').waitFor({ state: 'detached' });
  for (const api of ['openai-completions', 'openai-responses', 'anthropic-messages']) {
    await page.evaluate(p => window.desktop.saveProvider(p), { ...configured, api, models: [{ ...configured.models[0], reasoning: true, thinkingLevels: ['high', 'ultra'], thinkingControl: { source: 'manual', levels: ['high', 'ultra'], ...(api === 'anthropic-messages' ? { adaptive: true } : {}), mapping: { high: 'medium', ultra: 'ultra' } } }] });
    state = await snapshot();
    await page.evaluate(id => window.desktop.command('set_thinking_level', { level: 'high' }, id), state.runtimeId);
    const body = await generate('Mapped thinking fixture');
    assert.equal(api === 'openai-completions' ? body.reasoning_effort : api === 'openai-responses' ? body.reasoning?.effort : body.output_config?.effort, 'medium', `${api}: custom mapping reaches the request`);
    await page.evaluate(id => window.desktop.command('set_thinking_level', { level: 'ultra' }, id), state.runtimeId);
    assert.equal((await snapshot()).state.thinkingLevel, 'ultra');
    const ultraBody = await generate('Ultra thinking fixture');
    assert.equal(api === 'openai-completions' ? ultraBody.reasoning_effort : api === 'openai-responses' ? ultraBody.reasoning?.effort : ultraBody.output_config?.effort, 'ultra', `${api}: Ultra reaches the wire unchanged`);
    assert.equal(ultraBody.thinking?.type, api === 'anthropic-messages' ? 'adaptive' : undefined);
  }
  console.log('Ultra discovery, UI selection, relaunch persistence and three real runtime wire formats passed. Local fixtures only.');
  await page.evaluate(p => window.desktop.saveProvider(p), configured);
  await settings();
  await page.getByRole('button', { name: '外观', exact: true }).click();
  await page.getByRole('button', { name: '亮', exact: true }).click();
  await page.getByRole('button', { name: '供应商', exact: true }).click();
  await page.locator('.provider-editor fieldset').evaluate(e => { e.scrollTop = 0; });
  await page.screenshot({ path: 'test-results/custom-providers-light.png' });
  await page.getByRole('button', { name: '添加模型', exact: true }).click();
  await page.getByLabel('模型 ID 2', { exact: true }).fill('fixture-custom');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await page.locator('.provider-error').waitFor();
  assert.equal(await page.getByText('已保存', { exact: true }).count(), 0, 'failed save must not be reported as saved');
  await page.getByRole('button', { name: '移除模型 2', exact: true }).click();
  await page.getByRole('button', { name: '移除供应商', exact: true }).click();
  await page.getByRole('button', { name: '移除', exact: true }).click();
  await page.getByRole('button', { name: '移除供应商', exact: true }).waitFor({ state: 'hidden' });
  await waitForSessionFixtureSnapshot(page, async () => (await page.evaluate(() => window.desktop.settings())).providers.length === 0,
    'the provider removal to persist');
  assert.equal((await snapshot()).models.some(m => m.provider === provider.id), false);
  assert.deepEqual(errors, []);
  console.log('Custom provider UI, three wire protocols, secure persistence, running save/add/remove, queue drain and deferred application, relaunch, disable, rejected save and removal passed. Local HTTP fixtures only.');
} catch (error) {
  if (page && !page.isClosed()) {
    await page.screenshot({ path: 'test-results/custom-providers-failure.png' }).catch(() => {});
  }
  throw error;
} finally {
  hold = false; release?.();
  await writeFile(releaseCommand, '').catch(() => {});
  server.closeAllConnections();
  if (app && page && !page.isClosed()) {
    await page.evaluate(async () => {
      const state = await window.desktop.snapshot();
      if (state.state?.isStreaming) await window.desktop.command('abort', {}, state.runtimeId);
    }).catch(() => {});
  }
  try { if (app) await closeDesktopFixtureAndWait(app); }
  finally { await new Promise(resolve => server.close(resolve)); }
}
