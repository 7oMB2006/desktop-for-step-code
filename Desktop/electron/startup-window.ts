import { BrowserWindow, screen } from 'electron';
import { join } from 'node:path';

/** A separate transparent window; never grants the splash the desktop bridge. */
export class StartupWindow {
  private splash: BrowserWindow | undefined;
  private paintedAt = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private hideTimer: ReturnType<typeof setTimeout> | undefined;
  private finishing = false;
  private disposed = false;

  constructor(private readonly background: boolean, devUrl?: string) {
    // Cocoa's native center is visually above the display midpoint. Place the
    // splash geometrically on the display where the user launches the app.
    const display = process.platform === 'darwin'
      ? screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).bounds : undefined;
    const splash = new BrowserWindow({
      width: 256, height: 256,
      ...(display ? { x: Math.round(display.x + (display.width - 256) / 2),
        y: Math.round(display.y + (display.height - 256) / 2) } : { center: true }), frame: false, thickFrame: false, transparent: true,
      backgroundColor: '#00000000', hasShadow: false, resizable: false,
      minimizable: false, maximizable: false, focusable: false, skipTaskbar: true,
      // On Windows, a non-topmost cold-start window can composite as an opaque
      // rectangle despite transparent CSS. This overlay never takes focus.
      show: false, alwaysOnTop: true,
      webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, backgroundThrottling: false },
    });
    this.splash = splash;
    splash.setIgnoreMouseEvents(true);
    splash.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    splash.webContents.on('will-navigate', event => event.preventDefault());
    splash.once('ready-to-show', () => {
      this.paintedAt = Date.now();
      if (!this.background && !this.finishing && !this.disposed) {
        splash.showInactive();
        // A stalled initialization must not leave an indefinitely topmost logo.
        this.hideTimer = setTimeout(() => { if (!splash.isDestroyed()) splash.hide(); }, 10000);
      }
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
    clearTimeout(this.hideTimer);
    if (this.splash && !this.splash.isDestroyed()) this.splash.destroy();
    this.splash = undefined;
  }
}
