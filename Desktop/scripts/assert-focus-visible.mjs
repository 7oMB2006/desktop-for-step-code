import assert from 'node:assert/strict';

// Test the complete outline, including its offset, against every clipping
// ancestor and the viewport. Border-box-only checks miss rounded focus rings.
export async function assertFocusVisible(page, field, label, { focus = true, checkTreatment = false } = {}) {
  if (focus) {
    await page.keyboard.press('Tab');
    await field.focus();
  }
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const geometry = await field.evaluate(async (element, checkTreatment) => {
    if (checkTreatment) {
      await Promise.all(element.getAnimations()
        .filter(animation => animation.transitionProperty === 'outline-color')
        .map(animation => animation.finished.catch(error => {
          if (error?.name !== 'AbortError') throw error;
        })));
    }
    const style = getComputedStyle(element);
    const width = parseFloat(style.outlineWidth) || 0;
    const offset = parseFloat(style.outlineOffset) || 0;
    const extent = Math.max(0, width + offset);
    const form = checkTreatment && element.matches(
      'select, textarea, .form-focus-trigger, input:not([type=checkbox], [type=radio], [type=range], [type=color], [type=file], [type=button], [type=submit], [type=reset], [type=image], [type=hidden])');
    const forcedColors = matchMedia('(forced-colors: active)').matches;
    let alpha;
    if (checkTreatment) {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 1;
      const context = canvas.getContext('2d');
      context.fillStyle = style.outlineColor;
      context.fillRect(0, 0, 1, 1);
      alpha = context.getImageData(0, 0, 1, 1).data[3];
    }
    // The form reserves 4px even though its normal outline only paints 3px.
    const gutter = form ? Math.max(4, extent) : extent;
    const box = element.getBoundingClientRect();
    const ring = { left: box.left - gutter, top: box.top - gutter, right: box.right + gutter, bottom: box.bottom + gutter };
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
      // A native modal is on the top layer, outside its DOM ancestors' overflow.
      if (parent.matches(':modal')) break;
    }
    return { focused: document.activeElement === element, visible: element.matches(':focus-visible'),
      outline: style.outlineStyle, width, offset, extent, alpha, form, forcedColors, ring, clipped,
      viewport: ring.left >= 0 && ring.top >= 0 && ring.right <= innerWidth && ring.bottom <= innerHeight };
  }, checkTreatment);
  assert.ok(geometry.focused && geometry.visible && geometry.width > 0 && geometry.outline !== 'none',
    `${label}: keyboard focus indicator is visible: ${JSON.stringify(geometry)}`);
  if (checkTreatment) {
    assert.ok(geometry.alpha > 0, `${label}: focus outline is not transparent: ${JSON.stringify(geometry)}`);
    if (geometry.form) {
      assert.equal(geometry.width, geometry.forcedColors ? 2 : 1, `${label}: shared form outline width`);
      assert.equal(geometry.offset, 2, `${label}: shared form outline offset`);
    } else {
      assert.ok(geometry.extent >= 4, `${label}: dedicated focus indicator extent: ${JSON.stringify(geometry)}`);
    }
  }
  assert.ok(geometry.viewport && !geometry.clipped.length,
    `${label}: complete four-sided focus gutter fits clipping ancestors: ${JSON.stringify(geometry)}`);
}
