import assert from 'node:assert/strict';
import { _electron as electron } from 'playwright';
import { createServer } from 'node:http';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { mkdtemp } from './test-profile.mjs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { prepareSessionFixture, waitForSessionFixtureSnapshot, waitForSessionFixtureTools } from './session-fixture.mjs';
import { closeDesktopFixtureAndWait } from './close-desktop-fixture.mjs';

const profile = await mkdtemp(join(tmpdir(), 'desktop-init-electron-'));
const root = join(profile, 'step-runtime');
await mkdir(root, { recursive: true });
const requests = [], failures = [];
let holdModel = false, heldResponse, releaseModel;
const server = createServer(async (request, response) => {
  try {
    let raw = '';
    for await (const chunk of request) raw += chunk;
    const body = JSON.parse(raw);
    requests.push(body);
    if (holdModel) await heldResponse;
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    response.end(`data: ${JSON.stringify({ id: `init-${requests.length}`, object: 'chat.completion.chunk', model: 'fixture',
      choices: [{ index: 0, delta: { content: 'RUNTIME INIT CHECK COMPLETE' }, finish_reason: 'stop' }],
    })}\n\ndata: [DONE]\n\n`);
  } catch (error) { failures.push(String(error)); response.writeHead(500); response.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
await writeFile(join(profile, 'preferences.json'), JSON.stringify({ language: 'zh', theme: 'light', workspaces: [] }));
await writeFile(join(root, 'config.toml'), 'defaultProvider = "fixture"\ndefaultModel = "fixture"\n[telemetry]\nenabled = false\n[mcp_servers.steppage__steppage]\nenabled = false\n');
await writeFile(join(root, 'models.json'), JSON.stringify({ providers: { fixture: {
  api: 'openai-completions', baseUrl: `http://127.0.0.1:${server.address().port}/v1`, apiKey: 'isolated-fixture',
  models: [{ id: 'fixture', name: 'Init IPC fixture', contextWindow: 100000, maxTokens: 2048 }],
} } }));
const env = { ...process.env, DESKTOP_TEST_USER_DATA: profile, DESKTOP_TEST_NO_FOCUS: '1' };
delete env.ELECTRON_RUN_AS_NODE;
let app;
try {
  app = await electron.launch({
    ...(process.env.DESKTOP_VERIFY_EXE ? { executablePath: process.env.DESKTOP_VERIFY_EXE } : { args: [resolve('.')] }),
    env, timeout: 60000,
  });
  const page = await app.firstWindow(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    window.setOpacity(0); window.setIgnoreMouseEvents(true); window.showInactive(); window.setSize(1300, 900);
  });
  await page.waitForFunction(() => Boolean(document.querySelector('.composer > .composer-input') &&
    !document.querySelector('.composer > .composer-input').disabled));
  const draft = await page.evaluate(() => window.desktop.snapshot());
  assert.ok(draft.draftId);
  assert.deepEqual(await page.evaluate(draftId => window.desktop.projectInstructions({ draftId }), draft.draftId),
    { mode: 'choose-project' });
  const draftInput = page.locator('.composer > .composer-input');
  await draftInput.fill('/init');
  await draftInput.press('End'); await draftInput.press('Backspace'); await draftInput.press('t');
  await page.getByRole('option', { name: /AI 工作规范.*请先选择项目文件夹/ }).waitFor();
  assert.equal(requests.length, 0, 'Draft command discovery starts no model turn');
  const snapshot = await prepareSessionFixture(page);
  await waitForSessionFixtureTools(page, snapshot.runtimeId);
  const owner = { runtimeId: snapshot.runtimeId, sessionId: snapshot.state.sessionId };
  assert.deepEqual(await page.evaluate(owner => window.desktop.projectInstructions(owner), owner), { mode: 'create' });
  assert.equal(requests.length, 0, 'Inspecting command state never requests a model');
  assert.equal(await page.evaluate(async owner => {
    try { await window.desktop.projectInstructions({ ...owner, sessionId: 'wrong' }); return false; }
    catch { return true; }
  }, owner), true);
  assert.equal(await page.evaluate(async () => {
    try { await window.desktop.projectInstructions({ draftId: 'wrong' }); return false; }
    catch { return true; }
  }), true);
  const input = page.locator('.composer > .composer-input');
  const openMenu = async () => {
    await input.fill('/init');
    await input.press('End'); await input.press('Backspace'); await input.press('t');
  };
  const send = async () => {
    const previous = await page.evaluate(async () => (await window.desktop.snapshot()).messages
      .filter(message => message.role === 'assistant' && JSON.stringify(message.content).includes('RUNTIME INIT CHECK COMPLETE')).length);
    await input.press('Escape');
    await page.locator('.composer-action-button').click();
    await waitForSessionFixtureSnapshot(page, state => {
      return state.messages.filter(message => message.role === 'assistant' &&
        JSON.stringify(message.content).includes('RUNTIME INIT CHECK COMPLETE')).length > previous && !state.state?.isStreaming;
    }, 'the submitted /init response and an idle session');
  };
  await openMenu();
  await page.getByRole('option', { name: /创建 AI 工作规范/ }).waitFor();
  await page.evaluate(id => window.desktop.command('set_launch_mode', { mode: 'goal', enabled: true }, id), owner.runtimeId);
  // The file appears after discovery: execution, not menu state, chooses review.
  const file = join(snapshot.preferences.workspace, 'AGENTS.md');
  const original = '# Human rules\nDo not overwrite user documents.\n';
  await writeFile(file, original);
  await send();
  assert.equal(requests.length, 1);
  assert.match(JSON.stringify(requests[0].messages.filter(message => message.role === 'system')), /Mode: review, read-only/);
  assert.deepEqual(requests[0].messages.findLast(message => message.role === 'user').content,
    [{ type: 'text', text: '/init' }]);
  assert.ok(!requests[0].tools.some(tool => ['write_file', 'run_command', 'subagent', 'desktop_create_project_instructions'].includes(tool.function.name)));
  assert.equal(await readFile(file, 'utf8'), original);
  const afterInit = await page.evaluate(() => window.desktop.snapshot());
  assert.equal(afterInit.launch.goalArmed, true, '/init does not consume an unrelated preselected Goal');
  assert.notEqual(afterInit.launch.goal?.status, 'active', '/init never starts a Goal');
  assert.equal(afterInit.sessions.find(session => session.id === owner.sessionId).firstMessage, '/init');
  await page.waitForFunction(() => document.querySelector('.window-session-title')?.textContent === '/init');
  await page.locator('.message.user').filter({ hasText: 'init' }).first().waitFor();
  assert.equal(await page.getByText('Desktop project AI instructions (/init).', { exact: true }).count(), 0,
    'Internal model instructions are not shown as the user message');
  await openMenu();
  await page.getByRole('option', { name: /检查 AI 工作规范/ }).waitFor();
  await mkdir('test-results/project-instructions', { recursive: true });
  await page.screenshot({ path: 'test-results/project-instructions/electron-review.png' });
  assert.equal(requests.length, 1, 'Reopening the menu performs no additional model turn');
  await input.press('Escape');
  await page.evaluate(id => window.desktop.command('set_launch_mode', { mode: 'goal', enabled: false }, id), owner.runtimeId);
  holdModel = true;
  heldResponse = new Promise(resolve => { releaseModel = resolve; });
  await page.evaluate(id => {
    window.initBusyTurn = window.desktop.command('prompt', { message: 'HOLD INIT QUEUE CHECK' }, id)
      .then(() => undefined, error => error.message);
  }, owner.runtimeId);
  await waitForSessionFixtureSnapshot(page, state => state.state?.isStreaming, 'the held model turn to start');
  const queued = await page.evaluate(id => window.desktop.command('prompt', { message: 'KEEP QUEUED MESSAGE' }, id), owner.runtimeId);
  assert.equal(queued.queued, true);
  const editError = await page.evaluate(async ({ runtimeId, queued }) => {
    try {
      await window.desktop.command('queue_edit', { id: queued.id, version: queued.version, message: '/init' }, runtimeId);
    } catch (error) { return error.message; }
  }, { runtimeId: owner.runtimeId, queued });
  assert.match(editError, /当前任务结束/);
  const pending = (await page.evaluate(() => window.desktop.snapshot())).pendingMessages;
  assert.equal(pending.find(item => item.id === queued.id).message, 'KEEP QUEUED MESSAGE');
  await page.evaluate(({ runtimeId, queued }) => window.desktop.command('queue_remove',
    { id: queued.id, version: queued.version }, runtimeId), { runtimeId: owner.runtimeId, queued });
  holdModel = false;
  releaseModel?.();
  await page.evaluate(() => window.initBusyTurn);
  await waitForSessionFixtureSnapshot(page, state => !state.state?.isStreaming, 'the held model turn to finish');
  assert.equal(await readFile(file, 'utf8'), original);
  await rm(file);
  await mkdir(file);
  const beforeReadFailure = requests.length;
  await input.fill('/init');
  await input.press('Escape');
  await page.locator('.composer-action-button').click();
  await page.getByRole('alert').filter({ hasText: /regular project file/ }).waitFor();
  await page.waitForFunction(() => document.querySelector('.composer > .composer-input')?.value === '/init');
  assert.equal(requests.length, beforeReadFailure, 'A failed execution read never reaches the model');
  await rm(file, { recursive: true });
  await writeFile(file, original);
  await page.locator('.app-error-banner button').click();
  await input.fill('/init');
  await send();
  await waitForSessionFixtureSnapshot(page, state => !state.state?.isStreaming, 'the retried /init turn to finish');
  assert.equal(requests.length, beforeReadFailure + 1, 'The user can retry after fixing an unreadable rule file');
  assert.equal(await readFile(file, 'utf8'), original);
  assert.deepEqual(errors, []);
  assert.deepEqual(failures, []);
  console.log(JSON.stringify({ passed: true, modelRequests: requests.length, staleMenuRechecked: true, profile }));
} finally {
  holdModel = false;
  releaseModel?.();
  try { if (app) await closeDesktopFixtureAndWait(app); }
  finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
}
