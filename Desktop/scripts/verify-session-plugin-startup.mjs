import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { cp, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { _electron as electron } from 'playwright';
import { installationReceipt, packageFingerprint, writeReceipts } from '../electron/plugin-files.mjs';
import { closeDesktopFixtureAndWait } from './close-desktop-fixture.mjs';
import { queueFixture } from './queue-demo-fixture.mjs';
import { submitSessionFixture, waitForNewSessionButton, waitForSessionFixtureSnapshot } from './session-fixture.mjs';
import { mkdtemp, removeTestProfile } from './test-profile.mjs';

const execute = promisify(execFile);
const output = resolve(process.env.DESKTOP_VERIFY_OUTPUT ?? 'test-results/session-plugin-startup');
const executablePath = process.env.DESKTOP_VERIFY_EXE && resolve(process.env.DESKTOP_VERIFY_EXE);
const resources = executablePath ? (process.platform === 'darwin'
  ? resolve(dirname(executablePath), '../Resources') : join(dirname(executablePath), 'resources')) : resolve('.');
const runtime = await realpath(join(resources, 'runtime'));
const node = join(runtime, 'node', process.platform === 'win32' ? 'node.exe' : 'node');
const sdkSource = resolve('../examples/plugins/sdk-host-starter/plugins/dfsc-host-example');
const normalId = 'dfsc-host-example', themeId = 'startup-resource-theme', largeId = 'startup-large-resource';
const service = id => `${id}__example`;
const results = { mode: executablePath ? 'package' : 'source', startedAt: new Date().toISOString(),
  syntheticModelOnly: true, unrelatedPayloadFiles: 1200, cases: [], diagnostics: [], errors: [] };
await mkdir(output, { recursive: true });

async function plugin(root, id, mode = 'connected') {
  const directory = join(root, 'plugins', id), log = join(dirname(root), `${id}-launches.jsonl`);
  await cp(sdkSource, directory, { recursive: true });
  const manifest = JSON.parse(await readFile(join(directory, 'step.plugin.json'), 'utf8'));
  manifest.id = id;
  manifest.name = `Startup fixture ${id}`;
  manifest.mcpServers.example = { command: node, args: ['startup-fixture.mjs'],
    env: { STEPFUN_API_KEY: 'DFSC_INDEPENDENT_PLUGIN' },
    ...(mode === 'timeout' ? { startup_timeout_sec: 1 } : {}) };
  await writeFile(join(directory, 'step.plugin.json'), JSON.stringify(manifest));
  await writeFile(join(directory, 'dfsc.settings.json'), JSON.stringify({
    schemaVersion: 1, consumer: { kind: 'json-file-v1', server: 'example' },
    groups: [{ id: 'connection', title: 'Fixture connection',
      fields: [{ id: 'key', label: 'API Key', type: 'secret', required: true }] }],
  }));
  // Keep mutable launch evidence outside the immutable installed package.
  await writeFile(join(directory, 'startup-fixture.mjs'), [
    "import { appendFile } from 'node:fs/promises';",
    `await appendFile(${JSON.stringify(log)}, JSON.stringify({ pid: process.pid, mode: ${JSON.stringify(mode)} }) + '\\n');`,
    ...(mode === 'exit' ? ['process.exit(23);'] : mode === 'timeout'
      ? ['await new Promise(resolve => setTimeout(resolve, 60000));', "await import('./dist/server.mjs');"]
      : ["await import('./dist/server.mjs');"]),
  ].join('\n'));
  return { id, directory, log, manifest };
}

async function resourcePlugins(root) {
  const theme = join(root, 'plugins', themeId), large = join(root, 'plugins', largeId);
  await mkdir(theme, { recursive: true });
  const themeManifest = { id: themeId, name: 'Startup resource theme', version: '0.1.0' };
  await writeFile(join(theme, 'step.plugin.json'), JSON.stringify(themeManifest));
  await writeFile(join(theme, 'dfsc.theme.json'), JSON.stringify({
    schemaVersion: 2, name: 'Startup resource theme', scheme: 'light',
    ui: { renderer: 'standard-v1' }, background: { renderer: 'solid-v1' },
    colors: { bg: '#ffffff', side: '#f4f4f4', surface: '#ffffff', ink: '#111111',
      muted: '#444444', border: '#888888', code: '#eeeeee', accent: '#137d69' },
  }));
  await mkdir(join(large, 'assets'), { recursive: true });
  const largeManifest = { id: largeId, name: 'Unrelated many-file resource', version: '0.1.0' };
  await writeFile(join(large, 'step.plugin.json'), JSON.stringify(largeManifest));
  for (let start = 0; start < results.unrelatedPayloadFiles; start += 40) {
    await Promise.all(Array.from({ length: Math.min(40, results.unrelatedPayloadFiles - start) }, (_, offset) =>
      writeFile(join(large, 'assets', `${String(start + offset).padStart(4, '0')}.txt`), 'fixture payload\n'.repeat(80))));
  }
  return [{ id: themeId, directory: theme, manifest: themeManifest },
    { id: largeId, directory: large, manifest: largeManifest }];
}

async function setup(label, specifications, resources = false) {
  const profile = await realpath(await mkdtemp(join(tmpdir(), `dfsc-session-plugin-${label}-`)));
  const fixture = await queueFixture(profile, { duration: 300, textOnly: true });
  const root = join(profile, 'step-runtime');
  await mkdir(join(root, 'plugins'), { recursive: true });
  const plugins = await Promise.all(specifications.map(([id, mode]) => plugin(root, id, mode)));
  const packages = [...plugins, ...(resources ? await resourcePlugins(root) : [])];
  const installations = [];
  for (const item of packages) {
    const receipt = installationReceipt({ name: item.id }, { name: 'local-startup-fixture', kind: 'local', path: profile },
      item.manifest, await packageFingerprint(item.directory));
    receipt.state = 'installed';
    installations.push(receipt);
  }
  await writeReceipts(root, { version: 1, installations });
  await writeFile(join(root, 'plugins', '.stepcode-preinstalled'), '["steppage"]');
  await writeFile(join(profile, 'preferences.json'), JSON.stringify({
    language: 'zh', theme: resources ? `plugin:${themeId}` : 'light',
    workspace: fixture.workspace, workspaces: [fixture.workspace],
  }));
  return { label, profile, fixture, root, plugins, errors: [], applicationLogs: [] };
}

async function launch(context) {
  const env = { ...process.env, DESKTOP_TEST_USER_DATA: context.profile, DESKTOP_TEST_NO_FOCUS: '1' };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ ...(executablePath ? { executablePath } : {}),
    args: [...(executablePath ? [] : [resolve('.')]), '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding', '--disable-features=CalculateNativeWinOcclusion'], env, timeout: 60000 });
  context.app = app;
  app.process().stdout?.on('data', value => context.applicationLogs.push(value.toString()));
  app.process().stderr?.on('data', value => context.applicationLogs.push(value.toString()));
  const page = await app.firstWindow();
  context.page = page;
  page.setDefaultTimeout(60000);
  page.on('pageerror', error => context.errors.push(error.message));
  await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    window.setOpacity(0); window.setIgnoreMouseEvents(true); window.showInactive(); window.setSize(1440, 960);
  });
  await waitForNewSessionButton(page);
  return page;
}

async function configure(context) {
  const projections = await context.page.evaluate(async ids => {
    const catalog = await window.desktop.capabilityCatalog();
    const result = [];
    for (const id of ids) {
      const pkg = catalog.plugins.find(item => item.id === id)?.package;
      if (!pkg?.hostSettingsAvailable) throw new Error(`Missing native host settings for ${id}`);
      const first = await window.desktop.pluginHostSettings({ ref: pkg.ref });
      const saved = await window.desktop.pluginSaveHostSettings({
        ref: first.ref, revision: first.revision, mode: 'independent',
        configuration: { ref: first.ref, revision: first.independent.revision, values: {},
          secrets: { key: { action: 'replace', value: 'synthetic-startup-fixture-key' } } },
      });
      if (!saved.configurationCurrent) throw new Error(`Fixture configuration is not current for ${id}`);
      result.push({ id, ref: first.ref });
    }
    return result;
  }, context.plugins.map(item => item.id));
  context.projections = projections;
  return projections;
}

async function checkService(context, id, expected) {
  const summary = await context.page.evaluate(async () => {
    const value = await window.desktop.snapshot();
    return window.desktop.summary(value.runtimeId);
  });
  const server = summary.mcp.find(item => item.name === service(id));
  assert.equal(server?.status, expected, `${id} native MCP state`);
  if (expected === 'connected') assert.ok(server.toolCount > 0, 'The actual SDK publishes tools');
  assert.ok(!summary.mcp.some(item => [themeId, largeId].some(id => item.name.startsWith(`${id}__`))),
    'Resource-only packages must not be attached as MCP services');
  return summary.mcp;
}

async function firstQuestion(context, label, { existingId } = {}) {
  const started = performance.now();
  await waitForNewSessionButton(context.page);
  if (existingId) {
    await context.page.locator(`[data-reorder-kind="session"][data-reorder-id="${existingId}"] > button`).first().click();
  } else {
    await context.page.getByRole('button', { name: '\u65b0\u5efa\u4f1a\u8bdd', exact: true }).click();
  }
  const ready = await waitForSessionFixtureSnapshot(context.page,
    value => existingId ? value.runtimeId && value.state?.sessionId === existingId && !value.state.isStreaming
      : value.draftId && !value.runtimeId, `${label} composer bound`, 60000);
  const text = `STARTUP-${label}`;
  const assistantCount = ready.messages.filter(item => item.role === 'assistant').length;
  const input = context.page.getByRole('textbox', { name: '\u6d88\u606f', exact: true });
  await input.fill(text);
  if (context.label === 'failures') {
    const requestsBefore = context.fixture.requests.length;
    await input.press('Enter');
    const failed = await waitForSessionFixtureSnapshot(context.page, value => {
      const startup = value.state?.desktopStartup;
      return startup?.targetBound && startup.modelReady && startup.discovery === 'ready'
        && startup.tools.some(tool => tool.status === 'failed')
        && startup.tools.every(tool => !['pending', 'connecting'].includes(tool.status));
    }, 'controlled plugin failures to settle', 15000);
    assert.equal(failed.state.desktopStartup.cleanupConfirmed, false, 'A timed-out handshake requires whole-worker recovery');
    assert.ok(await context.page.locator('.composer-action-button').isDisabled());
    assert.equal(await input.evaluate(element => element.value), text, 'Rejected execution retains the draft');
    await assert.rejects(context.page.evaluate(() => window.desktop.command('prompt', {
      message: 'MUST_NOT_BYPASS_PLUGIN_CLEANUP',
    })), /STARTUP_NOT_READY/);
    assert.equal(context.fixture.requests.length, requestsBefore, 'Unconfirmed cleanup must never reach the provider');
    const disabled = await context.page.evaluate(name => window.desktop.capabilityMutate({
      action: 'mcp-toggle', name, enabled: false,
    }), service('startup-timeout'));
    assert.deepEqual(disabled.warnings, []);
    await context.page.getByRole('button', { name: '\u91cd\u65b0\u8fde\u63a5\u8fd0\u884c\u65f6', exact: true }).click();
    await waitForSessionFixtureSnapshot(context.page, value => {
      const startup = value.state?.desktopStartup;
      return value.runtimeId !== failed.runtimeId && value.state?.sessionId === failed.state.sessionId
        && startup?.targetBound && startup.modelReady && startup.discovery === 'ready'
        && startup.cleanupConfirmed && startup.tools.some(tool => tool.name === service('startup-exit') && tool.status === 'failed')
        && startup.tools.some(tool => tool.name === service('startup-timeout') && tool.status === 'disabled')
        && startup.tools.every(tool => !['pending', 'connecting'].includes(tool.status) && tool.cleanupConfirmed !== false);
    }, 'explicit reconnect to retire uncertain cleanup without replacing the session', 15000);
    assert.equal(await input.evaluate(element => element.value), text, 'Explicit recovery retains the rejected draft');
    assert.equal(context.fixture.requests.length, requestsBefore, 'Failed tools never silently authorize the first request');
    const confirmation = context.page.getByRole('dialog', { name: '\u5de5\u5177\u4e0d\u53ef\u7528', exact: true });
    if (!await confirmation.isVisible()) {
      await context.page.waitForFunction(() => !document.querySelector('.composer-action-button')?.disabled);
      await input.press('Enter');
    }
    await confirmation.waitFor();
    await confirmation.getByRole('button', { name: '\u786e\u8ba4', exact: true }).click();
    results.failureRecovery = { cleanupBlocked: true, explicitReconnect: true, sessionAndDraftRetained: true,
      timedOutServiceDisabled: true, settledFailureExplicitlyConfirmed: true };
  } else await submitSessionFixture(context.page, () => input.press('Enter'));
  const answered = await waitForSessionFixtureSnapshot(context.page, value => !value.state?.isStreaming
    && value.messages.some(item => item.role === 'user' && JSON.stringify(item.content).includes(text))
    && value.messages.filter(item => item.role === 'assistant' && item.stopReason === 'stop').length > assistantCount,
  `${label} first question response`, 60000);
  assert.ok(context.fixture.requests.includes(text), 'The real composer submitted to the loopback-only model');
  const timing = answered.runtimeStartupTiming;
  assert.ok(timing && Number.isFinite(timing.pluginAttachMs) && timing.pluginAttachMs >= 0
    && Number.isFinite(timing.totalMs) && timing.totalMs >= timing.pluginAttachMs, 'Native startup timing is projected');
  const entry = { label, sessionId: answered.state.sessionId, elapsedToReplyMs: Math.round(performance.now() - started),
    runtimeStartupTiming: timing };
  results.cases.push(entry);
  await context.page.screenshot({ path: join(output, `${label}.png`) });
  return entry;
}

async function launches(item) {
  try { return (await readFile(item.log, 'utf8')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line)); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
}

async function diagnostic(context, label) {
  const { stdout, stderr } = await execute(node, [resolve('scripts/diagnose-plugin-startup.mjs'), context.root, runtime,
    'host', normalId, 'example', normalId], { cwd: resolve('.'), windowsHide: true, timeout: 60000, maxBuffer: 1024 * 1024 });
  const lines = stdout.trim().split(/\r?\n/u).filter(Boolean).map(line => JSON.parse(line));
  const scan = lines.find(item => Array.isArray(item.fingerprintScans));
  assert.ok(lines.some(item => item.mode === 'host' && item.plugin === normalId), 'Target descriptor resolved');
  assert.ok(Array.isArray(scan?.fingerprintScans), 'Diagnostic reports its main-process fingerprint scope');
  assert.ok(scan.fingerprintScans.every(item => item.package === `installed/${normalId}`),
    'Narrow host descriptor must never fingerprint unrelated installed or marketplace packages');
  results.diagnostics.push({ label, instrumentedScope: 'desktop-main-only; management worker uninstrumented', lines });
  await writeFile(join(output, `${label}-diagnostic.log`), stdout + stderr);
}

async function close(context) {
  if (!context.app) return;
  const app = context.app;
  context.app = undefined;
  await closeDesktopFixtureAndWait(app);
}

async function run(context, action) {
  try { await action(context); }
  catch (error) {
    await context.page?.screenshot({ path: join(output, `${context.label}-failure.png`) }).catch(() => {});
    const snapshot = await context.page?.evaluate(() => window.desktop.snapshot()).catch(() => undefined);
    if (snapshot) await writeFile(join(output, `${context.label}-failure-state.json`), JSON.stringify({
      status: snapshot.status, runtimeId: snapshot.runtimeId, draftId: snapshot.draftId,
      state: snapshot.state, messages: snapshot.messages, runtimeStartupTiming: snapshot.runtimeStartupTiming,
      syntheticModelRequests: context.fixture.requests,
    }, null, 2));
    throw error;
  } finally {
    try { await close(context); }
    finally {
      await context.fixture.close();
      results.errors.push(...context.errors);
      await writeFile(join(output, `${context.label}-application.log`), context.applicationLogs.join(''));
      await removeTestProfile(context.profile);
    }
  }
}

try {
  await run(await setup('normal', [[normalId, 'connected']], true), async context => {
    await launch(context);
    await configure(context);
    assert.equal(await context.page.evaluate(() => window.desktopTheme.themePacks.some(pack =>
      pack.id === 'plugin:startup-resource-theme')), true, 'The pure-data theme registers alongside MCP');
    assert.equal((await context.page.evaluate(() => window.desktop.snapshot())).preferences.theme, `plugin:${themeId}`);
    await diagnostic(context, 'normal-before-first');
    const first = await firstQuestion(context, 'normal-first');
    const firstServices = await checkService(context, normalId, 'connected');
    const second = await firstQuestion(context, 'normal-second');
    assert.notEqual(second.sessionId, first.sessionId, 'Consecutive new sessions have distinct identities');
    await checkService(context, normalId, 'connected');
    await diagnostic(context, 'normal-after-second');
    await close(context);
    await launch(context);
    const restored = await firstQuestion(context, 'normal-restored', { existingId: first.sessionId });
    assert.equal(restored.sessionId, first.sessionId, 'The persisted session restores after application relaunch');
    await checkService(context, normalId, 'connected');
    await diagnostic(context, 'normal-after-restore');
    assert.equal((await launches(context.plugins[0])).length, 3, 'The SDK attaches once for each native worker startup');
    results.resourceCoexistence = { selectedTheme: `plugin:${themeId}`, mcp: firstServices };
  });
  await run(await setup('disabled', [[normalId, 'connected']]), async context => {
    await launch(context);
    await configure(context);
    const disabled = await context.page.evaluate(name => window.desktop.capabilityMutate({
      action: 'mcp-toggle', name, enabled: false,
    }), service(normalId));
    assert.deepEqual(disabled.warnings, [], 'The precise service switch persists without warnings');
    const question = await firstQuestion(context, 'disabled-first');
    question.mcp = await checkService(context, normalId, 'disabled');
    assert.equal((await launches(context.plugins[0])).length, 0, 'Disabled service must never spawn');
  });
  await run(await setup('failures', [['startup-exit', 'exit'], ['startup-timeout', 'timeout']]), async context => {
    await launch(context);
    await configure(context);
    const question = await firstQuestion(context, 'failed-services-first', { existingId: 'queue-demo' });
    question.mcp = await checkService(context, 'startup-exit', 'failed');
    await checkService(context, 'startup-timeout', 'disabled');
    assert.ok(question.elapsedToReplyMs < 30000, 'Explicit recovery and confirmation must permit the local first response');
    for (const item of context.plugins) assert.equal((await launches(item)).length, item.id === 'startup-exit' ? 2 : 1,
      'Recovery launches the enabled failed service once more but never restarts the disabled timed-out service');
    results.failureFixture = { exitCode: 23, declaredStartupTimeoutSec: 1, delayedSdkImportMs: 60000,
      productTimeoutsChanged: false };
  });
  assert.deepEqual(results.errors, [], 'Native renderer page errors');
  results.passed = true;
  console.log('Session plugin startup acceptance passed: consecutive sessions, persisted restore, resource/MCP coexistence, narrow fingerprint diagnostics, disabled/failed services and loopback-only first responses.');
} catch (error) {
  results.passed = false;
  results.failure = error instanceof Error ? error.message : String(error);
  throw error;
} finally {
  results.finishedAt = new Date().toISOString();
  await writeFile(join(output, 'results.json'), JSON.stringify(results, null, 2));
}
