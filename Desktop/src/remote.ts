export type RemoteStatus = 'idle' | 'pairing' | 'connecting' | 'connected' | 'degraded' | 'error';
export interface RemoteSession { runtimeId?: string; sessionId: string; name: string; workspace: string }
export const remoteWorkspaceLimit = 20;
export const remoteCommands = [
  { command: '/help', zh: '指令帮助', en: 'Command help' },
  { command: '/sessions [page]', zh: '列出授权范围内的会话', en: 'List authorized sessions' },
  { command: '/session <s1>', zh: '切换后续消息的目标会话', en: 'Select a session for future messages' },
  { command: '/new [p1]', zh: '在授权项目中新建会话', en: 'Create a session in an authorized project' },
  { command: '/projects', zh: '查看已授权项目', en: 'List authorized projects' },
  { command: '/current', zh: '查看当前目标会话', en: 'Show the current session' },
  { command: '/status [s1]', zh: '查看会话运行状态与模型', en: 'Show session status and model' },
  { command: '/stop [s1]', zh: '停止指定会话的当前任务', en: 'Stop the current task in a session' },
  { command: '/disconnect', zh: '断开飞书，不停止本机任务', en: 'Disconnect without stopping local tasks' },
] as const;
export interface RemoteSnapshot {
  revision: number;
  status: RemoteStatus;
  stage?: 'authorization' | 'identity' | 'transport' | 'delivery' | 'runtime';
  authorization?: { expiresAt: number };
  botName?: string;
  binding?: RemoteSession;
  authorized?: { workspaces: string[] };
  bindingCode?: { code: string; expiresAt: number };
  candidate?: { id: string };
  approvalReady: boolean;
  saved?: boolean;
  storageError?: boolean;
  sessions: RemoteSession[];
}
export type RemoteAction = { type: 'connect' | 'disconnect' | 'openAuthorization' | 'openCallbacks' | 'checkCallbacks' | 'armBinding' | 'unbind' | 'stop' }
  | { type: 'select'; sessionId: string }
  | { type: 'bind'; candidateId: string; runtimeId?: string; sessionId: string; workspaces?: string[] };
export interface RemoteBridge {
  remoteState(): Promise<RemoteSnapshot>;
  remoteAction(action: RemoteAction): Promise<RemoteSnapshot>;
}
