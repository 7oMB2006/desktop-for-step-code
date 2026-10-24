import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const url = process.env.CRON_PREVIEW_URL ?? 'http://127.0.0.1:5186/tests/fixtures/scheduled-tasks.html';
await mkdir('test-results', { recursive: true });
const browser = await chromium.launch({ headless: true,
  ...(process.env.DESKTOP_TEST_BROWSER_CHANNEL ? { channel: process.env.DESKTOP_TEST_BROWSER_CHANNEL } : {}) });
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1360, height: 860 }, deviceScaleFactor: 1 });
  const screenshot = async name => {
    await page.waitForTimeout(350);
    await page.screenshot({ path: `test-results/${name}.png`, fullPage: true });
  };
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(url);
  const tasks = page.getByRole('region', { name: '定时任务', exact: true });
  await tasks.waitFor();
  const assertSharedSelects = async () => {
    assert.equal(await page.locator('select').count(), 0, 'No browser-native select menus');
    for (const trigger of await page.locator('.scheduled-select > button').all()) {
      assert.equal(await trigger.getAttribute('aria-haspopup'), 'menu');
      assert.equal(await trigger.locator('svg path').getAttribute('d'), 'M3.5 5.25 7 8.75 10.5 5.25', 'Use the shared DisclosureChevron asset');
    }
  };
  const choose = async (label, option) => {
    await page.getByRole('button', { name: label, exact: true }).click();
    await page.getByRole('menu', { name: label, exact: true }).getByRole('menuitemradio', { name: option, exact: true }).click();
  };
  await assertSharedSelects();
  assert.equal(await page.locator('.scheduled-row').count(), 3);
  for (const time of await page.locator('.scheduled-row .scheduled-next-time').all()) {
    assert.equal(await time.evaluate(node => getComputedStyle(node).fontWeight), '600', 'Next time is semibold');
  }
  assert.equal(await page.locator('.scheduled-row .scheduled-time-label').textContent(), '计划时间');
  assert.ok(await page.locator('.sidebar-task-actions').evaluate(element =>
    Math.abs(element.querySelector('.new-chat').getBoundingClientRect().width
      - element.querySelector('[aria-label="插件市场"]').getBoundingClientRect().width) < 1),
  'New chat and plugins retain the latest main primary-action layout');
  await screenshot('scheduled-tasks-light');
  await page.getByRole('button', { name: '整理项目待办', exact: false }).click();
  await page.getByRole('heading', { name: '整理项目待办', exact: true }).waitFor();
  assert.equal(await page.locator('.scheduled-page').evaluate(node => getComputedStyle(node).animationName), 'scheduled-enter');
  const deleteTrigger = page.getByRole('button', { name: '删除任务', exact: true });
  await deleteTrigger.hover();
  await page.waitForTimeout(220);
  assert.equal(await deleteTrigger.evaluate(node => {
    const probe = document.createElement('span');
    probe.style.color = 'var(--danger)';
    node.append(probe);
    const matches = getComputedStyle(node).color === getComputedStyle(probe).color;
    probe.remove();
    return matches;
  }), true, 'Delete hover uses the theme danger color');
  await screenshot('scheduled-tasks-delete-hover');
  await page.getByRole('button', { name: '删除任务', exact: true }).click();
  await page.getByRole('button', { name: '保留', exact: true }).click();
  assert.equal(await page.getByRole('button', { name: '确认删除', exact: true }).count(), 0);
  await screenshot('scheduled-tasks-detail');
  const hostLink = page.getByRole('button', { name: '前往宿主会话', exact: true });
  assert.equal(await hostLink.isEnabled(), true);
  await hostLink.focus();
  await page.getByRole('tooltip').filter({ hasText: '前往宿主会话' }).waitFor();
  await page.keyboard.press('Enter');
  await page.getByRole('heading', { name: 'Cron 桌面适配', exact: true }).waitFor();
  assert.equal(await page.locator('.scheduled-tasks').count(), 0, 'Shortcut navigates to the matching host, not another chat');
  await page.getByRole('button', { name: '定时任务', exact: true }).click();
  await tasks.waitFor();
  await page.getByRole('button', { name: '整理项目待办', exact: false }).click();
  await page.getByRole('heading', { name: '整理项目待办', exact: true }).waitFor();
  await page.getByRole('button', { name: '返回任务列表' }).click();
  await page.locator('.scheduled-toolbar').waitFor();
  assert.equal(await page.locator('.scheduled-page').evaluate(node => getComputedStyle(node).animationName), 'scheduled-enter');
  await page.getByRole('textbox', { name: '搜索定时任务' }).fill('不存在');
  await page.getByRole('heading', { name: '没有匹配的任务' }).waitFor();
  await page.getByRole('button', { name: '清除筛选' }).click();
  assert.equal(await page.locator('.scheduled-row').count(), 3);
  await page.getByRole('button', { name: '筛选项目', exact: true }).click();
  await page.getByRole('menu', { name: '筛选项目', exact: true }).waitFor();
  await screenshot('scheduled-tasks-project-menu');
  await page.keyboard.press('Escape');
  assert.equal(await page.getByRole('button', { name: '筛选项目', exact: true }).evaluate(node => node === document.activeElement), true);
  await choose('筛选项目', 'StepTrading');
  assert.equal(await page.locator('.scheduled-row').count(), 1);
  await choose('筛选项目', '全部项目');
  await page.getByRole('button', { name: '创建任务', exact: true }).click();
  await page.getByRole('heading', { name: '创建定时任务', exact: true }).waitFor();
  assert.equal(await page.locator('.scheduled-page').evaluate(node => getComputedStyle(node).animationName), 'scheduled-enter');
  await assertSharedSelects();
  await page.getByLabel('任务名称').fill('演示测试');
  await page.getByLabel('任务指令').fill('明天下午检查待办');
  await screenshot('scheduled-tasks-create');
  await page.getByRole('button', { name: '预览创建' }).click();
  await page.getByRole('status').filter({ hasText: '未创建真实任务' }).waitFor();
  await page.locator('.scheduled-row').first().waitFor();
  assert.equal(await page.locator('.scheduled-row').count(), 3, 'Preview never pretends to create a real task');
  await page.getByRole('button', { name: '新建会话', exact: true }).click();
  await page.getByRole('heading', { name: '新建会话', exact: true }).waitFor();
  await page.getByRole('button', { name: '定时任务', exact: true }).click();
  await tasks.waitFor();
  await page.getByRole('button', { name: '切换主题' }).click();
  assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark');
  await page.getByRole('button', { name: '筛选项目', exact: true }).click();
  await screenshot('scheduled-tasks-project-menu-dark');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Escape');
  await screenshot('scheduled-tasks-dark');
  await page.getByRole('button', { name: '每周项目回顾', exact: false }).click();
  await page.getByRole('heading', { name: '每周项目回顾', exact: true }).waitFor();
  assert.equal(await page.locator('.scheduled-properties .scheduled-next-time').evaluate(node => node.previousElementSibling.textContent), '计划时间');
  assert.equal(await page.getByRole('button', { name: '前往宿主会话', exact: true }).isDisabled(), true);
  await screenshot('scheduled-tasks-offline-host');
  await page.getByRole('button', { name: '删除任务', exact: true }).click();
  await page.getByRole('button', { name: '确认删除', exact: true }).click();
  await page.locator('.scheduled-row').first().waitFor();
  assert.equal(await page.locator('.scheduled-row').count(), 2);
  await choose('预览数据', '空状态');
  await page.getByRole('heading', { name: '暂无定时任务' }).waitFor();
  await screenshot('scheduled-tasks-empty');
  await choose('预览数据', '任务列表');
  for (const width of [900, 760, 640, 390]) {
    await page.setViewportSize({ width, height: 820 });
    if (width === 390) await page.getByRole('button', { name: '切换侧栏' }).click();
    await screenshot(`scheduled-tasks-${width}`);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `No page overflow at ${width}px`);
    const clipped = await page.locator('.scheduled-heading, .scheduled-row, .scheduled-filters, .sidebar-task-actions > button').evaluateAll(nodes => nodes.filter(node => {
      const rect = node.getBoundingClientRect();
      return rect.width > 0 && node.scrollWidth > node.clientWidth + 2;
    }).map(node => node.className));
    assert.deepEqual(clipped, [], `No control overflow at ${width}px`);
  }
  await page.getByRole('button', { name: '整理项目待办', exact: false }).click();
  await page.getByRole('heading', { name: '整理项目待办', exact: true }).waitFor();
  await screenshot('scheduled-tasks-host-narrow');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.getByRole('button', { name: '前往宿主会话', exact: true }).click();
  await page.getByRole('heading', { name: 'Cron 桌面适配', exact: true }).waitFor();
  await page.getByRole('button', { name: '切换侧栏', exact: true }).click();
  await page.getByRole('button', { name: '定时任务', exact: true }).click();
  await tasks.waitFor();
  await page.getByRole('button', { name: '切换侧栏', exact: true }).click();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.getByRole('button', { name: '创建任务', exact: true }).click();
  await page.getByRole('heading', { name: '创建定时任务', exact: true }).waitFor();
  assert.equal(await page.locator('.scheduled-page').evaluate(node => getComputedStyle(node).animationName), 'none');
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await page.locator('.scheduled-toolbar').waitFor();
  assert.deepEqual(errors, []);
  console.log('PASS: equal sidebar actions, list/detail and online-host navigation, offline-host guard, keyboard tooltip, search/project filter, create preview, delete confirmation, empty state, light/dark, four widths, reduced motion, zero page errors.');
} finally {
  await browser.close();
}
