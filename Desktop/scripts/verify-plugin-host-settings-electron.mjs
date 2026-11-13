import assert from 'node:assert/strict';
import { cp, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { mkdtemp } from './test-profile.mjs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron as electron } from 'playwright';
import { installationReceipt, packageFingerprint, writeReceipts } from '../electron/plugin-files.mjs';
import { closeDesktopFixtureAndWait } from './close-desktop-fixture.mjs';

const profile = await realpath(await mkdtemp(join(tmpdir(), 'dfsc-host-settings-electron-')));
const root = join(profile, 'step-runtime'), directory = join(root, 'plugins', 'host-example');
await mkdir(join(root, 'plugins'), { recursive: true });
await cp(resolve('../examples/plugins/sdk-host-starter/plugins/dfsc-host-example'), directory, { recursive: true });
const manifest = JSON.parse(await readFile(join(directory, 'step.plugin.json'), 'utf8'));
manifest.mcpServers.example.command = resolve('runtime/node', process.platform === 'win32' ? 'node.exe' : 'node');
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
await writeFile(join(root, 'config.toml'), 'defaultProvider = "fixture"\ndefaultModel = "fixture"\n[telemetry]\nenabled = false\n');
await writeFile(join(root, 'models.json'), JSON.stringify({ providers: { fixture: {
  api: 'openai-completions', baseUrl: 'http://127.0.0.1:1/v1', apiKey: 'fixture-unused',
  models: [{ id: 'fixture', name: 'Offline fixture', input: ['text'], contextWindow: 32768, maxTokens: 1024 }],
} } }));
await writeFile(join(profile, 'preferences.json'), JSON.stringify({ language: 'zh', theme: 'light', workspaces: [] }));
const env = { ...process.env, DESKTOP_TEST_USER_DATA: profile, DESKTOP_TEST_NO_FOCUS: '1' };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ args: ['.'], env, timeout: 60000 });
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
  assert.equal(first.runtime.status, 'no-session');
  await assert.rejects(page.evaluate(ref => window.desktop.pluginHostSettings({ ref, runtimeId: 'forged-runtime' }), first.ref), /invalid-input/);
  const saved = await page.evaluate(ref => window.desktop.pluginSaveHostSettings({ ref, revision: 'unconfigured', mode: 'follow' }), first.ref);
  assert.equal(saved.mode, 'follow');
  assert.equal(saved.independent.configured, false, 'Follow does not require or save a key');
  assert.ok(!(await page.evaluate(() => window.desktop.snapshot())).runtimeId, 'Reading and saving settings do not create a worker');
  const responses = await page.evaluate(async input => Promise.allSettled([
    window.desktop.pluginSaveHostSettings(input), window.desktop.pluginSaveHostSettings(input),
  ]), { ref: first.ref, revision: saved.revision, mode: 'follow' });
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
  const connected = await page.evaluate(ref => window.desktop.pluginHostSettings({ ref }), first.ref);
  assert.equal(connected.runtime.status, 'connected', 'Actual native SDK consumer starts in independent mode');
  assert.equal(connected.runtime.capabilities, undefined, 'Independent mode is not a host account grant');
  const switched = await page.evaluate(input => window.desktop.pluginSaveHostSettings(input),
    { ref: first.ref, revision: independent.revision, mode: 'follow' });
  assert.equal(switched.runtime.status, 'restart-required');
  const observed = await page.evaluate(ref => window.desktop.pluginHostSettings({ ref }), first.ref);
  assert.equal(observed.runtime.status, 'restart-required', 'Saving invalidates the existing consumer and does not renew it');
  assert.equal((await page.evaluate(() => window.desktop.snapshot())).runtimeId, snapshot.runtimeId, 'No automatic session replacement');
  assert.doesNotMatch(JSON.stringify([first, saved, current, independent, connected, switched, observed, snapshot]),
    /electron-private-independent-key|dfsc-launch-v1|DFSC_LAUNCH_CONTEXT|declarationHash|executionHash|"broker"|"token"/);
  assert.deepEqual(errors, []);
  console.log('Production Electron host settings passed: receipt-backed IPC projection, explicit source, concurrent gates, independent SDK startup and revocation. No real account/model invocation.');
} finally {
  await closeDesktopFixtureAndWait(app);
}
