import { clipboard, Menu, WebContentsView, session, shell, type BrowserWindow } from 'electron';
import { randomUUID } from 'node:crypto';
import { browserBounds, browserNavigation, browserUrl, MAX_BROWSER_TABS } from './browser-policy';
import type { BrowserAction, BrowserBounds, BrowserEvent, BrowserSnapshot, BrowserTab } from '../src/contracts';

type Tab = { view: WebContentsView; info: BrowserTab; navigation: number };

export class BrowserTabs {
  private tabs = new Map<string, Tab>();
  private activeId?: string;
  private revision = 0;
  private bounds: BrowserBounds | null = null;
  private disposed = false;

  constructor(private window: BrowserWindow, private emit: (event: BrowserEvent) => void,
    private language: () => 'zh' | 'en') {
    const browserSession = session.fromPartition('persist:desktop-browser');
    browserSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    browserSession.setPermissionCheckHandler(() => false);
    browserSession.setDevicePermissionHandler(() => false);
    browserSession.on('will-download', (_event, item, contents) => {
      item.setSaveDialogOptions({ title: this.language() === 'zh' ? '保存下载' : 'Save download', defaultPath: item.getFilename() });
      if (![...this.tabs.values()].some(tab => tab.view.webContents === contents)) item.cancel();
    });
    window.webContents.on('did-start-loading', () => this.layout(null));
    window.on('resize', () => this.render());
    window.on('closed', () => this.dispose());
  }

  snapshot(): BrowserSnapshot {
    return { revision: this.revision, activeId: this.activeId, tabs: [...this.tabs.values()].map(tab => ({ ...tab.info })) };
  }
  private changed() {
    if (this.disposed) return;
    this.revision++;
    this.emit({ type: 'snapshot', snapshot: this.snapshot() });
  }
  private require(id: string) {
    const tab = this.tabs.get(id);
    if (!tab || this.disposed) throw new Error('Unknown browser tab');
    return tab;
  }
  open(address: string): BrowserSnapshot {
    const url = browserUrl(address);
    const existing = [...this.tabs.values()].find(tab => !tab.info.localFile && tab.info.url === url);
    return existing ? this.select(existing.info.id) : this.create(url);
  }
  openLocal(address: string, path: string, origin: string, reload = false): BrowserSnapshot {
    const existing = [...this.tabs.values()].find(tab => tab.info.localFile === path);
    if (existing) {
      if (reload) void this.load(existing, address);
      return this.select(existing.info.id);
    }
    return this.create(address, { path, origin });
  }
  create(address = 'about:blank', local?: { path: string; origin: string }): BrowserSnapshot {
    if (this.disposed || this.window.isDestroyed()) throw new Error('Browser is closed');
    if (this.tabs.size >= MAX_BROWSER_TABS) throw new Error('Browser tab limit reached');
    const url = browserUrl(address);
    const id = randomUUID();
    const view = new WebContentsView({ webPreferences: {
      partition: local ? `local-preview:${randomUUID()}` : 'persist:desktop-browser', nodeIntegration: false, nodeIntegrationInSubFrames: false,
      contextIsolation: true, sandbox: true, webSecurity: true, allowRunningInsecureContent: false,
      navigateOnDragDrop: false,
      backgroundThrottling: !(process.env.DESKTOP_TEST_NO_FOCUS === '1' && Boolean(process.env.DESKTOP_TEST_USER_DATA)),
    } });
    const tab: Tab = { view, navigation: 0, info: { id, title: '', url: 'about:blank', loading: false,
      canGoBack: false, canGoForward: false, zoom: 1, localFile: local?.path } };
    this.tabs.set(id, tab);
    view.setVisible(false);
    this.window.contentView.addChildView(view);
    const contents = view.webContents;
    if (local) {
      contents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
      contents.session.setPermissionCheckHandler(() => false);
      contents.session.setDevicePermissionHandler(() => false);
      contents.session.on('will-download', (_event, item) => item.cancel());
      contents.session.webRequest.onBeforeRequest((details, callback) => {
        let allowed = /^(data:|blob:|about:blank$)/.test(details.url);
        try { allowed ||= new URL(details.url).origin === local.origin; } catch { /* Block malformed URLs. */ }
        callback({ cancel: !allowed });
      });
    }
    const update = () => {
      if (!this.tabs.has(id) || contents.isDestroyed()) return;
      tab.info.canGoBack = contents.navigationHistory.canGoBack();
      tab.info.canGoForward = contents.navigationHistory.canGoForward();
      tab.info.zoom = contents.getZoomFactor();
      this.render();
      this.changed();
    };
    const navigation = (_event: unknown, target: string) => {
      tab.info.url = target; tab.info.error = undefined; update();
    };
    contents.on('did-navigate', navigation);
    contents.on('did-navigate-in-page', navigation);
    contents.on('did-start-loading', () => { tab.info.loading = true; tab.info.error = undefined; update(); });
    contents.on('did-stop-loading', () => {
      tab.info.loading = contents.isLoading();
      if (!tab.info.loading && !tab.info.error) {
        tab.info.url = contents.getURL() || 'about:blank';
        tab.info.title = contents.getTitle().slice(0, 512);
      }
      update();
    });
    contents.on('page-title-updated', (_event, title) => { tab.info.title = title.slice(0, 512); update(); });
    contents.on('did-fail-load', (_event, code, _description, target, mainFrame) => {
      if (!mainFrame || code === -3) return;
      tab.info.loading = false; tab.info.url = target; tab.info.error = `Load failed (${code})`; update();
    });
    contents.on('render-process-gone', () => {
      tab.info.loading = false; tab.info.error = 'Page process exited'; update();
    });
    const guard = (event: Electron.Event, target: string, _inPlace?: boolean, mainFrame = true) => {
      if (!browserNavigation(target) || (local && target !== 'about:blank' && new URL(target).origin !== local.origin)) {
        event.preventDefault();
        if (mainFrame) {
          tab.info.loading = false;
          tab.info.error = 'Navigation blocked';
          update();
        }
      }
    };
    contents.on('will-navigate', guard);
    contents.on('will-redirect', guard);
    contents.on('will-frame-navigate', event => {
      if (!browserNavigation(event.url) || (local && new URL(event.url).origin !== local.origin)) event.preventDefault();
    });
    contents.on('will-attach-webview', event => event.preventDefault());
    contents.setWindowOpenHandler(({ url }) => {
      if (browserNavigation(url) && this.tabs.size < MAX_BROWSER_TABS && (!local || new URL(url).origin === local.origin)) this.create(url, local);
      return { action: 'deny' };
    });
    contents.on('before-input-event', (event, input) => {
      if (input.type !== 'keyDown' || !input.control || input.alt || input.meta) return;
      const key = input.key.toLowerCase();
      if (key === 'l') { event.preventDefault(); this.emit({ type: 'address' }); this.window.webContents.focus(); }
      else if (key === 't') { event.preventDefault(); if (this.tabs.size < MAX_BROWSER_TABS) this.create(); }
      else if (key === 'w') { event.preventDefault(); this.close(id); }
      else if (key === 'r') { event.preventDefault(); contents.reload(); }
    });
    contents.on('context-menu', (_event, params) => {
      const items: Electron.MenuItemConstructorOptions[] = [];
      const t = (cn: string, en: string) => this.language() === 'zh' ? cn : en;
      if (params.linkURL && browserNavigation(params.linkURL)) {
        const allowed = !local || new URL(params.linkURL).origin === local.origin;
        items.push({ label: t('在新标签页打开链接', 'Open link in new tab'), enabled: allowed && this.tabs.size < MAX_BROWSER_TABS, click: () => { if (allowed) this.create(params.linkURL, local); } });
        items.push({ label: t('复制链接', 'Copy link'), click: () => { void clipboard.writeText(params.linkURL); } });
      }
      if (params.isEditable) items.push(
        { label: t('撤销', 'Undo'), click: () => contents.undo() },
        { label: t('重做', 'Redo'), click: () => contents.redo() }, { type: 'separator' },
        { label: t('剪切', 'Cut'), enabled: params.editFlags.canCut, click: () => contents.cut() },
        { label: t('复制', 'Copy'), enabled: params.editFlags.canCopy, click: () => contents.copy() },
        { label: t('粘贴', 'Paste'), enabled: params.editFlags.canPaste, click: () => contents.paste() },
        { label: t('全选', 'Select all'), click: () => contents.selectAll() });
      else if (params.selectionText) items.push({ label: t('复制', 'Copy'), click: () => contents.copy() });
      if (items.length) Menu.buildFromTemplate(items).popup({ window: this.window });
    });
    this.activeId = id;
    this.changed();
    if (url !== 'about:blank') void this.load(tab, url);
    else { this.window.webContents.focus(); this.emit({ type: 'address' }); }
    this.render();
    return this.snapshot();
  }
  private async load(tab: Tab, url: string) {
    const navigation = ++tab.navigation;
    const contents = tab.view.webContents;
    tab.info.url = url; tab.info.error = undefined; tab.info.loading = true; tab.info.title = '';
    this.render(); this.changed();
    try { await contents.loadURL(url); }
    catch (error) {
      if (this.tabs.get(tab.info.id) !== tab || contents.isDestroyed() || navigation !== tab.navigation) return;
      const failure = error as { code?: string; errno?: number };
      if (failure.code !== 'ERR_ABORTED' && failure.errno !== -3)
        tab.info.error ??= 'Load failed';
    }
    if (this.tabs.get(tab.info.id) !== tab || contents.isDestroyed() || navigation !== tab.navigation) return;
    tab.info.loading = contents.isLoading();
    if (!tab.info.loading && !tab.info.error) {
      tab.info.url = contents.getURL() || 'about:blank';
      tab.info.title = contents.getTitle().slice(0, 512);
    }
    tab.info.canGoBack = contents.navigationHistory.canGoBack();
    tab.info.canGoForward = contents.navigationHistory.canGoForward();
    this.render(); this.changed();
  }
  select(id: string): BrowserSnapshot {
    this.require(id);
    this.activeId = id; this.render(); this.changed();
    return this.snapshot();
  }
  close(id: string): BrowserSnapshot {
    const tab = this.require(id);
    const ids = [...this.tabs.keys()];
    if (this.activeId === id) this.activeId = ids[ids.indexOf(id) + 1] ?? ids[ids.indexOf(id) - 1];
    this.tabs.delete(id);
    this.window.contentView.removeChildView(tab.view);
    tab.view.webContents.close({ waitForBeforeUnload: false });
    this.render(); this.changed();
    return this.snapshot();
  }
  async action(id: string, action: BrowserAction, address?: string): Promise<BrowserSnapshot> {
    const tab = this.require(id);
    const contents = tab.view.webContents;
    switch (action) {
      case 'navigate':
        if (tab.info.localFile && browserUrl(address) !== tab.info.url) return this.open(browserUrl(address));
        await this.load(tab, browserUrl(address)); break;
      case 'back': if (contents.navigationHistory.canGoBack()) { tab.navigation++; contents.navigationHistory.goBack(); } break;
      case 'forward': if (contents.navigationHistory.canGoForward()) { tab.navigation++; contents.navigationHistory.goForward(); } break;
      case 'reload': tab.navigation++; tab.info.error = undefined; contents.reload(); break;
      case 'stop': tab.navigation++; contents.stop(); break;
      case 'zoomIn': contents.setZoomFactor(Math.min(2, contents.getZoomFactor() + .1)); break;
      case 'zoomOut': contents.setZoomFactor(Math.max(.5, contents.getZoomFactor() - .1)); break;
      case 'zoomReset': contents.setZoomFactor(1); break;
      case 'external':
        if (tab.info.localFile) {
          throw new Error('Local file opening requires a validated file permission');
        } else if (tab.info.url !== 'about:blank') await shell.openExternal(browserUrl(tab.info.url));
        break;
      default: throw new Error('Invalid browser action');
    }
    if (this.tabs.get(id) !== tab || contents.isDestroyed()) return this.snapshot();
    tab.info.zoom = contents.getZoomFactor();
    this.render(); this.changed();
    return this.snapshot();
  }
  layout(bounds: BrowserBounds | null) {
    const [width, height] = this.window.getContentSize();
    this.bounds = browserBounds(bounds, width, height);
    this.render();
  }
  private render() {
    if (this.window.isDestroyed() || this.disposed) return;
    const [width, height] = this.window.getContentSize();
    const bounds = browserBounds(this.bounds, width, height);
    for (const [id, tab] of this.tabs) {
      if (tab.view.webContents.isDestroyed()) continue;
      const visible = id === this.activeId && !!bounds && tab.info.url !== 'about:blank' && !tab.info.error;
      if (visible) tab.view.setBounds(bounds!);
      tab.view.setVisible(visible);
    }
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const tab of this.tabs.values()) {
      if (!this.window.isDestroyed()) this.window.contentView.removeChildView(tab.view);
      if (!tab.view.webContents.isDestroyed()) tab.view.webContents.close({ waitForBeforeUnload: false });
    }
    this.tabs.clear();
  }
}
