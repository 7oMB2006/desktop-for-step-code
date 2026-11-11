export type ThemeUiRenderer = 'standard-v1' | 'stellar-v1';
export type BackgroundRenderer = 'stellar-v1' | 'image-v1' | 'solid-v1';
export type BackgroundOverrideRenderer = 'image-v1';
export interface ThemeComposition {
  ui: ThemeUiRenderer;
  background: { renderer: BackgroundRenderer; source?: string };
  accepts: BackgroundOverrideRenderer[];
}
export function parseThemeComposition(value: unknown): ThemeComposition;
