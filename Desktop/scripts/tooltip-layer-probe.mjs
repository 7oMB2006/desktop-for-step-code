import assert from 'node:assert/strict';
import { settleLayout } from './settle-layout.mjs';

export async function verifyTooltipLayer(page, surface) {
  const tooltip = page.locator('.app-tooltip');
  await tooltip.waitFor();
  await settleLayout(tooltip);
  assert.equal(await tooltip.evaluate(element => element.matches(':popover-open')), true);
  assert.equal(await tooltip.evaluate(element => getComputedStyle(element).pointerEvents), 'none');
  const box = await tooltip.boundingBox(), owner = await surface.boundingBox();
  const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
  assert.ok(box.x >= 8 && box.y >= 8 && box.x + box.width <= viewport.width - 7
    && box.y + box.height <= viewport.height - 7, `Tooltip stays within the viewport: ${JSON.stringify({ box, viewport })}`);
  const left = Math.max(box.x, owner.x) + 2, top = Math.max(box.y, owner.y) + 2;
  const right = Math.min(box.x + box.width, owner.x + owner.width) - 2;
  const bottom = Math.min(box.y + box.height, owner.y + owner.height) - 2;
  assert.ok(right - left > 24 && bottom - top > 12, 'The paint probe overlaps the native popover');
  const clip = { x: left, y: top, width: right - left, height: bottom - top };
  const shown = await page.screenshot({ clip });
  let hidden;
  try {
    await tooltip.evaluate(element => { element.style.visibility = 'hidden'; });
    hidden = await page.screenshot({ clip });
  } finally {
    await tooltip.evaluate(element => { element.style.removeProperty('visibility'); });
  }
  const changed = await page.evaluate(async images => {
    const decode = async png => {
      const image = new Image();
      image.src = `data:image/png;base64,${png}`;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.width; canvas.height = image.height;
      const context = canvas.getContext('2d');
      context.drawImage(image, 0, 0);
      return context.getImageData(0, 0, canvas.width, canvas.height).data;
    };
    const [shown, hidden] = await Promise.all(images.map(decode));
    let changed = 0;
    for (let index = 0; index < shown.length; index += 4)
      if ([0, 1, 2].some(channel => Math.abs(shown[index + channel] - hidden[index + channel]) > 12)) changed++;
    return changed / (shown.length / 4);
  }, [shown.toString('base64'), hidden.toString('base64')]);
  assert.ok(changed > .15, `Tooltip actually paints above the popover (${changed})`);
}
