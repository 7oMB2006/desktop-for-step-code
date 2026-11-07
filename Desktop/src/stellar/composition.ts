export type ArtworkRect = { left: number; top: number; scale: number; artWidth: number; artHeight: number };

// Reserve the native tool rail and composer; artwork never changes UI geometry.
export function compactDragonRect(width: number, height: number, index: number,
  source: { width: number; height: number }, original: ArtworkRect, sidebar = 0): ArtworkRect {
  if (width >= 1050) return original;
  const usableWidth = Math.max(1, width - 44 - sidebar);
  const inset = Math.min(18, usableWidth * .035);
  const scale = index
    ? Math.min(height * .27, usableWidth * .60) / source.height
    : Math.min(usableWidth * .68, height * .28) / source.width;
  const artWidth = source.width * scale, artHeight = source.height * scale;
  const left = sidebar + (index ? usableWidth - inset - artWidth : inset);
  const top = index ? height - Math.min(190, height * .26) - artHeight : Math.max(56, height * .085);
  const t = Math.max(0, Math.min(1, (1050 - width) / 150));
  const blend = t * t * (3 - 2 * t);
  const mix = (a: number, b: number) => a + (b - a) * blend;
  return {
    left: mix(original.left, left), top: mix(original.top, top),
    scale: mix(original.scale, scale),
    artWidth: mix(original.artWidth, artWidth), artHeight: mix(original.artHeight, artHeight),
  };
}
