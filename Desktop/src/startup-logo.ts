import { STARTUP_DEFAULT_MS, STARTUP_STELLAR_MS, STARTUP_SETTLE_MS, startupFrame } from './startup-motion';
import type { StartupRecoveryBridge } from './startup-recovery-contract';

const bridge = (window as Window & { startupRecovery?: StartupRecoveryBridge }).startupRecovery;
if (bridge) {
  document.documentElement.dataset.nativeStartup = 'true';
  void import('./StartupRecovery').then(({ mountStartupRecovery }) => mountStartupRecovery(bridge));
}

const params = new URLSearchParams(location.search);
const root = document.documentElement;
const logo = document.querySelector<HTMLElement>('.logo')!;
root.dataset.startupMaterial = params.get('material') === 'pending' ? 'pending'
  : params.get('material') === 'stellar' ? 'stellar' : 'default';
root.dataset.motion = params.get('motion') === 'off' ? 'off' : 'on';
let current = '', entrance: ReturnType<typeof startStellar> | undefined;
const complete = () => { root.dataset.startupComplete = 'true'; };
const configure = () => {
  const next = root.dataset.startupMaterial ?? 'pending';
  if (next === current) { entrance?.setMotion(root.dataset.motion !== 'off'); return; }
  entrance?.dispose();
  entrance = undefined;
  root.dataset.startupComplete = 'false';
  current = next;
  if (next !== 'pending') entrance = next === 'stellar'
    ? startStellar(root.dataset.motion !== 'off') : startDefault(root.dataset.motion !== 'off');
};
window.addEventListener('startup-appearance', configure);
window.addEventListener('pagehide', () => { entrance?.dispose(); window.removeEventListener('startup-appearance', configure); });
configure();

function startDefault(motion: boolean) {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  let disposed = false, decoded = false, timer: ReturnType<typeof setTimeout> | undefined;
  const settle = () => {
    if (!disposed && decoded && (!motion || reduced.matches)) { clearTimeout(timer); complete(); }
  };
  reduced.addEventListener('change', settle);
  void logo.querySelector('img')!.decode().catch(() => {}).then(() => {
    if (disposed) return;
    decoded = true;
    timer = setTimeout(complete, motion && !reduced.matches ? STARTUP_DEFAULT_MS : 0);
  });
  return {
    dispose() { disposed = true; clearTimeout(timer); reduced.removeEventListener('change', settle); },
    setMotion(next: boolean) { motion = next; settle(); },
  };
}

function startStellar(motion: boolean) {
  // Disposed WebGL contexts cannot be reused when the material returns.
  const canvas = document.createElement('canvas');
  canvas.setAttribute('aria-hidden', 'true');
  logo.querySelector('canvas')!.replaceWith(canvas);
  const image = logo.querySelector('img')!;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  let renderer: import('./stellar/emblem').StellarEmblemRenderer | undefined;
  let frame = 0, last = 0, elapsed = 0, disposed = false;
  let hold: ReturnType<typeof setTimeout> | undefined;
  const settle = () => {
    if (root.dataset.startupComplete !== 'true' && !hold)
      hold = setTimeout(() => { hold = undefined; complete(); }, STARTUP_SETTLE_MS);
  };
  const stop = () => { cancelAnimationFrame(frame); frame = 0; last = 0; };
  const draw = (now: number) => {
    if (disposed || !renderer || document.hidden) return;
    const animate = motion && !reduced.matches;
    const cadence = elapsed < STARTUP_STELLAR_MS ? 1000 / 60 : 1000 / 24;
    if (!last || now - last >= cadence - 1) {
      const initial = !last;
      const delta = initial ? 0 : now - last;
      elapsed += delta;
      if (!animate) elapsed = STARTUP_STELLAR_MS;
      renderer.draw(Math.min(.06, delta / 1000), animate,
        animate && elapsed < STARTUP_STELLAR_MS ? startupFrame(elapsed) : undefined);
      logo.dataset.ready = 'true';
      delete logo.dataset.fallback;
      if (!animate || elapsed >= STARTUP_STELLAR_MS) settle();
      // Shader compilation belongs to preparation, not the opening beat.
      last = initial ? performance.now() : now;
    }
    frame = animate ? requestAnimationFrame(draw) : 0;
  };
  const resume = () => {
    stop();
    if (!disposed && renderer && !document.hidden) frame = requestAnimationFrame(draw);
  };
  const fallback = () => {
    if (disposed) return;
    stop(); delete logo.dataset.ready; logo.dataset.fallback = 'true'; settle();
  };
  const onLost = (event: Event) => { event.preventDefault(); fallback(); };
  const dispose = () => {
    disposed = true; stop(); clearTimeout(hold); renderer?.dispose();
    delete logo.dataset.ready; delete logo.dataset.fallback;
    document.removeEventListener('visibilitychange', resume);
    reduced.removeEventListener('change', resume);
    canvas.removeEventListener('webglcontextlost', onLost);
    canvas.removeEventListener('webglcontextrestored', resume);
  };
  void Promise.all([image.decode(), import('./stellar/emblem')]).then(([, { StellarEmblemRenderer }]) => {
    if (disposed) return;
    renderer = new StellarEmblemRenderer(canvas, image);
    // A wider transparent field contains the scattered stars at the same final scale.
    renderer.resize(88 * 256 / 104, 256);
    document.addEventListener('visibilitychange', resume);
    reduced.addEventListener('change', resume);
    canvas.addEventListener('webglcontextlost', onLost);
    canvas.addEventListener('webglcontextrestored', resume);
    resume();
  }).catch(fallback);
  return { dispose, setMotion(next: boolean) { motion = next; resume(); } };
}
