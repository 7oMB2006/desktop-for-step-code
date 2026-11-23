import assert from 'node:assert/strict';
import { mkdir, readdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { _electron as electron } from 'playwright';
import { closeDesktopFixtureAndWait } from './close-desktop-fixture.mjs';
import { installRuntimeFixturePreload } from './runtime-transport-fixture.mjs';
import { waitForSessionFixtureSnapshot, waitForSessionFixtureTools } from './session-fixture.mjs';
import { mkdtemp } from './test-profile.mjs';

const profile = await realpath(await mkdtemp(join(tmpdir(), 'dfsc-session-title-')));
const runtime = join(profile, 'step-runtime');
const manual = { provider: 'desktop-custom-00000000-0000-4000-8000-000000000001', id: 'fixture-title' };
const manualUrl = 'https://manual-title-fixture.test/v1/responses';
await mkdir(runtime);
await writeFile(join(runtime, 'auth.json'), JSON.stringify({
  step: { type: 'oauth', access: 'isolated-title-fixture-only', refresh: 'local', expires: Number.MAX_SAFE_INTEGER,
    profile: 'step_plan_oversea' },
  [manual.provider]: { type: 'api_key', key: 'isolated-manual-title-key' },
  __desktopCustomProviders: [{ id: manual.provider, name: 'Title provider', baseUrl: 'https://manual-title-fixture.test/v1',
    api: 'openai-responses', keyless: false, enabled: true, models: [
      { id: manual.id, name: 'Fixture title model', contextWindow: 32768, maxTokens: 2048, reasoning: false, vision: false },
    ] }],
}));
await writeFile(join(runtime, 'config.toml'), `defaultProvider = "fixture-third-party"
defaultModel = "fixture-chat"
[telemetry]
enabled = false
[mcp_servers.steppage__steppage]
enabled = false
`);
await writeFile(join(runtime, 'models.json'), JSON.stringify({ providers: { 'fixture-third-party': {
  api: 'openai-completions', baseUrl: 'https://title-chat-fixture.test/v1', apiKey: 'isolated-chat-fixture-only', models: [
    { id: 'fixture-chat', name: 'Conversation fixture', contextWindow: 32768, maxTokens: 2048 },
  ],
} } }));
// Any non-fixture discovery outside the instrumented worker fails locally.
await writeFile(join(profile, 'preferences.json'), JSON.stringify({
  autoCheckUpdates: false, network: { mode: 'manual', proxyUrl: 'http://127.0.0.1:1' },
}));

const preload = join(profile, 'mock-step-transport.cjs');
await writeFile(preload, `
const respond = async (input, init) => {
  const url = new URL(input instanceof Request ? input.url : input);
  if (!['api.stepfun.ai', 'api.stepfun.com', 'title-chat-fixture.test'].includes(url.hostname)) throw new Error('External fixture request blocked');
  if (url.pathname.endsWith('/models')) return Response.json({ data: [
    ...(url.hostname === 'title-chat-fixture.test' ? [{ id: 'fixture-chat' }] : [{ id: 'step-3.5-flash-2603' }]),
  ] });
  if (url.hostname !== 'title-chat-fixture.test' || url.pathname !== '/v1/chat/completions') throw new Error('Chat must use the third-party provider');
  const body = input instanceof Request ? await input.json() : JSON.parse(init.body);
  if (body.model !== 'fixture-chat') throw new Error('Chat must use the original model');
  const event = (delta, finish_reason) => 'data: ' + JSON.stringify({
    id: 'conversation-fixture', object: 'chat.completion.chunk', created: 1, model: 'fixture-chat',
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
  await app.evaluate(({ net }, customUrl) => {
    const original = net.fetch.bind(net);
    const fixture = globalThis.titleAcceptance = { calls: [] };
    net.fetch = (url, init) => {
      const manual = String(url) === customUrl;
      if (!manual && !/^https:\/\/api\.stepfun\.ai\/step_plan\/v1\/chat\/completions$/.test(String(url))) return original(url, init);
      fixture.calls.push({ url, usesPlanKey: new Headers(init.headers).get('authorization') === 'Bearer isolated-title-fixture-only',
        usesManualKey: new Headers(init.headers).get('authorization') === 'Bearer isolated-manual-title-key',
        body: JSON.parse(init.body) });
      if (fixture.fail) return Promise.resolve(new Response('private-fixture-response', { status: 403 }));
      return new Promise(resolveResponse => {
        fixture.finish = () => resolveResponse(Response.json(manual ? { status: 'completed',
          output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Explain automatic titles' }] }],
        } : { choices: [{ finish_reason: 'stop', message: { content: 'Explain automatic titles' } }] }));
      });
    };
  }, manualUrl);
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
    model => model.provider === 'fixture-third-party' && model.id === 'fixture-chat'), 'the empty third-party composer');
  const created = await page.evaluate(id => window.desktop.createDraftSession(id), draft.draftId);
  assert.equal(created.state.model.provider, 'fixture-third-party');
  assert.equal(created.state.model.id, 'fixture-chat');
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
  assert.equal(calls[0].usesPlanKey, true);
  assert.equal(calls[0].url, 'https://api.stepfun.ai/step_plan/v1/chat/completions');
  assert.equal(calls[0].body.model, 'step-3.5-flash-2603');
  assert.equal(calls[0].body.max_tokens, 512);
  assert.deepEqual(calls[0].body.messages[1], { role: 'user', content: message });
  const after = await waitForSessionFixtureSnapshot(page, snapshot => snapshot.state.sessionName === 'Explain automatic titles',
    'the automatic title');
  assert.equal(after.state.model.provider, 'fixture-third-party');
  assert.equal(after.state.model.id, 'fixture-chat');
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
  await page.locator('.sidebar-settings').click();
  const settings = page.locator('.settings-dialog');
  const search = settings.getByRole('searchbox');
  await search.fill('会话标题模型');
  await search.press('Enter');
  const titleModel = settings.getByRole('combobox', { name: '会话标题模型' });
  await titleModel.waitFor();
  assert.equal(await titleModel.evaluate(element => element === document.activeElement), true);
  assert.equal(await titleModel.inputValue(), '');
  const manualValue = JSON.stringify([manual.provider, manual.id]);
  await titleModel.selectOption(manualValue);
  await page.waitForFunction(async model => JSON.stringify((await window.desktop.snapshot()).preferences.sessionTitleModel) === JSON.stringify(model), manual);
  assert.deepEqual(JSON.parse(await readFile(join(profile, 'preferences.json'), 'utf8')).sessionTitleModel, manual);
  assert.equal(await titleModel.inputValue(), manualValue);
  assert.equal(await titleModel.evaluate(element => element === document.activeElement), true);
  assert.deepEqual(await page.evaluate(() => window.desktop.preferences({ sessionTitleModel: { provider: 'step', id: 'fake' } })
    .then(() => 'accepted', () => 'rejected')), 'rejected');
  const toggle = settings.getByRole('switch', { name: '自动生成会话标题' });
  await toggle.uncheck();
  await page.waitForFunction(async () => (await window.desktop.snapshot()).preferences.autoGenerateSessionTitles === false);
  assert.equal(await titleModel.isDisabled(), true);
  assert.equal(await titleModel.inputValue(), manualValue);
  await toggle.check();
  await page.waitForFunction(async () => (await window.desktop.snapshot()).preferences.autoGenerateSessionTitles === true);
  await titleModel.focus();
  await titleModel.evaluate(element => element.scrollIntoView({ block: 'center' }));
  await mkdir('test-results', { recursive: true });
  await page.screenshot({ path: 'test-results/settings-session-title-model.png' });
  await settings.getByRole('button', { name: '关闭', exact: true }).click();
  await settings.waitFor({ state: 'hidden' });
  await page.locator('.new-chat').click();
  const reducedDraft = await waitForSessionFixtureSnapshot(page, snapshot => Boolean(snapshot.draftId), 'the second proposal');
  const reduced = await page.evaluate(id => window.desktop.createDraftSession(id), reducedDraft.draftId);
  await waitForSessionFixtureTools(page, reduced.runtimeId);
  const reducedMessage = 'Summarize without playing title motion';
  await page.evaluate(({ runtimeId, message }) => window.desktop.command('prompt', { message }, runtimeId),
    { runtimeId: reduced.runtimeId, message: reducedMessage });
  await titleBar.getByText(reducedMessage, { exact: true }).waitFor();
  const reducedCalls = await app.evaluate(() => {
    globalThis.titleAcceptance.finish?.();
    return globalThis.titleAcceptance.calls;
  });
  assert.equal(reducedCalls.length, 2);
  assert.equal(reducedCalls[1].url, manualUrl);
  assert.equal(reducedCalls[1].usesManualKey, true);
  assert.equal(reducedCalls[1].usesPlanKey, false);
  assert.equal(reducedCalls[1].body.model, manual.id);
  assert.equal(reducedCalls[1].body.input, reducedMessage);
  await titleBar.getByText('Explain automatic titles', { exact: true }).waitFor();
  assert.equal((await page.evaluate(() => window.desktop.snapshot())).state.model.id, 'fixture-chat');
  await page.evaluate(() => window.desktop.preferences({ sessionTitleModel: null }));
  assert.equal(await page.evaluate(() => globalThis.titleFades.length), 4, 'Reduced motion updates directly');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await sidebarTitle.click();
  await titleBar.getByText('Manually named', { exact: true }).waitFor();
  await page.locator(`[data-reorder-id="${reduced.state.sessionId}"] .session-title-text`).click();
  await titleBar.getByText('Explain automatic titles', { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => globalThis.titleFades.length), 4, 'Switching to an automatically named session never crossfades');

  await app.evaluate(() => { globalThis.titleAcceptance.fail = true; });
  await page.locator('.new-chat').click();
  const rejectedDraft = await waitForSessionFixtureSnapshot(page, snapshot => Boolean(snapshot.draftId), 'the diagnostic draft');
  const rejected = await page.evaluate(id => window.desktop.createDraftSession(id), rejectedDraft.draftId);
  await waitForSessionFixtureTools(page, rejected.runtimeId);
  const rejectedMessage = 'private-fixture-first-message';
  await page.evaluate(({ runtimeId, message }) => window.desktop.command('prompt', { message }, runtimeId),
    { runtimeId: rejected.runtimeId, message: rejectedMessage });
  await titleBar.getByText(rejectedMessage, { exact: true }).waitFor();
  const logs = join(profile, 'logs');
  let diagnostic;
  for (let i = 0; i < 100 && !diagnostic; i++) {
    const files = await readdir(logs).catch(error => { if (error.code === 'ENOENT') return []; throw error; });
    for (const file of files.filter(name => name.endsWith('.log'))) {
      const log = await readFile(join(logs, file), 'utf8');
      if (log.includes('kind: session-title\n')) { diagnostic = log; break; }
    }
    if (!diagnostic) await delay(50);
  }
  assert.ok(diagnostic, 'Failed Plan title requests leave a local diagnostic');
  assert.match(diagnostic, /^stage: response$/m);
  assert.match(diagnostic, /^reason: http-error$/m);
  assert.match(diagnostic, /^status: 403$/m);
  assert.match(diagnostic, /^billing: plan$/m);
  assert.doesNotMatch(diagnostic, /private-fixture-|isolated-title-fixture-only|api\.stepfun/);
  assert.equal(await app.evaluate(() => globalThis.titleAcceptance.calls.length), 3);
  console.log('Automatic session titles: Plan and explicit-provider routing, persistence, motion and private failure diagnostics passed.');
} catch (error) {
  console.error(error);
  throw error;
} finally {
  await closeDesktopFixtureAndWait(app);
}
