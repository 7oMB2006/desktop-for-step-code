import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright';
import { closeDesktopFixtureAndWait } from './close-desktop-fixture.mjs';
import { queueFixture } from './queue-demo-fixture.mjs';
import { readRuntimeBaseline } from './runtime-baseline.mjs';
import { settleLayout } from './settle-layout.mjs';
import { mkdtemp, removeTestProfile } from './test-profile.mjs';

const appPath = resolve(fileURLToPath(new URL('..', import.meta.url)));
const executable = process.env.DESKTOP_VERIFY_EXE;
const staged = process.env.DESKTOP_VERIFY_RUNTIME;
assert.ok(Boolean(executable) !== Boolean(staged), 'Set exactly one of DESKTOP_VERIFY_EXE or DESKTOP_VERIFY_RUNTIME');
const executablePath = executable ? await realpath(resolve(executable)) : undefined;
const runtime = executablePath ? join(dirname(executablePath), process.platform === 'darwin' ? '../Resources/runtime' : 'resources/runtime')
  : await realpath(resolve(staged));
assert.equal(basename(runtime), 'runtime', 'Stage the candidate in an isolated directory named runtime');
const manifest = JSON.parse(await readFile(join(runtime, 'manifest.json'), 'utf8'));
const { manifest: baseline } = await readRuntimeBaseline('v018');
assert.equal(manifest.commit, baseline.commit, 'Use the staged v0.1.8 runtime, not the default runtime');
assert.ok(manifest.patches?.includes('desktop-cron-session-ownership-v1'), 'The candidate must attest native Cron session ownership');

const profile = await realpath(await mkdtemp(join(tmpdir(), 'desktop-cron-v018-')));
const fixture = await queueFixture(profile, { textOnly: true, duration: 120 });
const agentDir = join(profile, 'step-runtime', 'agent');
const sessions = join(profile, 'step-runtime', 'sessions');
const cronDir = join(fixture.workspace, '.stepcode', 'cron');
const taskFile = join(cronDir, 'tasks.json');
const grants = join(profile, 'cron-recovery-authorizations');
const ownerA = 'queue-demo';
const ownerB = 'owner-two';
const ownerBName = 'Cron v018 owner two';
const ownerBFile = join(sessions, `${ownerB}.jsonl`);
const now = Date.now();
const future = now + 2 * 3600000;
const originalSession = (await readFile(join(sessions, `${ownerA}.jsonl`), 'utf8')).trim().split(/\r?\n/u).map(JSON.parse);
const alternate = originalSession.map(row => row.type === 'session' ? { ...row, id: ownerB }
  : row.type === 'session_info' ? { ...row, name: ownerBName } : row);
await writeFile(ownerBFile, alternate.map(row => JSON.stringify(row)).join('\n') + '\n');
await mkdir(agentDir, { recursive: true });
await writeFile(join(agentDir, 'trust.json'), JSON.stringify({ [fixture.workspace]: true }));
await mkdir(cronDir, { recursive: true });
const legacy = { schemaVersion: 1, id: 'legacy-due', cron: '* * * * *', prompt: 'Unbound overdue task',
  recurring: false, durable: true, createdAt: now - 120000, nextFireAt: now - 60000 };
const parked = { ...legacy, id: 'legacy-paused', prompt: 'Legacy pause must survive', schemaVersion: 2, desktopPausedAt: now - 12000 };
const owned = { ...legacy, id: 'owned-two', prompt: 'Original owner only', schemaVersion: 2, status: 'enabled',
  origin: 'desktop', workspace: fixture.workspace, sessionId: ownerB, sessionFile: await realpath(ownerBFile),
  nextFireAt: future, runAt: future, jitter: false };
const missed = { ...owned, id: 'missed-two', prompt: 'Already missed once', status: 'completed', lastStatus: 'missed',
  nextFireAt: now - 1000, runAt: now - 1000 };
const originalRows = [legacy, parked, owned, missed].map(row => JSON.stringify(row));
const originalTasks = originalRows.join('\n') + '\n';
await writeFile(taskFile, originalTasks);
await mkdir(grants, { recursive: true });
const hash = value => createHash('sha256').update(value).digest('hex');
const workspaceKey = process.platform === 'win32' ? fixture.workspace.replaceAll('\\', '/').toLowerCase() : fixture.workspace;
const grantFile = join(grants, `${hash(workspaceKey)}.json`);
const grant = JSON.stringify({ version: 1, revision: 'old-grant', key: JSON.stringify([workspaceKey, legacy.id]),
  workspace: fixture.workspace, sessionId: ownerA, configurationRef: 'a'.repeat(64),
  model: { id: 'queue-demo', provider: 'queue-demo' }, jobs: [hash('legacy fixture')], state: 'enabled', expires: future });
await writeFile(grantFile, grant);

const env = { ...process.env, DESKTOP_TEST_USER_DATA: profile, DESKTOP_TEST_NO_FOCUS: '1' };
delete env.ELECTRON_RUN_AS_NODE;
const errors = [];
const launch = () => electron.launch({
  ...(executablePath ? { executablePath, cwd: profile } : { args: [appPath], cwd: dirname(runtime) }),
  env, timeout: 60000,
});
let app;
try {
  app = await launch();
  assert.equal(await app.evaluate(({ app }) => app.getPath('userData')), profile);
  const page = await app.firstWindow();
  page.on('pageerror', error => errors.push(error.message));
  await page.getByRole('textbox', { name: '消息', exact: true }).waitFor();
  await page.waitForFunction(() => !document.querySelector('.new-chat')?.disabled);
  const list = () => page.evaluate(() => window.desktop.cronList());
  const inspect = id => list().then(inventory => inventory.tasks.find(task => task.id === id));
  const taskButton = text => page.locator('.scheduled-list').getByRole('button').filter({ hasText: text });
  const openManager = async () => {
    await page.getByRole('button', { name: '定时任务', exact: true }).click();
    await page.getByRole('heading', { name: '定时任务', exact: true }).waitFor();
    await taskButton(legacy.prompt).waitFor();
  };

  const cold = await list();
  assert.equal(cold.sessionOwned, true, 'The actual desktop candidate must attest v018 Cron ownership');
  assert.equal(cold.hosts.length, 0);
  assert.equal((await page.evaluate(() => window.desktop.snapshot())).runtimes.length, 0);
  assert.equal(await readFile(taskFile, 'utf8'), originalTasks);
  assert.equal(await readFile(grantFile, 'utf8'), grant);
  assert.equal(cold.tasks.find(task => task.id === legacy.id)?.scheduling, 'parked');
  assert.equal(cold.tasks.find(task => task.id === missed.id)?.scheduling, 'missed');
  assert.equal(cold.tasks.some(task => task.automatic?.state === 'enabled'), false);
  assert.doesNotMatch(JSON.stringify(cold), /sessionFile/);
  await openManager();
  await taskButton(legacy.prompt).getByText('旧任务未启用', { exact: true }).waitFor();
  await taskButton(missed.prompt).getByText('已错过，未运行', { exact: true }).waitFor();
  await taskButton(legacy.prompt).click();
  await page.getByRole('heading', { name: legacy.prompt, exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: '恢复会话调度 Beta', exact: true }).count(), 0);

  await page.getByText('队列交互示例（本地模拟）', { exact: true }).click();
  await page.waitForFunction(id => document.querySelector(`[data-reorder-id="${id}"]`)?.classList.contains('selected'), ownerA);
  let ownerARuntime;
  for (let i = 0; i < 120; i++) {
    const current = await list().catch(() => undefined);
    ownerARuntime = current?.hosts.find(host => host.sessionId === ownerA)?.runtimeId;
    if (ownerARuntime) {
      assert.equal(current.hosts.some(host => host.sessionId === ownerB), false);
      assert.equal(current.tasks.find(task => task.id === owned.id)?.runtimeId, undefined);
      break;
    }
    await new Promise(done => setTimeout(done, 100));
  }
  assert.ok(ownerARuntime);
  assert.equal(await readFile(taskFile, 'utf8'), originalTasks);
  assert.equal(fixture.requests.length, 0);
  const target = await inspect(owned.id);
  await assert.rejects(page.evaluate(({ key, sessionId }) => window.desktop.cronRecoveryPreview(key, sessionId),
    { key: target.key, sessionId: ownerA }), /owned by this conversation/);

  await openManager();
  await taskButton(owned.prompt).click();
  await page.getByRole('button', { name: '恢复会话调度 Beta', exact: true }).click();
  const panel = page.locator('#scheduled-recovery');
  await settleLayout(panel);
  await panel.getByRole('button', { name: '核对恢复配置', exact: true }).click();
  await panel.getByRole('button', { name: '确认恢复调度', exact: true }).waitFor();
  await panel.getByRole('checkbox', { name: /到点前唤醒此会话/ }).waitFor();
  await panel.getByText(ownerBName, { exact: true }).first().waitFor();
  assert.deepEqual(await panel.getByRole('listitem').allTextContents(), [owned.prompt]);
  await panel.getByRole('button', { name: '确认恢复调度', exact: true }).click();
  await page.getByText('调度宿主在线', { exact: true }).waitFor();
  const confirmed = await list();
  const recovered = confirmed.tasks.find(task => task.id === owned.id);
  assert.ok(recovered?.runtimeId && recovered.runtimeId !== ownerARuntime);
  assert.equal(confirmed.hosts.find(host => host.runtimeId === recovered.runtimeId)?.sessionId, ownerB);
  assert.equal(confirmed.hosts.some(host => host.runtimeId === ownerARuntime), true);
  assert.equal(await readFile(taskFile, 'utf8'), originalTasks);
  assert.equal(await readFile(grantFile, 'utf8'), grant);
  await page.getByRole('button', { name: '返回任务列表', exact: true }).click();

  const createTask = async (mode, prompt, configure) => {
    await page.getByRole('button', { name: '创建任务', exact: true }).click();
    await page.getByRole('heading', { name: '创建定时任务', exact: true }).waitFor();
    await page.getByRole('button', { name: '调度宿主', exact: true }).click();
    await page.getByRole('menuitemradio').filter({ hasText: '队列交互示例（本地模拟）' }).click();
    await page.getByRole('button', { name: '调度方式', exact: true }).click();
    await page.getByRole('menuitemradio', { name: mode, exact: true }).click();
    await configure();
    await page.getByRole('textbox', { name: '任务指令', exact: true }).fill(prompt);
    await page.getByRole('button', { name: '创建任务', exact: true }).click();
    await taskButton(prompt).waitFor();
  };
  const intervalPrompt = 'New fixed-interval task in owner A';
  await createTask('固定间隔', intervalPrompt, () => page.getByLabel('间隔（小时）', { exact: true }).fill('5'));
  await taskButton(intervalPrompt).getByText('每 5 小时', { exact: true }).waitFor();
  const runAt = Math.ceil((now + 3 * 3600000) / 60000) * 60000;
  const localValue = new Date(runAt - new Date(runAt).getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  const oncePrompt = 'New exact one-shot in owner A';
  await createTask('指定时间一次', oncePrompt, () => page.locator('[name="runAt"]').fill(localValue));
  const persisted = (await readFile(taskFile, 'utf8')).trim().split(/\r?\n/u);
  assert.deepEqual(persisted.filter(line => originalRows.includes(line)), originalRows);
  const interval = persisted.map(JSON.parse).find(row => row.prompt === intervalPrompt);
  assert.equal(interval.intervalHours, 5);
  assert.equal(interval.sessionId, ownerA);
  const once = persisted.map(JSON.parse).find(row => row.prompt === oncePrompt);
  assert.equal(once.runAt, runAt);
  assert.equal(once.nextFireAt, runAt, 'An explicit one-shot time cannot be adjusted by fallback cron jitter');
  assert.equal(once.sessionId, ownerA);
  assert.equal(fixture.requests.length, 0, 'Opening a different owner and recovering a future task must not call a model');
  assert.deepEqual(errors, []);

  // A is authorized but hours away; B is due soon. Restart without opening either chat.
  const authorize = async prompt => {
    await taskButton(prompt).click();
    await page.getByRole('button', { name: '授权后台唤醒 Beta', exact: true }).click();
    await settleLayout(panel);
    await panel.getByRole('button', { name: '核对恢复配置', exact: true }).click();
    await panel.getByRole('button', { name: '确认授权', exact: true }).click();
    await page.getByText('后台唤醒 · Beta：已授权', { exact: true }).waitFor();
    await page.getByRole('button', { name: '返回任务列表', exact: true }).click();
  };
  await authorize(intervalPrompt);
  const wakeAt = Date.now() + 35_000;
  const wakePrompt = 'Wake and execute only in conversation B';
  await page.evaluate(input => window.desktop.cronCreate(input), { runtimeId: recovered.runtimeId, cron: '* * * * *',
    prompt: wakePrompt, recurring: false, durable: true, runAt: wakeAt });
  const wakeId = (await list()).tasks.find(task => task.prompt === wakePrompt)?.id;
  assert.ok(wakeId);
  await authorize(wakePrompt);
  assert.equal(fixture.requests.length, 0, 'Authorization itself must not call a model');
  await closeDesktopFixtureAndWait(app);
  app = undefined;
  assert.ok(Date.now() < wakeAt, 'Fixture must restart before the scheduled time');
  app = await launch();
  const reopened = await app.firstWindow();
  reopened.on('pageerror', error => errors.push(error.message));
  const waitForWake = async (predicate, before, label) => {
    while (Date.now() < before) {
      const overview = await reopened.evaluate(() => window.desktop.cronList()).catch(() => undefined);
      if (overview?.hosts.length === 1 && overview.hosts[0].sessionId === ownerB && overview.hosts[0].permission === 'ask'
        && predicate(overview.tasks.find(task => task.id === wakeId), overview.hosts[0], overview.history ?? [])) return;
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    assert.fail(`Timed out waiting for ${label}`);
  };
  await waitForWake((task, host) => task?.runtimeId === host.runtimeId, wakeAt, 'the original owner to wake before the deadline');
  assert.equal(fixture.requests.length, 0, 'Waking the host must not fire early');
  await waitForWake((_task, _host, history) => history.some(project => project.entries.some(row =>
    row.jobId === wakeId && row.state === 'completed' && row.sessionId === ownerB)),
    wakeAt + 30_000, 'a completed scheduled turn in the original owner');
  assert.equal(fixture.requests.length, 1);
  assert.notEqual(await reopened.evaluate(async () => (await window.desktop.snapshot()).state?.sessionId), ownerB,
    'Background wake must not activate the conversation in the window');
  assert.match(await readFile(ownerBFile, 'utf8'), /Wake and execute only in conversation B/);
  assert.doesNotMatch(await readFile(join(sessions, `${ownerA}.jsonl`), 'utf8'), /Wake and execute only in conversation B/);
  assert.equal(await readFile(grantFile, 'utf8'), grant);
  assert.deepEqual(errors, []);
  console.log('v018 Cron Electron passed: upgrade, scoped recovery, scheduling modes and one background wake after restart.');
} finally {
  try {
    if (app) await closeDesktopFixtureAndWait(app);
  } finally { await fixture.close(); }
}
await removeTestProfile(profile);
