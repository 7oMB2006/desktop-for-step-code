import { BrowserWindow, screen, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron';
import { readFile, writeFile } from 'node:fs/promises';
import type { MiniChatState } from '../src/window-conversation';

type Geometry = { x?: number; y?: number; width: number; height: number; pinned: boolean };
// Taskbar-relative "floating" can lose topmost status when Windows hides its taskbar.
const pinLevel = process.platform === 'win32' ? 'normal' : 'floating';
export class MiniChatWindow {
  window?: BrowserWindow;
  private opening?: Promise<void>;
  private geometry: Geometry = { width: 470, height: 680, pinned: false };
  private timer?: ReturnType<typeof setTimeout>;
  private saving: Promise<void> = Promise.resolve();
  private disposing = false;
  constructor(private options: {
    preload: string; file: string; devUrl?: string; stateFile: string; background: () => string;
    noFocus: boolean; changed: (state: MiniChatState) => void; error: (error: unknown) => void;
    created: (window: BrowserWindow) => void;
  }) {}
  owns(event: IpcMainInvokeEvent | IpcMainEvent) {
    const contents = this.window?.webContents;
    return Boolean(contents && !contents.isDestroyed() && event.sender === contents && event.senderFrame === contents.mainFrame);
  }
  state(): MiniChatState {
    return { open: Boolean(this.window && !this.window.isDestroyed() && this.window.isVisible()),
      pinned: this.window?.isAlwaysOnTop() ?? this.geometry.pinned };
  }
  async open() {
    if (!this.window || this.window.isDestroyed()) {
      this.opening ??= this.create().finally(() => { this.opening = undefined; });
      await this.opening;
    } else if (this.opening) await this.opening;
    const window = this.window!;
    if (window.isMinimized()) window.restore();
    if (!this.options.noFocus) { window.show(); window.focus(); }
    this.options.changed(this.state());
    return this.state();
  }
  hide() {
    this.window?.webContents.send('runtime-event', { type: 'desktop_capture_presentation' });
    this.window?.hide(); this.options.changed(this.state());
  }
  pin(pinned: boolean) {
    if (typeof pinned !== 'boolean') throw new Error('Invalid pin state');
    this.geometry.pinned = pinned;
    this.window?.setAlwaysOnTop(pinned, pinLevel);
    this.saveSoon();
    this.options.changed(this.state());
    return this.state();
  }
  private async create() {
    try {
      const saved = JSON.parse(await readFile(this.options.stateFile, 'utf8'));
      if (saved && [saved.width, saved.height].every(value => typeof value === 'number' && Number.isFinite(value))) {
        this.geometry = { width: Math.round(Math.max(360, Math.min(900, saved.width))),
          height: Math.round(Math.max(360, Math.min(1200, saved.height))), pinned: saved.pinned === true,
          ...([saved.x, saved.y].every(value => typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 100000)
            ? { x: Math.round(saved.x), y: Math.round(saved.y) } : {}) };
      }
    } catch { /* Missing or corrupt geometry uses the default size. */ }
    const area = screen.getDisplayMatching({
      x: this.geometry.x ?? 0, y: this.geometry.y ?? 0, width: this.geometry.width, height: this.geometry.height,
    }).workArea;
    const width = Math.min(area.width, Math.max(360, Math.min(900, this.geometry.width)));
    const height = Math.min(area.height, Math.max(360, Math.min(1200, this.geometry.height)));
    const window = new BrowserWindow({
      width, height, minWidth: Math.min(360, area.width), minHeight: Math.min(360, area.height),
      ...(this.geometry.x !== undefined ? {
        x: Math.round(Math.max(area.x, Math.min(area.x + area.width - width, this.geometry.x))),
        y: Math.round(Math.max(area.y, Math.min(area.y + area.height - height, this.geometry.y!))),
      } : {}),
      title: 'MiniChat', frame: false, show: false, autoHideMenuBar: true,
      backgroundColor: this.options.background(), focusable: !this.options.noFocus,
      webPreferences: { preload: this.options.preload, nodeIntegration: false, contextIsolation: true, sandbox: true,
        additionalArguments: ['--desktop-mini-chat'], ...(this.options.noFocus ? { backgroundThrottling: false } : {}) },
    });
    this.window = window;
    window.setAlwaysOnTop(this.geometry.pinned, pinLevel);
    this.options.created(window);
    window.on('page-title-updated', event => event.preventDefault());
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', event => event.preventDefault());
    window.on('close', event => { if (!this.disposing) { event.preventDefault(); this.hide(); } });
    const geometryChanged = () => {
      if (!window.isDestroyed() && !window.isMinimized() && !window.isMaximized())
        Object.assign(this.geometry, window.getBounds());
      this.saveSoon();
    };
    window.on('resize', geometryChanged);
    window.on('move', geometryChanged);
    try {
      if (this.options.devUrl) await window.loadURL(this.options.devUrl);
      else await window.loadFile(this.options.file);
    } catch (error) { window.destroy(); this.window = undefined; throw error; }
  }
  private saveSoon() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => { void this.save(); }, 180);
  }
  private save() {
    const content = JSON.stringify(this.geometry);
    this.saving = this.saving.then(() => writeFile(this.options.stateFile, content, 'utf8')).catch(this.options.error);
    return this.saving;
  }
  async dispose() {
    this.disposing = true;
    clearTimeout(this.timer);
    await this.save();
    if (this.window && !this.window.isDestroyed()) this.window.destroy();
  }
}
