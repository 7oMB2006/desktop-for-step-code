import { app, BrowserWindow, dialog, ipcMain, shell, session, clipboard, ClipboardItem, nativeImage, nativeTheme } from 'electron';
import { join, resolve, extname, basename } from 'node:path';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile, rename, realpath, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { RpcProcess, isolatedEnvironment } from './runtime';
import { SessionRuntimes, firstUserText } from './session-runtimes';
import { SessionCollaboration } from './session-collaboration';
import { AuthVault } from './auth-vault';
import { installCrashLog } from './crash-log';
import { permissionPresets } from './permission-status';
import type { Preferences, Session, Snapshot } from '../src/contracts';
import { decodeImageUrl, imageFileName, fileReferenceMessage, imageMime, MAX_ATTACHMENTS, MAX_FILE_BYTES, MAX_IMAGE_BYTES, MAX_IMAGES } from './attachment-utils';

app.setName('Desktop for Step Code');
app.setAppUserModelId('community.stepcode.desktop');
if (process.env.DESKTOP_TEST_USER_DATA) app.setPath('userData', resolve(process.env.DESKTOP_TEST_USER_DATA));
const backgroundAcceptance = process.env.DESKTOP_TEST_NO_FOCUS === '1' && Boolean(process.env.DESKTOP_TEST_USER_DATA);
const crashLog = installCrashLog();
let window: BrowserWindow;
let preferences: Preferences = { theme: 'system', language: 'zh', workspaces: [] };
let status = 'disconnected';
let transition = false;
let settingsMutation = false;
let quitting = false;
let quitPending = false;
let startup: Promise<void> = Promise.resolve();
let startupError: string | undefined;
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
  if (event.type === 'desktop_exit') void crashLog.record('runtime-exit', new Error('Step Code runtime exited unexpectedly'), event.details ?? {});
  emit(event);
}, undefined, {
  launch: worker => collaboration.attach(worker),
  dispose: worker => collaboration.detach(worker),
});
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
async function listSessions(): Promise<Session[]> {
  const sessions: Session[] = await admin.request('sessions');
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
  if (refresh && worker?.status === 'connected') await runtimes.read(worker);
  const sessions = refresh ? await listSessions() : cachedSessions();
  return {
    preferences: { ...preferences, workspace: worker?.cwd ?? preferences.workspace },
    status: worker?.status ?? status, runtimeId: worker?.id, runtimes: runtimes.summaries(), unreadSessionIds: [...runtimes.unreadSessionIds],
    state: worker?.state, permissionPreset: worker?.permissionPreset,
    messages: worker?.messages ?? [], models: worker?.models ?? [], stats: worker?.stats,
    requests: worker ? [...worker.pendingUI.values()] : [],
    sessions, independent: !worker || isIndependentPath(worker.cwd),
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
    preferences.workspace = canonical;
    if (rememberProject && !pathKey(canonical).startsWith(`${pathKey(independentRoot)}/`)) {
      const previous = await Promise.all(preferences.workspaces.map(async path => ({ path, same: await samePath(path, canonical) })));
      preferences.workspaces = [canonical, ...previous.filter(entry => !entry.same).map(entry => entry.path)];
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
const text = (value: unknown, max = 100000): string => { if (typeof value !== 'string' || value.length > max) throw new Error('Invalid text'); return value; };
async function handle(method: string, args: any[]) {
  switch (method) {
    case 'windowControl': {
      switch (args[0]) {
        case 'state': break;
        case 'minimize': window.minimize(); break;
        case 'toggleMaximize': window.isMaximized() ? window.unmaximize() : window.maximize(); break;
        case 'close': window.close(); break;
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
    case 'workspace': { const cwd = text(args[0]); if (!preferences.workspaces.includes(cwd)) throw new Error('Unknown workspace'); return connect(cwd); }
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
      if (transition) throw new Error('Workspace operation in progress');
      const resident = [...runtimes.workers.values()].find(worker => worker.state?.sessionId === text(args[0]));
      if (resident) {
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
    case 'deleteSession': {
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
      const worker = runtimes.require(args[2] === undefined ? undefined : text(args[2], 80));
      if (worker.mutating && !['abort', 'extension_ui_response', 'get_commands', 'get_available_thinking_levels', 'get_session_stats'].includes(type)) throw new Error('Session operation in progress');
      const mutating = ['set_model', 'set_thinking_level', 'set_permission_preset', 'compact'].includes(type);
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
        if (!allowed.includes(type)) throw new Error('Unsupported command');
        if (type === 'set_permission_preset') {
          const preset = text(data.preset, 30);
          if (!permissionPresets.includes(preset as typeof permissionPresets[number])) throw new Error('Unknown permission preset');
          await runtimes.assertIdle(worker);
          const { commands } = await rpc.request('get_commands');
          if (!Array.isArray(commands) || !commands.some((command: { name?: string; source?: string }) => command.name === 'permissions' && command.source === 'extension')) {
            throw new Error('This Step Code runtime does not support permission switching');
          }
          return await rpc.request('prompt', { message: `/permissions ${preset}` });
        }
        let payload: Record<string, unknown> = {};
        if (type === 'prompt') {
          payload.message = text(data.message);
          if (data.files !== undefined) {
            if (!Array.isArray(data.files) || data.files.length > MAX_ATTACHMENTS || new Set(data.files).size !== data.files.length) throw new Error('Invalid attachments');
            const paths = await Promise.all(data.files.map(async (id: unknown) => {
              const path = attachedFiles.get(text(id, 80));
              if (!path) throw new Error('Attachment has expired; add it again');
              const info = await stat(path);
              if (!info.isFile() || info.size > MAX_FILE_BYTES) throw new Error('Attached file is unavailable or too large');
              return path;
            }));
            payload.message = fileReferenceMessage(payload.message as string, paths, preferences.language);
          }
          if (data.images) {
            if (!Array.isArray(data.images) || data.images.length > MAX_IMAGES || data.images.length + (data.files?.length ?? 0) > MAX_ATTACHMENTS) throw new Error('Too many attachments');
            payload.images = data.images.map((i: any) => {
              if (i.type !== 'image' || !['image/png', 'image/jpeg', 'image/webp'].includes(i.mimeType)) throw new Error('Unsupported image');
              return { type: 'image', mimeType: i.mimeType, data: text(i.data, 14000000) };
            });
          }
          if (wasStreaming) payload.streamingBehavior = 'followUp';
        }
        if (type === 'set_model') payload = { provider: text(data.provider, 200), modelId: text(data.modelId, 300) };
        if (type === 'set_thinking_level') payload = { level: text(data.level, 30) };
        if (type === 'set_session_name') payload = { name: text(data.name, 200) };
        if (['set_model', 'set_thinking_level', 'compact'].includes(type)) await runtimes.assertIdle(worker);
        if (type === 'abort' && runtimes.isBusy(worker)) worker.interrupted = true;
        worker.operations++;
        if (type === 'prompt') runtimes.publish();
        try {
          const response = await rpc.request(type, payload, type === 'prompt' || type === 'compact' ? 600000 : 30000);
          if (type === 'prompt' && Array.isArray(data.files)) for (const id of data.files) attachedFiles.delete(id);
          return response;
        } catch (error) {
          if (type === 'prompt') worker.failed = true;
          throw error;
        } finally {
          worker.operations--;
          runtimes.publish();
        }
      } finally {
        if (mutating) worker.mutating = false;
        if (type === 'prompt') { worker.submissions--; runtimes.publish(); }
      }
    }
    case 'settings': return admin.request('settings', { cwd: preferences.workspace ?? app.getPath('documents') });
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
      await savePreferences(); return preferences;
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
app.on('before-quit', event => {
  if (quitting) return;
  event.preventDefault();
  if (quitPending) return;
  quitPending = true;
  void (async () => {
    if ((runtimes.running || transition) && window && !window.isDestroyed()) {
      const r = await dialog.showMessageBox(window, { message: preferences.language === 'zh' ? '仍有会话在运行。停止所有任务并退出？' : 'Sessions are still running. Stop all tasks and quit?', buttons: ['Cancel', 'Stop and quit'], cancelId: 0 });
      if (r.response !== 1) { quitPending = false; return; }
    }
    quitting = true; await Promise.all([runtimes.stopAll(), admin.stop(), collaboration.stop()]); app.quit();
  })();
});
app.on('window-all-closed', () => app.quit());
if (!app.requestSingleInstanceLock()) app.quit();
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
  // 覆盖掉。只有从未配过、或现存项是桌面自己上次写且那时的 runtime node 已不存在
  // （用户数据在 %APPDATA% 不随安装走，重装到别的目录就会出现这种陈旧项）时才刷新，
  // 其余一律视为用户配置不动。
  // 整段静默容错：失败不影响启动，内置插件照旧失败并留在设置里，用户看到真实故障。
  try {
    const steppageBundle = process.env.DESKTOP_STEPPAGE_BUNDLE?.trim() || join(homedir(), '.steppage-mcp', 'bin', 'steppage-mcp.mjs');
    const steppageName = 'steppage';
    if (existsSync(steppageBundle)) {
      const settings = await admin.request('settings', { cwd: preferences.workspace ?? app.getPath('documents') });
      const existing = settings?.mcp?.[steppageName];
      const staleManaged = Boolean(existing)
        && /runtime[/\\]node[/\\]node\.exe$/i.test(String(existing?.command ?? ''))
        && !existsSync(String(existing?.command));
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
  nativeTheme.on('updated', () => { if (window && !window.isDestroyed()) window.webContents.send('runtime-event', { type: 'desktop_system_theme', dark: nativeTheme.shouldUseDarkColors }); });
  crashLog.setPhase('window created');
  const windowState = () => emit({ type: 'desktop_window_state', maximized: window.isMaximized(), focused: window.isFocused() });
  window.on('maximize', windowState);
  window.on('unmaximize', windowState);
  window.on('focus', windowState);
  window.on('blur', windowState);
  window.webContents.setWindowOpenHandler(({ url }) => { try { const u = new URL(url); if (['https:', 'http:'].includes(u.protocol)) void shell.openExternal(u.href); } catch {} return { action: 'deny' }; });
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.on('close', event => { if (!quitting) { event.preventDefault(); app.quit(); } });
  ipcMain.handle('desktop', async (event, method, ...args) => {
    if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) throw new Error('Untrusted sender');
    const shared = ['login', 'logout', 'saveMcp'].includes(method);
    if (settingsMutation && ['command', 'restart', 'workspace', 'chooseWorkspace', 'switchSession', 'newIndependentSession', 'login', 'logout', 'saveMcp'].includes(method)) throw new Error('Shared settings operation in progress');
    if (shared) settingsMutation = true;
    try { return await handle(method, args); }
    catch (error) { throw new Error(error instanceof Error ? error.message : 'Desktop operation failed'); }
    finally { if (shared) settingsMutation = false; }
  });
  app.on('second-instance', () => { window.restore(); window.focus(); });
  {
    startup = (async () => {
      try {
        await newIndependentSession();
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
}).catch(async error => {
  await crashLog.record('startup-failure', error, (error as { details?: Record<string, unknown> }).details ?? {});
  if (!backgroundAcceptance) dialog.showErrorBox('Desktop for Step Code', String(error));
  quitting = true; void Promise.all([runtimes.stopAll(), admin.stop(), collaboration.stop()]).finally(() => app.quit());
});
