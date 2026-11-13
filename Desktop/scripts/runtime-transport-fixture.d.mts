export function installRuntimeFixturePreload(
  electron: { app: { isPackaged: boolean } },
  options: { preload: string; admin?: boolean },
): void;
