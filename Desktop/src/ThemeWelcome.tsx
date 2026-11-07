import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { StellarScene } from './theme-packs';
import './theme-welcome.css';
import { defaults } from './stellar/settings';

export function ThemeWelcome({ id, motion, load, loadPoster, children, brightness = 90, preview = false, ambient = false, workspace = false, paused = false }: {
  id: string; motion: boolean; brightness?: number; preview?: boolean; ambient?: boolean; workspace?: boolean; paused?: boolean; load: (id: string) => Promise<StellarScene>; loadPoster?: (id: string) => Promise<string | undefined>; children?: ReactNode;
}) {
  const stage = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const motionRef = useRef(motion);
  motionRef.current = motion;
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  const brightnessRef = useRef(brightness);
  brightnessRef.current = brightness;
  const ambientRef = useRef(ambient);
  ambientRef.current = ambient;
  const [failed, setFailed] = useState(false);
  const [poster, setPoster] = useState<{ id: string; src: string }>();
  useEffect(() => {
    let disposed = false;
    setPoster(undefined);
    void loadPoster?.(id).then(src => {
      if (!disposed && src) setPoster({ id, src });
    }).catch(() => {});
    return () => { disposed = true; };
  }, [id, loadPoster]);
  useEffect(() => {
    let disposed = false, lost = false, raf = 0, last = 0, needsResize = false;
    let scene: import('./stellar/universe').Universe | undefined;
    const reduced = matchMedia('(prefers-reduced-motion: reduce)');
    const host = stage.current!, surface = canvas.current!;
    setFailed(false);
    delete surface.dataset.ready;
    const stop = () => { cancelAnimationFrame(raf); raf = 0; last = 0; };
    const frame = (now: number) => {
      raf = 0;
      if (disposed || lost || !scene || document.hidden || pausedRef.current) return;
      const animate = motionRef.current && !reduced.matches;
      if (!last || now - last >= 1000 / (ambientRef.current ? 20 : 30) - 1) {
        scene.draw(1, last ? Math.min(.06, (now - last) / 1000) : 0, animate);
        surface.dataset.ready = 'true';
        last = now;
      }
      if (animate) raf = requestAnimationFrame(frame);
    };
    const resume = () => {
      stop();
      if (disposed || lost || !scene || document.hidden || pausedRef.current) return;
      scene.configure({ ...defaults, brightness: brightnessRef.current * (ambientRef.current ? .82 : 1),
        speed: ambientRef.current ? 12 : defaults.speed, parallax: ambientRef.current ? 8 : defaults.parallax });
      // Resizing rebuilds the particles; defer it while the workspace is covered.
      if (needsResize) { scene.resize(); needsResize = false; }
      raf = requestAnimationFrame(frame);
    };
    const resize = new ResizeObserver(entries => {
      if (entries.some(entry => entry.target === host) || workspace && host.clientWidth < 1050) {
        needsResize = true; resume();
      }
    });
    const onLost = (event: Event) => {
      event.preventDefault(); lost = true; stop(); delete surface.dataset.ready; setFailed(true);
    };
    const onRestored = () => { lost = false; setFailed(false); needsResize = true; resume(); };
    document.addEventListener('visibilitychange', resume);
    reduced.addEventListener('change', resume);
    host.addEventListener('theme-motion', resume);
    surface.addEventListener('webglcontextlost', onLost);
    surface.addEventListener('webglcontextrestored', onRestored);
    void Promise.all([load(id), import('./stellar/universe')]).then(async ([data, { Universe }]) => {
      if (disposed) return;
      scene = new Universe(surface, host, data, () => reduced.matches || !motionRef.current || pausedRef.current,
        workspace ? document.documentElement : host, workspace);
      await scene.ready();
      if (disposed) { scene.dispose(); return; }
      resize.observe(host);
      const sidebar = workspace ? host.closest('.app')?.querySelector('.sidebar') : null;
      if (sidebar) resize.observe(sidebar);
      resume();
    }).catch(() => { if (!disposed) { stop(); scene?.dispose(); scene = undefined; setFailed(true); } });
    return () => {
      disposed = true; stop(); resize.disconnect(); scene?.dispose();
      document.removeEventListener('visibilitychange', resume);
      reduced.removeEventListener('change', resume);
      host.removeEventListener('theme-motion', resume);
      surface.removeEventListener('webglcontextlost', onLost);
      surface.removeEventListener('webglcontextrestored', onRestored);
      scene?.renderer.forceContextLoss();
    };
  }, [id, load, workspace]);
  useEffect(() => { stage.current?.dispatchEvent(new Event('theme-motion')); }, [motion, brightness, ambient, paused]);
  const Element = preview ? 'span' : 'div';
  return <Element className="theme-welcome">
    <Element className="theme-stellar-stage" ref={stage} aria-hidden="true">
      {poster?.id === id && <img className="theme-stellar-poster" src={poster.src} alt=""
        style={{ filter: `brightness(${brightness / 100 * (ambient ? .82 : 1)})` }}
        onError={() => setPoster(undefined)}/>}
      <canvas ref={canvas} hidden={failed}/>
    </Element>
    {!preview && <div className="theme-welcome-content">{children}</div>}
  </Element>;
}
