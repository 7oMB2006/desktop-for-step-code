import assert from 'node:assert/strict';

export async function verifyInspectorExpansion(page, panel, screenshot) {
  const before = await panel.evaluate(element => ({
    width: element.closest('.right-inspector-surface').getBoundingClientRect().width,
    scroll: element.querySelector('.context-panel-scroll, .review-scroll').scrollTop,
  }));
  const sample = label => panel.evaluate(async (element, label) => {
    const surface = element.closest('.right-inspector-surface');
    surface.dataset.expansionProbe = 'preserved';
    element.querySelector(`button[aria-label="${label}"]`).click();
    const frames = [];
    const start = performance.now();
    while (performance.now() - start < 350) {
      await new Promise(resolve => requestAnimationFrame(resolve));
      const box = surface.getBoundingClientRect();
      const app = document.querySelector('.app');
      const rail = document.querySelector('.right-tool-rail').getBoundingClientRect();
      frames.push({ width: box.width, x: box.x, gap: rail.x - box.right,
        sidebar: parseFloat(getComputedStyle(app).getPropertyValue('--sidebar-track')),
        mainInert: document.querySelector('main').inert });
    }
    return frames;
  }, label);
  const expanding = await sample('全屏查看');
  const end = expanding.at(-1);
  assert.ok(Math.abs(end.x - end.sidebar) < 1, 'expanded inspector must fill only the main view');
  assert.ok(Math.abs(end.gap) < 1, 'expanded inspector must retain its right-rail anchor');
  assert.ok(expanding.some(frame => frame.width > before.width + 1 && frame.width < end.width - 1),
    'expand must include intermediate widths');
  assert.ok(expanding.every(frame => frame.mainInert), 'covered transcript must not remain keyboard-interactive');
  assert.equal(await panel.getByRole('button', { name: '还原侧栏', exact: true }).getAttribute('aria-pressed'), 'true');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.screenshot({ path: `test-results/${screenshot}.png` });
  if (await page.evaluate(() => innerWidth > 900)) {
    const sidebarToggle = page.getByRole('button', { name: '侧栏', exact: true });
    await sidebarToggle.click();
    await page.waitForTimeout(350);
    assert.ok(await panel.evaluate(element => {
      const surface = element.closest('.right-inspector-surface').getBoundingClientRect();
      const sidebar = parseFloat(getComputedStyle(document.querySelector('.app')).getPropertyValue('--sidebar-track'));
      return Math.abs(surface.x - sidebar) < 1;
    }), 'expanded inspector must follow sidebar visibility');
    await sidebarToggle.click();
    await page.waitForTimeout(350);
  }
  const restoring = await sample('还原侧栏');
  assert.ok(Math.abs(restoring.at(-1).width - before.width) < 1);
  assert.ok(restoring.some(frame => frame.width > before.width + 1 && frame.width < end.width - 1),
    'restore must include intermediate widths');
  assert.equal(await panel.evaluate(element => element.closest('.right-inspector-surface').dataset.expansionProbe), 'preserved');
  assert.equal(await panel.evaluate(element => element.querySelector('.context-panel-scroll, .review-scroll').scrollTop), before.scroll);
  assert.equal(await page.locator('main').evaluate(element => element.inert), false);
  await panel.getByRole('button', { name: '全屏查看', exact: true }).click();
  await page.waitForTimeout(300);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  assert.equal(await panel.isVisible(), true, 'first Escape must restore rather than close');
  assert.equal(await panel.getByRole('button', { name: '全屏查看', exact: true }).evaluate(element => element === document.activeElement), true);
  return { expanding, restoring };
}
