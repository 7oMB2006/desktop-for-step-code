export type BackgroundAgentStatus = 'queued' | 'running' | 'completed' | 'failed' | 'aborted' | 'skipped';
export interface BackgroundAgentStep {
  index: number;
  agent: string;
  task: string;
  status: BackgroundAgentStatus | 'unknown';
  model?: string;
  startedAt?: number;
  updatedAt?: number;
  usage: Partial<Record<'input' | 'output' | 'cacheRead' | 'cacheWrite' | 'turns', number>>;
  output: string;
  outputTruncated: boolean;
  activeTool?: string;
  error?: string;
  redacted: number;
}
export interface BackgroundAgentLane {
  id: string;
  mode: 'single' | 'parallel' | 'chain';
  status: BackgroundAgentStatus;
  settling: boolean;
  startedAt?: number;
  updatedAt?: number;
  steps: BackgroundAgentStep[];
  omittedSteps: number;
}
export interface BackgroundAgentSnapshot {
  sessionId: string;
  lanes: BackgroundAgentLane[];
}
export interface BackgroundAgentSelection {
  laneId: string;
  stepIndex: number;
}
export type BackgroundAgentClient = {
  backgroundAgents(runtimeId: string, sessionId: string): Promise<BackgroundAgentSnapshot>;
  stopBackgroundAgent(runtimeId: string, sessionId: string, laneId: string): Promise<void>;
};
