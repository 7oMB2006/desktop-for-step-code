import { useEffect, useRef } from 'react';
import { StellarBrandRenderer } from './stellar/brand';

export function StellarBrand({ motion, paused }: { motion: boolean; paused: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const options = useRef({ motion, paused });
  options.current = { motion, paused };
  const refresh = useRef(() => {});
  useEffect(() => {
    const surface = canvas.current!, host = surface.parentElement!;
    const mark = host.querySelector<HTMLImageElement>(':scope > img')!;
    const wordmark = host.querySelector<HTMLImageElement>('.wordmark-dark')!;
    const reduced = matchMedia('(prefers-reduced-motion: reduce)');
    let renderer: StellarBrandRenderer | undefined;
    let disposed = false, lost = false, raf = 0, last = 0, dirty = true, hovered = false, focused = false;
    const fallback = () => { delete host.dataset.stellarBrand; };
    const stop = () => { cancelAnimationFrame(raf); raf = 0; last = 0; };
    const frame = (now: number) => {
      raf = 0;
      if (disposed || lost || !renderer || document.hidden || options.current.paused) return;
      const animate = options.current.motion && !reduced.matches;
      if (!last || now - last >= 1000 / 20 - 1) {
        try {
          if (dirty) { renderer.resize(host, mark, wordmark); dirty = false; }
          renderer.draw(last ? Math.min(.08, (now - last) / 1000) : 0, animate, hovered || focused);
          host.dataset.stellarBrand = 'ready'; last = now;
        } catch {
          stop(); fallback(); renderer.dispose(); renderer = undefined;
          return;
        }
      }
      if (animate) raf = requestAnimationFrame(frame);
    };
    const resume = () => {
      stop();
      if (!disposed && !lost && renderer && !document.hidden && !options.current.paused)
        raf = requestAnimationFrame(frame);
    };
    refresh.current = resume;
    const resize = new ResizeObserver(() => { dirty = true; resume(); });
    const enter = () => { hovered = true; resume(); };
    const leave = () => { hovered = false; resume(); };
    const focus = () => { focused = true; resume(); };
    const blur = () => { focused = false; resume(); };
    const onLost = (event: Event) => { event.preventDefault(); lost = true; stop(); fallback(); };
    const onRestored = () => { lost = false; dirty = true; resume(); };
    host.addEventListener('pointerenter', enter);
    host.addEventListener('pointerleave', leave);
    host.addEventListener('focus', focus);
    host.addEventListener('blur', blur);
    surface.addEventListener('contextlost', onLost);
    surface.addEventListener('contextrestored', onRestored);
    document.addEventListener('visibilitychange', resume);
    reduced.addEventListener('change', resume);
    void Promise.all([mark.decode(), wordmark.decode()]).then(() => {
      if (disposed) return;
      renderer = new StellarBrandRenderer(surface);
      resize.observe(host); resize.observe(wordmark);
      resume();
    }).catch(() => {
      if (!disposed) { stop(); renderer?.dispose(); renderer = undefined; fallback(); }
    });
    return () => {
      disposed = true; stop(); fallback(); resize.disconnect(); refresh.current = () => {};
      host.removeEventListener('pointerenter', enter);
      host.removeEventListener('pointerleave', leave);
      host.removeEventListener('focus', focus);
      host.removeEventListener('blur', blur);
      surface.removeEventListener('contextlost', onLost);
      surface.removeEventListener('contextrestored', onRestored);
      document.removeEventListener('visibilitychange', resume);
      reduced.removeEventListener('change', resume);
      renderer?.dispose();
    };
  }, []);
  useEffect(() => { refresh.current(); }, [motion, paused]);
  return <canvas className="stellar-sidebar-brand" ref={canvas} aria-hidden="true"/>;
}
