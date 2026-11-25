import { hasStellarUi, type ThemePack } from './theme-packs';

export type ThemeMaterial = 'stellar';

export function resolveThemeMaterial(packs: readonly ThemePack[], preference: unknown): ThemeMaterial | undefined {
  return packs.some(pack => pack.id === preference && hasStellarUi(pack)) ? 'stellar' : undefined;
}

export function applyThemeMaterial(material?: ThemeMaterial) {
  if (material === 'stellar') document.documentElement.dataset.themeMaterial = material;
  else delete document.documentElement.dataset.themeMaterial;
}
