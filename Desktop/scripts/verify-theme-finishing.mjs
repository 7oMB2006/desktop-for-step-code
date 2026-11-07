import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

const output = process.argv[2];
if (!output) throw new Error('Pass an evidence directory');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const base = 'http://127.0.0.1:4197/tests/fixtures/theme-pack.html';
const shot = async name => {
  await page.waitForTimeout(250);
  await page.screenshot({ path: join(output, `${name}.png`) });
};
const open = async view => {
  await page.goto(`${base}?view=${view}`);
  await page.locator('.theme-stellar-stage canvas[data-ready=true]').waitFor();
};
const drawer = page.locator('.approval-drawer');
const snapshot = () => page.evaluate(() => window.desktop.snapshot());
async function focusFits(field) {
  await field.focus();
  await field.scrollIntoViewIfNeeded();
  const result = await field.evaluate(e => {
    const r = e.getBoundingClientRect(), s = getComputedStyle(e);
    const extent = parseFloat(s.outlineWidth) + parseFloat(s.outlineOffset);
    const clips = [];
    for (let p = e.parentElement; p; p = p.parentElement) {
      const style = getComputedStyle(p), box = p.getBoundingClientRect();
      if (/(auto|scroll|hidden|clip)/.test(style.overflowY))
        clips.push(r.top - extent >= box.top - .5 && r.bottom + extent <= box.bottom + .5);
      if (/(auto|scroll|hidden|clip)/.test(style.overflowX))
        clips.push(r.left - extent >= box.left - .5 && r.right + extent <= box.right + .5);
    }
    return { outline: parseFloat(s.outlineWidth), clips };
  });
  assert.ok(result.outline >= 2 && result.clips.every(Boolean), JSON.stringify(result));
}
try {
  await open('chat');
  await page.locator('.composer-input').fill('检查强调色');
  await page.locator('.sidebar-bottom > button').click();
  await page.getByRole('button', { name: '外观', exact: true }).click();
  await page.getByRole('button', { name: '玫红强调色', exact: true }).click();
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.waitForTimeout(250);
  await page.locator('.composer-input').click();
  const accent = await page.locator('.composer-action-button').evaluate(e => ({
    button: getComputedStyle(e).backgroundColor,
    primary: getComputedStyle(document.documentElement).getPropertyValue('--primary').trim(),
    focus: getComputedStyle(document.querySelector('.composer')).borderTopColor,
  }));
  assert.equal(accent.button, accent.primary);
  assert.equal(accent.focus, accent.primary);
  const masks = await page.locator('.messages').evaluate(e => ({
    body: getComputedStyle(e).maskImage, background: getComputedStyle(e, '::before').maskImage,
  }));
  assert.equal(masks.body, 'none');
  assert.match(masks.background, /linear-gradient/);
  assert.equal(await page.locator('.composer-wrap').evaluate(e => getComputedStyle(e, '::before').display), 'none');
  await shot('finishing-reading-accent');

  const scene = page.locator('.stellar-workspace-scene canvas');
  await scene.evaluate(c => {
    window.stellarLoss = c.getContext('webgl2').getExtension('WEBGL_lose_context');
    window.stellarLoss.loseContext();
  });
  await page.locator('.stellar-workspace-scene canvas[hidden]').waitFor({ state: 'attached' });
  await page.waitForFunction(() => document.querySelector('.theme-stellar-poster')?.naturalWidth > 0);
  assert.equal(await page.locator('.theme-stellar-poster').isVisible(), true);
  await shot('finishing-static-fallback');
  await page.waitForTimeout(200);
  await page.evaluate(() => window.stellarLoss.restoreContext());
  await page.locator('.stellar-workspace-scene canvas:not([hidden])[data-ready=true]').waitFor();
  await page.route('**/stellar-cruise/scene.json', route => route.fulfill({ contentType: 'application/json', body: 'invalid json' }));
  await page.reload();
  await page.locator('.stellar-workspace-scene canvas[hidden]').waitFor({ state: 'attached' });
  await page.waitForFunction(() => document.querySelector('.theme-stellar-poster')?.naturalWidth > 0);
  await page.unroute('**/stellar-cruise/scene.json');

  await open('permission');
  await drawer.waitFor();
  await shot('finishing-permission');
  await drawer.getByRole('button', { name: '稍后处理', exact: true }).click();
  await drawer.waitFor({ state: 'detached' });
  await page.getByRole('button', { name: '处理审批', exact: true }).click();
  await drawer.getByRole('button', { name: '拒绝本次操作', exact: true }).click();
  await drawer.waitFor({ state: 'detached' });
  assert.equal((await snapshot()).requests.length, 0);
  assert.equal((await snapshot()).state.isStreaming, false);
  await open('permission');
  await drawer.getByRole('button', { name: '批准本次操作', exact: true }).click();
  await drawer.waitFor({ state: 'detached' });
  assert.match((await snapshot()).messages.at(-1).content, /没有执行操作/);

  await open('plan');
  await drawer.waitFor();
  await shot('finishing-plan');
  await drawer.getByRole('button', { name: '稍后批阅', exact: true }).click();
  await drawer.waitFor({ state: 'detached' });
  await page.getByRole('button', { name: '批阅计划', exact: true }).click();
  await drawer.getByRole('button', { name: '提出修改', exact: true }).click();
  const changes = page.getByRole('textbox', { name: '修改意见', exact: true });
  await changes.fill('保持原版徽标尺寸，并验证静态兜底。');
  await focusFits(changes);
  await shot('finishing-plan-feedback');
  await drawer.getByRole('button', { name: '提交修改意见', exact: true }).click();
  await drawer.waitFor({ state: 'detached' });
  assert.equal((await snapshot()).messages.find(m => m.toolName === 'exit_plan_mode')?.details.outcome, 'feedback');
  await open('plan');
  await drawer.getByRole('button', { name: '批准并执行', exact: true }).click();
  await drawer.waitFor({ state: 'detached' });
  assert.equal((await snapshot()).messages.find(m => m.toolName === 'exit_plan_mode')?.details.outcome, 'approved');

  await open('question');
  await drawer.waitFor();
  await shot('finishing-question');
  await page.getByRole('radio', { name: /安静阅读/ }).check();
  const answer = page.getByRole('textbox', { name: '你的回答', exact: true });
  await answer.fill('让正文保持清晰。');
  await focusFits(answer);
  await drawer.getByRole('button', { name: '稍后回答', exact: true }).click();
  await drawer.waitFor({ state: 'detached' });
  await page.getByRole('button', { name: '打开待回答问题', exact: true }).click();
  assert.equal(await answer.inputValue(), '让正文保持清晰。');
  await drawer.getByRole('button', { name: '提交回答', exact: true }).click();
  await drawer.waitFor({ state: 'detached' });
  assert.equal((await snapshot()).requests.length, 0);
  const result = (await snapshot()).messages.find(m => m.toolName === 'clarify_user');
  assert.deepEqual(result.details.answers.map(a => a.label), ['安静阅读', '让正文保持清晰。']);
  await open('question');
  await drawer.getByRole('button', { name: '稍后回答', exact: true }).click();
  await drawer.waitFor({ state: 'detached' });
  await page.getByRole('button', { name: '停止此轮', exact: true }).click();
  await page.waitForFunction(async () => !(await window.desktop.snapshot()).state.isStreaming);
  assert.equal((await snapshot()).requests.length, 0);
  assert.equal((await snapshot()).messages.find(m => m.toolName === 'clarify_user')?.details.cancelled, true);

  for (const width of [760, 390]) {
    await page.setViewportSize({ width, height: 880 });
    for (const view of ['permission', 'plan', 'question']) {
      await open(view); await drawer.waitFor();
      if (view === 'plan') {
        await drawer.getByRole('button', { name: '提出修改', exact: true }).click();
        await focusFits(changes);
      }
      if (view === 'question') {
        await page.getByRole('radio', { name: /安静阅读/ }).check();
        await focusFits(answer);
      }
      const box = await drawer.boundingBox();
      assert.ok(box.x >= 0 && box.x + box.width <= width + 1);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      await shot(`finishing-${view}-${width}`);
    }
  }
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: true, accent, masks, errors }));
} catch (error) {
  await shot('finishing-failure').catch(() => {});
  console.error((await page.locator('body').innerText()).slice(-2200));
  throw error;
} finally { await browser.close(); }
