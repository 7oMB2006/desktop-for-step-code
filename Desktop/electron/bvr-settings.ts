import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { isAbsolute, join, resolve } from 'node:path';
import { lstat, mkdir, open, rename, unlink, writeFile } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import type { BvrConfiguration, BvrConfigurationInput, BvrEnvironmentCheck } from '../src/bvr-settings';

const endpoints = new Set(['https://api.stepfun.com/v1', 'https://api.stepfun.ai/v1',
  'https://api.stepfun.com/step_plan/v1', 'https://api.stepfun.ai/step_plan/v1']);
const fail = (code: string): never => { throw new Error(`bvr:${code}`); };
function publicProxy(value: string | undefined) {
  if (!value) return '';
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && !url.search && !url.hash && url.pathname === '/' ? value : '';
  } catch { return ''; }
}
function unsupported(env: Record<string, string>) {
  return Boolean(env.CODEX_VIDEO_PROVIDER && env.CODEX_VIDEO_PROVIDER !== 'stepfun'
    || env.STEPFUN_BASE_URL && !endpoints.has(env.STEPFUN_BASE_URL.replace(/\/+$/u, ''))
    || env.STEPFUN_ASR_BASE_URL && !endpoints.has(env.STEPFUN_ASR_BASE_URL.replace(/\/+$/u, ''))
    || env.ALL_PROXY
    || (env.HTTPS_PROXY || env.HTTP_PROXY) && !publicProxy(env.HTTPS_PROXY || env.HTTP_PROXY));
}
function text(value: unknown, max = 2048) {
  if (typeof value !== 'string' || value.length > max || /[\0\r\n]/u.test(value)) return fail('invalid-input');
  return value.trim();
}
function path(value: unknown, required = false) {
  const result = text(value);
  if (required && !result || result && !isAbsolute(result)) return fail('invalid-input');
  return result;
}
async function bounded(path: string, limit: number) {
  const file = await open(path, 'r');
  try {
    const info = await file.stat();
    if (!info.isFile() || info.size > limit) return fail('storage');
    const bytes = Buffer.alloc(limit + 1);
    const { bytesRead } = await file.read(bytes, 0, bytes.length, 0);
    if (bytesRead > limit) return fail('storage');
    return bytes.subarray(0, bytesRead).toString('utf8');
  } finally { await file.close(); }
}

export class BvrSettings {
  private directory: string;
  private file: string;
  private saving = false;
  constructor(private root: string, private invalidate: () => void = () => {}) {
    this.directory = join(root, 'bvr');
    this.file = join(this.directory, 'config.json');
  }
  private async safeStorage() {
    for (const target of [this.root, this.directory, this.file]) {
      try { if ((await lstat(target)).isSymbolicLink()) return fail('storage'); }
      catch (error: any) { if (error.code !== 'ENOENT') throw error; }
    }
  }
  private async load() {
    await this.safeStorage();
    let raw = '';
    try { raw = await bounded(this.file, 65536); }
    catch (error: any) { if (error.code !== 'ENOENT') return fail('storage'); }
    let config: Record<string, any> = {}, environment: Record<string, string> = {}, privateText = '';
    try {
      if (raw) {
        config = JSON.parse(raw);
        if (!config || typeof config !== 'object' || Array.isArray(config)
          || ![1, 2].includes(config.schemaVersion) || typeof config.runtimeDirectory !== 'string'
          || config.schemaVersion === 2 && !['dfsc', 'independent'].includes(config.mode)) return fail('storage');
        if (config.envFile) {
          if (typeof config.envFile !== 'string' || !isAbsolute(config.envFile)) return fail('storage');
          privateText = await bounded(config.envFile, 128 * 1024);
          environment = Object.fromEntries(Object.entries(parseEnv(privateText))
            .filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
        }
      }
    } catch { return fail('storage'); }
    const revision = createHash('sha256').update(raw).update('\0').update(privateText).digest('hex');
    return { config, environment, revision, configured: Boolean(raw) };
  }
  async read(): Promise<BvrConfiguration> {
    try {
      const { config, environment: env, revision, configured } = await this.load();
      const apiBase = (env.STEPFUN_BASE_URL ?? '').replace(/\/+$/u, '');
      const asrApiBase = (env.STEPFUN_ASR_BASE_URL ?? '').replace(/\/+$/u, '');
      return {
        revision, configured, mode: config.schemaVersion === 1 ? 'independent' : config.mode ?? 'dfsc',
        runtimeDirectory: config.runtimeDirectory ?? '', apiBase: endpoints.has(apiBase) ? apiBase : 'https://api.stepfun.com/v1',
        model: env.STEPFUN_VIDEO_MODEL ?? 'step-3.7-flash', hasApiKey: Boolean(env.STEPFUN_API_KEY?.trim()),
        asrApiBase: endpoints.has(asrApiBase) ? asrApiBase : 'https://api.stepfun.com/v1',
        asrModel: env.STEPFUN_ASR_MODEL ?? 'stepaudio-2.5-asr', hasAsrApiKey: Boolean(env.STEPFUN_ASR_API_KEY?.trim()),
        cookieFile: env.BILIBILI_COOKIES_FILE ?? '', proxy: publicProxy(env.HTTPS_PROXY || env.HTTP_PROXY),
        downloadDirectory: env.BILIBILI_DOWNLOAD_DIRECTORY ?? '', preferCaptions: env.BILIBILI_PREFER_CAPTIONS !== 'false',
        ...(unsupported(env) ? { legacyProvider: 'other' } : {}),
      };
    } catch { return fail('storage'); }
  }
  private async prepare(input: BvrConfigurationInput) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) return fail('invalid-input');
    const current = await this.load();
    if (input.revision !== current.revision) return fail('stale');
    if (unsupported(current.environment)) return fail('legacy-provider');
    if (!['dfsc', 'independent'].includes(input.mode) || typeof input.preferCaptions !== 'boolean') return fail('invalid-input');
    const runtimeDirectory = path(input.runtimeDirectory, true);
    const cookieFile = path(input.cookieFile), downloadDirectory = path(input.downloadDirectory);
    const apiBase = text(input.apiBase).replace(/\/+$/u, ''), asrApiBase = text(input.asrApiBase).replace(/\/+$/u, '');
    const model = text(input.model, 160), asrModel = text(input.asrModel, 160);
    const apiKey = input.apiKey === undefined ? current.environment.STEPFUN_API_KEY ?? '' : text(input.apiKey, 8192);
    const asrApiKey = input.asrApiKey === undefined ? current.environment.STEPFUN_ASR_API_KEY ?? '' : text(input.asrApiKey, 8192);
    if (input.mode === 'independent') {
      if (!endpoints.has(apiBase) || !endpoints.has(asrApiBase)) return fail('invalid-endpoint');
      if (!apiKey || !asrApiKey) return fail('missing-key');
      if (!model || !asrModel) return fail('invalid-input');
    }
    const proxy = text(input.proxy);
    if (proxy) {
      let url;
      try { url = new URL(proxy); } catch { return fail('invalid-input'); }
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash
        || url.pathname !== '/') return fail('invalid-input');
    }
    const env: Record<string, string> = { ...current.environment, CODEX_VIDEO_PROVIDER: 'stepfun',
      STEPFUN_BASE_URL: apiBase, STEPFUN_VIDEO_MODEL: model, STEPFUN_API_KEY: apiKey,
      STEPFUN_ASR_BASE_URL: asrApiBase, STEPFUN_ASR_MODEL: asrModel, STEPFUN_ASR_API_KEY: asrApiKey,
      BILIBILI_COOKIES_FILE: cookieFile, BILIBILI_DOWNLOAD_DIRECTORY: downloadDirectory,
      BILIBILI_PREFER_CAPTIONS: String(input.preferCaptions),
    };
    if (cookieFile) delete env.BILIBILI_COOKIES_FROM_BROWSER;
    delete env.HTTP_PROXY; delete env.HTTPS_PROXY;
    if (proxy) { env.HTTP_PROXY = proxy; env.HTTPS_PROXY = proxy; }
    return { ...current, runtimeDirectory, env };
  }
  async check(input: BvrConfigurationInput): Promise<BvrEnvironmentCheck> {
    const prepared = await this.prepare(input);
    try {
      const manifest = JSON.parse(await bounded(join(prepared.runtimeDirectory, 'package.json'), 65536));
      if (manifest.name !== 'bilibili-video-research-mcp'
        || !(await lstat(join(prepared.runtimeDirectory, 'src/index.ts'))).isFile()) return fail('runtime');
      const require = createRequire(join(prepared.runtimeDirectory, 'package.json'));
      for (const dependency of ['tsx', 'dotenv', '@modelcontextprotocol/sdk/server/index.js', '@google/genai', 'zod', 'ffmpeg-static', 'yt-dlp-exec'])
        require.resolve(dependency);
      if (manifest.dfscConfigurationVersion !== 1) return fail('runtime-upgrade');
      if (Number(process.versions.node.split('.')[0]) < 24) return fail('runtime');
      return { node: process.versions.node, dependencies: true, independentConnections: true };
    } catch (error) {
      if (error instanceof Error && error.message === 'bvr:runtime-upgrade') throw error;
      return fail('runtime');
    }
  }
  async save(input: BvrConfigurationInput): Promise<BvrConfiguration> {
    if (this.saving) return fail('stale');
    this.saving = true;
    try { return await this.write(input); }
    finally { this.saving = false; }
  }
  private async write(input: BvrConfigurationInput): Promise<BvrConfiguration> {
    await this.check(input);
    const prepared = await this.prepare(input);
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    await this.safeStorage();
    const envFile = join(this.directory, `desktop-${randomUUID()}.env`);
    const temp = `${this.file}.${randomUUID()}.tmp`;
    try {
      const entries = Object.entries(prepared.env).filter(([key]) =>
        /^(?:CODEX_VIDEO_PROVIDER|STEPFUN_[A-Z0-9_]+|GEMINI_[A-Z0-9_]+|BILIBILI_[A-Z0-9_]+|FFMPEG_PATH|HTTPS?_PROXY|ALL_PROXY|NO_PROXY)$/u.test(key));
      // A single-quoted dotenv value preserves spaces, hashes and Windows paths literally.
      const content = entries.map(([key, value]) => {
        if (/[\0\r\n]/u.test(value)) return fail('invalid-input');
        const quote = !value.includes("'") ? "'" : !value.includes('`') ? '`' : '';
        if (!quote) return fail('invalid-input');
        return `${key}=${quote}${value}${quote}`;
      }).join('\n');
      await writeFile(envFile, `${content}\n`, { mode: 0o600, flag: 'wx' });
      await writeFile(temp, `${JSON.stringify({ schemaVersion: 2, mode: input.mode, runtimeDirectory: prepared.runtimeDirectory,
        ...(input.mode === 'dfsc' ? { hostAccess: 'confirm' } : {}), envFile }, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
      if ((await this.load()).revision !== input.revision) return fail('stale');
      this.invalidate();
      await rename(temp, this.file);
    } catch (error) {
      await unlink(temp).catch(() => {});
      await unlink(envFile).catch(() => {});
      if (error instanceof Error && error.message.startsWith('bvr:')) throw error;
      return fail('storage');
    }
    const previous = prepared.config.envFile;
    if (typeof previous === 'string' && resolve(previous) === join(this.directory, previous.split(/[\\/]/u).at(-1)!)
      && /^desktop-[a-f0-9-]+\.env$/u.test(previous.split(/[\\/]/u).at(-1)!))
      await unlink(previous).catch(() => {});
    return this.read();
  }
}
