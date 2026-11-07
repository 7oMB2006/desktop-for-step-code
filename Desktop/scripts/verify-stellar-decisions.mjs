import { chromium } from 'playwright';
import { createServer } from 'vite';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const output = process.argv[2];
if (!output) throw new Error('Pass an evidence directory');
await mkdir(output, { recursive: true });
const root = fileURLToPath(new URL('..', import.meta.url));
const server = await createServer({ root, configFile: join(root, 'vite.theme-preview.config.mjs'),
  server: { host: '127.0.0.1', port: 0, strictPort: false }, logLevel: 'error' });
let browser, page;
const results = {};
try {
  await server.listen();
  const base = `http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/theme-pack.html`;
  browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome', headless: true });
  page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => localStorage.setItem('dfsc-stellar-preview-preferences-v1', JSON.stringify({ themeMotion: false })));
  const open = async view => {
    await page.goto(`${base}?view=${view}`);
    await page.locator('.stellar-workspace-scene canvas[data-ready=true]').waitFor();
  };
  const shot = async name => {
    await page.mouse.move(800, 35);
    await page.waitForTimeout(300);
    await page.screenshot({ path: join(output, `${name}.png`) });
  };
  const focusFits = async field => {
    await field.focus();
    await field.scrollIntoViewIfNeeded();
    const info = await field.evaluate(e => {
      const box = e.getBoundingClientRect(), style = getComputedStyle(e);
      const extent = parseFloat(style.outlineWidth) + parseFloat(style.outlineOffset);
      const clips = [];
      for (let p = e.parentElement; p; p = p.parentElement) {
        const s = getComputedStyle(p), r = p.getBoundingClientRect();
        if (/(auto|scroll|hidden|clip)/.test(s.overflowX))
          clips.push(box.left - extent >= r.left - .5 && box.right + extent <= r.right + .5);
        if (/(auto|scroll|hidden|clip)/.test(s.overflowY))
          clips.push(box.top - extent >= r.top - .5 && box.bottom + extent <= r.bottom + .5);
      }
      return { outline: parseFloat(style.outlineWidth), clips };
    });
    assert.ok(info.outline >= 2 && info.clips.every(Boolean), JSON.stringify(info));
  };
  const drawer = page.locator('.approval-drawer');
  for (const view of ['permission', 'plan', 'question']) {
    await open(view);
    await drawer.waitFor();
    await shot(view);
    if (view === 'permission') {
      await page.getByRole('button', { name: '调整审批抽屉高度', exact: true }).press('End');
      await page.getByRole('button', { name: '完整调用参数', exact: true }).click();
      await shot('permission-details');
      await page.getByRole('button', { name: '拒绝本次操作', exact: true }).click();
    } else if (view === 'plan') {
      await page.getByRole('button', { name: '提出修改', exact: true }).click();
      const field = page.getByRole('textbox', { name: '修改意见', exact: true });
      await field.fill('保留原有尺寸，检查输入焦点。');
      await focusFits(field);
      await shot('plan-feedback');
      await page.getByRole('button', { name: '提交修改意见', exact: true }).click();
    } else {
      await page.getByRole('radio', { name: /其他回答/ }).check();
      const field = page.getByRole('textbox', { name: '你的回答', exact: true });
      await field.fill('保留安静的星海');
      await focusFits(field);
      await shot('question-custom');
      await page.getByRole('button', { name: '稍后回答', exact: true }).click();
      await drawer.waitFor({ state: 'detached' });
      await page.getByRole('button', { name: '打开待回答问题', exact: true }).click();
      assert.equal(await field.inputValue(), '保留安静的星海');
      await page.getByRole('button', { name: '取消提问', exact: true }).click();
    }
    await drawer.waitFor({ state: 'detached' });
    assert.equal((await page.evaluate(() => window.desktop.snapshot())).requests.length, 0);
  }

  await open('queue');
  const queue = page.getByRole('dialog', { name: '待发送消息', exact: true });
  await page.locator('.queue-trigger').click();
  await queue.waitFor();
  assert.equal(await queue.locator('.queue-row').count(), 3);
  await shot('queue-list');
  await queue.getByRole('button', { name: '查看第 1 条全文', exact: true }).click();
  assert.match(await queue.locator('.queue-full-quotes').innerText(), /保持原来的星海构图/);
  await shot('queue-reference');
  await queue.getByRole('button', { name: '返回队列', exact: true }).click();
  await queue.getByRole('button', { name: '编辑第 2 条', exact: true }).click();
  const edit = page.getByRole('textbox', { name: '编辑待发送消息', exact: true });
  await edit.fill('检查批阅抽屉与引用的键盘路径。');
  await focusFits(edit);
  await shot('queue-edit');
  await queue.getByRole('button', { name: '保存队列编辑', exact: true }).click();
  await page.waitForFunction(async () => (await window.desktop.snapshot()).pendingMessages[1].version === 2);
  assert.match(await queue.locator('.queue-full-text').innerText(), /引用的键盘路径/);
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('.queue-trigger').evaluate(e => e === document.activeElement), true);
  await page.locator('.queue-trigger').click();
  await queue.getByRole('button', { name: '撤回第 3 条', exact: true }).click();
  await page.waitForFunction(async () => (await window.desktop.snapshot()).pendingMessages.length === 2);
  await queue.getByRole('button', { name: '插队第 2 条', exact: true }).click();
  await page.waitForFunction(async () => (await window.desktop.snapshot()).pendingMessages.length === 1);
  assert.match((await page.evaluate(() => window.desktop.snapshot())).messages.at(-1).content, /已模拟投递/);

  await open('queue');
  const select = async text => {
    await page.evaluate(text => {
      document.activeElement?.blur();
      const e = [...document.querySelectorAll('.response-text > p')].find(e => e.textContent.includes(text));
      e.scrollIntoView({ block: 'center', behavior: 'instant' });
      const range = document.createRange();
      range.selectNodeContents(e);
      getSelection().removeAllRanges(); getSelection().addRange(range);
    }, text);
    await page.getByRole('toolbar', { name: '选中文字' }).waitFor();
  };
  await select('我先查看');
  await page.getByRole('toolbar', { name: '选中文字' }).getByRole('button', { name: '引用', exact: true }).click();
  const quoteTrigger = page.getByRole('button', { name: '查看引用', exact: true });
  const quotes = page.getByRole('dialog', { name: '引用预览', exact: true });
  await quoteTrigger.click();
  await quotes.waitFor();
  await page.waitForTimeout(250);
  const anchor = await quoteTrigger.boundingBox(), popup = await quotes.boundingBox();
  assert.ok(Math.abs(anchor.x - popup.x) < 2);
  assert.ok(Math.abs(anchor.y - popup.y - popup.height - 8) < 2);
  await shot('quote');
  await page.keyboard.press('Escape');
  assert.equal(await quoteTrigger.evaluate(e => e === document.activeElement), true);
  assert.equal(await page.locator('#summary-board').isVisible(), true, 'Quote Escape must not close the inspector');
  await select('场景由工作区');
  await page.getByRole('toolbar', { name: '选中文字' }).getByRole('button', { name: '批注', exact: true }).click();
  await page.getByRole('textbox', { name: '选段批注', exact: true }).fill('保留这部分设计，核对状态切换。');
  await page.getByRole('button', { name: '添加批注', exact: true }).click();
  await page.getByRole('button', { name: '查看批注', exact: true }).click();
  const annotation = page.getByRole('textbox', { name: '批注 1 内容', exact: true });
  await focusFits(annotation);
  await shot('annotation');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '添加附件', exact: true }).click();
  await page.getByRole('option', { name: /文件和图片/ }).click();
  await page.locator('.attachment-card').waitFor();
  results.attachment = await page.locator('.attachment-card').evaluate(e => [e.offsetWidth, e.offsetHeight]);
  assert.deepEqual(results.attachment, [116, 104]);
  await shot('composer-sources');

  for (const width of [760, 390]) {
    await page.setViewportSize({ width, height: 880 });
    await page.locator('.queue-trigger').click();
    await queue.waitFor();
    await queue.getByRole('button', { name: '编辑第 1 条', exact: true }).click();
    await focusFits(edit);
    await shot(`queue-${width}`);
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: '查看批注', exact: true }).click();
    await focusFits(annotation);
    const r = await page.getByRole('dialog', { name: '批注预览', exact: true }).boundingBox();
    assert.ok(r.x >= 0 && r.x + r.width <= width);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await shot(`annotation-${width}`);
    await page.keyboard.press('Escape');
  }
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await quoteTrigger.click();
  assert.equal(await quotes.evaluate(e => getComputedStyle(e).animationName), 'none');
  await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.locator('.sidebar-bottom > button').click();
  await page.getByRole('button', { name: '外观', exact: true }).click();
  await page.getByRole('button', { name: '原版浅色', exact: true }).click();
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.locator('.settings-dialog').waitFor({ state: 'detached' });
  assert.equal(await page.evaluate(() => document.documentElement.dataset.themeMaterial), undefined);
  assert.deepEqual(await page.locator('.attachment-card').evaluate(e => [e.offsetWidth, e.offsetHeight]), results.attachment);
  await page.locator('.queue-trigger').click();
  assert.equal(await queue.evaluate(e => getComputedStyle(e).borderTopLeftRadius), '8px');
  await shot('built-in-queue');
  await page.keyboard.press('Escape');
  await queue.waitFor({ state: 'hidden' });
  assert.equal(await page.locator('.queue-trigger').evaluate(e => e === document.activeElement), true);
  assert.equal(await page.locator('#summary-board').isVisible(), true, 'Queue Escape must not close the inspector');
  await quoteTrigger.click();
  await quotes.waitFor();
  await quotes.locator('.quote-excerpt').focus();
  await page.keyboard.press('Escape');
  await quotes.waitFor({ state: 'hidden' });
  assert.equal(await quoteTrigger.evaluate(e => e === document.activeElement), true);
  assert.equal(await page.locator('#summary-board').isVisible(), true);
  assert.deepEqual(errors, []);
  await writeFile(join(output, 'acceptance.json'), JSON.stringify({ passed: true, results, errors }, null, 2));
  console.log(JSON.stringify({ passed: true, results, errors }));
} catch (error) {
  await page?.screenshot({ path: join(output, 'failure.png') }).catch(() => {});
  throw error;
} finally {
  await browser?.close();
  await server.close();
}
