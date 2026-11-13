import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { access, cp, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { mkdtemp } from './test-profile.mjs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { _electron as electron } from 'playwright';
import { closeDesktopFixtureAndWait } from './close-desktop-fixture.mjs';
import { fixtureRuntimeChildren } from './fixture-runtime-children.mjs';
import { settleLayout } from './settle-layout.mjs';

const desktop = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const executionRoot = resolve(process.env.DESKTOP_VERIFY_ROOT ?? desktop);
const entry = process.env.DESKTOP_VERIFY_ENTRY;
if (entry) assert.ok(isAbsolute(entry), 'DESKTOP_VERIFY_ENTRY must be an absolute main.cjs path');
const output = resolve(process.env.DESKTOP_PLUGIN_UPDATE_OUTPUT ?? join(desktop, 'test-results/plugin-update-electron'));
await mkdir(output, { recursive: true });
const profile = await realpath(await mkdtemp(join(output, 'profile-')));
const root = join(profile, 'step-runtime');
const market = join(profile, 'update-market');
const id = 'dfsc-config-example', service = `${id}__notes`;
const name = 'DFSC Configuration Example', secret = 'isolated-update-private-key';
const node = join(executionRoot, 'runtime/node', process.platform === 'win32' ? 'node.exe' : 'node');
await access(node);
await cp(resolve(desktop, '../examples/plugins/config-starter'), market, { recursive: true, errorOnExist: true });
const packageRoot = join(market, 'plugins', id);
const originalManifest = JSON.parse(await readFile(join(packageRoot, 'step.plugin.json'), 'utf8'));
const originalSchema = JSON.parse(await readFile(join(packageRoot, 'dfsc.settings.json'), 'utf8'));
const manifestFor = version => ({
  ...originalManifest, version, description: `Isolated configuration update acceptance ${version}.`,
  mcpServers: { notes: { ...originalManifest.mcpServers.notes, command: node } },
});
const schemaFor = version => {
  const schema = structuredClone(originalSchema), fields = schema.groups[0].fields;
  fields.push({ id: 'key', label: 'Private key', type: 'secret', required: true });
  fields.push({ id: 'mode', label: 'Format', type: 'enum', default: 'brief',
    options: [{ value: 'brief', label: 'Brief' }] });
  if (version !== '0.1.0') {
    fields[0].label = 'Note prefix';
    fields.find(field => field.id === 'mode').options.push({ value: 'detailed', label: 'Detailed' });
    fields.push({ id: 'suffix', label: 'Optional suffix', type: 'text' });
  }
  if (['0.3.0', '0.4.0'].includes(version))
    fields.push({ id: 'audience', label: 'Optional audience', type: 'text' });
  if (version === '0.4.0') {
    fields[0].default = 'Changed default: ';
    fields.find(field => field.id === 'uppercase').type = 'text';
    fields.find(field => field.id === 'uppercase').default = '';
    const mode = fields.find(field => field.id === 'mode');
    mode.options = [{ value: 'detailed', label: 'Detailed' }];
    delete mode.default;
    fields.push({ id: 'required_note', label: 'Required note', type: 'text', required: true });
  }
  return schema;
};
const git = (...args) => execFileSync('git', ['-C', market, ...args],
  { encoding: 'utf8', timeout: 30000, windowsHide: true });
git('init', '--initial-branch=main');
const publish = async version => {
  await writeFile(join(packageRoot, 'step.plugin.json'), JSON.stringify(manifestFor(version)));
  await writeFile(join(packageRoot, 'dfsc.settings.json'), JSON.stringify(schemaFor(version)));
  git('add', '--all');
  git('-c', 'user.name=Desktop Fixture', '-c', 'user.email=fixture@example.invalid',
    'commit', '--quiet', '-m', `Publish isolated fixture ${version}`);
};
await publish('0.1.0');
await mkdir(join(root, 'plugins'), { recursive: true });
await writeFile(join(root, 'plugins/.stepcode-preinstalled'), '["steppage"]');
await writeFile(join(root, 'config.toml'),
  'defaultProvider = "fixture"\ndefaultModel = "fixture"\npermissionPreset = "ask"\n[telemetry]\nenabled = false\n');
await writeFile(join(profile, 'preferences.json'), JSON.stringify({
  language: 'en', theme: 'light', workspaces: [], autoCheckUpdates: false,
}));
const providerRequests = [];
const transport = createServer(async (request, response) => {
  providerRequests.push({ method: request.method, path: request.url });
  for await (const _chunk of request) {}
  response.writeHead(503, { 'content-type': 'application/json' });
  response.end(JSON.stringify({ error: { message: 'No provider request is permitted in update acceptance.' } }));
});
await new Promise(done => transport.listen(0, '127.0.0.1', done));
await writeFile(join(root, 'models.json'), JSON.stringify({ providers: { fixture: {
  api: 'openai-completions', baseUrl: `http://127.0.0.1:${transport.address().port}/v1`, apiKey: 'fixture-unused',
  models: [{ id: 'fixture', name: 'Offline update fixture', input: ['text'], contextWindow: 32768, maxTokens: 1024 }],
} } }));
const env = { ...process.env, DESKTOP_TEST_USER_DATA: profile, DESKTOP_TEST_NO_FOCUS: '1',
  DESKTOP_STEPPAGE_BUNDLE: join(profile, 'no-personal-steppage.mjs') };
for (const key of Object.keys(env)) if (/^(ELECTRON_RUN_AS_NODE|DESKTOP_DEV_URL|NODE_OPTIONS|STEP|PI_|AI_AGENT)/i.test(key)
  || /(?:API_KEY|ACCESS_TOKEN|AUTH_TOKEN|SECRET|PASSWORD|COOKIE)$/i.test(key)) delete env[key];

const checks = [], errors = [], screenshots = [];
const operations = [], historyTransitions = [];
let app, page, ownerPid, runtimeTransition, phase = 'launch', complete = false;
const mark = value => { phase = value; console.log(`Plugin update acceptance: ${value}`); };
const ipc = (method, input) => page.evaluate(({ method, input }) =>
  input === undefined ? window.desktop[method]() : window.desktop[method](input), { method, input });
const mutate = input => ipc('capabilityMutate', input);
const catalog = () => ipc('capabilityCatalog');
const snapshot = () => ipc('snapshot');
const plugin = async () => {
  const installed = (await catalog()).plugins.find(plugin => plugin.id === id);
  assert.ok(installed?.package?.ref, 'The receipt-backed installed package is projected');
  return installed;
};
const updateInput = async () => {
  const installed = await plugin();
  assert.equal(installed.update?.status, 'available');
  assert.ok(installed.update.ref);
  return { id, ref: installed.package.ref, candidate: installed.update.ref };
};
const until = async (read, accept, label) => {
  const deadline = Date.now() + 60000;
  do {
    assert.deepEqual(providerRequests, [], 'Session and MCP discovery must not call a provider');
    const value = await read();
    if (accept(value)) return value;
    await delay(100);
  } while (Date.now() < deadline);
  throw new Error(label);
};
const currentConfiguration = async () => ipc('pluginConfiguration', { ref: (await plugin()).package.ref });
const assertConfiguration = async version => {
  const installed = await plugin(), configuration = await currentConfiguration();
  assert.equal(installed.version, version);
  assert.equal(configuration.configured, true);
  assert.deepEqual(configuration.values, { prefix: '', uppercase: false, limit: 160, mode: 'brief' });
  assert.equal(configuration.hasSecret.key, true);
  assert.doesNotMatch(JSON.stringify([installed, configuration]), new RegExp(secret));
  const receipts = JSON.parse(await readFile(join(root, 'desktop-plugins/installations.json'), 'utf8'));
  const receipt = receipts.installations.find(item => item.id === id);
  const binding = JSON.parse(await readFile(join(root, `desktop-plugins/bindings/${receipt.folder}.json`), 'utf8'));
  const saved = JSON.parse(await readFile(join(root,
    `desktop-plugins/settings/${receipt.instance}/${binding.revision}.json`), 'utf8'));
  assert.equal(saved.secrets.key === secret, true, 'The same private secret survives the binding migration');
  assert.deepEqual(saved.values, configuration.values, 'Optional added values are not silently populated');
  return { instance: receipt.instance, revision: binding.revision };
};
const mcpEnabled = async () => (await catalog()).mcp.find(server => server.name === service)?.enabled;
const identities = value => value.runtimes.map(runtime => ({
  runtimeId: runtime.runtimeId, sessionId: runtime.sessionId,
})).sort((a, b) => a.runtimeId.localeCompare(b.runtimeId));
const pids = () => fixtureRuntimeChildren(ownerPid).sort((a, b) => a - b);
const exists = pid => {
  try { process.kill(pid, 0); return true; } catch (error) { return error.code !== 'ESRCH'; }
};
const shot = async filename => {
  await settleLayout(page.getByRole('dialog', { name: 'Plugin update', exact: true }));
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false,
    `${filename}: the application does not overflow horizontally`);
  await page.screenshot({ path: join(output, filename), animations: 'disabled' });
  screenshots.push(filename);
};
const launch = async () => {
  app = await electron.launch({
    args: [entry ?? executionRoot], cwd: executionRoot, env, timeout: 60000,
  });
  page = await app.firstWindow();
  page.on('pageerror', error => errors.push(error.message));
  page.setDefaultTimeout(30000);
  await app.evaluate(({ BrowserWindow, dialog }) => {
    const window = BrowserWindow.getAllWindows()[0];
    window.setOpacity(0); window.setIgnoreMouseEvents(true); window.showInactive(); window.setSize(1440, 960);
    dialog.showMessageBox = async () => ({ response: 1 });
  });
  ownerPid = await app.evaluate(() => process.pid);
  assert.equal(resolve(await app.evaluate(({ app }) => app.getPath('userData'))), resolve(profile));
  await page.waitForFunction(() => Boolean(window.desktop?.pluginUpdatePreflight));
  await page.getByRole('button', { name: 'Plugin marketplace', exact: true }).waitFor();
  assert.equal(await page.evaluate(() => typeof window.require), 'undefined');
};
const historyFixtures = ['background', 'foreground'].map(role => ({
  id: `update-${role}-history`, cwd: join(profile, 'workspaces/independent', `update-${role}-history`),
  name: `${role === 'background' ? 'Background' : 'Foreground'} update history`,
  text: `Persisted offline ${role} history retained across plugin update.`,
}));
const writeHistoryFixtures = async () => {
  await mkdir(join(root, 'sessions'), { recursive: true });
  for (const fixture of historyFixtures) {
    await mkdir(fixture.cwd, { recursive: true });
    const timestamp = new Date().toISOString();
    const lines = [
      { type: 'session', version: 3, id: fixture.id, cwd: fixture.cwd, timestamp },
      { type: 'message', id: `${fixture.id}-user`, parentId: null, timestamp, message: {
        role: 'user', timestamp: Date.now(), content: fixture.text,
      } },
      { type: 'message', id: `${fixture.id}-assistant`, parentId: `${fixture.id}-user`, timestamp, message: {
        role: 'assistant', timestamp: Date.now() + 1, content: [{ type: 'text', text: `Offline fixture: ${fixture.text}` }],
        stopReason: 'stop', usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: { total: 0 } },
      } },
      { type: 'session_info', id: `${fixture.id}-name`, parentId: `${fixture.id}-assistant`, timestamp, name: fixture.name },
    ];
    await writeFile(join(root, 'sessions', `${fixture.id}.jsonl`), lines.map(line => JSON.stringify(line)).join('\n') + '\n');
  }
};
const historyEntries = async fixture => (await readFile(join(root, 'sessions', `${fixture.id}.jsonl`), 'utf8'))
  .trim().split('\n').map(line => {
    const entry = JSON.parse(line);
    return { type: entry.type, id: entry.id, parentId: entry.parentId, customType: entry.customType,
      thinkingLevel: entry.thinkingLevel, role: entry.message?.role };
  });
try {
  await launch();
  assert.ok(!(await snapshot()).runtimeId, 'The isolated profile starts without a session runtime');

  mark('install and configure through the real preload');
  assert.deepEqual((await mutate({ action: 'marketplace-add', source: pathToFileURL(market).href })).warnings, []);
  const available = (await catalog()).available.find(plugin => plugin.name === id);
  assert.ok(available?.package?.ref);
  await mutate({ action: 'plugin-install', name: id, marketplace: available.marketplace, ref: available.package.ref });
  const initial = await currentConfiguration();
  await ipc('pluginSaveConfiguration', { ref: initial.ref, revision: initial.revision,
    values: { prefix: '', uppercase: false, limit: 160, mode: 'brief' },
    secrets: { key: { action: 'replace', value: secret } } });
  await mutate({ action: 'mcp-toggle', name: service, enabled: false });
  const baseline = await assertConfiguration('0.1.0');
  assert.equal(await mcpEnabled(), false);
  checks.push('old package installed and configured through receipt-backed native preload IPC');

  mark('ready update without runtime and disabled service preservation');
  await publish('0.2.0');
  await mutate({ action: 'plugin-check-updates' });
  const ready = await ipc('pluginUpdatePreflight', await updateInput());
  assert.equal(ready.readiness, 'ready');
  assert.equal(ready.status, 'compatible');
  assert.deepEqual(ready.sessions, []);
  assert.ok(!(await snapshot()).runtimeId);
  assert.equal((await plugin()).version, '0.1.0', 'Preflight never installs the candidate');
  const direct = await ipc('pluginUpdateApply', { token: ready.token, release: false });
  operations.push(direct);
  assert.equal(direct.id, ready.token);
  assert.equal(direct.phase, 'done');
  assert.equal(direct.installation, 'committed');
  assert.equal((await assertConfiguration('0.2.0')).instance, baseline.instance);
  assert.equal(await mcpEnabled(), false, 'An explicitly disabled plugin service remains disabled');
  assert.ok(!(await snapshot()).runtimeId, 'A ready update does not create a worker');
  checks.push('no-runtime ready apply preserves secret, false, empty string, enum choice, installation instance and disabled service');

  mark('real empty-session preview is blocked without interruption');
  await mutate({ action: 'mcp-toggle', name: service, enabled: true });
  await ipc('newIndependentSession');
  const empty = await until(snapshot, value => value.status === 'connected' && value.runtimeId && value.state?.sessionId,
    'The real empty isolated runtime did not connect');
  await until(() => ipc('summary', empty.runtimeId), value => value.mcp?.some(server =>
    server.name === service && server.status === 'connected'), 'The real empty-session MCP consumer did not connect');
  const emptyPids = pids();
  assert.equal(emptyPids.length, 1);
  await publish('0.3.0');
  await mutate({ action: 'plugin-check-updates' });
  const emptyPreview = await ipc('pluginUpdatePreflight', await updateInput());
  assert.equal(emptyPreview.status, 'compatible');
  assert.equal(emptyPreview.readiness, 'blocked');
  assert.ok(emptyPreview.blockers.includes('runtime-history-unavailable'));
  await assert.rejects(ipc('pluginUpdateApply', { token: emptyPreview.token, release: true }), /capability:operation-denied/);
  assert.deepEqual(pids(), emptyPids);
  assert.equal((await snapshot()).runtimeId, empty.runtimeId);
  assert.equal((await plugin()).version, '0.2.0');
  checks.push('a real unpersisted empty session is blocked during read-only preflight, without changing its PID or installed version');

  mark('load explicit persisted offline JSONL acceptance histories');
  await closeDesktopFixtureAndWait(app);
  app = undefined;
  await writeHistoryFixtures();
  await launch();
  for (const fixture of historyFixtures) {
    await ipc('navigateSession', fixture.id);
    const loaded = await until(snapshot, value => value.status === 'connected' && value.state?.sessionId === fixture.id,
      `The real ${fixture.id} runtime did not connect`);
    assert.ok(JSON.stringify(loaded.messages).includes(fixture.text), 'The explicit offline transcript is loaded by the real runtime');
  }
  const before = await snapshot();
  assert.equal(before.state.sessionId, historyFixtures[1].id);
  assert.equal(before.runtimes.length, 2);
  for (const runtime of before.runtimes)
    await until(() => ipc('summary', runtime.runtimeId), value => value.mcp?.some(server =>
      server.name === service && server.status === 'connected'), 'A real MCP consumer did not connect');
  assert.equal(before.state.model.provider, 'fixture');
  const beforePids = pids(), beforeIdentities = identities(before);
  runtimeTransition = { ownerPid, beforePids, identities: beforeIdentities,
    activeRuntimeId: before.runtimeId, activeSessionId: before.state.sessionId };
  assert.equal(beforePids.length, 2, 'Exactly the two isolated chat runtimes are owned by this fixture');
  assert.ok(before.runtimes.some(runtime => runtime.sessionId === historyFixtures[0].id));

  mark('read-only needs-release preview, native UI and cancel');
  const preview = await ipc('pluginUpdatePreflight', await updateInput());
  assert.equal(preview.status, 'compatible');
  assert.equal(preview.readiness, 'needs-release');
  assert.equal(preview.sessions.length, 2);
  assert.ok(preview.sessions.every(session => session.status === 'idle'));
  assert.deepEqual(preview.sessions.map(({ runtimeId, sessionId }) => ({ runtimeId, sessionId }))
    .sort((a, b) => a.runtimeId.localeCompare(b.runtimeId)), beforeIdentities);
  await page.getByRole('button', { name: 'Plugin marketplace', exact: true }).click();
  const center = page.getByRole('region', { name: 'Plugin center', exact: true });
  await center.getByRole('button', { name: `Update ${name} to v0.3.0`, exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Plugin update', exact: true });
  await dialog.getByText('Sessions need to release this plugin', { exact: true }).waitFor();
  assert.equal(await dialog.locator('.pc-update-sessions li').count(), 2);
  for (const [theme, width] of [['light', 1440], ['dark', 1440], ['dark', 640]]) {
    await ipc('preferences', { theme });
    await page.waitForFunction(theme => document.documentElement.dataset.theme === theme, theme);
    await app.evaluate(({ BrowserWindow }, width) => BrowserWindow.getAllWindows()[0].setSize(width, 960), width);
    await shot(`needs-release-${theme}-${width}.png`);
  }
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await dialog.waitFor({ state: 'hidden' });
  assert.equal((await plugin()).version, '0.2.0');
  assert.deepEqual(pids(), beforePids, 'Preflight and UI cancellation leave every process untouched');
  const cancelled = await snapshot();
  assert.equal(cancelled.runtimeId, before.runtimeId);
  assert.deepEqual(identities(cancelled), beforeIdentities);
  await assertConfiguration('0.2.0');
  checks.push('needs-release preview identifies both real idle consumers; native light/dark/narrow dialog and cancel are read-only');

  mark('release and restore real runtimes without changing active conversation');
  for (const fixture of historyFixtures)
    historyTransitions.push({ sessionId: fixture.id, before: await historyEntries(fixture) });
  const applied = await ipc('pluginUpdateApply', { token: preview.token, release: true });
  operations.push(applied);
  for (const [index, fixture] of historyFixtures.entries())
    historyTransitions[index].after = await historyEntries(fixture);
  assert.equal(applied.id, preview.token);
  assert.equal(applied.installation, 'committed', JSON.stringify(applied));
  assert.equal(applied.phase, 'done', JSON.stringify(applied));
  assert.ok(applied.sessions.every(session => session.restoration === 'restored'));
  await until(async () => beforePids.every(pid => !exists(pid)), Boolean, 'An old runtime process survived update release');
  const restored = await snapshot();
  assert.equal(restored.runtimeId, before.runtimeId, 'Restoring a background worker does not steal the active selection');
  assert.equal(restored.state.sessionId, before.state.sessionId);
  assert.ok(JSON.stringify(restored.messages).includes(historyFixtures[1].text));
  assert.deepEqual(identities(restored), beforeIdentities, 'All original session and runtime identities survive');
  const restoredPids = pids();
  runtimeTransition.restoredPids = restoredPids;
  assert.equal(restoredPids.length, 2);
  assert.ok(restoredPids.every(pid => !beforePids.includes(pid)));
  assert.equal((await assertConfiguration('0.3.0')).instance, baseline.instance);
  assert.equal(await mcpEnabled(), true);
  for (const runtime of restored.runtimes)
    await until(() => ipc('summary', runtime.runtimeId), value => value.mcp?.some(server =>
      server.name === service && server.status === 'connected'), 'A restored MCP consumer did not reconnect');
  for (const fixture of historyFixtures) {
    await ipc('navigateSession', fixture.id);
    const inspected = await snapshot();
    assert.ok(JSON.stringify(inspected.messages).includes(fixture.text), 'Both persisted transcripts remain available after restoration');
  }
  assert.equal((await snapshot()).runtimeId, before.runtimeId);
  checks.push('release apply terminates both old real worker PIDs, reconnects MCP and preserves foreground/background history, runtime and session IDs');

  mark('incompatible multi-change update remains blocked');
  await publish('0.4.0');
  await mutate({ action: 'plugin-check-updates' });
  const blocked = await ipc('pluginUpdatePreflight', await updateInput());
  assert.equal(blocked.readiness, 'blocked');
  assert.notEqual(blocked.status, 'compatible');
  for (const code of ['default-changed', 'type-changed', 'option-removed', 'input-required'])
    assert.ok(blocked.changes.some(change => change.code === code), `The preview retains the ${code} reason`);
  await assert.rejects(ipc('pluginUpdateApply', { token: blocked.token, release: true }), /capability:operation-denied/);
  assert.equal((await plugin()).version, '0.3.0');
  assert.deepEqual(pids(), restoredPids);
  await assertConfiguration('0.3.0');
  await ipc('preferences', { theme: 'light' });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1440, 960));
  await page.reload();
  await page.getByRole('button', { name: 'Plugin marketplace', exact: true }).click();
  await page.getByRole('region', { name: 'Plugin center', exact: true })
    .getByRole('button', { name: `Update ${name} to v0.4.0`, exact: true }).click();
  await page.getByRole('dialog', { name: 'Plugin update', exact: true }).waitFor();
  assert.equal(await page.getByRole('dialog', { name: 'Plugin update', exact: true })
    .getByRole('button', { name: 'Restart affected sessions and update', exact: true }).count(), 0);
  await shot('blocked-multiple-changes-light-1440.png');
  checks.push('incompatible default, type, enum removal and required-field changes are all reported; native apply is rejected without stopping a worker');
  assert.deepEqual(providerRequests, []);
  assert.deepEqual(errors, []);
  complete = true;
} catch (error) {
  await page?.screenshot({ path: join(output, 'failure.png'), animations: 'disabled' }).catch(() => {});
  throw error;
} finally {
  if (app) await closeDesktopFixtureAndWait(app);
  await new Promise(done => transport.close(done));
  await writeFile(join(output, 'acceptance.json'), JSON.stringify({
    complete, phase, entry: entry ?? executionRoot, executionRoot, profile,
    realMainAndPreload: true, realRenderer: true, realRuntime: true,
    providerRequests: providerRequests.length, checks, screenshots, pageErrors: errors,
    operations, runtimeTransition, historyTransitions,
    historyFixtures: historyFixtures.map(({ id, name }) => ({ id, name, kind: 'explicit-offline-jsonl-acceptance-fixture' })),
    scope: 'Isolated local Git marketplace and offline model fixture. No personal profile, real provider, public market or packaged installer acceptance.',
  }, null, 2) + '\n');
}
console.log(`Production Electron plugin update acceptance passed: ${checks.length} checks; zero provider requests.`);
console.log(output);
