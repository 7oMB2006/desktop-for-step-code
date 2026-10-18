import assert from 'node:assert/strict';
import { _electron as electron } from 'playwright';
import { mkdtemp, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { queueFixture } from './queue-demo-fixture.mjs';

const profile = await realpath(await mkdtemp(join(tmpdir(), 'desktop-cron-management-')));
const fixture = await queueFixture(profile, { duration: 500 });
const agent = join(profile, 'step-runtime', 'agent');
await mkdir(agent, { recursive: true });
await writeFile(join(agent, 'trust.json'), JSON.stringify({ [fixture.workspace]: true }));
const env = { ...process.env, DESKTOP_TEST_USER_DATA: profile, DESKTOP_TEST_NO_FOCUS: '1' };
delete env.ELECTRON_RUN_AS_NODE;
await mkdir('test-results', { recursive: true });
let app;
const errors = [];
const results = [];
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
  await app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 1 }); });
  await app.close(); app = undefined;
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
  const durable = page.getByLabel('保存为持久任务', { exact: true });
  assert.equal(await durable.isEnabled(), true);
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
  assert.equal(fixture.requests.length, 0);
  results.push('relaunch discovers durable records read-only, without inventing ownership or starting a host');
  if (process.platform === 'win32') {
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
    assert.equal(await page.locator('.scheduled-recovery-disclosure').evaluate(node =>
      getComputedStyle(node).transitionTimingFunction.includes('cubic-bezier')), true);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    assert.equal(await page.locator('.scheduled-recovery-disclosure').evaluate(node =>
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
    await page.getByRole('button', { name: '确认恢复调度', exact: true }).click();
    await page.getByText('调度宿主在线', { exact: true }).waitFor({ timeout: 30000 });
    const recovered = await page.evaluate(() => window.desktop.snapshot());
    assert.equal(recovered.runtimes.length, 1);
    const overview = await page.evaluate(() => window.desktop.cronList());
    assert.equal(overview.hosts[0].permission, 'ask');
    assert.equal(overview.tasks[0].association.source, 'recovered');
    assert.equal(overview.tasks[0].association.sessionId, 'queue-demo');
    assert.equal(fixture.requests.length, 0);
    assert.match(await readFile(join(profile, 'step-runtime/config.toml'), 'utf8'), /permissionPreset = "approve-for-me"/);
    await assert.rejects(page.evaluate(key => window.desktop.cronRecoveryPreview(key, 'queue-demo'), tasks[0].key), /offline|host/i);
    results.push('Explicit recovery starts exactly one same-project host in Ask, preserves defaults and invokes no model before due');
  }
  assert.deepEqual(errors, []);
  await writeFile('test-results/cron-management.json', JSON.stringify({ profile, results, modelCalls: fixture.requests.length }, null, 2));
  console.log(`Cron management Electron acceptance passed (${results.length} cases).`);
} finally {
  if (app) await close();
  await fixture.close();
}
