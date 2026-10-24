import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { _electron as electron } from 'playwright';

const evidence = resolve(process.env.DESKTOP_PREVIEW_EVIDENCE ?? 'test-results/usage-overview-real');
await mkdir(evidence, { recursive: true });
const profile = await mkdtemp(join(evidence, 'profile-'));
await writeFile(join(profile, 'preferences.json'), JSON.stringify({ language: 'zh', theme: 'light', workspaces: [] }));
const sessions = join(profile, 'step-runtime/sessions');
await mkdir(sessions, { recursive: true });
const now = new Date(), timestamp = now.toISOString();
const rows = [
  { type: 'session', version: 3, id: 'usage-real', cwd: profile, timestamp },
  { type: 'custom', id: 'cap', timestamp, customType: 'step.activity_capabilities', data: { version: 1, sessionId: 'usage-real', sessionRole: 'user' } },
  ...[['a', 'step', 'step-3.7-flash', 100], ['b', 'desktop-custom', 'custom-model', 200]].map(([id, provider, model, input]) =>
    ({ type: 'message', id, timestamp, message: { role: 'assistant', content: [{ type: 'text', text: 'PRIVATE-SAMPLE' }],
      provider, model, usage: { input, output: 5, cacheRead: 20, cacheWrite: 10 }, timestamp: now.getTime() } })),
];
const sessionFile = join(sessions, 'usage-real.jsonl'), contents = rows.map(row => JSON.stringify(row)).join('\n') + '\n';
await writeFile(sessionFile, contents);
const ledger = join(profile, 'usage-estimates'); await mkdir(ledger);
await writeFile(join(ledger, `${'a'.repeat(64)}.json`), JSON.stringify([
  { id: 'b'.repeat(64), account: 'c'.repeat(64), mode: 'plan', region: 'cn', amount: 1.25, at: now.getTime(),
    rules: { planProtected: false, apiLegacyCache: false }, priceVersion: 'fixture-history' },
]));
const env = { ...process.env, DESKTOP_TEST_USER_DATA: profile, DESKTOP_TEST_NO_FOCUS: '1' };
delete env.ELECTRON_RUN_AS_NODE; delete env.STEP_API_KEY;
let app;
try {
  const executablePath = process.env.DESKTOP_VERIFY_EXE;
  app = await electron.launch({ ...(executablePath ? { executablePath } : { args: [resolve('.')] }), env, timeout: 60000 });
  const page = await app.firstWindow(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await app.evaluate(({ BrowserWindow, dialog }) => {
    const w = BrowserWindow.getAllWindows()[0]; w.setOpacity(0); w.setIgnoreMouseEvents(true); w.showInactive();
    dialog.showMessageBox = async () => ({ response: 1 });
  });
  await page.getByRole('heading', { name: /^(让想法阶跃星辰|星辰因你而阶跃)$/ }).waitFor();
  const draft = page.getByRole('textbox', { name: '消息', exact: true });
  await draft.fill('Usage retains this draft');
  const node = await draft.elementHandle(), count = app.windows().length;
  const open = async () => {
    await page.locator('.sidebar-identity.usage-entry').click();
    await page.locator('.usage-overview-preview h1').waitFor();
  };
  await open();
  assert.equal(app.windows().length, count);
  assert.equal(await page.getByText('示例数据', { exact: true }).count(), 0);
  assert.equal(await page.getByRole('button', { name: '预览状态', exact: true }).count(), 0);
  assert.equal(await page.locator('.usage-preview-surface select').count(), 0);
  const data = await page.evaluate(() => window.desktop.usageOverview());
  assert.equal(data.days.at(-1).official, 135); assert.equal(data.days.at(-1).custom, 235);
  assert.equal(data.days.at(-1).plan, 1.25); assert.equal(data.days.at(-1).api, null);
  assert.equal(data.days.at(-1).samples.length, 2);
  assert.ok(!JSON.stringify(data).includes('PRIVATE-SAMPLE'));
  assert.ok(!JSON.stringify(data).includes(profile));
  assert.equal(await page.locator('.usage-summary strong').first().innerText(), '370');
  assert.equal(await page.locator('.heat-cell').count(), 365);
  assert.ok(await page.locator('.heat-cell').evaluateAll(cells => cells.every(el => {
    const r = el.getBoundingClientRect(); return r.width === 14 && r.height === 14;
  })));
  await page.getByText('社区版仅保存在本机，暂不支持随账户云端保存或跨设备同步。', { exact: true }).waitFor();
  assert.equal(await page.locator('.usage-cost strong').first().innerText(), '1.25 M Credit');
  assert.equal(await page.locator('.usage-cost strong').nth(1).innerText(), '—');
  const check = async (source, total) => {
    await page.getByRole('button', { name: source, exact: true }).click();
    assert.equal(await page.locator('.usage-summary strong').first().innerText(), String(total));
    assert.equal(await page.locator('.hour-bar').evaluateAll(rows => rows.reduce((sum, el) => sum + Number(el.dataset.tokens), 0)), total);
  };
  await check('阶跃官方', 135); await check('自定义第三方', 235); await check('全部', 370);
  await page.screenshot({ path: join(evidence, 'real-local-overview-light.png'), fullPage: true });
  const hour = page.locator(`.hour-bar[data-hour="${now.getHours()}"]`);
  await hour.locator('.chart-hit-area').hover({ position: { x: 4, y: 20 } });
  const card = page.getByRole('tooltip', { name: '图表数据', exact: true }); await card.waitFor();
  const read = label => card.locator('dl > div').filter({ has: page.getByText(label, { exact: true }) }).locator('dd').innerText();
  assert.equal(await read('缓存写入'), '20');
  assert.equal(await read('Token 合计'), '370');
  assert.equal(await read('缓存命中率'), `${(40 / 360 * 100).toFixed(1)}%`);
  assert.equal(await page.locator('.app-tooltip').count(), 0);
  await page.screenshot({ path: join(evidence, 'real-local-hour-card.png') });
  await page.keyboard.press('Escape'); await card.waitFor({ state: 'hidden' });
  await page.getByRole('button', { name: '近 7 天', exact: true }).click();
  assert.equal(await page.locator('.trend-sample').count(), 7);
  await page.getByRole('button', { name: '折线图', exact: true }).click();
  await page.getByRole('button', { name: '刷新统计', exact: true }).click();
  await page.locator('.usage-body[aria-busy=false]').waitFor();
  await page.locator('.sidebar-identity.usage-entry').click();
  assert.equal(await node.evaluate(el => el.isConnected), true);
  assert.equal(await draft.innerText(), 'Usage retains this draft');
  await page.locator('.sidebar-bottom > button').click();
  await page.getByRole('navigation', { name: '设置分类' }).getByRole('button', { name: '账户', exact: true }).click();
  await page.getByRole('dialog', { name: '设置', exact: true }).getByRole('button', { name: '用量统计', exact: true }).click();
  await page.locator('.usage-overview-preview h1').waitFor();
  assert.equal(await page.getByRole('dialog', { name: '设置', exact: true }).count(), 0);
  await page.getByRole('button', { name: '定时任务', exact: true }).click();
  assert.equal(await page.locator('.usage-overview-preview').count(), 0);
  await open();
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0]; w.setMinimumSize(390, 540); w.setContentSize(390, 844);
  });
  await page.waitForFunction(() => innerWidth === 390);
  await page.locator('.app.sidebar-compact.sidebar-hidden').waitFor();
  await page.waitForFunction(() => {
    const el = document.querySelector('.usage-page');
    return el.clientWidth >= 350 && el.scrollWidth <= el.clientWidth + 1;
  });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.screenshot({ path: join(evidence, 'real-local-narrow.png') });
  assert.deepEqual(errors, []);
  assert.equal(createHash('sha256').update(await readFile(sessionFile)).digest('hex'),
    createHash('sha256').update(contents).digest('hex'), 'Statistics must not mutate sessions');
  console.log('PASS real Usage: native local data/bridge, no samples, official/custom/hour/models/cache/cost, draft, main view, Settings, Cron, 390px, no session writes');
} catch (error) {
  if (app) await (await app.firstWindow()).screenshot({ path: join(evidence, 'failure.png') }).catch(() => {});
  throw error;
} finally { if (app) await app.close(); }
