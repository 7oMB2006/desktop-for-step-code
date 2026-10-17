import { gt } from 'semver';
import type { AppRelease, UpdateTransfer } from '../src/contracts';

export interface UpdateDriver {
  download(release: AppRelease, signal: AbortSignal, progress: (value: Partial<UpdateTransfer>) => void): Promise<void>;
  verify(): Promise<void>;
  prepareInstall?(): Promise<void>;
  cancelInstall?(): Promise<void>;
  install(): void | Promise<void>;
}
export class InstallerFailure extends Error {
  constructor(readonly kind: NonNullable<UpdateTransfer['error']>) { super(kind); }
}
export function validateInstallerMetadata(info: any, release: AppRelease) {
  const file = info?.files?.[0];
  if (!release.installer || info?.version !== release.version || !Array.isArray(info.files) || info.files.length !== 1 || info.packages
    || file?.url !== release.installer.name || file.size !== release.installer.size
    || typeof file.sha512 !== 'string' || !/^[A-Za-z0-9+/]{86}==$/.test(file.sha512)
    || Buffer.from(file.sha512, 'base64').length !== 64) throw new InstallerFailure('metadata');
}
export function isUpdateRequestAllowed(address: string, installer: string) {
  try {
    const url = new URL(address);
    if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash) return false;
    if (url.hostname === 'github.com') return url.href === installer
      || url.pathname === new URL(installer).pathname.replace(/[^/]+$/, 'latest.yml');
    return ['release-assets.githubusercontent.com', 'objects.githubusercontent.com'].includes(url.hostname);
  } catch { return false; }
}
export function isUpdateResponseAllowed(status: number, length: unknown, size: number, metadata: boolean) {
  if (status !== 200) return true; // Redirect destinations are checked independently.
  const bytes = Number(length);
  return Number.isSafeInteger(bytes) && bytes > 0 && (metadata ? bytes <= 128 * 1024 : bytes === size);
}

// The controller owns one immutable release per download; checks cannot retarget it.
export class UpdateInstaller {
  private state: UpdateTransfer;
  private driver?: UpdateDriver;
  private abort?: AbortController;
  private pending?: Promise<void>;
  private release?: AppRelease;
  private revision = 0;
  constructor(private currentVersion: string, supported: boolean, private factory: () => UpdateDriver,
    private changed: () => void) { this.state = { supported, status: 'idle' }; }
  snapshot(): UpdateTransfer { return structuredClone(this.state); }
  private publish(patch: Partial<UpdateTransfer>) { this.state = { ...this.state, ...patch }; this.changed(); }
  download(release: AppRelease): Promise<void> {
    if (this.pending) {
      if (this.state.status !== 'cancelled') return this.pending;
      const revision = this.revision;
      return this.pending.then(() => {
        if (revision === this.revision) return this.download(release);
      });
    }
    if (!this.state.supported || !release.installer?.inApp || !gt(release.version, this.currentVersion))
      return Promise.reject(new Error('In-app update unavailable'));
    if (this.state.status === 'installing') return Promise.reject(new Error('Installation in progress'));
    if (this.state.status === 'ready' && this.state.version === release.version) return Promise.resolve();
    const revision = ++this.revision;
    const abort = this.abort = new AbortController();
    this.driver = this.factory();
    this.release = structuredClone(release);
    const driver = this.driver;
    this.state = { supported: true, status: 'preparing', version: release.version };
    this.changed();
    this.pending = Promise.resolve().then(async () => {
      try {
        await driver.download(structuredClone(release), abort.signal, progress => {
          if (revision === this.revision && !abort.signal.aborted) this.publish({ ...progress, status: 'downloading' });
        });
        if (revision === this.revision && !abort.signal.aborted) this.publish({ status: 'ready', percent: 100 });
      } catch (error) {
        if (revision === this.revision) this.publish({ status: abort.signal.aborted ? 'cancelled' : 'error',
          error: abort.signal.aborted ? undefined : error instanceof InstallerFailure ? error.kind : 'download' });
      } finally {
        this.pending = undefined;
        this.abort = undefined;
      }
    });
    return this.pending;
  }
  cancel() {
    if (this.state.status === 'installing') throw new Error('Installation in progress');
    this.revision++; this.abort?.abort(); this.driver = undefined;
    this.state = { supported: this.state.supported, status: 'cancelled' }; this.changed();
  }
  reconcile(release?: AppRelease) {
    if (this.state.status === 'installing') return;
    const version = this.state.version ?? (this.pending ? this.release?.version : undefined);
    if (version && (release?.version !== version || !release.installer?.inApp
      || release.installer.url !== this.release?.installer?.url || release.installer.size !== this.release?.installer?.size)) this.cancel();
  }
  async install(prepare: () => Promise<void>) {
    if (this.state.status !== 'ready' || !this.driver) throw new Error('No downloaded update');
    const driver = this.driver;
    this.publish({ status: 'installing', error: undefined });
    try {
      await driver.verify();
      await driver.prepareInstall?.();
      await prepare();
      await driver.install();
    } catch (error) {
      await driver.cancelInstall?.().catch(() => {});
      this.publish({ status: error instanceof InstallerFailure && error.kind === 'busy' ? 'ready' : 'error',
        error: error instanceof InstallerFailure ? error.kind : 'install' });
      throw error;
    }
  }
  dispose() { this.revision++; this.abort?.abort(); }
}
