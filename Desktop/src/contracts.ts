export interface Session { id: string; path: string; cwd: string; workspacePath?: string; name?: string; firstMessage: string; modified: string; messageCount: number; independent?: boolean }
export interface Model { id: string; provider: string; name: string; reasoning?: boolean }
export interface Content { type: string; text?: string; thinking?: string; id?: string; name?: string; arguments?: unknown; data?: string; mimeType?: string }
export interface Message { role: string; content: string | Content[]; timestamp?: number; toolCallId?: string; toolName?: string; isError?: boolean }
export interface RuntimeState { isStreaming: boolean; isCompacting?: boolean; sessionId?: string; sessionName?: string; sessionFile?: string; model?: Model; thinkingLevel?: string; messageCount?: number; pendingMessageCount?: number }
export interface UIRequest { type: 'extension_ui_request'; id: string; method: string; title?: string; message?: string; options?: string[]; placeholder?: string; prefill?: string; timeout?: number; text?: string }
export type RuntimeEvent = { type: string; [key: string]: any };
export interface Preferences { theme: 'system' | 'light' | 'dark'; language: 'zh' | 'en'; workspaces: string[]; workspace?: string }
export interface Snapshot { preferences: Preferences; status: string; state?: RuntimeState; messages: Message[]; models: Model[]; sessions: Session[]; independent?: boolean }
export interface Profile { id: string; title: string; description: string; credentialSource: string }
export interface Account { loggedIn: boolean; validity: string; profile?: string; account?: string }
export interface McpServer { command?: string; args?: string[]; url?: string; cwd?: string; enabled?: boolean; configuredSecrets?: string[] }
export interface Settings { account: Account; profiles: Profile[]; mcp: Record<string, McpServer>; skills: { name: string; description: string; source: string }[] }
export interface DesktopBridge {
  windowControl(action: 'state' | 'minimize' | 'toggleMaximize' | 'close'): Promise<{ maximized: boolean }>;
  snapshot(): Promise<Snapshot>;
  newIndependentSession(): Promise<Snapshot>;
  openSessionFolder(): Promise<void>;
  chooseWorkspace(): Promise<Snapshot | null>;
  workspace(path: string): Promise<Snapshot>;
  command(type: string, args?: Record<string, unknown>): Promise<any>;
  sessions(): Promise<Session[]>;
  switchSession(id: string): Promise<Snapshot>;
  deleteSession(id: string): Promise<boolean>;
  restart(): Promise<Snapshot>;
  settings(): Promise<Settings>;
  login(profile: string, key?: string): Promise<void>;
  cancelLogin(): Promise<void>;
  logout(): Promise<void>;
  saveMcp(name: string, config: McpServer | null, secrets?: Record<string, string>): Promise<void>;
  preferences(patch: Partial<Preferences>): Promise<Preferences>;
  images(): Promise<Content[]>;
  diagnostics(): Promise<boolean>;
  onEvent(callback: (event: RuntimeEvent) => void): () => void;
}
declare global { interface Window { desktop?: DesktopBridge } }
