import { app, BrowserWindow, dialog, ipcMain, shell, session, net, clipboard, ClipboardItem, nativeImage, nativeTheme, Menu } from 'electron';
import { join, resolve, extname, basename } from 'node:path';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile, rename, realpath, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { RpcProcess, isolatedEnvironment } from './runtime';
import { SessionRuntimes, firstUserText } from './session-runtimes';
import { SessionCollaboration } from './session-collaboration';
import { PendingMessages } from './pending-messages';
import { normalizeAppearance } from '../src/appearance';
import { ConversationTiming } from './conversation-timing';
import { AuthVault } from './auth-vault';
import { installCrashLog } from './crash-log';
import { permissionPresets } from './permission-status';
import { TurnUndoStore } from './turn-undo';
import { repositoryDiff, repositoryFileDiff } from './repository-diff';
import { sessionSummary } from './session-summary';
import { TerminalSessions } from './terminal-sessions';
import { BrowserTabs } from './browser-tabs';
import { linkPreview } from './link-preview';
import { artifactFile } from './artifact-files';
import { FilePreviews, fileMode, canOpenExternally, readPreview } from './file-previews';
import { LocalPagePreview } from './local-page-preview';
import { associationRequest, fileApplications } from './file-applications';
import { AppUpdates, updatePreferences } from './app-updates';
import { DesktopTray } from './desktop-tray';
import type { FileTarget, FileDestination, FileOpenResult, FileOpeningOptions } from '../src/contracts';
import type { BrowserAction } from '../src/contracts';
import { conversationEntries } from '../src/conversation-presentation';
import { turnChanges } from '../src/turn-changes';
import type { Model, PermissionPreset, Preferences, Session, Snapshot } from '../src/contracts';
import { validateSidebarPreferences } from '../src/sidebar-order';
import { archivedDeletionTargets, deleteManagedSessionFile, managedSessionFile } from './session-deletion';
import { decodeImageUrl, imageFileName, fileReferenceMessage, imageMime, MAX_ATTACHMENTS, MAX_FILE_BYTES, MAX_IMAGE_BYTES, MAX_IMAGES } from './attachment-utils';

app.setName('Desktop for Step Code');
app.setAppUserModelId('community.stepcode.desktop');
if (process.env.DESKTOP_TEST_USER_DATA) app.setPath('userData', resolve(process.env.DESKTOP_TEST_USER_DATA));
const backgroundAcceptance = process.env.DESKTOP_TEST_NO_FOCUS === '1' && Boolean(process.env.DESKTOP_TEST_USER_DATA);
const crashLog = installCrashLog();
const conversationTiming = new ConversationTiming(join(app.getPath('userData'), 'conversation-timing'),
  error => { void crashLog.record('conversation-timing', error); });
let window: BrowserWindow;
let browser: BrowserTabs | undefined;
const filePreviews = new FilePreviews(id => runtimes.require(id).cwd);
const localPages = new LocalPagePreview();
const localFileGrants = new Map<string, string>();
const fileAssociationScript = () => join(app.isPackaged ? join(process.resourcesPath, 'file-opening') : join(__dirname, 'file-opening'), 'file-associations.ps1');
let preferences: Preferences = { theme: 'system', language: 'zh', workspaces: [] };
const updates = new AppUpdates(app.getVersion(), (url, options) => net.fetch(url, options),
  state => { if (window && !window.isDestroyed()) window.webContents.send('app-update', state); }, () => Date.now());
let status = 'disconnected';
let transition = false;
let settingsMutation = false;
let deletingArchived = false;
let quitting = false;
let quitPending = false;
let tray: DesktopTray | undefined;
let sessionEnding = false;
let restoreRequested = false;
function showMainWindow() {
  if (!window || window.isDestroyed()) { restoreRequested = true; return; }
  if (window.isMinimized()) window.restore();
  window.show();
  if (!backgroundAcceptance) window.focus();
}
let startup: Promise<void> = Promise.resolve();
let startupError: string | undefined;
let sessionDraft: { id: string; workspace?: string; model?: Model; models?: Model[]; thinkingLevel?: string;
  permissionPreset?: PermissionPreset; modelChanged?: boolean; permissionChanged?: boolean; thinkingChanged?: boolean } | undefined = { id: randomUUID() };
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
const independentRoot = join(app.getPath('userData'), 'workspaces', 'independent');
const pathKey = (path: string) => resolve(path).replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
async function samePath(a: string, b: string) {
  if (pathKey(a) === pathKey(b)) return true;
  try {
    const [left, right] = await Promise.all([stat(a, { bigint: true }), stat(b, { bigint: true })]);
    if (left.dev === right.dev && left.ino !== 0n && left.ino === right.ino) return true;
  } catch {}
  try { return pathKey(await realpath(a)) === pathKey(await realpath(b)); }
  catch { return false; }
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
const nodePath = join(runtimeRoot, 'node/node.exe');
const terminals = new TerminalSessions(nodePath,
  app.isPackaged ? join(process.resourcesPath, 'terminal-runtime/host.cjs') : resolve('terminal-runtime/host.cjs'),
  event => { if (window && !window.isDestroyed()) window.webContents.send('terminal-event', event); });
crashLog.setPhase('runtime staged');
const env = isolatedEnvironment(dataRoot);
const vault = new AuthVault(dataRoot);
let authData: Record<string, unknown> = {};
const authEnvironment = () => ({
  ...env,
  STEPCODE_DESKTOP_AUTH_PATH: env.STEPCODE_AUTH_PATH,
  STEPCODE_DESKTOP_AUTH_DATA: JSON.stringify(authData),
});
async function persistAuth(next: Record<string, unknown>) {
  try { await vault.save(next); }
  catch (error) {
    await admin.stop();
    admin.start(nodePath, join(runtimeRoot, 'admin.mjs'), dataRoot, authEnvironment());
    throw error;
  }
  authData = next;
}
const emit = (event: unknown) => { if (window && !window.isDestroyed()) window.webContents.send('runtime-event', event); };
const runtimes: SessionRuntimes = new SessionRuntimes(event => {
  const queueWorker = runtimes.workers.get(event.runtimeId);
  const consumed = queueWorker && event.type === 'message_start' && event.message?.role === 'user'
    && pendingMessages.delivered(queueWorker, event.message.content, event.message.timestamp, false);
  if (queueWorker && event.message?.role === 'user') {
    event.message = pendingMessages.decorate(queueWorker, event.message);
    queueWorker.messages = queueWorker.messages.map(message => pendingMessages.decorate(queueWorker, message));
  }
  if (event.type === 'agent_end') {
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
  // Deliver the authoritative message before publishing the newer queue revision.
  if (consumed) pendingMessages.publish(queueWorker!);
  if (queueWorker && event.type === 'agent_end') pendingMessages.completed(queueWorker);
}, undefined, {
  event: (worker, event) => conversationTiming.event(worker, event),
  messages: (worker, messages) => worker.state?.sessionId ? conversationTiming.decorate(worker.state.sessionId, messages) : Promise.resolve(messages),
  launch: worker => collaboration.attach(worker),
  dispose: worker => {
    conversationTiming.event(worker, { type: 'desktop_exit' });
    collaboration.detach(worker);
    if (worker.status === 'disconnected' && worker.queued) pendingMessages.recover(worker);
    else pendingMessages.clear(worker);
  },
});
const pendingMessages = new PendingMessages(worker => {
  worker.revision++;
  emit({ type: 'desktop_queue', runtimeId: worker.id, runtimeRevision: worker.revision, pendingMessages: pendingMessages.list(worker) });
  runtimes.publish();
}, (worker, error) => emit({ type: 'desktop_error', runtimeId: worker.id, message: String(error instanceof Error ? error.message : error) }),
  (message, files) => files.length ? fileReferenceMessage(message, files, preferences.language) : message);
const collaboration: SessionCollaboration = new SessionCollaboration(runtimes, join(runtimeRoot, 'desktop-sessions.mjs'), () => preferences.language);
setInterval(() => { if (!transition) void runtimes.recycle().catch(error => crashLog.record('runtime-recycle', error)); }, 60000).unref();
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
let sessionCatalog: Session[] = [];
// Upstream spawns one real session per subagent so it can resume the child transcript.
// Those are an implementation detail of the subagent feature, not sessions the user opened,
// so they are kept out of the Desktop session list. The files stay on disk.
const SUBAGENT_SESSION_PREFIX = 'subagent-';
async function listSessions(): Promise<Session[]> {
  const upstream: Session[] = await admin.request('sessions');
  const sessions: Session[] = upstream
    .filter(session => !String(session.id ?? '').startsWith(SUBAGENT_SESSION_PREFIX));
  // Empty upstream sessions are persisted lazily, but must remain navigable.
  for (const worker of runtimes.workers.values()) {
    const id = worker.state?.sessionId;
    if (id && !sessions.some(session => session.id === id)) sessions.unshift({
      id, path: worker.state?.sessionFile ?? '', cwd: worker.cwd,
      name: worker.state?.sessionName, firstMessage: firstUserText(worker.messages), modified: new Date(worker.touched).toISOString(), messageCount: worker.messages.length,
    });
  }
  sessionCatalog = await Promise.all(sessions.map(async s => {
    const workspacePath = await sessionWorkspacePath(s.cwd);
    return { ...s, workspacePath, independent: !workspacePath };
  }));
  return sessionCatalog;
}
function cachedSessions(): Session[] {
  const sessions = new Map(sessionCatalog.map(session => [session.id, { ...session }]));
  for (const worker of runtimes.workers.values()) {
    const id = worker.state?.sessionId;
    if (!id) continue;
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
async function snapshot(worker = runtimes.active, refresh = true): Promise<Snapshot> {
  const draft = sessionDraft;
  if (draft) worker = undefined;
  if (refresh && worker?.status === 'connected') await runtimes.read(worker);
  const sessions = refresh ? await listSessions() : cachedSessions();
  return {
    preferences: { ...preferences, workspace: draft ? draft.workspace : worker?.cwd ?? preferences.workspace },
    status: draft ? 'ready' : worker?.status ?? status, draftId: draft?.id, runtimeId: worker?.id, runtimes: runtimes.summaries(), unreadSessionIds: [...runtimes.unreadSessionIds],
    state: draft ? { isStreaming: false, model: draft.model, thinkingLevel: draft.thinkingLevel } : worker?.state,
    permissionPreset: draft?.permissionPreset ?? worker?.permissionPreset, runtimeRevision: worker?.revision,
    messages: worker ? worker.messages.map(message => pendingMessages.decorate(worker, message)) : [], models: draft?.models ?? worker?.models ?? [], stats: worker?.stats,
    pendingMessages: worker ? pendingMessages.list(worker) : [],
    requests: worker ? [...worker.pendingUI.values()] : [],
    sessions, independent: draft ? !draft.workspace : !worker || !(await sessionWorkspacePath(worker.cwd)),
  };
}
async function guardIdle() {
  if (transition) throw new Error('Workspace operation in progress');
  await runtimes.assertAllIdle();
}
async function connect(cwd: string, sessionPath?: string, rememberProject = true) {
  if (transition) throw new Error('Workspace operation in progress');
  transition = true;
  try {
    const canonical = await realpath(cwd);
    if (!(await stat(canonical)).isDirectory()) throw new Error('Workspace is not a directory');
    status = 'connecting';
    const worker = await runtimes.open(nodePath, join(runtimeRoot, 'step/dist/bundle/step.js'), canonical, authEnvironment(), sessionPath);
    sessionDraft = undefined;
    preferences.workspace = canonical;
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
    return await snapshot(worker);
  } catch (error) { status = runtimes.active?.status ?? 'disconnected'; throw error; }
  finally { transition = false; }
}
async function newIndependentSession() {
  const cwd = join(independentRoot, randomUUID());
  await mkdir(cwd, { recursive: true });
  return connect(cwd, undefined, false);
}
async function beginSession(workspace?: string) {
  if (transition || deletingArchived) throw new Error('Workspace operation in progress');
  const selected = workspace === undefined ? undefined
    : preferences.workspaces.find(path => pathKey(path) === pathKey(workspace));
  if (workspace !== undefined && !selected) throw new Error('Unknown workspace');
  transition = true;
  try {
    const previous = sessionDraft;
    const options = await admin.request('session_options', { cwd: selected ?? app.getPath('documents') });
    const next: NonNullable<typeof sessionDraft> = { id: previous?.id ?? randomUUID(), workspace: selected, ...options,
      permissionPreset: previous?.permissionPreset ?? options.permissionPreset, permissionChanged: previous?.permissionChanged };
    if (previous?.modelChanged) Object.assign(next, { model: previous.model, modelChanged: true });
    if (previous?.thinkingChanged && next.model?.thinkingLevels?.includes(previous.thinkingLevel!))
      Object.assign(next, { thinkingLevel: previous.thinkingLevel, thinkingChanged: true });
    sessionDraft = next;
    // Keep existing workers running, but none is being viewed on the draft page.
    runtimes.activeId = undefined;
    runtimes.publish();
    await runtimes.recycle();
    return await snapshot(undefined, false);
  } finally { transition = false; }
}
const text = (value: unknown, max = 100000): string => { if (typeof value !== 'string' || value.length > max) throw new Error('Invalid text'); return value; };
async function handle(method: string, args: any[]) {
  if (method === 'linkPreview') return linkPreview(args[0]);
  switch (method) {
    case 'updateState': return updates.snapshot();
    case 'checkUpdates': return updates.check();
    case 'openUpdate': return shell.openExternal(updates.openTarget(args[0]));
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
        await associationRequest(fileAssociationScript(), { action: 'other', path: file.path,
          window: window.getNativeWindowHandle().readBigUInt64LE().toString() }, 300000);
      } else if (destination.startsWith('app:')) {
        const apps = await fileApplications(fileAssociationScript(), extname(file.path));
        if (!apps.some(item => item.id === destination)) throw new Error('Unknown associated application');
        await associationRequest(fileAssociationScript(), { action: 'open', path: file.path, id: destination.slice(4) });
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
        choices.push(...await fileApplications(fileAssociationScript(), extname(file.path)));
        choices.push({ id: 'other', label: zh ? '选择其他应用…' : 'Choose another app…' });
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
    case 'beginSession': return beginSession(args[0] === undefined ? undefined : text(args[0], 2048));
    case 'chooseSessionProject': {
      if (transition || deletingArchived) throw new Error('Workspace operation in progress');
      const result = await dialog.showOpenDialog(window, { properties: ['openDirectory'] });
      if (result.canceled) return null;
      if (transition || deletingArchived) throw new Error('Workspace operation in progress');
      const canonical = await realpath(result.filePaths[0]);
      if (!(await stat(canonical)).isDirectory()) throw new Error('Workspace is not a directory');
      const existing = (await Promise.all(preferences.workspaces.map(async path => await samePath(path, canonical) ? path : undefined))).find(Boolean);
      if (!existing) { preferences.workspaces = [...preferences.workspaces, canonical]; await savePreferences(); }
      return beginSession(existing ?? canonical);
    }
    case 'createDraftSession': {
      if (!sessionDraft || sessionDraft.id !== text(args[0], 80)) throw new Error('This session draft is no longer active');
      const draft = sessionDraft;
      const created = await (draft.workspace ? connect(draft.workspace) : newIndependentSession());
      try {
        if (draft.modelChanged && draft.model) await handle('command', ['set_model', { provider: draft.model.provider, modelId: draft.model.id }, created.runtimeId]);
        if (draft.thinkingChanged) await handle('command', ['set_thinking_level', { level: draft.thinkingLevel }, created.runtimeId]);
        if (draft.permissionChanged) await handle('command', ['set_permission_preset', { preset: draft.permissionPreset }, created.runtimeId]);
        return await snapshot(runtimes.require(created.runtimeId));
      } catch (error) {
        const worker = created.runtimeId && runtimes.workers.get(created.runtimeId);
        if (worker && !worker.messages.length && !runtimes.isBusy(worker)) {
          await runtimes.remove(worker);
          sessionDraft = draft;
          runtimes.activeId = undefined;
        }
        throw error;
      }
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
        return browser!.openLocal(page.url, file.path, page.origin);
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
    case 'summary': {
      const worker = runtimes.require(text(args[0], 80));
      const sessionId = worker.state?.sessionId;
      if (!sessionId) throw new Error('Session is not ready');
      const result = await worker.rpc.request('get_desktop_summary');
      if (runtimes.workers.get(worker.id) !== worker || worker.state?.sessionId !== sessionId) throw new Error('Session changed');
      return sessionSummary(result, sessionId);
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
        JSON.stringify(turnChanges(entry.items).files.flatMap(file => file.edits.map(edit => edit.id))) === JSON.stringify(args[1]));
      if (entry?.type !== 'response' || !worker.state?.sessionId) throw new Error('Turn not found');
      const sessionId = worker.state.sessionId;
      if (action === 'status') return undoStore.status(sessionId, worker.cwd, entry.items);
      if (worker.permissionPreset === 'read-only') throw new Error('Read-only session cannot undo files');
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
    case 'windowControl': {
      switch (args[0]) {
        case 'state': break;
        case 'minimize': window.minimize(); break;
        case 'toggleMaximize': window.isMaximized() ? window.unmaximize() : window.maximize(); break;
        case 'close': window.close(); break;
        case 'quit': app.quit(); break;
        default: throw new Error('Unsupported window action');
      }
      return { maximized: window.isMaximized() };
    }
    case 'snapshot': {
      await startup;
      if (startupError) { emit({ type: 'desktop_error', message: startupError }); startupError = undefined; }
      return snapshot();
    }
    case 'sessions': return listSessions();
    case 'newIndependentSession': await startup; return newIndependentSession();
    case 'openSessionFolder': {
      if (!preferences.workspace) throw new Error('No active working directory');
      const error = await shell.openPath(preferences.workspace);
      if (error) throw new Error(error);
      return null;
    }
    case 'openWorkspaceFolder': {
      const target = text(args[0], 2048);
      if (!preferences.workspaces.some(path => pathKey(path) === pathKey(target))) throw new Error('Unknown workspace');
      const error = await shell.openPath(target);
      if (error) throw new Error(error);
      return null;
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
      const { cwd, state } = worker;
      transition = true;
      try { await runtimes.assertIdle(worker); await runtimes.remove(worker); }
      finally { transition = false; }
      return connect(cwd, state?.sessionFile && existsSync(state.sessionFile) ? state.sessionFile : undefined, false);
    }
    case 'switchSession': {
      if (transition || deletingArchived) throw new Error('Workspace operation in progress');
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
      return connect(target.cwd, target.path, false);
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
        if (!copy.id || copy.id === target.id || source?.leafId && copy.leafId !== source.leafId) throw new Error('Session history changed; try again');
        const worker = await runtimes.open(nodePath, join(runtimeRoot, 'step/dist/bundle/step.js'), cwd, authEnvironment(),
          copyPath, { kind: 'open-copy', sessionId: copy.id, permissionPreset: source?.permissionPreset, name });
        copyOpened = true;
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
      if (source.id !== runtimes.activeId || source.mutating || source.operations) throw new Error('Session operation in progress');
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
        const worker = await runtimes.open(nodePath, join(runtimeRoot, 'step/dist/bundle/step.js'), source.cwd, authEnvironment(),
          sessionPath, { kind, entryId, leafId: source.leafId, permissionPreset: source.permissionPreset,
            name });
        return await snapshot(worker);
      } finally { source.mutating = false; transition = false; }
    }
    case 'retryMessage': {
      if (transition) throw new Error('Workspace operation in progress');
      const worker = runtimes.require(text(args[2], 80));
      if (worker.id !== runtimes.activeId || worker.mutating || worker.operations) throw new Error('Session operation in progress');
      const entryId = text(args[0], 80);
      const message = text(args[1]);
      if (/^\s*\/_desktop_retry\b/.test(message)) throw new Error('Reserved Desktop command');
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
            if (target.id === runtimes.active?.state?.sessionId) throw new Error(preferences.language === 'zh' ? '请先切换到其他会话，再删除当前会话' : 'Open a different session before deleting this one');
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
          if (worker) await runtimes.assertIdle(worker);
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
      if (target.id === runtimes.active?.state?.sessionId) throw new Error('Open a different session before deleting this one');
      const worker = [...runtimes.workers.values()].find(worker => worker.state?.sessionId === target.id);
      if (worker) await runtimes.assertIdle(worker);
      const response = await dialog.showMessageBox(window, { type: 'question', message: preferences.language === 'zh' ? '将此会话移到回收站？' : 'Move this session to the Recycle Bin?', buttons: ['Cancel', 'Move to Recycle Bin'], defaultId: 0, cancelId: 0 });
      if (response.response !== 1) return false;
      if (worker) await runtimes.remove(worker);
      if (target.path) await shell.trashItem(target.path); return true;
    }
    case 'command': {
      const type = text(args[0], 80); const data = args[1] ?? {};
      if (transition) throw new Error('Workspace is changing');
      if (sessionDraft && args[2] === undefined) {
        if (type === 'set_model') {
          const model = sessionDraft.models?.find(model => model.id === data.modelId && model.provider === data.provider);
          if (!model) throw new Error('Unknown model');
          sessionDraft.model = model; sessionDraft.modelChanged = true;
          if (!model.thinkingLevels?.includes(sessionDraft.thinkingLevel!)) sessionDraft.thinkingLevel = model.thinkingLevels?.[0];
          sessionDraft.thinkingChanged = Boolean(sessionDraft.thinkingLevel);
          return;
        }
        if (type === 'set_thinking_level') {
          if (!sessionDraft.model?.thinkingLevels?.includes(data.level)) throw new Error('Unsupported thinking level');
          sessionDraft.thinkingLevel = data.level; sessionDraft.thinkingChanged = true;
          return;
        }
        if (type === 'set_permission_preset') {
          if (!permissionPresets.includes(data.preset)) throw new Error('Unknown permission preset');
          sessionDraft.permissionPreset = data.preset; sessionDraft.permissionChanged = true;
          return;
        }
        throw new Error('Send a message to create this session first');
      }
      const runtimeId = args[2] === undefined ? runtimes.activeId : text(args[2], 80);
      const worker = ['queue_edit', 'queue_remove'].includes(type) ? runtimes.workers.get(runtimeId!) : runtimes.require(runtimeId);
      if (!worker) throw new Error('This session runtime is unavailable');
      if (worker.stopping && ['prompt', 'queue_steer', 'queue_steer_first', 'abort'].includes(type))
        throw new Error('Wait for this session to stop');
      if (worker.mutating && !['abort', 'extension_ui_response', 'get_commands', 'get_available_thinking_levels', 'get_session_stats'].includes(type)) throw new Error('Session operation in progress');
      const mutating = ['set_model', 'set_thinking_level', 'set_permission_preset', 'compact', 'queue_recover'].includes(type);
      if (mutating) worker.mutating = true;
      const wasStreaming = worker.busy || worker.submissions > 0;
      if (type === 'prompt') worker.submissions++;
      try {
        const rpc = worker.rpc;
        const pendingUI = worker.pendingUI;
        if (type === 'new_session') return connect(worker.cwd, undefined, false);
        if (type === 'extension_ui_response') {
          const request = pendingUI.get(text(data.id));
          if (!request) throw new Error('This request has expired');
          const answer: Record<string, unknown> = { id: request.id };
          if (data.cancelled === true) answer.cancelled = true;
          else if (request.method === 'confirm') { if (typeof data.confirmed !== 'boolean') throw new Error('Confirmation required'); answer.confirmed = data.confirmed; }
          else { answer.value = text(data.value); if (request.method === 'select' && !request.options?.includes(data.value)) throw new Error('Invalid selection'); }
          runtimes.respondToRequest(worker, answer); return null;
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
            if (/^\s*\/_desktop_retry\b/.test(message)) throw new Error('Reserved Desktop command');
            pendingMessages.edit(worker, id, data.version, message);
          } else if (type === 'queue_remove') pendingMessages.remove(worker, id, data.version);
          else await pendingMessages.steer(worker, id, data.version);
          return;
        }
        if (!allowed.includes(type)) throw new Error('Unsupported command');
        if (type === 'set_permission_preset') {
          const preset = text(data.preset, 30);
          if (!permissionPresets.includes(preset as typeof permissionPresets[number])) throw new Error('Unknown permission preset');
          // Preset switching stays allowed while a turn runs: it only governs
          // later approvals, so it must not assert an idle session.
          const { commands } = await rpc.request('get_commands');
          if (!Array.isArray(commands) || !commands.some((command: { name?: string; source?: string }) => command.name === 'permissions' && command.source === 'extension')) {
            throw new Error('This Step Code runtime does not support permission switching');
          }
          return await rpc.request('prompt', { message: `/permissions ${preset}` });
        }
        let payload: Record<string, unknown> = {};
        let filePaths: string[] = [];
        if (type === 'prompt') {
          payload.message = text(data.message);
          if (/^\s*\/_desktop_retry\b/.test(payload.message as string)) throw new Error('Reserved Desktop command');
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
          if (wasStreaming) {
            const id = pendingMessages.enqueue(worker, text(data.message), payload, filePaths);
            if (Array.isArray(data.files)) for (const id of data.files) attachedFiles.delete(id);
            return { queued: true, id, version: 0 };
          }
          pendingMessages.resumed(worker);
        }
        if (type === 'set_model') payload = { provider: text(data.provider, 200), modelId: text(data.modelId, 300) };
        if (type === 'set_thinking_level') payload = { level: text(data.level, 30) };
        if (type === 'set_session_name') payload = { name: text(data.name, 200) };
        if (['set_model', 'set_thinking_level', 'compact'].includes(type)) await runtimes.assertIdle(worker);
        if (type === 'abort') { worker.stopping = true; worker.interrupted = true; pendingMessages.pause(worker); }
        worker.operations++;
        if (type === 'prompt') runtimes.publish();
        try {
          const response = await rpc.request(type, payload, type === 'prompt' || type === 'compact' ? 600000 : 30000);
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
        if (mutating) worker.mutating = false;
        if (type === 'abort') worker.stopping = false;
        if (type === 'prompt') { worker.submissions--; runtimes.publish(); void pendingMessages.drain(worker); }
      }
    }
    case 'settings': return admin.request('settings', { cwd: (sessionDraft ? sessionDraft.workspace : preferences.workspace) ?? app.getPath('documents') });
    case 'login': {
      await guardIdle();
      const next = await admin.request('login', { profile: text(args[0], 40), key: args[1] === undefined ? undefined : text(args[1], 4096) }, 300000);
      await persistAuth(next);
      const current = runtimes.active;
      await runtimes.stopAll();
      if (current) await connect(current.cwd, current.state?.sessionFile, false);
      return null;
    }
    case 'cancelLogin': return admin.request('cancel_login');
    case 'logout': {
      await guardIdle();
      const next = await admin.request('logout');
      await persistAuth(next);
      const current = runtimes.active;
      await runtimes.stopAll();
      if (current) await connect(current.cwd, undefined, false);
      return null;
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
      await admin.request('mcp', { name, config, secrets }); return null;
    }
    case 'preferences': {
      const patch = args[0] ?? {};
      if (patch.appearance !== undefined) preferences.appearance = normalizeAppearance(patch.appearance);
      const updatePatch = updatePreferences(patch);
      if (patch.filePreviewWidth !== undefined) {
        if (patch.filePreviewWidth !== 'standard' && patch.filePreviewWidth !== 'wide') throw new Error('Invalid file preview width');
        preferences.filePreviewWidth = patch.filePreviewWidth;
      }
      const sidebarPatch = validateSidebarPreferences(patch, cachedSessions(), preferences.workspaces, pathKey);
      if (['system', 'light', 'dark'].includes(patch.theme)) preferences.theme = patch.theme;
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
      Object.assign(preferences, sidebarPatch, updatePatch);
      await savePreferences();
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
      const result = await dialog.showOpenDialog(window, { properties: ['openFile', 'multiSelections'] });
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
        const result = await dialog.showSaveDialog(window, {
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
app.on('will-quit', () => { tray?.dispose(); tray = undefined; localPages.dispose(); updates.dispose(); });
app.on('before-quit', event => {
  if (quitting) return;
  event.preventDefault();
  if (quitPending) return;
  quitPending = true;
  void (async () => {
    if (!sessionEnding && (runtimes.running || transition) && window && !window.isDestroyed()) {
      showMainWindow();
      const zh = preferences.language === 'zh';
      const r = await dialog.showMessageBox(window, { message: zh ? '仍有会话在运行。停止所有任务并退出？' : 'Sessions are still running. Stop all tasks and quit?', buttons: zh ? ['取消', '停止并退出'] : ['Cancel', 'Stop and quit'], cancelId: 0, defaultId: 0 });
      if (r.response !== 1) { quitPending = false; return; }
    }
    try {
      await terminals.stopAll();
      await Promise.all([runtimes.stopAll(), admin.stop(), collaboration.stop()]);
      await conversationTiming.flush();
      browser?.dispose();
      quitting = true;
      app.quit();
    } catch {
      quitPending = false;
      if (!sessionEnding) showMainWindow();
      emit({ type: 'desktop_error', message: preferences.language === 'zh' ? '无法结束终端，请关闭终端后重试退出。' : 'Could not stop terminals. Close them and try exiting again.' });
    }
  })();
});
app.on('window-all-closed', () => app.quit());
app.on('second-instance', showMainWindow);
app.on('activate', showMainWindow);
if (!app.requestSingleInstanceLock()) { quitting = true; app.quit(); }
else app.whenReady().then(async () => {
  await mkdir(dataRoot, { recursive: true });
  await mkdir(join(dataRoot, 'sessions'), { recursive: true });
  await collaboration.start();
  // Load credentials before admin/rpc start so the migrated vault content reaches both;
  // vault.load() also migrates and removes a legacy plaintext auth.json. safeStorage
  // requires the ready state, which whenReady provides.
  authData = await vault.load();
  crashLog.setPhase('vault loaded');
  try { preferences = { ...preferences, ...JSON.parse(await readFile(preferencesFile, 'utf8')) }; } catch {}
  preferences.updateChannel = preferences.updateChannel === 'stable' ? 'stable' : 'preview';
  preferences.autoCheckUpdates = preferences.autoCheckUpdates !== false;
  updates.setChannel(preferences.updateChannel);
  try { await writeFile(join(dataRoot, 'config.toml'), 'permissionPreset = "ask"\n[telemetry]\nenabled = false\n', { flag: 'wx' }); } catch (e: any) { if (e.code !== 'EEXIST') throw e; }
  admin.start(nodePath, join(runtimeRoot, 'admin.mjs'), dataRoot, authEnvironment());
  crashLog.setPhase('admin started');
  // Windows 上内置的 StepPage 插件登记的是 command: steppage-mcp，而官方文档让
  // 用户填进 MCP 客户端的正是 install.sh 写到 ~/.local/bin 的那个 shell 包装；
  // MCP 传输不走 shell、直接 spawn，所以在 Windows 上必然失败，上游
  // provisionBuiltinPlugin 在 win32 上也直接跳过自动安装，安装途径只有 install.sh。
  // bundle 本体在 Windows 上是健康的，这里在探测到官方安装位置的 bundle 时注册一个
  // 可用配置：command 用暂存的 runtime node（打包后 process.execPath 是 electron.exe，
  // 不是 node），args 指向 bundle。
  // 存在性判断读 settings 返回的解析后配置，不做文件子串匹配：TOML 有等价写法
  // （带引号的键、inline table），子串认不出来，会把用户自己的 command/args/enabled
  // 覆盖掉。只有从未配过、或现存项是桌面自己上次写且它的 command 不是当前 runtime 的
  // node 时才刷新。判据用是不是当前这个 node，而不是那个路径还在不在——开发机上
  // 源码模式写进去的路径恰好存在，用它判会漏，换到用户机器上反倒会被刷新。
  // 其余一律视为用户配置不动。
  // 整段静默容错：失败不影响启动，内置插件照旧失败并留在设置里，用户看到真实故障。
  try {
    const steppageBundle = process.env.DESKTOP_STEPPAGE_BUNDLE?.trim() || join(homedir(), '.steppage-mcp', 'bin', 'steppage-mcp.mjs');
    const steppageName = 'steppage';
    if (existsSync(steppageBundle)) {
      const settings = await admin.request('settings', { cwd: preferences.workspace ?? app.getPath('documents') });
      const existing = settings?.mcp?.[steppageName];
      const looksDesktopWritten = /runtime[/\\]node[/\\]node\.exe$/i.test(String(existing?.command ?? ''));
      const staleManaged = Boolean(existing) && looksDesktopWritten
        && typeof existing.command === 'string'
        && !(await samePath(existing.command, nodePath));
      if (!existing || staleManaged) {
        await admin.request('mcp', { name: steppageName, config: { command: nodePath, args: [steppageBundle], enabled: true }, secrets: {} });
        crashLog.setPhase('steppage registered');
      }
    }
  } catch {
    // 探测或注册失败不该影响启动
  }
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  // The renderer cannot read the Windows dark mode reliably: prefers-color-scheme
  // stays light inside this packaged renderer even on a dark system, so the main
  // process owns the resolved theme. The preload asks for it synchronously before
  // the first paint; the renderer re-resolves on preference and system changes.
  const resolvedTheme = (): 'light' | 'dark' => preferences.theme === 'system' ? (nativeTheme.shouldUseDarkColors ? 'dark' : 'light') : preferences.theme;
  ipcMain.on('desktop:resolved-theme', event => { event.returnValue = { theme: resolvedTheme(), systemDark: nativeTheme.shouldUseDarkColors }; });
  // The authoritative system value, re-read by the renderer after it subscribes
  // to theme events: a change that lands before that subscription is dropped,
  // and this query is what corrects the startup snapshot.
  ipcMain.handle('desktop-system-theme', event => {
    if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) throw new Error('Untrusted sender');
    return { systemDark: nativeTheme.shouldUseDarkColors };
  });
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => callback({ responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': ["default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' ws://127.0.0.1:*; object-src 'none'; frame-src 'none'"] } }));
  window = new BrowserWindow({ width: 1320, height: 880, minWidth: 640, minHeight: 540, title: 'Desktop for Step Code', icon: app.isPackaged ? join(process.resourcesPath, 'icon.ico') : resolve('build/icon.ico'), frame: false, backgroundColor: '#171717', autoHideMenuBar: true, show: !backgroundAcceptance, focusable: !backgroundAcceptance, webPreferences: { preload: join(__dirname, 'preload.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true, ...(backgroundAcceptance ? { backgroundThrottling: false } : {}) } });
  nativeTheme.on('updated', () => { tray?.relabel(); if (window && !window.isDestroyed()) window.webContents.send('runtime-event', { type: 'desktop_system_theme', dark: nativeTheme.shouldUseDarkColors }); });
  crashLog.setPhase('window created');
  browser = new BrowserTabs(window, event => {
    if (!window.isDestroyed()) window.webContents.send('browser-event', event);
  }, () => preferences.language);
  const windowState = () => emit({ type: 'desktop_window_state', maximized: window.isMaximized(), focused: window.isFocused() });
  window.on('maximize', windowState);
  window.on('unmaximize', windowState);
  window.on('focus', windowState);
  window.on('blur', windowState);
  window.webContents.setWindowOpenHandler(({ url }) => { try { const u = new URL(url); if (['https:', 'http:'].includes(u.protocol)) void shell.openExternal(u.href); } catch {} return { action: 'deny' }; });
  window.webContents.on('will-navigate', event => event.preventDefault());
  try {
    tray = new DesktopTray(app.isPackaged ? join(process.resourcesPath, 'icon.ico') : resolve('build/icon.ico'),
      () => preferences.language, showMainWindow, () => app.quit(), {
        theme: resolvedTheme, quitting: () => quitting, noFocus: backgroundAcceptance,
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
  window.on('session-end', () => { sessionEnding = true; app.quit(); });
  ipcMain.handle('desktop', async (event, method, ...args) => {
    if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) throw new Error('Untrusted sender');
    const shared = ['login', 'logout', 'saveMcp'].includes(method);
    if (undoBusy && ['beginSession', 'chooseSessionProject', 'createDraftSession', 'command', 'branchSession', 'cloneSession', 'retryMessage', 'restart', 'workspace', 'chooseWorkspace',
      'switchSession', 'newIndependentSession', 'deleteSession', 'deleteArchivedSessions', 'login', 'logout', 'saveMcp'].includes(method))
      throw new Error('Undo in progress');
    if (settingsMutation && ['beginSession', 'chooseSessionProject', 'createDraftSession', 'command', 'branchSession', 'cloneSession', 'retryMessage', 'restart', 'workspace', 'chooseWorkspace', 'switchSession', 'newIndependentSession', 'login', 'logout', 'saveMcp'].includes(method)) throw new Error('Shared settings operation in progress');
    if (shared) settingsMutation = true;
    try { return await handle(method, args); }
    catch (error) { throw new Error(error instanceof Error ? error.message : 'Desktop operation failed'); }
    finally { if (shared) settingsMutation = false; }
  });
  {
    startup = (async () => {
      try {
        await beginSession(preferences.workspaces.find(path => pathKey(path) === pathKey(preferences.workspace ?? '')));
      } catch (error) {
        status = 'disconnected';
        await runtimes.stopAll();
        startupError = error instanceof Error ? error.message : 'Could not start an independent session';
        await crashLog.record('startup-failure', error, (error as { details?: Record<string, unknown> }).details ?? {});
      }
    })();
  }
  if (process.env.DESKTOP_DEV_URL && !app.isPackaged) await window.loadURL(process.env.DESKTOP_DEV_URL);
  else await window.loadFile(join(__dirname, 'renderer/index.html'));
  if (restoreRequested) { restoreRequested = false; showMainWindow(); }
  // Update checks are independent of runtime/model startup and never block first paint.
  if (app.isPackaged && !backgroundAcceptance) {
    const check = () => { if (!quitting && preferences.autoCheckUpdates !== false) void updates.check(); };
    setTimeout(check, 10_000).unref();
    setInterval(check, 6 * 60 * 60 * 1000).unref();
  }
}).catch(async error => {
  await crashLog.record('startup-failure', error, (error as { details?: Record<string, unknown> }).details ?? {});
  if (!backgroundAcceptance) dialog.showErrorBox('Desktop for Step Code', String(error));
  quitting = true; void Promise.all([runtimes.stopAll(), admin.stop(), collaboration.stop(), terminals.stopAll()]).finally(() => app.quit());
});
