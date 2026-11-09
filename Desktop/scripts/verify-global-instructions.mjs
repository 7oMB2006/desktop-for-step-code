import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { waitForSessionFixtureSnapshot } from './session-fixture.mjs';
import { closeDesktopFixtureAndWait } from './close-desktop-fixture.mjs';
import { assertFocusVisible } from './assert-focus-visible.mjs';

const globalA = 'GLOBAL_RULE_ALPHA\n\u9ed8\u8ba4\u7528\u4e2d\u6587\u56de\u7b54\u3002\n';
const globalB = 'GLOBAL_RULE_BETA\nPreserve unrelated changes.\n';
const requests = new Map();
let held;
let heartbeat;
const chunk = (delta, finish_reason = null) => `data: ${JSON.stringify({
  id: 'instructions-fixture', object: 'chat.completion.chunk', created: 1, model: 'fixture',
  choices: [{ index: 0, delta, finish_reason }],
})}\n\n`;
const text = message => typeof message?.content === 'string' ? message.content : message?.content?.filter(block => block.type === 'text').map(block => block.text).join('\n');
const finishHeld = () => {
  clearInterval(heartbeat);
  held?.end(chunk({}, 'stop') + 'data: [DONE]\n\n');
  held = undefined;
};
const server = createServer(async (request, response) => {
  let body = '';
  for await (const part of request) body += part;
  const payload = JSON.parse(body);
  const user = text(payload.messages.filter(message => message.role === 'user').at(-1));
  requests.set(user, {
    user, system: payload.messages.filter(message => ['system', 'developer'].includes(message.role)).map(text).join('\n'),
  });
  response.writeHead(200, { 'content-type': 'text/event-stream' });
  response.write(chunk({ role: 'assistant', content: `${user} completed.` }));
  if (user === 'HOLD-A') {
    held = response;
    heartbeat = setInterval(() => response.write(': heartbeat\n\n'), 1000);
    response.on('close', () => clearInterval(heartbeat));
  } else response.end(chunk({}, 'stop') + 'data: [DONE]\n\n');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const profile = await mkdtemp(join(tmpdir(), 'desktop-global-instructions-'));
const root = join(profile, 'step-runtime');
const projectA = join(profile, 'project-a');
const projectB = join(profile, 'project-b');
for (const directory of [join(root, 'sessions'), projectA, projectB]) await mkdir(directory, { recursive: true });
await writeFile(join(projectA, 'AGENTS.md'), 'PROJECT_RULE_A');
await writeFile(join(projectB, 'AGENTS.md'), 'PROJECT_RULE_B');
await writeFile(join(profile, 'preferences.json'), JSON.stringify({
  language: 'zh', theme: 'light', workspaces: [projectA, projectB],
}));
await writeFile(join(root, 'config.toml'), 'defaultProvider = "fixture"\ndefaultModel = "fixture"\npermissionPreset = "ask"\n[telemetry]\nenabled = false\n');
await writeFile(join(root, 'models.json'), JSON.stringify({ providers: { fixture: {
  baseUrl: `http://127.0.0.1:${server.address().port}/v1`, api: 'openai-completions', apiKey: 'local-fixture-only',
  models: [{ id: 'fixture', name: 'Instructions fixture', contextWindow: 65536, maxTokens: 2048 }],
} } }));
const env = { ...process.env, DESKTOP_TEST_USER_DATA: profile, DESKTOP_TEST_NO_FOCUS: '1' };
delete env.ELECTRON_RUN_AS_NODE;
delete env.STEP_API_KEY;
const executablePath = process.env.DESKTOP_VERIFY_EXE;
const errors = [];
let failed = false;
let app;
let page;
const launch = async () => {
  app = await electron.launch({ ...(executablePath ? { executablePath } : { args: [resolve('.')] }), env, timeout: 60000 });
  page = await app.firstWindow();
  page.on('pageerror', error => errors.push(error.message));
  await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    window.setOpacity(0); window.setIgnoreMouseEvents(true); window.showInactive();
  });
  await page.waitForFunction(() => {
    const input = document.querySelector('.composer > .composer-input');
    return input && !input.disabled;
  }, undefined, { timeout: 60000 });
  // Keep clipboard acceptance inside this fixture process, not the user's clipboard.
  await app.evaluate(({ clipboard }) => {
    clipboard.writeText = text => { globalThis.instructionsCopiedPath = text; };
  });
};
const snapshot = () => page.evaluate(() => window.desktop.snapshot());
const openInstructions = async (name = '全局指令') => {
  await page.locator('.sidebar-settings').click();
  await page.getByRole('button', { name, exact: true }).click();
  await page.locator('.instructions-editor textarea').waitFor();
};
const saveUI = async content => {
  await page.locator('.instructions-editor textarea').fill(content);
  await page.getByRole('button', { name: '保存指令', exact: true }).click();
  await page.locator('.instructions-meta').getByText('已保存到文件', { exact: true }).waitFor();
};
const assertPath = async (name, copyLabel) => {
  const expected = join(root, 'agent', name);
  assert.equal(await page.locator('.instructions-path code').textContent(), expected);
  assert.equal((await page.evaluate(() => window.desktop.globalInstructions())).path, expected);
  await page.getByRole('button', { name: copyLabel, exact: true }).click();
  assert.equal(await app.evaluate(() => globalThis.instructionsCopiedPath), expected);
  await assertFocusVisible(page, page.getByRole('button', { name: copyLabel, exact: true }), 'Instruction path copy');
};
const closeSettings = async () => {
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
};
const send = async (label, runtimeId) => {
  await page.evaluate(({ label, runtimeId }) => window.desktop.command('prompt', { message: label }, runtimeId), { label, runtimeId });
  for (let attempt = 0; attempt < 200 && !requests.has(label); attempt++) await new Promise(resolve => setTimeout(resolve, 25));
  assert.ok(requests.has(label), `Missing provider request: ${label}`);
  if (label !== 'HOLD-A') await waitForSessionFixtureSnapshot(page,
    state => ['idle', 'completed'].includes(state.runtimes.find(worker => worker.runtimeId === runtimeId)?.status), `${label} to finish`);
};
const assertPrompt = (label, global, project) => {
  const request = requests.get(label);
  assert.equal(request.user, label, 'Instructions do not change visible user input');
  assert.ok(request.system.includes('You are StepCode'), 'The product prompt remains present');
  assert.ok(request.system.includes('# Shared workspace collaboration'), 'Desktop collaboration rules remain present');
  assert.equal(request.system.includes('GLOBAL_RULE_ALPHA'), global === 'alpha');
  assert.equal(request.system.includes('GLOBAL_RULE_BETA'), global === 'beta');
  assert.equal(request.system.includes('PROJECT_RULE_A'), project === 'a');
  assert.equal(request.system.includes('PROJECT_RULE_B'), project === 'b');
};
try {
  await launch();
  const oldEmpty = await page.evaluate(path => window.desktop.workspace(path), projectA);
  await page.reload();
  await openInstructions();
  assert.equal(await page.locator('.instructions-editor textarea').inputValue(), '');
  await page.locator('.instructions-meta').getByText('尚未创建指令文件', { exact: true }).waitFor();
  await assertPath('AGENTS.md', '复制指令文件路径');
  assert.ok((await page.locator('.instructions-scope').textContent()).includes('已启动的会话不会自动更新'));
  assert.equal(await page.getByRole('button', { name: '保存指令', exact: true }).isDisabled(), true);
  await page.locator('.instructions-editor textarea').fill(globalA);
  await page.getByRole('button', { name: '通用', exact: true }).click();
  await page.getByRole('button', { name: '全局指令', exact: true }).click();
  assert.equal(await page.locator('.instructions-editor textarea').inputValue(), globalA, 'Switching settings tabs preserves edits');
  await page.getByRole('button', { name: '保存指令', exact: true }).click();
  await page.locator('.instructions-meta').getByText('已保存到文件', { exact: true }).waitFor();
  assert.equal(await readFile(join(root, 'agent', 'AGENTS.md'), 'utf8'), globalA);
  assert.equal((await snapshot()).runtimeId, oldEmpty.runtimeId, 'Saving does not restart a resident runtime');
  await mkdir('test-results', { recursive: true });
  await assertFocusVisible(page, page.locator('.instructions-editor textarea'), 'Light instruction editor');
  await page.screenshot({ path: 'test-results/global-instructions-light.png' });

  // Strict input validation and external-edit conflicts are checked through real IPC.
  const initial = await page.evaluate(() => window.desktop.globalInstructions());
  for (const value of [null, {}, 'x\0y', 'x'.repeat(16001)]) {
    await assert.rejects(page.evaluate(({ value, revision }) => window.desktop.saveGlobalInstructions(value, revision),
      { value, revision: initial.revision }), /GLOBAL_INSTRUCTIONS_(INVALID|TOO_LARGE)/);
  }
  await page.locator('.instructions-editor textarea').fill('x'.repeat(16001));
  assert.equal(await page.getByRole('button', { name: '保存指令', exact: true }).isDisabled(), true);
  assert.equal(await page.locator('.instructions-editor textarea').getAttribute('aria-invalid'), 'true');
  await page.getByRole('button', { name: '还原更改', exact: true }).click();
  await writeFile(join(root, 'agent', 'AGENTS.md'), 'MANUAL_RULE');
  await page.locator('.instructions-editor textarea').fill('LOCAL_UNSAVED_EDIT');
  await page.getByRole('button', { name: '保存指令', exact: true }).click();
  await page.locator('.instructions-error').waitFor();
  assert.equal(await page.locator('.instructions-editor textarea').inputValue(), 'LOCAL_UNSAVED_EDIT');
  assert.equal(await readFile(join(root, 'agent', 'AGENTS.md'), 'utf8'), 'MANUAL_RULE');
  await page.screenshot({ path: 'test-results/global-instructions-conflict.png' });
  await page.getByRole('button', { name: '重新加载已保存指令', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.instructions-editor textarea')?.value === 'MANUAL_RULE');
  await saveUI(globalA);
  await closeSettings();

  const a = await page.evaluate(runtimeId => window.desktop.command('new_session', {}, runtimeId), oldEmpty.runtimeId);
  assert.notEqual(a.runtimeId, oldEmpty.runtimeId, 'New sessions must not reuse empty workers with old instructions');
  await send('OLD-EMPTY', oldEmpty.runtimeId); assertPrompt('OLD-EMPTY', undefined, 'a');
  await send('A-FIRST', a.runtimeId); assertPrompt('A-FIRST', 'alpha', 'a');
  await send('HOLD-A', a.runtimeId);
  await page.reload();
  await openInstructions();
  await saveUI(globalB);
  const duringSave = await snapshot();
  assert.equal(duringSave.runtimeId, a.runtimeId);
  assert.equal(duringSave.state.isStreaming, true, 'Saving global instructions never interrupts a running turn');
  await closeSettings();
  const b = await page.evaluate(path => window.desktop.workspace(path), projectB);
  await send('B-FIRST', b.runtimeId); assertPrompt('B-FIRST', 'beta', 'b');
  finishHeld();
  await waitForSessionFixtureSnapshot(page,
    state => ['idle', 'completed'].includes(state.runtimes.find(worker => worker.runtimeId === a.runtimeId)?.status), 'the held turn to finish');
  await send('A-UNCHANGED', a.runtimeId); assertPrompt('A-UNCHANGED', 'alpha', 'a');
  await page.evaluate(id => window.desktop.switchSession(id), a.state.sessionId);
  const restarted = await page.evaluate(() => window.desktop.restart());
  assert.notEqual(restarted.runtimeId, a.runtimeId);
  assert.equal(restarted.state.sessionId, a.state.sessionId, 'Restart retains saved conversation identity');
  await send('A-RESTARTED', restarted.runtimeId); assertPrompt('A-RESTARTED', 'beta', 'a');

  await page.reload();
  await openInstructions();
  await page.getByRole('button', { name: '清空编辑内容', exact: true }).click();
  assert.equal(await page.locator('.instructions-editor textarea').inputValue(), '');
  assert.equal(await readFile(join(root, 'agent', 'AGENTS.md'), 'utf8'), globalB, 'Clear is not persisted before Save');
  await page.getByRole('button', { name: '保存指令', exact: true }).click();
  await page.locator('.instructions-meta').getByText('已保存到文件', { exact: true }).waitFor();
  await closeSettings();
  const independent = await page.evaluate(() => window.desktop.newIndependentSession());
  await send('INDEPENDENT-CLEARED', independent.runtimeId); assertPrompt('INDEPENDENT-CLEARED');
  assert.equal(await readFile(join(projectA, 'AGENTS.md'), 'utf8'), 'PROJECT_RULE_A');
  assert.equal(await readFile(join(projectB, 'AGENTS.md'), 'utf8'), 'PROJECT_RULE_B');

  await openInstructions();
  await saveUI(globalB);
  await page.getByRole('button', { name: '通用', exact: true }).click();
  await page.evaluate(() => window.desktop.preferences({ theme: 'dark' }));
  await page.getByRole('dialog').getByLabel(/^语言/).selectOption('en');
  await page.getByRole('button', { name: 'Global instructions', exact: true }).click();
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(640, 720));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await assertPath('AGENTS.md', 'Copy instructions file path');
  await page.getByRole('textbox', { name: 'Global instructions content', exact: true }).focus();
  await page.getByRole('textbox', { name: 'Global instructions content', exact: true }).press('Tab');
  assert.equal(await page.getByRole('button', { name: 'Clear editor', exact: true }).evaluate(element => document.activeElement === element), true);
  assert.equal(await page.locator('.settings-content:visible').evaluate(element => element.scrollWidth > element.clientWidth), false);
  assert.ok(await page.locator('.instructions-editor textarea').evaluate(element => {
    const bounds = element.getBoundingClientRect();
    const parent = element.closest('.settings-content').getBoundingClientRect();
    return bounds.left >= parent.left && bounds.right <= parent.right;
  }));
  await page.getByRole('textbox', { name: 'Global instructions content', exact: true }).focus();
  await assertFocusVisible(page, page.locator('.instructions-editor textarea'), 'Dark narrow instruction editor');
  await page.screenshot({ path: 'test-results/global-instructions-dark-narrow-en.png' });
  await closeSettings();
  await closeDesktopFixtureAndWait(app);
  app = undefined;
  await launch();
  await openInstructions('Global instructions');
  assert.equal(await page.locator('.instructions-editor textarea').inputValue(), globalB, 'Instructions survive a full app relaunch');
  await closeSettings();
  const resumed = await page.evaluate(id => window.desktop.switchSession(id), a.state.sessionId);
  assert.equal(resumed.state.sessionId, a.state.sessionId, 'Cold history restoration keeps its original identity');
  assert.ok(JSON.stringify(resumed.messages).includes('A-FIRST'), 'Cold restoration preserves the earlier conversation');
  await send('RELAUNCH-A', resumed.runtimeId); assertPrompt('RELAUNCH-A', 'beta', 'a');
  await openInstructions('Global instructions');
  await page.locator('.instructions-meta').getByText('Loaded from local file', { exact: true }).waitFor();
  await writeFile(join(root, 'agent', 'AGENTS.override.md'), 'PRIORITY_OVERRIDE');
  await page.getByRole('button', { name: 'Reload saved instructions', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.instructions-editor textarea')?.value === 'PRIORITY_OVERRIDE');
  await assertPath('AGENTS.override.md', 'Copy instructions file path');
  await page.locator('.instructions-editor textarea').fill('UPDATED_OVERRIDE');
  await app.evaluate(({ clipboard }) => { clipboard.writeText = () => { throw new Error('Fixture clipboard failure'); }; });
  await page.getByRole('button', { name: 'Copy instructions file path', exact: true }).click();
  await page.getByRole('alert').getByText('Could not copy the path. Try again.', { exact: true }).waitFor();
  assert.equal(await page.locator('.instructions-editor textarea').inputValue(), 'UPDATED_OVERRIDE', 'Copy failure preserves edits');
  await page.getByRole('button', { name: 'Save instructions', exact: true }).click();
  await page.locator('.instructions-meta').getByText('Saved to file', { exact: true }).waitFor();
  assert.equal(await readFile(join(root, 'agent', 'AGENTS.override.md'), 'utf8'), 'UPDATED_OVERRIDE');
  assert.equal(await readFile(join(root, 'agent', 'AGENTS.md'), 'utf8'), globalB, 'Saving an override leaves the lower-priority file unchanged');
  assert.equal(await page.locator('.settings-content:visible').evaluate(element => element.scrollWidth > element.clientWidth), false);
  await page.screenshot({ path: 'test-results/global-instructions-override-path.png' });
  assert.deepEqual(errors, []);
  await writeFile('test-results/global-instructions-results.json', JSON.stringify({
    provider: 'isolated-local-http-fixture', requests: [...requests.keys()],
    checked: ['native-global-context', 'product-and-project-rules-preserved', 'user-text-unchanged', 'old-empty-worker-not-reused',
      'running-session-unchanged', 'restart-preserves-history', 'cross-project', 'independent-session', 'clear',
      'strict-ipc', 'revision-conflict', 'full-relaunch', 'actual-file-path', 'copy-path', 'copy-failure-retains-draft',
      'override-path-and-save', 'light-dark-narrow-en-keyboard'],
  }, null, 2));
  console.log('Global instructions passed: native system context, unchanged user text, existing/running sessions, empty-worker reuse, restart/history, cross-project and independent sessions, persistence, clear, revision conflicts, IPC validation, actual file and override paths, path copying and failure retention, light/dark/narrow English and keyboard. Local HTTP fixture only.');
} catch (error) {
  failed = true;
  console.error(error);
  await page?.screenshot({ path: 'test-results/global-instructions-failed.png' }).catch(() => {});
  throw error;
} finally {
  finishHeld();
  if (page && app) await page.evaluate(async () => {
    const snapshot = await window.desktop.snapshot();
    for (const worker of snapshot.runtimes ?? []) {
      if (['running', 'waiting'].includes(worker.status)) await window.desktop.command('abort', {}, worker.runtimeId).catch(() => {});
    }
  }).catch(() => {});
  if (app) await closeDesktopFixtureAndWait(app).catch(error => {
    if (!failed) throw error;
    console.error('Fixture cleanup:', error.message);
  });
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}
