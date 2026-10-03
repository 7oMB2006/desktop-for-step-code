export interface Session { id: string; path: string; cwd: string; workspacePath?: string; name?: string; firstMessage: string; modified: string; messageCount: number; independent?: boolean }
export interface Model { id: string; provider: string; name: string; reasoning?: boolean }
export interface Content { type: string; text?: string; thinking?: string; id?: string; name?: string; arguments?: unknown; data?: string; mimeType?: string }
export type ComposerAttachment = { kind: 'image'; name: string; content: Content } | { kind: 'file'; id: string; name: string; size: number };
export interface Usage { input: number; output: number; cacheRead: number; cacheWrite: number }
export interface SessionStats { toolCalls: number; assistantMessages: number; tokens: Usage & { total: number }; contextUsage?: { tokens: number | null; contextWindow: number; percent: number | null } }
export type PermissionPreset = 'ask' | 'read-only' | 'bypass' | 'autopilot';
export interface Message { role: string; content: string | Content[]; timestamp?: number; toolCallId?: string; toolName?: string; isError?: boolean; usage?: Usage; stopReason?: string; entryId?: string }
export interface RuntimeState { isStreaming: boolean; isCompacting?: boolean; sessionId?: string; sessionName?: string; sessionFile?: string; model?: Model; thinkingLevel?: string; messageCount?: number; pendingMessageCount?: number }
export interface UIRequest { type: 'extension_ui_request'; id: string; runtimeId?: string; method: string; title?: string; message?: string; messageStyle?: 'preformatted'; notifyType?: 'info' | 'warning' | 'error'; options?: string[]; placeholder?: string; prefill?: string; timeout?: number; text?: string }
export type RuntimeEvent = { type: string; [key: string]: any };
export interface Preferences { theme: 'system' | 'light' | 'dark'; language: 'zh' | 'en'; workspaces: string[]; workspace?: string; workspaceNames?: Record<string, string>; archivedSessionIds?: string[]; sessionSort?: 'manual' | 'updated'; sessionOrder?: string[]; pinnedWorkspaces?: string[] }
export interface RuntimeSummary { runtimeId: string; sessionId: string; cwd: string; name?: string; firstMessage?: string; status: 'idle' | 'running' | 'waiting' | 'failed' | 'completed' | 'interrupted' }
export interface Snapshot { preferences: Preferences; status: string; runtimeId?: string; runtimes?: RuntimeSummary[]; unreadSessionIds?: string[]; requests?: UIRequest[]; state?: RuntimeState; permissionPreset?: PermissionPreset; messages: Message[]; models: Model[]; sessions: Session[]; independent?: boolean; stats?: SessionStats }
export interface Profile { id: string; title: string; description: string; credentialSource: string }
export interface Account { loggedIn: boolean; validity: string; profile?: string; account?: string }
export interface McpServer { command?: string; args?: string[]; url?: string; cwd?: string; enabled?: boolean; configuredSecrets?: string[] }
export interface Settings { account: Account; profiles: Profile[]; mcp: Record<string, McpServer>; skills: { name: string; description: string; source: string }[] }
export interface DesktopBridge {
  windowControl(action: 'state' | 'minimize' | 'toggleMaximize' | 'close'): Promise<{ maximized: boolean }>;
  systemTheme(): Promise<{ systemDark: boolean }>;
  snapshot(): Promise<Snapshot>;
  newIndependentSession(): Promise<Snapshot>;
  openSessionFolder(): Promise<void>;
  openWorkspaceFolder(path: string): Promise<void>;
  chooseWorkspace(): Promise<Snapshot | null>;
  workspace(path: string): Promise<Snapshot>;
  command(type: string, args?: Record<string, unknown>, runtimeId?: string): Promise<any>;
  sessions(): Promise<Session[]>;
  switchSession(id: string): Promise<Snapshot>;
  branchSession(kind: 'clone' | 'fork', entryId: string, runtimeId: string): Promise<Snapshot>;
  retryMessage(entryId: string, message: string, runtimeId: string): Promise<void>;
  deleteSession(id: string): Promise<boolean>;
  restart(): Promise<Snapshot>;
  settings(): Promise<Settings>;
  login(profile: string, key?: string): Promise<void>;
  cancelLogin(): Promise<void>;
  logout(): Promise<void>;
  saveMcp(name: string, config: McpServer | null, secrets?: Record<string, string>): Promise<void>;
  preferences(patch: Partial<Preferences>): Promise<Preferences>;
  images(): Promise<Content[]>;
  chooseAttachments(): Promise<ComposerAttachment[]>;
  importFile(file: File): Promise<ComposerAttachment>;
  importClipboardImage(data: string, mimeType: string, name: string): Promise<ComposerAttachment>;
  imageAction(action: 'copy' | 'save' | 'reveal', src: string, name: string): Promise<boolean>;
  copyText(text: string): Promise<void>;
  diagnostics(): Promise<boolean>;
  onEvent(callback: (event: RuntimeEvent) => void): () => void;
}
export interface DesktopTheme {
  resolved: 'light' | 'dark';
  systemDark: boolean;
  firstFrame: () => { theme?: string; readyState: string };
}
declare global { interface Window { desktop?: DesktopBridge; desktopTheme?: DesktopTheme } }
