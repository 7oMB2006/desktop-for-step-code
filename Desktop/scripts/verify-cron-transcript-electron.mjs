import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron as electron } from 'playwright';
import { closeDesktopFixture } from './close-desktop-fixture.mjs';

const profile = await mkdtemp(join(tmpdir(), 'desktop-cron-transcript-'));
const workspace = join(profile, 'Cron transcript project');
const sessions = join(profile, 'step-runtime/sessions');
await mkdir(workspace);
await mkdir(sessions, { recursive: true });
await mkdir('test-results', { recursive: true });
await writeFile(join(profile, 'preferences.json'), JSON.stringify({ language: 'zh', theme: 'light',
  workspace, workspaces: [workspace] }));
const timestamp = '2026-10-20T01:10:02.000Z';
const time = Date.parse(timestamp);
const reply = (id, parentId, text) => ({ type: 'message', id, parentId, timestamp,
  message: { role: 'assistant', content: [{ type: 'text', text }], timestamp: time + 4000,
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: { total: 0 } } } });
const records = [
  { type: 'session', version: 3, id: 'cron-source-fixture', cwd: workspace, timestamp },
  { type: 'message', id: 'user', parentId: null, timestamp, message: { role: 'user', content: '定时任务验收', timestamp: time } },
  { type: 'session_info', id: 'title', parentId: 'user', timestamp, name: '定时来源验收' },
  reply('previous', 'title', '这是定时触发前已经完成的上一轮回复。'),
  { type: 'custom_message', id: 'fire', parentId: 'previous', timestamp, customType: 'step-cron', display: true,
    content: '[cron] 包内定时指令', details: { id: 'job-fixture', cron: '10 9 * * *', recurring: true, durable: true } },
  reply('reply', 'fire', '这是定时触发后的正常回复。'),
  { type: 'custom_message', id: 'missed', parentId: 'reply', timestamp, customType: 'step-cron', display: true,
    content: '[cron] Missed 1 one-shot job while the session was offline.\n- missed-job: missed instruction',
    details: { kind: 'missed', count: 1, jobs: [] } },
  reply('missed-reply', 'missed', '这是错过提醒后的回复。'),
  { type: 'message', id: 'spoof', parentId: 'missed-reply', timestamp,
    message: { role: 'user', content: '[cron] 用户手写内容', timestamp: time + 8000 } },
  reply('last', 'spoof', '手写内容不是定时触发。'),
];
await writeFile(join(sessions, 'cron-source-fixture.jsonl'), records.map(record => JSON.stringify(record)).join('\n') + '\n');
const env = { ...process.env, DESKTOP_TEST_USER_DATA: profile, DESKTOP_TEST_NO_FOCUS: '1' };
delete env.ELECTRON_RUN_AS_NODE;
let app;
let page;
try {
  app = await electron.launch({ ...(process.env.DESKTOP_VERIFY_EXE ? { executablePath: process.env.DESKTOP_VERIFY_EXE }
    : { args: [resolve('.')] }), env, timeout: 60000 });
  page = await app.firstWindow();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    window.setOpacity(0); window.setIgnoreMouseEvents(true); window.showInactive(); window.setSize(1322, 880);
  });
  await page.getByRole('button', { name: '定时来源验收', exact: true }).click({ timeout: 60000 });
  const fire = page.locator('.cron-message[data-cron-kind=fire]');
  const missed = page.locator('.cron-message[data-cron-kind=missed]');
  await fire.waitFor({ timeout: 60000 });
  await missed.waitFor();
  assert.equal(await page.locator('.cron-message').count(), 2);
  const assertTurns = async () => {
    const turns = page.locator('article.assistant');
    assert.equal(await turns.count(), 4, 'Original, fire, missed and user turns stay separate');
    assert.equal(await turns.nth(0).locator('.cron-message').count(), 0);
    assert.match(await turns.nth(0).innerText(), /上一轮回复/);
    assert.equal(await turns.nth(1).locator('[data-cron-kind=fire]').count(), 1);
    assert.equal(await turns.nth(2).locator('[data-cron-kind=missed]').count(), 1);
    assert.equal(await page.locator('.assistant-actions').count(), 4, 'All settled footers survive');
  };
  await assertTurns();
  await fire.locator('button').click();
  await fire.getByText('10 9 * * *', { exact: true }).waitFor();
  await fire.getByText('job-fixture', { exact: true }).waitFor();
  assert.equal(await page.locator('.response-text').filter({ hasText: '[cron]' }).count(), 0);
  await page.locator('.message.user').filter({ hasText: '[cron] 用户手写内容' }).waitFor();
  await missed.locator('button').click();
  await missed.getByText('Missed 1 one-shot job', { exact: false }).waitFor();
  await page.waitForTimeout(320);
  await page.screenshot({ path: 'test-results/cron-transcript-packaged.png' });
  await page.reload();
  await fire.waitFor({ timeout: 60000 });
  assert.equal(await page.locator('.cron-message').count(), 2);
  await assertTurns();
  assert.equal(await fire.locator('button').getAttribute('aria-expanded'), 'false');
  assert.deepEqual(errors, []);
  await writeFile('test-results/cron-transcript-electron.json', JSON.stringify({
    profile, executable: process.env.DESKTOP_VERIFY_EXE ?? null, passed: true,
    checks: ['native custom-message replay', 'fire/missed classification', 'metadata retained',
      'plain user prefix not reclassified', 'raw cron excluded from assistant prose', 'reload',
      'separate original/fire/missed/user responses', 'all settled footers retained'],
  }, null, 2));
  console.log('Cron transcript Electron acceptance passed (8 checks; isolated saved history, no model requests).');
} catch (error) {
  console.error('Cron transcript acceptance error:', error.stack ?? String(error));
  if (page) {
    const diagnostic = await page.evaluate(async () => {
      const snapshot = await window.desktop.snapshot();
      return { sessionId: snapshot.state?.sessionId, runtimeId: snapshot.runtimeId,
        status: snapshot.status, messageCount: snapshot.messages?.length,
        customTypes: snapshot.messages?.filter(message => message.role === 'custom').map(message => message.customType),
        renderedCron: document.querySelectorAll('.cron-message').length,
        conversationBusy: document.querySelector('.conversation')?.getAttribute('aria-busy') };
    }).catch(error => ({ diagnosticError: String(error) }));
    await writeFile('test-results/cron-transcript-failure.json', JSON.stringify(diagnostic, null, 2));
    await page.screenshot({ path: 'test-results/cron-transcript-failure.png' }).catch(() => {});
  }
  throw error;
} finally {
  if (app) await closeDesktopFixture(app);
}
