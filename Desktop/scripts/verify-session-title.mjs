import assert from 'node:assert/strict';
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron as electron } from 'playwright';
import { closeDesktopFixtureAndWait } from './close-desktop-fixture.mjs';
import { installRuntimeFixturePreload } from './runtime-transport-fixture.mjs';
import { waitForSessionFixtureSnapshot, waitForSessionFixtureTools } from './session-fixture.mjs';
import { mkdtemp } from './test-profile.mjs';

const profile = await realpath(await mkdtemp(join(tmpdir(), 'dfsc-session-title-')));
const runtime = join(profile, 'step-runtime');
await mkdir(runtime);
await writeFile(join(runtime, 'auth.json'), JSON.stringify({ step: {
  type: 'oauth', access: 'isolated-title-fixture-only', refresh: 'local', expires: Number.MAX_SAFE_INTEGER,
  profile: 'platform_oversea',
} }));
await writeFile(join(runtime, 'config.toml'), `defaultProvider = "step"
defaultModel = "step-5-preview"
[telemetry]
enabled = false
[mcp_servers.steppage__steppage]
enabled = false
`);
await writeFile(join(runtime, 'models.json'), JSON.stringify({ providers: { step: {
  api: 'openai-completions', baseUrl: 'https://api.stepfun.ai/v1', models: [
    { id: 'step-5-preview', name: 'Conversation fixture', contextWindow: 32768, maxTokens: 2048 },
    { id: 'step-3.5-flash-2603', name: 'Title fixture', contextWindow: 32768, maxTokens: 2048 },
  ],
} } }));
// Any non-fixture discovery outside the instrumented worker fails locally.
await writeFile(join(profile, 'preferences.json'), JSON.stringify({
  autoCheckUpdates: false, network: { mode: 'manual', proxyUrl: 'http://127.0.0.1:1' },
}));

const preload = join(profile, 'mock-step-transport.cjs');
await writeFile(preload, `
const respond = async input => {
  const url = new URL(input instanceof Request ? input.url : input);
  if (!['api.stepfun.ai', 'api.stepfun.com'].includes(url.hostname)) throw new Error('External fixture request blocked');
  if (url.pathname.endsWith('/models')) return Response.json({ data: [
    { id: 'step-5-preview' }, { id: 'step-3.5-flash-2603' },
  ] });
  if (!url.pathname.endsWith('/chat/completions')) throw new Error('Unexpected fixture request');
  const event = (delta, finish_reason) => 'data: ' + JSON.stringify({
    id: 'conversation-fixture', object: 'chat.completion.chunk', created: 1, model: 'step-5-preview',
    choices: [{ index: 0, delta, finish_reason }],
  }) + '\\n\\n';
  return new Response(event({ role: 'assistant', content: 'Local fixture reply.' }, null) + event({}, 'stop') + 'data: [DONE]\\n\\n',
    { headers: { 'content-type': 'text/event-stream' } });
};
Object.defineProperty(globalThis, 'fetch', { configurable: true, get: () => respond, set: () => {} });
`);
const env = { ...process.env, DESKTOP_TEST_USER_DATA: profile, DESKTOP_TEST_NO_FOCUS: '1' };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({
  ...(process.env.DESKTOP_VERIFY_EXE ? { executablePath: process.env.DESKTOP_VERIFY_EXE } : { args: [resolve('.')] }),
  env, timeout: 60000,
});
try {
  await app.evaluate(installRuntimeFixturePreload, { preload });
  await app.evaluate(({ net }) => {
    const original = net.fetch.bind(net);
    const fixture = globalThis.titleAcceptance = { calls: [] };
    net.fetch = (url, init) => {
      if (!/^https:\/\/api\.stepfun\.ai\/v1\/chat\/completions$/.test(String(url))) return original(url, init);
      fixture.calls.push({ url, body: JSON.parse(init.body) });
      return new Promise(resolveResponse => {
        fixture.finish = () => resolveResponse(Response.json({
          choices: [{ finish_reason: 'stop', message: { content: 'Explain automatic titles' } }],
        }));
      });
    };
  });
  const page = await app.firstWindow();
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.waitForFunction(() => Boolean(window.desktop));
  await page.evaluate(() => {
    globalThis.titleFades = [];
    const animate = Element.prototype.animate;
    Element.prototype.animate = function (frames, options) {
      if (this.matches('.session-title-current, .session-title-outgoing')) globalThis.titleFades.push({
        surface: this.closest('.window-session-title') ? 'title bar' : 'sidebar',
        text: this.dataset.title ?? this.textContent,
        opacity: frames.map(frame => frame.opacity),
        duration: options.duration,
        easing: options.easing,
      });
      return animate.call(this, frames, options);
    };
  });
  const draft = await waitForSessionFixtureSnapshot(page, snapshot => snapshot.draftId && snapshot.models.some(
    model => model.provider === 'step' && model.id === 'step-5-preview'), 'the empty Step composer');
  const created = await page.evaluate(id => window.desktop.createDraftSession(id), draft.draftId);
  assert.equal(created.state.model.id, 'step-5-preview');
  assert.ok(created.models.some(model => model.id === 'step-3.5-flash-2603'));
  await waitForSessionFixtureTools(page, created.runtimeId);
  const message = 'Could you explain how the automatic title feature chooses a name?';
  await page.evaluate(({ runtimeId, message }) => window.desktop.command('prompt', { message }, runtimeId),
    { runtimeId: created.runtimeId, message });
  const before = await waitForSessionFixtureSnapshot(page, snapshot => !snapshot.state.isStreaming
    && snapshot.messages.some(entry => entry.role === 'assistant' && entry.stopReason === 'stop'), 'the primary reply');
  assert.ok(!before.state.sessionName, 'The primary reply does not wait for the title');
  assert.equal(before.sessions.find(session => session.id === created.state.sessionId).firstMessage, message);
  const titleBar = page.locator('.window-session-title');
  const sidebarTitle = page.locator(`[data-reorder-kind="session"][data-reorder-id="${created.state.sessionId}"] .session-title-text`);
  await titleBar.getByText(message, { exact: true }).waitFor();
  await sidebarTitle.getByText(message, { exact: true }).waitFor();
  assert.deepEqual(await page.evaluate(() => globalThis.titleFades), [], 'The first-message placeholder does not animate');
  const calls = await app.evaluate(() => {
    const fixture = globalThis.titleAcceptance;
    fixture.finish?.();
    return fixture.calls;
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].body.model, 'step-3.5-flash-2603');
  assert.deepEqual(calls[0].body.messages[1], { role: 'user', content: message });
  const after = await waitForSessionFixtureSnapshot(page, snapshot => snapshot.state.sessionName === 'Explain automatic titles',
    'the automatic title');
  assert.equal(after.state.model.id, 'step-5-preview');
  assert.equal(after.messages.filter(entry => entry.role === 'user').length, 1);
  const entries = (await readFile(after.state.sessionFile, 'utf8')).split('\n').filter(Boolean).map(line => JSON.parse(line));
  assert.ok(entries.some(entry => entry.type === 'session_info' && entry.name === 'Explain automatic titles'));
  await page.waitForFunction(() => globalThis.titleFades.length >= 4);
  assert.deepEqual((await page.evaluate(() => globalThis.titleFades)).sort((a, b) =>
    a.surface.localeCompare(b.surface) || a.duration - b.duration), ['sidebar', 'title bar'].flatMap(surface => [
      { surface, text: message, opacity: [1, 0], duration: 180, easing: 'cubic-bezier(.25, .65, .4, 1)' },
      { surface, text: 'Explain automatic titles', opacity: [0, 1], duration: 240, easing: 'cubic-bezier(.25, .65, .4, 1)' },
    ]));
  await page.waitForFunction(() => !document.querySelector('.session-title-outgoing[data-title]'));
  assert.equal(await titleBar.textContent(), 'Explain automatic titles');
  assert.equal(await sidebarTitle.textContent(), 'Explain automatic titles');
  await page.evaluate(id => window.desktop.renameSession(id, 'Manually named'), created.state.sessionId);
  await titleBar.getByText('Manually named', { exact: true }).waitFor();
  await sidebarTitle.getByText('Manually named', { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => globalThis.titleFades.length), 4, 'Manual renames never crossfade');

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.locator('.new-chat').click();
  const reducedDraft = await waitForSessionFixtureSnapshot(page, snapshot => Boolean(snapshot.draftId), 'the second proposal');
  const reduced = await page.evaluate(id => window.desktop.createDraftSession(id), reducedDraft.draftId);
  await waitForSessionFixtureTools(page, reduced.runtimeId);
  const reducedMessage = 'Summarize without playing title motion';
  await page.evaluate(({ runtimeId, message }) => window.desktop.command('prompt', { message }, runtimeId),
    { runtimeId: reduced.runtimeId, message: reducedMessage });
  await titleBar.getByText(reducedMessage, { exact: true }).waitFor();
  assert.equal(await app.evaluate(() => {
    globalThis.titleAcceptance.finish?.();
    return globalThis.titleAcceptance.calls.length;
  }), 2);
  await titleBar.getByText('Explain automatic titles', { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => globalThis.titleFades.length), 4, 'Reduced motion updates directly');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await sidebarTitle.click();
  await titleBar.getByText('Manually named', { exact: true }).waitFor();
  await page.locator(`[data-reorder-id="${reduced.state.sessionId}"] .session-title-text`).click();
  await titleBar.getByText('Explain automatic titles', { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => globalThis.titleFades.length), 4, 'Switching to an automatically named session never crossfades');
  console.log('Automatic session titles: one lightweight request per new session, non-blocking reply, persistence and scoped cubic motion passed.');
} catch (error) {
  console.error(error);
  throw error;
} finally {
  await closeDesktopFixtureAndWait(app);
}
