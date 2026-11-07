import { useEffect, useLayoutEffect, useRef } from 'react';

export function StellarLettering({ text, motion, paused = false }: {
  text: string; motion: boolean; paused?: boolean;
}) {
  const root = useRef<HTMLSpanElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const current = useRef({ text, motion, paused });
  current.current = { text, motion, paused };
  const refresh = useRef<(rebuild: boolean) => void>(() => {});
  useEffect(() => {
    const host = root.current!, surface = canvas.current!;
    const reduced = matchMedia('(prefers-reduced-motion: reduce)');
    let scene: import('./stellar/lettering').StellarLetteringRenderer | undefined;
    let disposed = false, lost = false, raf = 0, last = 0, dirty = true;
    const fallback = () => { delete host.dataset.ready; };
    const stop = () => { cancelAnimationFrame(raf); raf = 0; last = 0; };
    const draw = (now: number) => {
      raf = 0;
      if (disposed || lost || !scene || document.hidden || current.current.paused) return;
      const animate = current.current.motion && !reduced.matches;
      if (!last || now - last >= 1000 / 24 - 1) {
        try {
          if (dirty) {
            scene.resize(current.current.text, host);
            dirty = false;
          }
          scene.draw(last ? Math.min(.06, (now - last) / 1000) : 0, animate);
          host.dataset.ready = 'true';
          last = now;
        } catch {
          stop(); fallback(); scene?.dispose(); scene = undefined;
          return;
        }
      }
      if (animate) raf = requestAnimationFrame(draw);
    };
    const resume = () => {
      stop();
      if (!disposed && !lost && scene && !document.hidden && !current.current.paused)
        raf = requestAnimationFrame(draw);
    };
    refresh.current = rebuild => {
      dirty ||= rebuild;
      if (rebuild) fallback();
      resume();
    };
    const resize = new ResizeObserver(() => refresh.current(true));
    const fonts = () => refresh.current(true);
    const onLost = (event: Event) => { event.preventDefault(); lost = true; stop(); fallback(); };
    const onRestored = () => { lost = false; dirty = true; resume(); };
    surface.addEventListener('webglcontextlost', onLost);
    surface.addEventListener('webglcontextrestored', onRestored);
    document.addEventListener('visibilitychange', resume);
    document.fonts.addEventListener('loadingdone', fonts);
    reduced.addEventListener('change', resume);
    void Promise.all([document.fonts.ready, import('./stellar/lettering')]).then(([, { StellarLetteringRenderer }]) => {
      if (disposed) return;
      scene = new StellarLetteringRenderer(surface);
      resize.observe(host);
      resume();
    }).catch(() => {
      if (!disposed) { stop(); scene?.dispose(); scene = undefined; fallback(); }
    });
    return () => {
      disposed = true; stop(); resize.disconnect(); refresh.current = () => {};
      surface.removeEventListener('webglcontextlost', onLost);
      surface.removeEventListener('webglcontextrestored', onRestored);
      document.removeEventListener('visibilitychange', resume);
      document.fonts.removeEventListener('loadingdone', fonts);
      reduced.removeEventListener('change', resume);
      scene?.dispose();
    };
  }, []);
  useLayoutEffect(() => { refresh.current(true); }, [text]);
  useEffect(() => { refresh.current(false); }, [motion, paused]);
  return <span className="stellar-lettering" ref={root}>
    <span className="stellar-lettering-fallback">{text}</span>
    <canvas ref={canvas} aria-hidden="true"/>
  </span>;
}
