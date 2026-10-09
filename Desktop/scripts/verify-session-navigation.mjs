import { _electron as electron } from 'playwright';
import { mkdir, mkdtemp, realpath, writeFile, rename } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

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
      message: { role: 'assistant', content: [{ type: 'text', text: `Answer ${index}/${turn}. ` + 'A readable history paragraph with stable message identity.\n\n'.repeat(3) }],
        api: 'openai-completions', provider: 'fixture', model: 'fixture', stopReason: 'stop',
        usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
        timestamp: Date.parse(timestamp) } });
    parentId = assistantId;
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
    const window = BrowserWindow.getAllWindows()[0];
    window.setOpacity(0); window.setIgnoreMouseEvents(true); window.showInactive();
    dialog.showMessageBox = async () => ({ response: 1 });
  });
  await page.waitForFunction(() => document.querySelectorAll('.session-row').length === 6 && !document.querySelector('.new-chat')?.disabled, undefined, { timeout: 60000 });
  const row = index => page.locator(`[data-reorder-id="navigation-${index}"] > button`).first();
  const opened = async index => {
    await page.waitForFunction(index => document.querySelector('.window-session-title')?.textContent === `Navigation ${index}` &&
      !document.querySelector('.composer > textarea')?.disabled, index, { timeout: 60000 });
    assert.equal((await page.evaluate(() => window.desktop.snapshot())).state.sessionId, `navigation-${index}`);
  };
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
      sendingDisabled: document.querySelector('.composer > textarea')?.disabled,
    };
  });
  await opened(3);
  assert.ok(!(await page.locator('.messages').textContent()).includes('Answer 0/'));
  phase = 'draft and reading anchor';
  await row(0).click();
  await opened(0);
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
        inert: preview.inert, disabled: document.querySelector('.composer > textarea').disabled,
        text: preview.textContent.includes('Answer 0/'),
      });
    });
    observer.observe(document.body, { subtree: true, childList: true, attributes: true });
    window.navigationPreviewObserver = observer;
    document.querySelector('[data-reorder-id="navigation-0"] > button').click();
  });
  await opened(0);
  const preview = await page.evaluate(() => { window.navigationPreviewObserver.disconnect(); return window.previewEvidence; });
  assert.ok(preview.some(value => value.inert && value.disabled && value.text), 'Recycled history appears as an inert cached transcript before reconnection');
  assert.equal(await page.getByRole('textbox', { name: '消息', exact: true }).inputValue(), 'Retained draft zero');
  const restored = await page.evaluate(() => {
    const viewport = document.querySelector('#conversation-scroll');
    const article = document.querySelector('.messages > article[data-message-index="12"]');
    return article.getBoundingClientRect().top - viewport.getBoundingClientRect().top;
  });
  assert.ok(Math.abs(restored - reading.offset) < 3, `Reading anchor drifted: ${restored} vs ${reading.offset}`);
  await page.screenshot({ path: 'test-results/session-navigation-light.png' });
  phase = 'cold failure retains authoritative identity';
  await rename(failureProject, `${failureProject}-unavailable`);
  try {
    await row(5).click();
    await page.getByRole('alert').filter({ hasText: /ENOENT|directory|unavailable/i }).waitFor({ timeout: 60000 });
    await opened(0);
  } finally { await rename(`${failureProject}-unavailable`, failureProject); }
  await row(5).click();
  await opened(5);
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
  phase = 'dark narrow and reduced motion';
  await page.evaluate(() => window.desktop.preferences({ theme: 'dark' }));
  await page.reload();
  await opened(5);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(700, 700));
  await page.screenshot({ path: 'test-results/session-navigation-dark-narrow.png' });
  assert.deepEqual(errors, []);
  console.log('Session navigation passed: latest-target commits, cold preparation, inert reading cache, recycling, drafts, anchors, failure recovery and narrow/reduced-motion layout.');
} catch (error) {
  console.error('Navigation acceptance failed during:', phase);
  const page = await app.firstWindow().catch(() => null);
  if (page) {
    await page.screenshot({ path: 'test-results/session-navigation-failure.png' }).catch(() => {});
    console.error(await page.evaluate(() => ({
      title: document.querySelector('.window-session-title')?.textContent,
      error: document.querySelector('.error-banner')?.textContent,
      selected: document.querySelector('.session-row.selected')?.dataset.reorderId,
    })).catch(() => null));
  }
  throw error;
} finally { await app.close(); }
