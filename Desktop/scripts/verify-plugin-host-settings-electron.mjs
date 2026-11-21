import assert from 'node:assert/strict';
import { cp, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { mkdtemp } from './test-profile.mjs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { _electron as electron } from 'playwright';
import { installationReceipt, packageFingerprint, writeReceipts } from '../electron/plugin-files.mjs';
import { closeDesktopFixtureAndWait } from './close-desktop-fixture.mjs';
import { restartIdleSessionFixture, waitForSessionFixtureSnapshot, waitForSessionFixtureTools } from './session-fixture.mjs';

const profile = await realpath(await mkdtemp(join(tmpdir(), 'dfsc-host-settings-electron-')));
const root = join(profile, 'step-runtime'), directory = join(root, 'plugins', 'host-example');
const executablePath = process.env.DESKTOP_VERIFY_EXE && resolve(process.env.DESKTOP_VERIFY_EXE);
const resources = executablePath ? (process.platform === 'darwin'
  ? resolve(dirname(executablePath), '../Resources') : join(dirname(executablePath), 'resources')) : resolve('.');
const runtime = join(resources, 'runtime');
await mkdir(join(root, 'plugins'), { recursive: true });
await cp(resolve('../examples/plugins/sdk-host-starter/plugins/dfsc-host-example'), directory, { recursive: true });
const manifest = JSON.parse(await readFile(join(directory, 'step.plugin.json'), 'utf8'));
manifest.mcpServers.example.command = join(runtime, 'node', process.platform === 'win32' ? 'node.exe' : 'node');
manifest.mcpServers.example.env = { STEPFUN_API_KEY: 'DFSC_INDEPENDENT_PLUGIN' };
await writeFile(join(directory, 'step.plugin.json'), JSON.stringify(manifest));
await writeFile(join(directory, 'dfsc.settings.json'), JSON.stringify({
  schemaVersion: 1, consumer: { kind: 'json-file-v1', server: 'example' },
  groups: [{ id: 'connection', title: 'Independent connection', fields: [
    { id: 'key', label: 'API Key', type: 'secret', required: true },
  ] }],
}));
const receipt = installationReceipt({ name: 'host-example' }, { name: 'local-fixture', kind: 'local', path: profile },
  manifest, await packageFingerprint(directory));
receipt.state = 'installed';
await writeReceipts(root, { version: 1, installations: [receipt] });
await writeFile(join(root, 'plugins', '.stepcode-preinstalled'), '["steppage"]');
await writeFile(join(root, 'auth.json'), JSON.stringify({ step: {
  type: 'oauth', access: 'offline-plugin-settings-account', profile: 'step_plan', expires: Date.now() + 3600000,
} }));
await writeFile(join(root, 'config.toml'), 'defaultProvider = "fixture"\ndefaultModel = "fixture"\n[telemetry]\nenabled = false\n[mcp_servers.steppage__steppage]\nenabled = false\n');
await writeFile(join(root, 'models.json'), JSON.stringify({ providers: { fixture: {
  api: 'openai-completions', baseUrl: 'http://127.0.0.1:1/v1', apiKey: 'fixture-unused',
  models: [{ id: 'fixture', name: 'Offline fixture', input: ['text'], contextWindow: 32768, maxTokens: 1024 }],
} } }));
await writeFile(join(profile, 'preferences.json'), JSON.stringify({ language: 'zh', theme: 'light', workspaces: [] }));
const env = { ...process.env, DESKTOP_TEST_USER_DATA: profile, DESKTOP_TEST_NO_FOCUS: '1' };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({
  ...(executablePath ? { executablePath } : { args: [resolve('.')] }), env, timeout: 60000,
});
const errors = [];
try {
  const page = await app.firstWindow();
  page.on('pageerror', error => errors.push(error.message));
  await page.getByRole('heading', { name: /^(让想法阶跃星辰|星辰因你而阶跃)$/ }).waitFor();
  const first = await page.evaluate(async () => {
    const catalog = await window.desktop.capabilityCatalog();
    const pkg = catalog.plugins.find(plugin => plugin.id === 'dfsc-host-example')?.package;
    if (!pkg?.hostSettingsAvailable) throw new Error('Host settings not projected');
    return window.desktop.pluginHostSettings({ ref: pkg.ref });
  });
  assert.equal(first.mode, null);
  assert.equal(first.runtime.status, 'unconfigured');
  await assert.rejects(page.evaluate(ref => window.desktop.pluginHostSettings({ ref, runtimeId: 'forged-runtime' }), first.ref), /invalid-input/);
  const account = { mode: 'account', accountTicket: first.account.ticket, models: { 'model.text': 'step-5-preview' } };
  const saved = await page.evaluate(input => window.desktop.pluginSaveHostSettings(input),
    { ref: first.ref, revision: 'unconfigured', ...account });
  assert.equal(saved.mode, 'account');
  assert.equal(saved.independent.configured, false, 'Broker mode does not require or save a key');
  assert.ok(!(await page.evaluate(() => window.desktop.snapshot())).runtimeId, 'Reading and saving settings do not create a worker');
  const responses = await page.evaluate(async input => Promise.allSettled([
    window.desktop.pluginSaveHostSettings(input), window.desktop.pluginSaveHostSettings(input),
  ]), { ref: first.ref, revision: saved.revision, ...account });
  assert.equal(responses.filter(item => item.status === 'fulfilled').length, 1, 'Shared IPC gate permits one concurrent writer');
  assert.equal(responses.filter(item => item.status === 'rejected').length, 1);
  const current = await page.evaluate(ref => window.desktop.pluginHostSettings({ ref }), first.ref);
  const independent = await page.evaluate(input => window.desktop.pluginSaveHostSettings(input), {
    ref: first.ref, revision: current.revision, mode: 'independent',
    configuration: { ref: first.ref, revision: current.independent.revision, values: {},
      secrets: { key: { action: 'replace', value: 'electron-private-independent-key' } } },
  });
  assert.equal(independent.configurationCurrent, true);
  assert.equal(independent.independent.hasSecret.key, true);
  await page.evaluate(() => window.desktop.newIndependentSession());
  const snapshot = await page.evaluate(() => window.desktop.snapshot());
  assert.ok(snapshot.runtimeId);
  await waitForSessionFixtureTools(page, snapshot.runtimeId);
  let connected;
  await waitForSessionFixtureSnapshot(page, async value => {
    assert.equal(value.runtimeId, snapshot.runtimeId);
    assert.equal(value.state?.sessionId, snapshot.state?.sessionId);
    connected = await page.evaluate(ref => window.desktop.pluginHostSettings({ ref }), first.ref);
    assert.equal(connected.mode, independent.mode);
    assert.equal(connected.revision, independent.revision);
    return connected.runtime.status === 'connected';
  }, 'the configured independent SDK consumer');
  assert.equal(connected.runtime.status, 'connected', 'Actual native SDK consumer starts in independent mode');
  assert.equal(connected.runtime.capabilities, undefined, 'Independent mode is not a host account grant');
  const switched = await page.evaluate(input => window.desktop.pluginSaveHostSettings(input),
    { ref: first.ref, revision: independent.revision, ...account });
  assert.equal(switched.runtime.status, 'restart-required');
  const observed = await page.evaluate(ref => window.desktop.pluginHostSettings({ ref }), first.ref);
  assert.equal(observed.runtime.status, 'restart-required', 'Saving invalidates the existing consumer and does not renew it');
  assert.equal((await page.evaluate(() => window.desktop.snapshot())).runtimeId, snapshot.runtimeId, 'No automatic session replacement');
  const paused = await page.evaluate(input => window.desktop.pluginSaveHostSettings(input),
    { ref: first.ref, revision: switched.revision, mode: 'paused' });
  assert.equal(paused.mode, 'paused');
  assert.deepEqual(paused.models, switched.models);
  assert.equal(paused.runtime.status, 'restart-required', 'A running independent consumer is not stopped by revoking Broker grants');
  await restartIdleSessionFixture(page, snapshot.runtimeId);
  const restarted = await page.evaluate(() => window.desktop.snapshot());
  await waitForSessionFixtureSnapshot(page, value => {
    assert.equal(value.runtimeId, restarted.runtimeId);
    const startup = value.state?.desktopStartup;
    if (startup?.discovery !== 'ready' || !startup.toolsSettledAt) return false;
    assert.equal(startup.cleanupConfirmed, true);
    const rejected = startup.tools.filter(tool => tool.status === 'failed');
    assert.equal(rejected.length, 1);
    assert.equal(rejected[0].hosted, true);
    return true;
  }, 'paused consumer rejected and startup settled');
  const stopped = await page.evaluate(ref => window.desktop.pluginHostSettings({ ref }), first.ref);
  assert.equal(stopped.runtime.status, 'source-paused');
  assert.equal(stopped.independent.hasSecret.key, true);
  assert.doesNotMatch(JSON.stringify([first, saved, current, independent, connected, switched, observed, snapshot, paused, stopped]),
    /electron-private-independent-key|offline-plugin-settings-account|dfsc-launch-v1|DFSC_LAUNCH_CONTEXT|declarationHash|executionHash|"broker"|"token"/);
  assert.deepEqual(errors, []);
  console.log('Production Electron host settings passed: explicit source, concurrent gates, independent SDK startup, paused restart, retained settings and no secret exposure. No real account/model invocation.');
} finally {
  await closeDesktopFixtureAndWait(app);
}
