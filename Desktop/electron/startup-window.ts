import { app, BrowserWindow, ipcMain, screen, type IpcMainEvent } from 'electron';
import { join } from 'node:path';
import { STARTUP_FINISH_TIMEOUT_MS } from '../src/startup-motion';
import {
  STARTUP_NOTICE_MS, STARTUP_RECOVERY_MS, startupCommandAllowed,
  type StartupFailure, type StartupRecoveryState,
} from '../src/startup-recovery-contract';

type StartupAppearance = { material?: 'stellar'; motion?: boolean; pending?: boolean };

/** A separate transparent window with only a sender-bound startup recovery bridge. */
export class StartupWindow {
  private splash: BrowserWindow | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private noticeTimer: ReturnType<typeof setTimeout> | undefined;
  private recoveryTimer: ReturnType<typeof setTimeout> | undefined;
  private finishing = false;
  private disposed = false;
  private loaded = false;
  private showMain: (() => void) | undefined;
  private awaitingEntrance = false;
  private appearance: StartupAppearance;
  private readonly started = Date.now();
  private state: StartupRecoveryState = {
    surface: 'transparent', stage: 'initialization', elapsed: 0,
    version: app.getVersion(), platform: `${process.platform}-${process.arch}`, busy: false,
  };

  constructor(private readonly background: boolean, devUrl?: string,
    appearance: StartupAppearance = {},
    private readonly actions: { retry: () => void; close: () => void } = { retry: () => app.quit(), close: () => app.quit() }) {
    this.appearance = appearance;
    // Reserve invisible space below the centered emblem from the first frame.
    // Showing recovery never resizes the native window or shifts the emblem.
    const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
    const width = Math.min(360, area.width - 32);
    const height = Math.min(480, Math.floor(area.height / 2 + 128));
    const splash = new BrowserWindow({
      width, height, x: Math.round(area.x + (area.width - width) / 2),
      y: Math.round(area.y + area.height / 2 - 128),
      frame: false, thickFrame: false, transparent: true,
      backgroundColor: '#00000000', hasShadow: false, resizable: false,
      minimizable: false, maximizable: false, focusable: false, skipTaskbar: true,
      // On Windows, a non-topmost cold-start window can composite as an opaque
      // rectangle despite transparent CSS. This overlay never takes focus.
      show: false, alwaysOnTop: true,
      webPreferences: { preload: join(__dirname, 'startup-preload.cjs'),
        nodeIntegration: false, contextIsolation: true, sandbox: true, backgroundThrottling: false },
    });
    this.splash = splash;
    if (process.platform === 'win32') splash.setAlwaysOnTop(true, 'normal');
    splash.setIgnoreMouseEvents(true);
    ipcMain.on('startup:command', this.onCommand);
    splash.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    splash.webContents.on('will-navigate', event => event.preventDefault());
    splash.webContents.once('did-finish-load', () => {
      this.loaded = true;
      this.updateAppearance();
      this.publish();
      this.finishWhenReady();
    });
    splash.once('ready-to-show', () => {
      if (!this.background && !this.disposed) {
        splash.showInactive();
      }
    });
    this.noticeTimer = setTimeout(() => this.setSurface('notice'), STARTUP_NOTICE_MS);
    this.recoveryTimer = setTimeout(() => this.setSurface('recovery'), STARTUP_RECOVERY_MS);
    const query = { material: appearance.pending ? 'pending' : appearance.material === 'stellar' ? 'stellar' : 'default',
      motion: appearance.motion === false ? 'off' : 'on' };
    const url = devUrl ? new URL('startup-logo.html', devUrl) : undefined;
    if (url) url.search = new URLSearchParams(query).toString();
    const loaded = url
      ? splash.loadURL(url.href)
      : splash.loadFile(join(__dirname, 'renderer/startup-logo.html'), { query });
    // A missing splash asset must not terminate initialization or hide the main window.
    void loaded.catch(() => {
      if (this.disposed) return;
      if (!splash.isDestroyed()) splash.hide();
      this.loaded = false;
    });
  }

  private onCommand = (event: IpcMainEvent, command: unknown) => {
    const splash = this.splash;
    if (this.disposed || this.finishing || !splash || splash.isDestroyed() || event.sender !== splash.webContents
      || event.senderFrame !== splash.webContents.mainFrame || !startupCommandAllowed(command, this.state)) return;
    if (command === 'ready') { this.publish(); return; }
    if (command === 'continue') {
      this.setSurface('notice');
      clearTimeout(this.recoveryTimer);
      this.recoveryTimer = setTimeout(() => this.setSurface('recovery'), STARTUP_RECOVERY_MS);
      return;
    }
    this.state.busy = true;
    clearTimeout(this.noticeTimer); clearTimeout(this.recoveryTimer);
    this.publish();
    try { this.actions[command](); } catch { this.fail('STOP_FAILED'); }
  };

  setStage(stage: string) {
    // The caller supplies a fixed stage identifier, never a raw error or path.
    if (!/^[a-z-]{1,48}$/.test(stage)) return;
    this.state.stage = stage;
    this.publish();
  }

  get active() { return !this.disposed; }

  fail(failure: StartupFailure) {
    if (this.disposed) return;
    clearTimeout(this.timer);
    clearTimeout(this.noticeTimer); clearTimeout(this.recoveryTimer);
    this.finishing = false;
    this.showMain = undefined;
    this.state.failure = failure;
    this.state.busy = false;
    this.setSurface('recovery');
  }

  private setSurface(surface: StartupRecoveryState['surface']) {
    if (this.disposed || this.state.busy || this.finishing) return;
    if (this.state.failure && surface !== 'recovery') return;
    this.state.surface = surface;
    const splash = this.splash;
    if (splash && !splash.isDestroyed()) {
      const interactive = surface === 'recovery';
      splash.setIgnoreMouseEvents(!interactive);
      splash.setFocusable(interactive && !this.background);
      // Recovery belongs to the app, not permanently above other applications.
      if (interactive) splash.setAlwaysOnTop(false);
    }
    this.publish();
  }

  private publish() {
    if (!this.loaded || this.disposed || !this.splash || this.splash.isDestroyed()) return;
    this.splash.webContents.send('startup:state', { ...this.state, elapsed: Date.now() - this.started });
  }

  setAppearance(appearance: StartupAppearance) {
    this.appearance = appearance;
    this.updateAppearance();
  }

  private updateAppearance() {
    if (!this.loaded || !this.splash || this.splash.isDestroyed() || this.disposed) return;
    // Bounded cosmetic values only; no desktop data crosses this boundary.
    const material = this.appearance.pending ? 'pending' : this.appearance.material === 'stellar' ? 'stellar' : 'default';
    const motion = this.appearance.motion === false ? 'off' : 'on';
    void this.splash.webContents.executeJavaScript(`{
      document.documentElement.dataset.startupMaterial = ${JSON.stringify(material)};
      document.documentElement.dataset.motion = ${JSON.stringify(motion)};
      window.dispatchEvent(new Event('startup-appearance'));
    }`).catch(() => {});
  }

  finish(showMain: () => void) {
    if (this.finishing || this.disposed || this.state.busy || this.state.failure) return;
    this.finishing = true;
    clearTimeout(this.noticeTimer); clearTimeout(this.recoveryTimer);
    this.showMain = showMain;
    // A broken/hidden renderer must not hold an otherwise usable shell hostage.
    this.timer = setTimeout(() => this.revealMain(), STARTUP_FINISH_TIMEOUT_MS);
    this.finishWhenReady();
  }

  private finishWhenReady() {
    if (!this.finishing || !this.loaded || this.awaitingEntrance || this.disposed || !this.splash) return;
    this.awaitingEntrance = true;
    // Observe the rendered entrance, not native ready-to-show or preference I/O.
    // Completion observation remains independent of recovery IPC.
    void this.splash.webContents.executeJavaScript(`new Promise(resolve => {
      const root = document.documentElement;
      if (root.dataset.startupComplete === 'true') { resolve(); return; }
      const observer = new MutationObserver(() => {
        if (root.dataset.startupComplete !== 'true') return;
        observer.disconnect(); clearTimeout(timer); resolve();
      });
      const timer = setTimeout(() => { observer.disconnect(); resolve(); }, ${STARTUP_FINISH_TIMEOUT_MS});
      observer.observe(root, { attributes: true, attributeFilter: ['data-startup-complete'] });
    })`).then(() => { if (this.finishing) this.revealMain(); }).catch(() => { if (this.finishing) this.revealMain(); });
  }

  private revealMain() {
    if (this.disposed) return;
    const show = this.showMain;
    this.showMain = undefined;
    try { show?.(); } finally { this.destroy(); }
  }

  destroy() {
    this.disposed = true;
    clearTimeout(this.timer);
    clearTimeout(this.noticeTimer); clearTimeout(this.recoveryTimer);
    ipcMain.removeListener('startup:command', this.onCommand);
    if (this.splash && !this.splash.isDestroyed()) this.splash.destroy();
    this.splash = undefined;
  }
}
