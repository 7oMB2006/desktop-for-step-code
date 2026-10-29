import assert from 'node:assert/strict';
import { sampleMotion } from './sample-motion.mjs';
import { settleLayout } from './settle-layout.mjs';

export async function verifyInspectorExpansion(page, panel, screenshot) {
  await settleLayout(panel);
  const before = await panel.evaluate(element => ({
    width: element.closest('.right-inspector-surface').getBoundingClientRect().width,
    scroll: element.querySelector('.context-panel-scroll, .review-scroll').scrollTop,
  }));
  const widthControl = panel.locator('.right-panel-width-control');
  if (await widthControl.count()) {
    for (const [label, value] of [['宽幅', 'wide'], ['全屏', 'fullscreen'], ['标准', 'standard']]) {
      await widthControl.click();
      await page.getByRole('menuitemradio', { name: label, exact: true }).click();
      await page.waitForTimeout(350);
      assert.equal(await widthControl.getAttribute('data-width'), value);
      const width = await panel.evaluate(element => element.closest('.right-inspector-surface').getBoundingClientRect().width);
      if (value !== 'standard') assert.ok(width > before.width, `${value} must expand the inspector`);
      else assert.ok(Math.abs(width - before.width) < 1, 'Standard restores the original width');
      assert.equal(await panel.evaluate(element => element.querySelector('.context-panel-scroll, .review-scroll').scrollTop), before.scroll);
    }
  }
  const sample = async label => {
    await settleLayout(page.locator('.app'));
    await panel.evaluate(element => { element.closest('.right-inspector-surface').dataset.expansionProbe = 'preserved'; });
    const surface = '[data-expansion-probe="preserved"]';
    const motion = await sampleMotion(page, {
      label: `inspector ${label}`,
      state: { selector: `${surface}${label === '全屏查看' ? '.is-expanded' : ':not(.is-expanded)'}` },
      targets: [{ name: 'surface', selector: surface, properties: ['width'] },
        { name: 'rail', selector: '.right-tool-rail' },
        { name: 'app', selector: '.app', customProperties: ['--sidebar-track'] },
        { name: 'main', selector: '.main-content' }],
      duration: 260, easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
    }, () => panel.getByRole('button', { name: label, exact: true }).click());
    const frames = motion.frames.map(frame => ({ width: frame.surface.width, x: frame.surface.x,
      gap: frame.rail.x - frame.surface.right,
      sidebar: parseFloat(frame.app.customProperties['--sidebar-track']), mainInert: frame.main.inert }));
    await settleLayout(page.locator('.app'));
    // Keep a naturally settled endpoint as well as the real effect's samples.
    frames.push(await panel.evaluate(element => {
      const box = element.closest('.right-inspector-surface').getBoundingClientRect();
      return { width: box.width, x: box.x, gap: document.querySelector('.right-tool-rail').getBoundingClientRect().x - box.right,
        sidebar: parseFloat(getComputedStyle(document.querySelector('.app')).getPropertyValue('--sidebar-track')),
        mainInert: document.querySelector('.main-content').inert };
    }));
    return frames;
  };
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
  assert.equal(await page.locator('.main-content').evaluate(element => element.inert), false);
  await panel.getByRole('button', { name: '全屏查看', exact: true }).click();
  await page.waitForTimeout(300);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  assert.equal(await panel.isVisible(), true, 'first Escape must restore rather than close');
  assert.equal(await panel.getByRole('button', { name: '全屏查看', exact: true }).evaluate(element => element === document.activeElement), true);
  return { expanding, restoring };
}
