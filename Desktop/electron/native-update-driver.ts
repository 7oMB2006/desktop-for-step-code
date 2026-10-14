import { app } from 'electron';
import { NsisUpdater } from 'electron-updater';
import { join } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import type { AppRelease, UpdateTransfer } from '../src/contracts';
import { InstallerFailure, validateInstallerMetadata, isUpdateRequestAllowed, isUpdateResponseAllowed, type UpdateDriver } from './update-installer';
import { verifyInstallerFile, prepareUpdateCache } from './update-cache';

class OwnedCacheNsisUpdater extends NsisUpdater {
  constructor(cachePath: string) {
    // Keep the library's real Electron transport; isolate only its cache location.
    super();
    Object.defineProperty(this.app, 'baseCachePath', { value: cachePath });
  }
}
export class NativeUpdateDriver implements UpdateDriver {
  private updater: NsisUpdater;
  private file?: string;
  private expected?: { version: string; size: number; sha512: string };
  constructor(private root: string) {
    this.updater = new OwnedCacheNsisUpdater(join(root, 'download-cache'));
    this.updater.autoDownload = false;
    this.updater.autoInstallOnAppQuit = false;
    this.updater.allowPrerelease = true;
    this.updater.allowDowngrade = false;
    this.updater.disableDifferentialDownload = true;
    this.updater.disableWebInstaller = true;
    this.updater.installDirectory = join(app.getPath('exe'), '..');
    this.updater.logger = null;
    // The library reports errors both through events and rejected promises.
    this.updater.on('error', () => {});
  }
  async download(release: AppRelease, signal: AbortSignal, progress: (value: Partial<UpdateTransfer>) => void) {
    await prepareUpdateCache(this.root);
    if (signal.aborted) return;
    const installer = release.installer!;
    let metadata = true;
    const network = this.updater.netSession;
    network.webRequest.onBeforeRequest((details, callback) => {
      callback({ cancel: !isUpdateRequestAllowed(details.url, installer.url) });
    });
    network.webRequest.onBeforeSendHeaders((details, callback) => {
      for (const name of Object.keys(details.requestHeaders)) {
        if (/^(cookie|authorization)$/i.test(name)) delete details.requestHeaders[name];
      }
      callback({ requestHeaders: details.requestHeaders });
    });
    network.webRequest.onHeadersReceived((details, callback) => {
      const header = Object.entries(details.responseHeaders ?? {}).find(([name]) => name.toLowerCase() === 'content-length')?.[1]?.[0];
      callback({ cancel: !isUpdateResponseAllowed(details.statusCode, header, installer.size, metadata) });
    });
    try {
      this.updater.setFeedURL({ provider: 'generic', channel: 'latest',
        url: `${installer.url.slice(0, installer.url.lastIndexOf('/'))}/`, useMultipleRangeRequest: false });
      let stopNetwork!: () => void;
      const stopped = new Promise<never>((_resolve, reject) => {
        stopNetwork = () => { void network.closeAllConnections(); reject(new InstallerFailure('download')); };
      });
      signal.addEventListener('abort', stopNetwork, { once: true });
      const timer = setTimeout(stopNetwork, 20_000);
      let result;
      try { result = await Promise.race([this.updater.checkForUpdates(), stopped]); }
      finally { clearTimeout(timer); signal.removeEventListener('abort', stopNetwork); }
      if (signal.aborted) return;
      if (!result?.isUpdateAvailable || !result.cancellationToken) throw new InstallerFailure('metadata');
      validateInstallerMetadata(result.updateInfo, release);
      this.expected = { version: release.version, size: installer.size, sha512: result.updateInfo.files[0].sha512 };
      metadata = false;
      const token = result.cancellationToken;
      const cancel = () => token.cancel();
      signal.addEventListener('abort', cancel, { once: true });
      const onProgress = (value: { percent: number; transferred: number; total: number; bytesPerSecond: number }) => {
        progress({ percent: Math.max(0, Math.min(100, value.percent)), transferred: value.transferred,
          total: value.total, bytesPerSecond: value.bytesPerSecond });
      };
      this.updater.on('download-progress', onProgress);
      try {
        const files = await this.updater.downloadUpdate(token);
        if (signal.aborted) return;
        this.file = files[0];
        await this.verify();
      } catch (error: any) {
        if (error?.code === 'ERR_CHECKSUM_MISMATCH' || error?.code === 'ERR_UPDATER_INVALID_SIGNATURE') throw new InstallerFailure('integrity');
        throw error;
      } finally {
        signal.removeEventListener('abort', cancel);
        this.updater.removeListener('download-progress', onProgress);
      }
    } finally {
      network.webRequest.onBeforeRequest(null);
      network.webRequest.onBeforeSendHeaders(null);
      network.webRequest.onHeadersReceived(null);
    }
  }
  async verify() {
    if (!this.file || !this.expected) throw new InstallerFailure('integrity');
    await verifyInstallerFile(this.file, join(this.root, 'download-cache'), this.expected.size, this.expected.sha512);
  }
  async markInstall() {
    if (!this.expected) throw new InstallerFailure('integrity');
    await mkdir(this.root, { recursive: true });
    await writeFile(join(this.root, 'installed.json'), JSON.stringify({ version: this.expected.version }), 'utf8');
  }
  async install() {
    await this.markInstall();
    let failed = false;
    const failure = () => { failed = true; };
    this.updater.once('error', failure);
    this.updater.quitAndInstall(true, true);
    this.updater.removeListener('error', failure);
    if (failed) throw new InstallerFailure('install');
  }
}
