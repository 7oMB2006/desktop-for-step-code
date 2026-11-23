import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import { createServer as createSecureServer } from 'node:https';
import { connect } from 'node:net';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { mkdtemp } from './test-profile.mjs';
import { closeDesktopFixtureAndWait } from './close-desktop-fixture.mjs';
import { submitSessionFixture, waitForSessionFixtureTools } from './session-fixture.mjs';

const profile = await mkdtemp(join(tmpdir(), 'desktop-network-settings-'));
await writeFile(join(profile, 'preferences.json'), JSON.stringify({ language: 'zh', theme: 'dark', workspaces: [] }));
await mkdir(join(profile, 'step-runtime'), { recursive: true });
await writeFile(join(profile, 'step-runtime/config.toml'), 'permissionPreset = "bypass"\n[telemetry]\nenabled = false\n[mcp_servers.steppage__steppage]\nenabled = false\n');
const origin = 'http://desktop-network.invalid';
const key = 'isolated-network-key';
const bodies = [];
const sockets = new Set();
const track = socket => { sockets.add(socket); socket.on('error', () => {}); socket.once('close', () => sockets.delete(socket)); };
let hold = false;
let release;
let tunnels = 0;
let discoveries = 0;
const handler = async (req, res) => {
  try {
    if (req.method === 'HEAD') { res.writeHead(401); res.end(); return; }
    assert.equal(req.headers.authorization, `Bearer ${key}`);
    assert.equal(req.headers.cookie, undefined);
    assert.equal(req.headers['proxy-authorization'], undefined, 'gateway authentication is not forwarded');
    if (req.url === '/v1/models') {
      discoveries++;
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ data: [{ id: 'network-model' }] })); return;
    }
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw);
    bodies.push(body);
    if (!body.stream) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ object: 'response', status: 'completed', output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'OK' }] }] })); return;
    }
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    const sse = data => res.write(`data: ${JSON.stringify(data)}\n\n`);
    sse({ type: 'response.created', response: { id: 'resp_network' } });
    if (hold) await new Promise(resolve => { release = resolve; res.once('close', resolve); });
    sse({ type: 'response.output_item.added', output_index: 0, item: { type: 'message', id: 'msg_network', status: 'in_progress', role: 'assistant', content: [] } });
    sse({ type: 'response.output_text.delta', output_index: 0, item_id: 'msg_network', content_index: 0, delta: 'Network runtime fixture reply.' });
    sse({ type: 'response.output_item.done', output_index: 0, item: { type: 'message', id: 'msg_network', status: 'completed', role: 'assistant', content: [{ type: 'output_text', text: 'Network runtime fixture reply.', annotations: [] }] } });
    sse({ type: 'response.completed', response: { id: 'resp_network', status: 'completed', usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15, input_tokens_details: { cached_tokens: 0 } } } });
    res.end();
  } catch { if (!res.headersSent) res.writeHead(500); res.end(); }
};
const certificate = join(profile, 'fixture-cert.pem');
const privateKey = join(profile, 'fixture-key.pem');
await promisify(execFile)(process.env.DESKTOP_TEST_OPENSSL || (process.platform === 'win32' ? 'C:/Program Files/Git/usr/bin/openssl.exe' : 'openssl'), [
  'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', privateKey, '-out', certificate,
  '-days', '1', '-subj', '/CN=desktop-network.invalid', '-addext', 'subjectAltName=DNS:desktop-network.invalid',
], { windowsHide: true });
const server = createServer(handler);
const secure = createSecureServer({ key: await readFile(privateKey), cert: await readFile(certificate) }, handler);
server.on('connection', track);
secure.on('connection', track);
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
await new Promise(resolve => secure.listen(0, '127.0.0.1', resolve));
const proxy = createServer((req, res) => {
  const url = new URL(req.url);
  if (url.hostname !== 'desktop-network.invalid') { res.writeHead(502); res.end(); return; }
  const upstream = request({ host: '127.0.0.1', port: server.address().port, method: req.method, path: url.pathname, headers: req.headers }, response => {
    res.writeHead(response.statusCode, response.headers); response.pipe(res);
  });
  upstream.on('error', () => { res.writeHead(502); res.end(); });
  req.pipe(upstream);
});
proxy.on('connection', track);
proxy.on('connect', (req, client, head) => {
  if (!['desktop-network.invalid:80', 'desktop-network.invalid:443'].includes(req.url)) { client.end('HTTP/1.1 502 Bad Gateway\r\n\r\n'); return; }
  tunnels++;
  const remote = connect(req.url.endsWith(':443') ? secure.address().port : server.address().port, '127.0.0.1'); track(remote);
  remote.once('connect', () => {
    client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
    if (head.length) remote.write(head);
    client.pipe(remote); remote.pipe(client);
  });
  remote.once('close', () => client.destroy()); client.once('close', () => remote.destroy());
});
await new Promise(resolve => proxy.listen(0, '127.0.0.1', resolve));
const manual = { mode: 'manual', proxyUrl: `http://127.0.0.1:${proxy.address().port}` };
const provider = { id: '', name: 'Network fixture', baseUrl: `${origin}/v1`, api: 'openai-responses', enabled: true, keyless: false,
  models: [{ id: 'network-model', name: 'Network model', reasoning: true, vision: false, contextWindow: 128000, maxTokens: 16384,
    thinkingLevels: ['off', 'high'], thinkingControl: { source: 'manual', levels: ['off', 'high'], mapping: { off: 'none', high: 'high' } } }] };
const env = { ...process.env, DESKTOP_TEST_USER_DATA: profile, DESKTOP_TEST_NO_FOCUS: '1', NODE_EXTRA_CA_CERTS: certificate };
delete env.ELECTRON_RUN_AS_NODE;
delete env.DESKTOP_DEV_URL;
let app;
let page;
const launch = async () => {
  app = await electron.launch({ ...(process.env.DESKTOP_VERIFY_EXE ? { executablePath: process.env.DESKTOP_VERIFY_EXE } : { args: [resolve('.')] }), env, timeout: 60000 });
  page = await app.firstWindow();
  await app.evaluate(({ BrowserWindow, session }) => {
    const w = BrowserWindow.getAllWindows()[0];
    w.setOpacity(0); w.setIgnoreMouseEvents(true); w.showInactive(); w.setSize(1360, 900);
    session.defaultSession.setCertificateVerifyProc((request, callback) => callback(request.hostname === 'desktop-network.invalid' ? 0 : -3));
  });
  await page.waitForFunction(() => document.querySelector('.composer .composer-input') && !document.querySelector('.composer-wrap[aria-busy="true"]'));
};
const waitFor = async predicate => {
  for (let i = 0; i < 600; i++) {
    const state = await page.evaluate(() => window.desktop.snapshot());
    if (predicate(state)) return state;
    await page.waitForTimeout(100);
  }
  const state = await page.evaluate(() => window.desktop.snapshot());
  console.error(JSON.stringify({ tunnels, discoveries, bodies: bodies.map(b => ({ model: b.model, stream: b.stream, reasoning: b.reasoning })), status: state.status, state: state.state, messages: state.messages }, null, 2).slice(-12000));
  throw new Error('Runtime wait timed out');
};
const saveNetwork = config => page.evaluate(value => window.desktop.saveNetwork(value), config);
const settings = async () => { await page.locator('.sidebar-settings').click(); await page.getByRole('button', { name: '通用', exact: true }).click(); };
try {
  await launch();
  await mkdir('test-results', { recursive: true });
  await settings();
  await page.getByLabel('代理模式', { exact: true }).selectOption('manual');
  await page.getByLabel('代理地址', { exact: true }).fill('socks5://127.0.0.1:1080');
  await page.getByRole('button', { name: '保存网络设置', exact: true }).click();
  await page.locator('.network-error').waitFor();
  assert.equal((await page.evaluate(() => window.desktop.networkSettings())).mode, 'system');
  await page.getByLabel('代理地址', { exact: true }).fill(manual.proxyUrl);
  await page.getByRole('button', { name: '保存网络设置', exact: true }).click();
  await page.getByText('已保存并生效', { exact: true }).waitFor();
  await page.getByLabel('网络检测地址', { exact: true }).fill(`${origin}/v1/models`);
  await page.getByRole('button', { name: '检测网络', exact: true }).click();
  await page.getByText(/目标可达 · HTTP 401/).waitFor();
  await page.locator('.network-settings').scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'test-results/network-settings-dark.png' });
  await page.evaluate(() => window.desktop.preferences({ theme: 'light' }));
  await page.reload();
  await page.waitForFunction(() => document.querySelector('.composer .composer-input') && !document.querySelector('.composer-wrap[aria-busy="true"]'));
  await settings();
  await page.locator('.network-settings').scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'test-results/network-settings-light.png' });
  await page.getByRole('dialog').getByLabel('语言', { exact: true }).selectOption('en');
  await page.getByRole('heading', { name: 'Network', exact: true }).waitFor();
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(640, 760));
  await page.locator('.network-settings').scrollIntoViewIfNeeded();
  assert.equal(await page.locator('.settings-content').evaluate(e => e.scrollWidth > e.clientWidth), false);
  assert.equal(await page.locator('.network-settings').evaluate(e => e.scrollWidth > e.clientWidth), false);
  await page.screenshot({ path: 'test-results/network-settings-narrow-en.png' });
  await page.getByRole('dialog').getByLabel('Language', { exact: true }).selectOption('zh');
  await page.getByRole('heading', { name: '网络', exact: true }).waitFor();
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1360, 900));
  await page.locator('.settings-dialog > header').getByRole('button', { name: /^(?:Close|\u5173\u95ed)$/u }).click();
  assert.equal((await page.evaluate(({ provider, key }) => window.desktop.discoverProviderModels(provider, key), { provider, key }))[0].id, 'network-model');
  assert.equal((await page.evaluate(({ provider, key }) => window.desktop.testProvider(provider, 'network-model', key), { provider, key })).outcome, 'reply');
  await page.evaluate(({ provider, key }) => window.desktop.saveProvider(provider, key), { provider, key });
  let state = await page.evaluate(() => window.desktop.snapshot());
  await page.evaluate(id => window.desktop.command('set_thinking_level', { level: 'off' }, id), state.runtimeId);
  await page.getByRole('textbox', { name: '消息', exact: true }).fill('Test proxy runtime');
  await submitSessionFixture(page, () => page.getByRole('textbox', { name: '消息', exact: true }).press('Enter'));
  state = await waitFor(s => !s.state?.isStreaming && s.messages.some(m => m.role === 'assistant' && m.stopReason === 'stop'));
  assert.equal(bodies.at(-1).reasoning.effort, 'none', 'off maps to none on the actual runtime wire');
  hold = true;
  await page.evaluate(async id => {
    await window.desktop.command('set_thinking_level', { level: 'high' }, id);
    await window.desktop.command('prompt', { message: 'Hold proxy runtime' }, id);
  }, state.runtimeId);
  await waitFor(s => s.state?.isStreaming);
  await assert.rejects(saveNetwork({ mode: 'direct', proxyUrl: '' }));
  while (!release) await page.waitForTimeout(25);
  hold = false; release();
  await waitFor(s => !s.state?.isStreaming);
  assert.equal(bodies.at(-1).reasoning.effort, 'high');
  const configured = await page.evaluate(async () => (await window.desktop.settings()).providers[0]);
  const tlsProvider = { ...configured, baseUrl: 'https://desktop-network.invalid/v1' };
  assert.equal((await page.evaluate(({ provider, key }) => window.desktop.discoverProviderModels(provider, key), { provider: tlsProvider, key }))[0].id, 'network-model');
  assert.equal((await page.evaluate(({ provider, key }) => window.desktop.testProvider(provider, 'network-model', key), { provider: tlsProvider, key })).outcome, 'reply');
  await page.evaluate(provider => window.desktop.saveProvider(provider), tlsProvider);
  state = await page.evaluate(() => window.desktop.snapshot());
  const beforeTLS = tunnels;
  const beforeBodies = bodies.length;
  if (state.runtimeId) await waitForSessionFixtureTools(page, state.runtimeId);
  await page.evaluate(async id => {
    await window.desktop.command('set_thinking_level', { level: 'off' }, id);
    await window.desktop.command('prompt', { message: 'Test TLS proxy runtime' }, id);
  }, state.runtimeId);
  await waitFor(s => !s.state?.isStreaming && s.messages.some(m => m.role === 'assistant' && m.stopReason === 'stop') && bodies.length > beforeBodies);
  assert.ok(tunnels > beforeTLS, 'HTTPS runtime uses an opaque CONNECT tunnel');
  assert.equal(bodies.at(-1).reasoning.effort, 'none');
  assert.equal((await page.evaluate(() => window.desktop.snapshot())).messages.at(-1).stopReason, 'stop');
  hold = true; release = undefined;
  await page.evaluate(id => window.desktop.command('prompt', { message: 'Cancel TLS fixture' }, id), state.runtimeId);
  for (let i = 0; i < 400 && !release; i++) await page.waitForTimeout(25);
  assert.ok(release, 'cancellation fixture reached the provider');
  await page.evaluate(id => window.desktop.command('abort', {}, id), state.runtimeId);
  await waitFor(s => !s.state?.isStreaming);
  hold = false; release();
  await saveNetwork({ mode: 'direct', proxyUrl: '' });
  const before = discoveries;
  assert.equal((await page.evaluate(url => window.desktop.testNetwork(url), `${origin}/v1/models`)).outcome, 'network');
  await assert.rejects(page.evaluate(({ provider, key }) => window.desktop.discoverProviderModels(provider, key), { provider, key }));
  assert.equal(discoveries, before);
  await saveNetwork({ mode: 'manual', proxyUrl: 'http://127.0.0.1:1' });
  assert.equal((await page.evaluate(url => window.desktop.testNetwork(url), `${origin}/v1/models`)).outcome, 'network');
  await saveNetwork({ mode: 'system', proxyUrl: '' });
  assert.equal((await page.evaluate(() => window.desktop.networkSettings())).mode, 'system');
  await saveNetwork(manual);
  await closeDesktopFixtureAndWait(app); app = undefined;
  assert.deepEqual(JSON.parse(await readFile(join(profile, 'preferences.json'), 'utf8')).network, manual);
  await launch();
  assert.deepEqual(await page.evaluate(() => window.desktop.networkSettings()), manual);
  assert.equal((await page.evaluate(url => window.desktop.testNetwork(url), `${origin}/v1/models`)).status, 401);
  await settings();
  await page.getByRole('button', { name: '供应商', exact: true }).click();
  await page.getByRole('button', { name: '添加供应商', exact: true }).first().click();
  await page.getByRole('button', { name: '创建自定义供应商', exact: true }).click();
  await page.getByLabel('Base URL', { exact: true }).fill('https://api.openai.com/v1');
  await page.getByRole('button', { name: /API 格式/ }).click();
  await page.getByRole('menuitemradio', { name: 'Responses · /responses', exact: true }).click();
  await page.getByRole('button', { name: '添加模型', exact: true }).click();
  await page.getByLabel('模型 ID 1', { exact: true }).fill('gpt-6.1-terra');
  await page.getByRole('button', { name: '更新官方资料', exact: true }).click();
  await page.locator('.provider-model-advanced > summary').first().click();
  assert.equal(await page.getByLabel('上下文容量 1', { exact: true }).inputValue(), '1050000');
  assert.equal(await page.getByLabel('最大输出 1', { exact: true }).inputValue(), '128000');
  assert.equal(await page.locator('.provider-thinking-declared > span').count(), 6);
  assert.match(await page.locator('.provider-thinking-declared').textContent(), /max/);
  assert.doesNotMatch(await page.locator('.provider-thinking-declared').textContent(), /minimal/);
  await page.waitForTimeout(300);
  await page.locator('.provider-thinking-control').scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'test-results/provider-official-terra.png' });
  await page.getByLabel('模型 ID 1', { exact: true }).fill('unknown-fixture');
  assert.equal(await page.getByLabel('上下文容量 1', { exact: true }).inputValue(), '');
  await writeFile('test-results/network-settings-results.json', JSON.stringify({
    passed: true, packaged: Boolean(process.env.DESKTOP_VERIFY_EXE), tunnels, discoveries,
    runtimeEfforts: bodies.filter(body => body.stream).map(body => body.reasoning?.effort),
    scope: 'Isolated HTTP proxy with HTTP forwarding and HTTPS CONNECT, Electron discovery/diagnostic/probe, real Step Responses SSE over HTTP and verified TLS, UI/persistence/mode guards, official metadata UI. No paid provider.'
  }, null, 2));
  console.log('Network settings acceptance passed: visible modes, validation, proxy-only discovery/diagnostics, real runtime SSE and none/high mapping, busy guard, direct failure, relaunch and official metadata UI.');
} catch (error) {
  if (page && !page.isClosed()) {
    console.error((await page.locator('.settings-content').innerText().catch(() => '')).slice(0, 5000));
    await page.screenshot({ path: 'test-results/network-settings-failure.png' }).catch(() => {});
  }
  throw error;
} finally {
  hold = false; release?.();
  if (app) await closeDesktopFixtureAndWait(app);
  for (const socket of sockets) socket.destroy();
  proxy.closeAllConnections(); server.closeAllConnections(); secure.closeAllConnections();
  await Promise.all([new Promise(resolve => proxy.close(resolve)), new Promise(resolve => server.close(resolve)), new Promise(resolve => secure.close(resolve))]);
}
