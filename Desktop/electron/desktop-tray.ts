import { BrowserWindow, ipcMain, screen, Tray, type IpcMainEvent, type Rectangle } from 'electron';
import { join } from 'node:path';
import { trayMenuPlacement } from './tray-menu-placement';
import type { TrayMenuState } from '../src/tray-menu-contract';

export class DesktopTray {
  private readonly tray: Tray;
  private menu?: BrowserWindow;
  private loading?: Promise<void>;
  private hideTimer?: NodeJS.Timeout;
  private visible = false;
  private disposed = false;
  private revision = 0;
  private origin: TrayMenuState['origin'] = 'bottom right';

  constructor(icon: string, private readonly language: () => 'zh' | 'en',
    private readonly open: () => void, private readonly quit: () => void,
    private readonly options: { theme: () => 'light' | 'dark'; quitting: () => boolean; noFocus?: boolean; devUrl?: string;
      onError: (error: unknown) => void }) {
    this.tray = new Tray(icon);
    this.tray.on('click', () => { this.hide(); open(); });
    this.tray.on('double-click', () => { this.hide(); open(); });
    this.tray.on('right-click', (_event, bounds) => {
      void this.show(bounds).catch(error => { this.hide(); this.options.onError(error); this.open(); });
    });
    ipcMain.on('tray-menu:state', this.readState);
    ipcMain.on('tray-menu:action', this.action);
    this.relabel();
  }

  private state(): TrayMenuState {
    return { language: this.language(), theme: this.options.theme(), visible: this.visible, origin: this.origin };
  }
  private trusted(event: IpcMainEvent) {
    return this.menu && !this.menu.isDestroyed() && event.sender === this.menu.webContents
      && event.senderFrame === this.menu.webContents.mainFrame;
  }
  private readState = (event: IpcMainEvent) => {
    event.returnValue = this.trusted(event) ? this.state() : null;
  };
  private action = (event: IpcMainEvent, action: unknown) => {
    if (!this.trusted(event) || !this.visible || typeof action !== 'string' || !['open', 'quit', 'dismiss'].includes(action)) return;
    this.hide();
    if (action === 'open') this.open();
    if (action === 'quit') this.quit();
  };

  private async show(bounds?: Rectangle) {
    if (this.disposed) return;
    const revision = ++this.revision;
    clearTimeout(this.hideTimer);
    if (!this.menu || this.menu.isDestroyed()) {
      const menu = new BrowserWindow({ width: 280, height: 112, frame: false, transparent: true,
        resizable: false, movable: false, minimizable: false, maximizable: false, skipTaskbar: true,
        alwaysOnTop: true, show: false, hasShadow: false, backgroundColor: '#00000000',
        focusable: !this.options.noFocus, ...(this.options.noFocus ? { opacity: 0 } : {}),
        webPreferences: { preload: join(__dirname, 'tray-preload.cjs'), nodeIntegration: false,
          contextIsolation: true, sandbox: true, backgroundThrottling: false } });
      this.menu = menu;
      menu.on('blur', () => this.hide());
      menu.on('close', event => {
        if (!this.disposed && !this.options.quitting()) { event.preventDefault(); this.hide(); }
      });
      menu.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      menu.webContents.on('will-navigate', event => event.preventDefault());
      this.loading = this.options.devUrl ? menu.loadURL(new URL('tray-menu.html', this.options.devUrl).href)
        : menu.loadFile(join(__dirname, 'renderer/tray-menu.html'));
    }
    const point = screen.getCursorScreenPoint();
    const anchor = bounds?.width ? bounds : { ...point, width: 0, height: 0 };
    await this.loading;
    if (this.disposed || revision !== this.revision || !this.menu || this.menu.isDestroyed()) return;
    const labels = this.language() === 'zh' ? ['打开 Desktop for Step Code', '退出应用']
      : ['Open Desktop for Step Code', 'Quit application'];
    // Measure with the renderer's actual font, including Windows font fallback.
    const size = await this.menu.webContents.executeJavaScript(`(() => {
      const button = document.querySelector('.tray-menu > button');
      const menu = document.querySelector('.tray-menu');
      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d');
      context.font = getComputedStyle(button).font;
      const textWidth = Math.max(...${JSON.stringify(labels)}.map(label => context.measureText(label).width));
      return { width: Math.ceil(textWidth + 50), height: Math.ceil(menu.offsetHeight + 20) };
    })()`);
    if (this.disposed || revision !== this.revision || !this.menu || this.menu.isDestroyed()) return;
    const placement = trayMenuPlacement(anchor, screen.getDisplayNearestPoint({
      x: anchor.x + anchor.width / 2, y: anchor.y + anchor.height / 2,
    }).workArea, size);
    this.origin = placement.origin;
    this.visible = true;
    this.menu.setBounds(placement.bounds);
    this.menu.webContents.send('tray-menu:changed', this.state());
    if (this.options.noFocus) this.menu.showInactive();
    else { this.menu.show(); this.menu.focus(); }
  }

  private hide() {
    this.revision++;
    this.visible = false;
    if (!this.menu || this.menu.isDestroyed()) return;
    this.menu.webContents.send('tray-menu:changed', this.state());
    clearTimeout(this.hideTimer);
    this.hideTimer = setTimeout(() => {
      if (!this.visible && this.menu && !this.menu.isDestroyed()) this.menu.hide();
    }, 180);
  }

  relabel() {
    this.tray.setToolTip('Desktop for Step Code');
    if (this.menu && !this.menu.isDestroyed()) this.menu.webContents.send('tray-menu:changed', this.state());
  }

  dispose() {
    this.disposed = true;
    clearTimeout(this.hideTimer);
    ipcMain.removeListener('tray-menu:state', this.readState);
    ipcMain.removeListener('tray-menu:action', this.action);
    this.menu?.destroy();
    this.tray.destroy();
  }
}
