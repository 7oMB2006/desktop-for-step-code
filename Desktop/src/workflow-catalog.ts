import type { WorkflowState } from './workflow-state';

export interface SavedWorkflow {
  id: string;
  name: string;
  scope: 'project' | 'desktop';
}

export interface WorkflowRunRecord {
  runId: string;
  name?: string;
  status: WorkflowState['status'];
  recordedStatus?: 'running' | 'stopping';
  modifiedAt?: number;
  startedAt?: number;
  completedAgents?: number;
  totalAgents?: number;
}

export interface WorkflowCatalog {
  saved: SavedWorkflow[];
  runs: WorkflowRunRecord[];
  issues: { section: 'project' | 'desktop' | 'runs'; reason: 'unavailable' | 'invalid' | 'unsupported' | 'limited' }[];
}

export const workflowStatusLabels: Record<WorkflowState['status'], [string, string]> = {
  running: ['运行中', 'Running'], stopping: ['停止中', 'Stopping'],
  completed: ['已完成', 'Completed'], partial_failed: ['部分失败', 'Partially failed'],
  failed: ['失败', 'Failed'], aborted: ['已停止', 'Stopped'],
  budget_exceeded: ['预算耗尽', 'Budget reached'], unknown: ['待确认', 'Unconfirmed'],
};
