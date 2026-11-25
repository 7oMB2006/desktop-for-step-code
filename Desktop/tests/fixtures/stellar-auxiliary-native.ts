import { app, BrowserWindow, ipcMain, session } from 'electron';
import { join } from 'node:path';
import { StartupWindow } from '../../electron/startup-window';
import { DesktopTray } from '../../electron/desktop-tray';
import { PluginWindows } from '../../electron/plugin-windows';
import { pluginWindowMethodAllowed } from '../../electron/plugin-window-policy';
import { ThemePacks } from '../../electron/theme-packs';
import { registerPluginThemes, resolveTheme } from '../../src/theme';
import { resolveThemeMaterial } from '../../src/theme-material';
import type { CapabilityPlugin } from '../../src/capabilities';

const profile = process.env.DESKTOP_TEST_USER_DATA;
const desktop = process.env.STELLAR_FIXTURE_DESKTOP;
const base = process.env.STELLAR_FIXTURE_URL;
if (!profile || !desktop || !base?.startsWith('http://127.0.0.1:')) throw new Error('Isolated fixture paths required');
app.setPath('userData', profile);
const packs = new ThemePacks(join(desktop, '../theme-marketplace/plugins'));
let preference = 'plugin:stellar-cruise', registered = true;
let trayMotion = true;
let splash: StartupWindow | undefined, tray: DesktopTray, windows: PluginWindows;
let openActions = 0, quitActions = 0, documentReads = 0;
let splashFinishes = 0;
let startupRetries = 0, startupCloses = 0;
const errors: string[] = [], network: string[] = [];
const plugin: CapabilityPlugin = {
  id: 'stellar-guide', name: '星辰工作簿', version: '1.0.0', mcpServers: [], warnings: [],
  package: { ref: 'stellar-fixture-guide', provenance: 'recorded', documentation: {}, tutorials: [], links: [], warnings: [],
    desktop: { title: '星辰工作簿', surface: 'window', symbol: 'book', defaultPage: 'start',
      pages: [{ id: 'start', title: '航行记录', document: 'README.md' }, { id: 'notes', title: '校对记录', document: 'NOTES.md' }] } },
};
const colors = () => resolveTheme(preference, true);
const material = () => resolveThemeMaterial(registered ? packs.packs : [], preference);

app.whenReady().then(async () => {
  await packs.refresh();
  registerPluginThemes(packs.packs);
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  session.defaultSession.webRequest.onBeforeRequest((request, callback) => {
    const external = /^https?:/.test(request.url) && new URL(request.url).origin !== new URL(base).origin;
    if (external) network.push(request.url);
    callback({ cancel: external });
  });
  ipcMain.on('desktop:resolved-theme', event => {
    const value = colors();
    event.returnValue = { theme: value.scheme, palette: value.id, tokens: value.tokens,
      preference, systemDark: true, themePacks: registered ? packs.packs : [] };
  });
  ipcMain.handle('desktop-system-theme', () => ({ systemDark: true }));
  windows = new PluginWindows({ preload: join(__dirname, 'preload.cjs'), file: '', devUrl: base,
    background: () => colors().tokens['--bg'], noFocus: true });
  ipcMain.handle('desktop', (event, method, ...args) => {
    const owner = windows.owner(event);
    if (!owner || !pluginWindowMethodAllowed(method, args, owner.ref)) throw new Error('capability:invalid-input');
    if (method === 'pluginWindowState') return { plugin, preferences: { theme: preference, language: 'zh' },
      themeAppearance: { colors: colors(), material: material() } };
    if (method === 'windowControl') return { maximized: false, fullscreen: false, focused: false };
    if (method === 'pluginWindowConfigure') return;
    if (method === 'pluginDocument' && plugin.package!.desktop!.pages.some(page => page.document === args[0].path)) {
      documentReads++;
      return { path: args[0].path, text: args[0].path === 'README.md'
        ? '# 航行记录\n\n石墨阅读面，星辰细线。\n\n| 项目 | 状态 |\n| --- | --- |\n| 主题切换 | 待核对 |\n\n```ts\nconst theme = "stellar";\n```'
        : '# 校对记录\n\n这是一份隔离验收样例，不调用模型，也不读取实际会话。',
      images: {}, links: {} };
    }
    throw new Error('capability:invalid-input');
  });
  tray = new DesktopTray(join(desktop, 'build/icon.ico'), () => 'zh',
    () => { openActions++; }, () => { quitActions++; },
    { theme: () => colors().scheme, colors, material, motion: () => trayMotion, quitting: () => false, noFocus: true, devUrl: base,
      onError: error => errors.push(String(error)) });
  (globalThis as any).stellarFixture = {
    async openPlugin() {
      await windows.open(plugin);
      const window = BrowserWindow.getAllWindows().find(window => window.getTitle() === '星辰工作簿')!;
      window.setOpacity(0); window.setIgnoreMouseEvents(true); window.showInactive();
    },
    openTray() {
      const native = (tray as any).tray;
      native.emit('right-click', {}, native.getBounds());
    },
    setTheme(theme: string, available = true) {
      preference = theme; registered = available;
      registerPluginThemes(available ? packs.packs : []);
      windows.broadcast({ type: 'desktop_plugin_preferences_changed' });
      tray.relabel();
    },
    setTrayMotion(value: boolean) { trayMotion = value; tray.relabel(); },
    splash(motion = true, file = false, pending = false) {
      splash?.destroy();
      splash = new StartupWindow(true, file ? undefined : base, { material: material(), motion, pending },
        { retry: () => { startupRetries++; }, close: () => { startupCloses++; } });
    },
    configureSplash(motion = true) { splash?.setAppearance({ material: material(), motion }); },
    finishSplash() { splash?.finish(() => { splashFinishes++; }); },
    failSplash() { splash?.fail('INIT_FAILED'); },
    splashStage(stage: string) { splash?.setStage(stage); },
    spoofStartup() {
      const sender = BrowserWindow.getAllWindows().find(view => view.getTitle() === '星辰工作簿')!.webContents;
      ipcMain.emit('startup:command', { sender, senderFrame: sender.mainFrame }, 'close');
    },
    stats() { return { openActions, quitActions, documentReads, splashFinishes, startupRetries, startupCloses, errors, network }; },
  };
});
app.on('before-quit', () => { splash?.destroy(); tray?.dispose(); windows?.dispose(); });
app.on('window-all-closed', () => {});
