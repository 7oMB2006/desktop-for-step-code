import type { WorkflowState } from './workflow-state';
import type { SessionImportBridge } from './session-import';
import type { LaunchState } from './launch-state';
export interface Message { desktopWorkflow?: WorkflowState; desktopToolPending?: boolean }
export interface Message { desktopImported?: boolean }
export interface Content { historical?: boolean }
export interface Snapshot { workspaceIssue?: string }
export interface StatusAccount { mode: 'plan' | 'api' | 'none' | 'unknown'; region?: 'cn' | 'global'; userId?: string }
export interface Snapshot { statusAccount?: StatusAccount }
export interface Snapshot { estimate?: import('./usage-estimates').SessionEstimate; quitReview?: import('./quit-confirmation').QuitReviewState }
export interface Session { id: string; path: string; cwd: string; workspacePath?: string; name?: string; firstMessage: string; modified: string; messageCount: number; independent?: boolean }
export interface Model { id: string; provider: string; name: string; providerName?: string; reasoning?: boolean; thinkingLevels?: string[]; thinkingServiceDefault?: boolean; input?: string[]; contextWindow?: number; maxTokens?: number; declaredInput?: string[]; declaredOutput?: string[]; metadataSource?: 'upstream' | 'manual' }
export interface Preferences { preferredModel?: Pick<Model, 'provider' | 'id' | 'name'> }
export interface Content { type: string; text?: string; thinking?: string; id?: string; name?: string; arguments?: unknown; data?: string; mimeType?: string }
export type ComposerAttachment = { kind: 'image'; name: string; content: Content } | { kind: 'file'; id: string; name: string; size: number };
export interface PendingMessage { id: string; message: string; attachmentCount: number; version: number; sending?: boolean; steered?: boolean }
export interface Usage { input: number; output: number; cacheRead: number; cacheWrite: number; reasoning?: number; totalTokens?: number; cost?: { input: number; output: number; cacheRead: number; cacheWrite: number; total: number } }
export interface SessionStats { toolCalls: number; assistantMessages: number; userMessages?: number; toolResults?: number; totalMessages?: number; cost?: number; tokens: Usage & { total: number }; contextUsage?: { tokens: number | null; contextWindow: number; percent: number | null } }
export type PermissionPreset = 'ask' | 'approve-for-me' | 'full-access';
export interface ElapsedTiming { startedAt: number; endedAt?: number }
export interface MessageTiming { run: ElapsedTiming; thinking: Record<string, ElapsedTiming> }
export interface Message { role: string; content: string | Content[]; customType?: string; display?: boolean; timestamp?: number; desktopTiming?: MessageTiming; desktopSteered?: boolean; toolCallId?: string; toolName?: string; isError?: boolean; usage?: Usage; stopReason?: string; entryId?: string; provider?: string; model?: string; errorMessage?: string; summary?: string; command?: string; output?: string; excludeFromContext?: boolean; details?: { patch?: string; diff?: string; results?: unknown[]; [key: string]: unknown } }
export interface RuntimeState { isStreaming: boolean; isCompacting?: boolean; sessionId?: string; sessionName?: string; sessionFile?: string; model?: Model; thinkingLevel?: string; messageCount?: number; pendingMessageCount?: number }
export interface ModelSelection { model: Model; thinkingLevel?: string }
export interface ModelChange { id: string; userTimestamp: number; from: Pick<Model, 'id' | 'provider' | 'name'>; to: Pick<Model, 'id' | 'provider' | 'name'> }
export interface UIRequest { type: 'extension_ui_request'; id: string; runtimeId?: string; method: string; title?: string; message?: string; messageStyle?: 'preformatted'; notifyType?: 'info' | 'warning' | 'error'; options?: string[]; placeholder?: string; prefill?: string; timeout?: number; text?: string; projectTrust?: { cwd: string } }
export type RuntimeEvent = { type: string; [key: string]: any };
export interface Preferences { interfaceSettings?: import('./interface-presets').InterfacePreferences; appearance?: import('./appearance').Appearance; theme: import('./theme').ThemePreference; accentColor?: string | null; language: 'zh' | 'en'; workspaces: string[]; workspace?: string; workspaceNames?: Record<string, string>; workspaceSessionRedirects?: Record<string, string>; archivedSessionIds?: string[]; sessionSort?: 'manual' | 'updated'; sessionOrder?: string[]; pinnedWorkspaces?: string[]; collapsedWorkspaces?: string[]; fileOpeningApps?: Record<string, string>; filePreviewWidth?: 'standard' | 'wide'; updateChannel?: UpdateChannel; autoCheckUpdates?: boolean }
export interface RuntimeSummary { runtimeId: string; sessionId: string; cwd: string; name?: string; firstMessage?: string; status: 'idle' | 'running' | 'waiting' | 'failed' | 'completed' | 'interrupted' }
export interface Snapshot { preferences: Preferences; status: string; providerSettingsPending?: boolean; draftId?: string; runtimeId?: string; runtimeRevision?: number; runtimes?: RuntimeSummary[]; unreadSessionIds?: string[]; requests?: UIRequest[]; state?: RuntimeState; modelSelection?: ModelSelection; modelChanges?: ModelChange[]; permissionPreset?: PermissionPreset; launch?: LaunchState; messages: Message[]; models: Model[]; sessions: Session[]; independent?: boolean; stats?: SessionStats; pendingMessages?: PendingMessage[] }
export interface Profile { id: string; title: string; description: string; credentialSource: string }
export interface Account { loggedIn: boolean; validity: string; profile?: string; account?: string; userId?: string }
export interface McpServer { command?: string; args?: string[]; url?: string; cwd?: string; enabled?: boolean; configuredSecrets?: string[] }
export interface StepPagePreparation {
  status: 'missing' | 'preparing' | 'ready' | 'failed';
  installed: boolean; version?: string;
  error?: 'download' | 'integrity' | 'validation' | 'storage' | 'configuration';
}
export type ProviderApi = 'openai-completions' | 'openai-responses' | 'anthropic-messages';
export interface ProviderThinkingControl { source: 'upstream' | 'manual'; levels: string[]; mapping?: Record<string, string>; adaptive?: boolean; defaultLevel?: string }
export interface ProviderModel { id: string; name: string; reasoning: boolean; vision: boolean; contextWindow: number; maxTokens: number; thinkingLevels?: string[]; thinkingControl?: ProviderThinkingControl; declaredThinkingLevels?: string[]; declaredInput?: string[]; declaredOutput?: string[]; metadataSource?: 'upstream' | 'manual' }
export interface DiscoveredProviderModel { id: string; name: string; reasoning?: boolean; vision?: boolean; contextWindow?: number; maxTokens?: number; thinkingLevels?: string[]; thinkingDefaultLevel?: string; declaredInput?: string[]; declaredOutput?: string[] }
export interface CustomProvider { id: string; name: string; baseUrl: string; api: ProviderApi; enabled: boolean; keyless: boolean; models: ProviderModel[] }
export interface ProviderInfo extends CustomProvider { hasKey: boolean }
export interface ProviderDiagnostic {
  ok: boolean; outcome: 'reply' | 'authentication' | 'not-found' | 'rate-limit' | 'http-error' | 'invalid-response' | 'timeout' | 'cancelled' | 'network' | 'invalid-config';
  elapsedMs: number; status?: number; model: string; api: ProviderApi; endpoint: string;
}
export interface Settings { account: Account; profiles: Profile[]; mcp: Record<string, McpServer>; skills: { name: string; description: string; source: string }[]; providers?: ProviderInfo[] }
export interface CronJobData {
  id: string; cron: string; prompt: string; recurring: boolean; durable: boolean;
  createdAt: number; nextFireAt: number; autoExpireAt?: number;
}
export interface CronHost {
  runtimeId: string; workspace: string; name: string; trusted: boolean; busy: boolean;
  model?: string; permission?: PermissionPreset;
}
export interface CronAssociation { sessionId: string; source: 'created' | 'recovered'; at: number }
export interface CronTask extends CronJobData { key: string; workspace: string; runtimeId?: string; hostName?: string; association?: CronAssociation }
export interface CronRecoveryPreview {
  token: string; expires: number; workspace: string; sessionId: string; sessionName: string;
  jobs: { id: string; prompt: string; nextFireAt: number }[];
  model: Pick<Model, 'id' | 'provider' | 'name'>; account: string; permission: 'ask';
}
export interface CronOverview { tasks: CronTask[]; hosts: CronHost[]; issues: { workspace: string; reason: 'unavailable' | 'untrusted' }[] }
export interface CronCreateInput { runtimeId: string; cron: string; prompt: string; recurring: boolean; durable: boolean }
export interface DesktopBridge extends SessionImportBridge {
  capabilityCatalog(): Promise<import('./capabilities').CapabilityCatalog>;
  capabilityMutate(input: import('./capabilities').CapabilityMutation): Promise<import('./capabilities').CapabilityResult>;
  capabilityImportSkill(): Promise<import('./capabilities').CapabilityResult | null>;
  stepPageState(): Promise<StepPagePreparation>;
  prepareStepPage(): Promise<StepPagePreparation>;
  cronList(): Promise<CronOverview>;
  cronCreate(input: CronCreateInput): Promise<void>;
  cronDelete(runtimeId: string, jobId: string): Promise<void>;
  cronRecoveryPreview(key: string, sessionId: string): Promise<CronRecoveryPreview>;
  cronRecover(token: string): Promise<{ sessionId: string; runtimeId: string }>;
  readonly platform?: string;
  removeWorkspace(path: string): Promise<Snapshot>;
  relocateWorkspace(path: string): Promise<Snapshot | null>;
  updateState(): Promise<AppUpdateState>;
  checkUpdates(): Promise<AppUpdateState>;
  openUpdate(action: 'release' | 'download'): Promise<void>;
  downloadUpdate(): Promise<void>;
  cancelUpdateDownload(): Promise<void>;
  installUpdate(): Promise<void>;
  onUpdateEvent(callback: (state: AppUpdateState) => void): () => void;
  fileOpen(target?: FileTarget, destination?: string): Promise<FileOpenResult | null>;
  fileOpenOptions(target: FileTarget): Promise<FileOpeningOptions>;
  browserOpenLink(address: string): Promise<BrowserSnapshot>;
  artifactFiles(runtimeId: string, paths: string[]): Promise<ArtifactFile[]>;
  artifactAction(runtimeId: string, path: string, action: 'open' | 'reveal' | 'copy'): Promise<void>;
  linkPreview(url: string): Promise<LinkPreview>;
  summary(runtimeId: string): Promise<SessionSummary>;
  rightPanelWidthMenu(selected: 'standard' | 'wide' | 'fullscreen', position: { x: number; y: number }): Promise<'standard' | 'wide' | 'fullscreen' | undefined>;
  browserList(): Promise<BrowserSnapshot>;
  browserCreate(address?: string): Promise<BrowserSnapshot>;
  browserSelect(id: string): Promise<BrowserSnapshot>;
  browserClose(id: string): Promise<BrowserSnapshot>;
  browserAction(id: string, action: BrowserAction, address?: string): Promise<BrowserSnapshot>;
  browserLayout(bounds: BrowserBounds | null): Promise<void>;
  onBrowserEvent(callback: (event: BrowserEvent) => void): () => void;
  terminalList(runtimeId?: string): Promise<TerminalSnapshot[]>;
  terminalCreate(runtimeId: string): Promise<TerminalSnapshot>;
  terminalWrite(id: string, data: string): Promise<void>;
  terminalResize(id: string, cols: number, rows: number): Promise<void>;
  terminalAck(id: string, seq: number): Promise<void>;
  terminalClose(id: string): Promise<void>;
  terminalPasteText(): Promise<string>;
  onTerminalEvent(callback: (event: TerminalEvent) => void): () => void;
  reviewMenu(runtimeId: string | undefined, kind: 'source' | 'base', selected: string, position: { x: number; y: number }): Promise<string | undefined>;
  repositoryDiff(runtimeId: string, base?: string): Promise<RepositoryDiff>;
  repositoryFileDiff(runtimeId: string, base: string, path: string): Promise<RepositoryFileDiff>;
  turnUndo(runtimeId: string, toolIds: string[], action: 'status' | 'prepare' | 'undo', token?: string): Promise<TurnUndoState>;
  windowControl(action: 'state' | 'minimize' | 'toggleMaximize' | 'close' | 'quit'): Promise<{ maximized: boolean; fullscreen: boolean; focused: boolean }>;
  quitRespond(id: string, confirmed: boolean): Promise<void>;
  systemTheme(): Promise<{ systemDark: boolean }>;
  snapshot(): Promise<Snapshot>;
  beginSession(workspace?: string): Promise<Snapshot>;
  chooseSessionProject(): Promise<Snapshot | null>;
  createDraftSession(draftId: string): Promise<Snapshot>;
  newIndependentSession(): Promise<Snapshot>;
  openSessionFolder(): Promise<void>;
  openWorkspaceFolder(path: string): Promise<void>;
  chooseWorkspace(): Promise<Snapshot | null>;
  workspace(path: string): Promise<Snapshot>;
  command(type: string, args?: Record<string, unknown>, runtimeId?: string): Promise<any>;
  sessions(): Promise<Session[]>;
  switchSession(id: string): Promise<Snapshot>;
  navigateSession(id: string): Promise<Snapshot | null>;
  branchSession(kind: 'clone' | 'fork', entryId: string, runtimeId: string): Promise<Snapshot>;
  cloneSession(id: string): Promise<Snapshot>;
  retryMessage(entryId: string, message: string, runtimeId: string): Promise<void>;
  deleteSession(id: string): Promise<boolean>;
  deleteArchivedSessions(ids: string[]): Promise<boolean>;
  restart(): Promise<Snapshot>;
  settings(): Promise<Settings>;
  accountAllowance(refresh?: boolean): Promise<import('./account-allowance').AccountAllowance>;
  cancelAccountAllowance(): Promise<void>;
  estimateSettings(): Promise<import('./usage-estimates').EstimateSettings>;
  usageOverview(): Promise<import('./usage-overview').UsageOverview>;
  setEstimateRules(rules: import('./usage-estimates').EstimateRules, accountRef: string): Promise<import('./usage-estimates').EstimateSettings>;
  saveProvider(provider: CustomProvider, key?: string): Promise<Snapshot>;
  discoverProviderModels(provider: CustomProvider, key?: string): Promise<DiscoveredProviderModel[]>;
  testProvider(provider: CustomProvider, modelId: string, key?: string): Promise<ProviderDiagnostic>;
  cancelProviderTest(): Promise<void>;
  deleteProvider(id: string): Promise<Snapshot>;
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
export type UpdateChannel = 'stable' | 'preview';
export interface AppRelease {
  version: string; tag: string; name: string; prerelease?: boolean; publishedAt?: string;
  notes: string; url: string; installer?: { name: string; url: string; size: number; inApp?: boolean };
}
export interface UpdateTransfer {
  supported: boolean;
  status: 'idle' | 'preparing' | 'downloading' | 'cancelled' | 'ready' | 'installing' | 'error';
  version?: string; percent?: number; transferred?: number; total?: number; bytesPerSecond?: number;
  error?: 'download' | 'metadata' | 'integrity' | 'busy' | 'install';
}
export interface AppUpdateState {
  currentVersion: string; channel: UpdateChannel;
  status: 'idle' | 'checking' | 'available' | 'current' | 'no-release' | 'error';
  checkedAt?: number; release?: AppRelease; source?: 'manifest' | 'release-feed'; updateAvailable?: boolean;
  error?: 'network' | 'rate-limit' | 'invalid-response' | 'unsupported-version' | 'feed-unavailable';
  retryAt?: number;
  transfer?: UpdateTransfer;
}
export interface TurnUndoState { state: 'available' | 'unavailable' | 'conflict' | 'undone' | 'failed'; token?: string }
export interface LinkPreview { url: string; title?: string; description?: string; icon?: string }
export interface ArtifactFile { path: string; exists: boolean; canOpen: boolean; size?: number; kind: import('./turn-artifacts').ArtifactKind }
export type FileTarget = { runtimeId: string; path: string } | { grantId: string };
export interface FileDestination { id: string; label: string; icon?: string }
export interface FileOpeningOptions { choices: FileDestination[]; selected: string }
export interface FilePreviewData {
  id: string; path: string; name: string; mode: 'markdown' | 'text'; text: string; size: number; language?: string;
}
export type FileOpenResult = { destination: 'preview'; file: FilePreviewData }
  | { destination: 'browser'; browser: BrowserSnapshot } | { destination: 'external' };
export type BrowserAction = 'navigate' | 'back' | 'forward' | 'reload' | 'stop' | 'external' | 'zoomIn' | 'zoomOut' | 'zoomReset';
export interface BrowserBounds { x: number; y: number; width: number; height: number }
export interface BrowserTab { id: string; title: string; url: string; loading: boolean; canGoBack: boolean; canGoForward: boolean; zoom: number; error?: string; localFile?: string }
export interface BrowserSnapshot { revision: number; activeId?: string; tabs: BrowserTab[] }
export type BrowserEvent = { type: 'snapshot'; snapshot: BrowserSnapshot } | { type: 'address' };
export interface TerminalInfo {
  id: string; cwd: string; title: string; status: 'starting' | 'running' | 'exited' | 'failed';
  cols: number; rows: number; exitCode?: number;
}
export interface TerminalSnapshot extends TerminalInfo { chunks: { seq: number; data: string }[] }
export type TerminalEvent = { type: 'state'; terminal: TerminalInfo } | { type: 'data'; id: string; seq: number; data: string } | { type: 'closed'; id: string };
export interface RepositoryFile {
  path: string; status: 'M' | 'A' | 'D' | '?'; added: number; removed: number; binary: boolean; unavailable?: boolean;
}
export interface RepositoryDiff {
  state: 'ready' | 'not-git' | 'unborn' | 'unavailable';
  root?: string; branch?: string; bases: string[]; base?: string; revision?: string;
  files: RepositoryFile[]; added: number; removed: number; truncated: boolean;
}
export interface RepositoryFileDiff {
  path: string; added: number; removed: number;
  rows: import('./turn-changes').DiffRow[];
  reason?: 'binary' | 'too-large' | 'unsupported' | 'no-text-change' | 'changed' | 'sensitive';
}
export interface DesktopTheme {
  resolved: 'light' | 'dark';
  preference?: import('./theme').ThemePreference;
  accentColor?: string | null;
  palette?: string;
  tokens?: Record<string, string>;
  systemDark: boolean;
  firstFrame: () => { theme?: string; palette?: string; background?: string; primary?: string; readyState: string };
}
export interface SummaryTask {
  id: string; subject: string; description: string; status: 'pending' | 'in_progress' | 'completed' | 'failed';
  createdAt?: number; updatedAt?: number;
}
export interface SummaryPlan { id: string; title: string; tasks: SummaryTask[] }
export interface SessionSummary {
  sessionId: string; plan?: { id: string; title: string }; tasks: SummaryTask[];
  archivedPlans?: SummaryPlan[];
  mcp: { name: string; status: 'connecting' | 'connected' | 'failed' | 'disabled'; toolCount: number }[];
  skillCount: number;
  status?: SessionStatusDetails;
}
export interface SessionStatusDetails {
  trusted?: boolean; agents?: string[]; agentsTruncated?: boolean;
  collaboration?: 'Plan' | 'Default'; version?: string;
  versionSource?: 'override' | 'embedded' | 'fallback'; endpoint?: string;
  provider?: string; model?: string; commit?: string; node?: string;
}
declare global { interface Window { desktop?: DesktopBridge; desktopTheme?: DesktopTheme } }
