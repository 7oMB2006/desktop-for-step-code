import type { safeStorage as safeStorageType } from 'electron';
import { randomUUID } from 'node:crypto';
import { readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

type AuthData = Record<string, unknown>;
type SafeStorageLike = Pick<typeof safeStorageType, 'isEncryptionAvailable' | 'encryptString' | 'decryptString'>;

async function optionalFile(path: string): Promise<Buffer | undefined> {
  try { return await readFile(path); }
  catch (error: any) { if (error.code === 'ENOENT') return undefined; throw error; }
}

function parseAuth(value: string): AuthData {
  const data = JSON.parse(value);
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Invalid desktop credentials');
  return data;
}

// A store counts as empty when no key holds a real value: {}, null values,
// blank strings, whitespace-only files and nested empty objects/arrays all
// qualify. This is what a failed child process leaves behind, and it must
// never be mistaken for a second credential set.
function isEmptyAuthValue(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string') return value.trim().length === 0;
  if (Array.isArray(value)) return value.every(isEmptyAuthValue);
  if (typeof value === 'object') return Object.values(value as Record<string, unknown>).every(isEmptyAuthValue);
  return false;
}
function isEmptyAuthData(data: AuthData): boolean {
  return Object.values(data).every(isEmptyAuthValue);
}
async function optionalAuthData(path: string): Promise<{ data: AuthData; empty: boolean } | undefined> {
  const raw = await optionalFile(path);
  if (!raw) return undefined;
  const text = raw.toString('utf8');
  if (text.trim().length === 0) return { data: {}, empty: true };
  let parsed: unknown;
  try { parsed = JSON.parse(text); }
  catch { throw new Error('Invalid desktop credentials'); }
  if (parsed === null) return { data: {}, empty: true };
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Invalid desktop credentials');
  const data = parsed as AuthData;
  return { data, empty: isEmptyAuthData(data) };
}

export class AuthVault {
  private readonly path: string;
  private readonly legacyPath: string;
  private readonly retiredPath: string;
  private readonly storage?: SafeStorageLike;

  // The optional storage parameter keeps the vault unit-testable outside
  // Electron; production always passes Electron safeStorage resolved here.
  constructor(root: string, storage?: SafeStorageLike) {
    this.path = join(root, 'auth.dpapi');
    this.legacyPath = join(root, 'auth.json');
    this.retiredPath = join(root, 'legacy-auth.json');
    this.storage = storage;
  }

  private async backend(): Promise<SafeStorageLike> {
    if (this.storage) return this.storage;
    const electron = await import('electron');
    const safeStorage = (electron as { safeStorage?: SafeStorageLike }).safeStorage;
    if (!safeStorage) throw new Error('Windows credential protection is unavailable');
    return safeStorage;
  }

  async load(): Promise<AuthData> {
    const safeStorage = await this.backend();
    if (!safeStorage.isEncryptionAvailable()) throw new Error('Windows credential protection is unavailable');
    const retired = await optionalFile(this.retiredPath);
    if (retired) {
      if (Object.keys(parseAuth(retired.toString('utf8'))).length !== 0) {
        throw new Error('Legacy desktop credentials require migration before launch');
      }
      await unlink(this.retiredPath);
    }
    const encrypted = await optionalFile(this.path);
    const legacy = await optionalAuthData(this.legacyPath);
    if (encrypted) {
      let data: AuthData;
      try { data = parseAuth(safeStorage.decryptString(encrypted)); }
      catch { throw new Error('Could not unlock saved desktop credentials'); }
      if (legacy) {
        // An empty plaintext store is leftover damage from a failed child
        // process, not a competing credential set: remove it and keep the
        // vault. Real plaintext credentials that disagree with the vault
        // still fail closed.
        if (!legacy.empty && JSON.stringify(legacy.data) !== JSON.stringify(data)) {
          throw new Error('Conflicting desktop credential files; migration requires manual review');
        }
        await unlink(this.legacyPath);
      }
      return data;
    }
    if (!legacy) return {};
    const data = legacy.data;
    await this.save(data);
    await unlink(this.legacyPath);
    return data;
  }

  async save(data: AuthData): Promise<void> {
    const safeStorage = await this.backend();
    if (!safeStorage.isEncryptionAvailable()) throw new Error('Windows credential protection is unavailable');
    const encrypted = safeStorage.encryptString(JSON.stringify(data));
    const temp = `${this.path}.${randomUUID()}.tmp`;
    try {
      await writeFile(temp, encrypted, { flag: 'wx' });
      await rename(temp, this.path);
    } catch (error) {
      await unlink(temp).catch(() => {});
      throw error;
    }
  }
}
