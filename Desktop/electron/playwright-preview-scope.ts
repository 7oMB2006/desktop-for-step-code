import { randomUUID } from 'node:crypto';
import type { WebContents } from 'electron';

interface Command { id: number; sessionId?: string; method: string; params?: Record<string, unknown> }
type Sender = (message: Record<string, unknown>) => void;
const commands = new Set(`
  DOM.describeNode DOM.getContentQuads DOM.getFrameOwner DOM.resolveNode DOM.scrollIntoViewIfNeeded
  DOMSnapshot.captureSnapshot Accessibility.getFullAXTree Accessibility.queryAXTree
  Input.dispatchKeyEvent Input.dispatchMouseEvent Input.insertText Inspector.enable
  Log.enable Network.enable Page.captureScreenshot Page.enable Page.getFrameTree Page.getLayoutMetrics
  Page.handleJavaScriptDialog Page.removeScriptToEvaluateOnNewDocument Page.setLifecycleEventsEnabled
  Runtime.callFunctionOn Runtime.enable Runtime.evaluate Runtime.getProperties Runtime.releaseObject
  Runtime.releaseObjectGroup Runtime.runIfWaitingForDebugger
`.trim().split(/\s+/));
const events = new Set(`
  Inspector.targetCrashed Log.entryAdded
  Network.loadingFailed Network.loadingFinished Network.requestWillBeSent Network.responseReceived
  Page.domContentEventFired Page.frameAttached Page.frameDetached Page.frameNavigated
  Page.frameRequestedNavigation Page.frameStartedLoading Page.frameStoppedLoading Page.javascriptDialogClosed
  Page.javascriptDialogOpening Page.lifecycleEvent Page.loadEventFired Page.navigatedWithinDocument
  Runtime.consoleAPICalled Runtime.exceptionThrown Runtime.executionContextCreated
  Runtime.executionContextDestroyed Runtime.executionContextsCleared
`.trim().split(/\s+/));

export function previewResourceAllowed(url: string, origin: string, resourceType: string) {
  if (!URL.canParse(url)) return false;
  const parsed = new URL(url);
  if (parsed.username || parsed.password) return false;
  if (parsed.protocol === 'http:') return parsed.origin === origin;
  if (parsed.protocol === 'ws:') return `http://${parsed.host}` === origin;
  if (resourceType === 'mainFrame' || resourceType === 'subFrame') return false;
  return parsed.protocol === 'data:' || parsed.protocol === 'blob:' && parsed.origin === origin;
}

export function previewNetworkSummary(text: string, origin: string) {
  // Playwright MCP's pinned network list is textual. Never return unmatched lines or status text.
  return text.split('\n').flatMap(line => {
    const match = /^\d+\. \[([A-Z]+)\] (\S+?)(?: => \[(\d{3}|FAILED)\].*)?$/.exec(line.trim());
    if (!match || !URL.canParse(match[2])) return [];
    const url = new URL(match[2]);
    if (url.protocol !== 'http:' || url.origin !== origin || url.username || url.password) return [];
    return [`${match[1]} ${url.pathname}${match[3] ? ` [${match[3]}]` : ''}`];
  }).join('\n');
}

export class PreviewProtocolScope {
  private readonly pageSession = randomUUID();
  private readonly browserContext = randomUUID();
  private target = '';
  private announced = false;
  private closed = false;
  private attached = false;
  private viewport?: string;
  private readonly debugger;

  constructor(private guest: WebContents, private origin: string, private send: Sender, private onDetach: () => void) {
    this.debugger = guest.debugger;
  }

  async attach() {
    if (this.closed || this.debugger.isAttached()) throw new Error('Preview debugger is unavailable');
    this.debugger.attach('1.3');
    this.attached = true;
    this.debugger.on('message', this.message);
    this.debugger.on('detach', this.detached);
    try {
      const { frameTree } = await this.debugger.sendCommand('Page.getFrameTree');
      if (!frameTree?.frame?.id || !this.allowsNavigation(this.guest.getURL()) || this.closed)
        throw new Error('Preview page is unavailable');
      this.target = frameTree.frame.id;
    } catch (error) {
      this.close();
      throw error;
    }
  }

  allowsNavigation(url: unknown) {
    return typeof url === 'string' && URL.canParse(url) && new URL(url).protocol === 'http:'
      && previewResourceAllowed(url, this.origin, 'mainFrame');
  }

  private message = (_event: unknown, method: string, params: unknown, childSession?: string) => {
    if (!this.closed && this.announced && !childSession && events.has(method))
      this.send({ method, params, sessionId: this.pageSession });
  };

  private detached = () => {
    this.attached = false;
    if (!this.closed) this.onDetach();
  };

  private info() {
    return { targetId: this.target, type: 'page', title: this.guest.getTitle(), url: this.guest.getURL(),
      attached: this.announced, canAccessOpener: false, browserContextId: this.browserContext };
  }

  async dispatch({ sessionId, method, params = {} }: Command): Promise<unknown> {
    const deny = () => { throw new Error('Command unavailable in this preview'); };
    if (this.closed || !this.target || !this.allowsNavigation(this.guest.getURL())) return deny();
    if (!sessionId) {
      switch (method) {
        case 'Browser.getVersion':
          return { protocolVersion: '1.3', product: `Chrome/${process.versions.chrome}`, userAgent: this.guest.getUserAgent() };
        case 'Target.getTargetInfo':
          if (params.targetId && params.targetId !== this.target) return deny();
          return { targetInfo: this.info() };
        case 'Target.getTargets':
          return { targetInfos: [this.info()] };
        case 'Target.setAutoAttach':
          if (params.autoAttach !== true || params.flatten !== true) return deny();
          if (!this.announced) {
            this.announced = true;
            this.send({ method: 'Target.attachedToTarget', params: {
              sessionId: this.pageSession, targetInfo: this.info(), waitingForDebugger: false,
            } });
          }
          return {};
        default: return deny();
      }
    }
    if (sessionId !== this.pageSession) return deny();
    switch (method) {
      case 'Page.bringToFront':
      case 'Target.setAutoAttach':
        // Playwright sees a single attached page and never focuses it.
        return {};
      case 'Page.setInterceptFileChooserDialog':
        if (params.enabled === false) return {};
        return deny();
      case 'Page.navigate':
        if ((params.frameId && params.frameId !== this.target) || !this.allowsNavigation(params.url)) return deny();
        break;
      case 'Page.createIsolatedWorld':
        params = { frameId: params.frameId, worldName: params.worldName, grantUniveralAccess: false };
        break;
      case 'Page.addScriptToEvaluateOnNewDocument':
        if (params.source !== '') return deny();
        break;
      default:
        if (!commands.has(method)) return deny();
    }
    return this.debugger.sendCommand(method, params);
  }

  async layout(size?: { width: number; height: number }) {
    if (this.closed || !this.attached) return;
    const key = size ? `${size.width}x${size.height}` : undefined;
    if (key === this.viewport) return;
    const previous = this.viewport;
    this.viewport = key;
    try {
      if (size)
        await this.debugger.sendCommand('Emulation.setDeviceMetricsOverride', { ...size, deviceScaleFactor: 0, mobile: false });
      else
        await this.debugger.sendCommand('Emulation.clearDeviceMetricsOverride');
    } catch (error) {
      if (this.viewport === key) this.viewport = previous;
      throw error;
    }
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.debugger.removeListener('message', this.message);
    this.debugger.removeListener('detach', this.detached);
    if (this.attached && this.debugger.isAttached()) {
      // Detaching this session also discards its temporary emulation.
      this.debugger.detach();
    }
    this.attached = false;
  }
}
