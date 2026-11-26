import assert from 'node:assert/strict';
import { appendFile, mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { gunzipSync } from 'node:zlib';
import { _electron as electron } from 'playwright';
import { closeDesktopFixtureAndWait } from './close-desktop-fixture.mjs';
import { mkdtemp, removeTestProfile } from './test-profile.mjs';

const profile = await mkdtemp(join(tmpdir(), 'dfsc-feedback-electron-'));
const project = join(profile, 'project'), root = join(profile, 'step-runtime'), sessions = join(root, 'sessions');
let app;
try {
  await mkdir(project);
  await mkdir(sessions, { recursive: true });
  await writeFile(join(profile, 'preferences.json'), JSON.stringify({ language: 'zh', theme: 'light', workspace: project, workspaces: [project] }));
  await writeFile(join(root, 'config.toml'), 'defaultProvider = "fixture"\ndefaultModel = "fixture"\n[telemetry]\nenabled = false\n[mcp_servers.steppage__steppage]\nenabled = false\n');
  await writeFile(join(root, 'models.json'), JSON.stringify({ providers: { fixture: { baseUrl: 'http://127.0.0.1:1/v1',
    api: 'openai-completions', apiKey: 'fixture', models: [{ id: 'fixture', name: 'Fixture' }] } } }));
  const stamp = '2026-01-01T00:00:00Z';
  const msg = (role, content) => ({ role, content, timestamp: Date.parse(stamp) });
  for (const id of ['A', 'B']) {
    const rows = [
      { type: 'session', version: 3, id, cwd: project, timestamp: stamp },
      { type: 'message', id: 'u', parentId: null, message: msg('user', 'MARKER_' + id + '\nAPI_KEY=private_fixture') },
      { type: 'message', id: 't', parentId: 'u', message: { ...msg('toolResult', [{ type: 'text', text: 'Failed step. PRIVATE_OUTPUT_TAIL' }]), toolCallId: 'call', toolName: 'fixture', isError: true } },
      { type: 'custom', id: 'req', parentId: 't', customType: 'step.usage_provenance', data: { requestId: 'req-' + id } },
      { type: 'session_info', id: 'name', parentId: 'req', name: 'Feedback ' + id },
    ];
    await writeFile(join(sessions, id + '.jsonl'), rows.map(r => JSON.stringify({ timestamp: stamp, ...r })).join('\n') + '\n');
  }
  const env = { ...process.env, DESKTOP_TEST_USER_DATA: profile, DESKTOP_TEST_NO_FOCUS: '1' };
  delete env.ELECTRON_RUN_AS_NODE;
  const args = [...(process.env.DESKTOP_ELECTRON_HEADLESS ? ['--ozone-platform=headless', '--no-sandbox', '--disable-gpu'] : []), resolve(process.env.DESKTOP_TEST_ENTRY ?? '.')];
  app = await electron.launch({ ...(process.env.DESKTOP_VERIFY_EXE
    ? { executablePath: process.env.DESKTOP_VERIFY_EXE } : { args, executablePath: process.env.DESKTOP_TEST_ELECTRON }),
    env, timeout: 60000 });
  const page = await app.firstWindow();
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('index.html')) ?? BrowserWindow.getAllWindows()[0];
    win.setSize(1440, 960); win.showInactive();
  });
  page.setDefaultTimeout(35000);
  const choose = id => page.locator('[data-reorder-kind="session"][data-reorder-id="' + id + '"] button').first().click();
  await choose('A');
  const open = async () => {
    await page.getByRole('button', { name: '更多会话操作' }).click();
    await page.getByRole('menuitemradio', { name: '导出反馈包' }).click();
  };
  const dialog = page.getByRole('dialog', { name: '导出反馈包' });
  const output = join(profile, 'output');
  await mkdir(output);
  const target = join(output, 'saved.gz');
  const saveAs = canceled => app.evaluate(({ dialog }, args) => {
    dialog.showSaveDialog = async () => ({ canceled: args.canceled, filePath: args.target });
  }, { canceled, target });
  // No HTTP(S) from the renderer or Electron network stack while exporting.
  await app.evaluate(({ session }) => {
    globalThis.feedbackNetworkRequests = 0;
    session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_details, done) => {
      globalThis.feedbackNetworkRequests++;
      done({ cancel: true });
    });
  });
  await open();
  await dialog.getByRole('button', { name: '取消' }).click();
  await open();
  await dialog.getByLabel('预期行为').fill('Synthetic expected');
  await dialog.getByRole('button', { name: '预览' }).click();
  const minimal = await dialog.locator('pre').innerText();
  assert.match(minimal, /req-A/);
  assert.doesNotMatch(minimal, /MARKER_|private_fixture|Failed step/);
  assert.equal(JSON.parse(minimal).diagnostics.errorAt, new Date(stamp).toISOString());
  await saveAs(true);
  await dialog.getByRole('button', { name: '另存为…' }).click();
  assert.deepEqual(await readdir(output), []);
  await saveAs(false);
  await dialog.getByRole('button', { name: '另存为…' }).click();
  await dialog.waitFor({ state: 'hidden' });
  assert.equal(gunzipSync(await readFile(target)).toString(), minimal);
  await open();
  await dialog.getByLabel('包含相关会话片段').check();
  await dialog.getByLabel('包含失败工具输出片段').check();
  await dialog.getByRole('button', { name: '预览' }).click();
  const expanded = await dialog.locator('pre').innerText();
  assert.match(expanded, /MARKER_A/);
  assert.match(expanded, /Failed step/);
  assert.doesNotMatch(expanded, /MARKER_B|private_fixture|PRIVATE_OUTPUT_TAIL/);
  await appendFile(join(sessions, 'A.jsonl'), JSON.stringify({ type: 'message', id: 'late', parentId: 'name', timestamp: stamp,
    message: msg('user', 'LATE_A') }) + '\n');
  await dialog.getByRole('button', { name: '另存为…' }).click();
  await dialog.waitFor({ state: 'hidden' });
  assert.equal(gunzipSync(await readFile(target)).toString(), expanded);
  const stale = await page.evaluate(async () => {
    const s = await window.desktop.snapshot();
    const p = await window.desktop.previewFeedback(s.runtimeId, s.state.sessionId, { expected: '', actual: '', conversation: true, tools: false });
    return [s.runtimeId, s.state.sessionId, p.token];
  });
  await choose('B');
  await page.getByRole('button', { name: '更多会话操作' }).waitFor();
  assert.equal(await page.evaluate(async () => (await window.desktop.snapshot()).state?.sessionId), 'B');
  await assert.rejects(page.evaluate(args => window.desktop.saveFeedback(...args), stale));
  assert.equal(gunzipSync(await readFile(target)).toString(), expanded);
  await open();
  await dialog.getByLabel('包含相关会话片段').check();
  await dialog.getByRole('button', { name: '预览' }).click();
  const next = await dialog.locator('pre').innerText();
  assert.match(next, /MARKER_B/);
  assert.doesNotMatch(next, /MARKER_A|req-A|LATE_A/);
  assert.equal(await app.evaluate(() => globalThis.feedbackNetworkRequests), 0);
  console.log('Electron conversation menu, native IPC, current session, cancellation and archive checks passed.');
} finally {
  if (app) await closeDesktopFixtureAndWait(app);
  await removeTestProfile(profile);
}
