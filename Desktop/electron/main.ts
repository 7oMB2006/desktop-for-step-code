import { app, BrowserWindow, dialog, ipcMain, shell, session } from 'electron';
import { join, resolve, extname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, realpath, stat } from 'node:fs/promises';
import { RpcProcess, isolatedEnvironment } from './runtime';
import { AuthVault } from './auth-vault';
import type { Preferences, Session, Snapshot, RuntimeState, UIRequest } from '../src/contracts';

app.setName('Desktop for Step Code');
app.setAppUserModelId('community.stepcode.desktop');
if (process.env.DESKTOP_TEST_USER_DATA) app.setPath('userData', resolve(process.env.DESKTOP_TEST_USER_DATA));
let window: BrowserWindow;
let preferences: Preferences = { theme: 'system', language: 'zh', workspaces: [] };
let state: RuntimeState | undefined;
let status = 'disconnected';
let busy = false;
let transition = false;
let quitting = false;
let quitPending = false;
let startup: Promise<void> = Promise.resolve();
let startupError: string | undefined;
const pendingUI = new Map<string, UIRequest>();
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
const rpc = new RpcProcess(event => {
  if (event.type === 'agent_start') busy = true;
  if (event.type === 'agent_end') busy = false;
  if (event.type === 'desktop_exit') { status = 'disconnected'; busy = false; state = undefined; pendingUI.clear(); }
  if (event.type === 'extension_ui_request' && ['select', 'confirm', 'input', 'editor'].includes(event.method)) pendingUI.set(event.id, event);
  emit(event);
});
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
async function savePreferences() {
  const tmp = `${preferencesFile}.tmp`;
  await writeFile(tmp, JSON.stringify(preferences, null, 2)); await rename(tmp, preferencesFile);
}
async function listSessions(): Promise<Session[]> {
  const sessions: Session[] = await admin.request('sessions');
  return Promise.all(sessions.map(async s => {
    const workspacePath = await sessionWorkspacePath(s.cwd);
    return { ...s, workspacePath, independent: !workspacePath };
  }));
}
async function snapshot(): Promise<Snapshot> {
  let messages = [], models = [];
  if (status === 'connected') {
    [state, { messages }, { models }] = await Promise.all([rpc.request('get_state'), rpc.request('get_messages'), rpc.request('get_available_models')]);
    busy = Boolean(state?.isStreaming);
  }
  return { preferences, status, state, messages, models, sessions: await listSessions(), independent: !preferences.workspace || isIndependentPath(preferences.workspace) };
}
async function guardIdle() {
  if (transition) throw new Error('Workspace operation in progress');
  if (status === 'connected') { const current = await rpc.request('get_state'); if (current.isStreaming || current.isCompacting || current.pendingMessageCount) throw new Error('Stop the current task before changing workspace or settings'); }
  if (busy) throw new Error('Stop the current task first');
}
async function connect(cwd: string, sessionPath?: string, rememberProject = true) {
  await guardIdle(); transition = true;
  try {
    const canonical = await realpath(cwd);
    if (!(await stat(canonical)).isDirectory()) throw new Error('Workspace is not a directory');
    await rpc.stop(); status = 'connecting'; emit({ type: 'desktop_status', status });
    preferences.workspace = canonical;
    if (rememberProject && !pathKey(canonical).startsWith(`${pathKey(independentRoot)}/`)) {
      const previous = await Promise.all(preferences.workspaces.map(async path => ({ path, same: await samePath(path, canonical) })));
      preferences.workspaces = [canonical, ...previous.filter(entry => !entry.same).map(entry => entry.path)];
    }
    await savePreferences();
    rpc.start(nodePath, join(runtimeRoot, 'step/dist/bundle/step.js'), canonical, authEnvironment());
    await rpc.request('get_state', {}, 60000);
    status = 'connected';
    if (sessionPath) { const result = await rpc.request('switch_session', { sessionPath }); if (result.cancelled) throw new Error('Session switch cancelled'); }
    else { const result = await rpc.request('new_session'); if (result.cancelled) throw new Error('New session cancelled'); }
    return await snapshot();
  } catch (error) { status = 'disconnected'; await rpc.stop(); throw error; }
  finally { transition = false; emit({ type: 'desktop_status', status }); }
}
async function newIndependentSession() {
  await guardIdle();
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
    case 'chooseWorkspace': {
      const result = await dialog.showOpenDialog(window, { properties: ['openDirectory'] });
      return result.canceled ? null : connect(result.filePaths[0]);
    }
    case 'workspace': { const cwd = text(args[0]); if (!preferences.workspaces.includes(cwd)) throw new Error('Unknown workspace'); return connect(cwd); }
    case 'restart': if (preferences.workspace) return connect(preferences.workspace, state?.sessionFile, false); return snapshot();
    case 'switchSession': {
      const target = (await listSessions()).find(s => s.id === text(args[0]));
      if (!target) throw new Error('Unknown session'); return connect(target.cwd, target.path, false);
    }
    case 'deleteSession': {
      await guardIdle();
      const target = (await listSessions()).find(s => s.id === text(args[0]));
      if (!target) throw new Error('Unknown session');
      if (target.id === state?.sessionId) throw new Error('Open a different session before deleting this one');
      const response = await dialog.showMessageBox(window, { type: 'question', message: preferences.language === 'zh' ? '将此会话移到回收站？' : 'Move this session to the Recycle Bin?', buttons: ['Cancel', 'Move to Recycle Bin'], defaultId: 0, cancelId: 0 });
      if (response.response !== 1) return false;
      await shell.trashItem(target.path); return true;
    }
    case 'command': {
      const type = text(args[0], 80); const data = args[1] ?? {};
      if (transition) throw new Error('Workspace is changing');
      if (type === 'extension_ui_response') {
        const request = pendingUI.get(text(data.id));
        if (!request) throw new Error('This request has expired');
        const answer: Record<string, unknown> = { id: request.id };
        if (data.cancelled === true) answer.cancelled = true;
        else if (request.method === 'confirm') { if (typeof data.confirmed !== 'boolean') throw new Error('Confirmation required'); answer.confirmed = data.confirmed; }
        else { answer.value = text(data.value); if (request.method === 'select' && !request.options?.includes(data.value)) throw new Error('Invalid selection'); }
        pendingUI.delete(request.id); rpc.respond(answer); return null;
      }
      const allowed = ['prompt', 'abort', 'clear_queue', 'new_session', 'set_model', 'set_thinking_level', 'set_session_name', 'get_commands', 'get_available_thinking_levels', 'get_session_stats', 'compact'];
      if (!allowed.includes(type)) throw new Error('Unsupported command');
      let payload: Record<string, unknown> = {};
      if (type === 'prompt') {
        payload.message = text(data.message);
        if (data.images) {
          if (!Array.isArray(data.images) || data.images.length > 5) throw new Error('Too many images');
          payload.images = data.images.map((i: any) => {
            if (i.type !== 'image' || !['image/png', 'image/jpeg', 'image/webp'].includes(i.mimeType)) throw new Error('Unsupported image');
            return { type: 'image', mimeType: i.mimeType, data: text(i.data, 14000000) };
          });
        }
        if (busy) payload.streamingBehavior = 'followUp';
      }
      if (type === 'set_model') payload = { provider: text(data.provider, 200), modelId: text(data.modelId, 300) };
      if (type === 'set_thinking_level') payload = { level: text(data.level, 30) };
      if (type === 'set_session_name') payload = { name: text(data.name, 200) };
      if (['new_session', 'set_model', 'set_thinking_level', 'compact'].includes(type)) await guardIdle();
      return rpc.request(type, payload, type === 'prompt' || type === 'compact' ? 600000 : 30000);
    }
    case 'settings': return admin.request('settings', { cwd: preferences.workspace ?? app.getPath('documents') });
    case 'login': {
      await guardIdle();
      const next = await admin.request('login', { profile: text(args[0], 40), key: args[1] === undefined ? undefined : text(args[1], 4096) }, 300000);
      await persistAuth(next);
      if (preferences.workspace) await connect(preferences.workspace, state?.sessionFile, false);
      return null;
    }
    case 'cancelLogin': return admin.request('cancel_login');
    case 'logout': {
      await guardIdle();
      const next = await admin.request('logout');
      await persistAuth(next);
      if (preferences.workspace) await connect(preferences.workspace, undefined, false);
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
      await savePreferences(); return preferences;
    }
    case 'images': {
      const result = await dialog.showOpenDialog(window, { properties: ['openFile', 'multiSelections'], filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] }] });
      if (result.canceled) return [];
      if (result.filePaths.length > 5) throw new Error('Maximum 5 images');
      return Promise.all(result.filePaths.map(async path => { if ((await stat(path)).size > 10 * 1024 * 1024) throw new Error('Image exceeds 10 MiB'); return { type: 'image', mimeType: extname(path).toLowerCase() === '.png' ? 'image/png' : extname(path).toLowerCase() === '.webp' ? 'image/webp' : 'image/jpeg', data: (await readFile(path)).toString('base64') }; }));
    }
    case 'diagnostics': {
      const result = await dialog.showSaveDialog(window, { defaultPath: 'step-desktop-diagnostics.json' });
      if (result.canceled || !result.filePath) return false;
      const manifest = JSON.parse(await readFile(join(runtimeRoot, 'manifest.json'), 'utf8'));
      await writeFile(result.filePath, JSON.stringify({ desktop: app.getVersion(), platform: process.platform, arch: process.arch, runtime: manifest, status }, null, 2)); return true;
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
    if (busy && window && !window.isDestroyed()) {
      const r = await dialog.showMessageBox(window, { message: 'A task is running. Stop it and quit?', buttons: ['Cancel', 'Stop and quit'], cancelId: 0 });
      if (r.response !== 1) { quitPending = false; return; }
    }
    quitting = true; await Promise.all([rpc.stop(), admin.stop()]); app.quit();
  })();
});
app.on('window-all-closed', () => app.quit());
if (!app.requestSingleInstanceLock()) app.quit();
else app.whenReady().then(async () => {
  await mkdir(dataRoot, { recursive: true });
  await mkdir(join(dataRoot, 'sessions'), { recursive: true });
  try { preferences = { ...preferences, ...JSON.parse(await readFile(preferencesFile, 'utf8')) }; } catch {}
  try { await writeFile(join(dataRoot, 'config.toml'), 'permissionPreset = "ask"\n[telemetry]\nenabled = false\n', { flag: 'wx' }); } catch (e: any) { if (e.code !== 'EEXIST') throw e; }
  admin.start(nodePath, join(runtimeRoot, 'admin.mjs'), dataRoot, env);
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => callback({ responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': ["default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' ws://127.0.0.1:*; object-src 'none'; frame-src 'none'"] } }));
  window = new BrowserWindow({ width: 1320, height: 880, minWidth: 640, minHeight: 540, title: 'Desktop for Step Code', icon: app.isPackaged ? join(process.resourcesPath, 'icon.ico') : resolve('build/icon.ico'), frame: false, backgroundColor: '#171717', autoHideMenuBar: true, webPreferences: { preload: join(__dirname, 'preload.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true } });
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
    try { return await handle(method, args); }
    catch (error) { throw new Error(error instanceof Error ? error.message : 'Desktop operation failed'); }
  });
  app.on('second-instance', () => { window.restore(); window.focus(); });
  {
    startup = (async () => {
      try {
        await newIndependentSession();
      } catch (error) {
        status = 'disconnected'; state = undefined;
        await rpc.stop();
        startupError = error instanceof Error ? error.message : 'Could not start an independent session';
      }
    })();
  }
  if (process.env.DESKTOP_DEV_URL && !app.isPackaged) await window.loadURL(process.env.DESKTOP_DEV_URL);
  else await window.loadFile(join(__dirname, 'renderer/index.html'));
}).catch(error => { dialog.showErrorBox('Desktop for Step Code', String(error)); quitting = true; void Promise.all([rpc.stop(), admin.stop()]).finally(() => app.quit()); });
