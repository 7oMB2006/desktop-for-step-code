import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { queueFixture } from './queue-demo-fixture.mjs';

const profile = await mkdtemp(join(tmpdir(), 'step-new-session-'));
const fixture = await queueFixture(profile, { duration: 1600 });
const other = join(profile, 'Second project');
const fresh = join(profile, 'New project');
await mkdir(other); await mkdir(fresh);
const extraProjects = Array.from({ length: 4 }, (_, index) => join(profile, `Project ${index + 3}`));
await Promise.all(extraProjects.map(path => mkdir(path)));
await writeFile(join(profile, 'preferences.json'), JSON.stringify({
  theme: 'dark', language: 'zh', workspace: fixture.workspace, workspaces: [fixture.workspace, other, ...extraProjects],
  workspaceNames: { [fixture.workspace.replace(/\\/g, '/').toLowerCase()]: 'Desktop for Step Code' },
}));
const env = { ...process.env, DESKTOP_TEST_USER_DATA: profile, DESKTOP_TEST_NO_FOCUS: '1' };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ ...(process.env.DESKTOP_VERIFY_EXE ? { executablePath: process.env.DESKTOP_VERIFY_EXE } : { args: [resolve('.')] }), env, timeout: 60000 });
await mkdir('test-results', { recursive: true });
const errors = [];
try {
  const page = await app.firstWindow();
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    window.headingFrames = [];
    new MutationObserver(() => {
      const output = document.querySelector('.terminal-heading-output');
      const heading = document.querySelector('.terminal-heading');
      if (!output || !heading) return;
      window.headingFrames.push({ text: output.textContent, width: heading.getBoundingClientRect().width });
    }).observe(document, { childList: true, subtree: true, characterData: true });
  });
  await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    window.setOpacity(0); window.setIgnoreMouseEvents(true); window.showInactive(); window.setSize(1440, 960);
  });
  const heading = page.getByRole('heading', { name: '让梦想阶跃星辰', exact: true });
  await heading.waitFor();
  await page.waitForFunction(() => !document.querySelector('.new-chat').disabled);
  const snapshot = () => page.evaluate(() => window.desktop.snapshot());
  const waitState = async predicate => {
    const until = Date.now() + 60000;
    while (Date.now() < until) {
      const value = await snapshot();
      if (predicate(value)) return value;
      await page.waitForTimeout(50);
    }
    throw new Error(`State wait timed out: ${JSON.stringify(await snapshot())}`);
  };
  const initial = await snapshot();
  assert.ok(initial.draftId);
  assert.equal(initial.runtimeId, undefined);
  assert.equal(initial.state.sessionId, undefined);
  assert.equal(initial.sessions.length, 1);
  assert.equal(initial.runtimes.length, 0);
  assert.equal(initial.preferences.workspace, fixture.workspace);
  assert.equal(initial.models[0]?.id, 'queue-demo', 'load model choices without an agent');
  const historyBefore = await readdir(join(profile, 'step-runtime', 'sessions'));
  await assert.rejects(readdir(join(profile, 'workspaces', 'independent')), /ENOENT/);
  await heading.locator('.terminal-heading-output').evaluate(async element => {
    while (!element.textContent.includes('让梦想阶跃星辰')) await new Promise(resolve => setTimeout(resolve, 20));
  });
  const input = page.getByRole('textbox', { name: '消息', exact: true });
  assert.equal(await input.isEnabled(), true);
  await page.screenshot({ path: 'test-results/new-session-dark.png' });
  const selector = page.locator('.new-session-project-trigger');
  await selector.click();
  const picker = page.getByRole('dialog', { name: '选择项目', exact: true });
  await picker.waitFor();
  await page.waitForTimeout(220);
  assert.ok(await picker.evaluate(element => {
    const list = element.querySelector('.new-session-project-list');
    const row = list.querySelector('button');
    return list.clientHeight >= row.getBoundingClientRect().height * 5;
  }), 'normal project picker shows at least five project rows');
  await page.screenshot({ path: 'test-results/new-session-project-picker-dark.png' });
  await picker.getByRole('textbox', { name: '搜索项目' }).fill('Second');
  assert.equal(await picker.locator('.new-session-project-list button').count(), 1);
  await picker.getByRole('button', { name: 'Second project', exact: true }).click();
  await page.waitForFunction(path => document.querySelector('.new-session-project-trigger')?.textContent.includes(path), 'Second project');
  assert.equal((await snapshot()).runtimeId, undefined);
  await input.fill('A draft preserved while choosing a project');
  await selector.click();
  await picker.getByRole('button', { name: '独立会话', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.new-session-project-trigger')?.textContent.includes('独立会话'));
  assert.equal(await input.inputValue(), 'A draft preserved while choosing a project');
  assert.deepEqual(await readdir(join(profile, 'step-runtime', 'sessions')), historyBefore);
  await page.reload();
  await heading.waitFor();
  await page.waitForFunction(() => !document.querySelector('.new-chat').disabled);
  await page.waitForFunction(() => document.querySelector('.terminal-heading-output')?.textContent === '让梦想阶跃星辰');
  const frames = await page.evaluate(() => window.headingFrames);
  const textLengths = [...new Set(frames.map(frame => frame.text.length))];
  assert.ok(textLengths.some(length => length > 0 && length < 7) && textLengths.includes(7), 'headline reveals individual characters');
  assert.ok(frames.every(frame => Math.abs(frame.width - frames[0].width) < .5), 'headline typing cannot shift its width');
  await page.waitForFunction(() => document.querySelector('.terminal-heading-output')?.textContent.length < 7, undefined, { timeout: 12000 });
  await page.waitForFunction(() => document.querySelector('.new-session h1')?.getAttribute('aria-label') !== '让梦想阶跃星辰', undefined, { timeout: 12000 });
  const nextText = await page.locator('.new-session h1').getAttribute('aria-label');
  await input.fill('Pause the greeting while composing');
  await page.waitForFunction(text => document.querySelector('.terminal-heading-output')?.textContent === text, nextText);
  assert.ok(await page.locator('.terminal-heading-space').evaluate(element => {
    const text = element.getBoundingClientRect();
    const heading = element.closest('h1').getBoundingClientRect();
    return Math.abs(text.left + text.width / 2 - heading.left - heading.width / 2) < 1;
  }), 'complete text is centered independently of the cursor');
  await page.waitForTimeout(7200);
  assert.equal(await page.locator('.terminal-heading-output').textContent(), nextText, 'composing keeps the complete greeting still');
  await input.fill('');
  assert.ok((await snapshot()).draftId);
  assert.equal((await snapshot()).runtimeId, undefined);
  // Switching away discards the proposed session without touching saved history.
  await page.getByText('队列交互示例（本地模拟）', { exact: true }).click();
  await waitState(value => value.state?.sessionId === 'queue-demo');
  const openedHistory = await readFile(join(profile, 'step-runtime', 'sessions', 'queue-demo.jsonl'), 'utf8');
  await page.getByRole('button', { name: '新建会话', exact: true }).click();
  await heading.waitFor();
  assert.equal((await snapshot()).preferences.workspace, fixture.workspace);
  const abandoned = (await snapshot()).draftId;
  assert.equal((await snapshot()).runtimes.length, 1);
  assert.equal((await snapshot()).sessions.length, 1);
  await page.getByText('队列交互示例（本地模拟）', { exact: true }).click();
  await waitState(value => value.state?.sessionId === 'queue-demo');
  await assert.rejects(page.evaluate(id => window.desktop.createDraftSession(id), abandoned), /no longer active/);
  assert.deepEqual(await readdir(join(profile, 'step-runtime', 'sessions')), historyBefore);
  const messagesIn = history => history.trim().split('\n').map(line => JSON.parse(line)).filter(entry => entry.type === 'message');
  assert.deepEqual(messagesIn(await readFile(join(profile, 'step-runtime', 'sessions', 'queue-demo.jsonl'), 'utf8')), messagesIn(openedHistory));
  await page.getByRole('button', { name: '新建会话', exact: true }).click();
  await heading.waitFor();
  await app.evaluate(({ dialog }) => { dialog.showOpenDialog = async () => ({ canceled: true, filePaths: [] }); });
  const beforeCancel = (await snapshot()).draftId;
  await selector.click();
  await picker.getByRole('button', { name: '打开新项目…' }).click();
  await page.waitForFunction(() => !document.querySelector('.new-chat').disabled);
  assert.equal((await snapshot()).draftId, beforeCancel);
  assert.equal((await snapshot()).sessions.length, 1);
  await app.evaluate(({ dialog }, path) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] }); }, fresh);
  await selector.click();
  await picker.getByRole('button', { name: '打开新项目…' }).click();
  await page.waitForFunction(() => document.querySelector('.new-session-project-trigger')?.textContent.includes('New project'));
  assert.equal((await snapshot()).runtimeId, undefined);
  assert.equal((await snapshot()).sessions.length, 1);
  assert.ok((await snapshot()).preferences.workspaces.includes(fresh));
  await page.evaluate(() => window.desktop.preferences({ theme: 'light' }));
  await page.reload();
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'light' && !document.querySelector('.new-chat').disabled);
  await page.waitForTimeout(1050);
  await selector.click();
  await page.waitForTimeout(220);
  await page.screenshot({ path: 'test-results/new-session-project-picker-light.png' });
  await page.keyboard.press('Escape');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(640, 720));
  await page.waitForTimeout(350);
  await selector.click();
  await page.waitForTimeout(220);
  assert.ok(await picker.evaluate(element => {
    const rect = element.getBoundingClientRect();
    return rect.left >= 0 && rect.right <= innerWidth && rect.top >= 0 && rect.bottom < document.querySelector('.composer').getBoundingClientRect().top;
  }), 'project menu stays in the main view, above the composer');
  await page.screenshot({ path: 'test-results/new-session-narrow.png' });
  await page.keyboard.press('Escape');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.reload();
  await heading.waitFor();
  await page.waitForFunction(() => !document.querySelector('.new-chat').disabled);
  assert.equal(await heading.locator('.terminal-heading-output').textContent(), '让梦想阶跃星辰');
  assert.equal(await heading.locator('.terminal-cursor').evaluate(element => getComputedStyle(element).animationName), 'none');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1440, 960));
  // Select the known local provider project and submit via the real composer.
  await selector.click();
  await picker.getByRole('button', { name: 'Desktop for Step Code', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('.new-chat').disabled);
  assert.equal((await snapshot()).runtimeId, undefined);
  await input.fill('FIRST-SEND 验证首次创建');
  await input.press('Enter');
  await input.press('Enter');
  await waitState(value => value.runtimeId && value.messages.some(message => message.role === 'user' && JSON.stringify(message.content).includes('FIRST-SEND')));
  await waitState(value => !value.state?.isStreaming && value.messages.some(message => message.role === 'assistant' && message.stopReason === 'stop'));
  const sent = await snapshot();
  assert.equal(sent.draftId, undefined);
  assert.equal(sent.sessions.length, 2);
  assert.equal(sent.messages.filter(message => message.role === 'user').length, 1);
  assert.equal(sent.preferences.workspace, fixture.workspace);
  assert.ok(fixture.requests.some(text => text.includes('FIRST-SEND')));
  assert.equal((await readdir(join(profile, 'step-runtime', 'sessions'))).length, historyBefore.length + 1);
  await page.screenshot({ path: 'test-results/new-session-first-send.png' });
  // New session from an independent history inherits no project.
  await page.evaluate(async () => {
    const state = await window.desktop.newIndependentSession();
    window.independentForDraftTest = state.state.sessionId;
  });
  await page.reload();
  await page.waitForFunction(() => !document.querySelector('.new-chat').disabled);
  await page.getByRole('button', { name: '新建会话', exact: true }).click();
  await waitState(value => value.draftId);
  assert.equal((await snapshot()).independent, true);
  assert.equal((await snapshot()).preferences.workspace, undefined);
} finally {
  await app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 1 }); }).catch(() => {});
  await app.close();
  await fixture.close();
}
assert.deepEqual(errors, []);
console.log('New session draft acceptance passed');
