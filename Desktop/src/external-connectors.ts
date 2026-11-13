export const externalConnectorProtocol = 'dfsc-external-v1';
export type ExternalApprovalCategory = 'command' | 'file';
export interface ExternalApprovalLease { expiresAt: number; categories: ExternalApprovalCategory[] }
export interface ExternalApprovalAudit {
  taskId: string;
  agentId: string;
  at: number;
  action: 'grant' | 'revoke' | 'allow' | 'deny' | 'escalate';
  outcome: 'prepared' | 'applied' | 'not-applied';
  reason: string;
  requestId?: string;
  callId?: string;
}
export interface ExternalApprovalState {
  tasks: { taskId: string; agentId: string; title: string; cwd: string; phase: string; pending: number;
    delegation?: ExternalApprovalLease }[];
  audit: ExternalApprovalAudit[];
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
  | { type: 'undelegate'; taskId: string };
export interface ExternalConnectorBridge {
  externalConnectorState(): Promise<ExternalConnectorState>;
  externalConnectorAction(action: ExternalConnectorAction): Promise<ExternalConnectorState>;
}
