export const fonts = {
  system: '"Segoe UI", "Microsoft YaHei", sans-serif',
  yahei: '"Microsoft YaHei", "Segoe UI", sans-serif',
  serif: 'Georgia, "Source Han Serif SC", "SimSun", serif',
  mono: '"Cascadia Code", Consolas, "Microsoft YaHei", monospace',
} as const;
export interface Appearance {
  uiFont: 'system' | 'yahei';
  bodyFont: 'system' | 'yahei' | 'serif';
  codeFont: 'mono' | 'consolas';
  uiSize: number;
  bodySize: number;
  codeSize: number;
  lineHeight: number;
}
export const defaultAppearance: Appearance = { uiFont: 'system', bodyFont: 'system', codeFont: 'mono', uiSize: 14, bodySize: 15, codeSize: 13, lineHeight: 1.75 };
export function normalizeAppearance(value: unknown): Appearance {
  const input = value && typeof value === 'object' ? value as Partial<Appearance> : {};
  const size = (v: unknown, fallback: number, min: number, max: number) => typeof v === 'number' && Number.isFinite(v) ? Math.max(min, Math.min(max, v)) : fallback;
  return {
    uiFont: input.uiFont === 'yahei' ? 'yahei' : 'system',
    bodyFont: input.bodyFont === 'yahei' || input.bodyFont === 'serif' ? input.bodyFont : 'system',
    codeFont: input.codeFont === 'consolas' ? 'consolas' : 'mono',
    uiSize: Math.round(size(input.uiSize, 14, 12, 18)),
    bodySize: Math.round(size(input.bodySize, 15, 12, 22)),
    codeSize: Math.round(size(input.codeSize, 13, 11, 20)),
    lineHeight: size(input.lineHeight, 1.75, 1.4, 2.1),
  };
}
export function applyAppearance(value: unknown) {
  const a = normalizeAppearance(value);
  const style = document.documentElement.style;
  for (const [key, val] of Object.entries({ 'ui-font': fonts[a.uiFont], 'body-font': fonts[a.bodyFont], 'code-font': a.codeFont === 'mono' ? fonts.mono : 'Consolas, "Microsoft YaHei", monospace', 'ui-size': `${a.uiSize}px`, 'ui-delta': `${a.uiSize - 14}px`, 'body-size': `${a.bodySize}px`, 'code-size': `${a.codeSize}px`, 'body-leading': String(a.lineHeight) })) style.setProperty(`--${key}`, val);
}
