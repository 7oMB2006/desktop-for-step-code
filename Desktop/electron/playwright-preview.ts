import { app, type UtilityProcess, type WebContents, utilityProcess } from 'electron';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PreviewProtocolScope, previewNetworkSummary } from './playwright-preview-scope';
import { automationNavigation, type AutomationScope } from './browser-policy';

type Content = { type: 'text'; text: string } | { type: 'image'; mimeType: 'image/png'; data: string };
export type PreviewResult = { content: Content[]; isError?: boolean };
export type PreviewInput = { action: string; url?: string; ref?: string; text?: string; key?: string };
type Request = { resolve: (value: any) => void; reject: (error: Error) => void };
const operations = new Map([
  ['start', ['url']], ['attach', []], ['navigate', ['url']], ['click', ['ref']], ['type', ['ref', 'text']], ['press', ['key']],
  ['snapshot', []], ['console', []], ['network', []], ['screenshot', []], ['show', []], ['stop', []],
]);

export function previewInput(raw: Record<string, unknown>): PreviewInput {
  const action = raw.operation;
  const keys = typeof action === 'string' ? operations.get(action) : undefined;
  if (typeof action !== 'string' || !keys || Object.keys(raw).length !== keys.length + 2)
    throw new Error('Invalid Playwright operation');
  const input: PreviewInput = { action };
  for (const key of keys as Array<'url' | 'ref' | 'text' | 'key'>) {
    const value = raw[key];
    if (typeof value !== 'string' || value.length > 4096
      || (key === 'ref' && !/^(?:f\d{1,10})?e\d{1,10}$/.test(value))
      || (key === 'key' && !/^(?:[a-z\d]|Enter|Tab|Escape|Backspace|Delete|Space|Arrow(?:Up|Down|Left|Right)|Home|End|Page(?:Up|Down))$/i.test(value)))
      throw new Error('Invalid Playwright operation arguments');
    input[key] = value;
  }
  return input;
}

export function permittedPreviewAction(scope: AutomationScope, action: string) {
  if (scope.kind === 'attached' || scope.kind === 'public' && scope.signedIn)
    return ['snapshot', 'screenshot', 'show', 'stop'].includes(action) || scope.kind === 'attached' && scope.mode === 'fill' && action === 'type';
  return scope.kind === 'local' || !['console', 'network'].includes(action);
}

function sanitize(result: unknown): PreviewResult {
  const raw = result as { content?: unknown[]; isError?: boolean } | undefined;
  const content: Content[] = [];
  let remaining = 60_000;
  for (const part of (Array.isArray(raw?.content) ? raw.content : []).slice(0, 12)) {
    const value = part as Partial<{ type: string; text: string; mimeType: string; data: string }>;
    if (value?.type === 'text' && typeof value.text === 'string' && remaining) {
      content.push({ type: 'text', text: value.text.slice(0, remaining) });
      remaining -= Math.min(remaining, value.text.length);
    } else if (value?.type === 'image' && value.mimeType === 'image/png'
      && typeof value.data === 'string' && value.data.length <= 12_000_000) {
      content.push({ type: 'image', mimeType: 'image/png', data: value.data });
    }
  }
  return content.length ? { content, isError: raw?.isError === true }
    : { content: [{ type: 'text', text: 'No preview result was available.' }], isError: true };
}

export class PlaywrightPreview {
  private scope: PreviewProtocolScope;
  private child?: UtilityProcess;
  private started?: Request;
  private inflight?: Request;
  private inflightAction?: string;
  private output?: Promise<string>;
  private closed = false;
  private cleaning = false;
  private resumeThrottling = false;
  private finish!: () => void;
  readonly finished = new Promise<void>(resolve => { this.finish = resolve; });
  private id = 0;
  private readonly leaseTimeout: NodeJS.Timeout;

  constructor(private guest: WebContents, private boundary: AutomationScope, private ended: () => void,
    private helper = join(app.isPackaged ? process.resourcesPath : join(app.getAppPath(), 'dist'),
      'playwright-preview', 'playwright-preview-helper.cjs')) {
    this.scope = new PreviewProtocolScope(guest, boundary, message => this.post({ type: 'cdp-response', message }), () => this.close());
    this.leaseTimeout = setTimeout(() => this.close(), 10 * 60_000);
    this.leaseTimeout.unref();
  }

  private post(value: unknown) {
    if (!this.closed) this.child?.postMessage(value);
  }

  async start(size?: { width: number; height: number }) {
    if (this.closed) throw new Error('Preview permission ended');
    try {
      this.output = mkdtemp(join(tmpdir(), 'dfsc-playwright-'));
      const output = await this.output;
      if (this.closed) throw new Error('Preview permission ended');
      await this.scope.attach();
      if (this.closed) throw new Error('Preview permission ended');
      this.resumeThrottling = this.guest.getBackgroundThrottling();
      if (this.resumeThrottling) this.guest.setBackgroundThrottling(false);
      await this.layout(size);
      if (this.closed) throw new Error('Preview permission ended');
      const child = utilityProcess.fork(this.helper, [], {
        cwd: output, env: {}, stdio: 'ignore', serviceName: 'DFSC Playwright Preview',
      });
      this.child = child;
      child.on('message', this.receive);
      child.once('exit', () => {
        this.child = undefined;
        this.close();
        void this.clearOutput();
      });
      child.once('spawn', () => {
        if (this.closed) child.kill();
        else this.post({ type: 'start', outputDir: output });
      });
      try { await this.wait<void>(pending => { this.started = pending; }); }
      finally { this.started = undefined; }
    } catch {
      this.close();
      throw new Error('Could not connect Playwright to the built-in preview');
    }
  }

  private receive = (value: any) => {
    if (this.closed || !value) return;
    if (value.type === 'ready') this.started?.resolve(undefined);
    if (value.type === 'failed') this.close();
    if (value.type === 'result' && value.id === this.id) {
      const result = sanitize(value.result);
      if (this.inflightAction === 'network' && this.boundary.kind === 'local') {
        const origin = this.boundary.origin;
        const text = !result.isError && result.content.flatMap(part => part.type === 'text' ? previewNetworkSummary(part.text, origin) : [])
          .filter(Boolean).join('\n');
        result.content = [{ type: 'text', text: result.isError ? 'Network summary unavailable.' : text || 'No same-origin requests to report.' }];
      }
      this.inflight?.resolve(result);
    }
    if (value.type === 'cdp-command' && Number.isSafeInteger(value.message?.id)) {
      const { id, sessionId } = value.message;
      void this.scope.dispatch(value.message).then(result => {
        this.post({ type: 'cdp-response', message: { id, sessionId, result } });
      }, () => {
        this.post({ type: 'cdp-response', message: { id, sessionId,
          error: { code: -32000, message: 'Command unavailable in this preview' } } });
      });
    }
  };

  private async wait<T>(begin: (request: Request) => void, signal?: AbortSignal): Promise<T> {
    if (this.closed || signal?.aborted) throw new Error('Preview permission ended');
    const timer = setTimeout(() => this.close(), 15_000);
    const abort = () => this.close();
    signal?.addEventListener('abort', abort, { once: true });
    try { return await new Promise<T>((resolve, reject) => begin({ resolve, reject })); }
    finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
    }
  }

  async call(input: PreviewInput, signal?: AbortSignal, onActivity?: (busy: boolean) => void): Promise<PreviewResult> {
    if (!permittedPreviewAction(this.boundary, input.action))
      throw new Error('This browser grant does not allow that operation');
    if (input.action === 'navigate' && !automationNavigation(input.url, this.boundary))
      throw new Error('Address is outside the attached browser site');
    if (this.inflight) throw new Error('A Playwright operation is already in progress');
    let started = false;
    try {
      return await this.wait<PreviewResult>(request => {
        this.inflight = request;
        this.inflightAction = input.action;
        started = true;
        onActivity?.(true);
        this.post({ type: 'call', id: ++this.id, input, fillOnly: this.boundary.kind === 'attached' && input.action === 'type' });
      }, signal);
    } finally {
      this.inflight = undefined;
      this.inflightAction = undefined;
      if (started) onActivity?.(false);
    }
  }

  async layout(size?: { width: number; height: number }) {
    if (this.boundary.kind !== 'attached') return this.scope.layout(size);
  }

  private async clearOutput() {
    if (this.cleaning) return;
    this.cleaning = true;
    let path: string | undefined;
    try {
      path = await this.output;
      if (path) await rm(path, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    } catch (error) {
      if (path) console.warn(`Could not clean up Playwright preview output at ${path}: ${String(error)}`);
    } finally { this.finish(); }
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    clearTimeout(this.leaseTimeout);
    const error = new Error('Playwright preview permission ended');
    this.started?.reject(error);
    this.inflight?.reject(error);
    this.scope.close();
    if (this.resumeThrottling && !this.guest.isDestroyed()) this.guest.setBackgroundThrottling(true);
    if (this.child) this.child.kill();
    else void this.clearOutput();
    this.ended();
  }
}
