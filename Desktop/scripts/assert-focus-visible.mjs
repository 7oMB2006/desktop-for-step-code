import assert from 'node:assert/strict';

// Test the complete outline, including its offset, against every clipping
// ancestor and the viewport. Border-box-only checks miss rounded focus rings.
export async function assertFocusVisible(page, field, label, { focus = true } = {}) {
  if (focus) {
    await page.keyboard.press('Tab');
    await field.focus();
  }
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const geometry = await field.evaluate(element => {
    const style = getComputedStyle(element);
    const width = parseFloat(style.outlineWidth) || 0;
    const extent = Math.max(0, width + (parseFloat(style.outlineOffset) || 0));
    const box = element.getBoundingClientRect();
    const ring = { left: box.left - extent, top: box.top - extent, right: box.right + extent, bottom: box.bottom + extent };
    const clipped = [];
    for (let parent = element.parentElement; parent; parent = parent.parentElement) {
      const css = getComputedStyle(parent), bounds = parent.getBoundingClientRect();
      const x = /auto|scroll|hidden|clip/.test(css.overflowX);
      const y = /auto|scroll|hidden|clip/.test(css.overflowY);
      const left = bounds.left + parent.clientLeft, top = bounds.top + parent.clientTop;
      const right = left + parent.clientWidth, bottom = top + parent.clientHeight;
      if (x && (ring.left < left - .5 || ring.right > right + .5)
        || y && (ring.top < top - .5 || ring.bottom > bottom + .5)) {
        clipped.push({ ancestor: parent.className || parent.tagName, bounds: { left, top, right, bottom }, x, y });
      }
    }
    return { focused: document.activeElement === element, visible: element.matches(':focus-visible'),
      outline: style.outlineStyle, width, ring, clipped,
      viewport: ring.left >= 0 && ring.top >= 0 && ring.right <= innerWidth && ring.bottom <= innerHeight };
  });
  assert.ok(geometry.focused && geometry.visible && geometry.width > 0 && geometry.outline !== 'none',
    `${label}: keyboard focus indicator is visible: ${JSON.stringify(geometry)}`);
  assert.ok(geometry.viewport && !geometry.clipped.length,
    `${label}: complete four-sided focus indicator fits clipping ancestors: ${JSON.stringify(geometry)}`);
}
