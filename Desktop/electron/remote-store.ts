import type { safeStorage as safeStorageType } from 'electron';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { remoteWorkspaceLimit } from '../src/remote';

export interface RemoteIdentity {
  credentials: { appId: string; appSecret: string; brand: 'feishu' | 'lark' };
  botId: string;
}
export interface RemotePeer { actor: string; chat: string }
export interface SavedRemote {
  version: 1;
  identity: RemoteIdentity;
  access?: RemotePeer & { workspaces: string[]; sessionId?: string };
}
export interface RemotePersistence {
  load(): Promise<SavedRemote | undefined>;
  save(value: SavedRemote | undefined): Promise<void>;
}
type Storage = Pick<typeof safeStorageType, 'isEncryptionAvailable' | 'encryptString' | 'decryptString'>;
const record = (value: any) => value && typeof value === 'object' && !Array.isArray(value);
const bounded = (value: unknown, limit = 200): value is string =>
  typeof value === 'string' && value.trim().length > 0 && value.length <= limit;
export function remoteIdentity(value: any): RemoteIdentity {
  if (!record(value) || !record(value.credentials) || !bounded(value.botId)
    || !bounded(value.credentials.appId) || !bounded(value.credentials.appSecret, 4096)
    || !['feishu', 'lark'].includes(value.credentials.brand)) throw new Error('Invalid saved Remote identity');
  return { botId: value.botId, credentials: { appId: value.credentials.appId,
    appSecret: value.credentials.appSecret, brand: value.credentials.brand } };
}
export function remotePeer(value: any): RemotePeer {
  if (!record(value) || !bounded(value.actor) || !bounded(value.chat)) throw new Error('Invalid saved Remote chat');
  return { actor: value.actor, chat: value.chat };
}
export function savedRemote(value: any): SavedRemote {
  if (!record(value) || value.version !== 1) throw new Error('Invalid saved Remote connection');
  const result: SavedRemote = { version: 1, identity: remoteIdentity(value.identity) };
  if (value.access !== undefined) {
    const access = value.access;
    if (!record(access) || !Array.isArray(access.workspaces) || !access.workspaces.length
      || access.workspaces.length > remoteWorkspaceLimit || access.workspaces.some((path: unknown) => !bounded(path, 4096))
      || new Set(access.workspaces).size !== access.workspaces.length
      || access.sessionId !== undefined && !bounded(access.sessionId)) throw new Error('Invalid saved Remote scope');
    result.access = { ...remotePeer(access), workspaces: [...access.workspaces],
      ...(access.sessionId ? { sessionId: access.sessionId } : {}) };
  }
  return result;
}

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
