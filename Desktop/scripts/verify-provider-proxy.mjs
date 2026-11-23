import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { mkdtemp } from './test-profile.mjs';
import { closeDesktopFixtureAndWait } from './close-desktop-fixture.mjs';

const profile = await mkdtemp(join(tmpdir(), 'desktop-provider-proxy-'));
await writeFile(join(profile, 'preferences.json'), JSON.stringify({ language: 'zh', theme: 'dark', workspaces: [] }));
const origin = 'http://desktop-provider.invalid';
const key = 'isolated-proxy-fixture-key';
const provider = {
  id: '', name: 'Proxy fixture', baseUrl: `${origin}/v1`, api: 'openai-completions', enabled: true, keyless: false,
  models: [{ id: 'proxy-model', name: 'Proxy model', reasoning: false, vision: false, contextWindow: 128000, maxTokens: 16384 }],
};
let mode = 'reply';
let requests = 0;
let redirected = 0;
let held;
const proxy = createServer(async (req, res) => {
  try {
    const url = new URL(req.url);
    if (url.hostname !== 'desktop-provider.invalid') { res.writeHead(502); res.end(); return; }
    requests++;
    if (url.pathname === '/redirect-target') redirected++;
    assert.equal(url.pathname.endsWith('/messages') ? req.headers['x-api-key'] : req.headers.authorization,
      url.pathname.endsWith('/messages') ? key : `Bearer ${key}`);
    assert.equal(req.headers.cookie, undefined, 'browser cookies must not reach providers');
    let raw = '';
    for await (const chunk of req) raw += chunk;
    if (mode === 'hold') { held?.(); return; }
    if (mode === 'redirect') { res.writeHead(302, { location: `${origin}/redirect-target` }); res.end(); return; }
    if (mode === 'auth') { res.writeHead(401); res.end(`private upstream error ${key}`); return; }
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'max-age=3600' });
    if (url.pathname === '/v1/models') {
      res.end(JSON.stringify({ data: [{ id: 'proxy-model' }] }));
      return;
    }
    const body = JSON.parse(raw);
    assert.equal(body.stream, false);
    assert.equal(body.model, 'proxy-model');
    res.end(JSON.stringify(url.pathname.endsWith('/responses')
      ? { object: 'response', status: 'completed', output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'OK' }] }] }
      : url.pathname.endsWith('/messages')
        ? { type: 'message', role: 'assistant', content: [{ type: 'text', text: 'OK' }] }
        : { choices: [{ message: { role: 'assistant', content: 'OK' } }] }));
  } catch {
    if (!res.headersSent) res.writeHead(500);
    res.end();
  }
});
await new Promise(resolve => proxy.listen(0, '127.0.0.1', resolve));
const env = { ...process.env, DESKTOP_TEST_USER_DATA: profile, DESKTOP_TEST_NO_FOCUS: '1' };
delete env.ELECTRON_RUN_AS_NODE;
let app;
let systemSmoke;
try {
  app = await electron.launch({ ...(process.env.DESKTOP_VERIFY_EXE
    ? { executablePath: process.env.DESKTOP_VERIFY_EXE } : { args: [resolve('.')] }), env, timeout: 60000 });
  const page = await app.firstWindow();
  await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    window.setOpacity(0); window.setIgnoreMouseEvents(true); window.showInactive();
  });
  await page.waitForFunction(() => window.desktop && document.querySelector('.composer .composer-input') && !document.querySelector('.composer-wrap[aria-busy="true"]'));
  if (process.argv.includes('--system-smoke')) {
    systemSmoke = await app.evaluate(async ({ net, session }) => {
      const url = 'https://api.openai.com/v1/models';
      const route = await session.defaultSession.resolveProxy(url);
      const response = await net.fetch(url, { credentials: 'omit', cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(15000) });
      await response.body?.cancel();
      return { proxyResolved: route !== 'DIRECT', status: response.status };
    });
    assert.equal(systemSmoke.proxyResolved, true, 'system smoke requires an enabled system proxy');
    assert.equal(systemSmoke.status, 401, 'OpenAI is reachable through the system proxy without submitting an API key');
  }
  const port = proxy.address().port;
  const route = await app.evaluate(async ({ session }, { origin, port }) => {
    await session.defaultSession.setProxy({ mode: 'fixed_servers', proxyRules: `http=127.0.0.1:${port};https=127.0.0.1:${port}` });
    await session.defaultSession.cookies.set({ url: origin, name: 'browser-secret', value: 'must-not-be-sent' });
    return session.defaultSession.resolveProxy(origin);
  }, { origin, port });
  assert.match(route, new RegExp(`PROXY 127\\.0\\.0\\.1:${port}`));
  const discover = () => page.evaluate(({ provider, key }) => window.desktop.discoverProviderModels(provider, key), { provider, key });
  const diagnostic = api => page.evaluate(({ provider, key, api }) => window.desktop.testProvider({ ...provider, api }, 'proxy-model', key), { provider, key, api });
  assert.deepEqual(await discover(), [{ id: 'proxy-model', name: 'proxy-model' }]);
  await discover();
  assert.equal(requests, 2, 'model discovery bypasses the browser HTTP cache');
  for (const api of ['openai-completions', 'openai-responses', 'anthropic-messages']) {
    assert.equal((await diagnostic(api)).outcome, 'reply', `${api}: proxy transport returns a validated reply`);
  }
  mode = 'auth';
  await assert.rejects(discover(), error => /Model discovery HTTP 401/.test(String(error)) && !String(error).includes(key));
  assert.equal((await diagnostic('openai-completions')).outcome, 'authentication');
  mode = 'redirect';
  await assert.rejects(discover(), /Could not retrieve model list/);
  assert.equal((await diagnostic('openai-completions')).outcome, 'network');
  assert.equal(redirected, 0, 'redirect targets never receive the provider key');
  mode = 'hold';
  const waiting = new Promise(resolve => { held = resolve; });
  const pending = diagnostic('openai-completions');
  await Promise.race([waiting, pending.then(() => { throw new Error('Diagnostic ended before the proxy received it'); })]);
  await page.evaluate(() => window.desktop.cancelProviderTest());
  assert.equal((await pending).outcome, 'cancelled');
  held = undefined;
  const discoveryTimeout = discover();
  await assert.rejects(discoveryTimeout, /Model discovery timed out/);
  mode = 'auth';
  await page.locator('.sidebar-settings').click();
  await page.getByRole('button', { name: '供应商', exact: true }).click();
  await page.getByRole('button', { name: '添加供应商', exact: true }).first().click();
  await page.getByRole('button', { name: '创建自定义供应商', exact: true }).click();
  await page.getByLabel('名称', { exact: true }).fill('Proxy fixture');
  await page.getByLabel('Base URL', { exact: true }).fill(provider.baseUrl);
  await page.getByLabel('API Key', { exact: true }).fill(key);
  await page.getByRole('button', { name: '从上游获取', exact: true }).click();
  await page.getByText('HTTP 401 · 认证或访问被拒绝，请检查密钥、权限及网络出口。', { exact: true }).waitFor();
  assert.equal((await page.locator('.provider-error').textContent()).includes(key), false);
  await mkdir('test-results', { recursive: true });
  await page.screenshot({ path: 'test-results/provider-proxy-http401.png' });
  mode = 'reply';
  await app.evaluate(async ({ session }) => {
    await session.defaultSession.setProxy({ mode: 'direct' });
    await session.defaultSession.closeAllConnections();
  });
  const before = requests;
  assert.equal((await diagnostic('openai-completions')).outcome, 'network', 'reserved .invalid target is unreachable without the proxy');
  assert.equal(requests, before);
  await writeFile('test-results/provider-proxy-results.json', JSON.stringify({
    passed: true, packaged: Boolean(process.env.DESKTOP_VERIFY_EXE), proxiedRequests: requests, redirectedRequests: redirected, systemSmoke,
    scope: 'Electron model discovery and connection diagnostics only; not Step runtime model generation or paid-provider acceptance',
  }, null, 2));
  console.log('Provider proxy acceptance passed: forced proxy, uncached discovery, isolated cookies, protocol replies, HTTP 401 UI, blocked redirects, cancellation, discovery timeout and direct-route failure.');
  if (systemSmoke) console.log('System proxy smoke passed: unauthenticated OpenAI /v1/models returned HTTP 401 through the Electron system proxy.');
} finally {
  proxy.closeAllConnections();
  if (app) await closeDesktopFixtureAndWait(app);
  await new Promise(resolve => proxy.close(resolve));
}
