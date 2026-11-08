import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { DesktopBridge } from './contracts';
import type { BackgroundOptions, CustomBackgroundState } from './custom-background';
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

export function hasEnabledCustomBackground(state?: CustomBackgroundState) {
  return Boolean(state?.available && !state.issue && state.options.enabled && state.image);
}

function AdjustedImage({ image, options, motion, paused, onError }: {
  image: ThemeImage; options: BackgroundOptions; motion: boolean; paused: boolean; onError(): void;
}) {
  const plane = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = plane.current;
    if (!element) return;
    const reduced = matchMedia('(prefers-reduced-motion: reduce)');
    let frame = 0, x = 0, y = 0, targetX = 0, targetY = 0;
    const allowed = () => motion && !paused && !reduced.matches && !document.hidden && options.parallax > 0;
    const write = () => {
      element.style.setProperty('--background-x', `${x}px`);
      element.style.setProperty('--background-y', `${y}px`);
    };
    const stop = () => {
      cancelAnimationFrame(frame); frame = 0;
      x = y = targetX = targetY = 0; write();
    };
    const tick = () => {
      frame = 0;
      if (!allowed()) { stop(); return; }
      x += (targetX - x) * .18; y += (targetY - y) * .18;
      if (Math.abs(targetX - x) < .05 && Math.abs(targetY - y) < .05) {
        x = targetX; y = targetY; write(); return;
      }
      write(); frame = requestAnimationFrame(tick);
    };
    const move = (event: PointerEvent) => {
      if (!allowed() || event.pointerType === 'touch') return;
      targetX = (1 - 2 * Math.max(0, Math.min(1, event.clientX / innerWidth))) * options.parallax;
      targetY = (1 - 2 * Math.max(0, Math.min(1, event.clientY / innerHeight))) * options.parallax;
      if (!frame) frame = requestAnimationFrame(tick);
    };
    const change = () => { if (!allowed()) stop(); };
    window.addEventListener('pointermove', move, { passive: true });
    window.addEventListener('blur', stop);
    document.addEventListener('visibilitychange', change);
    reduced.addEventListener('change', change);
    return () => {
      stop();
      window.removeEventListener('pointermove', move);
      window.removeEventListener('blur', stop);
      document.removeEventListener('visibilitychange', change);
      reduced.removeEventListener('change', change);
    };
  }, [motion, paused, options.parallax]);
  const padding = options.blur * 3 + options.parallax;
  return <div ref={plane} className="custom-background-plane" style={{
    inset: -padding, transform: `translate3d(var(--background-x, 0px), var(--background-y, 0px), 0) scale(${options.zoom / 100})`,
    transformOrigin: `${options.positionX}% ${options.positionY}%`,
  }}>
    <img className="theme-workspace-image" src={image.dataUrl} alt="" draggable={false} onError={onError}
      style={{ objectFit: options.fit, objectPosition: `${options.positionX}% ${options.positionY}%`,
        filter: `brightness(${options.brightness / 100}) blur(${options.blur}px)` }}/>
  </div>;
}

export function WorkspaceBackground({ pack, bridge, reading, motion, brightness, paused = false, override, customBackground }: {
  pack?: ThemePack; bridge: Pick<DesktopBridge, 'themeScene' | 'themePoster' | 'themeImage'> & Partial<Pick<DesktopBridge, 'customBackgroundImage'>>;
  reading: boolean; motion: boolean; brightness?: number; paused?: boolean;
  override?: ThemeImage; customBackground?: CustomBackgroundState;
}) {
  const load = bridge.customBackgroundImage;
  const eligible = hasEnabledCustomBackground(customBackground) && Boolean(load) && resolveThemeBackground(pack, 'image-v1').overridden;
  const revision = eligible ? customBackground?.image?.revision : undefined;
  const [personal, setPersonal] = useState<{ revision: string; load: typeof load; image?: ThemeImage }>();
  useEffect(() => {
    let disposed = false, decoder: HTMLImageElement | undefined;
    setPersonal(undefined);
    if (revision && load) void load(revision).then(image => {
      if (disposed) return;
      decoder = new Image();
      decoder.onload = () => { if (!disposed) setPersonal({ revision, load, image }); };
      decoder.onerror = () => { if (!disposed) setPersonal({ revision, load }); };
      decoder.src = image.dataUrl;
    }).catch(() => { if (!disposed) setPersonal({ revision, load }); });
    return () => {
      disposed = true;
      if (decoder) { decoder.onload = null; decoder.onerror = null; decoder.removeAttribute('src'); }
    };
  }, [revision, load]);
  const personalImage = personal && personal.revision === revision && personal.load === load ? personal.image : undefined;
  const resolved = resolveThemeBackground(pack, override || personalImage ? 'image-v1' : undefined);
  const renderer = resolved.renderer;
  const background = pack || override || personalImage ? renderer : undefined;
  useLayoutEffect(() => {
    if (!background) return;
    document.documentElement.dataset.themeBackground = background;
    return () => { delete document.documentElement.dataset.themeBackground; };
  }, [background]);
  const resourceKey = pack ? `${pack.id}:${pack.revision ?? pack.version}` : 'builtin';
  if (renderer === 'solid-v1') return null;
  if (renderer === 'stellar-v1' && pack) return <div className="stellar-workspace-scene" data-reading={reading} aria-hidden="true">
    <ThemeWelcome key={resourceKey} id={pack.id} load={bridge.themeScene} loadPoster={bridge.themePoster} motion={motion}
      brightness={brightness} ambient={reading} paused={paused} workspace/>
  </div>;
  return <div className="theme-workspace-background" data-background-renderer="image-v1" data-reading={reading} aria-hidden="true">
    {resolved.overridden && personalImage && customBackground
      ? <AdjustedImage image={personalImage} options={customBackground.options} motion={motion} paused={paused}
        onError={() => setPersonal(revision ? { revision, load } : undefined)}/>
      : resolved.overridden && override
      ? <StaticThemeImage image={override} brightness={brightness}/>
      : pack ? <PackImage key={resourceKey} id={pack.id} load={bridge.themeImage} brightness={brightness}/> : null}
  </div>;
}
