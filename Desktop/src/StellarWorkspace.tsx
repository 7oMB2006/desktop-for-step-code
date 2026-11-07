import { useLayoutEffect } from 'react';
import type { DesktopBridge, Preferences } from './contracts';
import type { ThemePack } from './theme-packs';
import { ThemeWelcome } from './ThemeWelcome';
import './stellar-workspace.css';
import './stellar-chrome.css';
import './stellar-records.css';
import './stellar-decisions.css';
import './stellar-navigation.css';
import './stellar-controls.css';
import './stellar-settings.css';

export function StellarWorkspace({ pack, preferences, bridge, reading, paused = false, activity = 'idle' }: {
  pack?: ThemePack; preferences: Preferences; bridge?: DesktopBridge; reading: boolean; paused?: boolean;
  activity?: 'idle' | 'running' | 'waiting' | 'navigating';
}) {
  const active = pack?.renderer === 'stellar-v1' && Boolean(bridge);
  useLayoutEffect(() => {
    if (!active) return;
    document.documentElement.dataset.themeMaterial = 'stellar';
    return () => { delete document.documentElement.dataset.themeMaterial; };
  }, [active]);
  useLayoutEffect(() => {
    if (!active) return;
    const root = document.documentElement;
    root.dataset.stellarActivity = activity;
    root.dataset.stellarMotion = String(preferences.themeMotion !== false && !paused);
    return () => {
      delete root.dataset.stellarActivity;
      delete root.dataset.stellarMotion;
    };
  }, [active, activity, preferences.themeMotion, paused]);
  if (!active || !pack || !bridge) return null;
  return <div className="stellar-workspace-scene" data-reading={reading} aria-hidden="true">
    <ThemeWelcome id={pack.id} load={bridge.themeScene} loadPoster={bridge.themePoster} motion={preferences.themeMotion !== false}
      brightness={preferences.themeBrightness} ambient={reading} paused={paused} workspace/>
  </div>;
}
