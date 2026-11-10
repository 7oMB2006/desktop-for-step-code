import { normalizedWorkspaceKey } from '../src/workspace-key';
import { statusAccount } from './status-account';
import { statusBuild } from './session-status';
import { app, BrowserWindow, dialog, ipcMain, shell, session, net, clipboard, ClipboardItem, nativeImage, nativeTheme, Menu, Notification } from 'electron';
import { join, resolve, extname, basename } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { mkdir, readFile, writeFile, rename, realpath, stat } from 'node:fs/promises';
import { freemem, homedir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { RpcProcess, isolatedEnvironment } from './runtime';
import { SessionImports, importedProjectDirectory } from './session-import';
import { SessionRuntimes, firstUserText, type SessionRuntime } from './session-runtimes';
import { GlobalInstructionsStore } from './global-instructions';
import { inspectProjectInstructions, projectInstructionsMessage } from './project-instructions';
import { isProjectInstructionsCommand, projectInstructionsInput } from '../src/project-instructions';
import { hasBackgroundWork } from './background-work';
import { BtwRequests } from './btw';
import { questionnaire, serializeAnswers } from '../src/questionnaire';
import { LaunchControls } from './launch-controls';
import { draftLaunchChanges, emptyLaunch, type LaunchState } from '../src/launch-state';
import { reserveReview, reviewPayload } from './completion-review';
import { isChildSession } from './session-visibility';
import { SessionNavigation } from './session-navigation';
import { ComposerStore, parseComposerOwner } from './composer-store';
import { MiniChatWindow } from './mini-chat-window';
import { PluginWindows } from './plugin-windows';
import { pluginWindowMethodAllowed } from './plugin-window-policy';
import { parseWindowPresentation } from './window-presentation';
import { composerKey, type ComposerOwner, type WindowPresentation } from '../src/window-conversation';
import { importedHistoryMessages } from './imported-history';
import { messagesWithEntryIds } from './session-branching';
import { SessionCollaboration } from './session-collaboration';
import { BvrBridge } from './bvr-bridge';
import { BvrSettings } from './bvr-settings';
import { PluginHostLauncher } from './plugin-host-launcher';
import { StepPluginHostProvider } from './plugin-host-step';
import { SpeechService, SPEECH_FIELD, speechSettings, saveSpeech, acknowledgeSpeech } from './speech';
import { isProjectTrustInput, trustProject } from './project-trust';
import { CronManagement, cronJobs } from './cron-management';
import { hasScheduledCron } from './cron-state';
import { CronBindings } from './cron-bindings';
import { CronRecovery, assertRecoveryJobs, assertRecoveryQueues, resumeCronHost } from './cron-recovery';
import { CronAutoRecovery } from './cron-auto-recovery';
import { CronHistory } from './cron-history';
import { PendingMessages, promptNeedsQueue } from './pending-messages';
import { normalizeAppearance } from '../src/appearance';
import { normalizePanelPreferences, panelPreferencePatch } from '../src/panel-preferences';
import { normalizeInterfaceSettings, validateInterfaceSettings } from '../src/interface-presets';
import { normalizeAccent, normalizeTheme, resolveTheme, themePreferencePatch, registerPluginThemes } from '../src/theme';
import { ThemePacks } from './theme-packs';
import { themeBrightnessPatch } from '../src/theme-packs';
import { ConversationTiming } from './conversation-timing';
import { ModelSelections, modelThinkingLevels } from './model-selection';
import { modelPreference, preferredModel, restoreSelectedModel, savedSessionModel, unavailableModel } from './model-preference';
import { changeFavoriteModel, normalizeFavoriteModels } from '../src/model-favorites';
import { AuthVault } from './auth-vault';
import { RemoteStore } from './remote-store';
import { AccountAllowanceService } from './account-allowance';
import { StepPagePreparer } from './steppage-prepare';
import { CapabilityService, assertPluginUnused } from './capability-service';
import { CapabilityGate } from './capability-gate';
import { diagnoseCapabilityMutation, type CapabilityPhaseMarker } from './capability-diagnostics';
import { capabilityFailureDetails } from './capability-failure.mjs';
import { UsageEstimates } from './usage-estimates';
import { providerInfos, providerModelNames, runtimeAuth, mergeRuntimeAuth, saveProviderAuth, deleteProviderAuth, projectProviders, discoverProviderModels, keylessEnvironment } from './custom-providers';
import { testProvider } from './provider-diagnostic';
let providerTestController: AbortController | undefined;
import { installCrashLog } from './crash-log';
import { permissionPresets } from './permission-status';
import { isFullAccessRisk } from '../src/full-access-risk';
import { TurnUndoStore } from './turn-undo';
import { repositoryDiff, repositoryFileDiff } from './repository-diff';
import { sessionSummary } from './session-summary';
import { submittedInputContent } from '../src/template-input';
import { clmSnapshot } from './clm';
import { BackgroundAgents } from './background-agents';
import { RemoteManager, parseRemoteAction } from './remote-manager';
import { receiveRemoteImages, sendRemoteImage } from './remote-images';
import { hydrateWorkflowHistory, WorkflowBindings } from './workflow-history';
import { readWorkflowCatalog } from './workflow-catalog';
import { workflowsFromMessages, workflowIsActive } from '../src/workflow-state';
import { TerminalSessions } from './terminal-sessions';
import { BrowserTabs } from './browser-tabs';
import { linkPreview } from './link-preview';
import { artifactFile } from './artifact-files';
import { FilePreviews, fileMode, canOpenExternally, readPreview } from './file-previews';
import { LocalPagePreview } from './local-page-preview';
import { associationRequest, fileApplications, macApplicationPath } from './file-applications';
import { AppUpdates, updatePreferences } from './app-updates';
import { UpdateInstaller, InstallerFailure } from './update-installer';
import { MacUpdateDriver, macUpdateVersion, acknowledgeMacUpdate } from './macos-update-driver';
import { NativeUpdateDriver } from './native-update-driver';
import { cleanInstalledUpdate } from './update-cache';
import { DesktopTray } from './desktop-tray';
import { DesktopNotifications } from './desktop-notifications';
import { notificationPreferences, notificationPreferencePatch } from '../src/notification-preferences';
import { QuitReview, quitReasons, needsQuitReview } from './quit-review';
import { quitConfirmation } from '../src/quit-confirmation';
import { StartupWindow } from './startup-window';
import { FirstRun } from './first-run';
import type { FileTarget, FileDestination, FileOpenResult, FileOpeningOptions } from '../src/contracts';
import type { BrowserAction } from '../src/contracts';
import { conversationEntries } from '../src/conversation-presentation';
import { turnChanges } from '../src/turn-changes';
import type { Message, Model, PermissionPreset, Preferences, Session, SessionReading, Snapshot } from '../src/contracts';
import { validateSidebarPreferences } from '../src/sidebar-order';
import { migrateWorkspaceIdentity, relocatedWorkspace, relocateWorkspace, removeWorkspace, moveSessionToWorkspace } from './workspace-management';
import { archivedDeletionTargets, deleteManagedSessionFile, managedSessionFile } from './session-deletion';
import { parseFulltextQuery, projectFulltextResult } from './session-search';
import { decodeImageUrl, imageFileName, fileReferenceMessage, imageMime, MAX_ATTACHMENTS, MAX_FILE_BYTES, MAX_IMAGE_BYTES, MAX_IMAGES } from './attachment-utils';

app.setName('Desktop for Step Code');
app.setAppUserModelId('community.stepcode.desktop');
if (process.platform === 'darwin') Menu.setApplicationMenu(Menu.buildFromTemplate([
  { role: 'appMenu' }, { role: 'editMenu' },
  { label: 'View', submenu: [{ role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' },
    { type: 'separator' }, { role: 'togglefullscreen' }] },
  { role: 'windowMenu' },
]));
// Native resolution also expands Windows 8.3 names, unlike the JS realpathSync implementation.
if (process.env.DESKTOP_TEST_USER_DATA) app.setPath('userData', realpathSync.native(resolve(process.env.DESKTOP_TEST_USER_DATA)));
const backgroundAcceptance = process.env.DESKTOP_TEST_NO_FOCUS === '1' && Boolean(process.env.DESKTOP_TEST_USER_DATA);
const crashLog = installCrashLog();
const workflowBindings = new WorkflowBindings(join(app.getPath('userData'), 'workflow-bindings'));
const cronHistory = new CronHistory(join(app.getPath('userData'), 'cron-history'));
let cronHistoryFailed = false;
const conversationTiming = new ConversationTiming(join(app.getPath('userData'), 'conversation-timing'),
  error => { void crashLog.record('conversation-timing', error); });
const modelSelections = new ModelSelections(join(app.getPath('userData'), 'model-changes'),
  worker => publishModelSelection(worker), error => { void crashLog.record('model-changes', error); },
  worker => pluginHosts.invalidate(worker));
let window: BrowserWindow;
let startupWindow: StartupWindow | undefined;
let browser: BrowserTabs | undefined;
const filePreviews = new FilePreviews(id => runtimes.require(id).cwd);
const localPages = new LocalPagePreview();
const localFileGrants = new Map<string, string>();
const fileAssociationScript = () => join(app.isPackaged ? join(process.resourcesPath, 'file-opening') : join(__dirname, 'file-opening'), process.platform === 'darwin' ? 'file-applications-macos' : 'file-associations.ps1');
let preferences: Preferences = { theme: 'system', language: 'zh', workspaces: [] };
const updateVersion = process.platform === 'darwin' && app.isPackaged ? macUpdateVersion(process.resourcesPath, app.getVersion()) : app.getVersion();
const updates = new AppUpdates(updateVersion, (url, options) => net.fetch(url, options),
  state => { installer.reconcile(state.release); publishUpdate(); }, () => Date.now(), 15_000, process.platform === 'darwin' ? 'darwin' : 'win32');
const updateRoot = join(app.getPath('userData'), 'app-updates');
let updateInstalling = false;
let updateCleanup: Promise<void> | undefined;
function maintainUpdateCache() {
  return updateCleanup ??= cleanInstalledUpdate(updateRoot, app.getVersion())
    .catch(error => { void crashLog.record('update-cache', error); });
}
const macAppTarget = () => resolve(app.getPath('exe'), '../../..');
const installer = new UpdateInstaller(updateVersion, app.isPackaged && (process.platform === 'darwin'
  || process.platform === 'win32' && existsSync(join(app.getPath('exe'), '..', 'Uninstall Desktop for Step Code.exe'))
    && existsSync(join(process.resourcesPath, 'app-update.yml'))),
  () => process.platform === 'darwin' ? new MacUpdateDriver(updateRoot, { resources: process.resourcesPath, target: macAppTarget(),
    request: (url, options) => net.fetch(url, options), quit: () => { quitting = true; app.quit(); } })
    : new NativeUpdateDriver(updateRoot), publishUpdate);
function publishUpdate() {
  if (window && !window.isDestroyed()) window.webContents.send('app-update', { ...updates.snapshot(), transfer: installer.snapshot() });
}
let status = 'disconnected';
let transition = false;
let settingsMutation = false;
let speechSaving = false;
const speech = new SpeechService((input, init) => net.fetch(input instanceof URL ? input.href : String(input), init));
const capabilityGate = new CapabilityGate();
let deletingArchived = false;
let quitting = false;
let quitPending = false;
let tray: DesktopTray | undefined;
let sessionEnding = false;
let restoreRequested = false;
function showMainWindow() {
  if (!window || window.isDestroyed()) { restoreRequested = true; return; }
  startupWindow?.destroy();
  if (window.isMinimized()) window.restore();
  window.show();
  if (!backgroundAcceptance) window.focus();
}
let startup: Promise<void> = Promise.resolve();
let startupError: string | undefined;
let sessionDraft: { id: string; workspace?: string; model?: Model; models?: Model[]; thinkingLevel?: string;
  permissionPreset?: PermissionPreset; launch?: LaunchState; modelChanged?: boolean; permissionChanged?: boolean; thinkingChanged?: boolean } | undefined = { id: randomUUID() };
type Surface = 'main' | 'mini';
const miniView: { draft?: typeof sessionDraft; runtimeId?: string; worker?: SessionRuntime } = {};
let miniChat: MiniChatWindow | undefined;
let pluginWindows: PluginWindows | undefined;
let resumeMini = false;
const presentations = { main: new Map<string, WindowPresentation>(), mini: new Map<string, WindowPresentation>() };
const presentationRevisions = { main: 0, mini: 0 };
const selectedDraft = (surface: Surface) => surface === 'mini' ? miniView.draft : sessionDraft;
const selectDraft = (surface: Surface, draft: typeof sessionDraft) => {
  if (draft && sessionDraft?.id === draft.id) sessionDraft = draft;
  if (draft && miniView.draft?.id === draft.id) miniView.draft = draft;
  if (surface === 'mini') { miniView.draft = draft; miniView.runtimeId = undefined; miniView.worker = undefined; }
  else { sessionDraft = draft; runtimes.activeId = undefined; }
};
const selectedRuntime = (surface: Surface) => surface === 'mini' ? miniView.runtimeId : runtimes.activeId;
function replaceMiniRuntime(worker: SessionRuntime) {
  const previous = miniView.worker;
  if (!previous || previous === worker || previous.state?.sessionId !== worker.state?.sessionId) return;
  miniView.worker = worker; miniView.runtimeId = worker.id;
  emit({ type: 'desktop_runtime_replaced', previousRuntimeId: previous.id, runtimeId: worker.id, sessionId: worker.state?.sessionId });
}
const selectRuntime = (surface: Surface, worker: SessionRuntime) => {
  if (surface === 'mini') {
    miniView.draft = undefined; miniView.runtimeId = worker.id; miniView.worker = worker; worker.touched = Date.now();
    if (worker.state?.sessionId) runtimes.unreadSessionIds.delete(worker.state.sessionId);
    runtimes.publish();
  } else {
    sessionDraft = undefined; runtimes.activate(worker);
    const previous = miniView.worker;
    if (previous && previous !== worker && previous.state?.sessionId === worker.state?.sessionId
      && (!runtimes.workers.has(previous.id) || previous.status === 'disconnected')) replaceMiniRuntime(worker);
  }
};
let undoBusy = false;
const undoStore = new TurnUndoStore(join(app.getPath('userData'), 'turn-undo'));
// One agent_end can cover SEVERAL response entries: the runtime drains its queued
// prompts before emitting it, so a prompt submitted while a turn is running lands in
// the same batch. Recording only the batch's last entry silently loses the undo record
// for every earlier turn in it, and status() then reports 'unavailable' forever, so the
// UI can never offer undo for those turns. Each entry in the batch is captured, and the
// in-flight work is aggregated per worker so `turnUndo` waits for the WHOLE batch.
const undoCaptures = new Map<string, Promise<void>>();
const attachedFiles = new Map<string, string>();
async function importAttachment(path: string) {
  const canonical = await realpath(path);
  const info = await stat(canonical);
  if (!info.isFile()) throw new Error('Only regular files can be attached');
  if (info.size > MAX_FILE_BYTES) throw new Error('File exceeds 50 MiB');
  const extension = extname(canonical).toLowerCase();
  if (['.png', '.jpg', '.jpeg', '.webp'].includes(extension)) {
    if (info.size > MAX_IMAGE_BYTES) throw new Error('Image exceeds 10 MiB');
    const bytes = await readFile(canonical);
    if (bytes.length > MAX_IMAGE_BYTES) throw new Error('Image exceeds 10 MiB');
    const mimeType = imageMime(bytes);
    if (!mimeType) throw new Error('Unsupported image');
    return { kind: 'image', name: basename(canonical), content: { type: 'image', mimeType, data: bytes.toString('base64') } };
  }
  if (attachedFiles.size >= 100) attachedFiles.delete(attachedFiles.keys().next().value!);
  const id = randomUUID();
  attachedFiles.set(id, canonical);
  return { kind: 'file', id, name: basename(canonical), size: info.size };
}
const runtimeRoot = app.isPackaged ? join(process.resourcesPath, 'runtime') : resolve('runtime');
const dataRoot = join(app.getPath('userData'), 'step-runtime');
const globalInstructions = new GlobalInstructionsStore(join(dataRoot, 'agent'));
const outdatedInstructions = new WeakSet<SessionRuntime>();
const independentRoot = join(app.getPath('userData'), 'workspaces', 'independent');
const pathKey = (path: string) => normalizedWorkspaceKey(resolve(path), process.platform);
async function samePath(a: string, b: string) {
  if (pathKey(a) === pathKey(b)) return true;
  try {
    const [left, right] = await Promise.all([stat(a, { bigint: true }), stat(b, { bigint: true })]);
    if (left.dev === right.dev && left.ino !== 0n && left.ino === right.ino) return true;
  } catch {}
  try { return pathKey(await realpath(a)) === pathKey(await realpath(b)); }
  catch { return false; }
}
let unavailableWorkspace: string | undefined;
async function workspaceDirectory(path: string, signal?: AbortSignal) {
  try {
    signal?.throwIfAborted();
    const canonical = await realpath(path);
    if (!(await stat(canonical)).isDirectory()) throw new Error('Not a directory');
    signal?.throwIfAborted();
    if (unavailableWorkspace && pathKey(unavailableWorkspace) === pathKey(path)) unavailableWorkspace = undefined;
    return canonical;
  } catch {
    signal?.throwIfAborted();
    unavailableWorkspace = path;
    emit({ type: 'desktop_workspace_unavailable', path });
    throw new Error(preferences.language === 'zh' ? `项目目录不可用：${path}` : `Project directory unavailable: ${path}`);
  }
}
const isIndependentPath = (path: string) => pathKey(path).startsWith(`${pathKey(independentRoot)}/`) || !preferences.workspaces.some(p => pathKey(p) === pathKey(path));
async function sessionWorkspacePath(path: string): Promise<string | undefined> {
  if (pathKey(path).startsWith(`${pathKey(independentRoot)}/`)) return undefined;
  try {
    const [canonicalPath, canonicalRoot] = await Promise.all([realpath(path), realpath(independentRoot)]);
    if (pathKey(canonicalPath).startsWith(`${pathKey(canonicalRoot)}/`)) return undefined;
  } catch {}
  const matches = await Promise.all(preferences.workspaces.map(async workspace => ({ workspace, same: await samePath(workspace, path) })));
  return matches.find(match => match.same)?.workspace;
}
const preferencesFile = join(app.getPath('userData'), 'preferences.json');
const firstRun = new FirstRun(app.getPath('userData'));
const nodePath = join(runtimeRoot, 'node', process.platform === 'win32' ? 'node.exe' : 'node');
const themePacks = new ThemePacks(join(dataRoot, 'plugins'));
async function refreshThemePacks() {
  await themePacks.refresh();
  registerPluginThemes(themePacks.packs);
  if (typeof preferences.theme === 'string' && preferences.theme.startsWith('plugin:') && normalizeTheme(preferences.theme) === 'system') {
    preferences.theme = 'original-dark';
    preferences.accentColor = null;
    await savePreferences();
  }
}
const capabilityService: CapabilityService = new CapabilityService({ root: dataRoot, runtime: runtimeRoot, node: nodePath,
  beforePluginMutation: () => pluginHosts.invalidate(),
  hostAvailable: () => runtimeManifest.patches?.includes('desktop-plugin-host-launch') === true,
  hostStatus: (descriptor, binding) => pluginHosts.status(descriptor, binding),
  guardRecovery: async id => {
    const alreadyMutating = settingsMutation;
    settingsMutation = true;
    try {
      await runtimes.assertAllIdle({ stopHost: false, resources: true });
      await assertPluginUnused(id, runtimes.workers.values());
      await runtimes.assertAllIdle({ stopHost: false, resources: true });
      return () => { settingsMutation = alreadyMutating || !capabilityService.runtimeAvailable; };
    } catch (error) { settingsMutation = alreadyMutating || !capabilityService.runtimeAvailable; throw error; }
  },
  fetchRepository: (url, options) => net.fetch(url instanceof URL ? url.href : url, { ...options, credentials: 'omit' }),
  environment: () => isolatedEnvironment(dataRoot), validateImage: (bytes, maxDimension = 4096) => {
    const image = nativeImage.createFromBuffer(bytes), size = image.getSize();
    return !image.isEmpty() && size.width <= maxDimension && size.height <= maxDimension;
  } });
const sessionImports = new SessionImports(nodePath, join(runtimeRoot, 'session-import.mjs'), dataRoot,
  () => emit({ type: 'desktop_sessions_changed' }), async sessionIds => {
    const independent = pathKey(await realpath(independentRoot).catch(() => independentRoot));
    for (const sessionId of sessionIds) {
      const directory = await importedProjectDirectory(dataRoot, sessionId);
      const canonical = await realpath(directory).catch(() => undefined);
      if (!canonical || !(await stat(canonical).catch(() => undefined))?.isDirectory()) continue;
      if (pathKey(canonical) === independent || pathKey(canonical).startsWith(`${independent}/`)) continue;
      const existing = await sessionWorkspacePath(canonical);
      if (!existing && !preferences.workspaces.some(path => pathKey(path) === pathKey(canonical)))
        preferences.workspaces = [...preferences.workspaces, canonical];
    }
    await savePreferences();
  });
const stepPage = new StepPagePreparer(dataRoot, nodePath, (url, options) => net.fetch(url, options));
const terminals = new TerminalSessions(nodePath,
  app.isPackaged ? join(process.resourcesPath, 'terminal-runtime/host.cjs') : resolve('terminal-runtime/host.cjs'),
  event => { if (window && !window.isDestroyed()) window.webContents.send('terminal-event', event); });
crashLog.setPhase('runtime staged');
const env = isolatedEnvironment(dataRoot);
const vault = new AuthVault(dataRoot);
let authData: Record<string, unknown> = {};
let appliedAuthData: Record<string, unknown> = {};
const usageEstimates = new UsageEstimates(join(app.getPath('userData'), 'usage-estimates'), () => appliedAuthData,
  error => { void crashLog.record('usage-estimates', error); });
let usageOverviewPending: Promise<import('../src/usage-overview').UsageOverview> | undefined;
const accountAllowance = new AccountAllowanceService(() => appliedAuthData,
  (input, init) => net.fetch(input instanceof URL ? input.href : input, init),
  Date.now, () => performance.now(), 12000, async signal => {
    const credential = appliedAuthData.step;
    const next = await admin.request('refresh_allowance_credential', { credential }, 11000);
    if (signal.aborted || speechSaving || settingsMutation || capabilityGate.active || !capabilityService.available
      || appliedAuthData.step !== credential || authData.step !== credential)
      throw new Error('Allowance credential changed');
    if (!next || next.type !== 'oauth' || typeof next.access !== 'string' || !next.access.trim()
      || typeof next.expires !== 'number' || next.expires <= Date.now() + 60000
      || next.profile !== (credential as Record<string, unknown>).profile
      || next.uid !== (credential as Record<string, unknown>).uid) throw new Error('Invalid refreshed credential');
    settingsMutation = true;
    try {
      await persistAuth({ ...authData, step: next });
      appliedAuthData = { ...appliedAuthData, step: next };
    } finally {
      settingsMutation = !capabilityService.runtimeAvailable;
      await pluginHosts.resumeDeferred();
    }
  });
let providerSettingsPending = false;
let providerApplyFailed = false;
let providerApplication: Promise<void> | undefined;
const authEnvironment = () => ({
  ...env,
  DESKTOP_CRON_STATE: '1',
  DESKTOP_CRON_SCOPE_DIR: undefined,
  STEPCODE_DESKTOP_AUTH_PATH: env.STEPCODE_AUTH_PATH,
  STEPCODE_DESKTOP_AUTH_DATA: JSON.stringify(runtimeAuth(appliedAuthData)),
  ...keylessEnvironment(appliedAuthData, app.isPackaged ? join(process.resourcesPath, 'runtime-adapters/keyless-fetch.cjs') : join(__dirname, 'keyless-fetch.cjs')),
});
const movedSessionEnvironment = () => ({
  STEP_PERMISSION_PRESET: 'ask',
  DESKTOP_CRON_SCOPE_DIR: join(app.getPath('userData'), 'cron-bindings'),
});
async function persistAuth(next: Record<string, unknown>) {
  speech.cancel();
  bvrBridge.invalidate();
  pluginHosts.invalidate();
  try { await vault.save(next); }
  catch (error) {
    await admin.stop();
    admin.start(nodePath, join(runtimeRoot, 'admin.mjs'), dataRoot, authEnvironment());
    throw error;
  }
  authData = next;
}
const emit = (event: unknown) => {
  if (window && !window.isDestroyed() && !window.webContents.isDestroyed()) window.webContents.send('runtime-event', event);
  if (miniChat?.window && !miniChat.window.isDestroyed() && !miniChat.window.webContents.isDestroyed()) miniChat.window.webContents.send('runtime-event', event);
  pluginWindows?.broadcast(event as { type: string; [key: string]: unknown });
};
const composers = new ComposerStore(snapshot => emit({ type: 'desktop_composer', snapshot }));
const rendererGenerations = new Map<number, number>();
function watchComposerWindow(view: BrowserWindow) {
  const contents = view.webContents, id = contents.id;
  rendererGenerations.set(id, 0);
  const reset = () => {
    if (view === window) speech.cancel();
    rendererGenerations.set(id, (rendererGenerations.get(id) ?? 0) + 1);
    composers.recover(id);
  };
  contents.on('did-start-navigation', (_event, _url, inPlace, mainFrame) => { if (mainFrame && !inPlace) reset(); });
  contents.on('render-process-gone', reset);
  contents.once('destroyed', () => { reset(); rendererGenerations.delete(id); });
}
const createdDrafts = new Map<string, string>();
const creatingDrafts = new Set<string>();
const miniMethods = new Set([
  'snapshot', 'windowControl', 'miniChatState', 'miniChatPin', 'miniChatReturn', 'miniChatMainAction',
  'windowPresentation', 'composerRead', 'composerWrite', 'composerTake', 'composerRestore',
  'beginSession', 'chooseSessionProject', 'createDraftSession', 'navigateSession', 'sessionReading',
  'command', 'projectInstructions', 'branchSession', 'retryMessage', 'preferences',
  'chooseAttachments', 'importFile', 'importClipboardImage', 'imageAction', 'copyText', 'linkPreview',
  'fileOpen', 'fileOpenOptions', 'browserOpenLink', 'artifactFiles', 'artifactAction', 'backgroundAgents',
  'updateState', 'summary', 'workflows', 'themeScene', 'themePoster',
]);
function requireComposerOwner(input: unknown): ComposerOwner {
  const owner = composers.owner(parseComposerOwner(input));
  if ('draftId' in owner) {
    if (sessionDraft?.id !== owner.draftId && miniView.draft?.id !== owner.draftId) throw new Error('Unknown session draft');
  } else if (!cachedSessions().some(session => session.id === owner.sessionId)
    && miniView.worker?.state?.sessionId !== owner.sessionId) throw new Error('Unknown conversation');
  return owner;
}
function savePresentation(surface: Surface, owner: ComposerOwner, value: WindowPresentation) {
  const key = composerKey(owner), cache = presentations[surface];
  cache.delete(key); cache.set(key, value);
  while (cache.size > 64) cache.delete(cache.keys().next().value!);
}
const quitReview = new QuitReview(state => emit({ type: 'desktop_quit_review', state }));
function publishModelSelection(worker: import('./session-runtimes').SessionRuntime) {
  emit({ type: 'desktop_model_selection', runtimeId: worker.id, sessionId: worker.state?.sessionId,
    runtimeRevision: ++worker.revision, modelSelection: modelSelections.selection(worker),
    modelChanges: modelSelections.changes(worker),
    state: worker.state ? { ...worker.state, model: worker.state.model ? providerModelNames([worker.state.model], appliedAuthData)[0] : undefined } : undefined });
}
const runtimes: SessionRuntimes = new SessionRuntimes(event => {
  notifications.handle(event);
  if (event.type === 'desktop_task_completed') event = { ...event, playSound: preferences.completionSound === true };
  const queueWorker = runtimes.workers.get(event.runtimeId);
  if (event.type === 'desktop_btw') {
    if (queueWorker) btw.event(queueWorker, event);
    return;
  }
  if (queueWorker) remote.runtimeEvent(queueWorker, event);
  const modelChanged = queueWorker && event.type === 'message_start' && event.message?.role === 'user'
    && modelSelections.delivered(queueWorker, submittedInputContent(event.message), event.message.timestamp);
  const consumed = queueWorker && event.type === 'message_start' && event.message?.role === 'user'
    && pendingMessages.delivered(queueWorker, submittedInputContent(event.message), event.message.timestamp, false);
  if (queueWorker && event.message?.role === 'user') {
    event.message = pendingMessages.decorate(queueWorker, event.message);
    queueWorker.messages = queueWorker.messages.map(message => pendingMessages.decorate(queueWorker, message));
  }
  if (event.type === 'agent_end' && !event.desktopRecoveryPending || event.desktopRecoverySettled) {
    const worker = runtimes.workers.get(event.runtimeId);
    if (worker?.state?.sessionId && !worker.failed && !worker.interrupted) {
      const sessionId = worker.state.sessionId;
      const entries = conversationEntries(worker.messages).filter(entry => entry.type === 'response');
      if (!entries.length) return;
      // Start every capture in this batch immediately, then aggregate them into one
      // promise so `turnUndo` keeps awaiting the whole batch rather than one entry.
      const batch = Promise.all(entries.map(entry => undoStore.capture(sessionId, worker.cwd, entry.items).catch(() => {})))
        .then(() => undefined);
      undoCaptures.set(worker.id, batch);
      void batch.finally(() => {
        if (undoCaptures.get(worker.id) === batch) undoCaptures.delete(worker.id);
        emit({ type: 'desktop_undo_ready', runtimeId: worker.id });
      });
    }
  }
  if (event.type === 'desktop_exit') void crashLog.record('runtime-exit', new Error('Step Code runtime exited unexpectedly'), event.details ?? {});
  emit(event);
  if (modelChanged) publishModelSelection(queueWorker!);
  // Deliver the authoritative message before publishing the newer queue revision.
  if (consumed) pendingMessages.publish(queueWorker!);
  if (queueWorker) pendingMessages.runtimeEvent(queueWorker, event);
}, undefined, {
  backgroundAvailable: () => runtimeManifest.patches?.includes('desktop-subagent-redaction') === true,
  retain: worker => worker.id === miniView.runtimeId || openingSessions.has(worker.state?.sessionId ?? '')
    || miniNavigation.pending(worker.state?.sessionId),
  event: (worker, event) => {
    try {
      cronHistory.event(worker, event);
      if (['agent_end', 'desktop_exit'].includes(event.type)) emit({ type: 'desktop_cron_changed' });
    } catch (error) {
      cronHistoryFailed = true;
      void crashLog.record('cron-history', error);
    }
    if (event.type === 'desktop_exit' && !worker.stopping) {
      if (runtimes.isBusy(worker) || hasBackgroundWork(worker) || worker.queued || worker.launch?.goal?.status === 'active')
        void cronAutomatic.block(worker.cwd).then(() => emit({ type: 'desktop_cron_changed' }))
          .catch(error => crashLog.record('cron-auto-recovery', error));
      else setTimeout(() => void tryAutomaticCron(worker.cwd), 1000).unref();
    }
    if (event.type === 'tool_execution_end' && event.toolName === 'cron_create') {
      void cronBindings.created(worker.cwd, worker.state?.sessionId, event).then(changed => {
        if (changed) emit({ type: 'desktop_cron_changed' });
      }).catch(error => { void crashLog.record('cron-association', error); });
    }
    usageEstimates.event(worker, event);
    if (['message_end', 'agent_end'].includes(event.type)) event = { ...event, desktopEstimate: usageEstimates.summary(worker) };
    workflowBindings.event(worker.state?.sessionId, event);
    return conversationTiming.event(worker, event);
  },
  messages: async (worker, messages) => {
    if (!worker.state?.sessionId) return messages;
    await modelSelections.load(worker.state.sessionId);
    await usageEstimates.load(worker.state.sessionId);
    return decorateSessionMessages(worker.state.sessionId, worker.cwd, messages);
  },
  beforePrompt: (worker, message) => modelSelections.prepare(worker, message),
  pluginsReady: worker => pluginHosts.attach(worker),
  canReuseEmpty: worker => !outdatedInstructions.has(worker),
  // Keep at most two extra idle children when Windows has ample free memory.
  // This is a retention budget, never permission to speculatively start agents.
  idleLimit: () => process.platform === 'win32' && freemem() >= 3 * 1024 ** 3 ? 4 : 2,
  initializeModel: async (worker, restoring) => {
    const history = restoring ? await worker.rpc.request('get_entries') : undefined;
    const expected = history ? savedSessionModel(history.entries ?? [], history.leafId ?? null) : preferences.preferredModel;
    if (expected && (worker.state?.model?.provider !== expected.provider || worker.state.model.id !== expected.id))
      pluginHosts.invalidate(worker);
    await restoreSelectedModel(worker, expected, preferences.language);
  },
  launch: worker => {
    usageEstimates.attach(worker);
    const launch = collaboration.attach(worker);
    return { ...launch, env: { ...launch.env,
      ...(runtimeManifest.patches?.includes('desktop-plugin-host-launch') ? { DFSC_RUNTIME_HOST_V1: '1' } : {}) },
      args: [...launch.args, '--extension', join(runtimeRoot, 'project-instructions.mjs')] };
  },
  dispose: worker => {
    remote.dispose(worker);
    bvrBridge.detach(worker);
    pluginHosts.invalidate(worker);
    btw.dispose(worker);
    conversationTiming.event(worker, { type: 'desktop_exit' });
    usageEstimates.detach(worker);
    collaboration.detach(worker);
    if (worker.status === 'disconnected' && worker.queued) pendingMessages.recover(worker);
    else pendingMessages.clear(worker);
  },
});
const notifications = new DesktopNotifications({
  preferences: () => preferences,
  workers: () => runtimes.workers,
  foreground: sessionId => {
    const focused = (view?: BrowserWindow) => Boolean(view && !view.isDestroyed()
      && view.isVisible() && !view.isMinimized() && view.isFocused());
    return !sessionDraft && runtimes.active?.state?.sessionId === sessionId && focused(window)
      || !miniView.draft && miniView.worker?.state?.sessionId === sessionId && focused(miniChat?.window);
  },
  create: options => Notification.isSupported() ? new Notification({
    ...options, icon: app.isPackaged ? join(process.resourcesPath, process.platform === 'darwin' ? 'icon.png' : 'icon.ico')
      : resolve(process.platform === 'darwin' ? 'build/icon.png' : 'build/icon.ico'),
  }) : undefined,
  open: (sessionId, kind) => {
    if (quitting || quitPending) return;
    showMainWindow();
    const contents = window?.webContents;
    if (!contents || contents.isDestroyed()) return;
    const send = () => {
      if (!quitting && !contents.isDestroyed())
        contents.send('runtime-event', { type: 'desktop_notification_open', sessionId, kind });
    };
    if (contents.isLoadingMainFrame()) contents.once('did-finish-load', send);
    else send();
  },
});
const bvrBridge = new BvrBridge(dataRoot, runtimes, () => appliedAuthData,
  () => settingsMutation || providerSettingsPending || providerApplyFailed || quitting || quitPending,
  () => preferences.language, (input, init) => net.fetch(input instanceof URL ? input.href : String(input), init));
const bvrSettings = new BvrSettings(dataRoot, () => bvrBridge.invalidate());
const pluginHosts = new PluginHostLauncher({ root: dataRoot, pool: runtimes, capabilities: capabilityService,
  provider: new StepPluginHostProvider(runtimes, () => appliedAuthData,
    () => settingsMutation || providerSettingsPending || providerApplyFailed || quitting || quitPending,
    (input, init) => net.fetch(input instanceof URL ? input.href : String(input), init)),
  language: () => preferences.language,
  available: () => runtimeManifest.patches?.includes('desktop-plugin-host-launch') === true
    && capabilityService.available && capabilityService.runtimeAvailable
    && !settingsMutation && !providerSettingsPending && !providerApplyFailed && !quitting && !quitPending });
const btw = new BtwRequests(runtimes, emit);
const pendingMessages = new PendingMessages(worker => {
  worker.revision++;
  emit({ type: 'desktop_queue', runtimeId: worker.id, runtimeRevision: worker.revision, pendingMessages: pendingMessages.list(worker) });
  runtimes.publish();
}, (worker, error) => {
  remote.queueFailed(worker);
  emit({ type: 'desktop_error', runtimeId: worker.id, message: String(error instanceof Error ? error.message : error) });
},
  (message, files) => files.length ? fileReferenceMessage(message, files, preferences.language) : message,
  (worker, message) => runtimes.preparePrompt(worker, message),
  (worker, id, event) => remote.queueEvent(worker, id, event));
const remote = new RemoteManager({
  language: () => preferences.language,
  sessions: remoteSessions,
  projects: remoteProjects,
  refresh: async () => { await listSessions(); },
  validateWorkspaces: async workspaces => {
    for (const workspace of workspaces) {
      if (!remoteProjects().some(project => project.workspace === workspace)
        || pathKey(await workspaceDirectory(workspace)) !== pathKey(workspace))
        throw new Error('Saved Remote project is no longer available');
    }
  },
  prepare: sessionId => prepareRemoteSession(sessionId),
  createSession: workspace => prepareRemoteSession(undefined, workspace),
  worker: (runtimeId, sessionId) => {
    const worker = runtimes.require(runtimeId);
    if (worker.state?.sessionId !== sessionId) throw new Error('Remote session identity changed');
    return worker;
  },
  submit: async (worker, message, accepted, images) => {
    if (transition || sessionNavigation.busy || settingsMutation || undoBusy || quitting || quitPending || updateInstalling
      || providerSettingsPending || worker.mutating || worker.stopping || worker.pendingUI.size
      || worker.failed || worker.interrupted || worker.launch?.goalArmed || worker.launch?.goal?.status === 'active')
      throw new Error('Review the session on Desktop before sending');
    const id = pendingMessages.enqueue(worker, message, { message, ...(images?.length ? { images } : {}) });
    accepted(id);
    pendingMessages.resumed(worker);
    void pendingMessages.drain(worker);
  },
  withdraw: (worker, queueId) => pendingMessages.withdraw(worker, queueId),
  queued: worker => pendingMessages.list(worker).filter(entry => !entry.sending).length,
  loadImages: receiveRemoteImages,
  sendImage: (channel, bindingId, sessionId, worker, path, valid, signal) =>
    sendRemoteImage(channel, bindingId, sessionId, worker.cwd, path, valid, signal),
  stop: async worker => { await handle('command', ['abort', {}, worker.id]); },
  respond: (worker, answer) => {
    if (quitting || quitPending || updateInstalling || settingsMutation) throw new Error('Desktop is unavailable');
    runtimes.respondToRequest(worker, answer);
    remote.runtimeEvent(worker, { type: 'desktop_ui_expired' });
  },
  open: url => shell.openExternal(url),
}, receive => {
  const channel = new RpcProcess(receive, 65536);
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env))
    if (/^(PATH|SYSTEMROOT|WINDIR|TEMP|TMP|HTTP_PROXY|HTTPS_PROXY|NO_PROXY)$/i.test(key)) env[key] = value;
  env.NODE_USE_ENV_PROXY = '1';
  channel.start(nodePath, join(runtimeRoot, 'remote-channel.mjs'), dataRoot, env);
  return channel;
}, state => emit({ type: 'desktop_remote', state }), Date.now, new RemoteStore(join(app.getPath('userData'), 'remote')));
const runtimeManifest = JSON.parse(readFileSync(join(runtimeRoot, 'manifest.json'), 'utf8'));
const backgroundAgents = new BackgroundAgents(runtimes.workers,
  () => transition || sessionNavigation.busy || settingsMutation || providerSettingsPending || undoBusy || quitting || quitPending,
  runtimeManifest.patches?.includes('desktop-subagent-redaction') === true,
  runtimeManifest.patches?.includes('desktop-background-reply') === true);
const launchControls = new LaunchControls(runtimes);
const cronBindings = new CronBindings(join(app.getPath('userData'), 'cron-bindings'));
const cronManagement = new CronManagement(runtimes, cwd => admin.request('cron_saved', { cwd }),
  () => emit({ type: 'desktop_cron_changed' }), cronBindings, workspace => cronAutomatic.block(workspace));
const inspectCronRecovery = async (key: string, sessionId: string) => {
  assertRecoveryQueues(runtimes.workers.values(), sessionId);
  const manifest = JSON.parse(await readFile(join(runtimeRoot, 'manifest.json'), 'utf8'));
  if (!manifest.patches?.includes('desktop-cron-recovery')) throw new Error('This runtime does not support gated Cron recovery');
  const task = (await cronManagement.list(preferences.workspaces)).tasks.find(task => task.key === key);
  if (!task?.durable || task.runtimeId) throw new Error('Select an offline durable task');
  const workspace = await workspaceDirectory(task.workspace);
  for (const worker of runtimes.workers.values()) {
    if (worker.status !== 'disconnected' && await samePath(worker.cwd, workspace))
      throw new Error('This project already has a host; refresh its state');
  }
  const target = (await listSessions()).find(session => session.id === sessionId);
  if (!target?.path || preferences.archivedSessionIds?.includes(sessionId) || !(await samePath(target.cwd, workspace)))
    throw new Error('Select an available conversation in this project');
  const sessionPath = await managedSessionFile(join(dataRoot, 'sessions'), target.path);
  const sessionInfo = await stat(sessionPath);
  const saved = await admin.request('cron_saved', { cwd: workspace });
  if (!saved.trusted) throw new Error('Project trust is required for recovery');
  const jobs = cronJobs(saved.jobs).filter(job => job.durable).sort((a, b) => a.id.localeCompare(b.id));
  if (!jobs.some(job => job.id === task.id && job.createdAt === task.createdAt)) throw new Error('Cron task changed; refresh');
  const options = await admin.request('session_options', { cwd: workspace });
  const model = options.models?.find((model: Model) => model.provider === options.model?.provider && model.id === options.model?.id);
  if (!model) throw new Error('No configured model is available for recovery');
  const settings = await admin.request('settings', { cwd: workspace });
  const official = options.officialModel === true;
  if (official && !settings.account?.loggedIn) throw new Error('Sign in before recovering scheduled tasks');
  const profile = settings.profiles?.find((profile: { id: string }) => profile.id === settings.account?.profile);
  const account = official ? `${profile?.title ?? settings.account?.profile ?? 'Step'}${settings.account?.userId ? ` · ${settings.account.userId}` : ''}`
    : `${providerModelNames([model], appliedAuthData)[0]?.providerName ?? model.provider} · 当前供应商配置`;
  return { workspace, jobs, sessionId, sessionName: target.name || target.firstMessage.slice(0, 80) || sessionId.slice(0, 8),
    sessionPath, sessionStamp: JSON.stringify([sessionInfo.size, sessionInfo.mtimeMs, sessionInfo.ino]),
    configurationRef: createHash('sha256').update(JSON.stringify(appliedAuthData)).digest('hex'), account, model,
    unconfirmed: cronHistoryFailed || cronHistory.uncertain(workspace) };
};
const launchCronRecovery = async (plan: import('./cron-recovery').CronRecoveryPlan) => {
  assertRecoveryQueues(runtimes.workers.values(), plan.sessionId);
  const manifest = JSON.parse(await readFile(join(runtimeRoot, 'manifest.json'), 'utf8'));
  if (plan.automaticBefore !== undefined && !manifest.patches?.includes('desktop-cron-recovery-guard'))
    throw new Error('This runtime does not support safe automatic Cron recovery');
  // Recovery is explicitly confirmed and starts gated, without changing the viewed chat.
  const worker = await runtimes.prepare(nodePath, join(runtimeRoot, 'step/dist/bundle/step.js'), plan.workspace,
    { ...authEnvironment(), DESKTOP_CRON_RECOVERY: '1', STEP_PERMISSION_PRESET: 'ask' }, plan.sessionPath);
  let activated = false;
  try {
    if (worker.state?.sessionId !== plan.sessionId) throw new Error('Recovery conversation identity changed');
    await worker.rpc.request('set_model', { provider: plan.model.provider, modelId: plan.model.id });
    await runtimes.read(worker);
    if (worker.permissionPreset !== 'ask' || worker.state?.model?.provider !== plan.model.provider || worker.state?.model?.id !== plan.model.id
      || runtimes.isBusy(worker)) throw new Error('Could not verify the recovery model and approval policy');
    const loaded = await worker.rpc.request('desktop_cron', { action: 'list' });
    if (loaded.trusted !== true) throw new Error('Project trust changed while opening the host');
    assertRecoveryJobs(plan.jobs, cronJobs(loaded.jobs));
    if (createHash('sha256').update(JSON.stringify(appliedAuthData)).digest('hex') !== plan.configurationRef)
      throw new Error('Recovery account changed while opening the host');
    await cronBindings.set(plan.workspace, plan.jobs, plan.sessionId, 'recovered');
    assertRecoveryQueues(runtimes.workers.values(), plan.sessionId);
    // The resume helper removes explicit rejections; uncertain delivery must retain the host.
    activated = true;
    await resumeCronHost(worker.rpc, () => runtimes.remove(worker), plan.automaticBefore);
    const retired = [...runtimes.workers.values()].filter(previous => previous !== worker
      && previous.status === 'disconnected' && previous.state?.sessionId === plan.sessionId);
    const viewedRuntime = retired.find(previous => previous.id === runtimes.activeId);
    const restoreViewed = !sessionDraft && Boolean(viewedRuntime);
    if (restoreViewed) {
      selectRuntime('main', worker);
      emit({ type: 'desktop_runtime_replaced', previousRuntimeId: viewedRuntime!.id, runtimeId: worker.id, sessionId: plan.sessionId });
    }
    if (retired.some(previous => previous.id === miniView.runtimeId)) replaceMiniRuntime(worker);
    for (const previous of retired) await runtimes.remove(previous);
    cronHistory.record(plan.workspace, plan.sessionId, 'recovered');
    emit({ type: 'desktop_cron_changed' });
    emit({ type: 'desktop_sessions_changed' });
    return { sessionId: plan.sessionId, runtimeId: worker.id };
  } catch (error) {
    if (!activated) await runtimes.remove(worker);
    else emit({ type: 'desktop_cron_changed' });
    cronHistory.record(plan.workspace, plan.sessionId, activated ? 'recovery_blocked' : 'recovery_failed');
    throw error;
  }
};
const cronAutomatic = new CronAutoRecovery(join(app.getPath('userData'), 'cron-recovery-authorizations'),
  inspectCronRecovery, launchCronRecovery, workspace => !cronHistoryFailed && !cronHistory.uncertain(workspace), Date.now,
  (workspace, sessionId) => cronHistory.record(workspace, sessionId, 'recovery_blocked'),
  error => { void crashLog.record('cron-auto-recovery', error); });
const cronRecovery = new CronRecovery(inspectCronRecovery, launchCronRecovery, Date.now, async (key, plan) => {
  if (cronHistoryFailed) throw new Error('Cron history is unavailable; automatic recovery remains off');
  cronHistory.acknowledge(plan.workspace);
  await cronAutomatic.enable(key, plan);
});
async function tryAutomaticCron(workspace?: string) {
  if (transition || settingsMutation || providerSettingsPending || undoBusy || deletingArchived || quitting || quitPending) return;
  transition = true;
  try { await cronAutomatic.run(workspace); }
  catch (error) { void crashLog.record('cron-auto-recovery', error); }
  finally { transition = false; emit({ type: 'desktop_cron_changed' }); }
}
const collaboration: SessionCollaboration = new SessionCollaboration(runtimes, join(runtimeRoot, 'desktop-sessions.mjs'), () => preferences.language,
  (worker, message) => { pendingMessages.enqueue(worker, message, { message }); },
  { extensionPath: join(runtimeRoot, 'desktop-remote.mjs'),
    sendImage: (worker, path, caption, signal) => remote.deliverImage(worker, path, caption, signal) });
function recycleSessionRuntimes() {
  if (transition && !sessionNavigation.busy) return;
  void runtimes.recycle(worker => sessionNavigation.pending(worker.state?.sessionId))
    .catch(error => crashLog.record('runtime-recycle', error));
}
setInterval(recycleSessionRuntimes, 60000).unref();
const admin = new RpcProcess(event => {
  if (event.type === 'auth_url') {
    try {
      const url = new URL(event.url);
      if (url.protocol !== 'https:' || !['platform.stepfun.com', 'platform.stepfun.ai'].includes(url.hostname)) throw new Error('Untrusted login URL');
      void shell.openExternal(url.href);
      emit({ type: 'desktop_auth', status: 'waiting' });
    } catch { emit({ type: 'desktop_error', message: 'Login URL rejected' }); }
  }
});
let preferenceWrites: Promise<void> = Promise.resolve();
function savePreferences() {
  const contents = JSON.stringify(preferences, null, 2);
  const write = preferenceWrites.catch(() => {}).then(async () => {
    const tmp = `${preferencesFile}.tmp`;
    await writeFile(tmp, contents); await rename(tmp, preferencesFile);
  });
  preferenceWrites = write;
  return write;
}
async function rememberModel(model: Model) {
  const previous = preferences.preferredModel;
  const selected = modelPreference(model)!;
  preferences.preferredModel = selected;
  try { await savePreferences(); }
  catch (error) {
    if (preferences.preferredModel === selected) preferences.preferredModel = previous;
    throw error;
  }
}
let sessionCatalog: Session[] = [];
// Upstream spawns one real session per subagent so it can resume the child transcript.
// Those are an implementation detail of the subagent feature, not sessions the user opened,
// so they are kept out of the Desktop session list. The files stay on disk.
async function listSessions(): Promise<Session[]> {
  const upstream: Session[] = await admin.request('sessions');
  const sessions: Session[] = upstream
    .filter(session => !isChildSession(String(session.id ?? '')))
    .map(session => ({ ...session, firstMessage: projectInstructionsInput(session.firstMessage) ?? session.firstMessage }));
  // Empty upstream sessions are persisted lazily, but must remain navigable.
  for (const worker of runtimes.workers.values()) {
    const id = worker.state?.sessionId;
    if (id && !isChildSession(id) && !sessions.some(session => session.id === id)) sessions.unshift({
      id, path: worker.state?.sessionFile ?? '', cwd: worker.cwd,
      name: worker.state?.sessionName, firstMessage: firstUserText(worker.messages), modified: new Date(worker.touched).toISOString(), messageCount: worker.messages.length,
    });
  }
  sessionCatalog = await Promise.all(sessions.map(async s => {
    const cwd = relocatedWorkspace(s.cwd, preferences, s.id);
    const workspacePath = await sessionWorkspacePath(cwd);
    return { ...s, cwd, workspacePath, independent: !workspacePath };
  }));
  return sessionCatalog;
}
function cachedSessions(): Session[] {
  const sessions = new Map(sessionCatalog.map(session => [session.id, { ...session }]));
  for (const worker of runtimes.workers.values()) {
    const id = worker.state?.sessionId;
    if (!id || isChildSession(id)) continue;
    const previous = sessions.get(id);
    sessions.set(id, {
      ...previous, id, path: worker.state?.sessionFile ?? previous?.path ?? '', cwd: worker.cwd,
      firstMessage: firstUserText(worker.messages) || previous?.firstMessage || '',
      name: worker.state?.sessionName ?? previous?.name,
      messageCount: worker.messages.length, modified: previous?.modified ?? new Date(worker.touched).toISOString(),
      independent: previous?.independent ?? isIndependentPath(worker.cwd),
      workspacePath: previous?.workspacePath ?? preferences.workspaces.find(path => pathKey(path) === pathKey(worker.cwd)),
    });
  }
  return [...sessions.values()];
}
function remoteSessions() {
  return cachedSessions().filter(session => !isChildSession(session.id) && !preferences.archivedSessionIds?.includes(session.id))
    .map(session => {
      const worker = [...runtimes.workers.values()].find(worker => worker.state?.sessionId === session.id && worker.status === 'connected');
      const workspace = worker?.cwd ?? session.cwd;
      return { runtimeId: worker?.id, sessionId: session.id, name: session.name || session.firstMessage || 'Step Code',
        workspace, workspaceName: preferences.workspaceNames?.[pathKey(session.workspacePath ?? workspace)] || basename(workspace) };
    });
}
function remoteProjects() {
  const sessions = remoteSessions();
  return [...new Set([...preferences.workspaces, ...sessions.map(session => session.workspace)])].map(workspace => ({
    workspace, name: preferences.workspaceNames?.[pathKey(workspace)]
      || sessions.find(session => session.workspace === workspace)?.workspaceName || basename(workspace),
  }));
}
async function prepareRemoteSession(sessionId?: string, workspace?: string) {
  if (transition || sessionNavigation.busy || settingsMutation || undoBusy || deletingArchived || quitting || quitPending
    || updateInstalling || providerSettingsPending) throw new Error('Desktop operation in progress');
  transition = true;
  try {
    const target = sessionId ? remoteSessions().find(session => session.sessionId === sessionId) : undefined;
    if (sessionId && !target) throw new Error('Session is unavailable');
    if (target?.runtimeId) return runtimes.require(target.runtimeId);
    if (sessionId && [...runtimes.workers.values()].some(worker => worker.state?.sessionId === sessionId && worker.status === 'connecting'))
      throw new Error('Session is opening');
    const saved = sessionId ? cachedSessions().find(session => session.id === sessionId) : undefined;
    if (sessionId && !saved?.path) throw new Error('Session history is unavailable');
    const cwd = target?.workspace ?? workspace;
    if (!cwd || !remoteProjects().some(project => project.workspace === cwd)) throw new Error('Unknown Remote workspace');
    const canonical = await workspaceDirectory(cwd);
    if (pathKey(canonical) !== pathKey(cwd)) throw new Error('Open the canonical project locally before authorizing Remote');
    const sessionPath = saved?.path ? await managedSessionFile(join(dataRoot, 'sessions'), saved.path) : undefined;
    // Preparing never activates the worker or consumes the local composer draft.
    // Cold/new remote hosts start in Ask; project trust remains a separate local decision.
    // Preserve the exact granted spelling after verifying its canonical identity.
    const worker = await runtimes.prepare(nodePath, join(runtimeRoot, 'step/dist/bundle/step.js'), cwd,
      { ...authEnvironment(), ...movedSessionEnvironment() }, sessionPath);
    if ((sessionId && worker.state?.sessionId !== sessionId) || worker.permissionPreset !== 'ask') {
      await runtimes.remove(worker);
      throw new Error('Could not verify the Remote session identity and Ask policy');
    }
    emit({ type: 'desktop_sessions_changed' });
    return worker;
  } finally { transition = false; }
}
async function snapshot(worker = runtimes.active, refresh = true, ignoreDraft = false, surface: Surface = 'main'): Promise<Snapshot> {
  const draft = ignoreDraft ? undefined : selectedDraft(surface);
  if (surface === 'mini' && !ignoreDraft) {
    worker = miniView.runtimeId ? runtimes.workers.get(miniView.runtimeId) : undefined;
    // Account changes may retire the transport. Keep the viewed history/draft,
    // but never expose that retired process as runnable.
    if (!worker && miniView.worker) worker = { ...miniView.worker, status: 'disconnected',
      state: miniView.worker.state ? { ...miniView.worker.state, isStreaming: false, isCompacting: false } : undefined,
      pendingUI: new Map() };
  }
  if (draft) worker = undefined;
  if (refresh && worker?.status === 'connected') await runtimes.read(worker);
  const sessions = refresh ? await listSessions() : cachedSessions();
  return {
    windowPresentation: presentations[surface].get(composerKey(draft ? { draftId: draft.id } : worker?.state?.sessionId ? { sessionId: worker.state.sessionId } : undefined)),
    windowPresentationRevision: presentationRevisions[surface],
    firstRun: { required: firstRun.required },
    quitReview: quitReview.state,
    statusAccount: statusAccount(appliedAuthData),
    workspaceIssue: unavailableWorkspace,
    preferences: { ...preferences, workspace: draft ? draft.workspace : worker?.cwd ?? preferences.workspace }, themePacks: themePacks.packs, providerSettingsPending,
    status: draft ? 'ready' : worker?.status ?? status, draftId: draft?.id, runtimeId: worker?.id, runtimeStartupTiming: draft ? undefined : worker?.startupTiming, runtimes: runtimes.summaries(), unreadSessionIds: [...runtimes.unreadSessionIds],
    state: draft ? { isStreaming: false, model: draft.model ? providerModelNames([draft.model], appliedAuthData)[0] : undefined, thinkingLevel: draft.thinkingLevel }
      : worker?.state ? { ...worker.state, model: worker.state.model ? providerModelNames([worker.state.model], appliedAuthData)[0] : undefined } : undefined,
    modelSelection: worker ? modelSelections.selection(worker) : undefined,
    modelChanges: worker ? modelSelections.changes(worker) : [],
    estimate: usageEstimates.summary(worker),
    permissionPreset: draft?.permissionPreset ?? worker?.permissionPreset, runtimeRevision: worker?.revision,
    launch: draft?.launch ?? worker?.launch ?? emptyLaunch(),
    messages: worker ? worker.messages.map(message => pendingMessages.decorate(worker, message)) : [], models: providerModelNames(draft?.models ?? worker?.models ?? [], appliedAuthData), stats: worker?.stats,
    pendingMessages: worker ? pendingMessages.list(worker) : [],
    requests: worker ? [...worker.pendingUI.values()] : [],
    sessions, independent: draft ? !draft.workspace : !worker || !(await sessionWorkspacePath(worker.cwd)),
  };
}
async function guardIdle(options: { stopHost?: boolean; allowRemote?: boolean; resources?: boolean } = {}) {
  if (transition) throw new Error('Workspace operation in progress');
  await runtimes.assertAllIdle(options);
}
function canApplyProviders() {
  return !speechSaving && capabilityService.available && !capabilityGate.active && !providerApplyFailed && !transition && !undoBusy && !runtimes.running && !admin.hasPendingRequests
    && [...runtimes.workers.values()].every(worker => worker.status !== 'connecting'
      && !worker.operations && !worker.mutating && !worker.stopping && !worker.remoteAttached);
}
function applyProviderSettings(): Promise<void> {
  if (providerApplication) return providerApplication;
  if (!providerSettingsPending || !canApplyProviders()) return Promise.resolve();
  const alreadyMutating = settingsMutation;
  settingsMutation = true;
  providerApplication = performProviderSettings().catch(error => {
    providerApplyFailed = true;
    throw error;
  }).finally(async () => {
    settingsMutation = alreadyMutating || !capabilityService.runtimeAvailable; providerApplication = undefined;
    await pluginHosts.resumeDeferred();
  });
  return providerApplication;
}
async function performProviderSettings() {
  if (!providerSettingsPending || !canApplyProviders()) return;
  await guardIdle();
  await capabilityService.recover();
  const workers = [...runtimes.workers.values()];
  const drafts = new Map<string, { surface: Surface; draft: NonNullable<typeof sessionDraft> }>();
  for (const surface of ['main', 'mini'] as const) {
    const draft = selectedDraft(surface);
    if (draft && !drafts.has(draft.id)) drafts.set(draft.id, { surface, draft });
  }
  try {
  await projectProviders(dataRoot, authData);
  appliedAuthData = authData;
  await admin.stop();
  admin.start(nodePath, join(runtimeRoot, 'admin.mjs'), dataRoot, authEnvironment());
  for (const worker of workers) {
    if (worker.status !== 'connected' && !worker.modelUnavailable) continue;
    await runtimes.refresh(worker, nodePath, join(runtimeRoot, 'step/dist/bundle/step.js'), authEnvironment(),
      { allowUnavailableModel: true });
    if (worker.pendingModel && !worker.models.some(m => m.provider === worker.pendingModel?.model.provider && m.id === worker.pendingModel?.model.id))
      worker.pendingModel = undefined;
  }
  for (const { surface, draft } of drafts.values()) {
    await beginSession(draft.workspace, surface);
    const refreshed = selectedDraft(surface);
    if (refreshed) {
      refreshed.id = draft.id;
      const selected = refreshed.models?.find(model => model.id === draft.model?.id && model.provider === draft.model?.provider);
      if (selected) {
        refreshed.model = selected; refreshed.modelChanged = draft.modelChanged;
        refreshed.thinkingLevel = draft.thinkingLevel; refreshed.thinkingChanged = draft.thinkingChanged;
      }
      refreshed.permissionPreset = draft.permissionPreset; refreshed.permissionChanged = draft.permissionChanged;
      refreshed.launch = draft.launch;
      selectDraft(surface, refreshed);
    }
  }
  providerSettingsPending = false;
  emit({ type: 'desktop_sessions_changed' });
  } catch (error) {
    // A partial refresh must never leave old and new configurations runnable together.
    sessionDraft = undefined;
    miniView.draft = undefined;
    await runtimes.suspend(workers);
    await admin.stop();
    admin.start(nodePath, join(runtimeRoot, 'admin.mjs'), dataRoot, authEnvironment());
    emit({ type: 'desktop_sessions_changed' });
    throw error;
  }
}
setInterval(() => {
  if (quitting || settingsMutation || !providerSettingsPending || !canApplyProviders()) return;
  void applyProviderSettings().catch(error => {
    providerApplyFailed = true;
    void crashLog.record('provider-settings-apply', error);
    emit({ type: 'desktop_error', message: preferences.language === 'en'
      ? 'Provider settings were saved, but could not be applied. Restart the app to retry.'
      : '供应商配置已保存，但应用失败，请重启软件后重试。' });
  });
}, 1000).unref();
function commitSessionNavigation(worker: SessionRuntime, value: Snapshot, surface: Surface = 'main'): Snapshot {
  if (runtimes.workers.get(worker.id) !== worker || worker.status !== 'connected' || worker.stopping)
    throw new Error('Session runtime disconnected while opening');
  selectRuntime(surface, worker);
  if (surface === 'main') {
    preferences.workspace = worker.cwd;
    void savePreferences().catch(() => emit({ type: 'desktop_error', message: 'Could not save the selected workspace' }));
  }
  return { ...value, windowPresentation: presentations[surface].get(composerKey({ sessionId: worker.state!.sessionId! })),
    windowPresentationRevision: presentationRevisions[surface],
    runtimes: runtimes.summaries(), unreadSessionIds: [...runtimes.unreadSessionIds] };
}
async function decorateSessionMessages(id: string, cwd: string, messages: Message[]) {
  return hydrateWorkflowHistory(cwd, await conversationTiming.decorate(id, messages), await workflowBindings.load(id));
}
async function sessionReading(id: string): Promise<SessionReading | null> {
  if (isChildSession(id)) throw new Error('Child sessions belong to their parent task');
  const target = cachedSessions().find(session => session.id === id);
  if (!target) return null;
  const worker = [...runtimes.workers.values()].find(worker => worker.state?.sessionId === id && worker.status === 'connected');
  if (worker) return {
    sessionId: id, version: `${worker.id}:${worker.revision}`,
    messages: worker.messages, modelChanges: modelSelections.changes(worker),
  };
  if (!target.path) return null;
  const history = await admin.request('session_history', { sessionId: id, sessionPath: target.path });
  if (!history || history.sessionId !== id) return null;
  const projected = importedHistoryMessages(history.messages, history.entries, history.leafId);
  const messages = projected === history.messages
    ? messagesWithEntryIds(projected, history.entries, history.leafId) : projected;
  const [decorated, record] = await Promise.all([
    decorateSessionMessages(id, target.cwd, messages), modelSelections.load(id),
  ]);
  return { sessionId: id, version: history.version, messages: decorated, modelChanges: record.changes };
}
async function navigationSnapshot(worker: SessionRuntime) {
  worker.operations++;
  try { return { worker, value: await snapshot(worker, false, true) }; }
  finally { worker.operations--; }
}
const openingSessions = new Map<string, Promise<SessionRuntime>>();
async function prepareSession(id: string, signal: AbortSignal) {
  const pending = openingSessions.get(id);
  if (pending) return navigationSnapshot(await pending);
  let worker = [...runtimes.workers.values()].find(worker => worker.state?.sessionId === id);
  if (worker?.status === 'disconnected') {
    await runtimes.remove(worker);
    worker = undefined;
  }
  if (!worker) {
    const target = cachedSessions().find(session => session.id === id) ?? (await listSessions()).find(session => session.id === id);
    if (!target?.path) throw new Error('This session history is unavailable');
    // Coalesce rapid clicks before spawning. Once started, let the worker finish:
    // session_start can restore background work which must not be force-stopped.
    await delay(60, undefined, { signal });
    const canonical = await workspaceDirectory(target.cwd, signal);
    signal.throwIfAborted();
    await capabilityService.recover();
    signal.throwIfAborted();
    let opening = openingSessions.get(id);
    const resident = [...runtimes.workers.values()].find(item => item.state?.sessionId === id && item.status === 'connected');
    if (!opening && resident) return navigationSnapshot(resident);
    if (!opening) {
      opening = runtimes.prepare(nodePath, join(runtimeRoot, 'step/dist/bundle/step.js'), canonical,
        { ...authEnvironment(), ...(preferences.workspaceSessionRedirects?.[id] ? movedSessionEnvironment() : {}) }, target.path)
        .then(async worker => {
          if (worker.state?.sessionId !== id) { await runtimes.remove(worker); throw new Error('Session history identity changed'); }
          return worker;
        });
      openingSessions.set(id, opening);
      void opening.finally(() => { if (openingSessions.get(id) === opening) openingSessions.delete(id); }).catch(() => {});
    }
    worker = await opening;
    if (worker.state?.sessionId !== id) {
      await runtimes.remove(worker);
      throw new Error('Session history identity changed');
    }
  }
  return navigationSnapshot(worker);
}
const sessionNavigation = new SessionNavigation(prepareSession, ({ worker, value }) => commitSessionNavigation(worker, value), busy => {
  transition = busy;
}, {
  reuse: id => {
    const worker = [...runtimes.workers.values()].find(worker => worker.state?.sessionId === id && worker.status === 'connected');
    return worker ? navigationSnapshot(worker) : undefined;
  },
  settled: recycleSessionRuntimes,
});
const miniNavigation = new SessionNavigation(prepareSession,
  ({ worker, value }) => commitSessionNavigation(worker, value, 'mini'), () => {}, { settled: recycleSessionRuntimes });
async function connect(cwd: string, sessionPath?: string, rememberProject = true, resetPermission = false, surface: Surface = 'main') {
  if (transition) throw new Error('Workspace operation in progress');
  transition = true;
  try {
    const canonical = await workspaceDirectory(cwd);
    status = 'connecting';
    await capabilityService.recover();
    const worker = await (surface === 'mini' ? runtimes.prepare.bind(runtimes) : runtimes.open.bind(runtimes))(nodePath, join(runtimeRoot, 'step/dist/bundle/step.js'), canonical,
      { ...authEnvironment(), ...(resetPermission ? movedSessionEnvironment() : {}) }, sessionPath);
    selectRuntime(surface, worker);
    if (surface === 'main') preferences.workspace = canonical;
    if (rememberProject && !pathKey(canonical).startsWith(`${pathKey(independentRoot)}/`)) {
      const previous = await Promise.all(preferences.workspaces.map(async path => ({ path, same: await samePath(path, canonical) })));
      const existingIndex = previous.findIndex(entry => entry.same);
      preferences.workspaces = existingIndex >= 0
        ? previous.filter((entry, index) => !entry.same || index === existingIndex).map(entry => entry.same ? canonical : entry.path)
        : [canonical, ...preferences.workspaces];
      if (preferences.pinnedWorkspaces) {
        const aliases = new Set(previous.filter(entry => entry.same).map(entry => pathKey(entry.path)));
        preferences.pinnedWorkspaces = [...new Set(preferences.pinnedWorkspaces.map(path => aliases.has(pathKey(path)) ? pathKey(canonical) : pathKey(path)))];
      }
    }
    await savePreferences();
    crashLog.setPhase('rpc started');
    status = 'connected';
    await runtimes.recycle();
    return await snapshot(worker, true, false, surface);
  } catch (error) { status = runtimes.active?.status ?? 'disconnected'; throw error; }
  finally { transition = false; }
}
async function newIndependentSession(surface: Surface = 'main') {
  const cwd = join(independentRoot, randomUUID());
  await mkdir(cwd, { recursive: true });
  return connect(cwd, undefined, false, false, surface);
}
async function beginSession(workspace?: string, surface: Surface = 'main') {
  if (transition || deletingArchived) throw new Error('Workspace operation in progress');
  const previous = selectedDraft(surface);
  if (previous && creatingDrafts.has(previous.id)) throw new Error('This draft is being created; wait before changing its project');
  const selected = workspace === undefined ? undefined
    : preferences.workspaces.find(path => pathKey(path) === pathKey(workspace));
  if (workspace !== undefined && !selected) throw new Error('Unknown workspace');
  transition = true;
  try {
    if (selected) await workspaceDirectory(selected);
    const options = await admin.request('session_options', { cwd: selected ?? app.getPath('documents') });
    options.model = preferredModel(options.models, preferences.preferredModel, options.model);
    if (!options.model?.thinkingLevels?.includes(options.thinkingLevel))
      options.thinkingLevel = options.model?.thinkingLevels?.[0];
    const next: NonNullable<typeof sessionDraft> = { id: previous?.id ?? randomUUID(), workspace: selected, ...options,
      permissionPreset: previous?.permissionPreset ?? options.permissionPreset, permissionChanged: previous?.permissionChanged,
      launch: previous?.launch ?? emptyLaunch() };
    const selectedModel = previous?.modelChanged
      ? preferredModel(options.models, modelPreference(previous.model)) : undefined;
    if (selectedModel) {
      Object.assign(next, { model: selectedModel, modelChanged: true });
      if (!selectedModel.thinkingLevels?.includes(next.thinkingLevel!))
        next.thinkingLevel = selectedModel.thinkingLevels?.[0];
      next.thinkingChanged = Boolean(next.thinkingLevel);
    }
    if (previous?.thinkingChanged && next.model?.thinkingLevels?.includes(previous.thinkingLevel!))
      Object.assign(next, { thinkingLevel: previous.thinkingLevel, thinkingChanged: true });
    selectDraft(surface, next);
    emit({ type: 'desktop_draft_changed', draftId: next.id });
    // Keep existing workers running, but none is being viewed on the draft page.
    runtimes.publish();
    await runtimes.recycle();
    return await snapshot(undefined, false, false, surface);
  } finally { transition = false; }
}
const text = (value: unknown, max = 100000): string => { if (typeof value !== 'string' || value.length > max) throw new Error('Invalid text'); return value; };
async function handle(method: string, args: any[], surface: Surface = 'main', markCapabilityPhase?: CapabilityPhaseMarker) {
  const originWindow = () => surface === 'mini' ? miniChat!.window! : window;
  const viewSnapshot = (worker?: SessionRuntime, refresh = true, ignoreDraft = false) => snapshot(worker, refresh, ignoreDraft, surface);
  if (surface === 'mini' && method === 'preferences'
    && (!args[0] || Object.keys(args[0]).some(key => key !== 'modelFavorite')))
    throw new Error('Shared preferences are edited in the main window');
  if (method === 'remoteState') { await listSessions(); return remote.snapshot(); }
  if (method === 'remoteAction') {
    const action = parseRemoteAction(args[0]);
    if (!['disconnect', 'unbind'].includes(action.type)
      && (transition || settingsMutation || undoBusy || quitting || quitPending || updateInstalling || providerSettingsPending))
      throw new Error('Desktop operation in progress');
    return remote.action(action);
  }
  if (updateInstalling && !['updateState', 'snapshot', 'systemTheme'].includes(method)) throw new Error('Update installation in progress');
  if (method === 'linkPreview') return linkPreview(args[0]);
  switch (method) {
    case 'miniChatState': return miniChat!.state();
    case 'miniChatOpen': {
      if (surface !== 'main') throw new Error('Open MiniChat from the main window');
      if (quitting || quitPending) throw new Error('Application is closing');
      if (transition && !(sessionNavigation.busy && !sessionNavigation.selecting))
        throw new Error('Wait for the workspace operation to finish');
      if (miniNavigation.busy) throw new Error('Wait for MiniChat conversation navigation');
      await startup;
      if (!resumeMini) {
        if (sessionDraft) selectDraft('mini', sessionDraft);
        else if (runtimes.active) selectRuntime('mini', runtimes.active);
        else throw new Error('No conversation is available');
      }
      await miniChat!.open();
      resumeMini = true;
      miniChat!.window!.webContents.send('runtime-event', { type: 'desktop_view_changed', surface: 'mini' });
      return miniChat!.state();
    }
    case 'miniChatPin': return miniChat!.pin(args[0]);
    case 'miniChatReturn': {
      if (surface !== 'mini' || transition || miniNavigation.busy || quitting || quitPending)
        throw new Error('Window operation in progress');
      const presentation = parseWindowPresentation(args[0]);
      const draft = miniView.draft;
      const worker = miniView.runtimeId ? runtimes.require(miniView.runtimeId) : undefined;
      const owner = draft ? { draftId: draft.id } : worker?.state?.sessionId ? { sessionId: worker.state.sessionId } : undefined;
      if (!owner) throw new Error('No conversation to return to');
      transition = true;
      try {
        const value = worker ? await snapshot(worker, false, true) : undefined;
        // Fence saves sent by the old main view before it receives the transfer event.
        presentationRevisions.main++;
        savePresentation('main', owner, presentation);
        if (draft) selectDraft('main', draft);
        else commitSessionNavigation(worker!, value!);
        window.webContents.send('runtime-event', { type: 'desktop_view_changed', surface: 'main', restorePresentation: true });
        showMainWindow();
        miniChat!.hide();
        resumeMini = false;
      } finally { transition = false; }
      return;
    }
    case 'miniChatMainAction': {
      if (surface !== 'mini' || !['settings', 'usage', 'cron', 'todos', 'workflows', 'status', 'clm', 'btw', 'plugins', 'file', 'web', 'subagent'].includes(args[0]))
        throw new Error('Unsupported main-window action');
      // Transfer the viewed conversation before opening a larger tool.
      const owner = miniView.draft ? { draftId: miniView.draft.id }
        : { sessionId: runtimes.require(miniView.runtimeId).state!.sessionId! };
      const presentation = presentations.mini.get(composerKey(owner)) ?? { position: { follow: true, top: 0 }, disclosures: [] };
      await handle('miniChatReturn', [presentation], 'mini');
      window.webContents.send('runtime-event', { type: 'desktop_main_action', action: args[0], payload: args[1] });
      return;
    }
    case 'windowPresentation': {
      const owner = requireComposerOwner(args[0]);
      if (!Number.isSafeInteger(args[2]) || args[2] !== presentationRevisions[surface]) return false;
      savePresentation(surface, owner, parseWindowPresentation(args[1]));
      return true;
    }
    case 'composerRead': return composers.read(requireComposerOwner(args[0]));
    case 'composerWrite': return composers.write({ ...args[0], owner: requireComposerOwner(args[0]?.owner) });
    case 'composerTake': return composers.take(requireComposerOwner(args[0]), args[1], originWindow().webContents.id);
    case 'composerRestore': return composers.restore(args[0]);
    case 'importScan':
    case 'importPreview':
    case 'importStart':
    case 'importJobs':
    case 'importCancel':
    case 'importChooseDirectory': {
      if (quitting || quitPending) throw new Error('Application is closing');
      if (method === 'importScan') return sessionImports.scan(args[0]);
      if (method === 'importPreview') return sessionImports.preview(text(args[0], 80));
      if (method === 'importStart') return sessionImports.start(args[0], args[1]);
      if (method === 'importJobs') return sessionImports.jobs();
      if (method === 'importCancel') return sessionImports.cancel(text(args[0], 80));
      const selected = await dialog.showOpenDialog(window, { properties: ['openDirectory'] });
      return selected.canceled ? null : selected.filePaths[0] ?? null;
    }
    case 'cronOpenHost': {
      if (transition || sessionNavigation.busy || settingsMutation || providerSettingsPending || undoBusy || deletingArchived || quitting || quitPending)
        throw new Error('Wait for account and workspace changes to finish');
      const worker = cronManagement.host(args[0]), rpc = worker.rpc, sessionId = worker.state!.sessionId;
      transition = true;
      worker.operations++;
      try {
        const value = await snapshot(worker, false, true);
        // This shortcut must never fall back to loading history or starting another runtime.
        if (cronManagement.host(args[0]) !== worker || worker.rpc !== rpc || worker.state?.sessionId !== sessionId)
          throw new Error('Cron host changed; refresh before opening');
        return commitSessionNavigation(worker, value);
      } finally { worker.operations--; transition = false; }
    }
    case 'cronList': {
      if (transition || settingsMutation || providerSettingsPending) throw new Error('Wait for account and workspace changes to finish');
      const overview = await cronManagement.list(preferences.workspaces);
      overview.history = [];
      for (const workspace of new Set([...preferences.workspaces, ...overview.tasks.map(task => task.workspace)])) {
        try {
          const entries = cronHistory.list(workspace).slice(-30).reverse();
          if (entries.length) overview.history.push({ workspace, entries });
        } catch { overview.issues.push({ workspace, reason: 'unavailable' }); }
      }
      for (const task of overview.tasks) {
        try {
          task.automatic = await cronAutomatic.status(task.workspace);
          task.history = overview.history.find(project => project.workspace === task.workspace)?.entries.filter(row => !row.jobId
            || row.jobId === task.id && (row.createdAt === undefined || row.createdAt === task.createdAt));
        } catch { overview.issues.push({ workspace: task.workspace, reason: 'unavailable' }); }
      }
      if (transition || settingsMutation || providerSettingsPending) throw new Error('Wait for account and workspace changes to finish');
      return overview;
    }
    case 'cronDisableAutomatic': {
      if (transition || settingsMutation || quitting || quitPending) throw new Error('Wait for changes to finish');
      const task = (await cronManagement.list(preferences.workspaces)).tasks.find(task => task.key === args[0]);
      if (!task) throw new Error('Cron task changed; refresh');
      await cronAutomatic.disable(task.workspace);
      emit({ type: 'desktop_cron_changed' });
      return;
    }
    case 'cronCreate':
    case 'cronUpdate':
    case 'cronDelete': {
      if (transition || settingsMutation || providerSettingsPending || undoBusy) throw new Error('Wait for account and workspace changes to finish');
      if (method === 'cronUpdate') {
        const manifest = JSON.parse(await readFile(join(runtimeRoot, 'manifest.json'), 'utf8'));
        if (!manifest.patches?.includes('desktop-cron-management-beta')) throw new Error('This runtime does not support task editing');
        return cronManagement.update(args[0]);
      }
      return method === 'cronCreate' ? cronManagement.create(args[0]) : cronManagement.delete(args[0], args[1]);
    }
    case 'cronRecoveryPreview':
    case 'cronRecover': {
      if (transition || sessionNavigation.busy || settingsMutation || providerSettingsPending || undoBusy || deletingArchived || quitting || quitPending)
        throw new Error('Wait for account and workspace changes to finish');
      transition = true;
      try {
        return method === 'cronRecoveryPreview' ? await cronRecovery.prepare(args[0], args[1]) : await cronRecovery.recover(args[0], args[1], args[2]);
      } finally { transition = false; }
    }
    case 'updateState': return { ...updates.snapshot(), transfer: installer.snapshot() };
    case 'checkUpdates': await updates.check(); return { ...updates.snapshot(), transfer: installer.snapshot() };
    case 'openUpdate': return shell.openExternal(updates.openTarget(args[0]));
    case 'downloadUpdate': {
      await maintainUpdateCache();
      const state = updates.snapshot();
      if (!state.updateAvailable || !state.release) throw new Error('No available update');
      return installer.download(state.release);
    }
    case 'cancelUpdateDownload': return installer.cancel();
    case 'installUpdate': {
      if (!window || window.isDestroyed() || quitPending) throw new Error('Window unavailable');
      const zh = preferences.language === 'zh';
      const confirmation = await dialog.showMessageBox(window, {
        type: 'question', message: zh ? '重启并安装更新？' : 'Restart and install the update?',
        detail: zh ? '未发送的消息和附件不会保留。请先确认所有会话中的草稿已处理。登录、会话历史和设置会保留。'
          : 'Unsent messages and attachments will not be retained. Check drafts in all sessions first. Sign-in, history and settings will be preserved.',
        buttons: zh ? ['稍后', '重启并安装'] : ['Later', 'Restart and install'], defaultId: 0, cancelId: 0,
      });
      if (confirmation.response !== 1) return;
      const busy = () => sessionImports.busy || runtimes.running || transition || settingsMutation || deletingArchived || quitPending || providerTestController || providerApplication || undoBusy
        || terminals.list().some(terminal => terminal.status === 'running' || terminal.status === 'starting')
        || [...runtimes.workers.values()].some(worker => runtimes.isBusy(worker) || worker.operations || worker.mutating
          || worker.stopping || worker.queued || worker.status === 'connecting' || pendingMessages.list(worker).length);
      if (updateInstalling) throw new Error('Update installation in progress');
      updateInstalling = true;
      let success = false;
      try {
        await installer.install(async () => {
          if (busy()) throw new InstallerFailure('busy');
          await conversationTiming.flush(); await modelSelections.flush(); await workflowBindings.flush();
          await usageEstimates.flush();
          await terminals.stopAll();
          await sessionImports.close();
          await remote.shutdown();
          await Promise.all([runtimes.stopAll(), admin.stop(), capabilityService.stop(), collaboration.stop(), pluginHosts.close()]);
        });
        success = true;
      } finally { if (!success) updateInstalling = false; }
      return;
    }
    case 'browserOpenLink': return browser!.open(text(args[0], 4096));
    case 'fileOpen': {
      let target: FileTarget = args[0];
      if (target === undefined) {
        const selected = await dialog.showOpenDialog(window, {
          title: preferences.language === 'zh' ? '打开文件' : 'Open file', properties: ['openFile'],
          defaultPath: runtimes.active?.cwd ?? preferences.workspace,
        });
        if (selected.canceled || !selected.filePaths.length) return null;
        target = { grantId: (await filePreviews.grant(selected.filePaths[0])).id };
      }
      const file = await filePreviews.resolve(target);
      const destination = args[1] === undefined ? 'internal' : text(args[1], 4200);
      const mode = fileMode(file.path);
      const remember = async () => {
        if (args[1] === undefined || destination === 'preview' || destination === 'other') return;
        preferences.fileOpeningApps = { ...preferences.fileOpeningApps, [extname(file.path).toLowerCase()]: destination };
        await savePreferences();
      };
      if (destination === 'internal' && mode === 'browser') {
        const page = await localPages.open(file.path);
        localFileGrants.set(file.path, file.id);
        const result = { destination: 'browser', browser: browser!.openLocal(page.url, file.path, page.origin) } satisfies FileOpenResult;
        await remember();
        return result;
      }
      if ((destination === 'internal' || destination === 'preview') && (mode === 'text' || mode === 'markdown')) {
        const result = { destination: 'preview', file: { ...await readPreview(file.path), id: file.id } } satisfies FileOpenResult;
        await remember();
        return result;
      }
      if (!canOpenExternally(file.path)) throw new Error('This file type cannot be opened in an external application');
      if (destination === 'internal' || destination === 'system') {
        const error = await shell.openPath(file.path);
        if (error) throw new Error(error);
      } else if (destination === 'other') {
        if (process.platform === 'darwin') {
          const selected = await dialog.showOpenDialog(window, { properties: ['openFile'], defaultPath: '/Applications',
            filters: [{ name: 'Applications', extensions: ['app'] }] });
          if (selected.canceled || !selected.filePaths.length) return null;
          await associationRequest(fileAssociationScript(), { action: 'open', path: file.path, id: selected.filePaths[0] });
        } else {
          await associationRequest(fileAssociationScript(), { action: 'other', path: file.path,
            window: window.getNativeWindowHandle().readBigUInt64LE().toString() }, 300000);
        }
      } else if (destination.startsWith('app:')) {
        const apps = await fileApplications(fileAssociationScript(), extname(file.path), file.path);
        if (!apps.some(item => item.id === destination)) throw new Error('Unknown associated application');
        await associationRequest(fileAssociationScript(), { action: 'open', path: file.path, id: process.platform === 'darwin' ? macApplicationPath(destination) : destination.slice(4) });
      } else throw new Error('Invalid file destination');
      await remember();
      return { destination: 'external' } satisfies FileOpenResult;
    }
    case 'fileOpenOptions': {
      const file = await filePreviews.resolve(args[0]);
      const mode = fileMode(file.path);
      const zh = preferences.language === 'zh';
      const choices: FileDestination[] = [];
      if (mode !== 'external') choices.push({ id: 'internal', label: mode === 'browser' ? (zh ? '内置浏览器' : 'Built-in browser') : (zh ? '文件预览' : 'File preview') });
      if (canOpenExternally(file.path)) {
        choices.push({ id: 'system', label: zh ? '系统默认应用' : 'System default app' });
        choices.push(...await fileApplications(fileAssociationScript(), extname(file.path), file.path));
        if (process.platform === 'win32' || process.platform === 'darwin') choices.push({ id: 'other', label: zh ? '选择其他应用…' : 'Choose another app…' });
      }
      if (!choices.length) throw new Error('No opening options for this file type');
      const saved = preferences.fileOpeningApps?.[extname(file.path).toLowerCase()];
      return { choices, selected: choices.find(item => item.id === saved && item.id !== 'other')?.id ?? choices[0].id } satisfies FileOpeningOptions;
    }
    case 'artifactFiles': {
      const worker = runtimes.require(text(args[0], 80));
      if (!Array.isArray(args[1]) || args[1].length > 12) throw new Error('Invalid artifacts');
      return Promise.all(args[1].map(async (path: unknown) => {
        try { return await artifactFile(worker.cwd, path); }
        catch { return { path: text(path, 4096), exists: false, canOpen: false, kind: 'file' }; }
      }));
    }
    case 'artifactAction': {
      const worker = runtimes.require(text(args[0], 80));
      const file = await artifactFile(worker.cwd, args[1]);
      if (args[2] === 'copy') { clipboard.writeText(file.path); return; }
      if (!file.exists) throw new Error('File no longer exists');
      if (args[2] === 'reveal') { shell.showItemInFolder(file.path); return; }
      if (args[2] !== 'open' || !file.canOpen) throw new Error('Unsupported file type');
      const error = await shell.openPath(file.path);
      if (error) throw new Error(error);
      return;
    }
    case 'beginSession': return beginSession(args[0] === undefined ? undefined : text(args[0], 2048), surface);
    case 'chooseSessionProject': {
      if (transition || deletingArchived) throw new Error('Workspace operation in progress');
      const result = await dialog.showOpenDialog(originWindow(), { properties: ['openDirectory'] });
      if (result.canceled) return null;
      if (transition || deletingArchived) throw new Error('Workspace operation in progress');
      const canonical = await realpath(result.filePaths[0]);
      if (!(await stat(canonical)).isDirectory()) throw new Error('Workspace is not a directory');
      const existing = (await Promise.all(preferences.workspaces.map(async path => await samePath(path, canonical) ? path : undefined))).find(Boolean);
      if (!existing) { preferences.workspaces = [...preferences.workspaces, canonical]; await savePreferences(); }
      return beginSession(existing ?? canonical, surface);
    }
    case 'createDraftSession': {
      const draftId = text(args[0], 80);
      const existing = createdDrafts.get(draftId);
      if (existing) {
        const worker = runtimes.require(existing);
        selectRuntime(surface, worker);
        return viewSnapshot(worker);
      }
      const draft = selectedDraft(surface);
      if (!draft || draft.id !== draftId) throw new Error('This session draft is no longer active');
      if (creatingDrafts.has(draftId)) throw new Error('This draft is already being created in another window');
      if (draft.model && !draft.models?.some(model => model.provider === draft.model!.provider && model.id === draft.model!.id))
        throw unavailableModel(draft.model, preferences.language);
      creatingDrafts.add(draftId);
      let created: Snapshot | undefined;
      try {
        created = await (draft.workspace ? connect(draft.workspace, undefined, true, false, surface) : newIndependentSession(surface));
        if (draft.model && (draft.modelChanged || draft.model.provider !== created.state?.model?.provider || draft.model.id !== created.state?.model?.id))
          await handle('command', ['set_model', { provider: draft.model.provider, modelId: draft.model.id }, created.runtimeId], surface);
        if (draft.thinkingChanged) await handle('command', ['set_thinking_level', { level: draft.thinkingLevel }, created.runtimeId], surface);
        // Risk acknowledgment needs the renderer to own the new runtime first.
        if (draft.permissionChanged && draft.permissionPreset !== 'full-access')
          await handle('command', ['set_permission_preset', { preset: draft.permissionPreset }, created.runtimeId], surface);
        for (const change of draftLaunchChanges(runtimes.require(created.runtimeId).launch, draft.launch))
          await handle('command', ['set_launch_mode', change, created.runtimeId], surface);
        const worker = runtimes.require(created.runtimeId);
        createdDrafts.set(draftId, worker.id);
        while (createdDrafts.size > 128) createdDrafts.delete(createdDrafts.keys().next().value!);
        composers.promote(draftId, worker.state!.sessionId!);
        if (sessionDraft === draft) selectRuntime('main', worker);
        if (miniView.draft === draft) selectRuntime('mini', worker);
        emit({ type: 'desktop_draft_created', draftId, runtimeId: worker.id, sessionId: worker.state?.sessionId });
        return await viewSnapshot(worker);
      } catch (error) {
        const worker = created?.runtimeId && runtimes.workers.get(created.runtimeId);
        if (worker && !worker.messages.length && !runtimes.isBusy(worker)) {
          const restoreDraft = selectedRuntime(surface) === worker.id && !selectedDraft(surface);
          await runtimes.remove(worker);
          if (restoreDraft && !selectedDraft(surface) && (!selectedRuntime(surface) || selectedRuntime(surface) === worker.id))
            selectDraft(surface, draft);
        }
        throw error;
      } finally { creatingDrafts.delete(draftId); }
    }
    case 'browserList': return browser!.snapshot();
    case 'browserCreate': return browser!.create(args[0] === undefined ? undefined : text(args[0], 8192));
    case 'browserSelect': return browser!.select(text(args[0], 80));
    case 'browserClose': return browser!.close(text(args[0], 80));
    case 'browserAction': {
      const id = text(args[0], 80);
      const action = text(args[1], 20) as BrowserAction;
      const tab = browser!.snapshot().tabs.find(tab => tab.id === id);
      if (tab?.localFile && (action === 'external' || action === 'reload')) {
        const grantId = localFileGrants.get(tab.localFile);
        if (!grantId) throw new Error('Unknown local file permission');
        const file = await filePreviews.resolve({ grantId });
        if (action === 'external') {
          const error = await shell.openPath(file.path);
          if (error) throw new Error(error);
          return browser!.snapshot();
        }
        const page = await localPages.open(file.path);
        return browser!.openLocal(page.url, file.path, page.origin, true);
      }
      return browser!.action(id, action, args[2] === undefined ? undefined : text(args[2], 8192));
    }
    case 'browserLayout': browser!.layout(args[0]); return;
    case 'terminalList': return args[0] === undefined ? terminals.list() : terminals.list(runtimes.require(text(args[0], 80)).cwd);
    case 'terminalCreate': return terminals.create(runtimes.require(text(args[0], 80)).cwd);
    case 'terminalWrite': terminals.write(text(args[0], 80), args[1]); return;
    case 'terminalResize': terminals.resize(text(args[0], 80), args[1], args[2]); return;
    case 'terminalAck': terminals.ack(text(args[0], 80), args[1]); return;
    case 'terminalClose': return terminals.close(text(args[0], 80));
    case 'terminalPasteText': return (await clipboard.readText()).slice(0, 65536);
    case 'rightPanelWidthMenu': {
      const selected = text(args[0], 16);
      const position = args[1];
      if (!window || !['standard', 'wide', 'fullscreen'].includes(selected) ||
        ![position?.x, position?.y].every(value => typeof value === 'number' && Number.isFinite(value) && Math.abs(value) < 100000))
        throw new Error('Invalid right panel width menu');
      const options = [
        { value: 'standard', label: preferences.language === 'zh' ? '标准' : 'Standard' },
        { value: 'wide', label: preferences.language === 'zh' ? '宽幅' : 'Wide' },
        { value: 'fullscreen', label: preferences.language === 'zh' ? '全屏' : 'Fullscreen' },
      ];
      const [width, height] = window.getContentSize();
      return new Promise<string | undefined>(resolve => {
        let choice: string | undefined;
        const menu = Menu.buildFromTemplate(options.map(option => ({
          label: option.label, type: 'radio' as const, checked: option.value === selected,
          click: () => { choice = option.value; },
        })));
        menu.popup({ window, x: Math.max(0, Math.min(width - 1, Math.round(position.x))),
          y: Math.max(0, Math.min(height - 1, Math.round(position.y))), callback: () => resolve(choice) });
      });
    }
    case 'reviewMenu': {
      const kind = text(args[1], 10);
      const selected = text(args[2], 512);
      const position = args[3];
      if (!window || !['source', 'base'].includes(kind) ||
        !Number.isFinite(position?.x) || !Number.isFinite(position?.y)) throw new Error('Invalid review menu');
      const worker = args[0] === undefined ? undefined : runtimes.require(text(args[0], 80));
      const options = kind === 'source'
        ? [{ value: 'turn', label: preferences.language === 'zh' ? '上一轮' : 'Last turn' },
          { value: 'branch', label: preferences.language === 'zh' ? '分支' : 'Branch' }]
        : worker ? (await repositoryDiff(worker.cwd)).bases.map(value => ({ value, label: value })) : [];
      if (!options.length || !options.some(option => option.value === selected)) throw new Error('Invalid review selection');
      const [width, height] = window.getContentSize();
      return new Promise<string | undefined>(resolve => {
        let choice: string | undefined;
        const menu = Menu.buildFromTemplate(options.map(option => ({
          label: option.label, type: 'radio' as const, checked: option.value === selected,
          click: () => { choice = option.value; },
        })));
        menu.popup({ window, x: Math.max(0, Math.min(width - 1, Math.round(position.x))),
          y: Math.max(0, Math.min(height - 1, Math.round(position.y))), callback: () => resolve(choice) });
      });
    }
    case 'workflows': {
      const worker = runtimes.require(text(args[0], 80));
      const sessionId = text(args[1], 200);
      if (!sessionId || worker.state?.sessionId !== sessionId || transition || worker.mutating)
        throw new Error('Session is not ready');
      const cwd = worker.cwd;
      const liveRuns = [...runtimes.workers.values()].filter(peer => peer.cwd === cwd && peer.status === 'connected')
        .flatMap(peer => workflowsFromMessages(peer.messages, runtimes.isBusy(peer)))
        .filter(flow => flow.runId && flow.startedAt !== undefined && workflowIsActive(flow.status))
        .map(flow => ({ runId: flow.runId!, startedAt: flow.startedAt! }));
      const result = await readWorkflowCatalog(cwd, dataRoot, liveRuns);
      if (runtimes.workers.get(worker.id) !== worker || worker.state?.sessionId !== sessionId || worker.cwd !== cwd || transition || worker.mutating)
        throw new Error('Session changed');
      return result;
    }
    case 'clm': {
      const worker = runtimes.require(text(args[0], 80));
      const sessionId = worker.state?.sessionId;
      if (!sessionId || transition || worker.mutating) throw new Error('Session is not ready');
      const result = await worker.rpc.request('get_desktop_clm', { entryId: args[1] === undefined ? undefined : text(args[1], 200) });
      if (runtimes.workers.get(worker.id) !== worker || worker.state?.sessionId !== sessionId) throw new Error('Session changed');
      return clmSnapshot(result, sessionId);
    }
    case 'clmAction': {
      if (transition || sessionNavigation.busy || settingsMutation || providerSettingsPending || undoBusy || quitting || quitPending)
        throw new Error('Wait for account and workspace changes to finish');
      const worker = runtimes.require(text(args[0], 80));
      const sessionId = text(args[1], 200), action = text(args[2], 20);
      if (!['on', 'off', 'compact'].includes(action) || worker.state?.sessionId !== sessionId) throw new Error('Invalid CLM action or session changed');
      if (runtimes.isBusy(worker) || hasBackgroundWork(worker) || worker.mutating || worker.queued || worker.launch?.goal?.status === 'active')
        throw new Error('Wait for this session to become idle');
      if (action === 'compact' && worker.pendingModel) throw new Error('Apply the pending model change before organizing context');
      const guidance = args[3] === undefined ? '' : text(args[3], 4000).trim();
      worker.mutating = true;
      worker.operations++;
      try {
        const state = await worker.rpc.request('get_state');
        if (state.sessionId !== sessionId || state.isStreaming || state.isCompacting || state.pendingMessageCount || hasBackgroundWork(worker))
          throw new Error('Session changed or is running');
        await worker.rpc.request('prompt', { message: action === 'compact' ? `/clm-compact${guidance ? ` ${guidance}` : ''}` : `/clm ${action}` }, 600000);
        await runtimes.read(worker);
      } finally { worker.mutating = false; worker.operations--; runtimes.publish(); }
      return;
    }
    case 'backgroundAgents':
      return backgroundAgents.read(text(args[0], 80), text(args[1], 200));
    case 'stopBackgroundAgent':
      return backgroundAgents.stop(text(args[0], 80), text(args[1], 200), text(args[2], 40));
    case 'replyBackgroundAgent': {
      if (args[0]?.runtimeId !== runtimes.activeId) throw new Error('Session is not selected');
      const worker = runtimes.require(text(args[0]?.runtimeId, 80));
      return runtimes.withBackgroundAction(worker, () => backgroundAgents.reply(args[0]));
    }
    case 'summary': {
      const worker = runtimes.require(text(args[0], 80));
      const sessionId = worker.state?.sessionId;
      if (!sessionId) throw new Error('Session is not ready');
      const result = await worker.rpc.request('get_desktop_summary');
      let build = {};
      try { build = statusBuild(JSON.parse(await readFile(join(runtimeRoot, 'manifest.json'), 'utf8'))); }
      catch { /* Source and older runtimes may not have a build manifest. */ }
      if (runtimes.workers.get(worker.id) !== worker || worker.state?.sessionId !== sessionId) throw new Error('Session changed');
      const summary = sessionSummary(result, sessionId);
      summary.status = { ...summary.status, ...build };
      return summary;
    }
    case 'repositoryDiff': {
      const worker = runtimes.require(text(args[0], 80));
      const base = args[1] === undefined ? undefined : text(args[1], 512);
      return repositoryDiff(worker.cwd, base);
    }
    case 'repositoryFileDiff': {
      const worker = runtimes.require(text(args[0], 80));
      return repositoryFileDiff(worker.cwd, text(args[1], 512), text(args[2], 4096));
    }
    case 'turnUndo': {
      if (transition || undoBusy) throw new Error('Workspace operation in progress');
      const worker = runtimes.require(text(args[0], 80));
      if (!Array.isArray(args[1]) || !args[1].length || args[1].length > 100 ||
        args[1].some((id: unknown) => typeof id !== 'string' || id.length > 200)) throw new Error('Invalid edit identifiers');
      const action = args[2];
      if (!['status', 'prepare', 'undo'].includes(action)) throw new Error('Invalid undo action');
      await undoCaptures.get(worker.id);
      const entry = conversationEntries(worker.messages).find(entry => entry.type === 'response' &&
        JSON.stringify(turnChanges(entry.items, process.platform).files.flatMap(file => file.edits.map(edit => edit.id))) === JSON.stringify(args[1]));
      if (entry?.type !== 'response' || !worker.state?.sessionId) throw new Error('Turn not found');
      const sessionId = worker.state.sessionId;
      if (action === 'status') return undoStore.status(sessionId, worker.cwd, entry.items);
      if (action === 'prepare') return undoStore.prepare(sessionId, worker.cwd, entry.items);
      const token = text(args[3], 80);
      undoBusy = true;
      const lockedPeers: import('./session-runtimes').SessionRuntime[] = [];
      try {
        // Prevent Desktop workers sharing this directory from racing the write.
        for (const peer of runtimes.workers.values()) {
          if (!(await samePath(peer.cwd, worker.cwd))) continue;
          if (peer.mutating || runtimes.isBusy(peer)) throw new Error('Stop tasks using this workspace before undo');
          peer.mutating = true;
          lockedPeers.push(peer);
          await runtimes.assertIdle(peer);
        }
        const result = await undoStore.undo(sessionId, worker.cwd, entry.items, token);
        emit({ type: 'desktop_undo_ready', runtimeId: worker.id });
        return result;
      } finally { for (const peer of lockedPeers) peer.mutating = false; undoBusy = false; }
    }
    case 'quitRespond': {
      if (args[1] === true) quitReview.refresh(quitReasons(runtimes, transition));
      quitReview.respond(args[0], args[1]);
      return;
    }
    case 'windowControl': {
      const target = originWindow();
      switch (args[0]) {
        case 'state': break;
        case 'minimize': target.minimize(); break;
        case 'toggleMaximize': target.isMaximized() ? target.unmaximize() : target.maximize(); break;
        case 'close': target.close(); break;
        case 'quit': if (surface === 'mini') throw new Error('Return to the main window to quit'); app.quit(); break;
        default: throw new Error('Unsupported window action');
      }
      return { maximized: target.isMaximized(), fullscreen: target.isFullScreen(), focused: target.isFocused() };
    }
    case 'snapshot': {
      await startup;
      if (!startupError) await maintainUpdateCache();
      if (startupError) { emit({ type: 'desktop_error', message: startupError }); startupError = undefined; }
      return viewSnapshot();
    }
    case 'finishFirstRun': {
      await startup;
      if (args[0] !== 'completed' && args[0] !== 'skipped') throw new Error('Invalid first-run outcome');
      if (args[0] === 'completed' && (!sessionDraft?.model || !sessionDraft.models?.some(
        model => model.id === sessionDraft!.model!.id && model.provider === sessionDraft!.model!.provider)))
        throw new Error('Choose an available model before completing setup');
      await firstRun.finish(args[0]);
      return snapshot();
    }
    case 'sessions': return listSessions();
    case 'newIndependentSession': await startup; return newIndependentSession(surface);
    case 'openSessionFolder': {
      if (!preferences.workspace) throw new Error('No active working directory');
      const error = await shell.openPath(preferences.workspace);
      if (error) throw new Error(error);
      return null;
    }
    case 'openWorkspaceFolder': {
      const target = text(args[0], 2048);
      if (!preferences.workspaces.some(path => pathKey(path) === pathKey(target))) throw new Error('Unknown workspace');
      await workspaceDirectory(target);
      const error = await shell.openPath(target);
      if (error) throw new Error(error);
      return null;
    }
    case 'removeWorkspace': {
      if (transition || deletingArchived || sessionNavigation.busy) throw new Error('Workspace operation in progress');
      const path = text(args[0], 2048);
      const next = removeWorkspace(preferences, path);
      const previous = preferences;
      transition = true;
      try {
        preferences = next;
        try { await savePreferences(); } catch (error) { preferences = previous; throw error; }
        if (unavailableWorkspace && pathKey(unavailableWorkspace) === pathKey(path)) unavailableWorkspace = undefined;
        startupError = undefined;
      } finally { transition = false; }
      if (sessionDraft?.workspace && pathKey(sessionDraft.workspace) === pathKey(path)) await beginSession();
      return snapshot();
    }
    case 'relocateWorkspace': {
      if (transition || deletingArchived || sessionNavigation.busy) throw new Error('Workspace operation in progress');
      const path = text(args[0], 2048);
      if (miniView.worker && pathKey(miniView.worker.cwd) === pathKey(path) && miniView.runtimeId !== runtimes.activeId
        || miniView.draft?.workspace && pathKey(miniView.draft.workspace) === pathKey(path) && miniView.draft !== sessionDraft)
        throw new Error(preferences.language === 'zh' ? '请先将该项目的小窗会话返回主窗口，再重新定位项目' : 'Return this project’s MiniChat conversation to main before relocating it');
      if (!preferences.workspaces.some(value => pathKey(value) === pathKey(path))) throw new Error('Unknown workspace');
      const peers = () => [...runtimes.workers.values()].filter(worker => pathKey(worker.cwd) === pathKey(path));
      transition = true;
      try {
        for (const worker of peers()) {
          if (worker.operations || worker.mutating || worker.submissions || worker.stopping) throw new Error('Session operation in progress');
          await runtimes.assertIdle(worker, { stopHost: true });
        }
        const result = await dialog.showOpenDialog(window, { properties: ['openDirectory'] });
        if (result.canceled) return null;
        const destination = await workspaceDirectory(result.filePaths[0]);
        const next = relocateWorkspace(preferences, path, destination, await listSessions());
        const active = peers().find(worker => worker.id === runtimes.activeId);
        const activeFile = active?.state?.sessionFile;
        const draftSelected = sessionDraft?.workspace && pathKey(sessionDraft.workspace) === pathKey(path);
        const recoverStartup = !sessionDraft && !runtimes.active && preferences.workspace &&
          pathKey(preferences.workspace) === pathKey(path);
        for (const worker of peers()) {
          if (worker.operations || worker.mutating || worker.submissions || worker.stopping) throw new Error('Session operation in progress');
          await runtimes.assertIdle(worker, { stopHost: true });
        }
        const previous = preferences;
        preferences = next;
        try { await savePreferences(); } catch (error) { preferences = previous; throw error; }
        for (const worker of peers()) await runtimes.remove(worker);
        if (sessionDraft?.workspace && pathKey(sessionDraft.workspace) === pathKey(path)) sessionDraft.workspace = destination;
        startupError = undefined;
        if (unavailableWorkspace && pathKey(unavailableWorkspace) === pathKey(path)) unavailableWorkspace = undefined;
        if (draftSelected || active || recoverStartup) {
          transition = false;
          if (draftSelected || recoverStartup) {
            await listSessions();
            return await beginSession(destination);
          }
          return await connect(destination, activeFile, false);
        }
        return await snapshot();
      } finally { transition = false; }
    }
    case 'chooseWorkspace': {
      const result = await dialog.showOpenDialog(window, { properties: ['openDirectory'] });
      return result.canceled ? null : connect(result.filePaths[0]);
    }
    case 'workspace': {
      const cwd = text(args[0]);
      for (const registered of preferences.workspaces) {
        if (await samePath(registered, cwd)) return connect(registered);
      }
      throw new Error('Unknown workspace');
    }
    case 'restart': {
      if (transition) throw new Error('Workspace operation in progress');
      const worker = runtimes.active;
      if (!worker) return snapshot();
      if (worker.mutating || worker.operations || worker.stopping) throw new Error('Session operation in progress');
      const { cwd, state } = worker;
      transition = true;
      try { await runtimes.assertIdle(worker, { stopHost: true }); await runtimes.remove(worker); }
      finally { transition = false; }
      return connect(cwd, state?.sessionFile && existsSync(state.sessionFile) ? state.sessionFile : undefined, false,
        Boolean(state?.sessionId && preferences.workspaceSessionRedirects?.[state.sessionId]));
    }
    case 'moveSessionToProject': {
      if (transition || deletingArchived || sessionNavigation.busy || quitting || quitPending)
        throw new Error('Wait for the current workspace operation to finish');
      const id = text(args[0], 200), destination = text(args[1], 4096);
      if (isChildSession(id)) throw new Error('Child sessions belong to their parent task');
      if (!preferences.workspaces.some(path => pathKey(path) === pathKey(destination)))
        throw new Error('Unknown destination project');
      transition = true;
      const sources = [...runtimes.workers.values()].filter(worker => worker.state?.sessionId === id);
      let prepared: typeof runtimes.active;
      let committed = false;
      let locked = false;
      try {
        if (preferences.archivedSessionIds?.includes(id)) throw new Error('Restore this conversation before moving it');
        for (const worker of sources) {
          if (worker.operations || worker.mutating || worker.submissions || worker.stopping || worker.pendingModel)
            throw new Error('Session operation in progress');
        }
        for (const worker of sources) worker.mutating = true;
        locked = true;
        for (const worker of sources) {
          if (worker.cron?.status === 'unavailable') throw new Error('MOVE_CRON_UNAVAILABLE');
          if (hasScheduledCron(worker.cron))
            throw new Error(`MOVE_CRON_HOST: ${worker.cron?.jobs.map(job => job.id).join(', ') || 'unavailable'}`);
          await runtimes.assertBackgroundIdle(worker, { allowDisconnected: true });
        }
        const target = (await listSessions()).find(session => session.id === id);
        if (!target?.path) throw new Error('Save this conversation before moving it');
        const canonical = await workspaceDirectory(destination);
        if (await samePath(target.cwd, canonical)) throw new Error('Conversation is already in this project');
        const associated: string[] = [];
        try {
          for (const cwd of [target.cwd, canonical]) {
            const saved = await admin.request('cron_saved', { cwd });
            for (const job of cronJobs(saved.jobs)) {
              const binding = await cronBindings.get(cwd, job);
              if (binding?.sessionId === id) associated.push(job.id);
            }
          }
        } catch {
          throw new Error('MOVE_CRON_UNAVAILABLE');
        }
        if (associated.length) throw new Error(`MOVE_CRON_ASSOCIATED: ${associated.join(', ')}`);
        const runtimeManifest = JSON.parse(await readFile(join(runtimeRoot, 'manifest.json'), 'utf8'));
        if (!runtimeManifest.patches?.includes('desktop-session-cron-scope'))
          throw new Error('MOVE_CRON_UNAVAILABLE: runtime');
        const path = await managedSessionFile(join(dataRoot, 'sessions'), target.path);
        const source = sources[0];
        const wasActive = sources.some(worker => worker.id === runtimes.activeId) && !sessionDraft;
        // Validate a new cwd-bound transport before changing the durable association.
        // Permissions and project trust from the source are not carried into it.
        await capabilityService.recover();
        prepared = await runtimes.prepare(nodePath, join(runtimeRoot, 'step/dist/bundle/step.js'), canonical,
          { ...authEnvironment(), ...movedSessionEnvironment() }, path);
        prepared.mutating = true;
        if (prepared.state?.sessionId !== id || prepared.permissionPreset !== 'ask')
          throw new Error('Could not verify the destination conversation and approval policy');
        await runtimes.assertBackgroundIdle(prepared);
        pluginHosts.invalidate(prepared);
        await restoreSelectedModel(prepared, source?.state?.model, preferences.language);
        if (source?.state?.thinkingLevel) {
          const { levels } = await prepared.rpc.request('get_available_thinking_levels');
          if (levels?.includes(source.state.thinkingLevel))
            await prepared.rpc.request('set_thinking_level', { level: source.state.thinkingLevel });
        }
        await runtimes.read(prepared);
        const previous = preferences;
        preferences = moveSessionToWorkspace(preferences, target, destination);
        if (wasActive) preferences.workspace = canonical;
        try { await savePreferences(); } catch (error) { preferences = previous; throw error; }
        committed = true;
        if (wasActive) selectRuntime('main', prepared);
        for (const worker of sources) await runtimes.remove(worker);
        if (sources.some(worker => worker.id === miniView.runtimeId)) replaceMiniRuntime(prepared);
        startupError = undefined;
        emit({ type: 'desktop_sessions_changed' });
        return await snapshot();
      } finally {
        try {
          if (prepared) {
            prepared.mutating = false;
            if (!committed) await runtimes.remove(prepared);
          }
        } finally {
          if (locked) for (const worker of sources) worker.mutating = false;
          transition = false;
        }
      }
    }
    case 'sessionReading': return sessionReading(text(args[0], 300));
    case 'navigateSession': {
      if (deletingArchived || transition && !sessionNavigation.busy) throw new Error('Workspace operation in progress');
      const id = text(args[0], 300);
      if (isChildSession(id)) throw new Error('Child sessions belong to their parent task');
      return (surface === 'mini' ? miniNavigation : sessionNavigation).select(id);
    }
    case 'switchSession': {
      if (transition || deletingArchived) throw new Error('Workspace operation in progress');
      if (isChildSession(text(args[0], 300))) throw new Error('Child sessions belong to their parent task');
      const resident = [...runtimes.workers.values()].find(worker => worker.state?.sessionId === text(args[0]));
      if (resident) {
        sessionDraft = undefined;
        runtimes.activate(resident);
        preferences.workspace = resident.cwd;
        void savePreferences().catch(() => emit({ type: 'desktop_error', message: 'Could not save the selected workspace' }));
        return snapshot(resident, false);
      }
      const target = (await listSessions()).find(s => s.id === text(args[0]));
      if (!target) throw new Error('Unknown session');
      if (!target.path) throw new Error('This empty session runtime is unavailable');
      return connect(target.cwd, target.path, false, Boolean(preferences.workspaceSessionRedirects?.[target.id]));
    }
    case 'cloneSession': {
      if (transition || deletingArchived) throw new Error('Workspace operation in progress');
      const sessionId = text(args[0], 200);
      transition = true;
      let source: typeof runtimes.active;
      let sourceLocked = false;
      let copyPath: string | undefined;
      let copyOpened = false;
      try {
        const target = (await listSessions()).find(session => session.id === sessionId);
        if (!target?.path || !target.messageCount) throw new Error('Only saved, nonempty sessions can be branched');
        source = [...runtimes.workers.values()].find(worker => worker.state?.sessionId === sessionId);
        if (source) {
          if (source.mutating || source.operations) throw new Error('Session operation in progress');
          source.mutating = true;
          sourceLocked = true;
          await runtimes.assertIdle(source);
          await runtimes.read(source);
        }
        const path = await managedSessionFile(join(dataRoot, 'sessions'), target.path);
        const stem = `${(source?.state?.sessionName || target.name || target.firstMessage || (preferences.language === 'zh' ? '新会话' : 'New session')).slice(0, 180)} · ${preferences.language === 'zh' ? '分支' : 'branch'}`;
        const names = new Set(cachedSessions().map(session => session.name));
        let name = stem;
        for (let number = 2; names.has(name); number++) name = `${stem} ${number}`;
        const cwd = source?.cwd ?? await realpath(target.cwd);
        const copy = await admin.request('copy_session', { sessionPath: path, cwd });
        copyPath = await managedSessionFile(join(dataRoot, 'sessions'), copy.path);
        if (!copy.id || copy.id === target.id || source?.leafId && copy.sourceLeafId !== source.leafId) throw new Error('Session history changed; try again');
        await capabilityService.recover();
        const worker = await runtimes.open(nodePath, join(runtimeRoot, 'step/dist/bundle/step.js'), cwd, authEnvironment(),
          copyPath, { kind: 'open-copy', sessionId: copy.id, permissionPreset: source?.permissionPreset, name });
        copyOpened = true;
        await modelSelections.copyHistory(sessionId, worker.state!.sessionId!);
        await workflowBindings.copyHistory(sessionId, worker.state!.sessionId!, worker.messages);
        await runtimes.read(worker);
        preferences.workspace = worker.cwd;
        await savePreferences();
        return await snapshot(worker);
      } catch (error) {
        if (copyPath && !copyOpened) await deleteManagedSessionFile(join(dataRoot, 'sessions'), copyPath);
        throw error;
      } finally { if (source && sourceLocked) source.mutating = false; transition = false; }
    }
    case 'branchSession': {
      const kind = text(args[0], 20);
      if (kind !== 'clone' && kind !== 'fork') throw new Error('Unsupported branch operation');
      if (transition) throw new Error('Workspace operation in progress');
      const source = runtimes.require(text(args[2], 80));
      if (source.id !== selectedRuntime(surface) || source.mutating || source.operations) throw new Error('Session operation in progress');
      const entryId = text(args[1], 80);
      transition = true; source.mutating = true;
      try {
        await runtimes.assertIdle(source);
        await runtimes.read(source);
        const selected = source.messages.find(message => message.entryId === entryId);
        if (!selected || selected.role !== (kind === 'fork' ? 'user' : 'assistant')) throw new Error('This message is no longer a branch point');
        if (kind === 'clone' && source.messages.at(-1)?.entryId !== entryId) throw new Error('Only the latest reply can be branched');
        const sessionPath = source.state?.sessionFile;
        if (!sessionPath || !existsSync(sessionPath) || !source.leafId) throw new Error('Wait for this session to be saved before branching');
        const stem = `${(source.state?.sessionName || firstUserText(source.messages) || (preferences.language === 'zh' ? '新会话' : 'New session')).slice(0, 180)} · ${preferences.language === 'zh' ? '分支' : 'branch'}`;
        const names = new Set(cachedSessions().map(session => session.name));
        let name = stem;
        for (let number = 2; names.has(name); number++) name = `${stem} ${number}`;
        await capabilityService.recover();
        const worker = await (surface === 'mini' ? runtimes.prepare.bind(runtimes) : runtimes.open.bind(runtimes))(nodePath, join(runtimeRoot, 'step/dist/bundle/step.js'), source.cwd, authEnvironment(),
          sessionPath, { kind, entryId, leafId: source.leafId, permissionPreset: source.permissionPreset,
            name });
        await modelSelections.copyHistory(source.state!.sessionId!, worker.state!.sessionId!);
        await workflowBindings.copyHistory(source.state!.sessionId!, worker.state!.sessionId!, worker.messages);
        await runtimes.read(worker);
        selectRuntime(surface, worker);
        return await viewSnapshot(worker);
      } finally { source.mutating = false; transition = false; }
    }
    case 'retryMessage': {
      if (transition) throw new Error('Workspace operation in progress');
      const worker = runtimes.require(text(args[2], 80));
      if (worker.id !== selectedRuntime(surface) || worker.mutating || worker.operations) throw new Error('Session operation in progress');
      const entryId = text(args[0], 80);
      const message = text(args[1]);
      if (/^\s*\/_desktop_(?:retry|goal_input|init)\b/.test(message)) throw new Error('Reserved Desktop command');
      worker.mutating = true;
      try { await runtimes.retryLatest(worker, entryId, message); }
      finally { worker.mutating = false; }
      return null;
    }
    case 'deleteArchivedSessions': {
      if (transition || settingsMutation || deletingArchived) throw new Error('Session operation in progress');
      deletingArchived = true;
      const locked: NonNullable<typeof runtimes.active>[] = [];
      try {
        const targets = archivedDeletionTargets(args[0], await listSessions(), preferences.archivedSessionIds ?? []);
        const assertTargetsIdle = () => {
          for (const target of targets) {
            if (target.id === runtimes.active?.state?.sessionId || target.id === miniView.worker?.state?.sessionId)
              throw new Error(preferences.language === 'zh' ? '请先在主窗口和小窗切换到其他会话，再删除当前会话' : 'Open a different session in both windows before deleting this one');
            const worker = [...runtimes.workers.values()].find(worker => worker.state?.sessionId === target.id);
            if (worker && (runtimes.isBusy(worker) || worker.operations || worker.mutating && !locked.includes(worker))) {
              throw new Error(preferences.language === 'zh' ? '请先停止要删除的会话任务' : 'Stop the selected session tasks first');
            }
          }
        };
        assertTargetsIdle();
        for (const target of targets) {
          const worker = [...runtimes.workers.values()].find(worker => worker.state?.sessionId === target.id);
          if (worker) { worker.mutating = true; locked.push(worker); }
        }
        for (const target of targets) {
          const worker = locked.find(worker => worker.state?.sessionId === target.id);
          if (worker) await runtimes.assertIdle(worker, { stopHost: true });
          await managedSessionFile(join(dataRoot, 'sessions'), target.path);
        }
        archivedDeletionTargets(args[0], await listSessions(), preferences.archivedSessionIds ?? []);
        assertTargetsIdle();
        if (transition || settingsMutation) throw new Error('Session operation in progress');
        transition = true;
        try {
          for (const target of targets) {
            const worker = [...runtimes.workers.values()].find(worker => worker.state?.sessionId === target.id);
            if (worker) await runtimes.remove(worker);
            await deleteManagedSessionFile(join(dataRoot, 'sessions'), target.path);
            await conversationTiming.remove(target.id);
            await usageEstimates.remove(target.id);
            await modelSelections.remove(target.id);
            await workflowBindings.remove(target.id);
            sessionCatalog = sessionCatalog.filter(session => session.id !== target.id);
            runtimes.unreadSessionIds.delete(target.id);
            preferences.archivedSessionIds = preferences.archivedSessionIds?.filter(id => id !== target.id);
            preferences.sessionOrder = preferences.sessionOrder?.filter(id => id !== target.id);
            await savePreferences();
          }
        } finally { transition = false; }
        return true;
      } finally {
        for (const worker of locked) if (worker) worker.mutating = false;
        deletingArchived = false;
        // Also refresh the catalog if a later file in a batch could not be deleted.
        emit({ type: 'desktop_sessions_changed' });
      }
    }
    case 'deleteSession': {
      if (transition || deletingArchived) throw new Error('Session operation in progress');
      const target = (await listSessions()).find(s => s.id === text(args[0]));
      if (!target) throw new Error('Unknown session');
      if (target.id === runtimes.active?.state?.sessionId || target.id === miniView.worker?.state?.sessionId)
        throw new Error(preferences.language === 'zh' ? '请先在主窗口和小窗切换到其他会话，再删除当前会话' : 'Open a different session in both windows before deleting this one');
      const worker = [...runtimes.workers.values()].find(worker => worker.state?.sessionId === target.id);
      if (worker) await runtimes.assertIdle(worker, { stopHost: true });
      const response = await dialog.showMessageBox(window, { type: 'question', message: preferences.language === 'zh' ? '将此会话移到回收站？' : 'Move this session to the Recycle Bin?', buttons: ['Cancel', 'Move to Recycle Bin'], defaultId: 0, cancelId: 0 });
      if (response.response !== 1) return false;
      if (target.id === runtimes.active?.state?.sessionId || target.id === miniView.worker?.state?.sessionId)
        throw new Error(preferences.language === 'zh' ? '会话已在窗口中打开，请先切换到其他会话' : 'The conversation was opened in a window; select a different one first');
      if (worker) { await runtimes.assertIdle(worker, { stopHost: true }); await runtimes.remove(worker); }
      if (target.path) await shell.trashItem(target.path);
      await workflowBindings.remove(target.id);
      await usageEstimates.remove(target.id);
      return true;
    }
    case 'projectInstructions': {
      const owner = args[0];
      if (transition || sessionNavigation.busy || !owner || typeof owner !== 'object') throw new Error('Project selection is changing');
      if (owner.draftId !== undefined) {
        const draft = selectedDraft(surface);
        if (!draft || draft.id !== text(owner.draftId, 80) || owner.runtimeId !== undefined || owner.sessionId !== undefined)
          throw new Error('This session draft is no longer active');
        if (!draft.workspace) return { mode: 'choose-project' };
        const { mode } = await inspectProjectInstructions(draft.workspace);
        if (selectedDraft(surface) !== draft) throw new Error('Project selection changed');
        return { mode };
      }
      const worker = runtimes.require(text(owner.runtimeId, 80));
      if (worker.state?.sessionId !== text(owner.sessionId, 256)) throw new Error('Session selection changed');
      const sessionId = worker.state.sessionId;
      const { mode } = await inspectProjectInstructions(worker.cwd);
      if (runtimes.require(worker.id) !== worker || worker.state?.sessionId !== sessionId) throw new Error('Session selection changed');
      return { mode };
    }
    case 'command': {
      const type = text(args[0], 80); const data = args[1] ?? {};
      const sessionDraft = selectedDraft(surface);
      // Obsolete navigation preparation still locks shared account/settings
      // changes, but cannot block commands on the latest confirmed runtime.
      if (transition && !(sessionNavigation.busy && !sessionNavigation.selecting)) throw new Error('Workspace is changing');
      if (sessionDraft && args[2] === undefined) {
        if (creatingDrafts.has(sessionDraft.id)) throw new Error('This draft is being created; wait before changing its options');
        if (type === 'set_model') {
          const model = sessionDraft.models?.find(model => model.id === data.modelId && model.provider === data.provider);
          if (!model) throw new Error('Unknown model');
          await rememberModel(model);
          sessionDraft.model = model; sessionDraft.modelChanged = true;
          if (!model.thinkingLevels?.includes(sessionDraft.thinkingLevel!)) sessionDraft.thinkingLevel = model.thinkingLevels?.[0];
          sessionDraft.thinkingChanged = Boolean(sessionDraft.thinkingLevel);
          emit({ type: 'desktop_draft_changed', draftId: sessionDraft.id });
          return;
        }
        if (type === 'set_thinking_level') {
          if (!sessionDraft.model?.thinkingLevels?.includes(data.level)) throw new Error('Unsupported thinking level');
          sessionDraft.thinkingLevel = data.level; sessionDraft.thinkingChanged = true;
          emit({ type: 'desktop_draft_changed', draftId: sessionDraft.id });
          return;
        }
        if (type === 'set_permission_preset') {
          if (!permissionPresets.includes(data.preset)) throw new Error('Unknown permission preset');
          sessionDraft.permissionPreset = data.preset; sessionDraft.permissionChanged = true;
          emit({ type: 'desktop_draft_changed', draftId: sessionDraft.id });
          return;
        }
        if (type === 'set_launch_mode') {
          if (!['plan', 'goal', 'ultracode', 'review'].includes(data.mode) || typeof data.enabled !== 'boolean') throw new Error('Invalid launch state');
          const launch = sessionDraft.launch ??= emptyLaunch();
          if (data.mode === 'review') {
            if (data.enabled && (launch.plan || launch.goalArmed || launch.ultracodeArmed))
              throw new Error('Completion review is only available for ordinary main tasks');
            launch.reviewArmed = data.enabled;
          } else if (data.enabled && launch.reviewArmed) throw new Error('Disable completion review before selecting another task mode');
          else if (data.mode === 'ultracode') launch.ultracodeArmed = data.enabled;
          else if (data.mode === 'plan') { launch.plan = data.enabled; launch.planArmed = data.enabled; if (data.enabled) launch.goalArmed = false; }
          else { launch.goalArmed = data.enabled; if (data.enabled) { launch.plan = false; launch.planArmed = false; } }
          emit({ type: 'desktop_draft_changed', draftId: sessionDraft.id });
          return;
        }
        throw new Error('Send a message to create this session first');
      }
      const runtimeId = args[2] === undefined ? selectedRuntime(surface) : text(args[2], 80);
      if (surface === 'mini' && runtimeId !== miniView.runtimeId) throw new Error('MiniChat conversation changed');
      const worker = ['queue_edit', 'queue_remove'].includes(type) ? runtimes.workers.get(runtimeId!) : runtimes.require(runtimeId);
      if (!worker) throw new Error('This session runtime is unavailable');
      const projectRules = type === 'prompt' && typeof data.message === 'string'
        && isProjectInstructionsCommand(data.message, (data.files?.length ?? 0) + (data.images?.length ?? 0));
      if (worker.stopping && ['prompt', 'queue_steer', 'queue_steer_first', 'abort'].includes(type))
        throw new Error('Wait for this session to stop');
      if (worker.mutating && !['abort', 'extension_ui_response', 'get_commands', 'get_available_thinking_levels', 'get_session_stats'].includes(type)) throw new Error('Session operation in progress');
      if (type === 'prompt' && isProjectTrustInput(data)) {
        const result = await trustProject(runtimes, worker, cwd => admin.request('trust_project', { cwd }), preferences.language);
        if (result.saved) emit({ type: 'extension_ui_request', method: 'notify', notifyType: 'info',
          runtimeId: worker.id, sessionId: worker.state?.sessionId,
          message: preferences.language === 'zh'
            ? '项目信任已保存。重启运行时后生效；当前及其他已打开会话未自动重启。'
            : 'Project trust saved. Restart the runtime to apply; existing sessions were not restarted.' });
        return result;
      }
      const mutating = projectRules || ['set_permission_preset', 'set_launch_mode', 'goal_action', 'disable_standing_ultracode', 'compact', 'queue_recover'].includes(type);
      if (mutating) worker.mutating = true;
      let submitted = false;
      let restoreReview: (() => void) | undefined;
      try {
        if (projectRules) await runtimes.assertIdle(worker);
        const wasStreaming = promptNeedsQueue(worker);
        if (type === 'prompt') { worker.submissions++; submitted = true; }
        const rpc = worker.rpc;
        const pendingUI = worker.pendingUI;
        if (type === 'set_launch_mode') {
          if (!['plan', 'goal', 'ultracode', 'review'].includes(data.mode) || typeof data.enabled !== 'boolean') throw new Error('Invalid launch state');
          return await launchControls.set(worker, data.mode, data.enabled);
        }
        if (type === 'goal_action') return await launchControls.goal(worker, text(data.action, 20), data.value);
        if (type === 'disable_standing_ultracode') return await launchControls.disableStandingUltracode(worker);
        if (type === 'set_model' || type === 'set_thinking_level') {
          if (type === 'set_model') {
            bvrBridge.detach(worker);
            const provider = text(data.provider, 200), modelId = text(data.modelId, 300);
            const model = worker.models.find(model => model.provider === provider && model.id === modelId);
            if (!model) throw new Error('Unknown model');
            const configured = providerModelNames([model], appliedAuthData)[0];
            modelSelections.select(worker, { ...configured, thinkingLevels: modelThinkingLevels(configured) });
          } else modelSelections.selectEffort(worker, text(data.level, 30));
          if (!runtimes.isBusy(worker)) await modelSelections.apply(worker);
          if (type === 'set_model') {
            const selected = worker.pendingModel?.model ?? worker.state?.model;
            if (selected) await rememberModel(selected);
          }
          return;
        }
        if (type === 'get_available_thinking_levels') {
          const selected = worker.pendingModel?.model ?? worker.state?.model;
          const configured = selected ? providerModelNames([selected], appliedAuthData)[0] : undefined;
          if (configured?.thinkingServiceDefault) return { levels: [] };
          if (worker.pendingModel) return { levels: modelThinkingLevels(worker.pendingModel.model) };
        }
        if (type === 'new_session') return connect(worker.cwd, undefined, false, false, surface);
        if (type === 'extension_ui_response') {
          const request = pendingUI.get(text(data.id));
          if (!request) throw new Error('This request has expired');
          const answer: Record<string, unknown> = { id: request.id };
          if (data.cancelled === true) answer.cancelled = true;
          else if (request.method === 'confirm') { if (typeof data.confirmed !== 'boolean') throw new Error('Confirmation required'); answer.confirmed = data.confirmed; }
          else {
            const value = text(data.value);
            const question = questionnaire(request);
            answer.value = question ? serializeAnswers(question, JSON.parse(value)) : value;
            if (request.method === 'select' && !request.options?.includes(data.value)) throw new Error('Invalid selection');
          }
          runtimes.respondToRequest(worker, answer);
          remote.runtimeEvent(worker, { type: 'desktop_ui_expired' });
          return null;
        }
        const allowed = ['prompt', 'abort', 'clear_queue', 'new_session', 'set_model', 'set_thinking_level', 'set_session_name', 'set_permission_preset', 'get_commands', 'get_available_thinking_levels', 'get_session_stats', 'compact'];
        if (type === 'queue_recover') {
          if (worker.busy || worker.submissions || worker.stopping || worker.state?.isCompacting || worker.pendingUI.size)
            throw new Error('Wait for this session to stop');
          await rpc.request('clear_queue');
          pendingMessages.recover(worker);
          return;
        }
        if (type === 'queue_steer_first') {
          const first = pendingMessages.list(worker).find(item => !item.sending);
          if (first) await pendingMessages.steer(worker, first.id, first.version);
          return;
        }
        if (['queue_edit', 'queue_remove', 'queue_steer'].includes(type)) {
          const id = text(data.id, 80);
          if (!Number.isInteger(data.version) || data.version < 0) throw new Error('Invalid queued message version');
          if (type === 'queue_edit') {
            const message = text(data.message);
            if (/^\s*\/_desktop_(?:retry|goal_input|init)\b/.test(message)) throw new Error('Reserved Desktop command');
            if (isProjectInstructionsCommand(message,
              pendingMessages.list(worker).find(entry => entry.id === id)?.attachmentCount ?? 0)) throw new Error(preferences.language === 'zh'
              ? '请等待当前任务结束后单独运行 /init，不能将排队消息改成此指令。'
              : 'Run /init separately after the current task finishes; it cannot replace a queued message.');
            pendingMessages.edit(worker, id, data.version, message);
          } else if (type === 'queue_remove') pendingMessages.remove(worker, id, data.version);
          else await pendingMessages.steer(worker, id, data.version);
          return;
        }
        if (!allowed.includes(type)) throw new Error('Unsupported command');
        if (type === 'set_permission_preset') {
          const preset = text(data.preset, 30);
          if (!permissionPresets.includes(preset as typeof permissionPresets[number])) throw new Error('Unknown permission preset');
          if ([...pendingUI.values()].some(isFullAccessRisk)) throw new Error(preferences.language === 'zh'
            ? '请先完成已有的权限风险确认，再重新发送。' : 'Resolve the existing permission acknowledgment before sending again.');
          const cancellationRevision = worker.fullAccessCancellationRevision ?? 0;
          // Preset switching stays allowed while a turn runs: it only governs
          // later approvals, so it must not assert an idle session.
          const { commands } = await rpc.request('get_commands');
          if (!Array.isArray(commands) || !commands.some((command: { name?: string; source?: string }) => command.name === 'permissions' && command.source === 'extension')) {
            throw new Error('This Step Code runtime does not support permission switching');
          }
          await rpc.request('prompt', { message: `/permissions ${preset}` }, 125000);
          if (preset === 'full-access' && (worker.fullAccessCancellationRevision ?? 0) !== cancellationRevision)
            return { cancelled: true };
          if (worker.permissionPreset !== preset) throw new Error(preferences.language === 'zh'
            ? '未启用所选权限。' : 'The selected permission tier was not enabled.');
          return;
        }
        let payload: Record<string, unknown> = {};
        let promptLaunch: LaunchState | undefined;
        let filePaths: string[] = [];
        if (type === 'prompt') {
          payload.message = text(data.message);
          if (/^\s*\/_desktop_(?:retry|goal_input|init)\b/.test(payload.message as string)) throw new Error('Reserved Desktop command');
          promptLaunch = { ...worker.launch ?? emptyLaunch() };
          if (!projectRules) {
            payload = reviewPayload(worker, payload, promptLaunch);
            restoreReview = reserveReview(worker, payload);
            if (restoreReview) runtimes.publishLaunch(worker);
          }
          if (data.files !== undefined) {
            if (!Array.isArray(data.files) || data.files.length > MAX_ATTACHMENTS || new Set(data.files).size !== data.files.length) throw new Error('Invalid attachments');
            const paths = await Promise.all(data.files.map(async (id: unknown) => {
              const path = attachedFiles.get(text(id, 80));
              if (!path) throw new Error('Attachment has expired; add it again');
              const info = await stat(path);
              if (!info.isFile() || info.size > MAX_FILE_BYTES) throw new Error('Attached file is unavailable or too large');
              return path;
            }));
            filePaths = paths;
            payload.message = fileReferenceMessage(payload.message as string, paths, preferences.language);
          }
          if (data.images) {
            if (!Array.isArray(data.images) || data.images.length > MAX_IMAGES || data.images.length + (data.files?.length ?? 0) > MAX_ATTACHMENTS) throw new Error('Too many attachments');
            payload.images = data.images.map((i: any) => {
              if (i.type !== 'image' || !['image/png', 'image/jpeg', 'image/webp'].includes(i.mimeType)) throw new Error('Unsupported image');
              return { type: 'image', mimeType: i.mimeType, data: text(i.data, 14000000) };
            });
          }
          if (wasStreaming || worker.state?.isCompacting) {
            if (worker.launch?.goalArmed) throw new Error('Finish the current task before starting a new goal');
            if (worker.state?.desktopCompletionReview === 1)
              await rpc.request('desktop_completion_review_skip');
            const id = pendingMessages.enqueue(worker, text(data.message), launchControls.input(worker, payload), filePaths);
            restoreReview = undefined;
            launchControls.consume(worker);
            if (Array.isArray(data.files)) for (const id of data.files) attachedFiles.delete(id);
            return { queued: true, id, version: 0 };
          }
          pendingMessages.resumed(worker);
        }
        if (type === 'set_model') payload = { provider: text(data.provider, 200), modelId: text(data.modelId, 300) };
        if (type === 'set_thinking_level') payload = { level: text(data.level, 30) };
        if (type === 'set_session_name') payload = { name: text(data.name, 200) };
        if (type === 'compact') await runtimes.assertIdle(worker);
        if (type === 'abort') { worker.stopping = true; worker.interrupted = true; pendingMessages.pause(worker); }
        worker.operations++;
        if (type === 'prompt') runtimes.publish();
        try {
          let response;
          if (type === 'prompt' && promptLaunch?.goalArmed && !projectRules) {
            launchControls.consume(worker);
            await runtimes.preparePrompt(worker, payload.message as string);
            if (!await launchControls.startGoal(worker, payload, promptLaunch)) throw new Error('Goal state changed before submission');
            response = { goal: true };
          } else {
            if (type === 'prompt' && !(payload.message as string).trimStart().startsWith('/')) {
              payload = launchControls.input(worker, payload, promptLaunch);
              launchControls.consume(worker);
              await runtimes.preparePrompt(worker, payload.message as string);
            }
            if (projectRules) {
              await runtimes.preparePrompt(worker, '/init');
              payload.message = await projectInstructionsMessage(worker.cwd, '/init');
            }
            const submission = rpc.request(type, payload, type === 'prompt' || type === 'compact' ? 600000 : 30000);
            response = await submission;
            if (type === 'prompt') { restoreReview = undefined; runtimes.publishLaunch(worker); }
          }
          if (type === 'abort') {
            // Abort waits for idle; clear accepted steers before making them editable.
            await rpc.request('clear_queue');
            pendingMessages.recover(worker);
          }
          if (type === 'prompt' && Array.isArray(data.files)) for (const id of data.files) attachedFiles.delete(id);
          return response;
        } catch (error) {
          if (type === 'prompt') { worker.failed = true; pendingMessages.pause(worker); }
          throw error;
        } finally {
          worker.operations--;
          runtimes.publish();
        }
      } finally {
        if (restoreReview) { restoreReview(); runtimes.publishLaunch(worker); }
        if (mutating) worker.mutating = false;
        if (type === 'abort') worker.stopping = false;
        if (submitted) { worker.submissions--; runtimes.publish(); void pendingMessages.drain(worker); }
        if (type === 'set_model' || type === 'set_thinking_level') void pendingMessages.drain(worker);
      }
    }
    case 'btwAsk':
      if (transition || sessionNavigation.busy || settingsMutation || providerSettingsPending || undoBusy || quitting || quitPending)
        throw new Error('Wait for account and workspace changes to finish');
      return btw.ask(args[0]);
    case 'btwCancel': return btw.cancel(args[0]);
    case 'btwClear': return btw.clear(args[0]);
    case 'accountAllowance':
      if (args[0] !== undefined && typeof args[0] !== 'boolean') throw new Error('Invalid allowance refresh');
      return accountAllowance.query(args[0] === true);
    case 'estimateSettings': return usageEstimates.settings();
    case 'usageOverview': {
      // Coalesce scans across windows. The admin worker is local-only and bounded.
      // The native scan has a 28s deadline; allow bounded cache/projection/IPC headroom.
      usageOverviewPending ??= admin.request('usage_overview', {}, 60000)
        .then(result => usageEstimates.overview(result as import('../src/usage-overview').UsageOverview))
        .finally(() => { usageOverviewPending = undefined; });
      return usageOverviewPending;
    }
    case 'searchSessions': {
      const query = parseFulltextQuery(args[0]);
      const result = await admin.request('session_search', { query }, 60000);
      const sessions = cachedSessions();
      const projected = projectFulltextResult(result, query, sessions, preferences);
      const known = new Map(sessions.map(session => [session.id, session]));
      projected.hits = (await Promise.all(projected.hits.map(async hit => {
        try { await managedSessionFile(join(dataRoot, 'sessions'), known.get(hit.sessionId)!.path!); return hit; }
        catch { return null; }
      }))).filter((hit): hit is NonNullable<typeof hit> => hit !== null);
      return projected;
    }
    case 'cancelSessionSearch':
      return admin.request('cancel_session_search', { queryId: text(args[0], 80) });
    case 'setEstimateRules': {
      if (settingsMutation) throw new Error('Account change in progress');
      return usageEstimates.setRules(args[0], args[1]);
    }
    case 'cancelAccountAllowance': accountAllowance.cancel(); return null;
    case 'stepPageState': {
      return stepPage.snapshot();
    }
    case 'prepareStepPage': {
      // Preparation only writes files/config; existing workers and Cron hosts stay alive.
      await guardIdle({ stopHost: false });
      return stepPage.prepare((bundlePath, homePath) => admin.request('prepare_steppage', { bundlePath, homePath }));
    }
    case 'compactionSettings': return admin.request('compaction_settings');
    case 'saveCompactionSettings': return admin.request('save_compaction_settings', { update: args[0] });
    case 'speechSettings':
      return speechSettings(authData, appliedAuthData, settingsMutation || providerSettingsPending || providerApplyFailed);
    case 'saveSpeech':
    case 'acknowledgeSpeech': {
      if (speechSaving || settingsMutation || capabilityGate.active || transition || undoBusy || quitting || quitPending || updateInstalling)
        throw new Error('Settings operation in progress');
      speechSaving = true;
      try {
        speech.cancel();
        const next = method === 'saveSpeech' ? saveSpeech(authData, args[0], args[1], args[2]) : acknowledgeSpeech(authData, args[0]);
        await vault.save(next);
        authData = next;
        return speechSettings(authData, appliedAuthData, providerSettingsPending || providerApplyFailed);
      } finally { speechSaving = false; }
    }
    case 'beginSpeech': {
      const currentScope = () => sessionDraft ? `draft:${sessionDraft.id}`
        : runtimes.active?.state?.sessionId ? `runtime:${runtimes.active.id}:${runtimes.active.state.sessionId}` : undefined;
      const scope = currentScope();
      const configuration = authData[SPEECH_FIELD], credential = appliedAuthData.step;
      const generation = rendererGenerations.get(window.webContents.id);
      const current = () => Boolean(scope && scope === currentScope()
        && configuration === authData[SPEECH_FIELD] && credential === appliedAuthData.step
        && rendererGenerations.get(window.webContents.id) === generation && window.isVisible()
        && !speechSaving && !settingsMutation && !capabilityGate.active && !transition && !providerSettingsPending
        && !providerApplyFailed && !quitting && !quitPending && !updateInstalling);
      return speech.begin(authData, appliedAuthData, current);
    }
    case 'transcribeSpeech': return speech.transcribe(args[0], args[1], args[2]);
    case 'finishSpeech': return speech.finish(args[0]);
    case 'cancelSpeech':
      speech.cancel(text(args[0], 80)); return;
    case 'globalInstructions': return globalInstructions.read();
    case 'saveGlobalInstructions': {
      const saved = await globalInstructions.save(args[0], args[1]);
      // Resident conversations keep their context; new sessions must not reuse older empty workers.
      if (saved.revision !== args[1]) for (const worker of runtimes.workers.values()) outdatedInstructions.add(worker);
      return saved;
    }
    case 'settings': return { ...await admin.request('settings', { cwd: (sessionDraft ? sessionDraft.workspace : preferences.workspace) ?? app.getPath('documents') }), providers: providerInfos(authData) };
    case 'discoverProviderModels': return discoverProviderModels(authData, args[0], args[1]);
    case 'cancelProviderTest': providerTestController?.abort(); return;
    case 'testProvider': {
      if (providerTestController) throw new Error('Provider test already in progress');
      const controller = new AbortController();
      providerTestController = controller;
      try { return await testProvider(authData, args[0], args[1], args[2], controller.signal); }
      finally { if (providerTestController === controller) providerTestController = undefined; }
    }
    case 'saveProvider':
    case 'deleteProvider': {
      const previous = authData;
      const next = method === 'saveProvider' ? saveProviderAuth(previous, args[0], args[1]) : deleteProviderAuth(previous, args[0]);
      // Keep live credentials and models unchanged until every task and queue drains.
      await persistAuth(next);
      providerSettingsPending = true;
      providerApplyFailed = false;
      await applyProviderSettings();
      return snapshot();
    }
    case 'login': {
      await guardIdle();
      accountAllowance.cancel();
      await applyProviderSettings();
      const next = await admin.request('login', { profile: text(args[0], 40), key: args[1] === undefined ? undefined : text(args[1], 4096) }, 300000);
      await persistAuth(mergeRuntimeAuth(authData, next));
      appliedAuthData = authData;
      await admin.stop();
      admin.start(nodePath, join(runtimeRoot, 'admin.mjs'), dataRoot, authEnvironment());
      const current = runtimes.active;
      const draft = sessionDraft;
      await runtimes.stopAll();
      if (draft) await beginSession(draft.workspace);
      else if (current) await connect(current.cwd, current.state?.sessionFile, false);
      emit({ type: 'desktop_view_changed', surface: 'mini', restorePresentation: true });
      return null;
    }
    case 'cancelLogin': return admin.request('cancel_login');
    case 'logout': {
      await guardIdle();
      accountAllowance.cancel();
      await applyProviderSettings();
      const next = await admin.request('logout');
      await persistAuth(mergeRuntimeAuth(authData, next));
      appliedAuthData = authData;
      await admin.stop();
      admin.start(nodePath, join(runtimeRoot, 'admin.mjs'), dataRoot, authEnvironment());
      const current = runtimes.active;
      const draft = sessionDraft;
      await runtimes.stopAll();
      if (draft) await beginSession(draft.workspace);
      else if (current) await connect(current.cwd, undefined, false);
      emit({ type: 'desktop_view_changed', surface: 'mini', restorePresentation: true });
      return null;
    }
    case 'capabilityCatalog': {
      if (settingsMutation) throw new Error('Shared settings operation in progress');
      return capabilityService.catalog();
    }
    case 'pluginWindowOpen': {
      if (quitting || quitPending || settingsMutation) throw new Error('capability:busy');
      const plugin = await capabilityService.desktop(args[0]?.ref);
      await pluginWindows!.open(plugin);
      return;
    }
    case 'pluginDocument': {
      if (settingsMutation) throw new Error('capability:busy');
      try { return await capabilityService.document(args[0]); }
      catch (error) { throw new Error(error instanceof Error && /^capability:[a-z-]+$/u.test(error.message) ? error.message : 'capability:operation-failed'); }
    }
    case 'pluginRepositoryInfo': {
      if (settingsMutation) throw new Error('capability:busy');
      try { return await capabilityService.repositoryInfo(args[0]); }
      catch (error) { throw new Error(error instanceof Error && /^capability:[a-z-]+$/u.test(error.message) ? error.message : 'capability:operation-failed'); }
    }
    case 'pluginConfiguration':
    case 'pluginSaveConfiguration': {
      if (method === 'pluginConfiguration' && settingsMutation) throw new Error('capability:busy');
      if (method === 'pluginSaveConfiguration') await guardIdle({ stopHost: false });
      try { return await capabilityService.configuration(args[0], method === 'pluginSaveConfiguration' ? args[0] : undefined); }
      catch (error) { throw new Error(error instanceof Error && /^capability:[a-z-]+$/u.test(error.message) ? error.message : 'capability:operation-failed'); }
    }
    case 'pluginChoosePath': {
      if (settingsMutation) throw new Error('capability:busy');
      const input = args[0];
      if (!input || typeof input.ref !== 'string' || typeof input.field !== 'string') throw new Error('capability:invalid-input');
      const config = await capabilityService.configuration(input);
      const field = config.schema.groups.flatMap(group => group.fields).find(field => field.id === input.field && field.type === 'path');
      if (!field) throw new Error('capability:invalid-input');
      const result = await dialog.showOpenDialog(window, { title: field.label,
        properties: [field.selection === 'file' ? 'openFile' : 'openDirectory'] });
      if (result.canceled) return null;
      await capabilityService.configuration(input);
      return result.filePaths[0] ?? null;
    }
    case 'pluginHostSettings':
    case 'pluginSaveHostSettings': {
      if (method === 'pluginHostSettings' && settingsMutation) throw new Error('capability:busy');
      if (method === 'pluginSaveHostSettings') await guardIdle({ stopHost: false });
      try { return await capabilityService.hostSettings(args[0], method === 'pluginSaveHostSettings' ? args[0] : undefined); }
      catch (error) { throw new Error(error instanceof Error && /^capability:[a-z-]+$/u.test(error.message) ? error.message : 'capability:operation-failed'); }
    }
    case 'bvrConfiguration':
    case 'bvrSaveConfiguration':
    case 'bvrCheckEnvironment': {
      if (method !== 'bvrSaveConfiguration' && settingsMutation) throw new Error('bvr:busy');
      if (!(await capabilityService.catalog()).plugins.some(plugin => plugin.id === 'bilibili-video-research'))
        throw new Error('bvr:not-installed');
      try {
        if (method === 'bvrSaveConfiguration') {
          await guardIdle({ stopHost: false });
          return await bvrSettings.save(args[0]);
        }
        return method === 'bvrCheckEnvironment' ? await bvrSettings.check(args[0]) : await bvrSettings.read();
      } catch (error) {
        throw new Error(error instanceof Error && /^bvr:[a-z-]+$/u.test(error.message) ? error.message : 'bvr:storage');
      }
    }
    case 'bvrChoosePath': {
      const kind = args[0];
      if (!['runtime', 'cookie', 'download'].includes(kind)) throw new Error('bvr:invalid-input');
      const selected = await dialog.showOpenDialog(window, {
        properties: [kind === 'cookie' ? 'openFile' : 'openDirectory'],
        ...(kind === 'cookie' ? { filters: [{ name: 'Cookie', extensions: ['txt'] }] } : {}),
      });
      return selected.canceled ? null : selected.filePaths[0] ?? null;
    }
    case 'themeScene': {
      // Installed, validated scenes are also available for read-only appearance previews.
      return themePacks.scene(args[0]);
    }
    case 'themePoster': return themePacks.poster(args[0]);
    case 'capabilityMutate': {
      try { return await capabilityGate.run(async () => {
        markCapabilityPhase?.('idle-check');
        let refreshThemes = false;
        const result = await capabilityService.mutate(args[0], async policy => {
          refreshThemes = policy.scope === 'theme'
            || ['plugin-install', 'plugin-remove', 'plugin-update'].includes(args[0]?.action);
          const release = await capabilityGate.guard(policy, {
            assertAvailable: () => {
              if (settingsMutation || undoBusy || transition || updateInstalling || quitting || quitPending)
                throw new Error('Shared settings operation in progress');
            },
            acquireRuntime: () => {
              settingsMutation = true;
              return () => { settingsMutation = !capabilityService.runtimeAvailable; };
            },
            assertIdle: () => guardIdle({ stopHost: false, resources: true }),
            assertResource: async id => {
              markCapabilityPhase?.('resource-check');
              await assertPluginUnused(id, runtimes.workers.values());
            },
          });
          markCapabilityPhase?.('mutation');
          return release;
        });
        if (refreshThemes) {
          markCapabilityPhase?.('theme-refresh');
          await refreshThemePacks();
          window.webContents.send('runtime-event', { type: 'desktop_theme_packs', packs: themePacks.packs, preferences });
        }
        return result;
      }); } finally {
        emit({ type: 'desktop_plugin_catalog_changed' });
      }
    }
    case 'capabilityImportSkill': {
      await guardIdle({ stopHost: false });
      const selected = await dialog.showOpenDialog(window, { properties: ['openDirectory'],
        title: preferences.language === 'zh' ? '导入 Skill 文件夹' : 'Import Skill folder' });
      if (selected.canceled || !selected.filePaths[0]) return null;
      await guardIdle({ stopHost: false });
      return capabilityService.importSkill(selected.filePaths[0]);
    }
    case 'saveMcp': {
      await guardIdle(); const name = text(args[0], 80);
      if (!/^[a-zA-Z0-9_-]+$/.test(name)) throw new Error('Use letters, numbers, underscores or hyphens for the server name');
      const raw = args[1]; let config: Record<string, unknown> | null = null;
      if (raw !== null) {
        config = { enabled: raw.enabled !== false };
        if (raw.url) { const url = new URL(text(raw.url, 2048)); if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Invalid HTTP server URL'); config.url = url.href; config.command = undefined; config.args = undefined; }
        else { config.command = text(raw.command, 2048); if (!config.command) throw new Error('Command required'); if (!Array.isArray(raw.args) || raw.args.length > 100) throw new Error('Arguments must be an array'); config.args = raw.args.map((a: unknown) => text(a, 4096)); config.url = undefined; }
        if (raw.cwd) config.cwd = text(raw.cwd, 2048);
      }
      const secrets: Record<string, string> = {};
      if (args[2]) for (const [k, v] of Object.entries(args[2])) { if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(k)) throw new Error('Invalid environment name'); secrets[k] = text(v, 8192); }
      pluginHosts.invalidate();
      await admin.request('mcp', { name, config, secrets }); return null;
    }
    case 'preferences': {
      const patch = args[0] ?? {};
      const notificationPatch = notificationPreferencePatch(patch);
      const panelPatch = panelPreferencePatch(patch);
      const interfaceSettings = patch.interfaceSettings === undefined ? undefined : validateInterfaceSettings(patch.interfaceSettings);
      const colorPatch = themePreferencePatch(patch);
      const favoriteModels = patch.modelFavorite === undefined ? undefined
        : changeFavoriteModel(preferences.favoriteModels, patch.modelFavorite);
      const themeBrightness = themeBrightnessPatch(patch.themeBrightness);
      if (patch.themeMotion !== undefined && typeof patch.themeMotion !== 'boolean') throw new Error('Invalid theme motion');
      if (patch.appearance !== undefined) {
        if (!patch.appearance || typeof patch.appearance !== 'object' || Array.isArray(patch.appearance)) throw new Error('Invalid appearance settings');
        preferences.appearance = normalizeAppearance({ ...preferences.appearance, ...patch.appearance });
      }
      const updatePatch = updatePreferences(patch);
      if (patch.filePreviewWidth !== undefined) {
        if (patch.filePreviewWidth !== 'standard' && patch.filePreviewWidth !== 'wide') throw new Error('Invalid file preview width');
        preferences.filePreviewWidth = patch.filePreviewWidth;
      }
      const sidebarPatch = validateSidebarPreferences(patch, cachedSessions(), preferences.workspaces, pathKey);
      Object.assign(preferences, colorPatch);
      if (patch.themeMotion !== undefined) preferences.themeMotion = patch.themeMotion;
      if (themeBrightness !== undefined) preferences.themeBrightness = themeBrightness;
      if (['zh', 'en'].includes(patch.language)) preferences.language = patch.language;
      if (patch.workspaceNames !== undefined) {
        if (!patch.workspaceNames || typeof patch.workspaceNames !== 'object' || Array.isArray(patch.workspaceNames)) throw new Error('Invalid workspace names');
        const names: Record<string, string> = {};
        for (const [path, name] of Object.entries(patch.workspaceNames)) {
          if (!preferences.workspaces.some(workspace => pathKey(workspace) === pathKey(path))) throw new Error('Unknown workspace');
          names[pathKey(path)] = text(name, 100).trim();
        }
        preferences.workspaceNames = names;
      }
      if (patch.archivedSessionIds !== undefined) {
        if (!Array.isArray(patch.archivedSessionIds) || patch.archivedSessionIds.length > 10000) throw new Error('Invalid archive list');
        const known = new Set((await listSessions()).map(s => s.id));
        preferences.archivedSessionIds = patch.archivedSessionIds.map((id: unknown) => text(id, 200)).filter((id: string) => known.has(id));
      }
      Object.assign(preferences, sidebarPatch, updatePatch, panelPatch);
      if (interfaceSettings) preferences.interfaceSettings = interfaceSettings;
      const previousFavorites = preferences.favoriteModels;
      const previousNotifications = notificationPreferences(preferences);
      Object.assign(preferences, notificationPatch);
      if (favoriteModels) preferences.favoriteModels = favoriteModels;
      try { await savePreferences(); } catch (error) {
        if (favoriteModels && preferences.favoriteModels === favoriteModels) preferences.favoriteModels = previousFavorites;
        for (const key of Object.keys(notificationPatch) as (keyof typeof notificationPatch)[]) {
          if (preferences[key] === notificationPatch[key]) preferences[key] = previousNotifications[key];
        }
        throw error;
      }
      notifications.sync();
      window.setBackgroundColor(resolveTheme(preferences.theme, nativeTheme.shouldUseDarkColors, preferences.accentColor).tokens['--bg']);
      miniChat?.window?.setBackgroundColor(resolveTheme(preferences.theme, nativeTheme.shouldUseDarkColors, preferences.accentColor).tokens['--bg']);
      pluginWindows?.setBackground(resolveTheme(preferences.theme, nativeTheme.shouldUseDarkColors, preferences.accentColor).tokens['--bg']);
      emit({ type: 'desktop_preferences', preferences });
      updates.setChannel(preferences.updateChannel ?? 'preview');
      tray?.relabel();
      return preferences;
    }
    case 'copyText': {
      await clipboard.writeText(text(args[0], 2000000));
      return null;
    }
    case 'images': {
      const result = await dialog.showOpenDialog(window, { properties: ['openFile', 'multiSelections'], filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] }] });
      if (result.canceled) return [];
      if (result.filePaths.length > 5) throw new Error('Maximum 5 images');
      return Promise.all(result.filePaths.map(async path => { if ((await stat(path)).size > 10 * 1024 * 1024) throw new Error('Image exceeds 10 MiB'); return { type: 'image', mimeType: extname(path).toLowerCase() === '.png' ? 'image/png' : extname(path).toLowerCase() === '.webp' ? 'image/webp' : 'image/jpeg', data: (await readFile(path)).toString('base64') }; }));
    }
    case 'chooseAttachments': {
      const result = await dialog.showOpenDialog(originWindow(), { properties: ['openFile', 'multiSelections'] });
      if (result.canceled) return [];
      if (result.filePaths.length > MAX_ATTACHMENTS) throw new Error('Maximum 10 attachments');
      return Promise.all(result.filePaths.map(importAttachment));
    }
    case 'importFile': return importAttachment(text(args[0], 4096));
    case 'importClipboardImage': {
      const data = text(args[0], 14000000);
      if (!/^[A-Za-z0-9+/]*={0,2}$/.test(data)) throw new Error('Invalid image');
      const bytes = Buffer.from(data, 'base64');
      if (bytes.length > MAX_IMAGE_BYTES) throw new Error('Image exceeds 10 MiB');
      const mimeType = imageMime(bytes);
      if (!mimeType || mimeType !== args[1]) throw new Error('Unsupported image');
      return { kind: 'image', name: text(args[2], 255), content: { type: 'image', mimeType, data } };
    }
    case 'imageAction': {
      const action = args[0];
      if (!['copy', 'save', 'reveal'].includes(action)) throw new Error('Invalid image action');
      const { bytes, mimeType } = decodeImageUrl(args[1]);
      const image = nativeImage.createFromBuffer(bytes);
      if (image.isEmpty()) throw new Error('Invalid image');
      const name = imageFileName(text(args[2], 255), mimeType);
      if (action === 'copy') {
        await clipboard.write([new ClipboardItem({ 'image/png': new Blob([new Uint8Array(image.toPNG())], { type: 'image/png' }) })]);
        return true;
      }
      if (action === 'save') {
        const result = await dialog.showSaveDialog(originWindow(), {
          title: preferences.language === 'zh' ? '另存为' : 'Save As',
          defaultPath: name,
          filters: [{ name: preferences.language === 'zh' ? '图片' : 'Image', extensions: [mimeType === 'image/jpeg' ? 'jpg' : mimeType === 'image/webp' ? 'webp' : 'png'] }],
        });
        if (result.canceled || !result.filePath) return false;
        await writeFile(result.filePath, bytes);
      } else {
        // One reusable cache file per format, rather than an unbounded export archive.
        const cacheRoot = join(app.getPath('userData'), 'cache', 'image-previews');
        await mkdir(cacheRoot, { recursive: true });
        const path = join(cacheRoot, imageFileName('image-preview', mimeType));
        await writeFile(path, bytes);
        shell.showItemInFolder(path);
      }
      return true;
    }
    case 'diagnostics': {
      const result = await dialog.showSaveDialog(window, { defaultPath: 'step-desktop-diagnostics.json' });
      if (result.canceled || !result.filePath) return false;
      const manifest = JSON.parse(await readFile(join(runtimeRoot, 'manifest.json'), 'utf8'));
      await writeFile(result.filePath, JSON.stringify({ desktop: app.getVersion(), platform: process.platform, arch: process.arch, runtime: manifest, status: runtimes.active?.status ?? status }, null, 2)); return true;
    }
    default: throw new Error('Unknown desktop operation');
  }
}
app.on('will-quit', () => { notifications.dispose(); startupWindow?.destroy(); tray?.dispose(); tray = undefined; localPages.dispose(); updates.dispose(); installer.dispose(); });
app.on('before-quit', event => {
  speech.cancel();
  if (quitting) return;
  event.preventDefault();
  if (quitPending) return;
  quitPending = true;
  void (async () => {
    try {
      const reasons = quitReasons(runtimes, transition);
      if (!sessionEnding && needsQuitReview(reasons) && window && !window.isDestroyed()) {
        showMainWindow();
        if (window.webContents.isCrashed()) {
          const presentation = quitConfirmation(reasons, preferences.language);
          const result = await dialog.showMessageBox(window, {
            type: 'warning', message: presentation.title,
            detail: [...presentation.items.map(item => `${item.title}\n${item.description}`), ...presentation.notes].join('\n\n'),
            buttons: [preferences.language === 'zh' ? '取消退出' : 'Cancel quit', presentation.confirm],
            defaultId: 0, cancelId: 0, noLink: true,
          });
          if (result.response !== 1) { quitPending = false; return; }
        } else if (!await quitReview.ask(reasons)) { quitPending = false; return; }
      }
      await terminals.stopAll();
      await miniChat?.dispose();
      pluginWindows?.dispose();
      await sessionImports.close();
      await remote.shutdown();
      await Promise.all([runtimes.stopAll(), admin.stop(), capabilityService.stop(), collaboration.stop(), bvrBridge.stop(), pluginHosts.close()]);
      await conversationTiming.flush();
      await modelSelections.flush();
      await usageEstimates.flush();
      await workflowBindings.flush();
      browser?.dispose();
      quitting = true;
      app.quit();
    } catch {
      quitPending = false;
      quitReview.reset();
      if (!sessionEnding) showMainWindow();
      emit({ type: 'desktop_error', message: preferences.language === 'zh' ? '无法结束终端，请关闭终端后重试退出。' : 'Could not stop terminals. Close them and try exiting again.' });
    }
  })();
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('second-instance', showMainWindow);
app.on('activate', showMainWindow);
if (!app.requestSingleInstanceLock()) { quitting = true; app.quit(); }
else app.whenReady().then(async () => {
  if (!backgroundAcceptance || process.env.DESKTOP_TEST_STARTUP_WINDOW === '1')
    startupWindow = new StartupWindow(backgroundAcceptance, !app.isPackaged ? process.env.DESKTOP_DEV_URL : undefined);
  // Detect older profiles before startup creates runtime configuration or preferences.
  await firstRun.initialize();
  await mkdir(dataRoot, { recursive: true });
  await mkdir(join(dataRoot, 'sessions'), { recursive: true });
  await capabilityService.recover();
  await capabilityService.initialize();
  await collaboration.start();
  await bvrBridge.start();
  if (runtimeManifest.patches?.includes('desktop-plugin-host-launch')) await pluginHosts.start();
  // Load credentials before admin/rpc start so the migrated vault content reaches both;
  // vault.load() also migrates and removes a legacy plaintext auth.json. safeStorage
  // requires the ready state, which whenReady provides.
  authData = await vault.load();
  appliedAuthData = authData;
  await usageEstimates.initialize();
  await projectProviders(dataRoot, authData);
  crashLog.setPhase('vault loaded');
  try { preferences = { ...preferences, ...JSON.parse(await readFile(preferencesFile, 'utf8')) }; } catch {}
  preferences = migrateWorkspaceIdentity(preferences);
  Object.assign(preferences, normalizePanelPreferences(preferences));
  Object.assign(preferences, notificationPreferences(preferences));
  preferences.preferredModel = modelPreference(preferences.preferredModel);
  preferences.favoriteModels = normalizeFavoriteModels(preferences.favoriteModels);
  delete (preferences as Preferences & { recentModels?: unknown }).recentModels;
  preferences.interfaceSettings = normalizeInterfaceSettings(preferences.interfaceSettings);
  await refreshThemePacks();
  preferences.theme = normalizeTheme(preferences.theme);
  try { preferences.themeBrightness = themeBrightnessPatch(preferences.themeBrightness) ?? 90; }
  catch { preferences.themeBrightness = 90; }
  preferences.accentColor = normalizeAccent(preferences.accentColor) ?? null;
  preferences.updateChannel = preferences.updateChannel === 'stable' ? 'stable' : 'preview';
  preferences.autoCheckUpdates = preferences.autoCheckUpdates !== false;
  updates.setChannel(preferences.updateChannel);
  try { await writeFile(join(dataRoot, 'config.toml'), 'permissionPreset = "ask"\n[telemetry]\nenabled = false\n', { flag: 'wx' }); } catch (e: any) { if (e.code !== 'EEXIST') throw e; }
  admin.start(nodePath, join(runtimeRoot, 'admin.mjs'), dataRoot, authEnvironment());
  crashLog.setPhase('admin started');
  // Reconcile full TOML declarations inside the admin settings lock. The qualified
  // plugin identity prevents duplicate discovery; relocation must retain explicit disable.
  try {
    const desktopBundle = (await stepPage.snapshot()).installed;
    const rejectedBundlePath = !desktopBundle && existsSync(stepPage.bundlePath) ? stepPage.bundlePath : undefined;
    const steppageBundle = process.env.DESKTOP_STEPPAGE_BUNDLE?.trim()
      || (desktopBundle || rejectedBundlePath || process.platform !== 'win32' ? stepPage.bundlePath : join(homedir(), '.steppage-mcp', 'bin', 'steppage-mcp.mjs'));
    await admin.request('reconcile_steppage', { bundlePath: steppageBundle, rejectedBundlePath,
      ...(steppageBundle === stepPage.bundlePath ? { homePath: stepPage.homePath } : {}) });
  } catch {
    // Registration failure must not prevent launching the rest of Desktop.
  }
  session.defaultSession.setPermissionCheckHandler((contents, permission, _origin, details) =>
    Boolean(window && contents === window.webContents && permission === 'media' && details.mediaType === 'audio' && speech.allowMicrophone()));
  session.defaultSession.setPermissionRequestHandler((contents, permission, callback, details) =>
    callback(Boolean(window && contents === window.webContents && details.isMainFrame && permission === 'media'
      && 'mediaTypes' in details && details.mediaTypes?.length === 1 && details.mediaTypes[0] === 'audio' && speech.allowMicrophone())));
  // The renderer cannot read the Windows dark mode reliably: prefers-color-scheme
  // stays light inside this packaged renderer even on a dark system, so the main
  // process owns the resolved theme. The preload asks for it synchronously before
  // the first paint; the renderer re-resolves on preference and system changes.
  const resolvedColors = () => resolveTheme(preferences.theme, nativeTheme.shouldUseDarkColors, preferences.accentColor);
  const resolvedTheme = () => resolvedColors().scheme;
  ipcMain.on('desktop:resolved-theme', event => {
    const colors = resolvedColors();
    event.returnValue = { theme: colors.scheme, palette: colors.id, tokens: colors.tokens,
      preference: preferences.theme, accentColor: preferences.accentColor, systemDark: nativeTheme.shouldUseDarkColors,
      themePacks: themePacks.packs, themeMotion: preferences.themeMotion, themeBrightness: preferences.themeBrightness };
  });
  // The authoritative system value, re-read by the renderer after it subscribes
  // to theme events: a change that lands before that subscription is dropped,
  // and this query is what corrects the startup snapshot.
  ipcMain.handle('desktop-system-theme', event => {
    if (!miniChat?.owns(event) && !pluginWindows?.owner(event) && (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame)) throw new Error('Untrusted sender');
    return { systemDark: nativeTheme.shouldUseDarkColors };
  });
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => callback({ responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': ["default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' ws://127.0.0.1:*; object-src 'none'; frame-src 'none'"] } }));
  window = new BrowserWindow({ width: 1320, height: 880, minWidth: 640, minHeight: 540, title: 'Desktop for Step Code', icon: app.isPackaged ? join(process.resourcesPath, process.platform === 'darwin' ? 'icon.png' : 'icon.ico') : resolve(process.platform === 'darwin' ? 'build/icon.png' : 'build/icon.ico'), frame: process.platform === 'darwin', ...(process.platform === 'darwin' ? { titleBarStyle: 'hiddenInset' as const, trafficLightPosition: { x: 20, y: 19 } } : {}), backgroundColor: resolvedColors().tokens['--bg'], autoHideMenuBar: true, show: false, focusable: !backgroundAcceptance, webPreferences: { preload: join(__dirname, 'preload.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true, ...(backgroundAcceptance ? { backgroundThrottling: false } : {}) } });
  watchComposerWindow(window);
  miniChat = new MiniChatWindow({
    preload: join(__dirname, 'preload.cjs'), file: join(__dirname, 'renderer/index.html'),
    devUrl: !app.isPackaged ? process.env.DESKTOP_DEV_URL : undefined,
    stateFile: join(app.getPath('userData'), 'mini-chat-window.json'),
    background: () => resolvedColors().tokens['--bg'], noFocus: backgroundAcceptance,
    changed: state => emit({ type: 'desktop_mini_chat', state }),
    error: error => { void crashLog.record('mini-chat-window', error); },
    created: view => {
      watchComposerWindow(view);
      view.on('focus', () => notifications.sync());
    },
  });
  pluginWindows = new PluginWindows({
    preload: join(__dirname, 'preload.cjs'), file: join(__dirname, 'renderer/index.html'),
    devUrl: !app.isPackaged ? process.env.DESKTOP_DEV_URL : undefined,
    background: () => resolvedColors().tokens['--bg'], noFocus: backgroundAcceptance,
    openExternal: url => shell.openExternal(url),
  });
  let shellShown = false;
  const revealShell = () => {
    if (shellShown || quitting || window.isDestroyed()) return;
    shellShown = true;
    clearTimeout(shellFallback);
    const show = () => { if (!quitting && !window.isDestroyed() && !backgroundAcceptance) window.show(); };
    if (startupWindow) startupWindow.finish(show);
    else show();
  };
  const shellFallback = setTimeout(revealShell, 10000);
  window.once('closed', () => { clearTimeout(shellFallback); startupWindow?.destroy(); });
  ipcMain.on('desktop:shell-ready', event => {
    if (event.sender === window.webContents && event.senderFrame === window.webContents.mainFrame) revealShell();
  });
  window.webContents.on('did-fail-load', (_event, code, _description, _url, isMainFrame) => {
    if (isMainFrame && code !== -3) revealShell();
  });
  window.webContents.on('render-process-gone', revealShell);
  window.webContents.on('render-process-gone', () => quitReview.reset());
  nativeTheme.on('updated', () => {
    tray?.relabel();
    if (window && !window.isDestroyed()) {
      window.setBackgroundColor(resolvedColors().tokens['--bg']);
      miniChat?.window?.setBackgroundColor(resolvedColors().tokens['--bg']);
      pluginWindows?.setBackground(resolvedColors().tokens['--bg']);
      emit({ type: 'desktop_system_theme', dark: nativeTheme.shouldUseDarkColors });
    }
  });
  crashLog.setPhase('window created');
  browser = new BrowserTabs(window, event => {
    if (!window.isDestroyed()) window.webContents.send('browser-event', event);
  }, () => preferences.language);
  const windowState = () => window.webContents.send('runtime-event', { type: 'desktop_window_state', maximized: window.isMaximized(), fullscreen: window.isFullScreen(), focused: window.isFocused() });
  window.on('maximize', windowState);
  window.on('unmaximize', windowState);
  window.on('enter-full-screen', windowState);
  window.on('leave-full-screen', windowState);
  window.on('focus', windowState);
  window.on('focus', () => notifications.sync());
  window.on('blur', windowState);
  window.on('hide', () => speech.cancel());
  window.webContents.setWindowOpenHandler(({ url }) => { try { const u = new URL(url); if (['https:', 'http:'].includes(u.protocol)) void shell.openExternal(u.href); } catch {} return { action: 'deny' }; });
  window.webContents.on('will-navigate', event => event.preventDefault());
  try {
    tray = new DesktopTray(app.isPackaged ? join(process.resourcesPath, process.platform === 'darwin' ? 'tray.png' : 'icon.ico') : resolve(process.platform === 'darwin' ? 'build/tray.png' : 'build/icon.ico'),
      () => preferences.language, showMainWindow, () => app.quit(), {
        theme: resolvedTheme, colors: resolvedColors, quitting: () => quitting, noFocus: backgroundAcceptance,
        devUrl: !app.isPackaged ? process.env.DESKTOP_DEV_URL : undefined,
        onError: error => { void crashLog.record('tray-menu', error); },
      });
  } catch (error) { void crashLog.record('tray-creation', error); }
  window.on('close', event => {
    if (quitting) return;
    event.preventDefault();
    if (tray && !sessionEnding) window.hide();
    else app.quit();
  });
  window.on('session-end', () => {
    sessionEnding = true;
    const request = quitReview.state.request;
    if (request?.phase === 'review') quitReview.respond(request.id, true);
    app.quit();
  });
  ipcMain.handle('desktop', async (event, method, ...args) => {
    const pluginOwner = pluginWindows?.owner(event);
    if (pluginOwner) {
      if (!pluginWindowMethodAllowed(method, args, pluginOwner.ref)) throw new Error('capability:invalid-input');
      // Plugin windows receive no conversation snapshots or runtime mutation APIs.
      if (method === 'windowControl') {
        const view = pluginOwner.window;
        if (args[0] === 'minimize') view.minimize();
        if (args[0] === 'toggleMaximize') view.isMaximized() ? view.unmaximize() : view.maximize();
        if (args[0] === 'close') view.close();
        return view.isDestroyed() ? { maximized: false, fullscreen: false, focused: false }
          : { maximized: view.isMaximized(), fullscreen: view.isFullScreen(), focused: view.isFocused() };
      }
      if (quitting || settingsMutation) throw new Error('capability:busy');
      const plugin = await capabilityService.desktop(pluginOwner.ref);
      if (method === 'pluginWindowState') return { plugin, preferences: {
        language: preferences.language, theme: preferences.theme, accentColor: preferences.accentColor,
        appearance: preferences.appearance,
      } };
      if (method === 'pluginWindowConfigure') {
        showMainWindow();
        window.webContents.send('runtime-event', { type: 'desktop_main_action', action: 'plugins',
          payload: { page: 'plugins', pluginId: plugin.id, detail: 'config' } });
        return;
      }
      return capabilityService.document(args[0]);
    }
    const surface: Surface = miniChat?.owns(event) ? 'mini' : 'main';
    if (surface === 'main' && (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame)) throw new Error('Untrusted sender');
    if (surface === 'mini' && !miniMethods.has(method)) throw new Error('Return to the main window for this operation');
    const senderId = event.sender.id, generation = rendererGenerations.get(senderId);
    const execute = () => diagnoseCapabilityMutation(method, args[0], async markCapabilityPhase => {
      if (method === 'quitRespond' || method === 'windowControl') return handle(method, args, surface);
      // Reads must not observe the admin transport halfway through an idle reload.
      if (providerApplication) await providerApplication;
      const capabilityMutation = ['capabilityMutate', 'capabilityImportSkill', 'bvrSaveConfiguration', 'pluginSaveConfiguration', 'pluginSaveHostSettings', 'saveCompactionSettings'].includes(method);
      const capabilityRead = ['capabilityCatalog', 'pluginDocument', 'pluginRepositoryInfo', 'pluginConfiguration', 'pluginHostSettings', 'pluginWindowOpen',
        'pluginChoosePath', 'themeScene', 'themePoster', 'bvrConfiguration', 'bvrCheckEnvironment', 'bvrChoosePath'].includes(method);
      // CapabilityService selects its trusted scope after freezing the package.
      // Discovery network work and data-only themes must not block Remote I/O.
      const shared = capabilityMutation && method !== 'capabilityMutate'
        || ['login', 'logout', 'saveMcp', 'saveProvider', 'deleteProvider', 'prepareStepPage', 'finishFirstRun'].includes(method);
      if ((shared || method === 'capabilityMutate') && speechSaving) throw new Error('Speech settings operation in progress');
      if ((shared || method === 'capabilityMutate') && capabilityGate.active)
        throw new Error('Shared settings operation in progress');
      if ((shared || method === 'capabilityMutate') && !capabilityService.available)
        throw new Error('capability:management-unavailable');
      if (capabilityMutation && (settingsMutation || undoBusy || transition || updateInstalling || quitting || quitPending))
        throw new Error('Shared settings operation in progress');
      if (undoBusy && ['moveSessionToProject', 'prepareStepPage', 'removeWorkspace', 'relocateWorkspace', 'beginSession', 'chooseSessionProject', 'createDraftSession', 'command', 'branchSession', 'cloneSession', 'retryMessage', 'restart', 'workspace', 'chooseWorkspace',
        'switchSession', 'navigateSession', 'newIndependentSession', 'deleteSession', 'deleteArchivedSessions', 'login', 'logout', 'saveMcp', 'saveProvider', 'deleteProvider'].includes(method))
        throw new Error('Undo in progress');
      if (settingsMutation && ['moveSessionToProject', 'prepareStepPage', 'removeWorkspace', 'relocateWorkspace', 'beginSession', 'chooseSessionProject', 'createDraftSession', 'command', 'branchSession', 'cloneSession', 'retryMessage', 'restart', 'workspace', 'chooseWorkspace', 'switchSession', 'navigateSession', 'newIndependentSession', 'login', 'logout', 'saveMcp', 'saveProvider', 'deleteProvider', 'finishFirstRun'].includes(method)) throw new Error('Shared settings operation in progress');
      const speechOperation = ['speechSettings', 'saveSpeech', 'acknowledgeSpeech', 'beginSpeech', 'transcribeSpeech', 'finishSpeech', 'cancelSpeech'].includes(method);
      if (!capabilityRead && !speechOperation && method !== 'capabilityMutate' && !updateInstalling && providerSettingsPending && !settingsMutation && canApplyProviders()) {
        await applyProviderSettings();
      }
      if (rendererGenerations.get(senderId) !== generation) throw new Error('Window reloaded; retry the current action');
      if (surface === 'main' && (shared || ['settings', 'beginSession', 'chooseSessionProject', 'createDraftSession',
        'navigateSession', 'switchSession', 'newIndependentSession', 'workspace', 'chooseWorkspace', 'restart',
        'miniChatOpen', 'miniChatReturn'].includes(method))) speech.cancel();
      if (shared && miniNavigation.busy) throw new Error('MiniChat conversation is opening');
      if (shared) settingsMutation = true;
      try { return await handle(method, args, surface, markCapabilityPhase); }
      catch (error) {
        const failure = new Error(error instanceof Error ? error.message : 'Desktop operation failed');
        if (method === 'capabilityMutate') Object.assign(failure, { details: capabilityFailureDetails(error) });
        throw failure;
      }
      finally {
        if (shared) settingsMutation = !capabilityService.runtimeAvailable;
        if (shared || method === 'capabilityMutate') await pluginHosts.resumeDeferred();
      }
    }, (error, details) => crashLog.record('capability-operation', error, details));
    if (method === 'command' && args[0] === 'prompt' && args[1]?.composerReceipt !== undefined) {
      const worker = runtimes.workers.get(args[2] ?? selectedRuntime(surface)!);
      return composers.submit(text(args[1].composerReceipt, 80), worker?.state?.sessionId ? { sessionId: worker.state.sessionId } : undefined, execute);
    }
    return execute();
  });
  {
    startup = (async () => {
      const initialDraft = sessionDraft;
      try {
        await beginSession(preferences.workspaces.find(path => pathKey(path) === pathKey(preferences.workspace ?? '')));
      } catch (error) {
        if (sessionDraft === initialDraft) sessionDraft = undefined;
        status = 'disconnected';
        await runtimes.stopAll();
        startupError = error instanceof Error ? error.message : 'Could not start an independent session';
        await crashLog.record('startup-failure', error, (error as { details?: Record<string, unknown> }).details ?? {});
      }
    })();
  }
  void startup.then(async () => {
    if (!quitting && !quitPending && !updateInstalling) { await listSessions(); await remote.resume(); }
  }).catch(() => {});
  void startup.then(() => tryAutomaticCron());
  if (process.env.DESKTOP_DEV_URL && !app.isPackaged) await window.loadURL(process.env.DESKTOP_DEV_URL);
  else await window.loadFile(join(__dirname, 'renderer/index.html'));
  if (restoreRequested) { restoreRequested = false; showMainWindow(); }
  if (process.platform === 'darwin' && app.isPackaged) {
    const updateResult = await acknowledgeMacUpdate(updateRoot, macAppTarget(), updateVersion);
    if (updateResult === 'rolled-back' || updateResult === 'recovery-required') void dialog.showMessageBox(window, {
      type: 'warning', message: preferences.language === 'zh' ? '更新未完成' : 'Update did not complete',
      detail: preferences.language === 'zh' ? '新版本未能启动，已尝试恢复原版本。请在发布页下载安装；系统安全提示和应用目录权限可能阻止替换。会话和设置保留。'
        : 'The new version did not start. Recovery was attempted. Download from Releases and check system security prompts and application-folder permissions. Sessions and settings are retained.',
    });
  }

  // Update checks are independent of runtime/model startup and never block first paint.
  if (['win32', 'darwin'].includes(process.platform) && app.isPackaged && !backgroundAcceptance) {
    const check = () => { if (!quitting && preferences.autoCheckUpdates !== false) void updates.check(); };
    setTimeout(check, 10_000).unref();
    setInterval(check, 6 * 60 * 60 * 1000).unref();
  }
}).catch(async error => {
  startupWindow?.destroy();
  await crashLog.record('startup-failure', error, (error as { details?: Record<string, unknown> }).details ?? {});
  if (!backgroundAcceptance) dialog.showErrorBox('Desktop for Step Code', String(error));
  quitting = true; void Promise.all([remote.shutdown(), sessionImports.close(), runtimes.stopAll(), admin.stop(), capabilityService.stop(), collaboration.stop(), terminals.stopAll(), pluginHosts.close()]).finally(() => app.quit());
});
