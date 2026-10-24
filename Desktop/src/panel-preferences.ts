export type TerminalDock = 'right' | 'bottom';
export type DiffLayout = 'unified' | 'split';
export type PanelPreferences = { terminalDock: TerminalDock; terminalHeight: number; diffLayout: DiffLayout };

export function normalizePanelPreferences(value: Partial<PanelPreferences>): PanelPreferences {
  return {
    terminalDock: value.terminalDock === 'bottom' ? 'bottom' : 'right',
    terminalHeight: typeof value.terminalHeight === 'number' && Number.isFinite(value.terminalHeight)
      ? Math.max(140, Math.min(600, Math.round(value.terminalHeight))) : 280,
    diffLayout: value.diffLayout === 'split' ? 'split' : 'unified',
  };
}

export function panelPreferencePatch(value: Record<string, unknown>): Partial<PanelPreferences> {
  const patch: Partial<PanelPreferences> = {};
  if (value.terminalDock !== undefined) {
    if (value.terminalDock !== 'right' && value.terminalDock !== 'bottom') throw new Error('Invalid terminal dock');
    patch.terminalDock = value.terminalDock;
  }
  if (value.diffLayout !== undefined) {
    if (value.diffLayout !== 'unified' && value.diffLayout !== 'split') throw new Error('Invalid diff layout');
    patch.diffLayout = value.diffLayout;
  }
  if (value.terminalHeight !== undefined) {
    if (typeof value.terminalHeight !== 'number' || !Number.isFinite(value.terminalHeight)
      || value.terminalHeight < 140 || value.terminalHeight > 600) throw new Error('Invalid terminal height');
    patch.terminalHeight = Math.round(value.terminalHeight);
  }
  return patch;
}

export function terminalHeightBounds(available: number, composer: number) {
  const max = Math.max(80, Math.min(600, Math.floor(available - composer - 100)));
  return { min: Math.min(140, max), max };
}
