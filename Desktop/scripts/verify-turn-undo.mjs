import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'node:http';

const chunk = (delta, finish_reason = null) => `data: ${JSON.stringify({
  id: 'undo-live-fixture', object: 'chat.completion.chunk', created: 1, model: 'fixture',
  choices: [{ index: 0, delta, finish_reason }],
})}\n\n`;
let finishLive;
const server = createServer(async (req, res) => {
  let body = '';
  for await (const part of req) body += part;
  const payload = JSON.parse(body);
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  const lastUser = payload.messages.filter(message => message.role === 'user').at(-1)?.content;
  const userText = typeof lastUser === 'string' ? lastUser : lastUser?.filter(part => part.type === 'text').map(part => part.text).join('\n');
  if (userText === 'KEEP-BUSY') { res.write(chunk({ role: 'assistant', content: 'Peer is running.' })); return; }
  const statusTools = payload.messages.slice(payload.messages.findLastIndex(message => message.role === 'user') + 1)
    .filter(message => message.role === 'tool').length;
  if (userText === 'Update the live file.' && statusTools) {
    res.write(chunk({ role: 'assistant', content: 'Live edit finished.' }));
    finishLive = () => res.end(chunk({}, 'stop') + 'data: [DONE]\n\n');
  } else if (statusTools && (userText !== 'FIXTURE-STATUS' || statusTools >= 2)) {
    res.end(chunk({ role: 'assistant', content: 'Live edit finished.' }) + chunk({}, 'stop') + 'data: [DONE]\n\n');
  } else {
    const tool = payload.tools.find(tool => ['edit', 'edit_file'].includes(tool.function.name));
    assert.ok(tool, 'real runtime must expose edit tool');
    const parameters = tool.function.parameters;
    const retry = userText === 'FIXTURE-RETRY';
    const status = userText === 'FIXTURE-STATUS';
    const path = retry ? 'src/retry.ts' : status ? 'src/status.ts' : 'live.ts';
    const oldText = retry ? 'export const retryLimit = 1;' : status ? (statusTools ? "'ready'" : "'idle'") : 'const value = 1;';
    const newText = retry ? 'export const retryLimit = 3;' : status ? (statusTools ? "'Ready'" : "'ready'") : 'const value = 2;';
    const id = retry ? 'fixture-retry' : status ? `fixture-status-${statusTools + 1}` : 'live-edit';
    const args = parameters.properties?.search
      ? { path, search: oldText, replace: newText }
      : { path, edits: [{ oldText, newText }] };
    res.end(chunk({ tool_calls: [{ index: 0, id, type: 'function', function: { name: tool.function.name,
      arguments: JSON.stringify(args) } }] })
      + chunk({}, 'tool_calls') + 'data: [DONE]\n\n');
  }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));

const profile = await mkdtemp(join(tmpdir(), 'step-undo-electron-'));
await writeFile(join(profile, 'preferences.json'), JSON.stringify({ theme: 'light', language: 'zh', workspaces: [] }));
await mkdir(join(profile, 'step-runtime', 'sessions'), { recursive: true });
await writeFile(join(profile, 'step-runtime', 'config.toml'), 'defaultProvider = "fixture"\ndefaultModel = "fixture"\npermissionPreset = "bypass"\n[telemetry]\nenabled = false\n');
await writeFile(join(profile, 'step-runtime', 'models.json'), JSON.stringify({
  providers: { fixture: { baseUrl: `http://127.0.0.1:${server.address().port}/v1`, api: 'openai-completions', apiKey: 'local-test-only',
    models: [{ id: 'fixture', name: 'Undo fixture', contextWindow: 32768, maxTokens: 1024 }] } },
}));
await mkdir('test-results', { recursive: true });
const env = { ...process.env, DESKTOP_TEST_USER_DATA: profile, DESKTOP_TEST_NO_FOCUS: '1' };
delete env.ELECTRON_RUN_AS_NODE;
const executablePath = process.env.DESKTOP_VERIFY_EXE;
const app = await electron.launch({ ...(executablePath ? { executablePath } : { args: [resolve('.')] }), env, timeout: 60000 });
try {
  const page = await app.firstWindow();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    window.setOpacity(0); window.setIgnoreMouseEvents(true); window.showInactive(); window.setSize(1320, 980);
  });
  await page.getByText('Step Code 已连接', { exact: true }).waitFor({ timeout: 60000 });
  await page.evaluate(() => { HTMLMediaElement.prototype.play = () => Promise.resolve(); });
  // Real upstream edit emits its persisted patch and agent_end capture hook.
  const live = await page.evaluate(() => window.desktop.snapshot());
  const livePath = join(live.preferences.workspace, 'live.ts');
  await writeFile(livePath, 'const value = 1;\n');
  await page.locator('.composer > textarea').fill('Update the live file.');
  await page.locator('.composer > textarea').press('Enter');
  await page.getByText('Live edit finished.', { exact: true }).waitFor({ timeout: 60000 });
  const chip = page.getByRole('button', { name: '查看运行中的变更', exact: true });
  await chip.waitFor();
  assert.equal(await chip.locator('.diff-added').getAttribute('data-count'), '1');
  const stripBefore = await page.locator('.composer-context-bar').boundingBox();
  const chipBox = await chip.boundingBox();
  assert.ok(Math.abs(chipBox.x + chipBox.width / 2 - stripBefore.x - stripBefore.width / 2) < 1);
  assert.equal(await page.locator('.response .turn-changes').count(), 0);
  await chip.click();
  const liveDialog = page.getByRole('dialog', { name: '运行中的变更', exact: true });
  await liveDialog.waitFor();
  assert.equal(await liveDialog.getByRole('button', { name: '撤销', exact: true }).count(), 0);
  assert.equal(await liveDialog.locator('button, .turn-diff').count(), 0, 'running list has no diff disclosure');
  assert.equal(await liveDialog.locator('.live-turn-files li').count(), 1);
  assert.ok((await liveDialog.innerText()).includes('live.ts'));
  await page.waitForTimeout(250);
  await page.screenshot({ path: 'test-results/turn-changes-live-light.png' });
  await page.keyboard.press('Escape');
  assert.equal(await chip.evaluate(element => document.activeElement === element), true);
  assert.ok(finishLive);
  finishLive();
  await chip.waitFor({ state: 'hidden' });
  assert.equal((await page.locator('.composer-context-bar').boundingBox()).height, stripBefore.height);
  const liveUndo = page.locator('.turn-changes').last().getByRole('button', { name: '撤销', exact: true });
  await liveUndo.waitFor();
  await page.waitForFunction(() => document.querySelector('.turn-undo-action')?.disabled === false);
  assert.equal(await readFile(livePath, 'utf8'), 'const value = 2;\n');
  await liveUndo.click();
  await page.getByRole('button', { name: '撤销变更', exact: true }).click();
  await page.getByRole('button', { name: '已撤销', exact: true }).waitFor();
  assert.equal(await readFile(livePath, 'utf8'), 'const value = 1;\n');
  // Test-only fixtures use actual RPC tools, never a production demo API.
  await page.locator('.sidebar-bottom > button').click();
  await page.getByRole('button', { name: '通用', exact: true }).click();
  assert.equal(await page.getByRole('button', { name: '创建变更与撤销示例', exact: true }).count(), 0);
  assert.equal(await page.evaluate(() => 'createChangeDemo' in window.desktop), false);
  await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click();
  async function fixtureSession() {
    const next = await page.evaluate(() => window.desktop.newIndependentSession());
    await mkdir(join(next.preferences.workspace, 'src'), { recursive: true });
    await writeFile(join(next.preferences.workspace, 'src/retry.ts'), 'export const retryLimit = 1;\n');
    await writeFile(join(next.preferences.workspace, 'src/status.ts'), "export function statusLabel() {\n  return 'idle';\n}\n");
    await page.reload();
    for (const [text, ids] of [['FIXTURE-RETRY', ['fixture-retry']], ['FIXTURE-STATUS', ['fixture-status-1', 'fixture-status-2']]]) {
      await page.locator('.composer > textarea').fill(text);
      await page.locator('.composer > textarea').press('Enter');
      await page.waitForFunction(async ({ runtimeId, ids }) => {
        try { return (await window.desktop.turnUndo(runtimeId, ids, 'status')).state === 'available'; } catch { return false; }
      }, { runtimeId: next.runtimeId, ids }, { timeout: 60000 });
    }
    await writeFile(join(next.preferences.workspace, 'src/retry.ts'), 'export const retryLimit = 5;\n');
    return page.evaluate(() => window.desktop.snapshot());
  }
  await fixtureSession();
  await page.locator('.turn-changes').nth(1).waitFor({ timeout: 60000 });
  const snapshot = await page.evaluate(() => window.desktop.snapshot());
  assert.ok(snapshot.preferences.workspace.startsWith(join(profile, 'workspaces', 'independent')));
  const file = join(snapshot.preferences.workspace, 'src/status.ts');
  const retry = join(snapshot.preferences.workspace, 'src/retry.ts');
  const original = JSON.stringify(snapshot.messages);
  const report = page.locator('.turn-changes').last();
  const history = page.locator('.turn-changes').first();
  await history.getByRole('button', { name: '无法撤销', exact: true }).waitFor();
  await history.getByRole('button', { name: '无法撤销', exact: true }).click();
  await page.getByRole('dialog', { name: '暂时无法撤销', exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: '撤销变更', exact: true }).count(), 0);
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  assert.equal(await readFile(retry, 'utf8'), 'export const retryLimit = 5;\n');
  const undo = report.getByRole('button', { name: '撤销', exact: true });
  await undo.waitFor();
  const buttonBox = await undo.boundingBox();
  const totalsBox = await report.locator('.turn-change-totals').boundingBox();
  assert.ok(buttonBox.x + buttonBox.width <= totalsBox.x, 'undo is left of total diff counts');
  assert.equal(await report.locator('.turn-change-row svg, .turn-changes-more svg').count(), 0);
  await report.getByRole('button', { name: '预览变更 src/status.ts', exact: true }).click();
  await report.evaluate(element => element.scrollIntoView({ block: 'center' }));
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'test-results/turn-undo-demo-light.png' });
  await undo.click();
  const dialog = page.getByRole('dialog', { name: '撤销本轮已记录变更？', exact: true });
  await dialog.waitFor();
  assert.equal(await page.evaluate(() => document.getElementById('root').inert), true);
  await page.waitForTimeout(250);
  assert.equal(await page.locator('.turn-undo-confirm').evaluate(element => getComputedStyle(element).color),
    await report.locator('.diff-removed').first().evaluate(element => getComputedStyle(element).color));
  await page.screenshot({ path: 'test-results/turn-undo-confirm-light.png' });
  await page.getByRole('button', { name: '取消', exact: true }).click();
  assert.equal(await page.evaluate(() => document.getElementById('root').inert), false);
  assert.equal(await undo.evaluate(element => document.activeElement === element), true);
  assert.ok((await readFile(file, 'utf8')).includes("'Ready'"));
  await undo.click();
  await dialog.waitFor();
  await page.waitForTimeout(250);
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'hidden' });
  // Change a file after the confirmation has opened: commit must reject it.
  await undo.click();
  await dialog.waitFor();
  await page.waitForTimeout(250);
  const after = await readFile(file, 'utf8');
  await writeFile(file, `${after}// later edit\n`);
  await page.getByRole('button', { name: '撤销变更', exact: true }).click();
  await page.getByRole('dialog', { name: '暂时无法撤销', exact: true }).waitFor();
  assert.equal(await readFile(file, 'utf8'), `${after}// later edit\n`);
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  // Restore only this test-owned file, then perform a real successful undo.
  await writeFile(file, after);
  await report.getByRole('button', { name: '无法撤销', exact: true }).click();
  await dialog.waitFor();
  await page.getByRole('button', { name: '撤销变更', exact: true }).click();
  await report.getByRole('button', { name: '已撤销', exact: true }).waitFor();
  assert.equal(await readFile(file, 'utf8'), "export function statusLabel() {\n  return 'idle';\n}\n");
  assert.equal(await readFile(retry, 'utf8'), 'export const retryLimit = 5;\n');
  assert.equal(JSON.stringify((await page.evaluate(() => window.desktop.snapshot())).messages), original);
  await page.screenshot({ path: 'test-results/turn-undo-completed.png' });
  await page.reload();
  await page.locator('.turn-changes').last().getByRole('button', { name: '已撤销', exact: true }).waitFor();
  // New test sessions are independent; theme/mobile confirmation.
  const next = await fixtureSession();
  await page.reload();
  await page.locator('.turn-changes').last().getByRole('button', { name: '撤销', exact: true }).waitFor();
  assert.notEqual(next.state.sessionId, snapshot.state.sessionId);
  await assert.rejects(page.evaluate(({ runtimeId }) =>
    window.desktop.turnUndo(runtimeId, ['fixture-status-1', 'fixture-status-2'], 'undo', 'forged'), { runtimeId: next.runtimeId }), /expired/);
  await assert.rejects(page.evaluate(({ runtimeId }) =>
    window.desktop.turnUndo(runtimeId, ['unknown'], 'prepare'), { runtimeId: next.runtimeId }), /not found/);
  await page.evaluate(({ runtimeId }) => window.desktop.command('set_permission_preset', { preset: 'read-only' }, runtimeId), { runtimeId: next.runtimeId });
  await assert.rejects(page.evaluate(({ runtimeId }) =>
    window.desktop.turnUndo(runtimeId, ['fixture-status-1', 'fixture-status-2'], 'prepare'), { runtimeId: next.runtimeId }), /Read-only/);
  await page.evaluate(({ runtimeId }) => window.desktop.command('set_permission_preset', { preset: 'bypass' }, runtimeId), { runtimeId: next.runtimeId });
  const peer = await page.evaluate(id => window.desktop.cloneSession(id), next.state.sessionId);
  await page.evaluate(id => window.desktop.switchSession(id), next.state.sessionId);
  await page.evaluate(({ runtimeId }) => { void window.desktop.command('prompt', { message: 'KEEP-BUSY' }, runtimeId).catch(() => {}); }, { runtimeId: peer.runtimeId });
  await page.waitForFunction(async runtimeId => (await window.desktop.snapshot()).runtimes.some(runtime =>
    runtime.runtimeId === runtimeId && runtime.status === 'running'), peer.runtimeId);
  const prepared = await page.evaluate(({ runtimeId }) =>
    window.desktop.turnUndo(runtimeId, ['fixture-status-1', 'fixture-status-2'], 'prepare'), { runtimeId: next.runtimeId });
  await assert.rejects(page.evaluate(({ runtimeId, token }) =>
    window.desktop.turnUndo(runtimeId, ['fixture-status-1', 'fixture-status-2'], 'undo', token),
    { runtimeId: next.runtimeId, token: prepared.token }), /Stop tasks/);
  assert.ok((await readFile(join(next.preferences.workspace, 'src/status.ts'), 'utf8')).includes("'Ready'"));
  await page.evaluate(({ runtimeId }) => window.desktop.command('abort', {}, runtimeId), { runtimeId: peer.runtimeId });
  await page.reload();
  await page.evaluate(() => window.desktop.preferences({ theme: 'dark' }));
  await page.reload();
  await page.locator('.turn-changes').last().getByRole('button', { name: '撤销', exact: true }).click();
  await dialog.waitFor();
  await page.waitForTimeout(250);
  assert.equal(await page.locator('.turn-undo-confirm').evaluate(element => getComputedStyle(element).color),
    await page.locator('.turn-changes').last().locator('.diff-removed').first().evaluate(element => getComputedStyle(element).color));
  await page.screenshot({ path: 'test-results/turn-undo-confirm-dark.png' });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(640, 850));
  await page.waitForTimeout(250);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.screenshot({ path: 'test-results/turn-undo-confirm-narrow.png' });
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await page.evaluate(() => window.desktop.preferences({ language: 'en' }));
  await page.reload();
  await page.locator('.turn-changes').last().getByRole('button', { name: 'Undo', exact: true }).click();
  await page.getByRole('dialog', { name: 'Undo recorded changes?', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  assert.deepEqual(errors, []);
  console.log('Turn undo passed: real RPC edits/live composer file list/agent_end capture, test-only fixture sessions, removed demo entry, exact button placement, confirmation/cancel/Escape/focus, conflict-before-write, repeated-edit restore, untouched conflicting file/history, persistent undo state, IPC identity/token/read-only rejection, same-workspace running-peer exclusion, light/dark/narrow/English. No paid model or real profile used.');
} finally { await app.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
