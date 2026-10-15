export type ThemeId = 'light' | 'paper' | 'dark' | 'blue' | 'wine' | 'jade';
export type ThemePreference = 'system' | ThemeId;
export type ColorScheme = 'light' | 'dark';

export interface ThemePalette {
  id: ThemeId;
  scheme: ColorScheme;
  group: 'classic' | 'color';
  name: readonly [string, string];
  title: readonly [string, string];
  mood: readonly [string, string];
  bg: string;
  side: string;
  surface: string;
  ink: string;
  muted: string;
  border: string;
  code: string;
  accent: string;
}

// Color families reference Oh-DSH's Deep Current, Ember Dusk and Jade Circuit.
// Paper combines the supplied StepFun page's warm paper with a quieter canvas.
export const themes: readonly ThemePalette[] = [
  { id: 'light', scheme: 'light', group: 'classic', name: ['亮', 'Light'], title: ['天光初霁', 'Morning Light'], mood: ['清透晨光', 'Clear morning'],
    bg: '#f4f7fa', side: '#e4ebf2', surface: '#ffffff', ink: '#293849', muted: '#57697b', border: '#d2dce6', code: '#eaf0f5', accent: '#6388aa' },
  { id: 'paper', scheme: 'light', group: 'classic', name: ['素', 'Paper'], title: ['素笺留白', 'Quiet Paper'], mood: ['温润纸色', 'Soft paper'],
    bg: '#eeede7', side: '#e3e1d8', surface: '#faf9f5', ink: '#37372f', muted: '#65645a', border: '#d3d1c6', code: '#e6e4dc', accent: '#747365' },
  { id: 'dark', scheme: 'dark', group: 'classic', name: ['暗', 'Dark'], title: ['星河未眠', 'Sleepless Stars'], mood: ['静谧深夜', 'Quiet midnight'],
    bg: '#1f222a', side: '#191c23', surface: '#2c313d', ink: '#e3e7ef', muted: '#a4adbf', border: '#3b414e', code: '#191c24', accent: '#8699c0' },
  { id: 'blue', scheme: 'dark', group: 'color', name: ['深蓝', 'Deep Blue'], title: ['沧海夜航', 'Ocean Voyage'], mood: ['沉静海洋', 'Still ocean'],
    bg: '#102838', side: '#0c202e', surface: '#1d4055', ink: '#e1edf4', muted: '#a1bbc9', border: '#315366', code: '#0d2231', accent: '#649dbb' },
  { id: 'wine', scheme: 'dark', group: 'color', name: ['酒红', 'Burgundy'], title: ['绛夜微醺', 'Wine at Dusk'], mood: ['醇厚暮色', 'Mellow dusk'],
    bg: '#3b202d', side: '#301b25', surface: '#55313f', ink: '#f3e5e9', muted: '#c8acb7', border: '#694452', code: '#321c27', accent: '#bd879b' },
  { id: 'jade', scheme: 'dark', group: 'color', name: ['翠绿', 'Jade'], title: ['翠林听雨', 'Forest Rain'], mood: ['幽深森林', 'Deep forest'],
    bg: '#14352c', side: '#102b24', surface: '#245041', ink: '#e1efe8', muted: '#a6c4b5', border: '#3b6051', code: '#102d25', accent: '#7bb99c' },
];

export function normalizeTheme(value: unknown): ThemePreference {
  return value === 'system' || themes.some(theme => theme.id === value) ? value as ThemePreference : 'system';
}

export function normalizeAccent(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const hex = value.trim().toLowerCase();
  if (/^#[\da-f]{6}$/.test(hex)) return hex;
  if (/^#[\da-f]{3}$/.test(hex)) return `#${[...hex.slice(1)].map(char => char + char).join('')}`;
  return undefined;
}

export function themePreferencePatch(patch: { theme?: unknown; accentColor?: unknown }) {
  const result: { theme?: ThemePreference; accentColor?: string | null } = {};
  if (patch.theme !== undefined) {
    if (normalizeTheme(patch.theme) !== patch.theme) throw new Error('Invalid theme');
    result.theme = patch.theme as ThemePreference;
  }
  if (patch.accentColor !== undefined) {
    const accent = normalizeAccent(patch.accentColor);
    if (patch.accentColor !== null && !accent) throw new Error('Invalid accent color');
    result.accentColor = accent ?? null;
  }
  return result;
}

const rgb = (hex: string) => [1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16));
const luminance = (hex: string) => rgb(hex).reduce((total, channel, index) => {
  const value = channel / 255;
  return total + (value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4) * [0.2126, 0.7152, 0.0722][index];
}, 0);

export function contrastRatio(a: string, b: string) {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + .05) / (dark + .05);
}

// Keep the chosen hue as close as possible while making accent text readable on
// every application surface. Store the original color, not this derived tone.
export function readableAccent(color: string, palette: ThemePalette) {
  const backgrounds = [palette.bg, palette.side, palette.surface];
  const readable = (candidate: string) => backgrounds.every(bg => contrastRatio(candidate, bg) >= 4.5);
  if (readable(color)) return color;
  const target = palette.scheme === 'dark' ? 255 : 0;
  const channels = rgb(color);
  const mix = (amount: number) => `#${channels.map(channel => Math.round(channel + (target - channel) * amount).toString(16).padStart(2, '0')).join('')}`;
  let low = 0, high = 1;
  for (let step = 0; step < 16; step++) {
    const middle = (low + high) / 2;
    if (readable(mix(middle))) high = middle;
    else low = middle;
  }
  return mix(high);
}

export function resolveTheme(preference: unknown, systemDark: boolean, accentColor?: unknown) {
  const selected = normalizeTheme(preference);
  const id = selected === 'system' ? (systemDark ? 'dark' : 'light') : selected;
  const palette = themes.find(theme => theme.id === id)!;
  const accent = normalizeAccent(accentColor) ?? palette.accent;
  const primary = readableAccent(accent, palette);
  return {
    id, scheme: palette.scheme, accent,
    tokens: {
      '--bg': palette.bg, '--side': palette.side, '--surface': palette.surface,
      '--ink': palette.ink, '--muted': palette.muted, '--border': palette.border,
      '--code-bg': palette.code, '--primary': primary,
      '--on-primary': contrastRatio(primary, '#ffffff') >= contrastRatio(primary, '#000000') ? '#ffffff' : '#000000',
    },
  };
}

export function applyTheme(preference: unknown, systemDark: boolean, accentColor?: unknown) {
  const resolved = resolveTheme(preference, systemDark, accentColor);
  const root = document.documentElement;
  for (const [name, value] of Object.entries(resolved.tokens)) {
    for (const scheme of ['light', 'dark']) root.style.removeProperty(`--theme-${scheme}-${name.slice(2)}`);
    root.style.setProperty(`--theme-${resolved.scheme}-${name.slice(2)}`, value);
  }
  root.dataset.palette = resolved.id;
  root.dataset.theme = resolved.scheme;
  // The initial/bootstrap palette must paint directly, without a startup fade.
  if (!root.dataset.themeMotion) {
    root.dataset.themeMotion = 'pending';
    requestAnimationFrame(() => requestAnimationFrame(() => { root.dataset.themeMotion = 'ready'; }));
  }
}
