import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron as electron } from 'playwright';
import { closeDesktopFixture } from './close-desktop-fixture.mjs';

const profile = await mkdtemp(join(tmpdir(), 'desktop-auto-resume-'));
const workspace = join(profile, 'Recovery fixture');
const sessions = join(profile, 'step-runtime/sessions');
await mkdir(workspace);
await mkdir(sessions, { recursive: true });
await mkdir('test-results', { recursive: true });
await writeFile(join(profile, 'preferences.json'), JSON.stringify({
  language: 'zh', theme: 'light', workspace, workspaces: [workspace],
}));
await writeFile(join(profile, 'step-runtime/config.toml'), 'defaultProvider = "fixture"\ndefaultModel = "fixture"\n[telemetry]\nenabled = false\n');
await writeFile(join(profile, 'step-runtime/models.json'), JSON.stringify({ providers: {
  fixture: { baseUrl: 'http://127.0.0.1:1/v1', api: 'openai-completions', apiKey: 'local-test-only',
    models: [{ id: 'fixture', name: 'Recovery fixture' }] },
} }));
const timestamp = '2026-10-24T10:19:00.000Z';
const time = Date.parse(timestamp);
const prompt = 'The previous turn was interrupted by a transient model or transport error. Re-read the recent transcript and continue from where it stopped. Do not restart from scratch or repeat tool calls whose results are already present. If the work needs a decision from the user, stop and explain what is needed.';
const reply = (id, parentId, text) => ({ type: 'message', id, parentId, timestamp,
  message: { role: 'assistant', content: [{ type: 'text', text }], timestamp: time,
    api: 'openai-completions', provider: 'fixture', model: 'fixture', stopReason: 'stop',
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } } });
const records = [
  { type: 'session', version: 3, id: 'recovery-fixture', cwd: workspace, timestamp },
  { type: 'message', id: 'user', parentId: null, timestamp, message: { role: 'user', content: '检查设备连接', timestamp: time } },
  { type: 'session_info', id: 'title', parentId: 'user', timestamp, name: '自动续跑来源验收' },
  reply('before', 'title', '这是中断前的回复。'),
  { type: 'custom_message', id: 'resume', parentId: 'before', timestamp, customType: 'step-auto-resume',
    display: true, content: prompt, details: { version: 1, kind: 'resume', source: 'autopilot' } },
  reply('after', 'resume', '这是续跑后的回复。'),
  { type: 'message', id: 'manual', parentId: 'after', timestamp,
    message: { role: 'user', content: prompt, timestamp: time + 1000 } },
  reply('manual-reply', 'manual', '这是用户亲自发送的同文。'),
];
await writeFile(join(sessions, 'recovery-fixture.jsonl'), records.map(record => JSON.stringify(record)).join('\n') + '\n');
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
    window.setOpacity(0); window.setIgnoreMouseEvents(true); window.showInactive(); window.setSize(1100, 800);
  });
  await page.waitForFunction(() => document.querySelector('.new-chat')?.disabled === false,
    undefined, { timeout: 60000 });
  await page.getByRole('button', { name: '自动续跑来源验收', exact: true }).click({ timeout: 60000 });
  const assertIdentity = async () => {
    const notice = page.locator('.auto-resume-message');
    await notice.waitFor({ timeout: 60000 });
    assert.equal(await notice.count(), 1);
    assert.match(await notice.innerText(), /已发起自动续跑/);
    assert.equal(await notice.locator('button').count(), 0);
    assert.equal(await page.locator('.message.user').count(), 2);
    assert.equal(await page.locator('article.assistant').count(), 2);
    await page.locator('.message.user').filter({ hasText: prompt }).waitFor();
    assert.equal(await page.locator('article.assistant').getByText(prompt, { exact: true }).count(), 0);
    const continued = page.locator('article.assistant').first();
    assert.match(await continued.innerText(), /中断前的回复/);
    assert.match(await continued.innerText(), /续跑后的回复/);
  };
  await assertIdentity();
  // Reading history paints before the authoritative runtime handoff has committed.
  await page.waitForFunction(() => document.querySelector('.window-session-title')?.textContent === '自动续跑来源验收'
    && document.querySelector('.composer-wrap')?.getAttribute('aria-busy') === 'false'
    && !document.querySelector('.session-reading-preview')
    && document.querySelector('.new-chat')?.disabled === false,
  undefined, { timeout: 60000 });
  const selected = await page.evaluate(() => window.desktop.snapshot());
  assert.equal(selected.state?.sessionId, 'recovery-fixture');
  assert.ok(selected.runtimeId);
  await page.reload();
  await assertIdentity();
  assert.deepEqual(errors, []);
  await page.screenshot({ path: 'test-results/auto-resume-electron.png' });
  console.log('Automatic continuation Electron replay passed: persisted provenance, original user identity, same-text user input and renderer reload.');
} catch (error) {
  await page?.screenshot({ path: 'test-results/auto-resume-electron-failure.png' }).catch(() => {});
  console.error(await page?.locator('body').innerText().catch(() => 'Renderer unavailable'));
  console.error(await page?.evaluate(() => window.desktop.snapshot().then(value => ({
    status: value.status, runtimeId: value.runtimeId, draftId: value.draftId, state: value.state,
    messages: value.messages.map(message => ({ role: message.role, customType: message.customType, details: message.details })),
  }))).catch(() => 'Snapshot unavailable'));
  throw error;
} finally {
  if (app) await closeDesktopFixture(app);
}
