import { BrowserWindow } from 'electron';
import { join } from 'node:path';

/** A separate transparent window; never grants the splash the desktop bridge. */
export class StartupWindow {
  private splash: BrowserWindow | undefined;
  private paintedAt = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private finishing = false;
  private disposed = false;

  constructor(private readonly background: boolean, devUrl?: string) {
    const splash = new BrowserWindow({
      width: 220, height: 220, center: true, frame: false, transparent: true,
      backgroundColor: '#00000000', hasShadow: false, resizable: false,
      minimizable: false, maximizable: false, focusable: false, skipTaskbar: true,
      show: false,
      webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, backgroundThrottling: false },
    });
    this.splash = splash;
    splash.setIgnoreMouseEvents(true);
    splash.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    splash.webContents.on('will-navigate', event => event.preventDefault());
    splash.once('ready-to-show', () => {
      this.paintedAt = Date.now();
      if (!this.background && !this.finishing && !this.disposed) splash.showInactive();
    });
    const loaded = devUrl
      ? splash.loadURL(new URL('startup-logo.html', devUrl).href)
      : splash.loadFile(join(__dirname, 'renderer/startup-logo.html'));
    // A missing splash asset must not terminate initialization or hide the main window.
    void loaded.catch(() => { if (!splash.isDestroyed()) splash.hide(); });
  }

  finish(showMain: () => void) {
    if (this.finishing) return;
    this.finishing = true;
    // Time only the logo entrance, not runtime/model initialization.
    const wait = this.paintedAt ? Math.max(0, 650 - (Date.now() - this.paintedAt)) : 0;
    this.timer = setTimeout(() => {
      if (this.disposed) return;
      showMain();
      this.destroy();
    }, wait);
  }

  destroy() {
    this.disposed = true;
    clearTimeout(this.timer);
    if (this.splash && !this.splash.isDestroyed()) this.splash.destroy();
    this.splash = undefined;
  }
}
