import { assertFocusVisible } from './assert-focus-visible.mjs';
import assert from 'node:assert/strict';
import { fixtureRuntimeChildren } from './fixture-runtime-children.mjs';
import { _electron as electron } from 'playwright';
import { mkdtemp, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { queueFixture } from './queue-demo-fixture.mjs';
import { closeDesktopFixture } from './close-desktop-fixture.mjs';

const profile = await realpath(await mkdtemp(join(tmpdir(), 'desktop-cron-management-')));
const fixture = await queueFixture(profile, { duration: 6000, textOnly: true });
const agent = join(profile, 'step-runtime', 'agent');
await mkdir(agent, { recursive: true });
await writeFile(join(agent, 'trust.json'), JSON.stringify({ [fixture.workspace]: true }));
const env = { ...process.env, DESKTOP_TEST_USER_DATA: profile, DESKTOP_TEST_NO_FOCUS: '1' };
delete env.ELECTRON_RUN_AS_NODE;
await mkdir('test-results', { recursive: true });
let app;
const errors = [];
const results = [];
// Poll async IPC in Node; waitForFunction's predicate must remain synchronous.
const until = async (check, label) => {
  const deadline = Date.now() + 30000;
  let lastError;
  while (Date.now() < deadline) {
    try { const value = await check(); if (value) return value; }
    catch (error) { lastError = error; }
    await new Promise(resolve => setTimeout(resolve, 80));
  }
  throw new Error(`Timed out: ${label}`, { cause: lastError });
};
const launch = async () => {
  app = await electron.launch({
    ...(process.env.DESKTOP_VERIFY_EXE ? { executablePath: process.env.DESKTOP_VERIFY_EXE } : { args: [resolve('.')] }),
    env, timeout: 60000,
  });
  const page = await app.firstWindow();
  page.on('pageerror', error => errors.push(error.message));
  await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    window.setOpacity(0); window.setIgnoreMouseEvents(true); window.showInactive(); window.setSize(1360, 900);
  });
  await page.getByRole('textbox', { name: '消息', exact: true }).waitFor();
  await page.waitForFunction(() => !document.querySelector('.new-chat')?.disabled, undefined, { timeout: 60000 });
  return page;
};
const close = async () => {
  await closeDesktopFixture(app); app = undefined;
};
const terminateSchedulingChild = async () => {
  const owner = await app.evaluate(({ app }) => ({ pid: process.pid, profile: app.getPath('userData') }));
  assert.equal(owner.profile, profile, 'Only this isolated fixture may be interrupted');
  const children = fixtureRuntimeChildren(owner.pid);
  assert.equal(children.length, 1, 'Only the single reviewed scheduling host is terminated');
  assert.ok(Number.isInteger(children[0]) && children[0] !== owner.pid);
  process.kill(children[0]);
};
try {
  let page = await launch();
  const openManager = async () => {
    await page.getByRole('button', { name: '定时任务', exact: true }).click();
    await page.getByRole('heading', { name: '定时任务', exact: true }).waitFor();
    await page.waitForFunction(() => !document.querySelector('[aria-label="刷新定时任务"]')?.disabled);
  };
  await openManager();
  assert.equal((await page.evaluate(() => window.desktop.snapshot())).runtimes.length, 0,
    'Opening management must not create a scheduler');
  await page.getByRole('button', { name: '创建任务', exact: true }).first().click();
  await page.getByRole('heading', { name: '创建定时任务' }).waitFor();
  assert.equal(await page.getByRole('button', { name: '创建任务', exact: true }).isDisabled(), true);
  await page.getByRole('button', { name: '返回任务列表' }).click();
  results.push('management opens without starting a host and creation requires an explicit live host');

  await page.getByText('队列交互示例（本地模拟）', { exact: true }).click();
  let before;
  for (let attempt = 0; attempt < 120; attempt++) {
    const value = await page.evaluate(() => window.desktop.snapshot());
    if (value.status === 'connected' && value.state?.sessionId === 'queue-demo' && value.messages.length === 2) {
      before = value; break;
    }
    await page.waitForTimeout(100);
  }
  assert.ok(before, 'Saved conversation has finished loading');
  assert.equal(await page.locator('.scheduled-tasks').count(), 0);
  await openManager();
  assert.equal(await page.locator('.session-row.selected').count(), 0);
  await page.getByRole('button', { name: '创建任务', exact: true }).first().click();
  await page.getByRole('heading', { name: '创建定时任务' }).waitFor();
  const durable = page.getByRole('radio', { name: '持久任务', exact: true });
  assert.equal(await durable.isEnabled(), true);
  assert.equal(await durable.isChecked(), true, 'Creation defaults to persistence, independently of frequency');
  await page.getByRole('checkbox', { name: '周期执行', exact: true }).uncheck();
  assert.equal(await durable.isChecked(), true, 'One-off jobs can also survive restart');
  await page.getByRole('checkbox', { name: '周期执行', exact: true }).check();
  await page.getByRole('radio', { name: '临时任务', exact: true }).check();
  await page.getByText('仅保留在当前宿主内存中。', { exact: false }).waitFor();
  await durable.check();
  for (const [theme, width] of [['dark', 1360], ['light', 560]]) {
    await app.evaluate(({ BrowserWindow }, width) => BrowserWindow.getAllWindows()[0].setSize(width, 950), width);
    await page.evaluate(theme => window.desktop.preferences({ theme }), theme);
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('runtime-event', { type: 'desktop_sessions_changed' }));
    await page.waitForFunction(theme => document.documentElement.dataset.theme === theme, theme);
    await assertFocusVisible(page, page.getByLabel('执行时间（本机时区）', { exact: true }), `cron ${theme} ${width} time`);
    await assertFocusVisible(page, page.getByLabel('任务指令', { exact: true }), `cron ${theme} ${width} multiline`);
    await page.locator('.scheduled-storage').scrollIntoViewIfNeeded();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({ path: `test-results/cron-storage-${theme}-${width}.png` });
  }
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1360, 900));
  // Choose tomorrow's local calendar minute, avoiding a trigger during this test.
  const tomorrow = new Date(Date.now() + 86400000);
  const cron = `0 9 ${tomorrow.getDate()} ${tomorrow.getMonth() + 1} *`;
  await page.getByLabel('执行时间（本机时区）', { exact: true }).fill(cron);
  await page.getByLabel('任务指令', { exact: true }).fill('隔离 Cron 管理验收');
  await durable.check();
  await page.getByRole('button', { name: '创建任务', exact: true }).click();
  const row = () => page.locator('.scheduled-row').filter({ hasText: '隔离 Cron 管理验收' });
  await row().waitFor({ timeout: 30000 });
  const file = join(fixture.workspace, '.stepcode', 'cron', 'tasks.json');
  const records = async () => (await readFile(file, 'utf8')).split('\n').filter(Boolean).map(row => JSON.parse(row));
  const stored = await records();
  assert.equal(stored.length, 1);
  assert.equal(stored[0].cron, cron);
  assert.equal(stored[0].durable, true);
  assert.equal(stored[0].sessionId, undefined);
  assert.equal(stored[0].title, undefined);
  const after = await page.evaluate(() => window.desktop.snapshot());
  assert.deepEqual(after.messages, before.messages, 'Management does not manufacture chat/tool messages');
  assert.equal(fixture.requests.length, 0);
  assert.equal(await page.evaluate(() => typeof window.require), 'undefined');
  await assert.rejects(page.evaluate(() => window.desktop.restart()), /scheduled|Cron|定时/i);
  results.push('native create persists schema, preserves history, invokes no model and protects the scheduled host');

  await row().click();
  await page.getByRole('heading', { name: '隔离 Cron 管理验收', exact: true }).waitFor();
  const originalHost = after.runtimeId;
  await page.evaluate(() => window.desktop.preferences({ archivedSessionIds: ['queue-demo'] }));
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('runtime-event', { type: 'desktop_sessions_changed' }));
  await page.locator('.session-row').filter({ hasText: '队列交互示例（本地模拟）' }).waitFor({ state: 'detached' });
  await page.getByRole('button', { name: '前往宿主会话', exact: true }).click();
  await page.locator('.scheduled-tasks').waitFor({ state: 'detached' });
  const openedHost = await page.evaluate(() => window.desktop.snapshot());
  assert.equal(openedHost.runtimeId, originalHost);
  assert.equal(openedHost.state.sessionId, 'queue-demo');
  assert.equal(openedHost.runtimes.length, 1);
  assert.deepEqual(openedHost.preferences.archivedSessionIds, ['queue-demo'], 'Navigation never unarchives its running host');
  assert.equal(fixture.requests.length, 0);
  await assert.rejects(page.evaluate(() => window.desktop.cronOpenHost('unavailable-host')), /session|Disconnected|runtime/i);
  assert.equal((await page.evaluate(() => window.desktop.snapshot())).runtimes.length, 1);
  results.push('Host shortcut opens even an archived live runtime without unarchiving, creating a session, starting work or falling back for an invalid host');
  await page.evaluate(() => window.desktop.preferences({ archivedSessionIds: [] }));
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('runtime-event', { type: 'desktop_sessions_changed' }));
  await openManager();
  await row().click();
  await page.getByRole('heading', { name: '隔离 Cron 管理验收', exact: true }).waitFor();
  {
    await page.getByRole('button', { name: '暂停任务 Beta', exact: true }).click();
    await page.getByRole('button', { name: '恢复任务 Beta', exact: true }).waitFor();
    await page.waitForFunction(() => !document.querySelector('.scheduled-page')?.inert);
    assert.equal((await records())[0].schemaVersion, 2);
    const createdAt = stored[0].createdAt, expiry = stored[0].autoExpireAt;
    await page.getByRole('button', { name: '编辑 Beta', exact: true }).click();
    const editForm = page.getByRole('form', { name: '编辑定时任务' });
    const originalCron = await editForm.getByLabel('执行时间（本机时区）', { exact: true }).inputValue();
    const originalPrompt = await editForm.getByLabel('任务指令', { exact: true }).inputValue();
    await editForm.getByLabel('执行时间（本机时区）', { exact: true }).fill('1 2 * * *');
    await editForm.getByLabel('任务指令', { exact: true }).fill('CANCELLED_UNSAVED_VALUE');
    await page.getByRole('button', { name: '取消编辑', exact: true }).click();
    await page.getByRole('button', { name: '编辑 Beta', exact: true }).click();
    assert.equal(await editForm.getByLabel('执行时间（本机时区）', { exact: true }).inputValue(), originalCron);
    assert.equal(await editForm.getByLabel('任务指令', { exact: true }).inputValue(), originalPrompt);
    assert.equal((await records())[0].prompt, originalPrompt);
    await page.getByRole('form', { name: '编辑定时任务' }).getByLabel('任务指令', { exact: true }).fill('隔离 Cron 管理验收\n已编辑');
    await page.waitForTimeout(300);
    await page.screenshot({ path: 'test-results/cron-management-edit.png' });
    await page.getByRole('button', { name: '保存修改', exact: true }).click();
    await page.getByRole('button', { name: '恢复任务 Beta', exact: true }).waitFor();
    await until(() => page.evaluate(async () => (await window.desktop.cronList()).tasks[0]?.prompt.endsWith('已编辑')), 'edited task snapshot');
    await page.waitForFunction(() => !document.querySelector('.scheduled-page')?.inert);
    assert.equal((await records())[0].id, stored[0].id);
    assert.equal((await records())[0].createdAt, createdAt);
    assert.equal((await records())[0].autoExpireAt, expiry);
    await close();
    page = await launch();
    await openManager();
    await row().waitFor();
    assert.match(await row().textContent(), /已暂停/);
    assert.equal((await page.evaluate(() => window.desktop.snapshot())).runtimes.length, 0);
    await page.getByText('队列交互示例（本地模拟）', { exact: true }).click();
    await until(() => page.evaluate(async () => (await window.desktop.snapshot()).status === 'connected'), 'reopened paused host');
    await openManager();
    await row().click();
    await page.getByRole('button', { name: '恢复任务 Beta', exact: true }).click();
    await page.getByRole('button', { name: '暂停任务 Beta', exact: true }).waitFor();
    assert.equal((await records())[0].schemaVersion, 1);
    assert.equal((await records())[0].autoExpireAt, expiry);
    assert.equal(fixture.requests.length, 0);
    results.push('Beta single-task pause/edit survives relaunch, retains identity/deadline and resumes with zero model calls');
  }
  await page.getByRole('button', { name: '删除任务', exact: true }).click();
  await page.getByRole('button', { name: '保留', exact: true }).click();
  assert.equal((await records()).length, 1);
  const screenshot = async (name, width, height, theme) => {
    await app.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setSize(...size), [width, height]);
    await page.evaluate(theme => window.desktop.preferences({ theme }), theme);
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('runtime-event', { type: 'desktop_sessions_changed' }));
    await page.waitForFunction(theme => document.documentElement.dataset.theme === theme, theme);
    await page.waitForTimeout(300);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({ path: `test-results/cron-management-${name}.png` });
  };
  await screenshot('dark', 1360, 900, 'dark');
  await screenshot('light', 1000, 800, 'light');
  await screenshot('narrow', 560, 850, 'light');
  await page.getByRole('button', { name: '删除任务', exact: true }).click();
  await page.getByRole('button', { name: '确认删除', exact: true }).click();
  await page.getByRole('heading', { name: '定时任务', exact: true }).waitFor();
  await row().waitFor({ state: 'hidden' });
  assert.equal((await records()).length, 0);
  results.push('detail, deletion cancellation/confirmation and dark/light/narrow layouts use the real bridge');

  // Keep one durable record to verify read-only discovery after all hosts have exited.
  await page.evaluate(async cron => {
    const overview = await window.desktop.cronList();
    await window.desktop.cronCreate({ runtimeId: overview.hosts[0].runtimeId, cron,
      prompt: '重启后的离线任务', recurring: true, durable: true });
  }, cron);
  await close();
  page = await launch();
  await openManager();
  const offline = page.locator('.scheduled-row').filter({ hasText: '重启后的离线任务' });
  await offline.waitFor({ timeout: 30000 });
  assert.equal((await page.evaluate(() => window.desktop.snapshot())).runtimes.length, 0);
  assert.match(await offline.textContent(), /宿主离线.*计划时间/s);
  await offline.click();
  await page.getByRole('heading', { name: '重启后的离线任务', exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: '删除任务', exact: true }).isDisabled(), true);
  assert.equal(await page.getByRole('button', { name: '前往宿主会话', exact: true }).isDisabled(), true);
  await assert.rejects(page.evaluate(runtimeId => window.desktop.cronOpenHost(runtimeId), originalHost), /session|Disconnected|runtime/i);
  assert.equal((await page.evaluate(() => window.desktop.snapshot())).runtimes.length, 0);
  assert.equal(fixture.requests.length, 0);
  results.push('relaunch discovers durable records read-only; offline shortcuts and stale host requests cannot start a runtime');
  {
    const tasks = (await page.evaluate(() => window.desktop.cronList())).tasks;
    assert.equal(tasks[0].association.sessionId, 'queue-demo');
    await page.getByRole('button', { name: '恢复项目调度 Beta', exact: true }).click();
    await page.getByRole('button', { name: '核对恢复配置', exact: true }).click();
    await page.getByRole('button', { name: '确认恢复调度', exact: true }).waitFor();
    assert.equal((await page.evaluate(() => window.desktop.snapshot())).runtimes.length, 0);
    assert.equal(fixture.requests.length, 0);
    await screenshot('recovery-dark', 1360, 1000, 'dark');
    await screenshot('recovery-light', 1000, 1000, 'light');
    await screenshot('recovery-narrow', 560, 1000, 'light');
    assert.equal(await page.locator('#scheduled-recovery').evaluate(node =>
      getComputedStyle(node).transitionTimingFunction.includes('cubic-bezier')), true);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    assert.equal(await page.locator('#scheduled-recovery').evaluate(node =>
      getComputedStyle(node).transitionDuration), '0s');
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.getByRole('button', { name: '取消恢复', exact: true }).click();
    await page.getByRole('button', { name: '确认恢复调度', exact: true }).waitFor({ state: 'hidden' });
    assert.equal((await page.evaluate(() => window.desktop.snapshot())).runtimes.length, 0);
    results.push('Beta review/cancel retains association without starting a host or model, including responsive layouts');

    const stale = await page.evaluate(key => window.desktop.cronRecoveryPreview(key, 'queue-demo'), tasks[0].key);
    const original = await readFile(file, 'utf8');
    await writeFile(file, original.split('\n').filter(Boolean).map(line => JSON.stringify({
      ...JSON.parse(line), prompt: 'Changed after consent',
    })).join('\n') + '\n');
    await assert.rejects(page.evaluate(token => window.desktop.cronRecover(token), stale.token), /changed/i);
    assert.equal((await page.evaluate(() => window.desktop.snapshot())).runtimes.length, 0);
    await writeFile(file, original);
    await assert.rejects(page.evaluate(token => window.desktop.cronRecover(token), stale.token), /expired/i);
    results.push('Changed native task invalidates the reviewed snapshot and consumes its token');

    await page.getByRole('button', { name: '恢复项目调度 Beta', exact: true }).click();
    await page.getByRole('button', { name: '核对恢复配置', exact: true }).click();
    await page.getByRole('checkbox', { name: '授权应用启动或空闲宿主异常后自动恢复此项目 · Beta', exact: true }).check();
    await page.getByRole('button', { name: '确认恢复调度', exact: true }).click();
    await page.getByText('调度宿主在线', { exact: true }).waitFor({ timeout: 30000 });
    const overview = await until(async () => {
      const state = await page.evaluate(() => window.desktop.cronList());
      return state.hosts.length === 1 && state.tasks[0]?.automatic?.state === 'enabled' ? state : undefined;
    }, 'confirmed recovery and persisted authorization');
    const recovered = await page.evaluate(() => window.desktop.snapshot());
    assert.equal(recovered.runtimes.length, 1);
    assert.equal(overview.hosts[0].permission, 'ask');
    assert.equal(overview.tasks[0].association.source, 'recovered');
    assert.equal(overview.tasks[0].association.sessionId, 'queue-demo');
    assert.equal(fixture.requests.length, 0);
    assert.match(await readFile(join(profile, 'step-runtime/config.toml'), 'utf8'), /permissionPreset = "approve-for-me"/);
    await assert.rejects(page.evaluate(key => window.desktop.cronRecoveryPreview(key, 'queue-demo'), tasks[0].key), /offline|host/i);
    results.push('Explicit recovery starts exactly one same-project host in Ask, preserves defaults and invokes no model before due');
    assert.equal(overview.tasks[0].automatic.state, 'enabled');
    assert.ok(overview.tasks[0].history.some(row => row.state === 'recovered'));
    await close();
    page = await launch();
    const resumed = await until(async () => {
      const state = await page.evaluate(() => window.desktop.cronList());
      return state.hosts.length === 1 && state.tasks[0]?.automatic?.state === 'enabled' ? state : undefined;
    }, 'automatic startup recovery');
    assert.equal(resumed.hosts.length, 1);
    assert.equal(resumed.hosts[0].permission, 'ask');
    assert.equal(resumed.tasks[0].association.sessionId, 'queue-demo');
    assert.equal(fixture.requests.length, 0);
    const previousHost = resumed.hosts[0].runtimeId;
    await page.locator('.session-row').filter({ hasText: '队列交互示例（本地模拟）' }).locator('button').first().click();
    await page.getByRole('textbox', { name: '消息', exact: true }).fill('保留自动恢复前的草稿');
    await terminateSchedulingChild();
    await until(async () => {
      const state = await page.evaluate(() => window.desktop.cronList());
      return state.hosts.length === 1 && state.hosts[0].runtimeId !== previousHost && state.tasks[0]?.automatic?.state === 'enabled';
    }, 'automatic recovery after idle host termination');
    assert.equal((await page.evaluate(() => window.desktop.snapshot())).runtimes.filter(row => row.sessionId === 'queue-demo').length, 1,
      'Recovery retires the disconnected entry instead of leaving two runtimes for the same conversation');
    await page.waitForFunction(() => document.querySelector('.connection')?.textContent.includes('已连接')
      && document.querySelector('.composer-input')?.getAttribute('contenteditable') === 'true', undefined, { timeout: 5000 });
    assert.equal(await page.getByRole('textbox', { name: '消息', exact: true }).innerText(), '保留自动恢复前的草稿');
    await page.getByRole('textbox', { name: '消息', exact: true }).fill('');
    const restoredHost = (await page.evaluate(() => window.desktop.snapshot())).runtimeId;
    await page.locator('.new-chat').click();
    await page.getByRole('textbox', { name: '消息', exact: true }).fill('不要打断新会话草稿');
    const draftId = (await page.evaluate(() => window.desktop.snapshot())).draftId;
    assert.ok(draftId);
    await terminateSchedulingChild();
    const backgroundHost = await until(async () => {
      const state = await page.evaluate(() => window.desktop.cronList());
      return state.hosts.length === 1 && state.hosts[0].runtimeId !== restoredHost
        && state.tasks[0]?.automatic?.state === 'enabled' ? state.hosts[0] : undefined;
    }, 'background recovery preserves the newly selected draft');
    await app.evaluate(({ BrowserWindow }, event) =>
      BrowserWindow.getAllWindows()[0].webContents.send('runtime-event', event),
    { type: 'desktop_runtime_replaced', previousRuntimeId: restoredHost, runtimeId: backgroundHost.runtimeId, sessionId: 'queue-demo' });
    await page.waitForTimeout(200);
    assert.equal((await page.evaluate(() => window.desktop.snapshot())).draftId, draftId);
    assert.equal(await page.getByRole('textbox', { name: '消息', exact: true }).innerText(), '不要打断新会话草稿');
    results.push('Background host recovery and a stale replacement notification cannot take over a newly selected draft');
    await openManager();
    await page.locator('.scheduled-row').click();
    await page.getByRole('button', { name: '前往宿主会话', exact: true }).click();
    await until(() => page.evaluate(async () => (await window.desktop.snapshot()).status === 'connected'), 'opening the recovered conversation');
    assert.equal((await page.evaluate(() => window.desktop.snapshot())).runtimes.length, 1, 'Opening recovery history reuses the recovered host');
    assert.equal(fixture.requests.length, 0);
    await openManager();
    await page.locator('.scheduled-row').click();
    await page.locator('.scheduled-history summary').click();
    await page.getByText('已恢复调度宿主', { exact: true }).first().waitFor();
    await screenshot('automatic-history', 1100, 1000, 'light');
    await page.getByRole('button', { name: '暂停任务 Beta', exact: true }).click();
    await page.getByRole('button', { name: '恢复任务 Beta', exact: true }).waitFor();
    await page.waitForFunction(() => !document.querySelector('.scheduled-page')?.inert);
    assert.equal((await page.evaluate(() => window.desktop.cronList())).tasks[0].automatic.state, 'blocked');
    await page.getByRole('button', { name: '恢复任务 Beta', exact: true }).click();
    await page.getByRole('button', { name: '暂停任务 Beta', exact: true }).waitFor();
    await page.waitForFunction(() => !document.querySelector('.scheduled-page')?.inert);
    assert.equal((await page.evaluate(() => window.desktop.cronList())).tasks[0].automatic.state, 'blocked',
      'Returning to the original task content cannot revive reviewed automatic authorization');
    assert.equal(fixture.requests.length, 0);
    results.push('Real pause/resume buttons invalidate automatic authorization before mutation and cannot revive it by restoring content');
    await page.evaluate(key => window.desktop.cronDisableAutomatic(key), resumed.tasks[0].key);
    await close();
    page = await launch();
    assert.equal((await page.evaluate(() => window.desktop.snapshot())).runtimes.length, 0);
    assert.equal(fixture.requests.length, 0);
    results.push('Opt-in startup and idle-host crash recovery reuse the reviewed conversation in Ask with zero model calls; revocation survives relaunch');
  }
  await close();
  await writeFile(join(agent, 'trust.json'), '{}');
  page = await launch();
  await page.getByText('队列交互示例（本地模拟）', { exact: true }).click();
  await until(() => page.evaluate(async () => (await window.desktop.snapshot()).status === 'connected'), 'untrusted host connection');
  await openManager();
  await page.getByRole('button', { name: '创建任务', exact: true }).first().click();
  await page.getByRole('heading', { name: '创建定时任务' }).waitFor();
  const persistentChoice = page.getByRole('radio', { name: '持久任务', exact: true });
  assert.equal(await persistentChoice.isChecked(), true);
  await page.getByText('当前宿主未加载项目信任，无法创建持久任务。', { exact: false }).waitFor();
  await page.getByLabel('任务指令', { exact: true }).fill('未信任项目不得自动降级');
  assert.equal(await page.getByRole('button', { name: '创建任务', exact: true }).isDisabled(), true);
  await page.getByRole('button', { name: '调度宿主', exact: true }).click();
  await page.getByRole('menuitemradio').first().click();
  assert.equal(await persistentChoice.isChecked(), true, 'Selecting a host never silently changes storage');
  assert.equal(await page.getByRole('button', { name: '创建任务', exact: true }).isDisabled(), true);
  assert.equal((await records()).length, 1, 'Blocked creation neither writes nor recreates a task');
  await page.locator('.scheduled-storage').scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'test-results/cron-storage-untrusted.png' });
  await page.getByRole('radio', { name: '临时任务', exact: true }).check();
  assert.equal(await page.getByRole('button', { name: '创建任务', exact: true }).isEnabled(), true);
  await page.getByText('仅保留在当前宿主内存中。', { exact: false }).waitFor();
  assert.equal(fixture.requests.length, 0);
  await page.locator('.scheduled-storage').scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'test-results/cron-storage-temporary.png' });
  results.push('Creation defaults durable, blocks untrusted hosts without fallback, and discloses explicit temporary loss independently of recurrence');
  {
    await close();
    await writeFile(join(agent, 'trust.json'), JSON.stringify({ [fixture.workspace]: true }));
    page = await launch();
    const task = (await page.evaluate(() => window.desktop.cronList())).tasks[0];
    const recovered = await page.evaluate(async key => {
      const preview = await window.desktop.cronRecoveryPreview(key, 'queue-demo');
      return window.desktop.cronRecover(preview.token, true);
    }, task.key);
    await page.locator('.session-row').filter({ hasText: '队列交互示例（本地模拟）' }).locator('button').first().click();
    await page.evaluate(id => { void window.desktop.command('prompt', { message: 'Isolated queue preservation check' }, id).catch(() => {}); }, recovered.runtimeId);
    await until(async () => fixture.requests.length === 1
      && (await page.evaluate(() => window.desktop.snapshot())).state?.isStreaming, 'isolated text stream');
    await page.evaluate(id => window.desktop.command('prompt', { message: 'PRESERVE_THIS_UNSENT_MESSAGE' }, id), recovered.runtimeId);
    await page.evaluate(id => window.desktop.command('abort', {}, id), recovered.runtimeId);
    const stopped = await until(async () => {
      const state = await page.evaluate(() => window.desktop.snapshot());
      return !state.state?.isStreaming && state.pendingMessages?.length === 1 && !state.requests.length ? state : undefined;
    }, 'stopped chat retains its queued message');
    await terminateSchedulingChild();
    await until(async () => {
      const state = await page.evaluate(() => window.desktop.cronList());
      return state.tasks[0]?.automatic?.state === 'blocked';
    }, 'unsent queue blocks automatic recovery');
    await page.waitForTimeout(1500);
    const disconnected = await page.evaluate(() => window.desktop.snapshot());
    assert.equal(disconnected.runtimeId, stopped.runtimeId);
    assert.equal(disconnected.status, 'disconnected');
    assert.equal(disconnected.pendingMessages.length, 1);
    assert.equal(disconnected.pendingMessages[0].message, 'PRESERVE_THIS_UNSENT_MESSAGE');
    assert.equal(disconnected.runtimes.length, 1);
    assert.equal(fixture.requests.length, 1, 'No queued or scheduled prompt was automatically sent');
    await assert.rejects(page.evaluate(key => window.desktop.cronRecoveryPreview(key, 'queue-demo'), task.key), /pending messages/);
    const entry = disconnected.pendingMessages[0];
    await page.evaluate(({ runtimeId, entry }) => window.desktop.command('queue_edit',
      { id: entry.id, version: entry.version, message: 'Preserved and still editable' }, runtimeId),
    { runtimeId: stopped.runtimeId, entry });
    const edited = (await page.evaluate(() => window.desktop.snapshot())).pendingMessages[0];
    assert.equal(edited.message, 'Preserved and still editable');
    await page.evaluate(({ runtimeId, entry }) => window.desktop.command('queue_remove',
      { id: entry.id, version: entry.version }, runtimeId), { runtimeId: stopped.runtimeId, entry: edited });
    assert.equal((await page.evaluate(() => window.desktop.snapshot())).pendingMessages.length, 0);
    results.push('Unsent queued text survives an idle host crash, blocks automatic and manual replacement, remains editable and withdrawable, and never auto-sends');
  }
  assert.deepEqual(errors, []);
  await writeFile('test-results/cron-management.json', JSON.stringify({ profile, results, modelCalls: fixture.requests.length }, null, 2));
  console.log(`Cron management Electron acceptance passed (${results.length} cases).`);
} finally {
  if (app) await close();
  await fixture.close();
}
