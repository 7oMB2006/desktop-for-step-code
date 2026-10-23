import assert from 'node:assert/strict';
import { _electron as electron } from 'playwright';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { closeDesktopFixture } from './close-desktop-fixture.mjs';

const profile = await realpath(await mkdtemp(join(tmpdir(), 'desktop-session-move-')));
const root = join(profile, 'step-runtime');
const origin = join(profile, 'brainstorm');
const projects = ['Project A', 'Project B', 'Unavailable'].map(name => join(profile, name));
for (const directory of [join(root, 'sessions'), origin, ...projects.slice(0, 2)])
  await mkdir(directory, { recursive: true });
await mkdir('test-results', { recursive: true });
await writeFile(join(origin, 'original.txt'), 'Never move this file\n');
const bytes = {};
for (const [id, cwd] of [['move-one', origin], ['move-two', projects[0]]]) {
  const timestamp = new Date().toISOString();
  bytes[id] = [
    { type: 'session', version: 3, id, cwd, timestamp },
    { type: 'message', id: 'user-1', parentId: null, timestamp,
      message: { role: 'user', content: 'Keep this brainstorm and implement it later.', timestamp: Date.now() } },
    { type: 'session_info', id: 'name-1', parentId: 'user-1', timestamp, name: id },
  ].map(entry => JSON.stringify(entry)).join('\n') + '\n';
  await writeFile(join(root, 'sessions', `${id}.jsonl`), bytes[id]);
}
const backgroundStamp = new Date().toISOString();
for (const status of ['running', 'queued']) {
  const id = status === 'running' ? 'move-background' : 'move-background-queued';
  await writeFile(join(root, 'sessions', `${id}.jsonl`), [
    { type: 'session', version: 3, id, cwd: origin, timestamp: backgroundStamp },
    { type: 'message', id: 'bg-call', parentId: null, timestamp: backgroundStamp,
      message: { role: 'assistant', content: [{ type: 'toolCall', id: 'bg-tool', name: 'subagent',
        arguments: { agent: 'explore', task: 'Unsettled background work', run_in_background: true } }],
      provider: 'fixture', model: 'fixture', stopReason: 'toolUse', timestamp: Date.now() } },
    { type: 'message', id: 'bg-result', parentId: 'bg-call', timestamp: backgroundStamp,
      message: { role: 'toolResult', toolName: 'subagent', toolCallId: 'bg-tool', content: [{ type: 'text', text: 'Started' }],
        details: { agentId: 'move-lane', status, results: [] }, timestamp: Date.now() } },
  ].map(entry => JSON.stringify(entry)).join('\n') + '\n');
}
let commandId = 0;
let hold = false;
const responses = new Set();
const requests = [];
const chunk = (delta, finish_reason = null) => `data: ${JSON.stringify({
  id: 'move-fixture', object: 'chat.completion.chunk', model: 'fixture', created: 1,
  choices: [{ index: 0, delta, finish_reason }],
})}\n\n`;
const server = createServer(async (request, response) => {
  try {
    if (request.url?.endsWith('/models')) {
      response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ data: [{ id: 'fixture' }] }));
      return;
    }
    let body = '';
    for await (const part of request) body += part;
    const payload = JSON.parse(body);
    requests.push(payload);
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    const lastUser = payload.messages.findLastIndex(message => message.role === 'user');
    if (!payload.messages.slice(lastUser + 1).some(message => message.role === 'tool')) {
      if (hold) {
        responses.add(response);
        response.write(chunk({ role: 'assistant', content: 'Working in the isolated fixture.' }));
        response.on('close', () => responses.delete(response));
        return;
      }
      const tool = payload.tools.find(item => item.function.name === 'run_command');
      assert.ok(tool, 'native runtime must expose run_command');
      // Relative file output proves the actual tool cwd, not just sidebar metadata.
      response.end(chunk({ role: 'assistant', tool_calls: [{ index: 0, id: `cwd-${++commandId}`, type: 'function',
        function: { name: tool.function.name, arguments: JSON.stringify({
          command: 'node -e "require(\'fs\').writeFileSync(\'moved-cwd.txt\', process.cwd())"',
        }) } }] }) + chunk({}, 'tool_calls') + 'data: [DONE]\n\n');
    } else {
      response.end(chunk({ role: 'assistant', content: 'Destination verified.' }) + chunk({}, 'stop') + 'data: [DONE]\n\n');
    }
  } catch (error) {
    console.error(error);
    if (!response.headersSent) response.writeHead(500);
    response.end();
  }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
await writeFile(join(profile, 'preferences.json'), JSON.stringify({
  theme: 'light', language: 'zh', workspaces: projects, sessionSort: 'updated',
}));
await writeFile(join(root, 'config.toml'), 'defaultProvider = "fixture"\ndefaultModel = "fixture"\npermissionPreset = "approve-for-me"\n[telemetry]\nenabled = false\n');
await writeFile(join(root, 'models.json'), JSON.stringify({ providers: { fixture: {
  baseUrl: `http://127.0.0.1:${server.address().port}/v1`, api: 'openai-completions', apiKey: 'local-move-only',
  models: [{ id: 'fixture', name: 'Move fixture', contextWindow: 32768, maxTokens: 2048 }],
} } }));
const env = { ...process.env, DESKTOP_TEST_USER_DATA: profile, DESKTOP_TEST_NO_FOCUS: '1' };
delete env.ELECTRON_RUN_AS_NODE;
let app;
const errors = [];
const launch = async () => {
  app = await electron.launch({ ...(process.env.DESKTOP_VERIFY_EXE ? { executablePath: process.env.DESKTOP_VERIFY_EXE }
    : { args: [resolve('.')] }), env, timeout: 60000 });
  const page = await app.firstWindow();
  page.on('pageerror', error => errors.push(error.message));
  await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    window.setOpacity(0); window.setIgnoreMouseEvents(true); window.showInactive(); window.setSize(1200, 900);
  });
  await page.waitForFunction(() => window.desktop && document.querySelector('.new-chat')?.disabled === false);
  return page;
};
const snapshot = page => page.evaluate(() => window.desktop.snapshot());
const row = (page, id) => page.locator(`.session-row[data-reorder-id="${id}"]`);
const project = (page, directory) => page.locator(`[data-session-workspace="${directory.replaceAll('\\', '\\\\')}"]`);
const waitSnapshot = async (page, predicate) => {
  for (let count = 0; count < 200; count++) {
    const value = await snapshot(page);
    if (predicate(value)) return value;
    await page.waitForTimeout(100);
  }
  throw new Error('Timed out waiting for native state');
};
try {
  let page = await launch();
  await row(page, 'move-one').locator('button').first().click();
  await page.waitForFunction(() => document.querySelector('.session-row.selected')?.dataset.reorderId === 'move-one' &&
    !document.querySelector('.composer-wrap.session-navigation-pending'));
  const before = await waitSnapshot(page, value => value.state?.sessionId === 'move-one');
  assert.equal(before.permissionPreset, 'approve-for-me');
  await page.evaluate(() => {
    window.moveGrant = window.desktop.command('set_permission_preset', { preset: 'full-access' });
  });
  await page.getByRole('dialog', { name: '启用完全访问？', exact: true })
    .getByRole('button', { name: '仅本会话启用', exact: true }).click();
  await page.evaluate(() => window.moveGrant);
  assert.equal((await snapshot(page)).permissionPreset, 'full-access');
  const loadedBytes = await readFile(join(root, 'sessions', 'move-one.jsonl'), 'utf8');
  await row(page, 'move-one').click({ button: 'right' });
  await page.getByRole('menuitem', { name: '移至项目…', exact: true }).click();
  const dialog = () => page.getByRole('dialog', { name: '移至项目', exact: true });
  await dialog().waitFor();
  assert.equal(await dialog().getByRole('button', { name: '确认移动', exact: true }).isEnabled(), false);
  assert.equal(await dialog().getByRole('button', { name: '取消', exact: true }).evaluate(element => element === document.activeElement), true);
  await dialog().getByRole('radio').first().check();
  await dialog().getByRole('button', { name: '确认移动', exact: true }).focus();
  await page.keyboard.press('Tab');
  assert.equal(await dialog().getByRole('button', { name: '关闭', exact: true }).evaluate(element => element === document.activeElement), true);
  await page.keyboard.press('Shift+Tab');
  assert.equal(await dialog().getByRole('button', { name: '确认移动', exact: true }).evaluate(element => element === document.activeElement), true);
  await page.screenshot({ path: 'test-results/session-move-light.png', animations: 'disabled' });
  await page.keyboard.press('Escape');
  await dialog().waitFor({ state: 'detached' });
  assert.deepEqual((await snapshot(page)).preferences.workspaceSessionRedirects, before.preferences.workspaceSessionRedirects);
  assert.equal(await readFile(join(root, 'sessions', 'move-one.jsonl'), 'utf8'), loadedBytes);
  console.log('Session move: cancellation preserves history and association');

  // Updated sorting still allows cross-project dragging, without manual reordering.
  const source = await row(page, 'move-one').boundingBox();
  const target = await project(page, projects[0]).locator('.workspace-heading').boundingBox();
  await page.mouse.move(source.x + 60, source.y + 16);
  await page.mouse.down();
  await page.waitForTimeout(340);
  await page.locator('.session-drag-preview').waitFor();
  await page.mouse.move(target.x + 60, target.y + target.height / 2, { steps: 8 });
  await project(page, projects[0]).locator('.workspace-heading').evaluate(element => {
    assertHighlighted(element);
    function assertHighlighted(element) {
      if (!element.parentElement.classList.contains('session-drop-target')) throw new Error('Destination not highlighted');
    }
  });
  await page.mouse.up();
  await dialog().waitFor();
  assert.equal(await dialog().getByRole('radio').first().isChecked(), true);
  for (const [theme, width] of [['dark', 1200], ['light', 560]]) {
    await page.evaluate(theme => window.desktop.preferences({ theme }), theme);
    await page.reload();
    // Reload deliberately discards unconfirmed movement.
    await page.waitForFunction(() => document.querySelector('.new-chat')?.disabled === false);
    await row(page, 'move-one').click({ button: 'right' });
    await page.getByRole('menuitem', { name: '移至项目…', exact: true }).click();
    await dialog().getByRole('radio').first().check();
    await app.evaluate(({ BrowserWindow }, width) => BrowserWindow.getAllWindows()[0].setSize(width, 900), width);
    assert.equal(await dialog().evaluate(element => element.scrollWidth <= element.clientWidth + 1), true);
    await page.screenshot({ path: `test-results/session-move-${theme}-${width}.png`, animations: 'disabled' });
    await page.keyboard.press('Escape');
  }
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1200, 900));
  await row(page, 'move-one').click({ button: 'right' });
  await page.getByRole('menuitem', { name: '移至项目…', exact: true }).click();
  await dialog().getByRole('radio').first().check();
  await dialog().getByRole('button', { name: '确认移动', exact: true }).click();
  await dialog().waitFor({ state: 'detached' });
  const moved = await snapshot(page);
  assert.equal(moved.state.sessionId, 'move-one');
  assert.equal(moved.state.sessionFile, before.state.sessionFile);
  assert.notEqual(moved.runtimeId, before.runtimeId, 'cwd change replaces the transport');
  assert.equal(moved.permissionPreset, 'ask');
  assert.equal(moved.sessions.find(session => session.id === 'move-one').cwd, projects[0]);
  assert.equal(moved.sessions.find(session => session.id === 'move-one').independent, false);
  assert.equal(moved.runtimes.filter(runtime => runtime.sessionId === 'move-one').length, 1);
  assert.ok((await readFile(join(root, 'sessions', 'move-one.jsonl'), 'utf8')).startsWith(bytes['move-one']));
  assert.equal(await readFile(join(origin, 'original.txt'), 'utf8'), 'Never move this file\n');
  await assert.rejects(readFile(join(projects[0], 'original.txt')), { code: 'ENOENT' });
  await assert.rejects(readFile(join(root, 'agent', 'trust.json')), { code: 'ENOENT' });
  assert.equal(requests.length, 0, 'movement never calls a model');
  console.log('Session move: native identity, history, cwd binding and permission reset');

  await page.reload();
  await page.waitForFunction(() => document.querySelector('.new-chat')?.disabled === false);
  await page.evaluate(() => window.desktop.command('prompt', { message: 'Verify destination' }));
  const approval = await waitSnapshot(page, value => value.requests?.length);
  await assert.rejects(page.evaluate(destination => window.desktop.moveSessionToProject('move-one', destination), projects[1]),
    /Stop|operation|pending|task/i);
  await page.evaluate(request => window.desktop.command('extension_ui_response', {
    id: request.id, ...(request.method === 'confirm' ? { confirmed: true } : { value: request.options?.[0] }),
  }), approval.requests[0]);
  await waitSnapshot(page, value => !value.state?.isStreaming && value.messages.some(message =>
    message.role === 'assistant' && JSON.stringify(message.content).includes('Destination verified.')));
  assert.equal(await readFile(join(projects[0], 'moved-cwd.txt'), 'utf8'), projects[0]);
  await assert.rejects(readFile(join(origin, 'moved-cwd.txt')), { code: 'ENOENT' });
  console.log('Session move: actual native command writes relative to destination, pending approval blocks moves');

  hold = true;
  await page.evaluate(() => window.desktop.command('prompt', { message: 'Keep running' }));
  await waitSnapshot(page, value => value.state?.isStreaming);
  await assert.rejects(page.evaluate(destination => window.desktop.moveSessionToProject('move-one', destination), projects[1]),
    /Stop|operation|pending|task/i);
  await page.evaluate(() => window.desktop.command('prompt', { message: 'Queued follow-up' }));
  await waitSnapshot(page, value => value.pendingMessages?.length);
  await page.evaluate(() => window.desktop.command('abort'));
  for (const response of responses) response.end(chunk({}, 'stop') + 'data: [DONE]\n\n');
  hold = false;
  await waitSnapshot(page, value => !value.state?.isStreaming && !value.requests?.length);
  await assert.rejects(page.evaluate(destination => window.desktop.moveSessionToProject('move-one', destination), projects[1]), /pending|queue/i);
  for (const message of (await snapshot(page)).pendingMessages)
    await page.evaluate(message => window.desktop.command('queue_remove', { id: message.id, version: message.version }), message);
  await assert.rejects(page.evaluate(destination => window.desktop.moveSessionToProject('move-one', destination), projects[2]), /unavailable|ENOENT|directory/i);
  assert.equal((await snapshot(page)).preferences.workspaceSessionRedirects['move-one'], projects[0]);
  console.log('Session move: busy and missing-directory rejection leave the original association intact');

  await page.evaluate(() => window.desktop.navigateSession('move-two'));
  const viewing = await snapshot(page);
  const background = await page.evaluate(destination => window.desktop.moveSessionToProject('move-one', destination), projects[1]);
  assert.equal(background.state.sessionId, 'move-two');
  assert.equal(background.runtimeId, viewing.runtimeId);
  assert.equal(background.preferences.workspace, projects[0]);
  assert.equal(background.preferences.workspaceSessionRedirects['move-one'], projects[1]);
  await closeDesktopFixture(app); app = undefined;
  page = await launch();
  const reopened = await page.evaluate(() => window.desktop.navigateSession('move-one'));
  assert.equal(reopened.state.sessionId, 'move-one');
  assert.equal(reopened.preferences.workspace, projects[1]);
  assert.equal(reopened.permissionPreset, 'ask');
  assert.equal(reopened.sessions.find(session => session.id === 'move-two').cwd, projects[0]);
  assert.ok(JSON.stringify(reopened.messages).includes('Keep this brainstorm'));
  const restarted = await page.evaluate(() => window.desktop.restart());
  assert.equal(restarted.permissionPreset, 'ask', 'explicit runtime restart keeps moved history gated');
  const tomorrow = new Date(Date.now() + 86400000);
  await page.evaluate(input => window.desktop.cronCreate(input), { runtimeId: restarted.runtimeId,
    cron: `0 9 ${tomorrow.getDate()} ${tomorrow.getMonth() + 1} *`, prompt: 'Move guard fixture', recurring: false, durable: false });
  await assert.rejects(page.evaluate(destination => window.desktop.moveSessionToProject('move-one', destination), projects[0]), /scheduled|Cron/i);
  const cron = await page.evaluate(() => window.desktop.cronList());
  const jobs = cron.tasks.filter(task => task.runtimeId === restarted.runtimeId);
  assert.ok(jobs.length);
  for (const job of jobs) await page.evaluate(({ runtimeId, jobId }) => window.desktop.cronDelete(runtimeId, jobId),
    { runtimeId: restarted.runtimeId, jobId: job.id });
  console.log('Session move: Full Access does not carry over; runtime restart and Cron host guard passed');
  await closeDesktopFixture(app); app = undefined;
  await mkdir(join(root, 'agent'), { recursive: true });
  await writeFile(join(root, 'agent', 'trust.json'), JSON.stringify({ [projects[0]]: true }));
  await mkdir(join(projects[0], '.stepcode', 'cron'), { recursive: true });
  await writeFile(join(projects[0], '.stepcode', 'cron', 'tasks.json'), JSON.stringify({
    schemaVersion: 1, id: 'move-guard', cron: `0 9 ${tomorrow.getDate()} ${tomorrow.getMonth() + 1} *`,
    prompt: 'Offline guard', recurring: false, durable: true, createdAt: Date.now(), nextFireAt: tomorrow.getTime(),
  }) + '\n');
  page = await launch();
  await assert.rejects(page.evaluate(destination => window.desktop.moveSessionToProject('move-one', destination), projects[0]), /scheduled/i);
  await assert.rejects(page.evaluate(destination => window.desktop.moveSessionToProject('move-two', destination), projects[1]), /scheduled/i);
  assert.equal((await snapshot(page)).runtimes.length, 0, 'saved Cron guards run before any candidate host starts');
  console.log('Session move: offline source/destination Cron guards do not start a scheduler');
  await writeFile(join(projects[0], '.stepcode', 'cron', 'tasks.json'), '');
  const draft = await snapshot(page);
  const coldMove = await page.evaluate(destination => window.desktop.moveSessionToProject('move-two', destination), projects[1]);
  assert.equal(coldMove.draftId, draft.draftId);
  assert.equal(coldMove.runtimeId, draft.runtimeId);
  assert.equal(coldMove.sessions.find(session => session.id === 'move-two').cwd, projects[1]);
  console.log('Session move: moving a cold conversation preserves the active draft');
  for (const id of ['move-background', 'move-background-queued']) {
    const beforeBlocked = await snapshot(page);
    assert.equal(beforeBlocked.runtimes.some(runtime => runtime.sessionId === id), false);
    await assert.rejects(page.evaluate(({ id, destination }) => window.desktop.moveSessionToProject(id, destination),
      { id, destination: projects[1] }), /background agents/);
    const afterBlocked = await snapshot(page);
    assert.deepEqual(afterBlocked.preferences.workspaceSessionRedirects, beforeBlocked.preferences.workspaceSessionRedirects);
    assert.equal(afterBlocked.draftId, beforeBlocked.draftId);
    assert.equal(afterBlocked.runtimeId, beforeBlocked.runtimeId);
    assert.equal(afterBlocked.runtimes.length, beforeBlocked.runtimes.length, 'failed cold move removes its candidate runtime');
  }
  console.log('Session move: cold running and queued background work blocks movement without changing the draft or association');
  const backgroundOwner = await page.evaluate(() => window.desktop.navigateSession('move-background'));
  assert.equal(backgroundOwner.state.isStreaming, false);
  await assert.rejects(page.evaluate(destination => window.desktop.moveSessionToProject('move-background', destination), projects[0]), /background agents/);
  console.log('Session move: unsettled structured background work blocks an otherwise idle owner');
  assert.deepEqual(errors, []);
  await writeFile('test-results/session-move.json', JSON.stringify({ profile, passed: true, modelRequests: requests.length }, null, 2));
  console.log('Session move: background movement preserves the viewed chat; relaunch preserves the new cwd and history');
} finally {
  for (const response of responses) response.destroy();
  if (app) await closeDesktopFixture(app);
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}
