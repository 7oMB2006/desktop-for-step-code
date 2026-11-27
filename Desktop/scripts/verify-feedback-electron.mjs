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
  const screenshot = (page, name) => process.env.DESKTOP_FEEDBACK_SCREENSHOTS
    ? page.screenshot({ path: join(process.env.DESKTOP_FEEDBACK_SCREENSHOTS, name + '.png') }) : undefined;
  for (const id of ['A', 'B']) {
    const request = (entry, reply, parentId, statusCode) => ({ type: 'custom', id: entry, parentId, customType: 'step.usage_provenance',
      data: { sessionId: id, originSessionId: id, usageEntryId: reply, requestId: entry + '-' + id, statusCode,
        responseProvider: 'fixture', responseModel: 'concrete-fixture', outcome: statusCode === 429 ? 'http_error' : 'ok' } });
    const trace = (entry, parentId, data) => ({ type: 'custom', id: entry, parentId, customType: 'step.tool_execution',
      data: { version: 1, toolCallId: 'call', ...data } });
    const rows = [
      { type: 'session', version: 3, id, cwd: project, timestamp: stamp },
      { type: 'message', id: 'u', parentId: null, message: msg('user', 'MARKER_' + id + '\nAPI_KEY=private_fixture') },
      { type: 'message', id: 'call-reply', parentId: 'u', message: { ...msg('assistant',
        [{ type: 'toolCall', id: 'call', name: 'fixture', arguments: { private: 'PRIVATE_TOOL_ARG' } }]),
      provider: 'fixture', model: 'fixture', stopReason: 'toolUse' } },
      trace('start', 'call-reply', { phase: 'start', startedAt: Date.parse(stamp), assistantEntryId: 'call-reply' }),
      trace('error-one', 'start', { phase: 'end', endedAt: Date.parse(stamp) + 1000, outcome: 'error' }),
      trace('error-two', 'error-one', { phase: 'end', endedAt: Date.parse(stamp) + 2000, outcome: 'timeout' }),
      trace('error-three', 'error-two', { phase: 'end', endedAt: Date.parse(stamp) + 3000, outcome: 'error' }),
      { type: 'message', id: 't', parentId: 'error-three', message: { ...msg('toolResult', [{ type: 'text', text: 'Failed step. PRIVATE_OUTPUT_TAIL' }]), toolCallId: 'call', toolName: 'fixture', isError: true } },
      { type: 'message', id: 'edit-reply', parentId: 't', message: msg('assistant', [{ type: 'toolCall', id: 'edit', name: 'edit_file' }]) },
      trace('edit-skipped', 'edit-reply', { toolCallId: 'edit', phase: 'end', endedAt: Date.parse(stamp) + 4000,
        outcome: 'not_run', notRunReason: 'invalid_arguments' }),
      { type: 'message', id: 'fail', parentId: 'edit-skipped', message: { ...msg('assistant', []), provider: 'fixture', model: 'fixture',
        stopReason: 'error', errorMessage: 'HTTP 429: fixture response error' } },
      request('req', 'fail', 'fail', 429),
      { type: 'message', id: 'retry-input', parentId: 'req', message: msg('user', 'Try again') },
      { type: 'message', id: 'retry', parentId: 'retry-input', message: { ...msg('assistant', [{ type: 'text', text: 'Retry succeeded.' }]),
        provider: 'fixture', model: 'fixture', stopReason: 'stop' } },
      request('req-retry', 'retry', 'retry', 200),
      { type: 'session_info', id: 'name', parentId: 'req-retry', name: 'Feedback ' + id },
    ];
    if (id === 'B') rows.push(
      { type: 'message', id: 'third-input', parentId: 'name', message: msg('user', 'Later selected turn') },
      { type: 'message', id: 'third', parentId: 'third-input', message: msg('assistant', 'Selected reply') },
    );
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
    win.setSize(1440, 960);
    win.setOpacity(0);
    win.setIgnoreMouseEvents(true);
    win.showInactive();
  });
  page.setDefaultTimeout(35000);
  const choose = id => page.locator('[data-reorder-kind="session"][data-reorder-id="' + id + '"] button').first().click();
  const menuTrigger = page.locator(process.platform === 'darwin' ? '[data-menu="application"]' : '[data-menu="help"]');
  const feedbackAction = page.getByRole('menuitem', { name: '导出当前会话反馈包' });
  await choose('A');
  const open = async () => {
    await menuTrigger.click();
    await feedbackAction.click();
  };
  assert.equal(await page.getByRole('button', { name: '更多会话操作' }).count(), 0);
  const dialog = page.getByRole('dialog', { name: '导出反馈包' });
  const rawJson = dialog.getByText('查看原始 JSON', { exact: true });
  const inspectJson = async () => {
    await rawJson.click();
    const raw = await dialog.locator('pre').innerText();
    await rawJson.click();
    return raw;
  };
  const output = join(profile, 'output');
  await mkdir(output);
  const target = join(output, 'saved.gz');
  const downloads = join(profile, 'Downloads');
  await mkdir(downloads);
  await app.evaluate(({ app }, path) => app.setPath('downloads', path), downloads);
  const defaultDirectory = join(downloads, 'Desktop for Step Code Feedback');
  const saveAs = canceled => app.evaluate(({ dialog }, args) => {
    dialog.showSaveDialog = async () => {
      globalThis.feedbackChooserCalls = (globalThis.feedbackChooserCalls ?? 0) + 1;
      return { canceled: args.canceled, filePath: args.target };
    };
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
  assert.equal(await menuTrigger.evaluate(button => button === document.activeElement), true);
  await open();
  await dialog.getByLabel('预期行为').fill('Synthetic expected');
  await dialog.getByRole('button', { name: '预览' }).click();
  await dialog.getByRole('heading', { name: '应用记录' }).waitFor();
  assert.equal(await dialog.locator('pre').isVisible(), false);
  assert.match(await dialog.locator('.feedback-summary').innerText(), /回复失败[\s\S]*concrete-fixture[\s\S]*429[\s\S]*req-A/);
  assert.match(await dialog.locator('.feedback-summary').innerText(), /未包含会话正文或错误文本片段/);
  await dialog.getByText('edit_file · 参数校验失败: 1', { exact: true }).waitFor();
  const errorRows = dialog.locator('.feedback-event-heading strong').filter({ hasText: /工具调用 1 · (失败|超时)/ });
  assert.deepEqual(await errorRows.allTextContents(), ['工具调用 1 · 失败', '工具调用 1 · 超时', '工具调用 1 · 失败']);
  await screenshot(page, 'feedback-evidence-light');
  const minimal = await inspectJson();
  assert.equal(await dialog.locator('.feedback-destination code').innerText(), defaultDirectory);
  await assert.rejects(readdir(defaultDirectory), { code: 'ENOENT' });
  assert.match(minimal, /req-A/);
  assert.doesNotMatch(minimal, /MARKER_|private_fixture|PRIVATE_TOOL_ARG|Failed step|req-retry|fixture response error/);
  assert.equal(JSON.parse(minimal).events.at(-1).at, new Date(stamp).toISOString());
  assert.equal(JSON.parse(minimal).summary.toolErrors, 3);
  assert.deepEqual(JSON.parse(minimal).summary.toolIssueGroups, [
    { toolName: null, result: 'error', count: 2 },
    { toolName: null, result: 'timeout', count: 1 },
    { toolName: 'edit_file', result: 'not_run', notRunReason: 'invalid_arguments', count: 1 },
  ]);
  await saveAs(true);
  await dialog.getByRole('button', { name: '另存为…' }).click();
  await dialog.getByRole('button', { name: '另存为…' }).and(page.locator(':enabled')).waitFor();
  assert.deepEqual(await readdir(output), []);
  await saveAs(false);
  await dialog.getByRole('button', { name: '另存为…' }).click();
  await dialog.waitFor({ state: 'hidden' });
  await page.getByText('反馈包已保存，未发送', { exact: true }).waitFor();
  assert.equal(gunzipSync(await readFile(target)).toString(), minimal);
  await open();
  await dialog.getByLabel('会话范围').selectOption('current');
  await dialog.getByRole('button', { name: '预览' }).click();
  const current = JSON.parse(await inspectJson());
  assert.equal(current.events.length, 1);
  assert.equal(current.events[0].result, 'reply');
  assert.equal(current.events[0].requestId, 'req-retry-A');
  await dialog.getByRole('button', { name: '返回编辑' }).click();
  await dialog.getByLabel('会话范围').selectOption('failure');
  const date = dialog.getByRole('textbox', { name: '出错日期' });
  const time = dialog.getByRole('textbox', { name: '出错时刻' });
  const calendar = dialog.getByRole('dialog', { name: '选择日期' });
  const calendarTrigger = dialog.getByRole('button', { name: '选择日期' });
  await calendarTrigger.hover();
  assert.ok(await calendarTrigger.evaluate(button => {
    const box = button.getBoundingClientRect();
    const field = button.parentElement.getBoundingClientRect();
    const icon = button.querySelector('svg').getBoundingClientRect();
    return box.left > field.left && box.right < field.right && box.top > field.top && box.bottom < field.bottom
      && Math.abs(box.top + box.height / 2 - field.top - field.height / 2) < 1
      && Math.abs(icon.top + icon.height / 2 - field.top - field.height / 2) < 1;
  }), 'Calendar trigger and icon stay centered inside the date field, including on hover');
  await date.focus();
  assert.ok(await date.evaluate(input => getComputedStyle(input).outlineStyle === 'none'
    && getComputedStyle(input.parentElement).outlineStyle === 'solid'), 'Date text focus belongs to the shared field border');
  await date.press('Tab');
  assert.ok(await calendarTrigger.evaluate(button => button.matches(':focus-visible')), 'The inset calendar remains keyboard focusable');
  await date.fill('2026-02-30');
  await time.fill('14:35');
  await dialog.getByRole('button', { name: '预览' }).click();
  assert.match(await dialog.getByRole('alert').innerText(), /有效的日期/);
  await date.fill('2026-02-26');
  await calendarTrigger.click();
  await calendar.getByRole('button', { name: '2026-02-26' }).press('ArrowRight');
  await calendar.getByRole('button', { name: '2026-02-27' }).and(page.locator(':focus')).waitFor();
  await calendar.getByRole('button', { name: '2026-02-28' }).click();
  assert.equal(await date.inputValue(), '2026-02-28');
  assert.equal(await time.inputValue(), '14:35');
  await calendarTrigger.click();
  await calendar.getByRole('button', { name: '2026-02-28' }).press('Escape');
  await calendar.waitFor({ state: 'hidden' });
  await date.fill('2026-03-03');
  await time.fill('15:42');
  await dialog.getByLabel('包含相关会话片段').check();
  await dialog.getByLabel('包含失败工具输出片段').check();
  await dialog.getByRole('button', { name: '预览' }).click();
  const expanded = await inspectJson();
  assert.match(expanded, /MARKER_A/);
  assert.match(expanded, /Failed step/);
  assert.doesNotMatch(expanded, /MARKER_B|private_fixture|PRIVATE_OUTPUT_TAIL/);
  assert.equal(JSON.parse(expanded).reportedAt, await page.evaluate(() => new Date(2026, 2, 3, 15, 42).toISOString()));
  assert.equal(JSON.parse(expanded).events.at(-1).at, new Date(stamp).toISOString());
  assert.match(await dialog.locator('.feedback-summary').innerText(), /你填写的时间[\s\S]*事件记录/);
  await dialog.getByRole('button', { name: '返回编辑' }).click();
  assert.equal(await date.inputValue(), '2026-03-03');
  assert.equal(await time.inputValue(), '15:42');
  await dialog.getByRole('button', { name: '预览' }).click();
  const confirmed = await inspectJson();
  await appendFile(join(sessions, 'A.jsonl'), JSON.stringify({ type: 'message', id: 'late', parentId: 'name', timestamp: stamp,
    message: msg('user', 'LATE_A') }) + '\n');
  await dialog.getByRole('button', { name: '保存到默认目录' }).click();
  await dialog.waitFor({ state: 'hidden' });
  assert.equal(await app.evaluate(() => globalThis.feedbackChooserCalls), 2);
  const [first, ...extra] = await readdir(defaultDirectory);
  assert.deepEqual(extra, []);
  assert.match(first, /^dfsc-feedback-.*\.json\.gz$/);
  assert.equal(gunzipSync(await readFile(join(defaultDirectory, first))).toString(), confirmed);
  await app.evaluate(({ shell }) => {
    shell.openPath = async path => { globalThis.feedbackRevealedFolder = path; return ''; };
  });
  await page.getByRole('button', { name: '打开目录' }).click();
  assert.equal(await app.evaluate(() => globalThis.feedbackRevealedFolder), defaultDirectory);
  const stale = await page.evaluate(async () => {
    const s = await window.desktop.snapshot();
    const p = await window.desktop.previewFeedback(s.runtimeId, s.state.sessionId, { expected: '', actual: '', conversation: true, tools: false });
    return [s.runtimeId, s.state.sessionId, p.token];
  });
  await choose('B');
  await page.locator('.window-session-title').filter({ hasText: 'Feedback B' }).waitFor();
  await menuTrigger.click();
  await feedbackAction.and(page.locator(':enabled')).waitFor();
  await menuTrigger.click();
  assert.equal(await page.evaluate(async () => (await window.desktop.snapshot()).state?.sessionId), 'B');
  await assert.rejects(page.evaluate(args => window.desktop.saveFeedback(...args, 'default'), stale));
  assert.deepEqual(await readdir(defaultDirectory), [first]);
  assert.equal(gunzipSync(await readFile(target)).toString(), minimal);
  await open();
  await dialog.getByLabel('包含相关会话片段').check();
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window =>
    window.webContents.getURL().includes('index.html')).setSize(700, 640));
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
  await dialog.getByRole('button', { name: '预览' }).click();
  await dialog.getByRole('heading', { name: '应用记录' }).waitFor();
  assert.ok(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth + 1), 'Preview does not overflow horizontally');
  assert.ok(await dialog.getByRole('button', { name: '保存到默认目录' }).evaluate(button => {
    const box = button.getBoundingClientRect();
    return box.top >= 0 && box.bottom <= window.innerHeight;
  }), 'Save remains in view while the preview body scrolls');
  assert.ok(await page.evaluate(() => window.innerWidth <= 720 && document.documentElement.dataset.theme === 'dark'));
  await screenshot(page, 'feedback-evidence-dark');
  const next = await inspectJson();
  assert.match(next, /MARKER_B/);
  assert.doesNotMatch(next, /MARKER_A|req-A|LATE_A/);
  await dialog.getByRole('button', { name: '返回编辑' }).click();
  await dialog.getByLabel('会话范围').selectOption('history');
  const picker = dialog.getByRole('group', { name: '已记录轮次' });
  await picker.getByRole('checkbox', { name: /第 1 轮/ }).waitFor();
  assert.equal(await picker.locator('input:checked').count(), 0);
  assert.equal(await dialog.getByRole('button', { name: '预览' }).isDisabled(), true);
  await picker.getByRole('button', { name: '勾选最近 1 个异常' }).click();
  await picker.getByRole('button', { name: '全部', exact: true }).click();
  await picker.getByRole('checkbox', { name: /第 3 轮/ }).check();
  await picker.getByRole('button', { name: '已选', exact: true }).click();
  assert.equal(await picker.locator('.feedback-turn-list input:checked').count(), 2);
  const gap = picker.getByRole('checkbox', { name: /附上中间轮次的摘要/ });
  assert.equal(await gap.isChecked(), false);
  await screenshot(page, 'feedback-history-dark');
  await dialog.getByRole('button', { name: '预览' }).click();
  const sparse = JSON.parse(await inspectJson());
  assert.equal(sparse.format, 'dfsc-local-feedback-v4');
  assert.deepEqual(sparse.gaps, [{ after: 1, before: 2, count: 1, overview: null }]);
  await dialog.getByRole('button', { name: '返回编辑' }).click();
  await gap.check();
  await dialog.getByRole('button', { name: '预览' }).click();
  await dialog.locator('.feedback-gap').filter({ hasText: '中间 1 轮，仅附摘要' }).waitFor();
  await screenshot(page, 'feedback-history-preview-dark');
  const multi = await inspectJson();
  assert.doesNotMatch(multi, /Retry succeeded|req-retry/);
  assert.match(multi, /MARKER_B[\s\S]*Selected reply/);
  const multiple = JSON.parse(multi);
  assert.equal(multiple.turns.length, 2);
  assert.equal(multiple.gaps[0].overview.unknown, 1);
  assert.equal(multiple.events.at(-1).turn, 2);
  assert.equal(await app.evaluate(() => globalThis.feedbackNetworkRequests), 0);
  await dialog.getByRole('button', { name: '保存到默认目录' }).click();
  await dialog.waitFor({ state: 'hidden' });
  const savedFiles = await readdir(defaultDirectory);
  assert.equal(savedFiles.length, 2);
  assert.equal(gunzipSync(await readFile(join(defaultDirectory, savedFiles.find(name => name !== first)))).toString(), multi);
  await page.locator(process.platform === 'darwin' ? '[data-menu="application"]' : '[data-menu="file"]').click();
  await page.getByRole('menuitem', { name: /^新建会话/ }).click();
  await menuTrigger.click();
  await feedbackAction.and(page.locator(':disabled')).waitFor();
  assert.equal(await feedbackAction.isDisabled(), true);
  assert.equal(await page.getByRole('menuitem', { name: '导出脱敏诊断' }).count(), 0);
  await page.getByRole('menuitem', { name: '设置' }).click();
  await page.getByRole('button', { name: '通用', exact: true }).click();
  await page.locator('[data-settings-anchor="diagnostics"]').and(page.locator(':enabled')).waitFor();
  console.log('Electron Help menu, session isolation, Save As, default archives and folder opening checks passed.');
} finally {
  if (app) await closeDesktopFixtureAndWait(app);
  await removeTestProfile(profile);
}
