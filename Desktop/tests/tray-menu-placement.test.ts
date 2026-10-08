import test from 'node:test';
import assert from 'node:assert/strict';
import { trayMenuPlacement } from '../electron/tray-menu-placement';

test('tray menus remain in the work area on every taskbar edge and negative-origin display', () => {
  for (const area of [{ x: 0, y: 0, width: 1920, height: 1040 },
    { x: -1280, y: -100, width: 1280, height: 720 }, { x: 0, y: 0, width: 240, height: 100 }]) {
    for (const anchor of [
      { x: area.x + area.width - 24, y: area.y + area.height, width: 24, height: 40 },
      { x: area.x, y: area.y - 40, width: 24, height: 40 },
      { x: area.x - 40, y: area.y + 50, width: 40, height: 24 },
      { x: area.x + area.width, y: area.y + area.height - 24, width: 40, height: 24 },
    ]) {
      const { bounds } = trayMenuPlacement(anchor, area);
      assert.ok(bounds.x >= area.x && bounds.y >= area.y);
      assert.ok(bounds.x + bounds.width <= area.x + area.width);
      assert.ok(bounds.y + bounds.height <= area.y + area.height);
    }
  }
  assert.equal(trayMenuPlacement({ x: 1800, y: 1040, width: 24, height: 40 },
    { x: 0, y: 0, width: 1920, height: 1040 }).origin, 'bottom right');
});
