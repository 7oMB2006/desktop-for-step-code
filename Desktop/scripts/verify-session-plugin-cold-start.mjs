import assert from 'node:assert/strict';
import { lstat, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { _electron as electron } from 'playwright';
import { closeDesktopFixtureAndWait } from './close-desktop-fixture.mjs';
import { submitSessionFixture, waitForSessionFixtureSnapshot } from './session-fixture.mjs';
import { mkdtemp, removeTestProfile } from './test-profile.mjs';
import { COLD_START_DESKTOP_TITLES, COLD_START_PLUGIN_IDS, createColdStartPluginFixture } from './session-plugin-cold-start-fixture.mjs';

const output = resolve(process.env.DESKTOP_VERIFY_OUTPUT ?? 'test-results/session-plugin-cold-start');
const executablePath = process.env.DESKTOP_VERIFY_EXE && resolve(process.env.DESKTOP_VERIFY_EXE);
const resources = executablePath ? (process.platform === 'darwin'
  ? resolve(dirname(executablePath), '../Resources') : join(dirname(executablePath), 'resources')) : resolve('.');
const runtime = await realpath(join(resources, 'runtime'));
const node = join(runtime, 'node', process.platform === 'win32' ? 'node.exe' : 'node');
const selectedCases = process.env.DESKTOP_VERIFY_COLD_CASE
  ? [process.env.DESKTOP_VERIFY_COLD_CASE] : ['first-question', 'historical-session'];
assert.ok(selectedCases.every(value => ['first-question', 'historical-session'].includes(value)), 'Known cold-start case');
const results = { mode: executablePath ? 'package' : 'source', startedAt: new Date().toISOString(),
  applicationColdStart: true, fileSystemCacheControlled: false, syntheticModelOnly: true,
  timingClock: 'monotonic milliseconds since electron.launch invocation; fixture setup excluded',
  readinessTiming: 'observed upper bounds, not instrumented Electron ready-event timestamps',
  harnessPreInteractionCatalogCalls: 0, harnessPreInteractionDiagnosticCalls: 0,
  rendererAutomaticCallsInstrumented: false, cases: [], errors: [] };
await mkdir(output, { recursive: true });

async function logEntries(path) {
  try { return (await readFile(path, 'utf8')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line)); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
}

async function runCase(label) {
  const profile = await realpath(await mkdtemp(join(tmpdir(), `dfsc-plugin-cold-${label}-`)));
  let fixture, app, page, ownedElectronProcess;
  const applicationLogs = [], errors = [];
  const entry = { label, setupStartedAt: new Date().toISOString() };
  results.cases.push(entry);
  try {
    const setupStarted = performance.now();
    fixture = await createColdStartPluginFixture(profile, node);
    entry.fixtureSetupMs = Math.round(performance.now() - setupStarted);
    entry.inventory = fixture.inventory;
    const env = { ...process.env, DESKTOP_TEST_USER_DATA: profile, DESKTOP_TEST_NO_FOCUS: '1' };
    delete env.ELECTRON_RUN_AS_NODE;
    const launched = performance.now(), elapsed = () => Math.round(performance.now() - launched);
    entry.launchStartedAt = new Date().toISOString();
    app = await electron.launch({ ...(executablePath ? { executablePath } : {}),
      args: [...(executablePath ? [] : [resolve('.')]), '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding', '--disable-features=CalculateNativeWinOcclusion'], env, timeout: 90000 });
    ownedElectronProcess = app.process();
    entry.ownedElectronPid = ownedElectronProcess.pid;
    app.process().stdout?.on('data', value => applicationLogs.push(value.toString()));
    app.process().stderr?.on('data', value => applicationLogs.push(value.toString()));
    await app.evaluate(async ({ app }) => { await app.whenReady(); });
    entry.appReadyObservedMs = elapsed();
    page = await app.firstWindow();
    page.setDefaultTimeout(90000);
    page.on('pageerror', error => errors.push(error.message));
    await page.waitForLoadState('domcontentloaded');
    entry.mainWindowReadyObservedMs = elapsed();
    await app.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0];
      window.setOpacity(0); window.setIgnoreMouseEvents(true); window.showInactive(); window.setSize(1440, 960);
    });
    const input = page.getByRole('textbox', { name: '\u6d88\u606f', exact: true });
    const target = label === 'historical-session'
      ? page.locator(`[data-reorder-kind="session"][data-reorder-id="${fixture.historicalSessionId}"] > button`).first()
      : page.getByRole('button', { name: '\u65b0\u5efa\u4f1a\u8bdd', exact: true });
    await target.waitFor({ state: 'visible' });
    await page.waitForFunction(() => document.querySelector('.new-chat')?.disabled === false);
    entry.firstActionableMs = elapsed();
    entry.interactionStartedMs = elapsed();
    const interacted = performance.now();
    await target.click();
    if (label === 'historical-session') {
      await waitForSessionFixtureSnapshot(page, value => value.runtimeId
        && value.state?.sessionId === fixture.historicalSessionId && !value.state?.isStreaming,
      'immediate cold historical navigation', 90000);
      entry.historicalRuntimeReadyMs = elapsed();
    } else {
      await waitForSessionFixtureSnapshot(page, value => value.draftId && !value.runtimeId,
        'immediate cold draft binding', 90000);
    }
    const text = `COLD-START-${label}`;
    await input.fill(text);
    entry.initialSendMs = elapsed();
    await submitSessionFixture(page, () => input.press('Enter'));
    entry.promptSubmittedMs = elapsed();
    const answered = await waitForSessionFixtureSnapshot(page, value => !value.state?.isStreaming
      && value.messages.some(item => item.role === 'user' && JSON.stringify(item.content).includes(text))
      && value.messages.some(item => item.role === 'assistant' && item.stopReason === 'stop'
        && JSON.stringify(item.content).includes(text)),
    'cold-start loopback first reply', 90000);
    entry.replyReceivedMs = elapsed();
    entry.interactionToReplyMs = Math.round(performance.now() - interacted);
    assert.ok(fixture.model.requests.includes(text), 'The real composer reached only the loopback model');
    assert.ok(answered.runtimeStartupTiming, 'Native runtime timing is independent of application and interaction timing');
    entry.runtimeStartupTiming = answered.runtimeStartupTiming;
    entry.interactionElapsedOutsideRuntimeStartupMs = Math.max(0,
      Math.round(entry.interactionToReplyMs - answered.runtimeStartupTiming.totalMs));
    entry.sessionId = answered.state.sessionId;
    await page.waitForFunction(() => {
      const input = document.querySelector('.composer-input[role="textbox"]');
      return document.querySelector('.new-chat')?.disabled === false
        && input?.getAttribute('aria-disabled') === 'false'
        && input?.getAttribute('contenteditable') === 'true'
        && document.querySelector('.composer-action-button')?.getAttribute('data-action') === 'send';
    }, undefined, { timeout: 15000 });
    entry.composerReadyMs = elapsed();
    entry.interactionToComposerReadyMs = Math.round(performance.now() - interacted);
    const draft = `UNSUBMITTED-DRAFT-${label}`;
    await input.fill(draft);
    await page.waitForFunction(expected => {
      const input = document.querySelector('.composer-input[role="textbox"]');
      const action = document.querySelector('.composer-action-button');
      return input?.textContent === expected && action?.getAttribute('data-action') === 'send'
        && action.disabled === false;
    }, draft, { timeout: 15000 });
    await input.press('ControlOrMeta+A');
    await input.press('Backspace');
    await page.waitForFunction(() => document.querySelector('.composer-input[role="textbox"]')?.textContent === ''
      && document.querySelector('.composer-action-button')?.disabled === true, undefined, { timeout: 15000 });
    assert.equal(fixture.model.requests.filter(value => value === text).length, 1,
      'The follow-up draft does not resubmit the answered prompt');
    assert.ok(!fixture.model.requests.includes(draft), 'The follow-up draft is editable without submitting a request');
    entry.followupDraftEditable = true;
    assert.ok(entry.replyReceivedMs < 30000,
      `Cold launch through first reply took ${entry.replyReceivedMs}ms, including pre-runtime waits`);
    assert.ok(entry.interactionToReplyMs < 15000,
      `The immediate interaction took ${entry.interactionToReplyMs}ms, not just native runtime startup`);
    assert.ok(entry.composerReadyMs < 30000 && entry.interactionToComposerReadyMs < 15000,
      `The renderer became editable ${entry.composerReadyMs}ms after launch and ${entry.interactionToComposerReadyMs}ms after interaction`);
    // All additional observations happen after the cold interaction has completed.
    for (const title of Object.values(COLD_START_DESKTOP_TITLES))
      await page.getByRole('button', { name: title, exact: true }).waitFor({ state: 'visible' });
    entry.visibleDesktopPlugins = Object.values(COLD_START_PLUGIN_IDS);
    const summary = await page.evaluate(async () => {
      const value = await window.desktop.snapshot();
      return window.desktop.summary(value.runtimeId);
    });
    const sdk = summary.mcp.find(item => item.name === `${COLD_START_PLUGIN_IDS.sdk}__example`);
    const unrelated = summary.mcp.find(item => item.name === `${COLD_START_PLUGIN_IDS.large}__tools`);
    assert.equal(sdk?.status, 'connected', 'The preconfigured SDK attaches during the real cold startup');
    assert.ok(sdk.toolCount > 0, 'The actual SDK publishes tools');
    assert.equal(unrelated?.status, 'disabled', 'The large executable package retains its exact disabled service');
    assert.equal((await logEntries(fixture.sdkLaunchLog)).length, 1, 'Only one SDK process attaches');
    assert.equal((await logEntries(fixture.largeLaunchLog)).length, 0, 'The unrelated disabled plugin never spawns');
    entry.mcp = summary.mcp;
    await page.screenshot({ path: join(output, `${label}.png`) });
    assert.deepEqual(errors, [], 'Native renderer page errors');
    entry.passed = true;
  } catch (error) {
    entry.passed = false;
    entry.failure = error instanceof Error ? error.message : String(error);
    await page?.screenshot({ path: join(output, `${label}-failure.png`) }).catch(() => {});
    throw error;
  } finally {
    try {
      if (app) {
        await closeDesktopFixtureAndWait(app);
        entry.ownedElectronExitCode = ownedElectronProcess.exitCode;
        assert.equal(entry.ownedElectronExitCode, 0, 'The owned fixture Electron process exited cleanly');
      }
    }
    finally {
      try {
        await fixture?.model.close();
        entry.loopbackServerClosed = Boolean(fixture);
      }
      finally {
        results.errors.push(...errors);
        await writeFile(join(output, `${label}-application.log`), applicationLogs.join(''));
        await removeTestProfile(profile);
        if (process.env.DESKTOP_KEEP_TEST_PROFILES === '1') entry.profileCleanup = 'retained-by-request';
        else {
          await assert.rejects(lstat(profile), { code: 'ENOENT' }, 'Only this run-owned profile was removed');
          entry.profileCleanup = 'removed-and-verified';
        }
      }
    }
  }
}

try {
  for (const label of selectedCases) await runCase(label);
  assert.deepEqual(results.errors, [], 'Native renderer errors including fixture shutdown');
  results.passed = true;
  console.log('Cold plugin startup passed: immediate first question/history navigation, two large dependency-package copies, persisted SDK binding and real desktop entries.');
} catch (error) {
  results.passed = false;
  results.failure = error instanceof Error ? error.message : String(error);
  throw error;
} finally {
  results.finishedAt = new Date().toISOString();
  await writeFile(join(output, 'results.json'), JSON.stringify(results, null, 2));
}
