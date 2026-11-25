import { STARTUP_FINISH_TIMEOUT_MS } from '../../src/startup-motion';

// Fixture timing only. These values do not control native application startup.
export const startupScenarios = {
  normal: { label: '正常启动', readyAt: 900 },
  slow: { label: '慢启动', readyAt: 8000 },
  timeout: { label: '初始化挂起', readyAt: Infinity },
  failure: { label: '初始化失败', readyAt: Infinity },
  animation: { label: '动画失效', readyAt: 4500 },
} as const;
export type StartupScenario = keyof typeof startupScenarios;
export type ScenarioPhase = 'opening' | 'waiting' | 'delayed' | 'timeout' | 'failed' | 'handoff';
export type ScenarioSurface = 'transparent' | 'notice' | 'recovery';
export const SLOW_NOTICE_MS = 4000;
export const SCENARIO_TIMEOUT_MS = 10000;
export const SCENARIO_FAILURE_MS = 4200;

export function scenarioPhase(scenario: StartupScenario, elapsed: number, entranceComplete: boolean,
  continuedAt = 0): ScenarioPhase {
  if (scenario === 'failure' && elapsed >= SCENARIO_FAILURE_MS) return 'failed';
  if (scenario === 'timeout' && elapsed - continuedAt >= SCENARIO_TIMEOUT_MS) return 'timeout';
  if (elapsed >= startupScenarios[scenario].readyAt
    && (entranceComplete || elapsed >= STARTUP_FINISH_TIMEOUT_MS)) return 'handoff';
  if (elapsed - continuedAt >= SLOW_NOTICE_MS) return 'delayed';
  if (!entranceComplete && elapsed < STARTUP_FINISH_TIMEOUT_MS) return 'opening';
  return 'waiting';
}

export function previewScenario(value: string | null): StartupScenario {
  return value && Object.hasOwn(startupScenarios, value) ? value as StartupScenario : 'normal';
}

export function scenarioSurface(phase: ScenarioPhase, elapsed: number, continuedAt: number,
  shellFailed: boolean): ScenarioSurface {
  if (shellFailed || phase === 'failed' || phase === 'timeout') return 'recovery';
  if (phase === 'delayed' || continuedAt > 0 || phase === 'handoff' && elapsed >= SLOW_NOTICE_MS) return 'notice';
  return 'transparent';
}
