import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { queueFixture } from './queue-demo-fixture.mjs';
import { closeDesktopFixture } from './close-desktop-fixture.mjs';

if (process.platform !== 'win32') {
  console.log('Session import acceptance is Windows-only.');
  process.exit(0);
}
const profile = await mkdtemp(join(tmpdir(), 'desktop-session-import-'));
const fixture = await queueFixture(profile, { duration: 100 });
const sourceRoot = join(profile, 'codex');
const claudeRoot = join(profile, 'claude');
await mkdir(join(sourceRoot, 'sessions'), { recursive: true });
await mkdir(join(sourceRoot, 'archived_sessions'));
await mkdir(claudeRoot);
const now = '2026-10-22T00:00:00.000Z';
const meta = { type: 'session_meta', timestamp: now, payload: {
  id: 'source-codex', cwd: fixture.workspace, cli_version: 'test', history_mode: 'paginated',
} };
const user = text => ({ type: 'response_item', timestamp: now, payload: {
  type: 'message', role: 'user', content: [{ type: 'input_text', text }],
} });
const assistant = text => ({ type: 'response_item', timestamp: now, payload: {
  type: 'message', role: 'assistant', content: [{ type: 'output_text', text }],
} });
const records = [meta, user('Migration sample'), {
  type: 'response_item', timestamp: now, payload: {
    type: 'function_call', call_id: 'old-call', name: 'run_command', arguments: JSON.stringify({ command: 'echo must-not-run' }),
  },
}, { type: 'response_item', timestamp: now, payload: {
  type: 'function_call_output', call_id: 'old-call', output: 'historical failure', is_error: true,
} }, assistant('Historical answer')];
const jsonl = values => values.map(value => JSON.stringify(value)).join('\n') + '\n';
const sourcePath = join(sourceRoot, 'sessions', 'rollout-one.jsonl');
const sourceBytes = jsonl(records);
await writeFile(sourcePath, sourceBytes);
await writeFile(join(sourceRoot, 'archived_sessions', 'rollout-archived.jsonl'), jsonl([
  { ...meta, payload: { ...meta.payload, id: 'archived-codex' } }, user('Archived sample'), assistant('Archive answer'),
]));
await writeFile(join(sourceRoot, 'sessions', 'rollout-child.jsonl'), jsonl([
  { ...meta, payload: { ...meta.payload, id: 'child-codex', source: { subagent: { parent_thread_id: 'source-codex' } } } },
  user('Child sample'), assistant('Child answer'),
]));
await writeFile(join(claudeRoot, 'claude.jsonl'), jsonl([
  { type: 'user', uuid: 'one', parentUuid: null, sessionId: 'claude-one', cwd: fixture.workspace, version: 'test',
    timestamp: now, message: { role: 'user', content: 'Claude migration sample' } },
  { type: 'assistant', uuid: 'two', parentUuid: 'one', sessionId: 'claude-one', timestamp: now,
    message: { role: 'assistant', content: [{ type: 'text', text: 'Claude historical answer' }] } },
]));
await writeFile(join(profile, 'preferences.json'), JSON.stringify({
  theme: 'dark', language: 'zh', workspaces: [fixture.workspace], workspace: fixture.workspace,
}));
const env = { ...process.env, DESKTOP_TEST_USER_DATA: profile, DESKTOP_TEST_NO_FOCUS: '1',
  CODEX_HOME: sourceRoot, CLAUDE_CONFIG_DIR: join(profile, 'absent-claude') };
delete env.ELECTRON_RUN_AS_NODE;
const errors = [];
const launch = () => electron.launch({ ...(process.env.DESKTOP_VERIFY_EXE ? { executablePath: process.env.DESKTOP_VERIFY_EXE }
  : { args: [resolve('.')] }), env, timeout: 60000 });
let app = await launch();
await mkdir('test-results', { recursive: true });
try {
  let page = await app.firstWindow();
  page.on('pageerror', error => errors.push(error.message));
  await page.waitForFunction(() => window.desktop && document.querySelector('.new-chat')?.disabled === false);
  const before = await page.evaluate(() => window.desktop.snapshot());
  const openMigration = async () => {
    await page.locator('.sidebar-bottom > button').click();
    await page.getByRole('button', { name: '会话迁移', exact: true }).click();
    await page.locator('.session-import-settings').waitFor();
  };
  await openMigration();
  assert.equal(await page.locator('.import-candidate').count(), 0, 'no automatic scan');
  await page.getByRole('button', { name: '来源目录', exact: true }).click();
  await page.locator('.import-sources label').filter({ hasText: 'Codex' }).first().locator('input').fill(sourceRoot);
  await page.locator('.import-sources label').filter({ hasText: 'Claude Code' }).locator('input').fill(claudeRoot);
  await page.getByRole('button', { name: '来源目录', exact: true }).click();
  await page.waitForFunction(() => {
    const body = document.querySelector('.import-sources-details');
    return body.hasAttribute('inert') && body.getBoundingClientRect().height === 0;
  });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  assert.equal(await page.locator('.import-sources-details').evaluate(element => getComputedStyle(element).transitionDuration), '0s');
  await page.getByRole('button', { name: '来源目录', exact: true }).click();
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.getByRole('button', { name: '扫描本机会话', exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll('.import-candidate').length === 2);
  assert.equal(await page.getByRole('button', { name: '上一页', exact: true }).isEnabled(), false);
  assert.equal(await page.getByRole('button', { name: '下一页', exact: true }).isEnabled(), false);
  assert.equal(await page.locator('.import-submit').evaluate(element =>
    Boolean(element.compareDocumentPosition(document.querySelector('.import-candidates')) & Node.DOCUMENT_POSITION_FOLLOWING)), true,
  'import action stays before the independently scrolling list');
  const sourceFilter = page.getByRole('button', { name: '来源', exact: true });
  await sourceFilter.click();
  await page.getByRole('menuitemradio', { name: '全部来源', exact: true }).press('ArrowDown');
  await page.getByRole('menuitemradio', { name: 'Codex', exact: true }).press('Enter');
  assert.equal(await page.locator('.import-candidate').count(), 1);
  assert.equal(await sourceFilter.evaluate(element => element === document.activeElement), true);
  await sourceFilter.click();
  await page.getByRole('menuitemradio', { name: 'Codex', exact: true }).press('Escape');
  assert.equal(await sourceFilter.getAttribute('aria-expanded'), 'false');
  assert.equal(await sourceFilter.evaluate(element => element === document.activeElement), true);
  await sourceFilter.click();
  await page.getByRole('menuitemradio', { name: '全部来源', exact: true }).click();
  await page.getByRole('checkbox', { name: '包含 Codex 归档会话', exact: true }).check();
  await page.getByRole('button', { name: '重新扫描', exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll('.import-candidate').length === 3);
  assert.equal(await page.locator('.import-candidate').filter({ hasText: 'Child sample' }).count(), 0);
  await page.getByRole('checkbox', { name: '包含 Codex 归档会话', exact: true }).uncheck();
  await page.getByRole('button', { name: '重新扫描', exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll('.import-candidate').length === 2);
  assert.equal(await page.locator('.import-candidate input[type=checkbox]:disabled').count(), 0);
  assert.equal(await page.getByRole('button', { name: '导入所选会话' }).isEnabled(), false);
  await page.locator('.import-candidate-title').filter({ hasText: 'Codex' }).click();
  assert.equal(await page.locator('.import-preview').count(), 0);
  assert.equal(await page.locator('.import-candidate').filter({ hasText: 'Codex' }).locator('input[type=checkbox]').isChecked(), true);
  await page.locator('.import-candidate-title').filter({ hasText: 'Codex' }).click();
  assert.equal(await page.locator('.import-candidate').filter({ hasText: 'Codex' }).locator('input[type=checkbox]').isChecked(), false);
  await page.locator('.import-candidate').filter({ hasText: 'Codex' }).getByRole('button', { name: /^预览 / }).click();
  await page.getByRole('region', { name: '兼容性预览' }).waitFor();
  assert.match(await page.locator('.import-preview pre').innerText(), /Historical answer/);
  await page.getByRole('textbox', { name: '目标项目目录', exact: true }).fill(join(profile, 'not-the-destination'));
  await app.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = async (_window, options) => {
      assertDirectoryOptions(options);
      return { canceled: false, filePaths: [path] };
    };
    function assertDirectoryOptions(options) {
      if (JSON.stringify(options.properties) !== JSON.stringify(['openDirectory'])) throw new Error('Expected a directory-only dialog');
    }
  }, fixture.workspace);
  await page.getByRole('button', { name: '选择目标目录', exact: true }).click();
  await page.waitForFunction(path => document.querySelector('.import-destination input')?.value === path, fixture.workspace);
  assert.equal(await page.locator('.import-preview input[type=checkbox]').count(), 0);
  await page.locator('.import-candidate').filter({ hasText: 'Codex' }).locator('input[type=checkbox]').check();
  await page.locator('.import-candidate').filter({ hasText: 'Claude Code' }).getByRole('button', { name: /^预览 / }).click();
  await page.waitForFunction(() => document.querySelector('.import-preview pre')?.textContent.includes('Claude historical answer'));
  await page.locator('.import-candidate').filter({ hasText: 'Claude Code' }).locator('input[type=checkbox]').check();
  // Keep the exact reviewed content, even if the source appends while the review is open.
  await writeFile(sourcePath, sourceBytes + jsonl([user('Later source turn'), assistant('Must not enter old preview')]));
  await page.getByRole('button', { name: '导入所选会话' }).click();
  await page.waitForFunction(() => [...document.querySelectorAll('.import-jobs li')].filter(element => element.textContent.includes('已导入')).length === 2);
  const jobs = await page.evaluate(() => window.desktop.importJobs());
  const result = jobs[0].results[0];
  const claudeResult = jobs[0].results[1];
  assert.equal(result.status, 'imported');
  assert.equal(claudeResult.status, 'imported');
  assert.match(await readFile(join(profile, 'step-runtime', 'sessions', 'imported', `${claudeResult.sessionId}.jsonl`), 'utf8'), /Claude historical answer/);
  const target = join(profile, 'step-runtime', 'sessions', 'imported', `${result.sessionId}.jsonl`);
  const importedBytes = await readFile(target, 'utf8');
  assert.ok(!importedBytes.includes('Later source turn'));
  assert.ok(importedBytes.includes('Historical answer'));
  assert.equal(result.path, undefined, 'filesystem handles do not leak to the renderer');
  const after = await page.evaluate(() => window.desktop.snapshot());
  assert.equal(after.draftId, before.draftId, 'migration does not switch active session');
  assert.ok(after.sessions.some(session => session.id === result.sessionId));
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(600, 850));
  await page.screenshot({ path: 'test-results/session-import-narrow.png' });
  assert.ok(await page.locator('.session-import-settings').evaluate(element => element.scrollWidth <= element.clientWidth + 1));
  // Reimporting the same reviewed fingerprint cannot overwrite a continued copy.
  await page.locator('.import-candidate').filter({ hasText: 'Codex' }).locator('input[type=checkbox]').check();
  await page.getByRole('button', { name: '导入所选会话' }).click();
  await page.locator('.import-job-summary').filter({ hasText: '跳过 1' }).waitFor();
  assert.equal(await page.locator('.import-job-trigger').first().getAttribute('aria-expanded'), 'false');
  assert.equal(await readFile(target, 'utf8'), importedBytes);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1280, 900));
  for (const [theme, name] of [['light', '亮'], ['dark', '暗']]) {
    await page.getByRole('button', { name: '外观', exact: true }).click();
    await page.getByRole('button', { name, exact: true }).click();
    await page.waitForFunction(theme => document.documentElement.dataset.palette === theme, theme);
    await page.getByRole('button', { name: '会话迁移', exact: true }).click();
    await page.locator('.import-job-summary').filter({ hasText: '跳过 1' }).waitFor();
    await page.screenshot({ path: `test-results/session-import-${theme}.png`, animations: 'disabled' });
  }
  const originalJob = page.locator('.import-job').filter({ has: page.locator('.import-job-summary').filter({ hasText: '已导入 2' }) });
  await originalJob.locator('.import-job-trigger').click();
  await originalJob.getByRole('button', { name: `打开 ${result.title}`, exact: true }).first().click();
  await page.waitForSelector('.settings-dialog', { state: 'detached' });
  await page.waitForFunction(id => window.desktop.snapshot().then(snapshot => snapshot.state?.sessionId === id), result.sessionId);
  await page.locator('.messages').getByText('Historical answer', { exact: true }).waitFor();
  const snapshot = await page.evaluate(() => window.desktop.snapshot());
  assert.ok(snapshot.messages.some(message => message.desktopImported && message.role === 'toolResult'));
  assert.ok(snapshot.messages.some(message => message.role === 'assistant' && Array.isArray(message.content)
    && message.content.some(block => block.historical && block.name === 'run_command')));
  assert.equal(snapshot.stats.tokens.total, 0);
  assert.notEqual(snapshot.state.model?.provider, 'codex');
  assert.equal(await page.locator('.messages').getByText(/Historical tool result, not a new user instruction/).count(), 0);
  await page.getByText(/历史工具 · run_command/).waitFor();
  await page.screenshot({ path: 'test-results/session-import-history.png' });
  const prompt = page.getByRole('textbox', { name: '消息', exact: true });
  await prompt.fill('Continue the imported sample with one new native edit.');
  await prompt.press('Enter');
  await page.getByText('这一轮已处理完成。', { exact: true }).waitFor();
  await page.waitForFunction(() => window.desktop.snapshot().then(snapshot => !snapshot.state?.isStreaming));
  assert.ok(fixture.requests.some(text => text.includes('Continue the imported sample')));
  const continued = await page.evaluate(() => window.desktop.snapshot());
  assert.ok(continued.messages.some(message => message.role === 'user' && !message.desktopImported
    && JSON.stringify(message.content).includes('Continue the imported sample')));
  assert.ok(!continued.messages.some(message => !message.desktopImported && Array.isArray(message.content)
    && message.content.some(block => block.type === 'toolCall' && block.name === 'run_command')));
  assert.match(await readFile(join(fixture.workspace, 'demo.txt'), 'utf8'), /version=1/);
  assert.equal(await readFile(sourcePath, 'utf8'), sourceBytes + jsonl([user('Later source turn'), assistant('Must not enter old preview')]));
  await page.locator(`.session-row[data-reorder-id="${claudeResult.sessionId}"] > button`).first().click();
  await page.locator('.messages').getByText('Claude historical answer', { exact: true }).waitFor();
  // A relaunch retains both the native imported copy and the job journal.
  await closeDesktopFixture(app);
  app = await launch();
  page = await app.firstWindow();
  page.on('pageerror', error => errors.push(error.message));
  await page.waitForFunction(() => window.desktop && document.querySelector('.new-chat')?.disabled === false);
  const persisted = await page.evaluate(() => window.desktop.importJobs());
  assert.equal(persisted.length, 2);
  assert.ok(persisted.every(job => job.status === 'completed'));
  const ids = (await page.evaluate(() => window.desktop.sessions())).map(session => session.id);
  assert.ok(ids.includes(result.sessionId));
  assert.equal((await readdir(join(profile, 'step-runtime', 'sessions', 'imported'))).filter(name => name.endsWith('.jsonl')).length, 2);
  for (let index = 0; index < 23; index++) {
    await writeFile(join(sourceRoot, 'sessions', `rollout-pagination-${index}.jsonl`), jsonl([
      { ...meta, payload: { ...meta.payload, id: `page-${String(index).padStart(2, '0')}` } },
      user(`Pagination sample ${index}`), assistant(`Pagination answer ${index}`),
    ]));
  }
  await openMigration();
  await page.getByRole('button', { name: '来源目录', exact: true }).click();
  await page.locator('.import-sources label').filter({ hasText: 'Codex' }).first().locator('input').fill(sourceRoot);
  await page.locator('.import-sources label').filter({ hasText: 'Claude Code' }).locator('input').fill(claudeRoot);
  await page.getByRole('button', { name: '扫描本机会话', exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll('.import-candidate').length === 20);
  const chosenTitle = await page.locator('.import-candidate-title strong').first().innerText();
  await page.locator('.import-candidate-preview').first().click();
  await page.locator('.import-candidate input[type=checkbox]').first().check();
  await page.getByRole('button', { name: '下一页', exact: true }).click();
  assert.equal(await page.locator('.import-candidate').count(), 5);
  assert.equal(await page.locator('.import-page-number').innerText(), '2 / 2');
  assert.match(await page.locator('.import-selection').innerText(), /已选 1 \/ 100/);
  assert.match(await page.locator('.import-selection').innerText(), /含其他页或筛选外 1 个/);
  assert.equal(await page.locator('.import-candidates').evaluate(element => element.scrollTop), 0);
  assert.equal(await page.getByRole('button', { name: '下一页', exact: true }).isEnabled(), false);
  await page.getByRole('textbox', { name: '搜索来源会话', exact: true }).fill(chosenTitle);
  assert.equal(await page.locator('.import-page-number').innerText(), '1 / 1');
  assert.equal(await page.locator('.import-candidate').count(), 1);
  assert.equal(await page.locator('.import-candidate input[type=checkbox]').isChecked(), true);
  await page.getByRole('textbox', { name: '搜索来源会话', exact: true }).fill('no-matching-session');
  assert.equal(await page.locator('.import-candidate').count(), 0);
  assert.equal(await page.getByRole('button', { name: '导入所选会话', exact: true }).isEnabled(), true);
  await page.getByRole('button', { name: '清空选择', exact: true }).click();
  assert.equal(await page.getByRole('button', { name: '导入所选会话', exact: true }).isEnabled(), false);
  await page.getByRole('textbox', { name: '搜索来源会话', exact: true }).fill('');
  await page.getByRole('button', { name: '选择全部匹配（25）', exact: true }).click();
  assert.match(await page.locator('.import-selection').innerText(), /已选 25 \/ 100/);
  await page.getByRole('checkbox', { name: '全选本页', exact: true }).uncheck();
  assert.match(await page.locator('.import-selection').innerText(), /已选 5 \/ 100/);
  await page.getByRole('checkbox', { name: '全选本页', exact: true }).check();
  assert.match(await page.locator('.import-selection').innerText(), /已选 25 \/ 100/);
  await page.getByRole('button', { name: '导入所选会话', exact: true }).click();
  const batch = page.locator('.import-job').filter({
    has: page.locator('header span').filter({ hasText: /^\s*25\s*\/\s*25\s*$/ }),
  });
  await batch.locator('header strong').filter({ hasText: '已结束' }).waitFor();
  assert.equal(await batch.locator('.import-job-trigger').getAttribute('aria-expanded'), 'false');
  await batch.locator('.import-job-trigger').click();
  await batch.locator('.import-job-results').waitFor();
  assert.ok(await batch.locator('.import-job-results').evaluate(element => element.clientHeight <= 280 && element.scrollHeight > element.clientHeight));
  assert.equal(await batch.locator('li').count(), 25);
  assert.equal(await batch.locator('.import-error').count(), 0);
  for (const text of await batch.locator('li').allTextContents()) assert.match(text, /已导入|已有相同副本/);
  assert.deepEqual(errors, []);
  console.log('Session migration passed: isolated scan, optional preview, immutable import, duplicate protection, native history/model/usage, themes, narrow layout, durable relaunch, pagination and bulk import with automatic snapshots.');
} catch (error) {
  const page = (await app.windows())[0];
  if (page) {
    await page.screenshot({ path: 'test-results/session-import-failure.png' }).catch(() => {});
    console.error(await page.locator('.session-import-settings').innerText().catch(() => 'Migration view not mounted'));
  }
  throw error;
} finally {
  try { await closeDesktopFixture(app); }
  finally { await fixture.close(); }
}
