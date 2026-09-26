import { safeStorage } from 'electron';
import { randomUUID } from 'node:crypto';
import { readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

type AuthData = Record<string, unknown>;

async function optionalFile(path: string): Promise<Buffer | undefined> {
  try { return await readFile(path); }
  catch (error: any) { if (error.code === 'ENOENT') return undefined; throw error; }
}

function parseAuth(value: string): AuthData {
  const data = JSON.parse(value);
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Invalid desktop credentials');
  return data;
}

export class AuthVault {
  private readonly path: string;
  private readonly legacyPath: string;
  private readonly retiredPath: string;

  constructor(root: string) {
    this.path = join(root, 'auth.dpapi');
    this.legacyPath = join(root, 'auth.json');
    this.retiredPath = join(root, 'legacy-auth.json');
  }

  async load(): Promise<AuthData> {
    if (!safeStorage.isEncryptionAvailable()) throw new Error('Windows credential protection is unavailable');
    const retired = await optionalFile(this.retiredPath);
    if (retired) {
      if (Object.keys(parseAuth(retired.toString('utf8'))).length !== 0) {
        throw new Error('Legacy desktop credentials require migration before launch');
      }
      await unlink(this.retiredPath);
    }
    const encrypted = await optionalFile(this.path);
    const legacy = await optionalFile(this.legacyPath);
    if (encrypted) {
      let data: AuthData;
      try { data = parseAuth(safeStorage.decryptString(encrypted)); }
      catch { throw new Error('Could not unlock saved desktop credentials'); }
      if (legacy) {
        if (JSON.stringify(parseAuth(legacy.toString('utf8'))) !== JSON.stringify(data)) {
          throw new Error('Conflicting desktop credential files; migration requires manual review');
        }
        await unlink(this.legacyPath);
      }
      return data;
    }
    if (!legacy) return {};
    const data = parseAuth(legacy.toString('utf8'));
    await this.save(data);
    await unlink(this.legacyPath);
    return data;
  }

  async save(data: AuthData): Promise<void> {
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
