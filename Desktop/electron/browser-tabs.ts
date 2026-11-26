import { app, clipboard, Menu, WebContentsView, session, shell, type BrowserWindow } from 'electron';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { automationNavigation, browserBounds, browserHandoffOrigin, browserHandoffRequestAllowed, browserNavigation, browserPreviewUrl, browserUrl,
  MAX_BROWSER_TABS, type AutomationScope } from './browser-policy';
import { PlaywrightPreview, type PreviewInput } from './playwright-preview';
import { previewResourceAllowed } from './playwright-preview-scope';
import { publicBrowserResource, publicBrowserSite } from './public-browser-policy';
import { PublicBrowserProxy } from './public-browser-proxy';
import { inlineFavicon, fetchFavicon, fetchSameOriginFavicon } from './link-preview';
import { BrowserProfiles, partitions } from './browser-profiles';
import type { BrowserAction, BrowserBounds, BrowserEvent, BrowserHandoffMode, BrowserProfile, BrowserSnapshot, BrowserTab } from '../src/contracts';

type Tab = { view: WebContentsView; info: BrowserTab; owner: string; navigation: number; faviconRevision: number;
  faviconAbort?: AbortController; faviconPage?: URL; previewOrigin?: string;
  automationScope?: AutomationScope; initialLoad?: Promise<void>; playwright?: PlaywrightPreview; onPlaywrightUserStop?: () => void;
  document: number; attached?: BrowserHandoffMode };
type TabOptions = { local?: { path: string; origin: string }; activate?: boolean; previewOrigin?: string;
  automationScope?: AutomationScope; publicProxy?: string; profile?: BrowserProfile };
type Conversation = { activeId?: string };
export type BrowserHandoff = { id: string; document: number; origin: string; mode: BrowserHandoffMode;
  persistentWorker?: string; worker?: string };

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
  private publicProxy?: PublicBrowserProxy;
  private siteIcons = new Map<string, { source: string; image: string }>();
  private handoffs = new Map<string, BrowserHandoff>();
  private agentNetwork?: Promise<void>;
  readonly profiles = new BrowserProfiles(join(app.getPath('userData'), 'browser-profiles.json'),
    profile => session.fromPartition(partitions[profile]), (domain, exactOrigin) => {
      if (exactOrigin) return this.siteIcons.get(exactOrigin)?.image;
      for (const [origin, icon] of this.siteIcons) if (publicBrowserSite(origin) === domain) return icon.image;
    });
  readonly profilesReady = this.profiles.restore();

  constructor(private window: BrowserWindow, private emit: (event: BrowserEvent) => void,
    private language: () => 'zh' | 'en', private currentOwner: () => string) {
    this.owner = currentOwner();
    for (const profile of ['personal', 'agent'] as const) {
      const browserSession = session.fromPartition(partitions[profile]);
      browserSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
      browserSession.setPermissionCheckHandler(() => false);
      browserSession.setDevicePermissionHandler(() => false);
      browserSession.webRequest.onBeforeRequest((details, callback) => {
        const liveTabs = [...this.tabs.values()].filter(tab => tab.info.profile === profile && !tab.view.webContents.isDestroyed());
        const guest = liveTabs.find(tab => tab.view.webContents.id === details.webContentsId);
        // Filling dispatches page events, so keep the shared tab and its workers on passive HTTP methods until disconnect.
        const fillMode = guest?.attached === 'fill' || !guest && liveTabs.some(tab => tab.attached === 'fill');
        const restricted = guest?.automationScope;
        const background = !guest && liveTabs.some(tab => tab.automationScope);
        const allowed = browserHandoffRequestAllowed(details.method, fillMode ? 'fill' : undefined)
          && (profile !== 'agent' || (restricted?.kind === 'public'
            ? publicBrowserResource(details.url, details.method, details.resourceType, restricted.site)
            : !background));
        callback({ cancel: !allowed });
      });
      browserSession.on('will-download', (_event, item, contents) => {
        item.setSaveDialogOptions({ title: this.language() === 'zh' ? '保存下载' : 'Save download', defaultPath: item.getFilename() });
        if (![...this.tabs.values()].some(tab => tab.view.webContents === contents && !tab.automationScope && !tab.attached)) item.cancel();
      });
    }
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
    const handoff = this.handoffs.get(previous);
    if (handoff && !this.handoffs.has(next)) this.handoffs.set(next, handoff);
    this.handoffs.delete(previous);
    this.conversations.set(next, { activeId: this.conversations.get(next)?.activeId ?? source.activeId });
    this.conversations.delete(previous);
    this.render();
    this.changed();
  }
  discard(owner: string) {
    this.handoffs.delete(owner);
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
    const grant = this.handoffs.get(this.owner);
    return { revision: this.revision, owner: this.owner, context: this.context, canCreate: this.canCreate(),
      activeId: this.activeTab()?.info.id, tabs: [...this.tabs.values()]
        .filter(tab => tab.owner === this.owner).map(tab => ({ ...tab.info,
          handoff: grant?.id === tab.info.id ? grant.mode : undefined,
          handoffPersistent: grant?.id === tab.info.id && grant.persistentWorker ? true : undefined,
          canHandoff: this.handoffOrigin(tab) !== undefined })) };
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
    const existing = [...this.tabs.values()].find(tab => tab.owner === this.owner && !tab.info.localFile
      && tab.automationScope?.kind !== 'public' && tab.info.profile !== 'agent' && tab.info.url === url);
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
  async startPlaywright(owner: string, worker: string, { url, scope }: { url: string; scope: AutomationScope }, signal: AbortSignal | undefined,
    takeReveal: () => boolean, onUserStop?: () => void) {
    if (signal?.aborted || this.disposed || this.automation.has(worker)) throw new Error('Preview cannot start');
    const signedIn = scope.kind === 'public' && scope.signedIn;
    const publicProxy = scope.kind === 'public' && !signedIn ? await (this.publicProxy ??= new PublicBrowserProxy()).start() : undefined;
    if (signal?.aborted || this.disposed || this.automation.has(worker)) throw new Error('Preview cannot start');
    let tab = scope.kind === 'local' ? [...this.tabs.values()].find(value => value.owner === owner
      && value.automationScope?.kind === 'local' && value.automationScope.origin === scope.origin
      && value.info.url === url && !value.info.error && !value.playwright) : undefined;
    tab ??= this.createTab(owner, url, { automationScope: scope, activate: false, publicProxy, profile: signedIn ? 'agent' : undefined });
    return this.connectPlaywright(tab, worker, scope, signal, takeReveal, onUserStop);
  }
  private handoffOrigin(tab: Tab) {
    if (tab.view.webContents.isDestroyed() || tab.info.localFile || tab.info.loading || tab.info.error || tab.playwright) return;
    return browserHandoffOrigin(tab.view.webContents.getURL());
  }
  async chooseHandoff(id: string, context: number, fullAccessWorker: () => string | undefined): Promise<BrowserSnapshot> {
    const tab = this.require(id);
    const origin = this.handoffOrigin(tab);
    if (!origin || tab !== this.activeTab()) throw new Error('This tab is not available to hand off');
    const document = tab.document;
    const zh = this.language() === 'zh';
    const persistentWorker = fullAccessWorker();
    const mode = await new Promise<BrowserHandoffMode | 'remove' | undefined>(resolve => {
      Menu.buildFromTemplate([
        { label: persistentWorker ? zh ? '持续共享：仅查看' : 'Keep shared: View only'
          : zh ? '下轮交给 Agent：仅查看' : 'Share next turn: View only', enabled: !this.handoffs.get(tab.owner)?.worker, click: () => resolve('read') },
        { label: persistentWorker ? zh ? '持续共享：填写表单' : 'Keep shared: Fill fields'
          : zh ? '下轮交给 Agent：填写表单' : 'Share next turn: Fill fields', enabled: !this.handoffs.get(tab.owner)?.worker, click: () => resolve('fill') },
        { label: zh ? '取消共享' : 'Remove sharing', enabled: this.handoffs.get(tab.owner)?.id === id, click: () => resolve('remove') },
      ]).popup({ window: this.window, callback: () => resolve(undefined) });
    });
    if (!mode) return this.snapshot();
    this.assertContext(context);
    if (this.require(id) !== tab || tab !== this.activeTab() || tab.document !== document || this.handoffOrigin(tab) !== origin)
      throw new Error('The original browser page is no longer available');
    if (mode === 'remove') this.handoffs.delete(tab.owner);
    else {
      if (this.handoffs.get(tab.owner)?.worker) throw new Error('A tab is already shared for this turn');
      if (persistentWorker !== fullAccessWorker()) throw new Error('Browser sharing permissions changed. Open the sharing menu again.');
      this.handoffs.set(tab.owner, { id, document, origin, mode, persistentWorker });
    }
    this.changed();
    return this.snapshot();
  }
  reserveHandoff(owner: string, worker: string, fullAccess: boolean) {
    const handoff = this.handoffs.get(owner);
    if (!handoff || handoff.worker) return;
    if (handoff.persistentWorker && (!fullAccess || handoff.persistentWorker !== worker)) {
      this.handoffs.delete(owner);
      this.changed();
      return;
    }
    handoff.worker = worker;
    return handoff;
  }
  sharedMode(owner: string, grant: BrowserHandoff) {
    return this.handoffs.get(owner) === grant ? grant.mode : 'unavailable';
  }
  attachPlaywright(owner: string, worker: string, grant: BrowserHandoff, signal?: AbortSignal, onUserStop?: () => void) {
    const tab = this.tabs.get(grant.id);
    if (this.disposed || this.handoffs.get(owner) !== grant || grant.worker !== worker
      || !tab || tab.owner !== owner || tab.document !== grant.document
      || this.handoffOrigin(tab) !== grant.origin || this.automation.has(worker) || signal?.aborted)
      throw new Error('The shared tab is no longer available');
    if (!grant.persistentWorker) this.handoffs.delete(owner);
    return this.connectPlaywright(tab, worker, { kind: 'attached', origin: grant.origin, mode: grant.mode }, signal, () => false, onUserStop);
  }
  private async connectPlaywright(target: Tab, worker: string, scope: AutomationScope, signal: AbortSignal | undefined,
    takeReveal: () => boolean, onUserStop?: () => void) {
    const contents = target.view.webContents;
    const lease = new PlaywrightPreview(contents, scope, () => {
      if (target.playwright !== lease) return;
      this.automation.delete(worker);
      target.attached = undefined;
      target.playwright = undefined;
      target.onPlaywrightUserStop = undefined;
      if (target.info.testing) {
        target.info.testing = undefined;
        target.info.playwrightBusy = undefined;
        this.changed();
      }
    });
    target.playwright = lease;
    target.attached = scope.kind === 'attached' ? scope.mode : undefined;
    target.onPlaywrightUserStop = onUserStop;
    if (target.attached) {
      target.info.testing = true;
      this.changed();
    }
    this.playwrightCleanup.add(lease.finished);
    void lease.finished.then(() => this.playwrightCleanup.delete(lease.finished));
    this.automation.set(worker, target);
    const abort = () => lease.close();
    signal?.addEventListener('abort', abort, { once: true });
    try {
      await target.initialLoad;
      if (target.info.error || signal?.aborted) throw new Error('Browser page did not load');
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
  stopPlaywright(worker: string, keepPersistent = false) {
    for (const [owner, grant] of this.handoffs) {
      if (grant.worker !== worker && grant.persistentWorker !== worker) continue;
      if (keepPersistent && grant.persistentWorker) grant.worker = undefined;
      else this.handoffs.delete(owner);
      this.changed();
    }
    this.automation.get(worker)?.playwright?.close();
  }
  revokePersistentHandoff(worker: string) {
    for (const [owner, grant] of this.handoffs) {
      if (grant.persistentWorker !== worker) continue;
      this.handoffs.delete(owner);
      const tab = this.tabs.get(grant.id);
      if (tab?.attached) { tab.onPlaywrightUserStop?.(); tab.playwright?.close(); }
      this.changed();
    }
  }
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
  openProfile(profile: BrowserProfile, address: string) {
    const url = browserUrl(address);
    if (!publicBrowserSite(url)) throw new Error('Browser profiles require an HTTPS website');
    const existing = [...this.tabs.values()].find(tab => tab.owner === this.owner && !tab.automationScope
      && tab.info.profile === profile && tab.info.url === url);
    if (existing) return this.select(existing.info.id);
    this.createTab(this.owner, url, { profile });
    return this.snapshot();
  }
  private prepareAgentNetwork() {
    if (!this.agentNetwork) this.agentNetwork = (async () => {
      const proxyRules = await (this.publicProxy ??= new PublicBrowserProxy()).start();
      const profile = session.fromPartition(partitions.agent);
      const liveTabs = () => [...this.tabs.values()].filter(tab => tab.info.profile === 'agent' && !tab.view.webContents.isDestroyed());
      const guestFor = (id: number | undefined) => liveTabs().find(tab => tab.view.webContents.id === id);
      // Signed-in pages may load third-party assets, but not with the Agent profile's other sign-ins.
      const thirdParty = (id: number | undefined, url: string) => {
        const scope = guestFor(id)?.automationScope;
        return scope?.kind === 'public' && publicBrowserSite(url) !== scope.site;
      };
      profile.webRequest.onBeforeSendHeaders((details, callback) => {
        const requestHeaders = details.requestHeaders;
        if (thirdParty(details.webContentsId, details.url))
          for (const key of Object.keys(requestHeaders))
            if (/^(cookie|authorization)$/i.test(key)) delete requestHeaders[key];
        callback({ requestHeaders });
      });
      profile.webRequest.onHeadersReceived((details, callback) => {
        const responseHeaders = details.responseHeaders;
        if (responseHeaders && thirdParty(details.webContentsId, details.url))
          for (const key of Object.keys(responseHeaders))
            if (/^set-cookie2?$/i.test(key)) delete responseHeaders[key];
        callback({ responseHeaders });
      });
      await profile.setProxy({ mode: 'fixed_servers', proxyRules, proxyBypassRules: '<-loopback>' });
    })().catch(error => { this.agentNetwork = undefined; throw error; });
    return this.agentNetwork;
  }
  reloadLocal(id: string, address: string): BrowserSnapshot {
    void this.load(this.require(id), address);
    return this.snapshot();
  }
  private fromTab(tab: Tab, address?: string, local?: { path: string; origin: string }) {
    this.sync();
    if (this.disposed || this.window.isDestroyed() || this.tabs.get(tab.info.id) !== tab || this.tabs.size >= MAX_BROWSER_TABS) return;
    this.createTab(tab.owner, address, { local, activate: this.isVisible(tab),
      profile: tab.info.profile, previewOrigin: address ? tab.previewOrigin : undefined });
  }
  private isVisible(tab: Tab) {
    return !!this.bounds && tab === this.activeTab() && tab.view.getVisible();
  }
  create(address?: string, local?: { path: string; origin: string }): BrowserSnapshot {
    this.createTab(this.owner, address, { local });
    return this.snapshot();
  }
  private createTab(owner: string, address = 'about:blank',
    { local, activate = true, previewOrigin, automationScope, publicProxy, profile }: TabOptions = {}): Tab {
    if (this.disposed || this.window.isDestroyed()) throw new Error('Browser is closed');
    if (!owner) throw new Error('No browser conversation is active');
    if (this.tabs.size >= MAX_BROWSER_TABS) throw new Error('Browser tab limit reached');
    const url = browserUrl(address);
    const id = randomUUID();
    profile ??= automationScope || local ? undefined : 'personal';
    const view = new WebContentsView({ webPreferences: {
      partition: profile ? partitions[profile] : automationScope ? `browser-automation:${id}` : `local-preview:${id}`,
      nodeIntegration: false, nodeIntegrationInSubFrames: false,
      contextIsolation: true, sandbox: true, webSecurity: true, allowRunningInsecureContent: false,
      navigateOnDragDrop: false,
      disableDialogs: Boolean(automationScope),
      backgroundThrottling: Boolean(automationScope)
        || !(process.env.DESKTOP_TEST_NO_FOCUS === '1' && Boolean(process.env.DESKTOP_TEST_USER_DATA)),
    } });
    const tab: Tab = { view, owner, navigation: 0, document: 0, faviconRevision: 0, previewOrigin, automationScope, info: { id, title: '', url: 'about:blank', loading: false, profile,
      canGoBack: false, canGoForward: false, zoom: 1, localFile: local?.path } };
    this.tabs.set(id, tab);
    if (activate || !this.hasTabs(owner)) this.conversations.set(owner, { activeId: id });
    view.setVisible(false);
    this.window.contentView.addChildView(view);
    const contents = view.webContents;
    if ((local || automationScope) && !profile) {
      contents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
      contents.session.setPermissionCheckHandler(() => false);
      contents.session.setDevicePermissionHandler(() => false);
      contents.session.on('will-download', (_event, item) => item.cancel());
      contents.session.webRequest.onBeforeRequest((details, callback) => {
        if (!browserHandoffRequestAllowed(details.method, tab.attached)) {
          callback({ cancel: true });
          return;
        }
        if (automationScope) {
          const allowed = automationScope.kind === 'local'
            ? previewResourceAllowed(details.url, automationScope.origin, details.resourceType)
            : automationScope.kind === 'public' && publicBrowserResource(details.url, details.method, details.resourceType, automationScope.site);
          callback({ cancel: !allowed });
          return;
        }
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
    contents.on('did-navigate', (event, target, status) => {
      if (profile && status >= 200 && status < 400) void this.profilesReady.then(() => this.profiles.record(profile, target));
      this.resetFavicon(tab, status >= 200 && status < 400 ? target : undefined);
      navigation(event, target);
    });
    contents.on('did-finish-load', () => {
      if (tab.faviconPage && !tab.info.favicon && !tab.faviconAbort) void this.updateFavicon(tab, []);
    });
    contents.on('did-start-navigation', event => {
      if (!event.isMainFrame) return;
      tab.document++;
      this.cancelHandoff(tab);
      if (tab.attached) { tab.onPlaywrightUserStop?.(); tab.playwright?.close(); }
    });
    contents.on('did-navigate-in-page', (event, target, isMainFrame) => { if (isMainFrame) navigation(event, target); });
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
    contents.on('page-favicon-updated', (_event, sources) => { void this.updateFavicon(tab, sources); });
    contents.on('did-fail-load', (_event, code, _description, target, mainFrame) => {
      if (!mainFrame || code === -3) return;
      this.resetFavicon(tab);
      tab.info.loading = false; tab.info.url = target; tab.info.error = `Load failed (${code})`; update();
    });
    contents.on('render-process-gone', () => {
      this.cancelHandoff(tab);
      tab.playwright?.close();
      tab.info.loading = false; tab.info.error = 'Page process exited'; update();
    });
    contents.on('destroyed', () => tab.playwright?.close());
    const allowsTopLevel = (target: string) => {
      if (automationScope) return automationNavigation(target, automationScope);
      const origin = local?.origin ?? tab.previewOrigin;
      return browserNavigation(target) && (!origin || new URL(target).origin === origin);
    };
    const guard = (event: Electron.Event, target: string, _inPlace?: boolean, mainFrame = true) => {
      const allowed = !tab.attached && (automationScope || mainFrame && tab.previewOrigin ? allowsTopLevel(target)
        : browserNavigation(target) && (!local || target === 'about:blank' || new URL(target).origin === local.origin));
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
      if (tab.attached || !browserNavigation(event.url) || (local && new URL(event.url).origin !== local.origin)
        || (automationScope && !allowsTopLevel(event.url))) event.preventDefault();
    });
    contents.on('will-attach-webview', event => event.preventDefault());
    contents.setWindowOpenHandler(({ url, postBody }) => {
      if (tab.attached) return { action: 'deny' };
      if (automationScope?.kind === 'public' && !postBody && allowsTopLevel(url)) {
        // Follow same-site links without creating a popup or focusing the tab.
        void this.load(tab, url);
      } else if (!automationScope && allowsTopLevel(url)) this.fromTab(tab, url, local);
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
      else if (key === 'r') { event.preventDefault(); tab.onPlaywrightUserStop?.(); tab.playwright?.close(); contents.reload(); }
    });
    contents.on('context-menu', (_event, params) => {
      this.sync();
      if (!this.isVisible(tab)) return;
      const items: Electron.MenuItemConstructorOptions[] = [];
      const t = (cn: string, en: string) => this.language() === 'zh' ? cn : en;
      if (!automationScope && params.linkURL && browserNavigation(params.linkURL)) {
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
    if (profile === 'agent') {
      contents.setWebRTCIPHandlingPolicy('disable_non_proxied_udp');
      tab.initialLoad = this.prepareAgentNetwork().then(() => {
        if (url !== 'about:blank' && this.tabs.get(id) === tab && !contents.isDestroyed()) return this.load(tab, url);
      }).catch(() => { tab.info.error = 'Browser profile was unavailable'; update(); });
    } else if (publicProxy) {
      contents.setWebRTCIPHandlingPolicy('disable_non_proxied_udp');
      tab.initialLoad = contents.session.setProxy({
        mode: 'fixed_servers', proxyRules: publicProxy, proxyBypassRules: '<-loopback>',
      }).then(() => {
        if (this.tabs.get(id) === tab && !contents.isDestroyed()) return this.load(tab, url);
      });
    } else if (url !== 'about:blank') tab.initialLoad = this.load(tab, url);
    else if (activate && this.bounds) { this.window.webContents.focus(); this.emit({ type: 'address', context: this.context }); }
    this.render();
    return tab;
  }
  private resetFavicon(tab: Tab, address?: string) {
    tab.faviconRevision++;
    tab.faviconAbort?.abort();
    tab.faviconAbort = undefined;
    tab.faviconPage = undefined;
    tab.info.favicon = undefined;
    if (!address || !URL.canParse(address)) return;
    const page = new URL(address);
    if (!['http:', 'https:'].includes(page.protocol)) return;
    tab.faviconPage = page;
    if (!tab.automationScope && !tab.previewOrigin && !tab.info.localFile)
      tab.info.favicon = this.siteIcons.get(page.origin)?.image;
  }
  private async updateFavicon(tab: Tab, sources: string[]) {
    const contents = tab.view.webContents;
    const page = tab.faviconPage;
    if (!page || contents.isDestroyed() || tab.info.error) return;
    const canRequest = !tab.automationScope && !tab.info.localFile
      && (!tab.previewOrigin || ['localhost', '127.0.0.1', '[::1]'].includes(page.hostname));
    const useChromium = canRequest && tab.info.profile === 'personal' && !tab.previewOrigin;
    const candidates = new Set(sources.slice(0, 3));
    if (useChromium) candidates.add(new URL('/favicon.ico', page).href);
    if (!candidates.size) return;
    const revision = ++tab.faviconRevision;
    tab.faviconAbort?.abort();
    const controller = new AbortController();
    tab.faviconAbort = controller;
    const timer = setTimeout(() => controller.abort(), 4000);
    const requestIcon = (source: string) => {
      if (useChromium && URL.canParse(source) && new URL(source).origin === page.origin) {
        // Follow the user's Chromium network path without using the tab's signed-in partition.
        return fetchSameOriginFavicon(source, page, controller.signal, (url, options) =>
          session.fromPartition('browser-site-icons').fetch(url, { ...options, bypassCustomProtocolHandlers: true }));
      }
      return fetchFavicon(source, controller.signal, page);
    };
    try {
      for (const source of candidates) {
        const known = canRequest ? this.siteIcons.get(page.origin) : undefined;
        const inline = inlineFavicon(source);
        const image = inline ?? (known?.source === source ? known.image
          : canRequest ? await requestIcon(source).catch(() => undefined) : undefined);
        if (controller.signal.aborted || this.tabs.get(tab.info.id) !== tab || tab.faviconRevision !== revision || tab.info.error) return;
        if (!image) continue;
        if (canRequest && !inline) {
          if (this.siteIcons.size >= 96 && !this.siteIcons.has(page.origin)) this.siteIcons.delete(this.siteIcons.keys().next().value!);
          this.siteIcons.set(page.origin, { source, image });
        }
        if (tab.info.favicon !== image) { tab.info.favicon = image; this.changed(); }
        return;
      }
    } finally {
      clearTimeout(timer);
      if (tab.faviconAbort === controller) tab.faviconAbort = undefined;
    }
  }
  private async load(tab: Tab, url: string) {
    const navigation = ++tab.navigation;
    const contents = tab.view.webContents;
    this.resetFavicon(tab);
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
  move(id: string, targetId: string, after: boolean): BrowserSnapshot {
    const tab = this.require(id);
    const target = this.require(targetId);
    if (tab === target) return this.snapshot();
    const ordered = [...this.tabs.values()].filter(item => item.owner === this.owner && item !== tab);
    ordered.splice(ordered.indexOf(target) + Number(after), 0, tab);
    let index = 0;
    this.tabs = new Map([...this.tabs.values()].map(item => {
      const next = item.owner === this.owner ? ordered[index++] : item;
      return [next.info.id, next];
    }));
    this.changed();
    return this.snapshot();
  }
  close(id: string): BrowserSnapshot {
    const tab = this.require(id);
    tab.onPlaywrightUserStop?.();
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
    this.cancelHandoff(tab);
    tab.faviconAbort?.abort();
    this.tabs.delete(tab.info.id);
    tab.playwright?.close();
    if (!this.window.isDestroyed()) this.window.contentView.removeChildView(tab.view);
    if (!tab.view.webContents.isDestroyed()) tab.view.webContents.close({ waitForBeforeUnload: false });
  }
  private cancelHandoff(tab: Tab) {
    if (this.handoffs.get(tab.owner)?.id !== tab.info.id) return;
    this.handoffs.delete(tab.owner);
    this.changed();
  }
  async action(id: string, action: BrowserAction, address?: string): Promise<BrowserSnapshot> {
    const tab = this.require(id);
    const contents = tab.view.webContents;
    if (['stopTesting', 'navigate', 'back', 'forward', 'reload', 'stop'].includes(action)
      || (tab.playwright && ['zoomIn', 'zoomOut', 'zoomReset'].includes(action))) {
      this.cancelHandoff(tab);
      tab.onPlaywrightUserStop?.();
      tab.playwright?.close();
    }
    switch (action) {
      case 'stopTesting': break;
      case 'navigate': {
        const url = browserUrl(address);
        if (tab.info.localFile && url !== tab.info.url) return this.open(url);
        if (tab.automationScope && !automationNavigation(url, tab.automationScope)) return this.open(url);
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
    this.publicProxy?.close();
  }
}
