import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron as electron } from 'playwright';
import { prepareAgentPreviewFixture } from './agent-preview-fixture.mjs';
import { waitForBrowserFixtureSnapshot } from './browser-fixture.mjs';
import { submitSessionFixture } from './session-fixture.mjs';
import { mkdtemp } from './test-profile.mjs';

const tool = 'desktop_open_preview';
const replies = new Map();
let releaseBackground;
let unexpectedRequest = false;
let serverError;
const text = content => typeof content === 'string' ? content
  : content?.filter(item => item.type === 'text').map(item => item.text).join('') ?? '';
const chunk = (delta, finish_reason = null) => `data: ${JSON.stringify({
  id: 'browser-fixture', object: 'chat.completion.chunk', created: 1, model: 'fixture',
  choices: [{ index: 0, delta, finish_reason }],
})}\n\n`;
const server = createServer(async (request, response) => {
  if (request.method !== 'POST') {
    if (request.url === '/redirect') { response.writeHead(302, { Location: outside }); response.end(); return; }
    if (request.url === '/outside') unexpectedRequest = true;
    response.setHeader('Content-Type', 'text/html');
    response.end('<!doctype html><title>Agent preview fixture</title><h1>Local preview</h1>');
    return;
  }
  try {
    let body = '';
    for await (const part of request) body += part;
    const payload = JSON.parse(body);
    const prompt = text(payload.messages.findLast(message => message.role === 'user')?.content);
    const scenario = /^PREVIEW (\w+)$/.exec(prompt)?.[1];
    const last = payload.messages.at(-1);
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    const complete = () => response.end(chunk({ role: 'assistant', content: `Fixture complete: ${scenario}` })
      + chunk({}, 'stop') + 'data: [DONE]\n\n');
    if (!scenario) { complete(); return; }
    if (last?.role === 'tool') {
      replies.set(scenario, text(last.content));
      complete();
      return;
    }
    assert.ok(payload.tools.some(entry => entry.function.name === tool), 'the real runtime must expose the tool');
    const url = scenario === 'background' ? `${base}/background` : scenario === 'external' ? outside.replace(/^http:\/\/localhost:\d+/, 'https://example.invalid')
      : scenario === 'redirect' ? `${base}/redirect` : `${base}/foreground`;
    const send = () => response.end(chunk({ tool_calls: [{ index: 0, id: `call-${scenario}`, type: 'function',
      function: { name: tool, arguments: JSON.stringify({ url }) } }] }) + chunk({}, 'tool_calls') + 'data: [DONE]\n\n');
    if (scenario === 'background') { response.write(chunk({ role: 'assistant' })); releaseBackground = send; }
    else send();
  } catch (error) { serverError = error; response.destroy(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
const base = `http://127.0.0.1:${port}`;
const outside = `http://localhost:${port}/outside`;
const profile = await mkdtemp(join(tmpdir(), 'step-agent-preview-'));
let app;
try {
  const root = join(profile, 'step-runtime');
  const sessions = join(root, 'sessions');
  await mkdir(sessions, { recursive: true });
  await writeFile(join(profile, 'preferences.json'), JSON.stringify({ language: 'en', workspaces: [] }));
  await writeFile(join(root, 'config.toml'), 'defaultProvider = "fixture"\ndefaultModel = "fixture"\npermissionPreset = "ask"\n[telemetry]\nenabled = false\n[mcp_servers.steppage__steppage]\nenabled = false\n');
  await writeFile(join(root, 'models.json'), JSON.stringify({ providers: { fixture: { baseUrl: `${base}/v1`, api: 'openai-completions',
    apiKey: 'local-test-only', models: [{ id: 'fixture', name: 'Fixture', contextWindow: 32768, maxTokens: 2048 }] } } }));
  for (const id of ['preview-a', 'preview-b']) {
    const timestamp = new Date().toISOString();
    await writeFile(join(sessions, `${id}.jsonl`), [
      { type: 'session', version: 3, id, cwd: profile, timestamp },
      { type: 'message', id: 'message-1', parentId: null, timestamp,
        message: { role: 'user', content: [{ type: 'text', text: id }], timestamp: Date.parse(timestamp) } },
    ].map(value => JSON.stringify(value)).join('\n') + '\n');
  }
  const env = { ...process.env, DESKTOP_TEST_USER_DATA: profile, DESKTOP_TEST_NO_FOCUS: '1' };
  delete env.ELECTRON_RUN_AS_NODE;
  const executablePath = process.env.DESKTOP_VERIFY_EXE;
  if (!executablePath) await prepareAgentPreviewFixture(profile);
  app = await electron.launch({ ...(executablePath ? { executablePath, args: [] } : { args: [resolve('.')] }),
    cwd: executablePath ? process.env.DESKTOP_VERIFY_CWD : profile, env, timeout: 60000 });
  const page = await app.firstWindow();
  page.setDefaultTimeout(15000);
  await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    window.setOpacity(0);
    window.setIgnoreMouseEvents(true);
    window.showInactive();
    window.setSize(1500, 960);
  });
  await page.getByText('Step Code connected', { exact: true }).waitFor({ state: 'attached', timeout: 60000 });
  const rail = page.locator('.right-tool-rail').getByRole('button', { name: 'Browser', exact: true });
  const panel = page.locator('#browser-panel');
  const list = () => page.evaluate(() => window.desktop.browserList());
  const select = async id => {
    await page.locator(`[data-reorder-kind="session"][data-reorder-id="${id}"]`).locator('button').first().click();
    await page.waitForFunction(id => document.querySelector('.session-row.selected')?.dataset.reorderId === id
      && !document.querySelector('.composer-wrap.session-navigation-pending'), id);
    await waitForBrowserFixtureSnapshot(page, value => value.owner === `session:${id}`, id);
  };
  const send = async scenario => {
    const input = page.locator('.composer > .composer-input');
    await input.fill(`PREVIEW ${scenario}`);
    await submitSessionFixture(page, () => input.press('Enter'));
  };
  const settled = async scenario => {
    for (let i = 0; i < 300 && !replies.has(scenario); i++) {
      if (serverError) throw serverError;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert.ok(replies.has(scenario), `model must see the tool result for ${scenario}`);
    return replies.get(scenario);
  };
  const finish = async scenario => {
    const result = await settled(scenario);
    await page.getByText(`Fixture complete: ${scenario}`, { exact: true }).waitFor();
    return result;
  };
  const confirm = async (path, choice = 'Confirm') => {
    const url = base + path;
    console.log(`Waiting for preview approval: ${choice} ${path}`);
    const request = page.getByRole('dialog', { name: 'Allow this local preview?', exact: true });
    await request.locator('.request-message').filter({ hasText: new RegExp(`^Open this exact address in an isolated tab:\\s+${RegExp.escape(url)}$`) })
      .waitFor({ state: 'visible', timeout: 15000 });
    await request.getByRole('button', { name: choice, exact: true }).click({ timeout: 15000 });
    console.log(`Answered preview approval: ${choice} ${path}`);
  };
  const loaded = path => waitForBrowserFixtureSnapshot(page, value =>
    value.tabs.some(tab => tab.id === value.activeId && tab.url === base + path && !tab.loading && tab.title === 'Agent preview fixture'),
    `loaded ${path}`);
  await select('preview-a');
  await send('foreground');
  await confirm('/foreground');
  const first = JSON.parse(await finish('foreground'));
  assert.equal(first.opened, true);
  assert.equal(first.reused, false);
  assert.equal(first.load, 'loading');
  assert.equal((await loaded('/foreground')).activeId, first.tabId);
  await panel.locator('.browser-page').waitFor({ state: 'visible' });
  assert.equal(await rail.getAttribute('aria-pressed'), 'true');
  assert.deepEqual(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map(window =>
    window.contentView.children.some(view => view.getVisible() && view.webContents?.getURL().endsWith('/foreground')))), [true]);
  await send('duplicate');
  await confirm('/foreground');
  assert.deepEqual(JSON.parse(await finish('duplicate')), { opened: true, tabId: first.tabId, reused: true, load: 'loaded' });
  assert.equal((await list()).tabs.length, 1);
  await send('denied');
  await confirm('/foreground', 'Cancel');
  assert.match(await finish('denied'), /not approved/);
  assert.equal((await list()).tabs.length, 1);
  await send('external');
  assert.match(await finish('external'), /explicit local HTTP URL/);
  assert.equal((await list()).tabs.length, 1);
  await send('redirect');
  await confirm('/redirect');
  const redirected = JSON.parse(await finish('redirect'));
  await waitForBrowserFixtureSnapshot(page, value => value.tabs.some(tab => tab.id === redirected.tabId && tab.error),
    'blocked preview redirect');
  assert.equal(unexpectedRequest, false);
  await rail.click();
  await send('background');
  for (let i = 0; i < 300 && !releaseBackground; i++) {
    if (serverError) throw serverError;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert.ok(releaseBackground, 'the background request reached the model before switching');
  await select('preview-b');
  releaseBackground();
  assert.equal(await rail.getAttribute('aria-pressed'), 'false');
  assert.deepEqual((await list()).tabs, []);
  assert.equal(replies.has('background'), false, 'a background request cannot open without approval');
  await select('preview-a');
  await confirm('/background');
  const background = JSON.parse(await settled('background'));
  assert.equal((await loaded('/background')).activeId, background.tabId);
  await panel.locator('.browser-page').waitFor({ state: 'visible' });
  assert.equal(await rail.getAttribute('aria-pressed'), 'true');
  console.log('Agent preview passed: real tool call, native visibility, same-tab reuse, external/redirect rejection, and background ownership.');
} finally {
  try { await app?.close(); }
  finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}
