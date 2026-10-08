import type { Rectangle } from 'electron';

export function trayMenuPlacement(anchor: Rectangle, area: Rectangle, size = { width: 280, height: 112 }) {
  const width = Math.min(size.width, area.width);
  const height = Math.min(size.height, area.height);
  const above = anchor.y + anchor.height / 2 > area.y + area.height / 2;
  return {
    bounds: {
      x: Math.round(Math.max(area.x, Math.min(anchor.x + anchor.width - width, area.x + area.width - width))),
      y: Math.round(Math.max(area.y, Math.min(above ? anchor.y - height : anchor.y + anchor.height, area.y + area.height - height))),
      width, height,
    },
    origin: above ? 'bottom right' as const : 'top right' as const,
  };
}
