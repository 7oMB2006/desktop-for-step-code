import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'node:http';

const profile = await mkdtemp(join(tmpdir(), 'desktop-custom-providers-'));
await writeFile(join(profile, 'preferences.json'), JSON.stringify({ language: 'zh', theme: 'dark', workspaces: [] }));
await mkdir(join(profile, 'step-runtime'), { recursive: true });
await writeFile(join(profile, 'step-runtime/config.toml'), 'permissionPreset = "bypass"\n[telemetry]\nenabled = false\n');
const requests = [];
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
      res.end(JSON.stringify({ data: [{ id: 'fixture-custom', name: 'Fixture Custom', input_modalities: ['text', 'image', 'audio'], output_modalities: ['text'], effort: { supported_levels: ['off', 'low', 'high'], default_level: 'high' }, context_window: 200000, max_output_tokens: 30000 }, { id: 'fixture-second' }] }));
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
  await page.waitForFunction(() => document.querySelector('.composer textarea') && !document.querySelector('.composer textarea').disabled);
};
const settings = async () => {
  await page.locator('.sidebar-bottom > button').click();
  await page.getByRole('button', { name: '供应商', exact: true }).click();
  await page.getByRole('heading', { name: '自定义供应商', exact: true }).waitFor();
};
const snapshot = () => page.evaluate(() => window.desktop.snapshot());
const waitFor = async predicate => {
  const until = Date.now() + 60000;
  while (Date.now() < until) {
    const state = await snapshot();
    if (predicate(state)) return state;
    await page.waitForTimeout(100);
  }
  throw new Error('Provider snapshot wait timed out');
};
try {
  await launch();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await settings();
  await page.getByRole('button', { name: '添加供应商', exact: true }).first().click();
  await page.getByLabel('名称', { exact: true }).fill('我的测试供应商');
  await page.getByLabel('Base URL', { exact: true }).fill(address);
  await page.getByLabel('API Key', { exact: true }).fill('isolated-provider-fixture');
  await page.getByRole('button', { name: '从上游获取', exact: true }).click();
  await page.locator('.provider-discovery').waitFor();
  await mkdir(resolve('test-results'), { recursive: true });
  await page.screenshot({ path: 'test-results/custom-providers-discovery.png' });
  await page.locator('.provider-discovery label').filter({ hasText: 'fixture-custom' }).getByRole('checkbox').check();
  await page.locator('.provider-discovery').getByRole('button', { name: '加入 1', exact: true }).click();
  assert.equal(await page.getByLabel('模型 ID 1', { exact: true }).inputValue(), 'fixture-custom');
  assert.equal(await page.getByLabel('显示名 1', { exact: true }).inputValue(), 'Fixture Custom');
  assert.equal(await page.locator('.provider-model-advanced').first().getAttribute('open'), null);
  assert.match(await page.locator('.provider-thinking-summary').first().textContent(), /上游声明.*3 档/);
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
  assert.equal(provider.models[0].thinkingControl.defaultLevel, 'high');
  assert.equal(state.models.find(m => m.id === 'fixture-custom')?.providerName, '我的测试供应商');
  assert.deepEqual(state.models.find(m => m.id === 'fixture-custom')?.thinkingLevels, ['off', 'low', 'high']);
  assert.deepEqual(state.models.find(m => m.id === 'fixture-custom')?.input, ['text', 'image']);
  assert.deepEqual(state.models.find(m => m.id === 'fixture-custom')?.declaredInput, ['text', 'image', 'audio']);
  assert.equal(state.models.find(m => m.id === 'fixture-custom')?.contextWindow, 200000);
  assert.equal(state.state.model.id, 'fixture-custom');
  const encrypted = await readFile(join(profile, 'step-runtime/auth.dpapi'));
  assert.equal(encrypted.includes(Buffer.from('isolated-provider-fixture')), false);
  assert.equal((await readFile(join(profile, 'step-runtime/models.json'), 'utf8')).includes('isolated-provider-fixture'), false);
  assert.equal(JSON.stringify(provider).includes('isolated-provider-fixture'), false);
  assert.equal(await page.getByLabel('API Key', { exact: true }).inputValue(), '');
  await mkdir('test-results', { recursive: true });
  await page.locator('.provider-editor fieldset').evaluate(e => { e.scrollTop = 0; });
  const verifyFocusGutter = async (label, file) => {
    const input = page.getByLabel(label, { exact: true });
    await input.focus();
    const visible = await input.evaluate(element => {
      const box = element.getBoundingClientRect();
      const scroll = element.closest('fieldset');
      const bounds = scroll.getBoundingClientRect();
      const style = getComputedStyle(element);
      const extent = Math.max(0, parseFloat(style.outlineWidth) + parseFloat(style.outlineOffset));
      // clientHeight/clientWidth round CSS pixels at fractional Windows scaling.
      const right = bounds.right - (scroll.offsetWidth - scroll.clientWidth);
      const bottom = bounds.bottom - (scroll.offsetHeight - scroll.clientHeight);
      return box.left - extent >= bounds.left - .1 && box.right + extent <= right + .1
        && box.top - extent >= bounds.top - .1 && box.bottom + extent <= bottom + .1;
    });
    if (!visible) console.log('Focus geometry:', await input.evaluate(element => {
      const scroll = element.closest('fieldset');
      const box = element.getBoundingClientRect(), bounds = scroll.getBoundingClientRect();
      return { label: element.getAttribute('aria-label'), box: box.toJSON(), bounds: bounds.toJSON(),
        clientHeight: scroll.clientHeight, clientWidth: scroll.clientWidth, scrollTop: scroll.scrollTop,
        outline: getComputedStyle(element).outline, offset: getComputedStyle(element).outlineOffset };
    }));
    assert.equal(visible, true, `${label}: focus outline fits inside the scroll viewport`);
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
  await page.screenshot({ path: 'test-results/custom-providers-narrow.png' });
  assert.equal(await page.locator('.settings-content').evaluate(e => e.scrollWidth > e.clientWidth), false);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1360, 900));
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.locator('.settings-backdrop').waitFor({ state: 'detached' });
  await page.getByRole('button', { name: '模型与思考强度' }).click();
  await page.getByRole('button', { name: '模型参数', exact: true }).click();
  await page.waitForTimeout(350);
  assert.match(await page.locator('.model-parameters-modalities').textContent(), /音频未启用/);
  await page.screenshot({ path: 'test-results/custom-model-parameters.png' });
  await page.keyboard.press('Escape');
  state = await snapshot();
  await page.evaluate(runtimeId => window.desktop.command('set_thinking_level', { level: 'high' }, runtimeId), state.runtimeId);
  const invalidLevel = await page.evaluate(async runtimeId => {
    try { await window.desktop.command('set_thinking_level', { level: 'xhigh' }, runtimeId); return false; } catch { return true; }
  }, state.runtimeId);
  assert.equal(invalidLevel, true, 'undeclared thinking level is rejected');
  await page.getByRole('textbox', { name: '消息', exact: true }).fill('Test custom provider');
  await page.getByRole('textbox', { name: '消息', exact: true }).press('Enter');
  state = await waitFor(s => s.messages.some(m => m.role === 'assistant' && m.stopReason === 'stop'));
  assert.equal(state.state.model.provider, provider.id);
  assert.equal(requests.at(-1).path, '/v1/chat/completions');
  assert.equal(requests.at(-1).keyMatches, true);
  assert.equal(requests.at(-1).body.model, 'fixture-custom');
  assert.equal(requests.at(-1).body.reasoning_effort, 'high');
  assert.ok(state.messages.some(m => m.role === 'toolResult' && m.toolCallId === 'provider-task-list' && !m.isError), 'real tool call completes through the custom provider');
  const sessionId = state.state.sessionId;
  await page.locator('.right-tool-rail').getByRole('button', { name: '上下文', exact: true }).click();
  const context = page.getByRole('complementary', { name: '上下文', exact: true });
  await context.waitFor();
  assert.equal(await context.locator('[title="自定义模型尚未配置价格"] strong').textContent(), '--');
  await context.getByRole('button', { name: '关闭上下文', exact: true }).click();
  await page.evaluate(runtimeId => window.desktop.command('set_permission_preset', { preset: 'read-only' }, runtimeId), state.runtimeId);
  await settings();
  await page.getByLabel('名称', { exact: true }).fill('重新命名的供应商');
  expectedKey = '!literal$VALUE';
  await page.getByLabel('API Key', { exact: true }).fill(expectedKey);
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await page.getByText('已保存', { exact: true }).waitFor();
  assert.equal((await snapshot()).state.sessionId, sessionId);
  assert.equal((await snapshot()).permissionPreset, 'read-only');
  await page.evaluate(async () => {
    await window.desktop.logout();
    if (!(await window.desktop.settings()).providers[0].hasKey) throw new Error('Step logout erased provider key');
  });
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.locator('.settings-backdrop').waitFor({ state: 'detached' });
  await app.close(); app = undefined;
  await launch();
  await settings();
  const restored = await page.evaluate(async () => (await window.desktop.settings()).providers[0]);
  assert.equal(restored.name, '重新命名的供应商');
  assert.equal(restored.hasKey, true);
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.locator('.settings-backdrop').waitFor({ state: 'detached' });
  hold = true;
  const prompt = page.getByRole('textbox', { name: '消息', exact: true });
  await prompt.fill('Hold this response');
  await prompt.press('Enter');
  await waitFor(s => s.state?.isStreaming);
  const rejection = await page.evaluate(async p => {
    try { await window.desktop.saveProvider(p); return false; } catch { return true; }
  }, restored);
  assert.equal(rejection, true, 'cannot mutate provider while an agent runs');
  while (!release) await page.waitForTimeout(20);
  hold = false; release();
  await waitFor(s => !s.state?.isStreaming);
  await settings();
  await page.getByRole('switch', { name: '启用供应商' }).click();
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await page.getByText('已保存', { exact: true }).waitFor();
  assert.equal((await snapshot()).models.some(m => m.provider === provider.id), false);
  await page.getByRole('switch', { name: '启用供应商' }).click();
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await page.getByText('已保存', { exact: true }).waitFor();
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
    await page.getByRole('button', { name: 'Close', exact: true }).click();
    await page.locator('.settings-backdrop').waitFor({ state: 'detached' });
    await page.getByRole('textbox', { name: '消息', exact: true }).fill(promptText);
    await page.getByRole('textbox', { name: '消息', exact: true }).press('Enter');
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
    await page.getByRole('button', { name: 'Close', exact: true }).click();
    await page.locator('.settings-backdrop').waitFor({ state: 'detached' });
    const before = await snapshot();
    const beforeReplies = before.messages.filter(m => m.role === 'assistant' && m.stopReason === 'stop').length;
    const beforeUsers = before.messages.filter(m => m.role === 'user').length;
    await page.getByRole('textbox', { name: '消息', exact: true }).fill(`Test no-auth ${label}`);
    await page.getByRole('textbox', { name: '消息', exact: true }).press('Enter');
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
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.locator('.settings-backdrop').waitFor({ state: 'detached' });
  const configured = await page.evaluate(async () => (await window.desktop.settings()).providers[0]);
  const generate = async message => {
    const before = await snapshot();
    const replies = before.messages.filter(m => m.role === 'assistant' && m.stopReason === 'stop').length;
    const requestCount = requests.length;
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
  await page.getByRole('checkbox', { name: '接口支持 adaptive 思考与 effort 参数', exact: true }).check();
  await page.screenshot({ path: 'test-results/provider-thinking-manual.png' });
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await page.getByText('已保存', { exact: true }).waitFor();
  assert.equal((await page.evaluate(async () => (await window.desktop.settings()).providers[0])).models[0].thinkingControl.mapping.high, 'medium');
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.locator('.settings-backdrop').waitFor({ state: 'detached' });
  for (const api of ['openai-completions', 'openai-responses', 'anthropic-messages']) {
    await page.evaluate(p => window.desktop.saveProvider(p), { ...configured, api, models: [{ ...configured.models[0], reasoning: true, thinkingLevels: ['high'], thinkingControl: { source: 'manual', levels: ['high'], ...(api === 'anthropic-messages' ? { adaptive: true } : {}), mapping: { high: 'medium' } } }] });
    state = await snapshot();
    await page.evaluate(id => window.desktop.command('set_thinking_level', { level: 'high' }, id), state.runtimeId);
    const body = await generate('Mapped thinking fixture');
    assert.equal(api === 'openai-completions' ? body.reasoning_effort : api === 'openai-responses' ? body.reasoning?.effort : body.output_config?.effort, 'medium', `${api}: custom mapping reaches the request`);
  }
  await page.evaluate(p => window.desktop.saveProvider(p), configured);
  await settings();
  await page.getByRole('button', { name: '通用', exact: true }).click();
  await page.getByRole('dialog').getByLabel(/主题|Theme/).selectOption('light');
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
  await page.waitForFunction(async () => (await window.desktop.settings()).providers.length === 0);
  assert.equal((await snapshot()).models.some(m => m.provider === provider.id), false);
  assert.deepEqual(errors, []);
  console.log('Custom provider UI, three wire protocols with and without authentication, real tool invocation, secure persistence, no-Step-login RPC generation, settings guard, rename, relaunch, disable, rejected save and removal passed. Local HTTP fixtures only.');
} finally {
  hold = false; release?.();
  server.closeAllConnections();
  if (app && page && !page.isClosed()) {
    await page.evaluate(async () => {
      const state = await window.desktop.snapshot();
      if (state.state?.isStreaming) await window.desktop.command('abort', {}, state.runtimeId);
    }).catch(() => {});
  }
  if (app) await app.close();
  await new Promise(resolve => server.close(resolve));
}
