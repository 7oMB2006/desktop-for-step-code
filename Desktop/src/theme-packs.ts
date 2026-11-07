import type { ThemePalette } from './theme';

export interface ThemePack {
  id: `plugin:${string}`;
  name: string;
  version: string;
  author?: string;
  hasCover?: boolean;
  palette: ThemePalette;
  renderer: 'stellar-v1';
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
