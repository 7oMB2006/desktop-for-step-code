import { useEffect, useRef, useState } from 'react';

export function StellarEmblem({ motion, paused = false }: { motion: boolean; paused?: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const motionRef = useRef(motion);
  motionRef.current = motion;
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const surface = canvas.current!;
    const reduced = matchMedia('(prefers-reduced-motion: reduce)');
    let scene: import('./stellar/emblem').StellarEmblemRenderer | undefined;
    let disposed = false, lost = false, raf = 0, last = 0, needsResize = false;
    const stop = () => { cancelAnimationFrame(raf); raf = 0; last = 0; };
    const draw = (now: number) => {
      raf = 0;
      if (disposed || lost || !scene || document.hidden || pausedRef.current) return;
      const animate = motionRef.current && !reduced.matches;
      if (!last || now - last >= 1000 / 24 - 1) {
        scene.draw(last ? Math.min(.06, (now - last) / 1000) : 0, animate);
        last = now;
        setReady(true);
      }
      if (animate) raf = requestAnimationFrame(draw);
    };
    const resume = () => {
      stop();
      if (disposed || lost || !scene || document.hidden || pausedRef.current) return;
      if (needsResize) { scene.resize(surface.clientWidth); needsResize = false; }
      raf = requestAnimationFrame(draw);
    };
    const resize = new ResizeObserver(() => { needsResize = true; resume(); });
    const onLost = (event: Event) => { event.preventDefault(); lost = true; stop(); setReady(false); };
    const onRestored = () => { lost = false; needsResize = true; resume(); };
    surface.addEventListener('webglcontextlost', onLost);
    surface.addEventListener('webglcontextrestored', onRestored);
    surface.addEventListener('theme-motion', resume);
    document.addEventListener('visibilitychange', resume);
    reduced.addEventListener('change', resume);
    const image = new Image();
    image.src = './StepCode.svg';
    void Promise.all([image.decode(), import('./stellar/emblem')]).then(([, { StellarEmblemRenderer }]) => {
      if (disposed) return;
      scene = new StellarEmblemRenderer(surface, image);
      scene.resize(surface.clientWidth);
      resize.observe(surface);
      resume();
    }).catch(() => {
      if (!disposed) { stop(); scene?.dispose(); scene = undefined; setReady(false); }
    });
    return () => {
      disposed = true; stop(); resize.disconnect();
      surface.removeEventListener('webglcontextlost', onLost);
      surface.removeEventListener('webglcontextrestored', onRestored);
      surface.removeEventListener('theme-motion', resume);
      document.removeEventListener('visibilitychange', resume);
      reduced.removeEventListener('change', resume);
      scene?.dispose();
    };
  }, []);
  useEffect(() => { canvas.current?.dispatchEvent(new Event('theme-motion')); }, [motion, paused]);
  return <span className="stellar-emblem" data-ready={ready} aria-hidden="true">
    <img src="./StepCode.svg" alt="" width="48" height="48"/>
    <canvas ref={canvas}/>
  </span>;
}
