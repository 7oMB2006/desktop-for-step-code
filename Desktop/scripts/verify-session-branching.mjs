import { _electron as electron } from 'playwright';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';

const prompts = [];
const streams = [];
const chunk = (delta, finish_reason = null) => `data: ${JSON.stringify({
  id: 'branch-fixture', object: 'chat.completion.chunk', created: 1, model: 'fixture',
  choices: [{ index: 0, delta, finish_reason }],
})}\n\n`;
const server = createServer(async (req, res) => {
  let body = '';
  for await (const part of req) body += part;
  const payload = JSON.parse(body);
  prompts.push(payload.messages);
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  res.write(chunk({ role: 'assistant', content: '分支的新回复。' }));
  streams.push(res);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
// Windows TEMP can use an 8.3 alias; compare session links in the canonical profile.
const profile = await realpath(await mkdtemp(join(tmpdir(), 'desktop-branch-')));
const workspace = join(profile, 'workspace');
const root = join(profile, 'step-runtime');
await mkdir(workspace);
await mkdir(join(root, 'sessions'), { recursive: true });
await mkdir('test-results', { recursive: true });
await writeFile(join(workspace, 'already-changed.txt'), 'Do not roll this back');
await writeFile(join(profile, 'preferences.json'), JSON.stringify({
  language: 'zh', theme: 'light', workspaces: [workspace], workspace,
}));
await writeFile(join(root, 'config.toml'), 'defaultProvider = "fixture"\ndefaultModel = "fixture"\npermissionPreset = "ask"\n[telemetry]\nenabled = false\n');
await writeFile(join(root, 'models.json'), JSON.stringify({
  defaultProvider: 'fixture', defaultModel: 'fixture',
  providers: { fixture: { baseUrl: `http://127.0.0.1:${server.address().port}/v1`, api: 'openai-completions', apiKey: 'local-test-only',
    models: [{ id: 'fixture', name: 'Branch fixture', contextWindow: 32768, maxTokens: 1024, input: ['text', 'image'] }] } },
}));
const image = { type: 'image', mimeType: 'image/png',
  data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==' };
const messages = [
  { role: 'user', content: [{ type: 'text', text: '重复的问题。' }, image], timestamp: 1 },
  { role: 'assistant', content: [{ type: 'text', text: '第一轮旧回复。' }], timestamp: 2 },
  { role: 'user', content: [{ type: 'text', text: '重复的问题。' }, image], timestamp: 3 },
  { role: 'assistant', content: [{ type: 'text', text: '最新一轮旧回复。' }], timestamp: 4 },
];
const sourceFile = join(root, 'sessions', 'branch-source.jsonl');
await writeFile(sourceFile, [
  { type: 'session', version: 3, id: 'branch-source', cwd: workspace, timestamp: new Date().toISOString() },
  { type: 'session_info', id: 'name', parentId: null, name: '分支原会话', timestamp: new Date().toISOString() },
  ...messages.map((message, index) => ({
    type: 'message', id: `m${index}`, parentId: index ? `m${index - 1}` : 'name',
    timestamp: new Date(index + 1).toISOString(), message: message.role === 'assistant'
      ? { ...message, api: 'openai-completions', provider: 'fixture', model: 'fixture', stopReason: 'stop',
        usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } }
      : message,
  })),
].map(entry => JSON.stringify(entry)).join('\n') + '\n');
const coldFile = join(root, 'sessions', 'sidebar-cold-source.jsonl');
await writeFile(coldFile, [
  { type: 'session', version: 3, id: 'sidebar-cold-source', cwd: workspace, timestamp: new Date().toISOString() },
  { type: 'message', id: 'cold-user', parentId: null, timestamp: new Date().toISOString(), message: messages[0] },
  { type: 'session_info', id: 'cold-name', parentId: 'cold-user', timestamp: new Date().toISOString(), name: '冷历史会话' },
].map(entry => JSON.stringify(entry)).join('\n') + '\n');
const env = { ...process.env, DESKTOP_TEST_USER_DATA: profile, DESKTOP_TEST_NO_FOCUS: '1' };
delete env.ELECTRON_RUN_AS_NODE;
let app;
try {
  app = await electron.launch({ ...(process.env.DESKTOP_VERIFY_EXE
    ? { executablePath: process.env.DESKTOP_VERIFY_EXE } : { args: [resolve('.')] }), env, timeout: 60000 });
  const page = await app.firstWindow();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    window.setOpacity(0); window.setIgnoreMouseEvents(true); window.showInactive(); window.setSize(1200, 850);
  });
  await page.getByText('Step Code 已连接', { exact: true }).waitFor({ timeout: 60000 });
  const initialView = await page.evaluate(() => window.desktop.snapshot());
  assert.ok(!initialView.runtimes.some(runtime => runtime.sessionId === 'sidebar-cold-source'));
  const coldBytes = await readFile(coldFile);
  const composer = page.getByRole('textbox', { name: '消息', exact: true });
  await composer.fill('保留当前会话的草稿');
  await assert.rejects(page.evaluate(() => window.desktop.cloneSession('unknown-session')), /saved/);
  assert.equal((await page.evaluate(() => window.desktop.snapshot())).runtimeId, initialView.runtimeId);
  const coldRow = () => page.locator('[data-reorder-kind="session"][data-reorder-id="sidebar-cold-source"]').locator('button').first();
  await coldRow().click({ button: 'right' });
  const sidebarBranch = page.getByRole('menuitem', { name: '分支', exact: true });
  assert.equal(await sidebarBranch.isEnabled(), true);
  await page.mouse.move(10, 10);
  await page.screenshot({ path: 'test-results/branch-sidebar-menu.png' });
  await sidebarBranch.click();
  await page.waitForFunction(() => document.querySelector('.window-session-title')?.textContent === '冷历史会话 · 分支');
  const coldClone = await page.evaluate(() => window.desktop.snapshot());
  assert.notEqual(coldClone.state.sessionId, 'sidebar-cold-source');
  assert.equal(coldClone.messages.length, 1, 'whole-session branch supports a latest user message and metadata leaf');
  assert.deepEqual(coldClone.messages[0].content, messages[0].content);
  assert.equal(coldClone.permissionPreset, 'ask');
  const coldHeader = JSON.parse((await readFile(coldClone.state.sessionFile, 'utf8')).split('\n')[0]);
  assert.equal(coldHeader.parentSession, coldFile);
  assert.ok(coldBytes.equals(await readFile(coldFile)));
  assert.ok(!coldClone.runtimes.some(runtime => runtime.sessionId === 'sidebar-cold-source'), 'cold source must not be activated');
  assert.equal(await composer.inputValue(), '');
  await page.screenshot({ path: 'test-results/branch-sidebar-created.png' });
  await page.locator(`[data-reorder-kind="session"][data-reorder-id="${initialView.state.sessionId}"]`).locator('button').first().click();
  await page.waitForFunction(() => document.querySelector('.composer > textarea')?.value === '保留当前会话的草稿');
  const originalRow = () => page.locator('.session-row').filter({ hasText: /^分支原会话$/ }).locator('button').first();
  await page.waitForFunction(() => document.querySelector('.new-chat')?.disabled === false);
  await originalRow().click();
  await page.getByText('最新一轮旧回复。', { exact: true }).waitFor().catch(async error => {
    console.log('Branch fixture navigation:', await page.evaluate(async () => ({
      error: document.querySelector('.error-banner')?.textContent,
      transcript: document.querySelector('.messages')?.textContent,
      snapshot: await window.desktop.snapshot().catch(error => String(error)),
    })));
    await page.screenshot({ path: 'test-results/branch-navigation-failed.png' });
    throw error;
  });
  const snapshot = () => page.evaluate(() => window.desktop.snapshot());
  await page.evaluate(id => window.desktop.command('set_permission_preset', { preset: 'read-only' }, id), (await snapshot()).runtimeId);
  const source = await snapshot();
  const sourceBytes = await readFile(sourceFile);
  assert.deepEqual(source.messages.map(message => message.entryId), ['m0', 'm1', 'm2', 'm3']);
  const branchButtons = page.getByRole('button', { name: '从这里分支', exact: true });
  assert.equal(await branchButtons.first().isDisabled(), true);
  assert.equal(await branchButtons.last().isEnabled(), true);
  await assert.rejects(page.evaluate(({ entryId, runtimeId }) => window.desktop.branchSession('clone', entryId, runtimeId),
    { entryId: 'm1', runtimeId: source.runtimeId }), /latest/);
  await assert.rejects(page.evaluate(id => window.desktop.branchSession('fork', 'forged', id), source.runtimeId), /branch point/);
  const input = page.getByRole('textbox', { name: '消息', exact: true });
  await input.fill('保留原会话草稿');
  await branchButtons.last().click();
  await page.waitForFunction(() => document.querySelector('.window-session-title')?.textContent === '分支原会话 · 分支');
  const cloned = await snapshot();
  assert.notEqual(cloned.runtimeId, source.runtimeId);
  assert.notEqual(cloned.state.sessionId, source.state.sessionId);
  assert.equal(cloned.preferences.workspace, source.preferences.workspace);
  assert.equal(cloned.permissionPreset, 'read-only');
  assert.deepEqual(cloned.messages.map(message => message.content), source.messages.map(message => message.content));
  assert.equal(await input.inputValue(), '');
  assert.ok(cloned.runtimes.some(runtime => runtime.runtimeId === source.runtimeId));
  const cloneHeader = (await readFile(cloned.state.sessionFile, 'utf8')).split('\n').map(line => line && JSON.parse(line)).find(entry => entry?.type === 'session');
  assert.equal(cloneHeader.parentSession, sourceFile);
  assert.ok(sourceBytes.equals(await readFile(sourceFile)), 'clone must not rewrite source history');
  await page.locator('.message.assistant').last().hover();
  await page.screenshot({ path: 'test-results/branch-latest-reply.png' });
  await originalRow().click();
  await page.waitForFunction(() => document.querySelector('.composer > textarea')?.value === '保留原会话草稿');
  assert.equal((await snapshot()).runtimeId, source.runtimeId);
  await page.evaluate(id => window.desktop.switchSession(id), cloned.state.sessionId);
  await page.reload();
  await page.getByText('最新一轮旧回复。', { exact: true }).waitFor();
  const editLatest = page.getByRole('button', { name: '编辑并重做', exact: true }).last();
  assert.equal(await page.getByRole('button', { name: '编辑并重做', exact: true }).first().isDisabled(), true);
  await assert.rejects(page.evaluate(id => window.desktop.retryMessage('m0', 'invalid', id), cloned.runtimeId), /most recent/);
  await assert.rejects(page.evaluate(id => window.desktop.retryMessage('forged', 'invalid', id), cloned.runtimeId), /most recent/);
  const beforeEdit = await readFile(cloned.state.sessionFile);
  await input.fill('普通输入框草稿');
  await page.locator('.message.user').last().hover();
  await editLatest.click();
  const editor = page.getByRole('textbox', { name: '编辑消息', exact: true });
  assert.equal(await editor.inputValue(), '重复的问题。');
  assert.equal(await editor.evaluate(element => element === document.activeElement), true);
  assert.equal(await input.inputValue(), '普通输入框草稿');
  assert.equal(await page.locator('.user-message-editor img').count(), 1);
  assert.equal((await snapshot()).messages.length, 4, 'opening edit must retain the old answer');
  assert.ok(beforeEdit.equals(await readFile(cloned.state.sessionFile)));
  await editor.fill('取消这个修改');
  await page.locator('.user-message-editor').getByRole('button', { name: '取消', exact: true }).click();
  assert.equal(await editor.count(), 0);
  assert.ok(beforeEdit.equals(await readFile(cloned.state.sessionFile)));
  assert.equal(prompts.length, 0);
  await page.locator('.message.user').last().hover();
  await editLatest.click();
  assert.equal(await editor.inputValue(), '重复的问题。');
  await editor.fill('修改后的问题。');
  await page.screenshot({ path: 'test-results/branch-edit-inline.png' });
  await page.locator('.user-message-editor').getByRole('button', { name: '发送', exact: true }).click();
  await page.getByText('分支的新回复。', { exact: true }).waitFor();
  const forked = await snapshot();
  assert.equal(forked.state.sessionId, cloned.state.sessionId, 'editing must not create a new conversation');
  assert.equal(forked.runtimeId, cloned.runtimeId, 'editing must retain the worker');
  assert.equal(forked.state.sessionName, cloned.state.sessionName);
  assert.equal(forked.permissionPreset, 'read-only');
  assert.equal(forked.runtimes.length, cloned.runtimes.length);
  assert.equal(await input.inputValue(), '普通输入框草稿');
  assert.equal(prompts.length, 1);
  assert.ok(!JSON.stringify(prompts[0]).includes('最新一轮旧回复'));
  assert.ok(JSON.stringify(prompts[0]).includes('第一轮旧回复'));
  assert.ok(JSON.stringify(prompts[0]).includes('修改后的问题'));
  assert.ok(JSON.stringify(prompts[0]).includes(image.data), 'original images are retained');
  await assert.rejects(page.evaluate(id => window.desktop.retryMessage('m2', 'busy', id), forked.runtimeId), /Stop/);
  await assert.rejects(page.evaluate(({ entryId, runtimeId }) => window.desktop.branchSession('fork', entryId, runtimeId),
    { entryId: 'm0', runtimeId: forked.runtimeId }), /Stop/);
  await assert.rejects(page.evaluate(id => window.desktop.cloneSession(id), forked.state.sessionId), /Stop/);
  assert.equal((await snapshot()).runtimeId, forked.runtimeId);
  await page.locator(`[data-reorder-id="${forked.state.sessionId}"]`).locator('button').first().click({ button: 'right' });
  assert.equal(await sidebarBranch.isDisabled(), true);
  await page.keyboard.press('Escape');
  await originalRow().click({ button: 'right' });
  assert.equal(await sidebarBranch.isEnabled(), true, 'an idle target can be copied while the viewed task runs');
  await sidebarBranch.click();
  await page.waitForFunction(() => document.querySelector('.window-session-title')?.textContent === '分支原会话 · 分支 2');
  assert.equal((await snapshot()).permissionPreset, 'read-only');
  assert.equal((await snapshot()).runtimes.find(runtime => runtime.runtimeId === forked.runtimeId).status, 'running',
    'branching an idle chat must not stop another task');
  streams[0].end(chunk({}, 'stop') + 'data: [DONE]\n\n');
  await page.waitForFunction(async id => (await window.desktop.snapshot()).runtimes.find(runtime => runtime.runtimeId === id).status !== 'running', forked.runtimeId);
  await originalRow().click();
  await page.getByText('最新一轮旧回复。', { exact: true }).waitFor();
  assert.ok(sourceBytes.equals(await readFile(sourceFile)));
  assert.equal(await readFile(join(workspace, 'already-changed.txt'), 'utf8'), 'Do not roll this back');
  await page.evaluate(({ entryId, runtimeId }) => window.desktop.branchSession('fork', entryId, runtimeId),
    { entryId: 'm2', runtimeId: source.runtimeId });
  await page.reload();
  await page.getByText('第一轮旧回复。', { exact: true }).waitFor();
  const firstOnly = await snapshot();
  await page.locator('.message.user').last().hover();
  await page.getByRole('button', { name: '编辑并重做', exact: true }).last().click();
  await page.getByRole('textbox', { name: '编辑消息', exact: true }).fill('第一条重做。');
  await page.getByRole('textbox', { name: '编辑消息', exact: true }).press('Enter');
  await page.getByText('分支的新回复。', { exact: true }).waitFor();
  assert.equal((await snapshot()).state.sessionId, firstOnly.state.sessionId);
  assert.ok(!JSON.stringify(prompts[1]).includes('第一轮旧回复'));
  assert.ok(!JSON.stringify(prompts[1]).includes('重复的问题'));
  streams[1].end(chunk({}, 'stop') + 'data: [DONE]\n\n');
  await page.waitForFunction(async () => !(await window.desktop.snapshot()).state.isStreaming);
  await page.locator('.sidebar-bottom > button').click();
  await page.getByRole('button', { name: '通用', exact: true }).click();
  await page.getByRole('dialog').getByLabel(/主题|Theme/).selectOption('dark');
  await page.getByRole('dialog').getByLabel(/语言|Language/).selectOption('en');
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(640, 880));
  await page.screenshot({ path: 'test-results/branch-empty-narrow.png' });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.evaluate(id => window.desktop.switchSession(id), forked.state.sessionId);
  await page.evaluate(() => window.desktop.restart());
  await page.reload();
  await page.getByText('分支的新回复。', { exact: true }).waitFor();
  assert.equal((await snapshot()).state.sessionId, forked.state.sessionId);
  assert.equal((await snapshot()).messages.length, 4);
  assert.equal(await page.getByRole('button', { name: 'Branch from here', exact: true }).last().isEnabled(), true);
  assert.equal(await page.getByRole('button', { name: 'Edit and retry', exact: true }).last().isEnabled(), true);
  await page.screenshot({ path: 'test-results/branch-reopened-dark-narrow.png' });
  await page.locator('.message.user').last().hover();
  await page.getByRole('button', { name: 'Edit and retry', exact: true }).last().click();
  const englishEditor = page.getByRole('textbox', { name: 'Edit message', exact: true });
  await englishEditor.fill('A longer edited message\n'.repeat(24));
  const editScroll = page.getByRole('scrollbar', { name: 'Scroll edited message', exact: true });
  await editScroll.waitFor();
  assert.equal(await englishEditor.evaluate(element => getComputedStyle(element).scrollbarWidth), 'none');
  assert.equal(await editScroll.locator('.conversation-scroll-thumb').evaluate(element => getComputedStyle(element).width), '4px');
  await editScroll.press('Home');
  assert.equal(await englishEditor.evaluate(element => element.scrollTop), 0);
  await editScroll.press('End');
  assert.equal(await englishEditor.evaluate(element => Math.abs(element.scrollHeight - element.clientHeight - element.scrollTop) < 1), true);
  await editScroll.hover();
  await page.mouse.wheel(0, -120);
  await page.waitForFunction(() => {
    const input = document.querySelector('.user-message-editor textarea');
    return input.scrollTop < input.scrollHeight - input.clientHeight;
  });
  await englishEditor.evaluate(element => element.blur());
  await page.screenshot({ path: 'test-results/branch-edit-dark-narrow.png' });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  assert.equal(await englishEditor.evaluate(element => element.clientHeight <= 280), true);
  await englishEditor.press('Escape');
  assert.equal(await englishEditor.count(), 0);
  assert.equal(prompts.length, 2);
  assert.equal((await snapshot()).state.sessionId, forked.state.sessionId);
  const restoredSnapshot = await snapshot();
  await app.evaluate(({ ipcMain, BrowserWindow }, saved) => {
    ipcMain.removeHandler('desktop');
    ipcMain.handle('desktop', async (_event, method) => {
      if (method === 'snapshot') return saved;
      if (method === 'retryMessage') {
        const sendHistory = messages => BrowserWindow.getAllWindows()[0].webContents.send('runtime-event', {
          type: 'desktop_history', runtimeId: saved.runtimeId, sessionId: saved.state.sessionId, messages,
        });
        sendHistory(saved.messages.slice(0, 2));
        await new Promise(resolve => setTimeout(resolve, 250));
        sendHistory(saved.messages);
        throw new Error('Fixture edit send failure');
      }
      if (method === 'command') return { commands: [], levels: [] };
      return null;
    });
  }, restoredSnapshot);
  const englishInput = page.getByRole('textbox', { name: 'Message', exact: true });
  await englishInput.fill('Keep the ordinary composer draft');
  await page.locator('.message.user').last().hover();
  await page.getByRole('button', { name: 'Edit and retry', exact: true }).last().click();
  await englishEditor.fill('Keep this edited draft after failure');
  await page.locator('.user-message-editor').getByRole('button', { name: 'Send', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: 'Fixture edit send failure' }).waitFor();
  assert.equal(await englishEditor.inputValue(), 'Keep this edited draft after failure');
  assert.equal(await englishInput.inputValue(), 'Keep the ordinary composer draft');
  assert.equal(await page.locator('.user-message-editor').getByRole('button', { name: 'Send', exact: true }).isEnabled(), true);
  await englishEditor.press('Escape');
  assert.deepEqual(errors, []);
  console.log('Session branching passed: sidebar cold/resident copies, busy-target guards, permissions, explicit clone/fork, inline cancel/send, same-session retry, unchanged source/files, drafts/images and background isolation.');
} finally {
  for (const stream of streams) stream.destroy();
  if (app) await app.close();
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}
