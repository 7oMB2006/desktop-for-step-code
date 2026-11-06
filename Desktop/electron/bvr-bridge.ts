import { randomBytes } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { mkdir, readFile, writeFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import type { SessionRuntime, SessionRuntimes } from './session-runtimes';
import type { RuntimeState } from '../src/contracts';

const MAX_BODY = 32 * 1024 * 1024;
const MAX_RESPONSE = 2 * 1024 * 1024;
type Selection = {
  key: string; endpoint: string; model: string; sessionId: string; expires: number;
  channel: 'plan' | 'api'; region: 'cn' | 'global'; video: boolean;
};
type Lease = { worker: SessionRuntime; selection: Selection; revision: string; approved?: Promise<boolean>; active: Set<AbortController> };
type Auth = Record<string, unknown>;

export function bvrSelection(auth: Auth, worker: SessionRuntime, changing = false, now = Date.now()): Selection {
  const model = worker.state?.model;
  if (changing || worker.status !== 'connected' || worker.stopping || !worker.state?.sessionId || !model)
    throw new BridgeError('DFSC account or session is not ready');
  if (model.provider !== 'step') throw new BridgeError('Follow DFSC currently supports official Step accounts only; choose independent mode for another provider');
  const credential = auth.step as Record<string, unknown> | undefined;
  if (!credential || credential.type !== 'oauth' || typeof credential.access !== 'string' || !credential.access.trim())
    throw new BridgeError('Sign in to an official Step account in DFSC first');
  const profile = credential.profile === 'step' ? 'step_plan' : credential.profile;
  if (!['step_plan', 'step_plan_oversea', 'platform_cn', 'platform_oversea'].includes(String(profile)))
    throw new BridgeError('The active DFSC account has no supported billing profile');
  if (typeof credential.expires !== 'number' || !Number.isFinite(credential.expires) || credential.expires <= now + 1000)
    throw new BridgeError('DFSC login expired; sign in again');
  const channel = String(profile).startsWith('platform_') ? 'api' : 'plan';
  const region = String(profile).endsWith('oversea') ? 'global' : 'cn';
  return {
    key: credential.access, expires: credential.expires, channel, region, model: model.id,
    sessionId: worker.state.sessionId,
    endpoint: `https://${region === 'global' ? 'api.stepfun.ai' : 'api.stepfun.com'}${channel === 'plan' ? '/step_plan' : ''}/v1`,
    // Stable BVR model plus its recorded Plan compatibility model; image input alone is insufficient.
    video: ['step-3.7-flash', 'step-5-preview'].includes(model.id) || Boolean(model.input?.includes('video')),
  };
}
function sameSelection(a: Selection, b: Selection) {
  return a.key === b.key && a.endpoint === b.endpoint && a.model === b.model && a.sessionId === b.sessionId
    && a.expires === b.expires && a.video === b.video;
}
async function boundedResponse(response: Response) {
  if (!response.body) throw new Error('Empty Step response');
  let size = 0;
  const reader = response.body.getReader(), chunks: Uint8Array[] = [];
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > MAX_RESPONSE) throw new Error('Step response is too large');
      chunks.push(value);
    }
  } finally { await reader.cancel(); }
  return Buffer.concat(chunks).toString('utf8');
}
function transcript(text: string) {
  const deltas: string[] = [], completed: string[] = [];
  for (const block of text.split(/\r?\n\r?\n/)) {
    const line = block.split(/\r?\n/).find(value => value.startsWith('data:'));
    if (!line) continue;
    let event;
    try { event = JSON.parse(line.slice(5)); } catch { continue; }
    if (event.type === 'error') throw new Error('Step ASR failed');
    if (event.type === 'transcript.text.delta' && typeof event.delta === 'string') deltas.push(event.delta);
    if (event.type === 'transcript.text.done' && typeof event.text === 'string') completed.push(event.text);
  }
  const result = completed.join('') || deltas.join('');
  if (!result.trim()) throw new Error('Step ASR returned no transcript');
  return result;
}

// Installation does not grant access. The separate local opt-in and native
// per-session/account/model confirmation are required; no API keys leave main.
export class BvrBridge {
  private server?: Server;
  private token = randomBytes(32).toString('hex');
  private leases = new Map<SessionRuntime, Lease>();
  private descriptor: string;
  constructor(private root: string, private pool: SessionRuntimes, private auth: () => Auth,
    private changing: () => boolean, private language: () => 'zh' | 'en',
    private request: typeof fetch = fetch) {
    this.descriptor = join(root, 'bvr', 'host.json');
  }
  private async enabled() {
    try {
      const raw = await readFile(join(this.root, 'bvr', 'config.json'), 'utf8');
      if (raw.length > 65536) return false;
      const config = JSON.parse(raw);
      return config.schemaVersion === 2 && config.mode === 'dfsc' && config.hostAccess === 'confirm';
    } catch { return false; }
  }
  private async selection(worker: SessionRuntime) {
    const rpc = worker.rpc;
    const state = await rpc.request('get_state', {}, 10000) as RuntimeState;
    if (worker.rpc !== rpc || this.pool.workers.get(worker.id) !== worker)
      throw new BridgeError('BVR session connection expired');
    return bvrSelection(this.auth(), { ...worker, state }, this.changing() || worker.mutating);
  }
  private async lease(worker: SessionRuntime) {
    const selection = await this.selection(worker);
    const prior = this.leases.get(worker);
    if (prior && sameSelection(prior.selection, selection)) return prior;
    this.detach(worker);
    const next: Lease = { worker, selection, revision: randomBytes(24).toString('hex'), active: new Set() };
    this.leases.set(worker, next);
    return next;
  }
  private async assertCurrent(lease: Lease) {
    const selection = await this.selection(lease.worker);
    if (this.leases.get(lease.worker) !== lease || this.pool.workers.get(lease.worker.id) !== lease.worker
      || !sameSelection(lease.selection, selection))
      throw new BridgeError('DFSC account, model or session changed; start a new BVR research');
  }
  async start() {
    const server = createServer(async (req, res) => {
      const reply = (status: number, body: unknown) => {
        if (!res.destroyed) { res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(body)); }
      };
      const controller = new AbortController();
      res.on('close', () => controller.abort());
      try {
        if (req.method !== 'POST' || !['/context', '/complete'].includes(req.url ?? '') || req.headers.origin
          || req.headers.authorization !== `Bearer ${this.token}` || !await this.enabled())
          return reply(403, { error: 'BVR host access is not authorized' });
        let size = 0;
        const chunks: Buffer[] = [];
        for await (const chunk of req) {
          size += chunk.length;
          if (size > MAX_BODY) { reply(413, { error: 'BVR request is too large' }); return; }
          chunks.push(chunk);
        }
        const data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        const worker = [...this.pool.workers.values()].find(item => item.rpc.pid === data.runtimePid);
        if (!Number.isSafeInteger(data.runtimePid) || data.runtimePid <= 0 || !worker)
          return reply(403, { error: 'BVR session connection expired' });
        const lease = await this.lease(worker);
        if (req.url === '/context') return reply(200, {
          version: 1, revision: lease.revision, channel: lease.selection.channel, region: lease.selection.region,
          model: lease.selection.model, capabilities: { text: true, video: lease.selection.video, asr: true },
        });
        if (data.revision !== lease.revision) return reply(409, { error: 'DFSC account, model or session changed; start a new BVR research' });
        reply(200, await this.complete(lease, data, controller.signal));
      } catch (error) {
        // Never surface upstream bodies or transport diagnostics, which may echo credentials.
        reply(400, { error: error instanceof BridgeError ? error.message : 'BVR host request failed or the DFSC account/session changed; no fallback was used' });
      }
    });
    server.requestTimeout = 30000;
    server.headersTimeout = 10000;
    await new Promise<void>((done, fail) => { server.once('error', fail); server.listen(0, '127.0.0.1', () => { server.off('error', fail); done(); }); });
    this.server = server;
    try {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('BVR endpoint unavailable');
      await mkdir(join(this.root, 'bvr'), { recursive: true, mode: 0o700 });
      await writeFile(this.descriptor, JSON.stringify({ version: 1, url: `http://127.0.0.1:${address.port}`, token: this.token }), { mode: 0o600 });
    } catch (error) { await this.stop(); throw error; }
  }
  private async complete(lease: Lease, data: Record<string, any>, signal: AbortSignal) {
    if (!['text', 'video', 'asr'].includes(data.kind) || typeof data.prompt !== 'string' || !data.prompt.trim() || data.prompt.length > 100000)
      throw new BridgeError('Invalid BVR research request');
    const selection = lease.selection;
    if (data.kind === 'video' && !selection.video)
      throw new BridgeError('The current DFSC model has no verified video support; select a video-capable model or use independent mode');
    if (data.kind !== 'text' && (!data.media || typeof data.media.data !== 'string' || !data.media.data.length
      || !/^[A-Za-z0-9+/]+={0,2}$/.test(data.media.data) || data.media.data.length % 4 !== 0
      || !(data.kind === 'asr' ? data.media.mimeType === 'audio/wav' : ['video/mp4', 'video/webm', 'video/quicktime'].includes(data.media.mimeType))))
      throw new BridgeError('Unsupported or invalid BVR media');
    if (lease.active.size >= 2) throw new BridgeError('Too many concurrent BVR requests in this session');
    const controller = new AbortController();
    lease.active.add(controller);
    const combined = AbortSignal.any([signal, controller.signal]);
    try {
      await this.assertCurrent(lease);
      if (!lease.approved) {
        const zh = this.language() === 'zh';
        const asrNote = zh
          ? '\n无字幕转写另使用同账户、同渠道的 stepaudio-2.5-asr 专用模型。'
          : '\nNo-caption transcription uses the same account and channel with the dedicated stepaudio-2.5-asr model.';
        lease.approved = this.pool.confirm(lease.worker,
          zh ? '允许 BVR 使用此会话的模型账户？' : 'Allow BVR to use this session model account?',
          (zh ? `BVR 将使用 ${selection.model}，渠道：${selection.channel === 'plan' ? 'Step Plan 套餐' : '直调 API'}，地区：${selection.region}。\n视频、音频或文字会发送给阶跃，消耗该账户额度。仅授权此会话的当前账户和模型；不会在失败时切换计费渠道。`
            : `BVR will use ${selection.model} via ${selection.channel === 'plan' ? 'Step Plan' : 'direct API'} (${selection.region}). Media or text is sent to Step and consumes this account's quota. Approval covers this session/account/model only. No billing fallback.`) + asrNote,
          combined);
      }
      if (!await lease.approved) {
        lease.approved = undefined;
        throw new BridgeError('BVR model access was not approved');
      }
      await this.assertCurrent(lease);
      if (!await this.enabled()) throw new BridgeError('BVR host access was revoked');
      combined.throwIfAborted();
      const requestSignal = AbortSignal.any([combined, AbortSignal.timeout(120000)]);
      const asr = data.kind === 'asr';
      const content = data.kind === 'video'
        ? [{ type: 'video_url', video_url: { url: `data:${data.media.mimeType};base64,${data.media.data}` } }, { type: 'text', text: data.prompt }]
        : data.prompt;
      const response = await this.request(`${selection.endpoint}${asr ? '/audio/asr/sse' : '/chat/completions'}`, {
        method: 'POST', redirect: 'error', signal: requestSignal,
        headers: { Authorization: `Bearer ${selection.key}`, 'Content-Type': 'application/json', Accept: asr ? 'text/event-stream' : 'application/json' },
        body: JSON.stringify(asr
          ? { audio: { data: data.media.data, input: { transcription: { model: 'stepaudio-2.5-asr', language: 'zh', enable_itn: true }, format: { type: 'wav' } } } }
          : { model: selection.model, messages: [{ role: 'user', content }] }),
      });
      if (!response.ok) { await response.body?.cancel(); throw new BridgeError(`Step ${selection.channel} request failed (HTTP ${response.status}); no fallback was used`); }
      const body = await boundedResponse(response);
      await this.assertCurrent(lease);
      requestSignal.throwIfAborted();
      if (!await this.enabled()) throw new BridgeError('BVR host access was revoked');
      const text = asr ? transcript(body) : JSON.parse(body)?.choices?.[0]?.message?.content;
      if (typeof text !== 'string' || !text.trim()) throw new BridgeError('Step returned no research text');
      return { text };
    } finally { lease.active.delete(controller); }
  }
  detach(worker: SessionRuntime) {
    const lease = this.leases.get(worker);
    this.leases.delete(worker);
    for (const controller of lease?.active ?? []) controller.abort();
  }
  invalidate() { for (const worker of this.leases.keys()) this.detach(worker); }
  async stop() {
    this.invalidate();
    const server = this.server;
    this.server = undefined;
    if (server) {
      const closed = new Promise<void>(done => server.close(() => done()));
      server.closeAllConnections();
      await closed;
      await unlink(this.descriptor).catch(() => {});
    }
  }
}
class BridgeError extends Error {}
