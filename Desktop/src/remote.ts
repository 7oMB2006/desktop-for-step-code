export type RemoteStatus = 'idle' | 'pairing' | 'connecting' | 'connected' | 'degraded' | 'error';
export interface RemoteSession { runtimeId?: string; sessionId: string; name: string; workspace: string; workspaceName?: string }
export interface RemoteProject { workspace: string; name: string }
export interface RemoteImage { type: 'image'; mimeType: 'image/png' | 'image/jpeg' | 'image/webp'; data: string }
export const remoteWorkspaceLimit = 20;
export const remoteCommands = [
  { command: '/help', zh: '指令帮助', en: 'Command help' },
  { command: '/sessions [p1] [page]', zh: '按项目列出授权会话', en: 'List authorized sessions by project' },
  { command: '/session <s1>', zh: '切换后续消息的目标会话', en: 'Select a session for future messages' },
  { command: '/new [p1]', zh: '在授权项目中新建会话', en: 'Create a session in an authorized project' },
  { command: '/projects', zh: '查看已授权项目', en: 'List authorized projects' },
  { command: '/current', zh: '查看当前目标会话', en: 'Show the current session' },
  { command: '/status [s1]', zh: '查看会话运行状态与模型', en: 'Show session status and model' },
  { command: '/tasks', zh: '查看运行中和等待处理的会话', en: 'Running sessions and attention needed' },
  { command: '/sharing', zh: '查看正在回传的会话', en: 'List sessions forwarding replies' },
  { command: '/detach [s1]', zh: '停止会话回传，保留本机任务', en: 'Stop forwarding without stopping local work' },
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
  targetUnconfirmed?: boolean;
  imagesAllowed?: boolean;
  sharing?: RemoteSession[];
  sessions: RemoteSession[];
  projects?: RemoteProject[];
}
export type RemoteAction = { type: 'connect' | 'disconnect' | 'openAuthorization' | 'openCallbacks' | 'checkCallbacks' | 'armBinding' | 'unbind' | 'stop' }
  | { type: 'select' | 'detach'; sessionId: string }
  | { type: 'images'; allowed: boolean }
  | { type: 'bind'; candidateId: string; runtimeId?: string; sessionId: string; workspaces?: string[]; imagesAllowed?: boolean };
export interface RemoteBridge {
  remoteState(): Promise<RemoteSnapshot>;
  remoteAction(action: RemoteAction): Promise<RemoteSnapshot>;
}
