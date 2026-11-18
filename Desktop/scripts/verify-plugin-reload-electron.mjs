import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { access, cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { _electron as electron } from 'playwright';
import { mkdtemp } from './test-profile.mjs';
import { closeDesktopFixtureAndWait } from './close-desktop-fixture.mjs';
import { fixtureRuntimeChildren } from './fixture-runtime-children.mjs';
import { settleLayout } from './settle-layout.mjs';

const desktop = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const executablePath = process.env.DESKTOP_VERIFY_EXE;
const entry = process.env.DESKTOP_VERIFY_ENTRY;
assert.ok(!executablePath || isAbsolute(executablePath));
assert.ok(!entry || isAbsolute(entry));
assert.ok(!executablePath || !entry);
const executionRoot = resolve(process.env.DESKTOP_VERIFY_ROOT ?? (executablePath ? dirname(executablePath) : desktop));
const output = resolve(process.env.DESKTOP_PLUGIN_RELOAD_OUTPUT ?? join(desktop, 'test-results/plugin-reload-electron'));
const scratch = resolve(process.env.DESKTOP_TEST_SCRATCH ?? join(dirname(output), 'plugin-reload-scratch'));
await mkdir(output, { recursive: true });
await mkdir(scratch, { recursive: true });
const profile = await mkdtemp(join(scratch, 'profile-'));
const root = join(profile, 'step-runtime'), market = join(profile, 'market');
const id = 'dfsc-config-example', name = 'DFSC Configuration Example', service = `${id}__notes`;
const eventPath = join(profile, 'mcp-events.jsonl'), release = join(profile, 'release-call'), fail = join(profile, 'fail-connect');
const fixtureServer = join(desktop, 'scripts/fixture-plugin-reload-mcp.mjs');
const resources = executablePath ? (process.platform === 'darwin'
  ? resolve(dirname(executablePath), '../Resources') : join(dirname(executablePath), 'resources')) : executionRoot;
const node = join(resources, 'runtime/node', process.platform === 'win32' ? 'node.exe' : 'node');
await access(node);
await cp(resolve(desktop, '../examples/plugins/config-starter'), market, { recursive: true });
const manifestPath = join(market, 'plugins', id, 'step.plugin.json');
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
manifest.mcpServers.notes.command = node;
manifest.mcpServers.notes.args = [fixtureServer, 'target', eventPath, release, fail];
await writeFile(manifestPath, JSON.stringify(manifest));
const git = (...args) => execFileSync('git', ['-C', market, ...args], { windowsHide: true, stdio: 'pipe' });
git('init', '--initial-branch=main');
git('add', '--all');
git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-m', 'Isolated reload fixture');
await mkdir(join(root, 'plugins'), { recursive: true });
await mkdir(join(root, 'sessions'));
await writeFile(join(root, 'plugins/.stepcode-preinstalled'), '["steppage"]');
await writeFile(join(root, 'config.toml'), [
  'defaultProvider = "fixture"', 'defaultModel = "fixture"', 'permissionPreset = "ask"',
  '[telemetry]', 'enabled = false', '[mcp_servers.steppage__steppage]', 'enabled = false',
  '[mcp_servers.fixture_control]', `command = ${JSON.stringify(node)}`,
  `args = ${JSON.stringify([fixtureServer, 'control', eventPath, release, fail])}`,
].join('\n') + '\n');
await writeFile(join(profile, 'preferences.json'), JSON.stringify({
  language: 'en', theme: 'light', workspaces: [], autoCheckUpdates: false,
}));
const histories = ['background', 'foreground'].map(role => ({
  id: `reload-${role}`, name: `${role} reload fixture`,
  cwd: join(profile, 'workspaces/independent', `reload-${role}`),
  text: `Offline persisted ${role} history.`,
}));
for (const fixture of histories) {
  await mkdir(fixture.cwd, { recursive: true });
  const timestamp = new Date().toISOString();
  await writeFile(join(root, 'sessions', `${fixture.id}.jsonl`), [
    { type: 'session', version: 3, id: fixture.id, cwd: fixture.cwd, timestamp },
    { type: 'message', id: `${fixture.id}-user`, parentId: null, timestamp,
      message: { role: 'user', timestamp: Date.now(), content: fixture.text } },
    { type: 'message', id: `${fixture.id}-assistant`, parentId: `${fixture.id}-user`, timestamp,
      message: { role: 'assistant', timestamp: Date.now(), content: [{ type: 'text', text: fixture.text }],
        stopReason: 'stop', usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: { total: 0 } } } },
    { type: 'session_info', id: `${fixture.id}-name`, parentId: `${fixture.id}-assistant`, timestamp, name: fixture.name },
  ].map(value => JSON.stringify(value)).join('\n') + '\n');
}
let finishTask;
const requests = [], checks = [], errors = [], transitions = [];
const server = createServer(async (request, response) => {
  let body = '';
  for await (const part of request) body += part;
  const payload = JSON.parse(body);
  requests.push(payload);
  const chunk = (delta, finish_reason = null) => `data: ${JSON.stringify({
    id: 'reload-fixture', object: 'chat.completion.chunk', created: 1, model: 'fixture',
    choices: [{ index: 0, delta, finish_reason }],
  })}\n\n`;
  response.writeHead(200, { 'content-type': 'text/event-stream' });
  if (requests.length === 1) {
    response.write(chunk({ role: 'assistant', content: 'Controlled local task remains active.' }));
    finishTask = () => response.end(chunk({}, 'stop') + 'data: [DONE]\n\n');
  } else if (requests.length === 2) {
    const tool = payload.tools?.find(item => item.function.name === `${service}__format_note`);
    if (!tool) { response.end(chunk({ content: 'Target tool missing.' }, 'stop') + 'data: [DONE]\n\n'); return; }
    response.end(chunk({ role: 'assistant', tool_calls: [{ index: 0, id: 'reload-held-call', type: 'function',
      function: { name: tool.function.name, arguments: '{}' } }] }) + chunk({}, 'tool_calls') + 'data: [DONE]\n\n');
  } else response.end(chunk({ role: 'assistant', content: 'Agent loop completed.' }, 'stop') + 'data: [DONE]\n\n');
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
await writeFile(join(root, 'models.json'), JSON.stringify({ providers: { fixture: {
  api: 'openai-completions', baseUrl: `http://127.0.0.1:${server.address().port}/v1`, apiKey: 'synthetic',
  models: [{ id: 'fixture', name: 'Offline reload fixture', input: ['text'], contextWindow: 32768, maxTokens: 1024 }],
} } }));
const env = { ...process.env, DESKTOP_TEST_USER_DATA: profile, DESKTOP_TEST_NO_FOCUS: '1',
  DESKTOP_STEPPAGE_BUNDLE: join(profile, 'no-personal-steppage.mjs') };
for (const key of Object.keys(env)) if (/^(ELECTRON_RUN_AS_NODE|DESKTOP_DEV_URL|NODE_OPTIONS|STEP|PI_|AI_AGENT)/i.test(key)
  || /(?:API_KEY|ACCESS_TOKEN|AUTH_TOKEN|SECRET|PASSWORD|COOKIE)$/i.test(key)) delete env[key];
let app, page, ownerPid, phase = 'launch', complete = false;
const mark = value => { phase = value; console.log(`Plugin reload acceptance: ${value}`); };
const ipc = (method, input) => page.evaluate(({ method, input }) =>
  input === undefined ? window.desktop[method]() : window.desktop[method](input), { method, input });
const until = async (read, accept, label) => {
  const deadline = Date.now() + 60000;
  do {
    const value = await read();
    if (accept(value)) return value;
    await delay(100);
  } while (Date.now() < deadline);
  throw new Error(label);
};
const snapshot = () => ipc('snapshot');
const pids = () => fixtureRuntimeChildren(ownerPid).sort((a, b) => a - b);
const events = async () => (await readFile(eventPath, 'utf8').catch(() => '')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
const identities = value => value.runtimes.map(runtime => ({
  runtimeId: runtime.runtimeId, sessionId: runtime.sessionId,
})).sort((a, b) => a.runtimeId.localeCompare(b.runtimeId));
const installed = async () => (await ipc('capabilityCatalog')).plugins.find(plugin => plugin.id === id);
let target;
const state = () => target ? ipc('pluginReloadState', target) : Promise.resolve(null);
const navigate = async fixture => {
  await page.locator(`[data-reorder-id="${fixture.id}"] > button`).first().click();
  await until(snapshot, value => value.status === 'connected' && value.state?.sessionId === fixture.id,
    `Runtime ${fixture.id} did not load`);
  await page.getByText(fixture.text, { exact: true }).first().waitFor();
};
try {
  app = await electron.launch({ ...(executablePath ? { executablePath, args: [] } : { args: [entry ?? executionRoot] }),
    cwd: executionRoot, env, timeout: 60000 });
  page = await app.firstWindow();
  page.on('pageerror', error => errors.push(error.message));
  await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    window.setOpacity(0); window.setIgnoreMouseEvents(true); window.showInactive(); window.setSize(1440, 960);
  });
  ownerPid = await app.evaluate(() => process.pid);
  assert.equal(resolve(await app.evaluate(({ app }) => app.getPath('userData'))), resolve(profile));
  await page.waitForFunction(() => Boolean(window.desktop?.pluginReloadPreview));
  assert.equal(await page.evaluate(() => typeof window.require), 'undefined');
  await ipc('capabilityMutate', { action: 'marketplace-add', source: pathToFileURL(market).href });
  const available = (await ipc('capabilityCatalog')).available.find(plugin => plugin.name === id);
  assert.ok(available?.package?.ref);
  await ipc('capabilityMutate', { action: 'plugin-install', name: id, marketplace: available.marketplace, ref: available.package.ref });
  target = { id, ref: (await installed()).package.ref };
  const save = async prefix => {
    const config = await ipc('pluginConfiguration', { ref: target.ref });
    await ipc('pluginSaveConfiguration', { ref: target.ref, revision: config.revision,
      values: { prefix, uppercase: false, limit: 160 }, secrets: {} });
  };
  await save('Initial: ');
  for (const fixture of histories) await navigate(fixture);
  let before = await snapshot();
  for (const runtime of before.runtimes)
    await until(() => ipc('summary', runtime.runtimeId), value => value.mcp?.some(server =>
      server.name === service && server.status === 'connected'), 'MCP consumer did not connect');
  const initialPids = pids(), originalIdentities = identities(before);
  assert.equal(initialPids.length, 2);
  mark('read-only global preview and stale-consent refusal');
  const preview = await ipc('pluginReloadPreview', target);
  assert.equal(preview.mode, 'plugin-mcp');
  assert.equal(preview.sessions.length, 2);
  assert.ok(preview.sessions.every(item => item.phase === 'ready'), JSON.stringify(preview));
  assert.equal((await snapshot()).runtimeId, before.runtimeId);
  assert.deepEqual(pids(), initialPids);
  await save('Updated: ');
  await assert.rejects(ipc('pluginReloadApply', { token: preview.token, whenIdle: true }), /stale/);
  assert.deepEqual(pids(), initialPids);
  assert.equal(requests.length, 0);
  checks.push(phase);

  mark('reload changes only target subprocesses while unrelated model streaming continues');
  await navigate(histories[0]);
  await page.locator('.composer-input').fill('Run the controlled local reload task.');
  await page.locator('.composer-input').press('Enter');
  await until(snapshot, value => requests.length === 1 && value.state?.isStreaming, 'Synthetic task did not start');
  const initialEvents = (await events()).filter(item => item.event === 'initialize');
  assert.equal(initialEvents.filter(item => item.role === 'control').length, 2);
  assert.equal(initialEvents.filter(item => item.role === 'target').length, 2);
  await navigate(histories[1]);
  before = await snapshot();
  await page.getByRole('button', { name: 'Plugin marketplace', exact: true }).click();
  const trigger = page.getByRole('button', { name: `Reload ${name}`, exact: true });
  await trigger.click();
  const panel = page.locator('.pc-reload-dialog');
  assert.equal(await panel.count(), 0);
  const first = await until(state, value => value?.sessions.every(item => item.phase === 'applied'), 'Routine target reload did not finish');
  assert.equal(first.sessions.length, 2);
  const afterFirst = (await events()).filter(item => item.event === 'initialize');
  assert.deepEqual(afterFirst.filter(item => item.role === 'control'), initialEvents.filter(item => item.role === 'control'));
  assert.equal(afterFirst.filter(item => item.role === 'target').length, 4);
  assert.equal((await snapshot()).runtimes.find(item => item.sessionId === histories[0].id).status, 'running');
  assert.equal((await snapshot()).runtimeId, before.runtimeId);
  assert.deepEqual(pids(), initialPids);
  transitions.push({ workers: initialPids, initializedBefore: initialEvents, initializedAfter: afterFirst });
  finishTask();
  checks.push(phase);

  mark('pending target approval and the active call both hold only their own instance');
  await navigate(histories[0]);
  await until(snapshot, value => !value.state?.isStreaming, 'First synthetic turn did not settle');
  await page.locator('.composer-input').fill('Call the target MCP fixture and wait.');
  await page.locator('.composer-input').press('Enter');
  const approve = page.getByRole('button', { name: 'Approve this call', exact: true });
  await approve.waitFor();
  await ipc('pluginReloadStart', target);
  const partial = await until(state, value => value?.operationId !== first.operationId
    && value?.sessions.some(item => item.phase === 'applied'), 'Idle instance did not reload during target approval');
  assert.equal(partial.sessions.find(item => item.sessionId === histories[0].id).reason, 'occupied');
  await approve.click();
  await until(events, rows => rows.some(item => item.role === 'target' && item.event === 'call'), 'Approved target tool did not reach its original connection');
  assert.equal((await state()).sessions.find(item => item.sessionId === histories[0].id).reason, 'occupied');
  await navigate(histories[1]);
  await page.getByRole('button', { name: 'Plugin marketplace', exact: true }).click();
  assert.deepEqual(pids(), initialPids);
  await trigger.click();
  assert.equal((await state()).operationId, partial.operationId);
  await panel.locator('[data-phase=occupied].lc-ring-base').waitFor();
  assert.equal(await panel.locator('details').getAttribute('open'), null);
  await panel.locator('summary').click();
  await panel.getByText('Plugin in use', { exact: true }).waitFor();
  await settleLayout(panel);
  await page.screenshot({ path: join(output, 'occupied.png'), animations: 'disabled' });
  await panel.getByRole('button', { name: 'Close reload details', exact: true }).click();
  await trigger.click();
  await panel.getByRole('button', { name: 'Cancel waiting', exact: true }).click();
  const cancelled = await state();
  assert.equal(cancelled.sessions.find(item => item.sessionId === histories[0].id).phase, 'cancelled');
  assert.equal((await snapshot()).runtimes.find(item => item.sessionId === histories[0].id).status, 'running');
  checks.push(phase);

  mark('target reconnects after its active call drains, without changing either runtime');
  await panel.getByRole('button', { name: 'Close reload details', exact: true }).click();
  await trigger.click();
  await until(state, value => value?.operationId !== cancelled.operationId && value?.sessions.some(item => item.phase === 'applied'),
    'Second idle reload did not finish');
  const whileBusy = await state();
  assert.equal(whileBusy.sessions.find(item => item.sessionId === histories[0].id).reason, 'occupied');
  assert.equal(requests.length, 2);
  await writeFile(release, '');
  const done = await until(state, value => value?.sessions.every(item => item.phase === 'applied'),
    'Deferred busy runtime did not reload after the task completed');
  assert.equal(done.sessions.length, 2);
  assert.deepEqual(pids(), initialPids);
  assert.deepEqual(identities(await snapshot()), originalIdentities);
  assert.equal((await snapshot()).runtimeId, before.runtimeId);
  assert.equal((await snapshot()).state.sessionId, histories[1].id);
  transitions.push({ final: pids(), sessions: done.sessions });
  checks.push(phase);

  mark('failed reconnect removes only the target catalog and does not block sends');
  await writeFile(fail, '');
  await ipc('pluginReloadStart', target);
  const failed = await until(state, value => value?.operationId !== done.operationId && value?.sessions.every(item => item.phase === 'failed'), 'Target failure not reported');
  assert.deepEqual(pids(), initialPids);
  await navigate(histories[1]);
  await page.locator('.composer-input').fill('Verify normal work after optional reload failure.');
  await page.locator('.composer-input').press('Enter');
  await until(snapshot, value => requests.length >= 4 && !value.state?.isStreaming, 'Reload failure blocked normal work');
  assert.ok(!requests.at(-1).tools?.some(item => item.function.name === `${service}__format_note`));
  assert.ok(requests.at(-1).tools?.some(item => item.function.name === 'fixture_control__format_note'));
  await page.reload();
  await page.waitForFunction(() => Boolean(window.desktop?.pluginReloadState));
  assert.equal((await state()).operationId, failed.operationId);
  checks.push(phase);

  mark('session history and unrelated MCP processes remain intact');
  for (const runtime of (await snapshot()).runtimes)
    await until(() => ipc('summary', runtime.runtimeId), value => value.mcp?.some(server =>
      server.name === 'fixture_control' && server.status === 'connected'), 'Unrelated MCP consumer disconnected');
  assert.deepEqual((await events()).filter(item => item.event === 'initialize' && item.role === 'control'),
    initialEvents.filter(item => item.role === 'control'));
  for (const fixture of histories) {
    const history = await readFile(join(root, 'sessions', `${fixture.id}.jsonl`), 'utf8');
    assert.ok(history.includes(fixture.text));
  }
  assert.equal(requests.length, 4);
  assert.deepEqual(errors, []);
  checks.push(phase);
  complete = true;
} catch (error) {
  console.error(`Plugin reload acceptance failed at: ${phase}`);
  if (page) {
    console.error(await state().catch(() => null));
    console.error(await snapshot().then(value => ({ runtimeId: value.runtimeId, status: value.status,
      sessionId: value.state?.sessionId, streaming: value.state?.isStreaming,
      requests: requests.length, error: value.error })).catch(() => null));
    await page.screenshot({ path: join(output, 'failure.png'), animations: 'disabled' }).catch(() => {});
  }
  throw error;
} finally {
  try { if (app) await closeDesktopFixtureAndWait(app); }
  finally {
    server.closeAllConnections(); await new Promise(done => server.close(done));
    await writeFile(join(output, 'results.json'), JSON.stringify({
      complete, phase, checks, transitions, rendererErrors: errors, providerRequests: requests.length,
      realMainAndPreload: true, realRenderer: true, realRuntime: true,
      scope: 'Real in-place MCP reload with isolated Git plugin and synthetic provider. No personal profile, real account, public marketplace or installer acceptance.',
    }, null, 2) + '\n');
  }
}
console.log(`Plugin reload Electron acceptance passed: ${checks.length} checks, ${requests.length} synthetic provider request.`);
