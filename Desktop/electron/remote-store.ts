import type { safeStorage as safeStorageType } from 'electron';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { savedRemote, type RemotePersistence, type SavedRemote } from './remote-schema';
export { remoteIdentity, remotePeer, savedRemote, type RemoteIdentity, type RemotePeer, type RemotePersistence, type SavedRemote } from './remote-schema';
type Storage = Pick<typeof safeStorageType, 'isEncryptionAvailable' | 'encryptString' | 'decryptString'>;

// Separate from model credentials: this file never becomes a runtime auth environment.
export class RemoteStore implements RemotePersistence {
  private path: string;
  private writes: Promise<void> = Promise.resolve();
  constructor(private root: string, private storage?: Storage) { this.path = join(root, 'connection.dpapi'); }
  private async backend() {
    const storage = this.storage ?? (await import('electron')).safeStorage;
    if (!storage?.isEncryptionAvailable()) throw new Error('Remote credential protection is unavailable');
    return storage;
  }
  async load() {
    await this.writes;
    let encrypted: Buffer;
    try { encrypted = await readFile(this.path); }
    catch (error: any) { if (error.code === 'ENOENT') return; throw new Error('Could not read saved Remote connection'); }
    try { return savedRemote(JSON.parse((await this.backend()).decryptString(encrypted))); }
    catch { throw new Error('Could not unlock saved Remote connection'); }
  }
  save(value: SavedRemote | undefined) {
    const next = value ? savedRemote(value) : undefined;
    const write = this.writes.then(async () => {
      if (!next) {
        try { await unlink(this.path); }
        catch (error: any) { if (error.code !== 'ENOENT') throw new Error('Could not remove saved Remote connection'); }
        return;
      }
      const encrypted = (await this.backend()).encryptString(JSON.stringify(next));
      await mkdir(this.root, { recursive: true });
      const temp = `${this.path}.${randomUUID()}.tmp`;
      try {
        await writeFile(temp, encrypted, { flag: 'wx', mode: 0o600 });
        await rename(temp, this.path);
      } catch {
        await unlink(temp).catch(() => {});
        throw new Error('Could not save Remote connection');
      }
    });
    this.writes = write.catch(() => {});
    return write;
  }
}
