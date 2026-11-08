import { useEffect, useState } from 'react';
import type { DesktopBridge } from './contracts';
import { resolveThemeBackground, type ThemeImage, type ThemePack } from './theme-packs';
import { ThemeWelcome } from './ThemeWelcome';
import './workspace-background.css';

export function StaticThemeImage({ image, brightness = 90 }: { image: ThemeImage; brightness?: number }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [image.dataUrl]);
  if (failed) return null;
  return <img className="theme-workspace-image" src={image.dataUrl} alt="" draggable={false}
    style={{ filter: `brightness(${brightness / 100})` }} onError={() => setFailed(true)}/>;
}

function PackImage({ id, load, brightness }: {
  id: string; load: DesktopBridge['themeImage']; brightness?: number;
}) {
  const [loaded, setLoaded] = useState<{ id: string; image: ThemeImage }>();
  useEffect(() => {
    let disposed = false;
    setLoaded(undefined);
    void load(id).then(image => { if (!disposed) setLoaded({ id, image }); }).catch(() => {});
    return () => { disposed = true; };
  }, [id, load]);
  return loaded?.id === id ? <StaticThemeImage image={loaded.image} brightness={brightness}/> : null;
}

export function WorkspaceBackground({ pack, bridge, reading, motion, brightness, paused = false, override }: {
  pack: ThemePack; bridge: Pick<DesktopBridge, 'themeScene' | 'themePoster' | 'themeImage'>;
  reading: boolean; motion: boolean; brightness?: number; paused?: boolean;
  override?: ThemeImage;
}) {
  const resolved = resolveThemeBackground(pack, override ? 'image-v1' : undefined);
  const renderer = resolved.renderer;
  const resourceKey = `${pack.id}:${pack.revision ?? pack.version}`;
  if (renderer === 'solid-v1') return null;
  if (renderer === 'stellar-v1') return <div className="stellar-workspace-scene" data-reading={reading} aria-hidden="true">
    <ThemeWelcome key={resourceKey} id={pack.id} load={bridge.themeScene} loadPoster={bridge.themePoster} motion={motion}
      brightness={brightness} ambient={reading} paused={paused} workspace/>
  </div>;
  return <div className="theme-workspace-background" data-background-renderer="image-v1" data-reading={reading} aria-hidden="true">
    {resolved.overridden && override
      ? <StaticThemeImage image={override} brightness={brightness}/>
      : <PackImage key={resourceKey} id={pack.id} load={bridge.themeImage} brightness={brightness}/>}
  </div>;
}
