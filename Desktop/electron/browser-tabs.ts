import { clipboard, Menu, WebContentsView, session, shell, type BrowserWindow } from 'electron';
import { randomUUID } from 'node:crypto';
import { browserBounds, browserNavigation, browserPreviewUrl, browserUrl, MAX_BROWSER_TABS } from './browser-policy';
import { PlaywrightPreview, type PreviewInput } from './playwright-preview';
import { previewResourceAllowed } from './playwright-preview-scope';
import type { BrowserAction, BrowserBounds, BrowserEvent, BrowserSnapshot, BrowserTab } from '../src/contracts';

type Tab = { view: WebContentsView; info: BrowserTab; owner: string; navigation: number; previewOrigin?: string;
  testOrigin?: string; initialLoad?: Promise<void>; playwright?: PlaywrightPreview };
type TabOptions = { local?: { path: string; origin: string }; activate?: boolean; previewOrigin?: string; testOrigin?: string };
type Conversation = { activeId?: string };

export class BrowserTabs {
  private tabs = new Map<string, Tab>();
  private conversations = new Map<string, Conversation>();
  private owner: string;
  private context = 0;
  private revision = 0;
  private bounds: BrowserBounds | null = null;
  private disposed = false;
  private automation = new Map<string, Tab>();
  private playwrightCleanup = new Set<Promise<void>>();

  constructor(private window: BrowserWindow, private emit: (event: BrowserEvent) => void,
    private language: () => 'zh' | 'en', private currentOwner: () => string) {
    this.owner = currentOwner();
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
    window.on('minimize', () => this.render());
    window.on('restore', () => this.render());
    window.on('closed', () => this.dispose());
  }

  sync() {
    const next = this.currentOwner();
    if (this.owner === next) return;
    this.owner = next;
    this.context++;
    this.bounds = null;
    this.render();
    this.changed();
  }
  assertContext(expected?: unknown) {
    this.sync();
    if (expected !== undefined && expected !== this.context) throw new Error('Browser conversation changed');
    return this.context;
  }
  hasTabs(owner: string) {
    return this.conversations.get(owner)?.activeId !== undefined;
  }
  promoteDraft(previous: string, next: string) {
    const source = this.conversations.get(previous);
    if (!source || !next || previous === next) return;
    for (const tab of this.tabs.values()) if (tab.owner === previous) tab.owner = next;
    this.conversations.set(next, { activeId: this.conversations.get(next)?.activeId ?? source.activeId });
    this.conversations.delete(previous);
    this.render();
    this.changed();
  }
  discard(owner: string) {
    if (!this.conversations.delete(owner)) return;
    for (const tab of this.tabs.values()) if (tab.owner === owner) this.destroy(tab);
    this.render();
    this.changed();
  }
  private activeTab() {
    const id = this.conversations.get(this.owner)?.activeId;
    return id ? this.tabs.get(id) : undefined;
  }
  private canCreate() {
    return this.owner !== '' && this.tabs.size < MAX_BROWSER_TABS;
  }
  snapshot(): BrowserSnapshot {
    return { revision: this.revision, owner: this.owner, context: this.context, canCreate: this.canCreate(),
      activeId: this.activeTab()?.info.id, tabs: [...this.tabs.values()]
        .filter(tab => tab.owner === this.owner).map(tab => ({ ...tab.info })) };
  }
  private changed() {
    if (this.disposed) return;
    this.revision++;
    this.emit({ type: 'snapshot', snapshot: this.snapshot() });
  }
  private require(id: string) {
    const tab = this.tabs.get(id);
    if (!tab || tab.owner !== this.owner || this.disposed) throw new Error('Unknown browser tab');
    return tab;
  }
  open(address: string): BrowserSnapshot {
    const url = browserUrl(address);
    const existing = [...this.tabs.values()].find(tab => tab.owner === this.owner && !tab.info.localFile && tab.info.url === url);
    return existing ? this.select(existing.info.id) : this.create(url);
  }
  openPreview(owner: string, address: string) {
    this.sync();
    if (this.disposed || this.window.isDestroyed()) throw new Error('Browser is closed');
    const url = browserPreviewUrl(address);
    const existing = [...this.tabs.values()].find(tab => tab.owner === owner && !tab.info.localFile && tab.info.url === url);
    const tab = existing ?? this.createTab(owner, url, { previewOrigin: new URL(url).origin });
    if (existing) {
      this.conversations.set(owner, { activeId: tab.info.id });
      this.render();
      this.changed();
    }
    this.emit({ type: 'open-preview', owner });
    return { opened: true, tabId: tab.info.id, reused: Boolean(existing),
      load: tab.info.error ? 'failed' : tab.info.loading ? 'loading' : 'loaded' } as const;
  }
  async startPlaywright(owner: string, worker: string, address: string, signal: AbortSignal | undefined, takeReveal: () => boolean) {
    if (signal?.aborted || this.disposed || this.automation.has(worker)) throw new Error('Preview cannot start');
    const url = browserPreviewUrl(address);
    const origin = new URL(url).origin;
    let tab = [...this.tabs.values()].find(value => value.owner === owner && value.testOrigin === origin && value.info.url === url
      && !value.info.error && !value.playwright);
    tab ??= this.createTab(owner, url, { testOrigin: origin, activate: false });
    const target = tab;
    const contents = target.view.webContents;
    const lease = new PlaywrightPreview(contents, origin, () => {
      if (target.playwright !== lease) return;
      this.automation.delete(worker);
      target.playwright = undefined;
      if (target.info.testing) {
        target.info.testing = undefined;
        target.info.playwrightBusy = undefined;
        this.changed();
      }
    });
    target.playwright = lease;
    this.playwrightCleanup.add(lease.finished);
    void lease.finished.then(() => this.playwrightCleanup.delete(lease.finished));
    this.automation.set(worker, target);
    const abort = () => lease.close();
    signal?.addEventListener('abort', abort, { once: true });
    try {
      await target.initialLoad;
      if (target.info.error || signal?.aborted) throw new Error('Local preview did not load');
      await lease.start(this.playwrightViewport(target));
      if (target.playwright !== lease || signal?.aborted) throw new Error('Playwright preview permission ended');
      target.info.testing = true;
      const reveal = takeReveal();
      if (reveal) {
        this.sync();
        this.conversations.set(target.owner, { activeId: target.info.id });
        this.render();
      }
      this.changed();
      if (reveal) this.emit({ type: 'open-preview', owner: target.owner });
      return { tabId: target.info.id, url: contents.getURL() };
    } catch (error) {
      lease.close();
      throw error;
    } finally { signal?.removeEventListener('abort', abort); }
  }
  controlPlaywright(worker: string, owner: string, input: PreviewInput, signal?: AbortSignal) {
    const tab = this.automation.get(worker);
    const lease = tab?.playwright;
    if (!lease || !tab.info.testing || tab.owner !== owner) throw new Error('No approved Playwright preview in this conversation');
    this.sync();
    if (input.action === 'show') {
      return { content: [{ type: 'text', text: 'The original preview tab is available in this conversation’s Browser panel. The user controls its visibility.' }] };
    }
    if (input.action === 'stop') {
      lease.close();
      return { content: [{ type: 'text', text: 'Playwright disconnected. The preview page remains open.' }] };
    }
    return lease.call(input, signal, busy => {
      if (tab.playwright !== lease) return;
      tab.info.playwrightBusy = busy || undefined;
      this.changed();
    });
  }
  stopPlaywright(worker: string) { this.automation.get(worker)?.playwright?.close(); }
  async finishPlaywright() {
    for (const tab of this.automation.values()) tab.playwright?.close();
    if (!this.playwrightCleanup.size) return;
    let timeout: NodeJS.Timeout | undefined;
    try {
      await Promise.race([Promise.all(this.playwrightCleanup),
        new Promise<void>(resolve => { timeout = setTimeout(resolve, 3000).unref(); })]);
    } finally { clearTimeout(timeout); }
  }
  openLocal(address: string, path: string, origin: string): BrowserSnapshot {
    const existing = [...this.tabs.values()].find(tab => tab.owner === this.owner && tab.info.localFile === path);
    if (existing) return this.select(existing.info.id);
    return this.create(address, { path, origin });
  }
  reloadLocal(id: string, address: string): BrowserSnapshot {
    void this.load(this.require(id), address);
    return this.snapshot();
  }
  private fromTab(tab: Tab, address?: string, local?: { path: string; origin: string }) {
    this.sync();
    if (this.disposed || this.window.isDestroyed() || this.tabs.get(tab.info.id) !== tab || this.tabs.size >= MAX_BROWSER_TABS) return;
    this.createTab(tab.owner, address, { local, activate: this.isVisible(tab), previewOrigin: address ? tab.previewOrigin : undefined });
  }
  private isVisible(tab: Tab) {
    return !!this.bounds && tab === this.activeTab() && tab.view.getVisible();
  }
  create(address?: string, local?: { path: string; origin: string }): BrowserSnapshot {
    this.createTab(this.owner, address, { local });
    return this.snapshot();
  }
  private createTab(owner: string, address = 'about:blank', { local, activate = true, previewOrigin, testOrigin }: TabOptions = {}): Tab {
    if (this.disposed || this.window.isDestroyed()) throw new Error('Browser is closed');
    if (!owner) throw new Error('No browser conversation is active');
    if (this.tabs.size >= MAX_BROWSER_TABS) throw new Error('Browser tab limit reached');
    const url = browserUrl(address);
    const id = randomUUID();
    const view = new WebContentsView({ webPreferences: {
      partition: testOrigin ? `test-preview:${id}` : local ? `local-preview:${randomUUID()}` : 'persist:desktop-browser',
      nodeIntegration: false, nodeIntegrationInSubFrames: false,
      contextIsolation: true, sandbox: true, webSecurity: true, allowRunningInsecureContent: false,
      navigateOnDragDrop: false,
      backgroundThrottling: Boolean(testOrigin)
        || !(process.env.DESKTOP_TEST_NO_FOCUS === '1' && Boolean(process.env.DESKTOP_TEST_USER_DATA)),
    } });
    const tab: Tab = { view, owner, navigation: 0, previewOrigin, testOrigin, info: { id, title: '', url: 'about:blank', loading: false,
      canGoBack: false, canGoForward: false, zoom: 1, localFile: local?.path } };
    this.tabs.set(id, tab);
    if (activate || !this.hasTabs(owner)) this.conversations.set(owner, { activeId: id });
    view.setVisible(false);
    this.window.contentView.addChildView(view);
    const contents = view.webContents;
    if (local || testOrigin) {
      contents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
      contents.session.setPermissionCheckHandler(() => false);
      contents.session.setDevicePermissionHandler(() => false);
      contents.session.on('will-download', (_event, item) => item.cancel());
      contents.session.webRequest.onBeforeRequest((details, callback) => {
        if (testOrigin) { callback({ cancel: !previewResourceAllowed(details.url, testOrigin, details.resourceType) }); return; }
        let allowed = /^(data:|blob:|about:blank$)/.test(details.url);
        try { allowed ||= new URL(details.url).origin === local?.origin; } catch { /* Block malformed URLs. */ }
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
      tab.playwright?.close();
      tab.info.loading = false; tab.info.error = 'Page process exited'; update();
    });
    contents.on('destroyed', () => tab.playwright?.close());
    const allowsTopLevel = (target: string) => {
      const origin = local?.origin ?? tab.testOrigin ?? tab.previewOrigin;
      return browserNavigation(target) && (!origin || new URL(target).origin === origin);
    };
    const guard = (event: Electron.Event, target: string, _inPlace?: boolean, mainFrame = true) => {
      const allowed = tab.testOrigin || mainFrame && tab.previewOrigin ? allowsTopLevel(target)
        : browserNavigation(target) && (!local || target === 'about:blank' || new URL(target).origin === local.origin);
      if (!allowed) {
        event.preventDefault();
        if (mainFrame) {
          tab.playwright?.close();
          tab.info.loading = false;
          tab.info.error = 'Navigation blocked';
          update();
        }
      }
    };
    contents.on('will-navigate', guard);
    contents.on('will-redirect', guard);
    contents.on('will-frame-navigate', event => {
      if (!browserNavigation(event.url) || (local && new URL(event.url).origin !== local.origin)
        || (testOrigin && !allowsTopLevel(event.url))) event.preventDefault();
    });
    contents.on('will-attach-webview', event => event.preventDefault());
    contents.setWindowOpenHandler(({ url }) => {
      if (!testOrigin && allowsTopLevel(url)) this.fromTab(tab, url, local);
      return { action: 'deny' };
    });
    contents.on('before-input-event', (event, input) => {
      this.sync();
      if (!this.isVisible(tab)) return;
      const primary = process.platform === 'darwin' ? input.meta && !input.control : input.control && !input.meta;
      if (input.type !== 'keyDown' || !primary || input.alt) return;
      const key = input.key.toLowerCase();
      if (key === 'l') { event.preventDefault(); this.emit({ type: 'address', context: this.context }); this.window.webContents.focus(); }
      else if (key === 't') { event.preventDefault(); this.fromTab(tab); }
      else if (key === 'w') { event.preventDefault(); this.close(id); }
      else if (key === 'r') { event.preventDefault(); tab.playwright?.close(); contents.reload(); }
    });
    contents.on('context-menu', (_event, params) => {
      this.sync();
      if (!this.isVisible(tab)) return;
      const items: Electron.MenuItemConstructorOptions[] = [];
      const t = (cn: string, en: string) => this.language() === 'zh' ? cn : en;
      if (!testOrigin && params.linkURL && browserNavigation(params.linkURL)) {
        const allowed = allowsTopLevel(params.linkURL);
        items.push({ label: t('在新标签页打开链接', 'Open link in new tab'), enabled: allowed && this.tabs.size < MAX_BROWSER_TABS, click: () => { if (allowed) this.fromTab(tab, params.linkURL, local); } });
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
    this.changed();
    if (url !== 'about:blank') tab.initialLoad = this.load(tab, url);
    else if (activate && this.bounds) { this.window.webContents.focus(); this.emit({ type: 'address', context: this.context }); }
    this.render();
    return tab;
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
    const tab = this.require(id);
    this.conversations.set(this.owner, { activeId: tab.info.id });
    this.render(); this.changed();
    return this.snapshot();
  }
  close(id: string): BrowserSnapshot {
    const tab = this.require(id);
    if (this.activeTab() === tab) {
      const siblings = [...this.tabs.values()].filter(item => item.owner === tab.owner);
      const index = siblings.indexOf(tab);
      this.conversations.set(this.owner, { activeId: (siblings[index + 1] ?? siblings[index - 1])?.info.id });
    }
    this.destroy(tab);
    this.render(); this.changed();
    return this.snapshot();
  }
  private destroy(tab: Tab) {
    this.tabs.delete(tab.info.id);
    tab.playwright?.close();
    if (!this.window.isDestroyed()) this.window.contentView.removeChildView(tab.view);
    if (!tab.view.webContents.isDestroyed()) tab.view.webContents.close({ waitForBeforeUnload: false });
  }
  async action(id: string, action: BrowserAction, address?: string): Promise<BrowserSnapshot> {
    const tab = this.require(id);
    const contents = tab.view.webContents;
    if (['stopTesting', 'navigate', 'back', 'forward', 'reload', 'stop', 'zoomIn', 'zoomOut', 'zoomReset'].includes(action))
      tab.playwright?.close();
    switch (action) {
      case 'stopTesting': break;
      case 'navigate': {
        const url = browserUrl(address);
        if (tab.info.localFile && url !== tab.info.url) return this.open(url);
        if (tab.testOrigin && new URL(url).origin !== tab.testOrigin) return this.open(url);
        // An explicit address-bar navigation can leave the local preview.
        if (tab.previewOrigin && new URL(url).origin !== tab.previewOrigin) tab.previewOrigin = undefined;
        await this.load(tab, url); break;
      }
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
  layout(bounds: BrowserBounds | null, expected?: unknown) {
    const context = this.assertContext();
    if (expected !== undefined && context !== expected) return;
    const [width, height] = this.window.getContentSize();
    this.bounds = browserBounds(bounds, width, height);
    if (this.bounds && this.canCreate() && !this.conversations.has(this.owner)) this.create();
    this.render();
  }
  private render() {
    if (this.window.isDestroyed() || this.disposed) return;
    const [width, height] = this.window.getContentSize();
    const bounds = browserBounds(this.bounds, width, height);
    const active = this.activeTab();
    for (const tab of this.tabs.values()) {
      if (tab.view.webContents.isDestroyed()) continue;
      const visible = tab === active && !!bounds && tab.info.url !== 'about:blank' && !tab.info.error;
      if (visible) tab.view.setBounds(bounds!);
      tab.view.setVisible(visible);
      const playwright = tab.playwright;
      if (playwright) void playwright.layout(this.playwrightViewport(tab)).catch(() => playwright.close());
    }
  }
  private playwrightViewport(tab: Tab) {
    if (this.isVisible(tab) && !this.window.isMinimized()) return undefined;
    const size = tab.view.getBounds();
    return size.width && size.height ? { width: size.width, height: size.height } : { width: 800, height: 600 };
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const tab of this.tabs.values()) this.destroy(tab);
    this.conversations.clear();
  }
}
