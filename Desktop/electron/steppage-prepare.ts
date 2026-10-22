import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdir, lstat, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { StepPagePreparation } from '../src/contracts';

const execute = promisify(execFile);
export const STEPPAGE_ARTIFACT = {
  url: 'https://dl.stepfun.com/steppage-mcp/p/latest/steppage-mcp.mjs',
  sha256: '353070e06e144ce700159b1835f36cea2674911c85334ddbb8503c69d9f87e7e',
  version: '1.0.0',
};
const limit = 4 * 1024 * 1024;
type Request = (url: string, options: RequestInit) => Promise<Response>;
type Failure = NonNullable<StepPagePreparation['error']>;
class PreparationError extends Error {
  constructor(readonly reason: Failure) { super(reason); }
}

/** Download only on an explicit user action; never execute an unverified artifact. */
export class StepPagePreparer {
  readonly bundlePath: string;
  readonly homePath: string;
  private pending?: Promise<StepPagePreparation>;
  private error?: Failure;
  constructor(private root: string, private node: string, private request: Request,
    private artifact = STEPPAGE_ARTIFACT) {
    this.bundlePath = join(root, 'steppage', 'bin', 'steppage-mcp.mjs');
    this.homePath = join(root, 'steppage', 'home');
  }
  private async directories(create: boolean) {
    for (const path of [join(this.root, 'steppage'), join(this.root, 'steppage', 'bin'), this.homePath]) {
      if (create) await mkdir(path, { recursive: true });
      try {
        const info = await lstat(path);
        if (info.isSymbolicLink() || !info.isDirectory()) throw new PreparationError('storage');
      } catch (error: any) {
        if (!create && error.code === 'ENOENT') continue;
        throw error;
      }
    }
  }
  private async verified(path: string) {
    try {
      const info = await lstat(path);
      if (!info.isFile() || info.isSymbolicLink() || info.size > limit) return false;
      return createHash('sha256').update(await readFile(path)).digest('hex') === this.artifact.sha256;
    } catch (error: any) {
      if (error.code === 'ENOENT') return false;
      throw error;
    }
  }
  async snapshot(): Promise<StepPagePreparation> {
    let installed = false;
    try { await this.directories(false); installed = await this.verified(this.bundlePath); } catch {}
    return { status: this.pending ? 'preparing' : this.error ? 'failed' : installed ? 'ready' : 'missing',
      installed, ...(installed ? { version: this.artifact.version } : {}), ...(this.error ? { error: this.error } : {}) };
  }
  prepare(apply: (bundle: string, home: string) => Promise<void>) {
    return this.pending ??= this.run(apply).finally(() => { this.pending = undefined; });
  }
  private async run(apply: (bundle: string, home: string) => Promise<void>): Promise<StepPagePreparation> {
    this.error = undefined;
    let temporary: string | undefined;
    try {
      await this.directories(true);
      if (!await this.verified(this.bundlePath)) {
        const signal = AbortSignal.timeout(35_000);
        let response: Response;
        try { response = await this.request(this.artifact.url, { signal, redirect: 'error', credentials: 'omit' }); }
        catch { throw new PreparationError('download'); }
        if (!response.ok || !response.body) throw new PreparationError('download');
        const reader = response.body.getReader();
        const chunks: Uint8Array[] = [];
        let size = 0;
        try {
          while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            size += value.byteLength;
            if (size > limit) throw new PreparationError('integrity');
            chunks.push(value);
          }
        } catch (error) {
          if (error instanceof PreparationError) throw error;
          throw new PreparationError('download');
        } finally { await reader.cancel().catch(() => {}); }
        const bytes = Buffer.concat(chunks);
        if (createHash('sha256').update(bytes).digest('hex') !== this.artifact.sha256)
          throw new PreparationError('integrity');
        temporary = join(this.root, 'steppage', 'bin', `download-${randomUUID()}.mjs`);
        await writeFile(temporary, bytes, { flag: 'wx', mode: 0o600 });
        await this.probe(temporary);
        // Same-profile races install the same fingerprint; no unverified bytes become live.
        await this.directories(false);
        await rename(temporary, this.bundlePath);
        temporary = undefined;
      } else await this.probe(this.bundlePath);
      try { await apply(this.bundlePath, this.homePath); }
      catch { throw new PreparationError('configuration'); }
      return { status: 'ready', installed: true, version: this.artifact.version };
    } catch (error) {
      this.error = error instanceof PreparationError ? error.reason : 'storage';
      const state = await this.snapshot();
      return { ...state, status: 'failed' };
    } finally {
      if (temporary) await rm(temporary, { force: true }).catch(() => {});
    }
  }
  private async probe(bundle: string) {
    // Do not inherit Desktop/API credentials or the user's StepPage home.
    const env: NodeJS.ProcessEnv = {
      SYSTEMROOT: process.env.SYSTEMROOT, WINDIR: process.env.WINDIR,
      HOME: this.homePath, USERPROFILE: this.homePath,
    };
    try {
      await execute(this.node, ['--check', bundle], { env, windowsHide: true, timeout: 10_000, maxBuffer: 8192 });
      const result = await execute(this.node, [bundle, '--version'], { env, windowsHide: true, timeout: 10_000, maxBuffer: 8192 });
      if (result.stdout.trim() !== this.artifact.version) throw new Error('version');
    } catch { throw new PreparationError('validation'); }
  }
}
