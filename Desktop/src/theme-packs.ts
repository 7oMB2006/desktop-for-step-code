import type { ThemePalette } from './theme';
import type { BackgroundRenderer, ThemeComposition } from '../electron/theme-composition.mjs';

export type { ThemeComposition } from '../electron/theme-composition.mjs';

export interface ThemeImage {
  dataUrl: string;
  width: number;
  height: number;
}

export interface ThemePack {
  id: `plugin:${string}`;
  name: string;
  version: string;
  revision?: string;
  author?: string;
  hasCover?: boolean;
  palette: ThemePalette;
  renderer: BackgroundRenderer;
  composition?: ThemeComposition;
}

// Older snapshots and the original preview fixtures carry the v1 renderer only.
export function themeComposition(pack: ThemePack): ThemeComposition {
  return pack.composition ?? {
    ui: pack.renderer === 'stellar-v1' ? 'stellar-v1' : 'standard-v1',
    background: { renderer: pack.renderer },
    accepts: [],
  };
}

export function hasStellarUi(pack: ThemePack | undefined): boolean {
  return Boolean(pack && themeComposition(pack).ui === 'stellar-v1');
}

export function resolveThemeBackground(pack: ThemePack, requested?: 'image-v1') {
  const composition = themeComposition(pack);
  const overridden = requested !== undefined && composition.accepts.includes(requested);
  return {
    renderer: overridden ? requested : composition.background.renderer,
    overridden,
    blocked: requested !== undefined && !overridden,
  };
}

export function themeBrightnessPatch(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 40 || value > 120)
    throw new Error('Invalid theme brightness');
  return value;
}

export interface StellarDragon {
  width: number; height: number; layoutWidth: number; layoutHeight: number;
  eye: { x: number; y: number; rx: number; ry: number };
  relic: { x: number; y: number; radius: number };
  points: number[]; palette: number[][];
}
export interface StellarScene {
  dragons: { stride: number; groups: StellarDragon[] };
  duck: { width: number; height: number; stride: number; points: number[] };
}
