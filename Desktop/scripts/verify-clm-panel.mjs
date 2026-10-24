import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import { createServer } from 'vite';
const output = process.env.CLM_PREVIEW_OUTPUT || 'test-results/clm-panel';
await mkdir(output, { recursive: true });
const server = await createServer({ server: { host: '127.0.0.1', port: 0 } });
await server.listen();
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined });
try {
  const page = await browser.newPage({ viewport: { width: 1100, height: 1100 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${server.resolvedUrls.local[0]}tests/fixtures/clm-panel.html`);
  await page.getByRole('button', { name: '查看修订 r27', exact: true }).waitFor();
  await page.getByRole('button', { name: '更早修订', exact: true }).click();
  await page.getByRole('button', { name: '查看修订 r18', exact: true }).click();
  await page.getByText('r18 · 历史只读', { exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: '整理上下文', exact: true }).isEnabled(), false);
  await page.getByRole('button', { name: '修改对比', exact: true }).click();
  await page.getByRole('region', { name: '修改前', exact: true }).getByText('切换身份与响应做过一致性检查，需要按生效账户校验返回值。', { exact: false }).waitFor();
  await page.getByRole('region', { name: '修改后', exact: true }).getByText('过期身份的响应必须丢弃，避免覆盖切换后的账户。', { exact: false }).waitFor();
  assert.equal(await page.locator('.clm-comparison').innerText().then(text => text.includes('CTX_TURN')), false);
  await page.locator('.clm-diff .clm-disclosure summary').click();
  await page.getByText('Index: LIVE_CONTEXT.md', { exact: false }).waitFor();
  await page.getByRole('button', { name: '上下文宽度', exact: true }).click();
  await page.getByRole('menuitemradio', { name: '宽幅', exact: true }).click();
  assert.equal(await page.getByRole('button', { name: '上下文宽度', exact: true }).getAttribute('data-width'), 'wide');
  await page.getByRole('region', { name: '修改后', exact: true }).waitFor();
  await page.getByRole('button', { name: '工作内容', exact: true }).click();
  await page.getByRole('combobox', { name: '选择内容', exact: true }).selectOption('ctx-assistant');
  await page.getByText('修订 r18：已核对账户隔离。剩余测试包含超时与认证失效。', { exact: true }).last().waitFor();
  await page.getByRole('button', { name: '回到当前', exact: true }).click();
  await page.getByText('r27 · 最近保存版本', { exact: true }).waitFor();
  await page.getByRole('switch', { name: '启用 CLM', exact: true }).click();
  await page.getByText('CLM 已关闭', { exact: true }).waitFor();
  await page.getByRole('switch', { name: '启用 CLM', exact: true }).click();
  await page.getByText('CLM 已启用', { exact: true }).waitFor();
  await page.getByRole('button', { name: '模拟任务运行', exact: true }).click();
  assert.equal(await page.getByRole('button', { name: '整理上下文', exact: true }).isEnabled(), false);
  await page.getByRole('button', { name: '停止模拟任务', exact: true }).click();
  await page.getByText('r27 · 最近保存版本', { exact: true }).waitFor();
  await page.getByRole('button', { name: '整理上下文', exact: true }).click();
  await page.getByLabel('保留重点（可选）').fill('保留验证边界');
  await page.getByRole('button', { name: '开始整理', exact: true }).click();
  await page.getByText('r27 · 最近保存版本', { exact: true }).waitFor();
  for (const theme of ['light', 'dark']) {
    await page.goto(`${server.resolvedUrls.local[0]}tests/fixtures/clm-panel.html?theme=${theme}`);
    await page.getByRole('button', { name: '查看修订 r27', exact: true }).waitFor();
    for (const width of [1100, 390, 320]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.locator('.context-panel').evaluate(async element => {
        await Promise.all(element.getAnimations().map(animation => animation.finished.catch(() => {})));
      });
      await page.screenshot({ path: `${output}/clm-integrated-${theme}-${width}.png` });
      await page.getByRole('button', { name: '修改对比', exact: true }).click();
      await page.getByRole('region', { name: '修改后', exact: true }).waitFor();
      await page.screenshot({ path: `${output}/clm-readable-${theme}-${width}.png` });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false,
        JSON.stringify(await page.evaluate(() => [...document.querySelectorAll('body *')].filter(el => el.getBoundingClientRect().right > innerWidth + 1).map(el => el.className).slice(0, 20))));
      await page.getByRole('button', { name: '概览', exact: true }).click();
    }
  }
  assert.deepEqual(errors, []);
  console.log('CLM real component: history, diff, content, enable/disable, busy guards, manual action and responsive themes passed.');
} finally { await browser.close(); await server.close(); }
