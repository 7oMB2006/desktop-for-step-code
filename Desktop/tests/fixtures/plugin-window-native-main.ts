import { app, BrowserWindow, ipcMain, session } from 'electron';
import { join } from 'node:path';
import { PluginWindows } from '../../electron/plugin-windows';
import { pluginWindowMethodAllowed } from '../../electron/plugin-window-policy';
import type { CapabilityPlugin } from '../../src/capabilities';

const root = process.env.DESKTOP_PLUGIN_NATIVE_ROOT;
if (!root || !process.env.DESKTOP_TEST_USER_DATA) throw new Error('An isolated plugin-window fixture root is required');
app.setPath('userData', process.env.DESKTOP_TEST_USER_DATA);
let main: BrowserWindow;
let windows: PluginWindows;
const current = new Map<string, CapabilityPlugin>();
const denied: string[] = [], external: string[] = [], network: string[] = [];
let configurationRequests = 0, documentReads = 0, stale = false;
const makePlugin = (id: string, ref = `native-${id}`): CapabilityPlugin => ({
  id, name: `Plugin ${id}`, mcpServers: [], warnings: [],
  package: { ref, provenance: 'recorded', documentation: {}, tutorials: [], links: [], warnings: [],
    desktop: { title: `Native plugin ${id}`, surface: 'window', symbol: 'book', defaultPage: 'start',
      pages: [{ id: 'start', title: 'Start', document: 'guide.md' }] } },
});
const currentPlugin = (ref: string) => {
  const plugin = [...current.values()].find(item => item.package?.ref === ref);
  if (stale || !plugin) throw new Error('capability:stale');
  return plugin;
};
app.whenReady().then(async () => {
  session.defaultSession.webRequest.onBeforeRequest((request, callback) => {
    if (/^https?:/u.test(request.url)) { network.push(request.url); callback({ cancel: true }); }
    else callback({});
  });
  ipcMain.on('desktop:resolved-theme', event => { event.returnValue = { theme: 'light', systemDark: false }; });
  ipcMain.handle('desktop-system-theme', () => ({ systemDark: false }));
  main = new BrowserWindow({ title: 'Plugin native fixture main', width: 640, height: 480,
    show: false, focusable: false, webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true } });
  await main.loadURL('about:blank');
  windows = new PluginWindows({
    preload: join(root, 'preload.cjs'), file: join(root, 'plugin-window-native.html'),
    background: () => '#ffffff', noFocus: true,
    openExternal: (url: string) => { external.push(url); },
  });
  ipcMain.handle('desktop', async (event, method, ...args) => {
    const owner = windows.owner(event);
    if (!owner || !pluginWindowMethodAllowed(method, args, owner.ref)) {
      denied.push(String(method)); throw new Error('capability:invalid-input');
    }
    if (method === 'windowControl') {
      const view = owner.window;
      if (args[0] === 'minimize') view.minimize();
      if (args[0] === 'toggleMaximize') view.isMaximized() ? view.unmaximize() : view.maximize();
      if (args[0] === 'close') view.close();
      return view.isDestroyed() ? { maximized: false, fullscreen: false, focused: false }
        : { maximized: view.isMaximized(), fullscreen: view.isFullScreen(), focused: view.isFocused() };
    }
    const plugin = currentPlugin(owner.ref);
    if (method === 'pluginWindowState') return { plugin, preferences: { language: 'en', theme: 'light' } };
    if (method === 'pluginWindowConfigure') { configurationRequests++; return; }
    if (!plugin.package!.desktop!.pages.some(page => page.document === args[0].path))
      throw new Error('capability:invalid-path');
    documentReads++;
    return { path: args[0].path, text: `# Isolated guide for ${plugin.id}`, images: {}, links: {} };
  });
  (globalThis as any).pluginWindowNative = {
    open: async (id: string, ref?: string) => {
      const plugin = makePlugin(id, ref);
      current.set(id, plugin); stale = false;
      await windows.open(plugin);
      const view = BrowserWindow.getAllWindows().find(view => view.getTitle() === plugin.package!.desktop!.title)!;
      view.setOpacity(0); view.setIgnoreMouseEvents(true); view.showInactive();
      return view.id;
    },
    stats: () => ({
      mainId: main.id, mainAlive: !main.isDestroyed(), configurationRequests, documentReads,
      denied: [...denied], external: [...external], network: [...network],
      windows: BrowserWindow.getAllWindows().filter(view => view !== main).map(view => {
        const contents = view.webContents as Electron.WebContents & {
          getLastWebPreferences(): Electron.WebPreferences;
        };
        const preferences = contents.getLastWebPreferences();
        return { id: view.id, title: view.getTitle(), minimized: view.isMinimized(),
          nodeIntegration: preferences.nodeIntegration, contextIsolation: preferences.contextIsolation,
          sandbox: preferences.sandbox };
      }),
    }),
    broadcast: (type: string, dark?: unknown) => windows.broadcast({ type, dark, secret: 'must-not-reach-plugin' }),
    background: () => windows.setBackground('#ffffff'),
    invalidate: () => { stale = true; windows.invalidate(); },
    failedLoad: async () => {
      const failing = new PluginWindows({ preload: join(root, 'preload.cjs'),
        file: join(root, 'missing-plugin-window.html'), background: () => '#ffffff', noFocus: true });
      let message = '';
      try { await failing.open(makePlugin('failed')); } catch (error) { message = String(error); }
      finally { failing.dispose(); }
      return message;
    },
  };
});
app.on('before-quit', () => windows?.dispose());
app.on('window-all-closed', () => {});
