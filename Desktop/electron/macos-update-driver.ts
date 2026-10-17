import { constants, readFileSync } from 'node:fs';
import { access, copyFile, chmod, lstat, mkdtemp, readFile, realpath, rm, writeFile, open, readdir } from 'node:fs/promises';
import { dirname, join, basename, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { valid } from 'semver';
import type { AppRelease, UpdateTransfer } from '../src/contracts';
import { InstallerFailure, validateInstallerMetadata, type UpdateDriver } from './update-installer';
import { prepareUpdateCache, verifyInstallerFile } from './update-cache';
import { extractMacUpdate } from './macos-update-archive';
import type { MacInstallPlan } from './macos-update-helper';

const exec = promisify(execFile);
export function macUpdateVersion(resources: string, fallback: string) {
  try {
    const marker = JSON.parse(readFileSync(join(resources, 'macos-update.json'), 'utf8'));
    if (valid(marker.version) && (!fallback || marker.version.replace(/-macos\.\d+$/, '') === fallback)) return marker.version as string;
  } catch {}
  return fallback;
}
export function macUpdateUrlAllowed(address: string, original: string) {
  try {
    const source = new URL(original);
    if (source.origin !== 'https://github.com' || source.username || source.password || source.search || source.hash
      || !/^\/7oMB2006\/desktop-for-step-code\/releases\/download\/[^/]+\/[^/]+$/.test(source.pathname)) return false;
    const url = new URL(address);
    return url.protocol === 'https:' && !url.username && !url.password && !url.port && !url.hash
      && (url.href === original || ['release-assets.githubusercontent.com', 'objects.githubusercontent.com'].includes(url.hostname));
  } catch { return false; }
}
export interface MacUpdateHost {
  resources: string; target: string; request: (url: string, options: RequestInit) => Promise<Response>; quit: () => void;
}
export class MacUpdateDriver implements UpdateDriver {
  private file?: string;
  private prepared?: MacInstallPlan;
  private expected?: { version: string; size: number; sha512: string };
  constructor(private root: string, private host: MacUpdateHost) {}
  private async response(address: string, signal: AbortSignal) {
    let url = address;
    for (let redirects = 0; redirects <= 5; redirects++) {
      if (!macUpdateUrlAllowed(url, address)) throw new InstallerFailure('download');
      const response = await this.host.request(url, { signal, credentials: 'omit', redirect: 'manual', cache: 'no-cache' });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        await response.body?.cancel();
        const location = response.headers.get('location');
        if (!location) throw new InstallerFailure('download');
        url = new URL(location, url).href; continue;
      }
      if (response.status !== 200 || !response.body) { await response.body?.cancel(); throw new InstallerFailure('download'); }
      return response;
    }
    throw new InstallerFailure('download');
  }
  async download(release: AppRelease, abort: AbortSignal, progress: (value: Partial<UpdateTransfer>) => void) {
    await prepareUpdateCache(this.root);
    for (const name of await readdir(join(this.root, 'download-cache'))) {
      if (/^mac-[a-f0-9-]{36}\.zip$/.test(name)) await rm(join(this.root, 'download-cache', name), { force: true });
    }
    const signal = AbortSignal.any([abort, AbortSignal.timeout(15 * 60 * 1000)]);
    const installer = release.installer!;
    const metadataUrl = new URL('mac-update.json', installer.url).href;
    const metadataResponse = await this.response(metadataUrl, signal);
    const chunks: Uint8Array[] = []; let size = 0;
    for await (const chunk of metadataResponse.body! as any) {
      signal.throwIfAborted(); size += chunk.length;
      if (size > 128 * 1024) throw new InstallerFailure('metadata');
      chunks.push(chunk);
    }
    let info: any;
    try { info = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new InstallerFailure('metadata'); }
    validateInstallerMetadata(info, release);
    if (info.arch !== 'arm64' || info.bundleIdentifier !== 'community.stepcode.desktop') throw new InstallerFailure('metadata');
    this.expected = { version: release.version, size: installer.size, sha512: info.files[0].sha512 };
    const file = join(this.root, 'download-cache', `mac-${randomUUID()}.zip`);
    const handle = await open(file, 'wx', 0o600);
    try {
      const response = await this.response(installer.url, signal);
      if (Number(response.headers.get('content-length')) !== installer.size) { await response.body?.cancel(); throw new InstallerFailure('integrity'); }
      let transferred = 0; const start = Date.now();
      for await (const chunk of response.body! as any) {
        signal.throwIfAborted(); transferred += chunk.length;
        if (transferred > installer.size) throw new InstallerFailure('integrity');
        await handle.writeFile(chunk);
        progress({ transferred, total: installer.size, percent: transferred / installer.size * 100,
          bytesPerSecond: transferred / Math.max(1, (Date.now() - start) / 1000) });
      }
      await handle.close(); this.file = file;
      await this.verify();
    } catch (error) {
      await handle.close().catch(() => {}); await rm(file, { force: true }); this.file = undefined; throw error;
    }
  }
  async verify() {
    if (!this.file || !this.expected) throw new InstallerFailure('integrity');
    await prepareUpdateCache(this.root);
    await verifyInstallerFile(this.file, join(this.root, 'download-cache'), this.expected.size, this.expected.sha512);
  }
  async prepareInstall() {
    await this.cancelInstall();
    await this.verify();
    const target = resolve(this.host.target);
    if (basename(target) !== 'Desktop for Step Code.app' || target.includes('/AppTranslocation/') || target.startsWith('/Volumes/')
      || await realpath(target) !== target || (await lstat(target)).isSymbolicLink()) throw new InstallerFailure('install');
    await access(dirname(target), constants.W_OK);
    const token = randomUUID();
    const staged = join(dirname(target), `.dfsc-next-${token}.app`);
    const backup = join(dirname(target), `.dfsc-backup-${token}.app`);
    const folder = await realpath(await mkdtemp(join(this.root, 'mac-install-')));
    await chmod(folder, 0o700);
    const extracted = join(folder, 'extracted');
    let prepared = false;
    try {
      const source = await extractMacUpdate(this.file!, extracted, AbortSignal.timeout(120000));
      const plist = JSON.parse((await exec('/usr/bin/plutil', ['-convert', 'json', '-o', '-', join(source, 'Contents/Info.plist')], { maxBuffer: 128 * 1024 })).stdout);
      if (plist.CFBundleIdentifier !== 'community.stepcode.desktop' || plist.CFBundleShortVersionString !== this.expected!.version.replace(/-macos\.\d+$/, '')
        || plist.CFBundleExecutable !== 'Desktop for Step Code' || macUpdateVersion(join(source, 'Contents/Resources'), '') !== this.expected!.version) throw new InstallerFailure('integrity');
      const arch = (await exec('/usr/bin/lipo', ['-archs', join(source, 'Contents/MacOS', plist.CFBundleExecutable)])).stdout.trim();
      if (arch !== 'arm64') throw new InstallerFailure('integrity');
      // ditto preserves framework links and executable modes on the same volume.
      await exec('/usr/bin/ditto', [source, staged], { timeout: 120000 });
      // Downloaded applications still go through Gatekeeper. Never strip quarantine.
      await exec('/usr/bin/xattr', ['-w', 'com.apple.quarantine', `0081;${Math.floor(Date.now() / 1000).toString(16)};Desktop for Step Code;${token}`, staged]);
      const node = join(folder, 'node'); const helper = join(folder, 'helper.cjs');
      await copyFile(join(this.host.resources, 'runtime/node/node'), node, constants.COPYFILE_EXCL);
      await chmod(node, 0o700);
      await copyFile(join(this.host.resources, 'file-opening/macos-update-helper.cjs'), helper, constants.COPYFILE_EXCL);
      await copyFile(join(this.host.resources, 'file-opening/file-applications-macos'), join(folder, 'launcher'), constants.COPYFILE_EXCL);
      await chmod(join(folder, 'launcher'), 0o700);
      const plan: MacInstallPlan = { token, pid: process.pid, target, staged, backup, version: this.expected!.version, folder, targetInode: (await lstat(target)).ino };
      const planPath = join(folder, 'plan.json');
      await writeFile(planPath, JSON.stringify(plan), { mode: 0o600, flag: 'wx' });
      this.prepared = plan; prepared = true;
    } finally {
      if (!prepared) { await rm(staged, { recursive: true, force: true }); await rm(folder, { recursive: true, force: true }); }
    }
  }
  async cancelInstall() {
    const plan = this.prepared; this.prepared = undefined;
    if (!plan) return;
    await rm(plan.staged, { recursive: true, force: true });
    await rm(plan.folder, { recursive: true, force: true });
  }
  async install() {
    if (!this.prepared) await this.prepareInstall();
    const plan = this.prepared!;
    const { folder, token, target } = plan;
    let dispatched = false;
    try {
      await writeFile(join(this.root, 'mac-pending.json'), JSON.stringify({ folder, token, version: plan.version, target }), { mode: 0o600 });
      const child = spawn(join(folder, 'node'), [join(folder, 'helper.cjs'), '--install', join(folder, 'plan.json')], {
        detached: true, stdio: 'ignore', env: { PATH: '/usr/bin:/bin', HOME: process.env.HOME, TMPDIR: process.env.TMPDIR },
      });
      await new Promise<void>((done, fail) => { child.once('spawn', done); child.once('error', fail); });
      const deadline = Date.now() + 5000;
      while (await readFile(join(folder, 'ready'), 'utf8').catch(() => '') !== token) {
        if (child.exitCode !== null || Date.now() > deadline) { child.kill(); throw new InstallerFailure('install'); }
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      child.unref(); dispatched = true; this.prepared = undefined;
      this.host.quit();
    } finally { if (!dispatched) await this.cancelInstall(); }
  }
}
function scheduleInstallCleanup(root: string, folder: string, token: string) {
  const cleanup = setInterval(() => {
    void (async () => {
      if (await readFile(join(folder, 'finished'), 'utf8') !== token) return;
      clearInterval(cleanup);
      const current = JSON.parse(await readFile(join(root, 'mac-pending.json'), 'utf8').catch(() => 'null'));
      if (current?.token === token) await rm(join(root, 'mac-pending.json'), { force: true });
      await rm(folder, { recursive: true, force: true });
    })().catch(() => {});
  }, 1000);
  cleanup.unref(); setTimeout(() => clearInterval(cleanup), 30000).unref();
}
// Called only after the new application's window loads. The helper keeps the old
// bundle until this main-process acknowledgement; renderer arguments cannot forge it.
export async function acknowledgeMacUpdate(root: string, target: string, version: string): Promise<'installed' | 'rolled-back' | 'recovery-required' | undefined> {
  try {
    const pending = JSON.parse(await readFile(join(root, 'mac-pending.json'), 'utf8'));
    const folder = await realpath(pending.folder);
    if (dirname(folder) !== await realpath(root) || !basename(folder).startsWith('mac-install-') || await realpath(target) !== pending.target
      || !/^[a-f0-9-]{36}$/.test(pending.token)) return;
    const result = JSON.parse(await readFile(join(folder, 'result.json'), 'utf8').catch(() => 'null'));
    if (result?.status === 'rolled-back' || result?.status === 'recovery-required') {
      if (result.status === 'rolled-back') scheduleInstallCleanup(root, folder, pending.token);
      return result.status;
    }
    if (version !== pending.version) return;
    await writeFile(join(folder, 'ack'), pending.token, { mode: 0o600 });
    scheduleInstallCleanup(root, folder, pending.token);
    return 'installed';
  } catch { return; }
}
