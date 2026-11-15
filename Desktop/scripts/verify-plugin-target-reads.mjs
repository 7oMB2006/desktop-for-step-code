import assert from 'node:assert/strict';
import { lstat, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { _electron as electron } from 'playwright';
import { packageFingerprint, readReceipts, writeReceipts } from '../electron/plugin-files.mjs';
import { closeDesktopFixtureAndWait } from './close-desktop-fixture.mjs';
import { COLD_START_DESKTOP_TITLES, COLD_START_PLUGIN_IDS, createColdStartPluginFixture,
  treeInventory } from './session-plugin-cold-start-fixture.mjs';
import { mkdtemp, removeTestProfile } from './test-profile.mjs';

const output = resolve(process.env.DESKTOP_VERIFY_OUTPUT ?? 'test-results/plugin-target-reads');
const executablePath = process.env.DESKTOP_VERIFY_EXE && resolve(process.env.DESKTOP_VERIFY_EXE);
const resources = executablePath ? (process.platform === 'darwin'
  ? resolve(dirname(executablePath), '../Resources') : join(dirname(executablePath), 'resources')) : resolve('.');
const runtimePath = join(resources, 'runtime');
const baseline = process.env.DESKTOP_VERIFY_TARGET_BASELINE === '1';
const readTimeoutMs = 180000, targetReadLimitMs = 15000, fullCatalogTimeoutMs = 90000;
const results = { mode: executablePath ? 'package' : 'source', baseline,
  startedAt: new Date().toISOString(), applicationColdStart: true, fileSystemCacheControlled: false,
  syntheticModelOnly: true, timingClock: 'monotonic milliseconds per operation; fixture setup excluded',
  targetReadLimitMs, readTimeoutMs, fullCatalogTimeoutMs,
  harnessFullCatalogCallsBeforeTargetReads: 0, rendererAutomaticCallsInstrumented: false,
  uiFullCatalogPhase: 'only after all target reads and desktop workspace navigation',
  desktopMeasurement: 'real main-view navigation to visible document; no pluginDesktop preload API exists',
  pluginSettingsNavigationMeasurement: 'UI settings click to visible detail heading; not a capabilityCatalog API duration or full-catalog completion measurement',
  notes: [
    'pluginSettingsToEditableFormMs sums the recorded settings-to-detail navigation and config-tab-to-ready durations, including opening the independent configuration draft; it is not a catalog API measurement and has no additional performance gate.',
    'The large plugin has no saved secret: the empty password-field assertion covers an unconfigured form, not saved-secret redaction.',
  ],
  steps: [], errors: [], cleanupErrors: [] };
let profile, fixture, app, page, ownedElectronProcess;
const applicationLogs = [], privateValues = [resolve('..'), runtimePath, executablePath].filter(Boolean);
const redact = value => {
  let text = String(value);
  for (const secret of [...privateValues].sort((a, b) => b.length - a.length)) {
    text = text.split(secret).join('[private-path]');
    text = text.split(secret.replaceAll('\\', '/')).join('[private-path]');
    text = text.split(encodeURI(secret.replaceAll('\\', '/'))).join('[private-path]');
    text = text.split(secret.replaceAll('\\', '\\\\')).join('[private-path]');
  }
  return text.replaceAll('synthetic-cold-start-key', '[fixture-secret]')
    .replaceAll('local-demo-only', '[fixture-secret]');
};
const message = error => redact(error instanceof Error ? error.message : error);
await mkdir(output, { recursive: true });

async function timed(name, action, { gate = true, timeout = readTimeoutMs } = {}) {
  const step = { name, timeoutMs: timeout, performanceGate: gate };
  results.steps.push(step);
  const started = performance.now();
  let timer;
  try {
    const value = await Promise.race([Promise.resolve().then(action), new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${name} exceeded its ${timeout}ms read deadline`)), timeout);
    })]);
    step.elapsedMs = Math.round(performance.now() - started);
    step.passed = true;
    if (gate) step.withinTarget = step.elapsedMs < targetReadLimitMs;
    console.log(`${name}: ${step.elapsedMs}ms`);
    return value;
  } catch (error) {
    step.elapsedMs = Math.round(performance.now() - started);
    step.passed = false;
    step.failure = message(error);
    throw error;
  } finally { clearTimeout(timer); }
}

async function appendLargeConfiguration() {
  const id = COLD_START_PLUGIN_IDS.large;
  const installed = join(fixture.root, 'plugins', id);
  const marketplace = join(fixture.root, 'marketplaces', 'startup-synthetic-market', 'plugins', id);
  for (const directory of [installed, marketplace]) {
    const manifest = JSON.parse(await readFile(join(directory, 'step.plugin.json'), 'utf8'));
    manifest.mcpServers.tools.env = { ...manifest.mcpServers.tools.env,
      STEPFUN_API_KEY: 'DFSC_INDEPENDENT_PLUGIN' };
    await writeFile(join(directory, 'step.plugin.json'), JSON.stringify(manifest));
    await writeFile(join(directory, 'dfsc.host.json'), JSON.stringify({
      schemaVersion: 1, hostApiVersion: 1, consumer: { kind: 'mcp-stdio', server: 'tools' },
      capabilities: ['model.text'],
    }));
    await writeFile(join(directory, 'dfsc.settings.json'), JSON.stringify({
      schemaVersion: 1, consumer: { kind: 'json-file-v1', server: 'tools' },
      groups: [{ id: 'connection', title: 'Target fixture connection',
        fields: [{ id: 'key', label: 'Target fixture API Key', type: 'secret', required: true }] }],
    }));
  }
  const receipts = await readReceipts(fixture.root);
  const receipt = receipts.installations.find(item => item.id === id);
  assert.ok(receipt, 'The large installed package retains its original receipt');
  receipt.fingerprint = await packageFingerprint(installed);
  await writeReceipts(fixture.root, receipts);
  results.inventory = { ...fixture.inventory, installed: await treeInventory(installed),
    marketplace: await treeInventory(marketplace), largeHostAndConfigurationDeclarations: true };
  assert.equal(results.inventory.payloadFilesPerCopy, 3920, 'Both full dependency payloads remain present');
  assert.equal(results.inventory.copies, 2);
}

async function noRuntime(label) {
  const observation = await page.evaluate(async () => {
    const snapshot = await window.desktop.snapshot();
    return { activeRuntime: Boolean(snapshot.runtimeId), runtimeCount: snapshot.runtimes?.length ?? 0,
      startupTiming: Boolean(snapshot.runtimeStartupTiming), streaming: Boolean(snapshot.state?.isStreaming) };
  });
  assert.equal(observation.activeRuntime, false, `${label}: no active session runtime`);
  assert.equal(observation.runtimeCount, 0, `${label}: no resident session runtime`);
  assert.equal(observation.startupTiming, false, `${label}: no session startup timing`);
  assert.equal(observation.streaming, false, `${label}: no model stream`);
  return observation;
}

async function launchCount(path) {
  try { return (await readFile(path, 'utf8')).trim().split('\n').filter(Boolean).length; }
  catch (error) { if (error.code === 'ENOENT') return 0; throw error; }
}

async function assertNoRequestsOrSpawns() {
  if (!fixture) return;
  results.modelRequestCount = fixture.model.requests.length;
  results.largeServiceSpawnCount = await launchCount(fixture.largeLaunchLog);
  results.sdkServiceSpawnCount = await launchCount(fixture.sdkLaunchLog);
  assert.equal(results.modelRequestCount, 0, 'Plugin reads and navigation make no model requests');
  assert.equal(results.largeServiceSpawnCount, 0, 'The disabled large plugin never spawns');
  assert.equal(results.sdkServiceSpawnCount, 0, 'No session runtime attaches the configured SDK');
}

try {
  profile = await realpath(await mkdtemp(join(tmpdir(), 'dfsc-plugin-target-reads-')));
  privateValues.push(profile);
  const setupStarted = performance.now();
  const runtime = await realpath(runtimePath);
  privateValues.push(runtime);
  const node = join(runtime, 'node', process.platform === 'win32' ? 'node.exe' : 'node');
  fixture = await createColdStartPluginFixture(profile, node);
  await appendLargeConfiguration();
  results.fixtureSetupMs = Math.round(performance.now() - setupStarted);
  const env = { ...process.env, DESKTOP_TEST_USER_DATA: profile, DESKTOP_TEST_NO_FOCUS: '1' };
  delete env.ELECTRON_RUN_AS_NODE;
  const launched = performance.now();
  app = await electron.launch({ ...(executablePath ? { executablePath } : {}),
    args: [...(executablePath ? [] : [resolve('.')]), '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding', '--disable-features=CalculateNativeWinOcclusion'], env, timeout: 90000 });
  ownedElectronProcess = app.process();
  results.ownedElectronPid = ownedElectronProcess.pid;
  ownedElectronProcess.stdout?.on('data', value => applicationLogs.push(value.toString()));
  ownedElectronProcess.stderr?.on('data', value => applicationLogs.push(value.toString()));
  page = await app.firstWindow();
  page.setDefaultTimeout(readTimeoutMs);
  page.on('pageerror', error => results.errors.push(message(error)));
  await page.waitForLoadState('domcontentloaded');
  await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    window.setOpacity(0); window.setIgnoreMouseEvents(true); window.showInactive(); window.setSize(1440, 960);
  });
  await page.getByRole('button', { name: '\u65b0\u5efa\u4f1a\u8bdd', exact: true }).waitFor({ state: 'visible' });
  results.mainWindowReadyObservedMs = Math.round(performance.now() - launched);
  results.runtimeBeforeReads = await noRuntime('Before target reads');

  const ref = await timed('desktopCatalogMenu', () => page.evaluate(async id => {
    const catalog = await window.desktop.pluginDesktopCatalog();
    const plugin = catalog.plugins.find(item => item.id === id);
    if (!plugin?.package?.ref || !plugin.package.desktop || !plugin.package.configurationAvailable
      || !plugin.package.hostSettingsAvailable || catalog.available.length !== 0)
      throw new Error('Large installed desktop menu entry lacks its bounded declarations');
    return plugin.package.ref;
  }, COLD_START_PLUGIN_IDS.large));
  await timed('pluginHostSettings', async () => {
    const value = await page.evaluate(ref => window.desktop.pluginHostSettings({ ref }), ref);
    assert.equal(value.consumer, 'tools');
    assert.equal(value.runtime.status, 'disabled', 'The exact large-package service is disabled');
    assert.equal(value.mode, null, 'Reading does not select or authorize a model source');
    assert.equal(value.independent?.schema.consumer.server, 'tools');
    results.hostSettings = { consumer: value.consumer, mode: value.mode, runtime: value.runtime.status,
      independentAvailable: Boolean(value.independent) };
  });
  await timed('pluginConfiguration', async () => {
    const value = await page.evaluate(ref => window.desktop.pluginConfiguration({ ref }), ref);
    assert.equal(value.schema.consumer.server, 'tools');
    assert.equal(value.configured, false);
    assert.equal(value.hasSecret.key, false);
    assert.equal(value.schema.groups[0].fields[0].type, 'secret');
    results.configuration = { configured: value.configured, consumer: value.schema.consumer.server,
      secretPresent: value.hasSecret.key };
  });
  await timed('pluginDocument', async () => {
    const value = await page.evaluate(ref => window.desktop.pluginDocument({ ref, path: 'docs/start.md' }), ref);
    assert.equal(value.path, 'docs/start.md');
    assert.match(value.text, /^# Startup dependency tools/u);
    results.document = { document: 'docs/start.md', characterCount: value.text.length };
  });
  await timed('desktopNavigationToVisibleDocument', async () => {
    const title = COLD_START_DESKTOP_TITLES.large;
    const action = page.getByRole('button', { name: title, exact: true });
    if (await action.isVisible()) await action.click();
    else {
      await page.getByRole('button', { name: '\u66f4\u591a\u63d2\u4ef6', exact: true }).click();
      await page.getByRole('menuitemradio', { name: title, exact: true }).click();
    }
    const workspace = page.locator(`[data-plugin-workspace="${COLD_START_PLUGIN_IDS.large}"]`);
    await workspace.getByRole('tabpanel').getByRole('heading', { name: title, exact: true }).waitFor({ state: 'visible' });
    assert.equal(await workspace.getByRole('button', { name: '\u63d2\u4ef6\u8bbe\u7f6e', exact: true }).isVisible(), true);
  });
  await page.screenshot({ path: join(output, 'desktop-workspace.png') });
  results.runtimeAfterTargetReads = await noRuntime('After target reads and workspace navigation');

  // Enter the full center only after every target-only measurement is complete.
  await timed('pluginSettingsNavigationToDetail', async () => {
    const workspace = page.locator(`[data-plugin-workspace="${COLD_START_PLUGIN_IDS.large}"]`);
    await workspace.getByRole('button', { name: '\u63d2\u4ef6\u8bbe\u7f6e', exact: true }).click();
    await page.getByRole('region', { name: '\u63d2\u4ef6\u4e2d\u5fc3', exact: true })
      .getByRole('heading', { name: COLD_START_DESKTOP_TITLES.large, exact: true, level: 2 })
      .waitFor({ state: 'visible', timeout: fullCatalogTimeoutMs });
  }, { gate: false, timeout: fullCatalogTimeoutMs });
  await timed('configTabToReadyMs', async () => {
    const center = page.getByRole('region', { name: '\u63d2\u4ef6\u4e2d\u5fc3', exact: true });
    const tab = center.getByRole('tab', { name: '\u914d\u7f6e', exact: true });
    results.configurationTabInitiallySelected = await tab.getAttribute('aria-selected') === 'true';
    if (!results.configurationTabInitiallySelected) await tab.click();
    const form = center.locator('.pc-host-form');
    await form.getByRole('heading', { name: '\u6a21\u578b\u6765\u6e90', exact: true }).waitFor({ state: 'visible' });
    await form.locator('.pc-host-runtime').filter({ hasText: '\u670d\u52a1\u5df2\u505c\u7528' }).waitFor({ state: 'visible' });
    const independent = form.getByRole('button', { name: '\u72ec\u7acb\u914d\u7f6e', exact: true });
    await independent.click();
    const input = form.getByLabel('Target fixture API Key', { exact: true });
    await input.waitFor({ state: 'visible' });
    assert.equal(await input.isEditable(), true, 'The real independent secret field is editable');
    assert.equal(await input.inputValue(), '', 'The unconfigured form has an empty secret field');
    assert.equal(await input.getAttribute('type'), 'password');
    results.realConfigurationForm = { visible: true, independentDraftOpened: true, editable: true,
      secretInputEmpty: true, saved: false, serviceDisabled: true };
  });
  results.pluginSettingsToEditableFormMs = results.steps.find(step => step.name === 'pluginSettingsNavigationToDetail').elapsedMs
    + results.steps.find(step => step.name === 'configTabToReadyMs').elapsedMs;
  await page.screenshot({ path: join(output, 'configuration-ready.png') });
  results.runtimeAfterConfigurationUi = await noRuntime('After the real configuration form');
  await assertNoRequestsOrSpawns();
  assert.deepEqual(results.errors, [], 'No renderer errors');
  results.functionalPassed = true;
  const slow = results.steps.filter(step => step.performanceGate && !step.withinTarget).map(step => step.name);
  results.performancePassed = slow.length === 0;
  results.slowTargetReads = slow;
  assert.ok(baseline || results.performancePassed, `Target read gate exceeded by: ${slow.join(', ')}`);
  results.passed = true;
} catch (error) {
  results.passed = false;
  results.failure = message(error);
  await page?.screenshot({ path: join(output, 'failure.png') }).catch(() => {});
} finally {
  try {
    if (app) {
      await closeDesktopFixtureAndWait(app);
      results.ownedElectronExitCode = ownedElectronProcess.exitCode;
      assert.equal(ownedElectronProcess.exitCode, 0, 'The owned Electron process exited cleanly');
    }
  } catch (error) { results.cleanupErrors.push(message(error)); }
  try {
    if (fixture) { await fixture.model.close(); results.loopbackServerClosed = true; }
  } catch (error) { results.cleanupErrors.push(message(error)); }
  try { await assertNoRequestsOrSpawns(); }
  catch (error) { results.cleanupErrors.push(message(error)); }
  try {
    if (profile) {
      await removeTestProfile(profile);
      if (process.env.DESKTOP_KEEP_TEST_PROFILES === '1') results.profileCleanup = 'retained-by-request';
      else {
        await assert.rejects(lstat(profile), { code: 'ENOENT' });
        results.profileCleanup = 'removed-and-verified';
      }
    }
  } catch (error) { results.cleanupErrors.push(message(error)); }
  if (results.cleanupErrors.length || results.errors.length) results.passed = false;
  results.finishedAt = new Date().toISOString();
  await writeFile(join(output, 'application.log'), redact(applicationLogs.join('')));
  await writeFile(join(output, 'results.json'), JSON.stringify(results, null, 2));
  if (!results.passed) {
    process.exitCode = 1;
    console.error(results.failure ?? (results.cleanupErrors.join('; ') || 'Target read verification failed'));
  } else console.log(`Plugin target reads passed${baseline ? ' (baseline records speed without enforcing the target gate)' : ''}.`);
}
