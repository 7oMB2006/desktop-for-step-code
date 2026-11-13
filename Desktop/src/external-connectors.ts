export const externalConnectorProtocol = 'dfsc-external-v1';
export type ExternalApprovalCategory = 'command' | 'file' | 'risk' | 'question';
export interface ExternalApprovalLease { expiresAt: number | null; categories: ExternalApprovalCategory[]; policyId?: string }
export interface ExternalApprovalPolicy extends ExternalApprovalLease {
  id: string; agentId: string; cwd: string; createdAt: number;
  permissionPreset: 'ask' | 'approve-for-me';
}
export interface ExternalApprovalAudit {
  taskId: string;
  agentId: string;
  at: number;
  action: 'grant' | 'revoke' | 'allow' | 'deny' | 'escalate';
  outcome: 'prepared' | 'applied' | 'not-applied';
  reason: string;
  requestId?: string;
  callId?: string;
  scope?: 'policy';
}
export interface ExternalApprovalState {
  tasks: { taskId: string; agentId: string; title: string; cwd: string; phase: string; pending: number;
    delegation?: ExternalApprovalLease }[];
  audit: ExternalApprovalAudit[];
  policies?: ExternalApprovalPolicy[];
}
export interface ExternalConnectorState {
  enabled: boolean;
  listening: boolean;
  error?: string;
  connections: {
    agentId: string;
    displayName: string;
    roots: string[];
    configPath: string;
  }[];
  projects: { workspace: string; name: string }[];
  approvals?: ExternalApprovalState;
}
export type ExternalConnectorAction = { type: 'enable' | 'disable' }
  | { type: 'pair'; displayName: string; roots: string[] }
  | { type: 'revoke'; agentId: string }
  | { type: 'delegate'; taskId: string; minutes: number; categories: ExternalApprovalCategory[] }
  | { type: 'undelegate'; taskId: string }
  | { type: 'policy'; agentId: string; cwd: string; days: 1 | 7 | 30 | null;
      categories: ExternalApprovalCategory[]; permissionPreset: 'ask' | 'approve-for-me' }
  | { type: 'unpolicy'; agentId: string; cwd: string };
export interface ExternalConnectorBridge {
  externalConnectorState(): Promise<ExternalConnectorState>;
  externalConnectorAction(action: ExternalConnectorAction): Promise<ExternalConnectorState>;
}
