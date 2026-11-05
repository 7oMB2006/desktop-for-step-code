export type RemoteStatus = 'idle' | 'pairing' | 'connecting' | 'connected' | 'degraded' | 'error';
export interface RemoteSession { runtimeId: string; sessionId: string; name: string; workspace: string }
export interface RemoteSnapshot {
  revision: number;
  status: RemoteStatus;
  stage?: 'authorization' | 'identity' | 'transport' | 'delivery' | 'runtime';
  authorization?: { expiresAt: number };
  botName?: string;
  binding?: RemoteSession;
  bindingCode?: { code: string; expiresAt: number };
  candidate?: { id: string };
  approvalReady: boolean;
  sessions: RemoteSession[];
}
export type RemoteAction = { type: 'connect' | 'disconnect' | 'openAuthorization' | 'openCallbacks' | 'checkCallbacks' | 'armBinding' | 'unbind' | 'stop' }
  | { type: 'bind'; candidateId: string; runtimeId: string; sessionId: string };
export interface RemoteBridge {
  remoteState(): Promise<RemoteSnapshot>;
  remoteAction(action: RemoteAction): Promise<RemoteSnapshot>;
}
