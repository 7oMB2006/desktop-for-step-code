export const STARTUP_DEFAULT_MS = 650;
export const STARTUP_STELLAR_MS = 2500;
export const STARTUP_SETTLE_MS = 350;
export const STARTUP_FINISH_TIMEOUT_MS = 3500;

const phase = (time: number, from: number, to: number) => Math.max(0, Math.min(1, (time - from) / (to - from)));
const smooth = (progress: number) => progress * progress * (3 - 2 * progress);
const inOutCubic = (progress: number) => progress < .5 ? 4 * progress ** 3 : 1 - (-2 * progress + 2) ** 3 / 2;

export function startupFrame(elapsedMs: number) {
  const resolve = phase(elapsedMs, 1930, STARTUP_STELLAR_MS);
  return {
    birth: smooth(phase(elapsedMs, 180, 780)),
    gather: inOutCubic(phase(elapsedMs, 650, 2350)),
    resolve: 1 - (1 - resolve) ** 3,
    glow: Math.sin(Math.PI * smooth(phase(elapsedMs, 1700, 2420))),
  };
}

export type StartupFrame = ReturnType<typeof startupFrame>;
