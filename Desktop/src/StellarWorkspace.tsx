import { useLayoutEffect } from 'react';
import type { DesktopBridge, Preferences } from './contracts';
import type { ThemePack } from './theme-packs';
import { hasStellarUi, type ThemeImage } from './theme-packs';
import { WorkspaceBackground } from './WorkspaceBackground';
import type { CustomBackgroundState } from './custom-background';
import { useStellarMaterial } from './StellarMaterial';

export function StellarWorkspace({ pack, preferences, bridge, reading, paused = false, activity = 'idle', override, customBackground }: {
  pack?: ThemePack; preferences: Preferences; bridge?: DesktopBridge; reading: boolean; paused?: boolean;
  activity?: 'idle' | 'running' | 'waiting' | 'navigating';
  override?: ThemeImage;
  customBackground?: CustomBackgroundState;
}) {
  const active = hasStellarUi(pack) && Boolean(bridge);
  useStellarMaterial(active ? 'stellar' : undefined);
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
  if (!bridge) return null;
  return <WorkspaceBackground pack={pack} bridge={bridge} reading={reading} motion={preferences.themeMotion !== false}
    brightness={preferences.themeBrightness} paused={paused} override={override} customBackground={customBackground}/>;
}
