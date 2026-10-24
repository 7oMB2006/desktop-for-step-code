import { _electron as electron } from 'playwright';
import { mkdir, mkdtemp, realpath, writeFile, readFile, rename } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { closeDesktopFixture } from './close-desktop-fixture.mjs';

const profile = await realpath(await mkdtemp(join(tmpdir(), 'desktop-navigation-')));
const project = join(profile, 'project');
const failureProject = join(profile, 'failure-project');
const root = join(profile, 'step-runtime');
const sessions = join(root, 'sessions');
await mkdir(project);
await mkdir(failureProject);
await mkdir(sessions, { recursive: true });
await mkdir('test-results', { recursive: true });
await writeFile(join(profile, 'preferences.json'), JSON.stringify({
  language: 'zh', theme: 'light', workspaces: [project, failureProject], workspace: project,
}));
await writeFile(join(root, 'config.toml'), 'defaultProvider = "fixture"\ndefaultModel = "fixture"\n[telemetry]\nenabled = false\n');
await writeFile(join(root, 'models.json'), JSON.stringify({ providers: {
  fixture: { baseUrl: 'http://127.0.0.1:1/v1', api: 'openai-completions', apiKey: 'local-test-only',
    models: [{ id: 'fixture', name: 'Navigation fixture' }] },
} }));
for (let index = 0; index < 6; index++) {
  const timestamp = new Date(Date.now() - 10000 - index * 1000).toISOString();
  const entries = [{ type: 'session', version: 3, id: `navigation-${index}`, cwd: index === 5 ? failureProject : project, timestamp }];
  let parentId = null;
  for (let turn = 0; turn < 22; turn++) {
    const userId = `user-${turn}`;
    entries.push({ type: 'message', id: userId, parentId, timestamp,
      message: { role: 'user', content: [{ type: 'text', text: `Conversation ${index}, question ${turn}` }], timestamp: Date.parse(timestamp) } });
    const assistantId = `assistant-${turn}`;
    entries.push({ type: 'message', id: assistantId, parentId: userId, timestamp,
      message: { role: 'assistant', content: [...(turn === 21 ? [{ type: 'thinking', thinking: 'Saved reasoning stays readable during recovery.' }] : []), { type: 'text', text: `Answer ${index}/${turn}. ` + 'A readable history paragraph with stable message identity.\n\n'.repeat(3) }],
        api: 'openai-completions', provider: 'fixture', model: 'fixture', stopReason: 'stop',
        usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
        timestamp: Date.parse(timestamp) } });
    parentId = assistantId;
  }
  if (index === 3) {
    entries.push({ type: 'message', id: 'abandoned', parentId, timestamp,
      message: { role: 'user', content: 'ABANDONED_BRANCH_MUST_NOT_PAINT', timestamp: Date.parse(timestamp) } });
    entries.push({ type: 'compaction', id: 'compact', parentId, timestamp,
      summary: 'COMPACTED_CONTEXT_PREVIEW', firstKeptEntryId: 'user-18', tokensBefore: 100 });
    entries.push({ type: 'custom_message', id: 'preview-custom', parentId: 'compact', timestamp,
      customType: 'fixture', content: [{ type: 'text', text: 'Visible custom history' }], display: true });
    parentId = 'preview-custom';
  }
  entries.push({ type: 'session_info', id: 'name', parentId, timestamp, name: `Navigation ${index}` });
  await writeFile(join(sessions, `navigation-${index}.jsonl`), entries.map(entry => JSON.stringify(entry)).join('\n') + '\n');
}
const env = { ...process.env, DESKTOP_TEST_USER_DATA: profile, DESKTOP_TEST_NO_FOCUS: '1' };
delete env.ELECTRON_RUN_AS_NODE;
const executablePath = process.env.DESKTOP_VERIFY_EXE;
const app = await electron.launch({ ...(executablePath ? { executablePath } : { args: [resolve('.')] }), env, timeout: 60000 });
const errors = [];
let phase = 'startup';
try {
  const page = await app.firstWindow();
  page.on('pageerror', error => errors.push(error.message));
  await app.evaluate(({ BrowserWindow, dialog }) => {
    // Exercise the conservative low-memory retention budget deterministically.
    process.getBuiltinModule('os').freemem = () => 1024 ** 3;
    const window = BrowserWindow.getAllWindows()[0];
    window.setOpacity(0); window.setIgnoreMouseEvents(true); window.showInactive();
    dialog.showMessageBox = async () => ({ response: 1 });
  });
  await page.waitForFunction(() => document.querySelectorAll('.session-row').length === 6 && !document.querySelector('.new-chat')?.disabled, undefined, { timeout: 60000 });
  const row = index => page.locator(`[data-reorder-id="navigation-${index}"] > button`).first();
  const opened = async index => {
    await page.waitForFunction(index => document.querySelector('.window-session-title')?.textContent === `Navigation ${index}` &&
      document.querySelector('.composer-wrap')?.getAttribute('aria-busy') !== 'true' &&
      !document.querySelector('.composer > .composer-input')?.disabled, index, { timeout: 60000 });
    assert.equal((await page.evaluate(() => window.desktop.snapshot())).state.sessionId, `navigation-${index}`);
  };
  phase = 'first cold reading before runtime and scroll handoff';
  await app.evaluate(({ ipcMain }) => {
    globalThis.navigationOriginalHandler = ipcMain._invokeHandlers.get('desktop');
    globalThis.navigationGate = new Promise(resolve => { globalThis.navigationRelease = resolve; });
    ipcMain.removeHandler('desktop');
    ipcMain.handle('desktop', async (event, method, ...args) => {
      if (method === 'navigateSession' && args[0] === 'navigation-4') await globalThis.navigationGate;
      return globalThis.navigationOriginalHandler(event, method, ...args);
    });
  });
  try {
    const before = await readFile(join(sessions, 'navigation-4.jsonl'));
    await row(4).click();
    await page.waitForFunction(() => document.querySelector('.session-reading-preview')?.textContent.includes('Answer 4/21'));
    assert.equal(await page.locator('.session-reading-preview').evaluate(element => element.inert), false);
    assert.equal(await page.locator('.composer > .composer-input').isDisabled(), false);
    const composer = page.getByRole('textbox', { name: '消息', exact: true });
    await composer.fill('Draft entered during cold recovery');
    await composer.press('Enter');
    assert.equal(await composer.evaluate(element => element.value), 'Draft entered during cold recovery');
    assert.ok(await page.locator('.composer-action-button').isDisabled(), 'Execution remains gated');
    const previewUser = page.locator('.session-reading-preview .message.user').last();
    await previewUser.hover();
    await previewUser.locator('.icon-button[aria-label="复制"]').click();
    assert.ok((await app.evaluate(({ clipboard }) => clipboard.readText())).includes('Conversation 4'));
    const thinking = page.locator('.session-reading-preview details.thinking').last();
    await thinking.locator('summary').click();
    await page.waitForFunction(() => document.querySelector('.session-reading-preview details.thinking')?.getAttribute('data-expanded') === 'true');
    const history = await page.evaluate(() => window.desktop.sessionReading('navigation-4'));
    assert.deepEqual(Object.keys(history).sort(), ['messages', 'modelChanges', 'sessionId', 'version']);
    assert.equal((await page.evaluate(() => window.desktop.snapshot())).runtimes.length, 0);
    assert.deepEqual(await readFile(join(sessions, 'navigation-4.jsonl')), before, 'Preview cannot repair or migrate history on disk');
    const position = await page.evaluate(() => {
      const viewport = document.querySelector('#conversation-scroll');
      const article = document.querySelector('.messages > article[data-message-index="12"]');
      viewport.dispatchEvent(new WheelEvent('wheel'));
      viewport.scrollTop += article.getBoundingClientRect().top - viewport.getBoundingClientRect().top - 35;
      viewport.dispatchEvent(new Event('scroll'));
      return article.getBoundingClientRect().top - viewport.getBoundingClientRect().top;
    });
    const timestamp = new Date().toISOString();
    const extra = [
      { type: 'message', id: 'handoff-user', parentId: 'name', timestamp,
        message: { role: 'user', content: 'History changed during preparation', timestamp: Date.now() } },
      { type: 'message', id: 'handoff-answer', parentId: 'handoff-user', timestamp,
        message: { role: 'assistant', content: [{ type: 'text', text: 'AUTHORITATIVE_HANDOFF_MESSAGE' }],
          provider: 'fixture', model: 'fixture', api: 'openai-completions', stopReason: 'stop', timestamp: Date.now(),
          usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } } },
    ];
    await writeFile(join(sessions, 'navigation-4.jsonl'),
      Buffer.concat([before, Buffer.from(extra.map(entry => JSON.stringify(entry)).join('\n') + '\n')]));
    const newer = await page.evaluate(() => window.desktop.sessionReading('navigation-4'));
    assert.notEqual(newer.version, history.version);
    await composer.focus();
    await composer.evaluate(element => {
      element.setSelectionRange(5, 5);
      window.navigationEditorBeforeReady = element;
    });
    await app.evaluate(() => globalThis.navigationRelease());
    await opened(4);
    assert.equal(await composer.evaluate(element => element.value), 'Draft entered during cold recovery');
    assert.ok(await composer.evaluate(element => element === window.navigationEditorBeforeReady &&
      document.activeElement === element && element.selectionStart === 5), 'Handoff preserves editor focus and caret');
    assert.equal(await page.locator('.messages').evaluate(element =>
      element.textContent.split('AUTHORITATIVE_HANDOFF_MESSAGE').length - 1), 1,
    'Runtime handoff replaces the historical snapshot with newer messages without duplicates');
    assert.ok(await page.evaluate(position => {
      const viewport = document.querySelector('#conversation-scroll');
      const article = document.querySelector('.messages > article[data-message-index="12"]');
      return Math.abs(article.getBoundingClientRect().top - viewport.getBoundingClientRect().top - position) < 3;
    }, position), 'First cold preview retains its reading anchor through runtime handoff');
  } finally {
    await app.evaluate(({ ipcMain }) => {
      globalThis.navigationRelease?.();
      ipcMain.removeHandler('desktop');
      ipcMain.handle('desktop', globalThis.navigationOriginalHandler);
    });
  }
  phase = 'cold latest-target navigation';
  const cold = await page.evaluate(async () => {
    const times = [];
    const started = performance.now();
    const requests = [0, 1, 2].map(index => window.desktop.navigateSession(`navigation-${index}`));
    const results = await Promise.all(requests);
    times.push(performance.now() - started);
    return { ids: results.map(result => result?.state.sessionId ?? null), times };
  });
  assert.deepEqual(cold.ids, [null, null, 'navigation-2']);
  await page.reload();
  await opened(2);
  console.log('Cold coalesced navigation ms:', Math.round(cold.times[0]));
  phase = 'two overtaken startups cannot block a resident or unlock billing changes';
  const residentRuntimeId = (await page.evaluate(() => window.desktop.snapshot())).runtimeId;
  await app.evaluate(() => {
    const childProcess = process.getBuiltinModule('child_process');
    const spawn = childProcess.spawn;
    let claimed = 0;
    const releases = [];
    globalThis.navigationStalled = 0;
    globalThis.navigationReleaseStartup = index => releases[index]?.();
    childProcess.spawn = function (...args) {
      const child = spawn.apply(this, args);
      if (claimed >= 2 || !args[1]?.includes('--mode') || !args[1]?.includes('rpc')) return child;
      const index = claimed++;
      const write = child.stdin.write;
      let held = false;
      child.stdin.write = function (...values) {
        let command;
        try { command = JSON.parse(String(values[0])); } catch {}
        if (command?.type === 'get_state' && !held) {
          held = true;
          globalThis.navigationStalled++;
          releases[index] = () => {
            releases[index] = undefined;
            child.stdin.write = write;
            write.apply(child.stdin, values);
          };
          return true;
        }
        return write.apply(this, values);
      };
      return child;
    };
    globalThis.navigationRestoreSpawn = () => { childProcess.spawn = spawn; };
  });
  try {
    await row(1).click();
    const waitForStartups = count => app.evaluate(async (_electron, count) => {
      const deadline = Date.now() + 10000;
      while (globalThis.navigationStalled < count && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10));
      if (globalThis.navigationStalled < count) throw new Error('Fixture startups were not intercepted');
    }, count);
    await waitForStartups(1);
    await page.getByRole('textbox', { name: '消息', exact: true }).fill('Draft for overtaken one');
    await row(0).click();
    await waitForStartups(2);
    await page.getByRole('textbox', { name: '消息', exact: true }).fill('Draft for overtaken zero');
    await row(2).click();
    await opened(2);
    assert.equal((await page.evaluate(() => window.desktop.snapshot())).runtimeId, residentRuntimeId,
      'Two cold startups cannot queue or replace a connected resident');
    const commands = await page.evaluate(async () => {
      const snapshot = await window.desktop.snapshot();
      return window.desktop.command('get_commands', {}, snapshot.runtimeId);
    });
    assert.ok(Array.isArray(commands.commands), 'A reused resident is immediately usable while both startups are held');
    await assert.rejects(page.evaluate(() => window.desktop.logout()), /operation in progress/i,
      'Account changes remain locked while either startup uses the active credentials');
    await app.evaluate(() => globalThis.navigationReleaseStartup(0));
    const coldReading = await page.evaluate(() => window.desktop.sessionReading('navigation-3'));
    assert.ok(JSON.stringify(coldReading.messages).includes('COMPACTED_CONTEXT_PREVIEW'));
    assert.ok(!JSON.stringify(coldReading.messages).includes('ABANDONED_BRANCH_MUST_NOT_PAINT'));
    await row(3).click();
    await opened(3);
    const authoritative = await page.evaluate(() => window.desktop.snapshot());
    const transcript = messages => messages.map(({ role, content, entryId, customType }) => ({ role, content, entryId, customType }));
    assert.deepEqual(transcript(coldReading.messages), transcript(authoritative.messages),
      'Read-only compaction, custom messages and branch IDs match the actual runtime transcript');
    phase = 'idle recycling continues while an obsolete startup is held';
    for (const index of [4, 1, 2, 3]) {
      await row(index).click();
      await opened(index);
      if (index === 1) assert.equal(await page.getByRole('textbox', { name: '消息', exact: true }).evaluate(element => element.value),
        'Draft for overtaken one', 'Overtaken startup retains only its own draft');
      await page.waitForFunction(async () => (await window.desktop.snapshot()).runtimes.length <= 3);
    }
    await assert.rejects(page.evaluate(() => window.desktop.logout()), /operation in progress/i,
      'Recycling cannot release the shared account/settings lock');
    await page.evaluate(() => {
      window.navigationBackgroundPrepared = false;
      window.navigationStopBackgroundObserver = window.desktop.onEvent(event => {
        if (event.type === 'desktop_runtimes' && event.runtimes.some(runtime => runtime.sessionId === 'navigation-0'))
          window.navigationBackgroundPrepared = true;
      });
    });
    await app.evaluate(() => globalThis.navigationReleaseStartup(1));
    await page.waitForFunction(() => window.navigationBackgroundPrepared);
    await page.waitForFunction(async () => (await window.desktop.snapshot()).runtimes.length <= 3);
    assert.equal((await page.evaluate(() => window.desktop.snapshot())).state.sessionId, 'navigation-3',
      'A late prepared worker cannot reactivate its overtaken target');
  } finally {
    await page.evaluate(() => window.navigationStopBackgroundObserver?.());
    await app.evaluate(() => {
      for (let index = 0; index < 2; index++) {
        globalThis.navigationReleaseStartup?.(index);
      }
      globalThis.navigationRestoreSpawn();
    });
  }
  phase = 'fixed circular loading indicator';
  const spinnerGeometry = await row(2).evaluate(button => {
    const spinner = document.createElement('span');
    spinner.className = 'session-navigation-spinner';
    spinner.setAttribute('role', 'status');
    button.append(spinner);
    const style = getComputedStyle(spinner);
    const rect = spinner.getBoundingClientRect();
    const result = { width: style.width, height: style.height, grow: style.flexGrow,
      basis: style.flexBasis, boundsWidth: rect.width, boundsHeight: rect.height };
    spinner.remove();
    return result;
  });
  assert.equal(spinnerGeometry.width, '12px', 'Title span rules must not stretch the loading indicator');
  assert.equal(spinnerGeometry.height, '12px');
  assert.equal(spinnerGeometry.grow, '0');
  assert.equal(spinnerGeometry.basis, '12px');
  assert.ok(Math.abs(spinnerGeometry.boundsWidth - spinnerGeometry.boundsHeight) < .1,
    'The rotating loading indicator remains circular');
  phase = 'rapid sidebar clicks and identity agreement';
  await page.evaluate(() => {
    for (const index of [0, 1, 3]) document.querySelector(`[data-reorder-id="navigation-${index}"] > button`).click();
    window.navigationImmediate = {
      selected: document.querySelector('.session-row.selected')?.dataset.reorderId,
      sendingDisabled: document.querySelector('.composer > .composer-input')?.disabled,
    };
  });
  await opened(3);
  assert.ok(!(await page.locator('.messages').textContent()).includes('Answer 0/'));
  phase = 'draft and reading anchor';
  await row(0).click();
  await opened(0);
  assert.equal(await page.getByRole('textbox', { name: '消息', exact: true }).evaluate(element => element.value),
    'Draft for overtaken zero', 'Rapid switching keeps the other target draft separate');
  await page.getByRole('textbox', { name: '消息', exact: true }).fill('Retained draft zero');
  const reading = await page.evaluate(() => {
    const viewport = document.querySelector('#conversation-scroll');
    const article = document.querySelector('.messages > article[data-message-index="12"]');
    viewport.dispatchEvent(new WheelEvent('wheel'));
    viewport.scrollTop += article.getBoundingClientRect().top - viewport.getBoundingClientRect().top - 35;
    viewport.dispatchEvent(new Event('scroll'));
    return { offset: article.getBoundingClientRect().top - viewport.getBoundingClientRect().top };
  });
  for (const index of [1, 2, 3, 4]) { await row(index).click(); await opened(index); }
  assert.ok(!(await page.evaluate(() => window.desktop.snapshot())).runtimes.some(runtime => runtime.sessionId === 'navigation-0'), 'Old idle worker must actually be recycled');
  phase = 'read-only fast preview after recycling';
  await page.evaluate(() => {
    window.previewEvidence = [];
    const observer = new MutationObserver(() => {
      const preview = document.querySelector('.session-reading-preview');
      if (preview) window.previewEvidence.push({
        inert: preview.inert, disabled: document.querySelector('.composer > .composer-input').disabled,
        text: preview.textContent.includes('Answer 0/'),
      });
    });
    observer.observe(document.body, { subtree: true, childList: true, attributes: true });
    window.navigationPreviewObserver = observer;
    document.querySelector('[data-reorder-id="navigation-0"] > button').click();
  });
  await opened(0);
  const preview = await page.evaluate(() => { window.navigationPreviewObserver.disconnect(); return window.previewEvidence; });
  assert.ok(preview.some(value => !value.inert && !value.disabled && value.text), 'Recycled history and target draft are usable before execution reconnects');
  assert.equal(await page.getByRole('textbox', { name: '消息', exact: true }).evaluate(element => element.value), 'Retained draft zero');
  const restored = await page.evaluate(() => {
    const viewport = document.querySelector('#conversation-scroll');
    const article = document.querySelector('.messages > article[data-message-index="12"]');
    return article.getBoundingClientRect().top - viewport.getBoundingClientRect().top;
  });
  assert.ok(Math.abs(restored - reading.offset) < 3, `Reading anchor drifted: ${restored} vs ${reading.offset}`);
  await page.screenshot({ path: 'test-results/session-navigation-light.png' });
  phase = 'controlled draft preview and dual navigation/snapshot failure';
  await row(1).click();
  await opened(1);
  await page.getByRole('textbox', { name: '消息', exact: true }).fill('Retained draft one');
  await row(0).click();
  await opened(0);
  await app.evaluate(({ ipcMain }) => {
    globalThis.navigationOriginalHandler = ipcMain._invokeHandlers.get('desktop');
    globalThis.navigationSnapshotFailures = 0;
    ipcMain.removeHandler('desktop');
    ipcMain.handle('desktop', async (event, method, ...args) => {
      if (method === 'navigateSession') {
        await new Promise(done => { globalThis.navigationReleaseFailure = done; });
        throw new Error('NAVIGATION_DOUBLE_FAILURE');
      }
      if (method === 'snapshot') {
        globalThis.navigationSnapshotFailures++;
        throw new Error('SNAPSHOT_DOUBLE_FAILURE');
      }
      return globalThis.navigationOriginalHandler(event, method, ...args);
    });
  });
  try {
    await row(1).click();
    await page.waitForFunction(() => {
      const input = document.querySelector('.composer > .composer-input');
      return !input?.disabled && input.value === 'Retained draft one' &&
        document.querySelector('.composer-wrap')?.getAttribute('aria-busy') === 'true';
    });
    await page.getByRole('textbox', { name: '消息', exact: true }).fill('Edited while failed target was opening');
    await app.evaluate(() => globalThis.navigationReleaseFailure());
    await page.getByRole('alert').filter({ hasText: 'NAVIGATION_DOUBLE_FAILURE' }).waitFor();
    await page.waitForFunction(() => {
      const input = document.querySelector('.composer > .composer-input');
      return !input?.disabled && input?.value === 'Retained draft zero';
    });
    assert.equal(await app.evaluate(() => globalThis.navigationSnapshotFailures), 1);
  } finally {
    await app.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler('desktop');
      ipcMain.handle('desktop', globalThis.navigationOriginalHandler);
      delete globalThis.navigationOriginalHandler;
      delete globalThis.navigationReleaseFailure;
    });
  }
  await opened(0);
  await row(1).click();
  await opened(1);
  assert.equal(await page.getByRole('textbox', { name: '消息', exact: true }).evaluate(element => element.value),
    'Edited while failed target was opening', 'Failed navigation preserves the target draft independently');
  await row(0).click();
  await opened(0);
  await row(2).click();
  await opened(2);
  await row(0).click();
  await opened(0);
  assert.equal(await page.getByRole('textbox', { name: '消息', exact: true }).evaluate(element => element.value),
    'Retained draft zero', 'Failed target preview must not overwrite the source draft or its later cache');
  phase = 'cold failure retains authoritative identity';
  await rename(failureProject, `${failureProject}-unavailable`);
  try {
    await row(5).click();
    await page.getByRole('alert').filter({ hasText: /项目目录不可用|directory|unavailable/i }).waitFor({ timeout: 60000 });
    await opened(0);
  } finally { await rename(`${failureProject}-unavailable`, failureProject); }
  await row(5).click();
  await opened(5);
  assert.equal((await page.evaluate(() => window.desktop.snapshot())).workspaceIssue, undefined,
    'restoring the original directory clears its stored warning');
  await page.reload();
  await opened(5);
  await page.getByRole('alert').filter({ hasText: /项目目录不可用|directory|unavailable/i }).waitFor({ state: 'hidden' });
  phase = 'disconnected resident history recovery';
  const crashed = await page.evaluate(() => window.desktop.snapshot());
  await page.evaluate(() => {
    window.navigationExits = [];
    window.stopNavigationExits = window.desktop.onEvent(event => {
      if (event.type === 'desktop_exit') window.navigationExits.push(event.runtimeId);
    });
  });
  const mainPid = await app.evaluate(() => process.pid);
  const crashedPids = (() => {
    const script = `Get-CimInstance Win32_Process | Where-Object { $_.ParentProcessId -eq ${mainPid} -and $_.Name -eq "node.exe" -and $_.CommandLine -like "*step.js*" -and $_.CommandLine -like "*--mode*rpc*" } | Select-Object -ExpandProperty ProcessId | ConvertTo-Json -Compress`;
    const result = JSON.parse(execFileSync('powershell.exe', ['-NoProfile', '-Command', script], { encoding: 'utf8', windowsHide: true }) || '[]');
    const pids = Array.isArray(result) ? result : [result];
    for (const pid of pids) execFileSync('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { windowsHide: true });
    return pids;
  })();
  assert.ok(crashedPids.length > 0, 'Only fixture-owned RPC children are terminated');
  await page.waitForFunction(runtimeId => window.navigationExits.includes(runtimeId), crashed.runtimeId);
  await page.evaluate(() => window.stopNavigationExits());
  await row(0).click();
  await opened(0);
  await row(5).click();
  await opened(5);
  const recovered = await page.evaluate(() => window.desktop.snapshot());
  assert.notEqual(recovered.runtimeId, crashed.runtimeId);
  assert.ok(!recovered.runtimes.some(runtime => runtime.runtimeId === crashed.runtimeId));
  phase = 'late preview cannot overwrite a ready or different session';
  await page.reload();
  await opened(5);
  await app.evaluate(({ ipcMain }) => {
    globalThis.navigationOriginalHandler = ipcMain._invokeHandlers.get('desktop');
    globalThis.navigationGate = new Promise(resolve => { globalThis.navigationRelease = resolve; });
    globalThis.navigationReadingHeld = false;
    ipcMain.removeHandler('desktop');
    ipcMain.handle('desktop', async (event, method, ...args) => {
      const result = await globalThis.navigationOriginalHandler(event, method, ...args);
      if (method === 'sessionReading') {
        globalThis.navigationReadingHeld = true;
        await globalThis.navigationGate;
        return { ...result, sessionId: args[0], version: 'obsolete',
          messages: [{ role: 'user', content: 'LATE_STALE_PREVIEW_MUST_NOT_PAINT' }] };
      }
      return result;
    });
  });
  try {
    await row(1).click();
    await opened(1);
    assert.equal(await app.evaluate(() => globalThis.navigationReadingHeld), true);
    await row(0).click();
    await opened(0);
    await app.evaluate(() => globalThis.navigationRelease());
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.ok(!(await page.locator('.messages').textContent()).includes('LATE_STALE_PREVIEW'));
    assert.equal((await page.evaluate(() => window.desktop.snapshot())).state.sessionId, 'navigation-0');
  } finally {
    await app.evaluate(({ ipcMain }) => {
      globalThis.navigationRelease?.();
      ipcMain.removeHandler('desktop');
      ipcMain.handle('desktop', globalThis.navigationOriginalHandler);
    });
  }
  phase = 'optional reading failure falls back to authoritative startup';
  await page.reload();
  await opened(0);
  await app.evaluate(({ ipcMain }) => {
    globalThis.navigationOriginalHandler = ipcMain._invokeHandlers.get('desktop');
    ipcMain.removeHandler('desktop');
    ipcMain.handle('desktop', (event, method, ...args) => {
      if (method === 'sessionReading') throw new Error('OPTIONAL_READING_UNAVAILABLE');
      return globalThis.navigationOriginalHandler(event, method, ...args);
    });
  });
  try {
    await row(2).click();
    await opened(2);
    assert.ok(!(await page.locator('body').textContent()).includes('OPTIONAL_READING_UNAVAILABLE'));
  } finally {
    await app.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler('desktop');
      ipcMain.handle('desktop', globalThis.navigationOriginalHandler);
    });
  }
  await row(5).click();
  await opened(5);
  phase = 'dark narrow and reduced motion';
  await page.evaluate(() => window.desktop.preferences({ theme: 'dark' }));
  await page.reload();
  await opened(5);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(700, 700));
  await page.screenshot({ path: 'test-results/session-navigation-dark-narrow.png' });
  assert.deepEqual(errors, []);
  console.log('Session navigation passed: latest-target commits, two-startup resident bypass, bounded background recycling, locked billing changes, interactive read-only history, isolated editable drafts, caret handoff, anchors, failure recovery and narrow/reduced-motion layout.');
} catch (error) {
  console.error('Navigation acceptance failed during:', phase);
  const page = await app.firstWindow().catch(() => null);
  if (page) {
    await page.screenshot({ path: 'test-results/session-navigation-failure.png' }).catch(() => {});
    console.error(await page.evaluate(() => ({
      title: document.querySelector('.window-session-title')?.textContent,
      error: document.querySelector('.app-error-banner')?.textContent,
      selected: document.querySelector('.session-row.selected')?.dataset.reorderId,
    })).catch(() => null));
  }
  throw error;
} finally { await closeDesktopFixture(app); }
