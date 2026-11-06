import { remoteWorkspaceLimit } from '../src/remote';

export interface RemoteIdentity {
  credentials: { appId: string; appSecret: string; brand: 'feishu' | 'lark' };
  botId: string;
}
export interface RemotePeer { actor: string; chat: string }
export interface SavedRemote {
  version: 1;
  identity: RemoteIdentity;
  access?: RemotePeer & { workspaces: string[]; sessionId?: string; sessionRefs?: [string, string][]; imagesAllowed?: boolean };
}
export interface RemotePersistence {
  load(): Promise<SavedRemote | undefined>;
  save(value: SavedRemote | undefined): Promise<void>;
}
export const remoteSessionRefLimit = 10000;
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
      || access.sessionId !== undefined && !bounded(access.sessionId)
      || access.imagesAllowed !== undefined && typeof access.imagesAllowed !== 'boolean') throw new Error('Invalid saved Remote scope');
    const refs = access.sessionRefs;
    if (refs !== undefined && (!Array.isArray(refs) || refs.length > remoteSessionRefLimit
      || refs.some((entry: unknown) => !Array.isArray(entry) || entry.length !== 2 || !bounded(entry[0])
        || typeof entry[1] !== 'string' || !/^s[1-9]\d{0,4}$/.test(entry[1]) || Number(entry[1].slice(1)) > remoteSessionRefLimit)
      || new Set(refs.map((entry: string[]) => entry[0])).size !== refs.length
      || new Set(refs.map((entry: string[]) => entry[1])).size !== refs.length))
      throw new Error('Invalid saved Remote session handles');
    result.access = { ...remotePeer(access), workspaces: [...access.workspaces],
      ...(access.sessionId ? { sessionId: access.sessionId } : {}),
      ...(access.imagesAllowed === true ? { imagesAllowed: true } : {}),
      ...(refs !== undefined ? { sessionRefs: refs.map((entry: string[]) => [entry[0], entry[1]] as [string, string]) } : {}) };
  }
  return result;
}
