import { randomUUID } from 'node:crypto';
import type { SpeechConfig, SpeechSettings } from '../src/speech';
import { stepAccount, type StepAccount } from './step-model-account';
import { STEP_ASR_MODEL, StepAsrError, transcribeStepAudio } from './step-asr';

export const SPEECH_FIELD = '__desktopSpeech';
export const MAX_SPEECH_BYTES = 2 * 1024 * 1024;
type Auth = Record<string, unknown>;
type Saved = { config: SpeechConfig; revision: string; key?: string; acknowledged?: boolean; consentVersion?: number };
const CONSENT_VERSION = 2;
const defaults: SpeechConfig = { source: 'follow', endpoint: '', model: STEP_ASR_MODEL, language: 'zh' };
function saved(auth: Auth): Saved {
  const value = auth[SPEECH_FIELD] as Saved | undefined;
  return value ?? { config: defaults, revision: 'unconfigured' };
}
export function speechSettings(auth: Auth, applied: Auth = auth, changing = false): SpeechSettings {
  const value = saved(auth);
  let account: StepAccount | undefined;
  try { account = stepAccount(applied, changing); } catch {}
  return { ...value.config, revision: value.revision, hasKey: Boolean(value.key),
    acknowledged: value.acknowledged === true && value.consentVersion === CONSENT_VERSION,
    followAvailable: Boolean(account), followChannel: account?.channel, followRegion: account?.region };
}
export function validateSpeechConfig(raw: unknown): SpeechConfig {
  if (!raw || typeof raw !== 'object') throw new Error('Invalid speech settings');
  const value = raw as SpeechConfig;
  if (!['custom', 'follow', 'local'].includes(value.source)) throw new Error('Invalid speech source');
  const string = (v: unknown, max: number) => {
    if (typeof v !== 'string' || v.length > max || /[\u0000-\u001f]/.test(v)) throw new Error('Invalid speech settings');
    return v.trim();
  };
  const endpoint = string(value.endpoint, 2048), model = string(value.model, 300), language = string(value.language, 20);
  if (!model || (value.source === 'follow' && model !== STEP_ASR_MODEL)) throw new Error('Unsupported speech model');
  if (language && !/^[a-zA-Z-]{2,20}$/.test(language)) throw new Error('Invalid speech language');
  if (value.source !== 'follow') {
    let url: URL;
    try { url = new URL(endpoint); } catch { throw new Error('Invalid speech endpoint'); }
    const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if (url.username || url.password || url.search || url.hash || !['https:', 'http:'].includes(url.protocol)
      || (url.protocol === 'http:' && !loopback) || (value.source === 'local' && !loopback))
      throw new Error('Use HTTPS, or a loopback HTTP speech service');
  }
  return { source: value.source, endpoint: value.source === 'follow' ? '' : endpoint, model, language };
}
function checkRevision(auth: Auth, revision: unknown) {
  if (typeof revision !== 'string' || revision !== saved(auth).revision) throw new Error('speech:conflict');
}
export function saveSpeech(auth: Auth, raw: unknown, revision: unknown, key?: unknown): Auth {
  checkRevision(auth, revision);
  const config = validateSpeechConfig(raw), previous = saved(auth);
  if (key !== undefined && (typeof key !== 'string' || key.length > 8192 || /[\u0000-\u001f]/.test(key)))
    throw new Error('Invalid speech API key');
  const sameDestination = config.source === previous.config.source && config.endpoint === previous.config.endpoint;
  const secret = key === undefined ? (sameDestination ? previous.key : undefined) : (key as string).trim() || undefined;
  if (config.source === 'custom' && !secret) throw new Error('Speech API key is required');
  return { ...auth, [SPEECH_FIELD]: { config, revision: randomUUID(), key: config.source === 'custom' ? secret : undefined,
    acknowledged: previous.acknowledged, consentVersion: previous.consentVersion } };
}
export function acknowledgeSpeech(auth: Auth, revision: unknown): Auth {
  checkRevision(auth, revision);
  return { ...auth, [SPEECH_FIELD]: { ...saved(auth), revision: randomUUID(), acknowledged: true, consentVersion: CONSENT_VERSION } };
}
function target(auth: Auth, applied: Auth) {
  const value = saved(auth), config = validateSpeechConfig(value.config);
  if (!value.acknowledged || value.consentVersion !== CONSENT_VERSION) throw new Error('Speech privacy acknowledgement is required');
  const account = config.source === 'follow' ? stepAccount(applied) : undefined;
  if (config.source === 'custom' && !value.key) throw new Error('Speech API key is required');
  return { ...config, account, key: config.source === 'custom' ? value.key : undefined };
}
export function validateSpeechWav(raw: unknown): Uint8Array {
  if (!(raw instanceof Uint8Array) || raw.byteLength < 46 || raw.byteLength > MAX_SPEECH_BYTES) throw new Error('Invalid or oversized speech recording');
  const bytes = Buffer.from(raw);
  if (bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WAVE'
    || bytes.toString('ascii', 12, 16) !== 'fmt ' || bytes.readUInt32LE(16) !== 16
    || bytes.readUInt16LE(20) !== 1 || bytes.readUInt16LE(22) !== 1 || bytes.readUInt32LE(24) !== 16000
    || bytes.readUInt32LE(28) !== 32000 || bytes.readUInt16LE(32) !== 2 || bytes.readUInt16LE(34) !== 16
    || bytes.toString('ascii', 36, 40) !== 'data' || bytes.readUInt32LE(40) !== bytes.length - 44
    || bytes.readUInt32LE(4) !== bytes.length - 8 || (bytes.length - 44) % 2 || bytes.length - 44 > 60 * 32000)
    throw new Error('Expected up to 60 seconds of mono 16 kHz PCM WAV');
  return bytes;
}
export class SpeechService {
  private active?: { id: string; destination: ReturnType<typeof target>; current: () => boolean;
    controller: AbortController; timer: ReturnType<typeof setTimeout>; uploading: boolean; sequence: number; samples: number; textLength: number };
  private permissionUntil = 0;
  constructor(private request: typeof fetch = fetch) {}
  begin(auth: Auth, applied: Auth = auth, current: () => boolean = () => true) {
    if (this.active) throw new Error('Speech recording is already active');
    if (!current()) throw new Error('Speech context changed');
    const destination = target(auth, applied), id = randomUUID();
    const timer = setTimeout(() => this.cancel(id), 180000);
    timer.unref?.();
    this.active = { id, destination, current, controller: new AbortController(), timer, uploading: false, sequence: 0, samples: 0, textLength: 0 };
    this.permissionUntil = Date.now() + 15000;
    return { id };
  }
  allowMicrophone() { return Boolean(this.active && !this.active.uploading && this.active.current() && Date.now() < this.permissionUntil); }
  cancel(id?: string) {
    if (!this.active || (id !== undefined && id !== this.active.id)) return;
    clearTimeout(this.active.timer);
    this.active.controller.abort();
    this.active = undefined;
    this.permissionUntil = 0;
  }
  finish(id: unknown) {
    const active = this.active;
    if (!active || active.id !== id || active.uploading) throw new Error('No matching speech recording');
    this.cancel(active.id);
    if (!active.current()) throw new Error('Speech context changed');
  }
  async transcribe(id: unknown, raw: unknown, sequence?: unknown): Promise<string> {
    const active = this.active;
    if (!active || active.id !== id || active.uploading) throw new Error('No matching speech recording');
    const continuous = sequence !== undefined;
    if (continuous && (!Number.isSafeInteger(sequence) || sequence !== active.sequence || active.sequence >= 64))
      throw new Error('Invalid speech segment sequence');
    active.uploading = true; this.permissionUntil = 0;
    let succeeded = false;
    try {
      const bytes = validateSpeechWav(raw);
      const samples = (bytes.length - 44) / 2;
      if ((continuous && samples > 4 * 16000) || active.samples + samples > 60 * 16000)
        throw new Error('Speech recording duration exceeded');
      active.samples += samples;
      if (!active.current()) throw new Error('Speech context changed');
      const signal = AbortSignal.any([active.controller.signal, AbortSignal.timeout(60000)]);
      const destination = active.destination;
      let text: string;
      if (destination.account) {
        text = await transcribeStepAudio(destination.account, { data: Buffer.from(bytes).toString('base64'), mimeType: 'audio/wav' },
          signal, this.request, destination.model, destination.language);
      } else {
        const form = new FormData();
        form.set('file', new Blob([new Uint8Array(bytes)], { type: 'audio/wav' }), 'dictation.wav');
        form.set('model', destination.model); form.set('response_format', 'json');
        if (destination.language) form.set('language', destination.language);
        const response = await this.request(destination.endpoint, {
          method: 'POST', body: form, redirect: 'error', signal,
          headers: destination.key ? { Authorization: `Bearer ${destination.key}` } : {},
        });
        if (!response.ok) { await response.body?.cancel(); throw new Error(`Speech service HTTP ${response.status}`); }
        if (!response.body) throw new Error('Empty speech response');
        const reader = response.body.getReader(), chunks: Uint8Array[] = [];
        let size = 0;
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            size += value.length;
            if (size > 256 * 1024) throw new Error('Speech response is too large');
            chunks.push(value);
          }
        } finally { await reader.cancel().catch(() => {}); }
        text = JSON.parse(Buffer.concat(chunks).toString('utf8'))?.text;
      }
      signal.throwIfAborted();
      if (!active.current()) throw new Error('Speech context changed');
      if (typeof text !== 'string' || !text.trim() || active.textLength + text.length > 50000) throw new Error('Unusable speech response');
      active.textLength += text.length;
      active.sequence++; succeeded = true;
      return text.trim();
    } catch (error) {
      if (active.controller.signal.aborted) throw new Error('Speech cancelled');
      if (error instanceof StepAsrError && error.status) throw new Error(`Speech service HTTP ${error.status}`);
      if (error instanceof Error && /^Speech service HTTP \d+$/.test(error.message)) throw error;
      throw new Error('Speech recognition failed. Check the service, model and recording.');
    } finally {
      if (!continuous || !succeeded) this.cancel(active.id);
      else active.uploading = false;
    }
  }
}
