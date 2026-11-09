import { BrowserWindow, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron';
import type { CapabilityPlugin } from '../src/capabilities';

export class PluginWindows {
  private windows = new Map<string, { ref: string; window: BrowserWindow; ready: Promise<void> }>();
  constructor(private options: {
    preload: string; file: string; devUrl?: string; background(): string; noFocus: boolean;
    openExternal?(url: string): Promise<void> | void;
  }) {}
  owner(event: IpcMainEvent | IpcMainInvokeEvent) {
    for (const entry of this.windows.values()) {
      if (entry.window.isDestroyed()) continue;
      const contents = entry.window.webContents;
      if (!contents.isDestroyed()
        && event.sender === contents && event.senderFrame === contents.mainFrame) return entry;
    }
  }
  async open(plugin: CapabilityPlugin) {
    const pkg = plugin.package;
    if (!pkg?.desktop || pkg.desktop.surface !== 'window') throw new Error('capability:invalid-input');
    let entry = this.windows.get(plugin.id);
    if (entry && entry.ref !== pkg.ref) { entry.window.destroy(); this.windows.delete(plugin.id); entry = undefined; }
    if (!entry || entry.window.isDestroyed()) {
      if (this.windows.size >= 8) throw new Error('capability:too-large');
      const window = new BrowserWindow({
        title: pkg.desktop.title, width: 920, height: 720, minWidth: 390, minHeight: 360,
        show: false, frame: process.platform === 'darwin',
        ...(process.platform === 'darwin' ? { titleBarStyle: 'hiddenInset' as const, trafficLightPosition: { x: 20, y: 19 } } : {}),
        autoHideMenuBar: true, backgroundColor: this.options.background(),
        focusable: !this.options.noFocus,
        webPreferences: { preload: this.options.preload, nodeIntegration: false, contextIsolation: true, sandbox: true,
          additionalArguments: ['--desktop-plugin-window'] },
      });
      window.on('page-title-updated', event => event.preventDefault());
      window.webContents.on('will-navigate', event => event.preventDefault());
      window.webContents.setWindowOpenHandler(({ url }) => {
        try {
          const target = new URL(url);
          if (target.protocol === 'https:' && !target.username && !target.password)
            void Promise.resolve(this.options.openExternal?.(target.href)).catch(() => {});
        } catch {}
        return { action: 'deny' };
      });
      const windowState = () => {
        if (!window.isDestroyed() && !window.webContents.isDestroyed())
          window.webContents.send('runtime-event', { type: 'desktop_window_state',
            maximized: window.isMaximized(), fullscreen: window.isFullScreen(), focused: window.isFocused() });
      };
      window.on('maximize', windowState);
      window.on('unmaximize', windowState);
      window.on('enter-full-screen', windowState);
      window.on('leave-full-screen', windowState);
      window.on('focus', windowState);
      window.on('blur', windowState);
      window.on('closed', () => { if (this.windows.get(plugin.id)?.window === window) this.windows.delete(plugin.id); });
      const ready = this.options.devUrl ? window.loadURL(this.options.devUrl) : window.loadFile(this.options.file);
      entry = { window, ref: pkg.ref, ready };
      this.windows.set(plugin.id, entry);
      try { await ready; } catch (error) { window.destroy(); throw error; }
    } else await entry.ready;
    if (entry.window.isDestroyed()) throw new Error('capability:stale');
    if (entry.window.isMinimized()) entry.window.restore();
    if (!this.options.noFocus) { entry.window.show(); entry.window.focus(); }
  }
  broadcast(event: { type: string; [key: string]: unknown }) {
    if (!['desktop_system_theme', 'desktop_plugin_catalog_changed', 'desktop_plugin_preferences_changed'].includes(event.type)) return;
    const message = event.type === 'desktop_system_theme' ? { type: event.type, dark: Boolean(event.dark) } : { type: event.type };
    for (const { window } of this.windows.values()) if (!window.isDestroyed())
      window.webContents.send('runtime-event', message);
  }
  invalidate() {
    for (const { window } of this.windows.values()) if (!window.isDestroyed())
      window.webContents.send('runtime-event', { type: 'desktop_plugin_catalog_changed' });
  }
  setBackground(color: string) {
    for (const { window } of this.windows.values()) if (!window.isDestroyed()) {
      window.setBackgroundColor(color);
      window.webContents.send('runtime-event', { type: 'desktop_plugin_preferences_changed' });
    }
  }
  dispose() {
    for (const { window } of this.windows.values()) if (!window.isDestroyed()) window.destroy();
    this.windows.clear();
  }
}
