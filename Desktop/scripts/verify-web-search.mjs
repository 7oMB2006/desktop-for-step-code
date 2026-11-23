import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { _electron as electron } from 'playwright';
import { mkdtemp } from './test-profile.mjs';
import { closeDesktopFixtureAndWait } from './close-desktop-fixture.mjs';

const profile = await mkdtemp(join(tmpdir(), 'desktop-web-search-'));
const root = join(profile, 'step-runtime');
const evidence = resolve('test-results/web-search-settings');
const payloads = [], queries = [], stepMethods = [];
const text = message => typeof message?.content === 'string' ? message.content
  : message?.content?.filter(part => part.type === 'text').map(part => part.text).join('');
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (url.pathname === '/search') {
      queries.push(url.searchParams.get('q'));
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ results: [{ url: 'https://example.org/result', title: 'Local search fixture', content: 'Local-only source.' }] }));
      return;
    }
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw);
    if (url.pathname === '/mcp') {
      assert.equal(req.headers.authorization, 'Bearer native-fixture-key');
      stepMethods.push(body.method);
      if (body.id === undefined) { res.writeHead(202); res.end(); return; }
      const result = body.method === 'initialize' ? {
        protocolVersion: body.params.protocolVersion, serverInfo: { name: 'Local fixture', version: '1' }, capabilities: { tools: {} },
      } : body.method === 'tools/list' ? { tools: [{ name: 'web_search', inputSchema: { type: 'object' } }] }
        : { content: [{ type: 'text', text: 'fixture' }], structuredContent: {
          results: [{ title: 'Native Step fixture', url: 'https://example.org/native-step', snippet: 'Local-only source.' }],
        } };
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ jsonrpc: '2.0', id: body.id, result }));
      return;
    }
    payloads.push(body);
    const userIndex = body.messages.findLastIndex(message => message.role === 'user');
    const user = text(body.messages[userIndex]);
    const search = body.tools?.some(tool => tool.function?.name === 'search_web');
    const call = user?.startsWith('Search with ') && search && !body.messages.slice(userIndex + 1).some(message => message.role === 'tool');
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    const send = (delta, finish_reason = null) => res.write(`data: ${JSON.stringify({
      id: 'search-fixture', object: 'chat.completion.chunk', model: 'fixture', created: 1,
      choices: [{ index: 0, delta, finish_reason }],
    })}\n\n`);
    send({ role: 'assistant', content: '' });
    if (call) {
      send({ tool_calls: [{ index: 0, id: `search-fixture-tool-${payloads.length}`, type: 'function',
        function: { name: 'search_web', arguments: JSON.stringify({ query: 'desktop fixture query' }) } }] });
      send({}, 'tool_calls');
    } else {
      send({ content: 'Search fixture turn finished.' });
      send({}, 'stop');
    }
    res.end('data: [DONE]\n\n');
  } catch { if (!res.headersSent) res.writeHead(500); res.end(); }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
let app, page, phase = 'setup';
try {
  await mkdir(root);
  await mkdir(evidence, { recursive: true });
  const address = `http://127.0.0.1:${server.address().port}`;
  await writeFile(join(profile, 'preferences.json'), JSON.stringify({ language: 'zh', theme: 'light', workspaces: [], autoSessionTitle: false }));
  await writeFile(join(root, 'config.toml'), [
    'defaultProvider = "fixture"', 'defaultModel = "fixture"', '[telemetry]', 'enabled = false',
    '[mcp_servers."steppage__steppage"]', 'enabled = false',
  ].join('\n'));
  await writeFile(join(root, 'models.json'), JSON.stringify({ providers: { fixture: {
    baseUrl: `${address}/v1`, api: 'openai-completions', apiKey: 'local-model-fixture',
    models: [{ id: 'fixture', name: 'Search fixture model', contextWindow: 1000000, maxTokens: 1024 }],
  } } }));
  const env = { ...process.env, DESKTOP_TEST_USER_DATA: profile, DESKTOP_TEST_NO_FOCUS: '1' };
  delete env.ELECTRON_RUN_AS_NODE;
  const cwd = resolve(process.env.DESKTOP_VERIFY_ROOT ?? '.');
  phase = 'native Step transport';
  const runtime = process.env.DESKTOP_MACOS_RESOURCES ? join(process.env.DESKTOP_MACOS_RESOURCES, 'runtime') : join(cwd, 'runtime');
  const child = promisify(execFile)(join(runtime, 'node', process.platform === 'win32' ? 'node.exe' : 'node'), [
    '--use-env-proxy', join(runtime, 'native-step-search.mjs'), join(runtime, 'step/dist/bundle/index.js'),
  ], { cwd: root, windowsHide: true, timeout: 10000, env: { ...env, NO_PROXY: '127.0.0.1', STEPCODE_AUTH_PATH: join(root, 'auth.json') } });
  child.child.stdin.end(JSON.stringify({ key: 'native-fixture-key', url: `${address}/mcp`, query: 'local native MCP fixture' }));
  const native = JSON.parse((await child).stdout);
  assert.equal(native.count, 1);
  assert.match(native.text, /Native Step fixture/);
  assert.deepEqual(stepMethods, ['initialize', 'notifications/initialized', 'tools/list', 'tools/call']);
  const executablePath = process.env.DESKTOP_VERIFY_EXE;
  app = await electron.launch({ ...(executablePath ? { executablePath } : { args: [resolve('.')] }), cwd, env, timeout: 60000 });
  page = await app.firstWindow();
  await app.evaluate(({ net }) => {
    const fetch = net.fetch.bind(net);
    globalThis.searchFixtureStatus = 429;
    globalThis.searchFixtureTavilyCalls = 0;
    net.fetch = (url, init) => {
      if (url !== 'https://api.tavily.com/search') return fetch(url, init);
      if (new Headers(init.headers).get('authorization') !== 'Bearer local-test-key-not-real') throw new Error('Wrong fixture authorization');
      globalThis.searchFixtureTavilyCalls++;
      return Promise.resolve(Response.json({ error: 'local-test-key-not-real' }, { status: globalThis.searchFixtureStatus }));
    };
  });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const size = (width, height) => app.evaluate(({ BrowserWindow }, { width, height }) => {
    const window = BrowserWindow.getAllWindows()[0];
    window.setOpacity(0); window.setIgnoreMouseEvents(true); window.showInactive(); window.setSize(width, height);
  }, { width, height });
  await size(1360, 900);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const dialog = page.getByRole('dialog');
  const category = page.getByRole('navigation', { name: '设置分类' });
  const openSearch = async () => {
    await page.locator('.sidebar-settings').click();
    await category.getByRole('button', { name: '联网搜索', exact: true }).click();
    await page.getByRole('heading', { name: '搜索顺序', exact: true }).waitFor();
  };
  const close = async () => {
    await dialog.getByRole('button', { name: '关闭', exact: true }).click();
    await dialog.waitFor({ state: 'hidden' });
  };
  const snapshot = () => page.evaluate(() => window.desktop.webSearchSettings());
  const submit = async value => {
    const composer = page.getByRole('textbox', { name: '消息', exact: true });
    const replies = page.getByText('Search fixture turn finished.', { exact: true });
    const previous = await replies.count();
    await composer.fill(value);
    await composer.press('Enter');
    await replies.nth(previous).waitFor();
  };
  const searchTool = body => Boolean(body?.tools?.some(tool => tool.function?.name === 'search_web'));
  const modelTurn = content => payloads.find(body => text(body.messages.findLast(message => message.role === 'user')) === content);

  phase = 'no account or service';
  await submit('No search service fixture');
  assert.equal(searchTool(modelTurn('No search service fixture')), false);
  await openSearch();
  assert.deepEqual((await snapshot()).configured, []);

  phase = 'catalog and independent credential save';
  const catalog = page.getByRole('button', { name: '添加搜索服务', exact: true });
  await catalog.click();
  assert.equal(await page.locator('[data-search-preset]').count(), 6);
  assert.ok(await page.locator('[data-search-preset] img').evaluateAll(images => images.every(image => image.complete && image.naturalWidth > 0)));
  const tiles = page.locator('[data-search-preset]');
  assert.equal((await tiles.nth(0).boundingBox()).y, (await tiles.nth(1).boundingBox()).y);
  assert.ok((await tiles.nth(2).boundingBox()).y > (await tiles.nth(0).boundingBox()).y);
  await page.screenshot({ path: join(evidence, 'catalog-light.png') });
  await page.locator('[data-search-preset="tavily"]').click();
  await page.getByLabel('API Key', { exact: true }).fill('local-test-key-not-real');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await page.getByRole('heading', { name: '添加搜索服务', exact: true }).waitFor();
  assert.deepEqual((await snapshot()).configured, ['tavily']);
  assert.deepEqual((await snapshot()).order, []);
  assert.doesNotMatch(JSON.stringify(await snapshot()), /local-test-key/);
  await page.locator('[data-search-preset="searxng"]').click();
  await page.getByLabel('实例地址', { exact: true }).fill(address);
  await page.getByRole('switch', { name: '加入搜索顺序', exact: true }).click();
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await page.getByRole('heading', { name: '添加搜索服务', exact: true }).waitFor();
  assert.deepEqual((await snapshot()).order, ['searxng']);
  await page.getByRole('button', { name: /^搜索顺序/ }).click();
  await page.screenshot({ path: join(evidence, 'order-light.png') });
  await close();

  phase = 'same-session actual model tool execution';
  await submit('Search with local fixture');
  assert.equal(searchTool(modelTurn('Search with local fixture')), true);
  assert.deepEqual(queries, ['desktop fixture query']);
  const tool = page.locator('.process-tool[data-tool-state="done"]').first();
  await tool.locator('summary').first().click();
  await tool.getByText('搜索路径', { exact: true }).waitFor();
  await tool.getByText('SearXNG · 成功', { exact: true }).waitFor();
  await page.screenshot({ path: join(evidence, 'attempts.png') });

  phase = 'reordering, fallback, and terminal auth failure';
  await openSearch();
  await page.getByRole('button', { name: '配置 Tavily', exact: true }).click();
  await page.getByRole('switch', { name: '加入搜索顺序', exact: true }).click();
  await page.getByRole('button', { name: '保存', exact: true }).click();
  const ranked = page.getByRole('list', { name: '启用的搜索服务' });
  const searxng = ranked.locator('[data-order="searxng"]');
  const tavily = ranked.locator('[data-order="tavily"]');
  const waitForOrder = async (first, second, revision) => {
    await page.waitForFunction(({ first, second }) => {
      const pane = document.querySelector('.web-search-pane[aria-busy="false"]');
      return pane?.querySelectorAll('[data-order]')[0]?.getAttribute('data-order') === first
        && pane.querySelectorAll('[data-order]')[1]?.getAttribute('data-order') === second;
    }, { first, second });
    const saved = await snapshot();
    assert.deepEqual(saved.order, [first, second]);
    assert.equal(saved.revision, revision);
  };
  const dragTavilyUp = async () => {
    const grip = await tavily.locator('[data-order-grip]').boundingBox();
    const target = await searxng.boundingBox();
    await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
    await page.mouse.down();
    await page.mouse.move(grip.x + grip.width / 2, target.y + target.height / 4, { steps: 6 });
  };
  const before = await snapshot();
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await dialog.evaluate(element => Promise.all(element.getAnimations({ subtree: true })
    .filter(animation => Number.isFinite(animation.effect.getComputedTiming().endTime))
    .map(animation => animation.finished.catch(() => {}))));
  await dragTavilyUp();
  assert.equal(await tavily.getAttribute('data-order-dragging'), '');
  assert.ok(await searxng.evaluate(row => row.getAnimations().some(animation =>
    animation.effect.getTiming().easing === 'cubic-bezier(0.22, 1, 0.36, 1)')), 'Neighbor slides while dragging');
  assert.deepEqual((await snapshot()).order, ['searxng', 'tavily'], 'Preview does not save');
  await page.screenshot({ path: join(evidence, 'priority-drag.png'), animations: 'disabled' });
  await page.keyboard.press('Escape');
  await page.mouse.up();
  assert.equal(await tavily.getAttribute('data-order-dragging'), null);
  assert.equal((await snapshot()).revision, before.revision, 'Cancelling does not save');
  await ranked.evaluate(list => Promise.all(list.getAnimations({ subtree: true }).map(animation => animation.finished.catch(() => {}))));

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await dragTavilyUp();
  assert.equal(await searxng.evaluate(row => row.getAnimations().length), 0);
  assert.notEqual(await searxng.evaluate(row => row.style.translate), '');
  await page.mouse.move(1, 1);
  await page.mouse.up();
  assert.equal((await snapshot()).revision, before.revision, 'Dropping outside does not save');

  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await dragTavilyUp();
  await page.mouse.up();
  await waitForOrder('tavily', 'searxng', before.revision + 1);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.getByRole('button', { name: '下移 Tavily', exact: true }).press('Enter');
  await waitForOrder('searxng', 'tavily', before.revision + 2);
  await page.getByRole('button', { name: '上移 Tavily', exact: true }).press('Enter');
  await waitForOrder('tavily', 'searxng', before.revision + 3);
  await page.screenshot({ path: join(evidence, 'order-light.png') });
  await close();
  await submit('Search with fallback fixture');
  const fallbackTool = page.locator('.process-tool[data-tool-state="done"]').last();
  await fallbackTool.locator('summary').first().click();
  await fallbackTool.getByText('Tavily · 服务限流 → SearXNG · 成功', { exact: true }).waitFor();
  assert.equal(await app.evaluate(() => globalThis.searchFixtureTavilyCalls), 1);
  assert.equal(queries.length, 2);
  await page.screenshot({ path: join(evidence, 'fallback.png') });
  await app.evaluate(() => { globalThis.searchFixtureStatus = 401; });
  await submit('Search with invalid credentials fixture');
  const failedTool = page.locator('.process-tool[data-tool-state="failed"]').last();
  await failedTool.locator('summary').first().click();
  await failedTool.getByText('Tavily · 凭据无效', { exact: true }).waitFor();
  assert.equal(await app.evaluate(() => globalThis.searchFixtureTavilyCalls), 2);
  assert.equal(queries.length, 2, 'Invalid credentials must not send the query to another provider');
  assert.doesNotMatch(await failedTool.textContent(), /local-test-key/);

  phase = 'narrow dark catalog and global disable';
  await openSearch();
  await page.evaluate(() => window.desktop.preferences({ theme: 'dark' }));
  await size(640, 740);
  await catalog.click();
  assert.notEqual((await tiles.nth(0).boundingBox()).y, (await tiles.nth(1).boundingBox()).y);
  assert.equal(await page.locator('.settings-content').evaluate(element => element.scrollWidth > element.clientWidth), false);
  await page.screenshot({ path: join(evidence, 'catalog-narrow-dark.png') });
  await page.getByRole('button', { name: /^搜索顺序/ }).click();
  await page.locator('.web-search-pane').getByRole('switch', { name: '联网搜索', exact: true }).click();
  await page.waitForFunction(async () => !(await window.desktop.webSearchSettings()).enabled);
  await close();
  await submit('Search disabled fixture');
  assert.equal(searchTool(modelTurn('Search disabled fixture')), false);
  assert.equal(queries.length, 2);
  assert.deepEqual(errors, []);
  console.log('Web search settings, local execution, attempt trace, and same-session availability passed.');
} catch (error) {
  console.error(`Web search acceptance failed during ${phase}`);
  if (page && !page.isClosed()) {
    console.error('Search settings:', await page.evaluate(async () => {
      const { order, revision, enabled, fallback } = await window.desktop.webSearchSettings();
      return { order, revision, enabled, fallback };
    }).catch(() => undefined));
    console.error('Search tool traces:', await page.locator('.process-tool').allTextContents().catch(() => []));
  }
  console.error(payloads.map(body => ({
    user: text(body.messages.findLast(message => message.role === 'user')),
    searchOffered: body.tools?.some(tool => tool.function?.name === 'search_web'),
    toolOutput: text(body.messages.findLast(message => message.role === 'tool')),
  })), queries);
  await page?.screenshot({ path: join(evidence, 'failure.png') }).catch(() => {});
  throw error;
} finally {
  try { if (app) await closeDesktopFixtureAndWait(app); }
  finally { server.closeAllConnections(); await new Promise(done => server.close(done)); }
}
