export type StartupSurface = 'transparent' | 'notice' | 'recovery';
export type StartupFailure = 'INIT_FAILED' | 'SHELL_LOAD_FAILED' | 'SHELL_RENDERER_GONE' | 'STOP_FAILED';
export type StartupCommand = 'ready' | 'continue' | 'retry' | 'close';
export type StartupRecoveryState = {
  surface: StartupSurface;
  stage: string;
  elapsed: number;
  version: string;
  platform: string;
  failure?: StartupFailure;
  busy: boolean;
};
export type StartupRecoveryBridge = {
  command: (command: StartupCommand) => void;
  subscribe: (listener: (state: StartupRecoveryState) => void) => () => void;
};
export const STARTUP_NOTICE_MS = 4000;
export const STARTUP_RECOVERY_MS = 10000;

export function startupCommandAllowed(command: unknown, state: StartupRecoveryState): command is StartupCommand {
  if (command === 'ready') return true;
  if (state.busy || state.surface !== 'recovery') return false;
  return command === 'retry' || command === 'close' || command === 'continue' && !state.failure;
}
