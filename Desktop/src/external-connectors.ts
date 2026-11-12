export const externalConnectorProtocol = 'dfsc-external-v1';
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
}
export type ExternalConnectorAction = { type: 'enable' | 'disable' }
  | { type: 'pair'; displayName: string; roots: string[] }
  | { type: 'revoke'; agentId: string };
export interface ExternalConnectorBridge {
  externalConnectorState(): Promise<ExternalConnectorState>;
  externalConnectorAction(action: ExternalConnectorAction): Promise<ExternalConnectorState>;
}
