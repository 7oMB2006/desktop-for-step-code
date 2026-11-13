import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { lstat, mkdir, open, realpath, rename, unlink } from 'node:fs/promises';
import { createServer, type Server, type Socket } from 'node:net';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { externalConnectorMethods, type ExternalGrant } from './external-connector-tasks';

export const externalConnectorProtocol = 'dfsc-external-v1';
const methods = new Set<string>(externalConnectorMethods);
const requestLimit = 64 * 1024;
const replyLimit = 128 * 1024;
const stateLimit = 1024 * 1024;
const key = (path: string) => process.platform === 'win32' ? resolve(path).toLowerCase() : resolve(path);
const object = (value: unknown): value is Record<string, any> => value !== null && typeof value === 'object' && !Array.isArray(value);
const failure = (code: string) => new Error(`connector:${code}`);
const knownErrors = new Set([
  'invalid-input', 'invalid-scope', 'scope-changed', 'storage', 'unavailable', 'disabled', 'limit', 'unauthorized',
  'response-too-large', 'busy', 'revoked', 'scope', 'task-unavailable', 'session-unavailable', 'unsupported-method',
  'key-conflict', 'task-limit', 'creation-unconfirmed', 'control-command', 'task-not-ready', 'ask-required', 'submission-unconfirmed',
  'local-approval', 'approval-expired',
].map(code => `connector:${code}`));
const errorCode = (error: unknown) => error instanceof Error && knownErrors.has(error.message)
  ? error.message : 'connector:unavailable';
const hash = (token: string) => createHash('sha256').update(token).digest();
const localPath = (value: unknown): value is string => typeof value === 'string' && value.length <= 4096
  && isAbsolute(value) && !/^[/\\]{2}/u.test(value) && !/[\u0000-\u001f\u007f]/u.test(value);
const sameFile = (a: { dev: bigint; ino: bigint; size: bigint; mtimeNs: bigint },
  b: { dev: bigint; ino: bigint; size: bigint; mtimeNs: bigint }) =>
  a.dev === b.dev && a.ino === b.ino && a.size === b.size && a.mtimeNs === b.mtimeNs;

type DirectoryIdentity = { path: string; dev: string; ino: string };
async function directoryIdentity(path: string): Promise<DirectoryIdentity> {
  if (!localPath(path)) throw failure('invalid-scope');
  const canonical = await realpath(path);
  const info = await lstat(path, { bigint: true });
  if (!info.isDirectory() || info.isSymbolicLink() || key(canonical) !== key(path)) throw failure('invalid-scope');
  return { path: canonical, dev: String(info.dev), ino: String(info.ino) };
}
async function assertDirectory(identity: DirectoryIdentity) {
  const now = await directoryIdentity(identity.path).catch(() => { throw failure('invalid-scope'); });
  if (now.dev !== identity.dev || now.ino !== identity.ino) throw failure('scope-changed');
}
function privatePath(value: string) {
  if (!value || value.length > 240 || isAbsolute(value) || /[:\\\0]/u.test(value)
    || value.split('/').some(part => !/^[a-z0-9][a-z0-9_.-]*$/u.test(part) || part === '.' || part === '..'
      || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/u.test(part))) throw failure('storage');
  return value;
}

// Store only under the caller's Desktop-owned directory. Tokens never cross IPC.
export class ConnectorJsonStore {
  private writes: Promise<unknown> = Promise.resolve();
  constructor(private root: string, private filename: string) { privatePath(filename); }
  private async directories(create: boolean) {
    const root = resolve(this.root), target = join(root, privatePath(this.filename));
    if (create) await mkdir(root, { recursive: true, mode: 0o700 });
    const identities = [await directoryIdentity(root)];
    const parts = relative(root, dirname(target)).split(sep).filter(Boolean);
    let current = root;
    for (const part of parts) {
      current = join(current, part);
      if (create) {
        try { await mkdir(current, { mode: 0o700 }); }
        catch (error: any) { if (error.code !== 'EEXIST') throw error; }
      }
      identities.push(await directoryIdentity(current));
    }
    return { target, identities };
  }
  async load(): Promise<unknown> {
    await this.writes;
    try {
      const { target, identities } = await this.directories(false);
      const before = await lstat(target, { bigint: true });
      if (!before.isFile() || before.isSymbolicLink() || before.size > stateLimit
        || key(await realpath(target)) !== key(target)) throw failure('storage');
      const handle = await open(target, 'r');
      try {
        if (!sameFile(before, await handle.stat({ bigint: true }))) throw failure('storage');
        const bytes = Buffer.alloc(Number(before.size) + 1);
        const read = await handle.read(bytes, 0, bytes.length, 0);
        if (read.bytesRead !== Number(before.size) || !sameFile(before, await handle.stat({ bigint: true }))
          || !sameFile(before, await lstat(target, { bigint: true }))) throw failure('storage');
        for (const identity of identities) await assertDirectory(identity);
        return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, read.bytesRead)));
      } finally { await handle.close(); }
    } catch (error: any) {
      if (error.code === 'ENOENT') return undefined;
      throw failure('storage');
    }
  }
  save(value: unknown): Promise<void> {
    let bytes: Buffer;
    try { bytes = Buffer.from(JSON.stringify(value) + '\n'); }
    catch { return Promise.reject(failure('storage')); }
    if (bytes.length > stateLimit) return Promise.reject(failure('storage'));
    const operation = this.writes.then(async () => {
      const { target, identities } = await this.directories(true);
      const temporary = join(dirname(target), `${randomUUID()}.tmp`);
      const handle = await open(temporary, 'wx', 0o600);
      const identity = await handle.stat({ bigint: true });
      let committed = false;
      const assertOwned = async (path: string) => {
        for (const directory of identities) await assertDirectory(directory);
        const actual = await handle.stat({ bigint: true });
        if (!actual.isFile() || actual.dev !== identity.dev || actual.ino !== identity.ino
          || !sameFile(actual, await lstat(path, { bigint: true })) || key(await realpath(path)) !== key(path))
          throw failure('storage');
      };
      try {
        await assertOwned(temporary);
        await handle.writeFile(bytes);
        await handle.sync();
        await assertOwned(temporary);
        try {
          const existing = await lstat(target);
          if (existing.isSymbolicLink() || !existing.isFile() || key(await realpath(target)) !== key(target)) throw failure('storage');
        } catch (error: any) { if (error.code !== 'ENOENT') throw error; }
        await assertOwned(temporary);
        await rename(temporary, target);
        await assertOwned(target);
        committed = true;
      } finally {
        try {
          if (!committed) { await handle.truncate(0); await handle.sync(); }
        } finally {
          await handle.close();
          await unlink(temporary).catch((error: any) => { if (error.code !== 'ENOENT') throw error; });
        }
      }
    }).catch(() => { throw failure('storage'); });
    this.writes = operation.catch(() => {});
    return operation;
  }
}

type SavedGrant = { agentId: string; displayName: string; roots: DirectoryIdentity[]; tokenHash: string };
type SavedState = { version: 1; enabled: boolean; grants: SavedGrant[] };
export interface ConnectorGatewayState {
  enabled: boolean;
  listening: boolean;
  error?: string;
  connections: { agentId: string; displayName: string; roots: string[]; configPath: string }[];
}
interface GatewayOptions {
  dispatch(grant: ExternalGrant, method: string, params: unknown, valid: () => boolean): Promise<unknown>;
  invalidated(agentId?: string, shutdown?: boolean): void | Promise<void>;
  frameTimeoutMs?: number;
  requestTimeoutMs?: number;
}
function savedState(value: unknown): SavedState {
  if (!object(value) || value.version !== 1 || typeof value.enabled !== 'boolean'
    || !Array.isArray(value.grants) || value.grants.length > 8) throw failure('storage');
  const ids = new Set<string>();
  for (const grant of value.grants) {
    if (!object(grant) || typeof grant.agentId !== 'string' || !/^agent-[a-f0-9-]{36}$/u.test(grant.agentId)
      || ids.has(grant.agentId) || typeof grant.displayName !== 'string' || !grant.displayName.trim()
      || grant.displayName.length > 100 || /[\u0000-\u001f\u007f]/u.test(grant.displayName)
      || typeof grant.tokenHash !== 'string' || !/^[a-f0-9]{64}$/u.test(grant.tokenHash)
      || !Array.isArray(grant.roots) || !grant.roots.length || grant.roots.length > 32) throw failure('storage');
    ids.add(grant.agentId);
    const paths = new Set<string>();
    for (const root of grant.roots) {
      if (!object(root) || !localPath(root.path) || key(root.path) !== key(resolve(root.path))
        || typeof root.dev !== 'string' || !/^\d+$/u.test(root.dev)
        || typeof root.ino !== 'string' || !/^\d+$/u.test(root.ino) || paths.has(key(root.path))) throw failure('storage');
      paths.add(key(root.path));
    }
  }
  return value as SavedState;
}

export class ExternalConnectorGateway {
  private store: ConnectorJsonStore;
  private state: SavedState = { version: 1, enabled: false, grants: [] };
  private tokens = new Map<string, string>();
  private revoked = new Set<string>();
  private scopeInvalidated = new WeakSet<SavedGrant>();
  private server?: Server;
  private sockets = new Set<Socket>();
  private socketAgents = new WeakMap<Socket, string>();
  private inFlight = new Set<Promise<void>>();
  private generation = 0;
  private enabled = false;
  private desired = false;
  private listening = false;
  private initialized = false;
  private broken = false;
  private error?: string;
  private operations: Promise<unknown> = Promise.resolve();
  constructor(private root: string, private options: GatewayOptions) {
    this.root = resolve(root);
    this.store = new ConnectorJsonStore(this.root, 'state.json');
  }
  private serial<T>(operation: () => Promise<T>): Promise<T> {
    const pending = this.operations.then(operation);
    this.operations = pending.catch(() => {});
    return pending;
  }
  async initialize() {
    return this.serial(async () => {
      if (this.initialized) return;
      try {
        const stored = await this.store.load();
        if (stored !== undefined) this.state = savedState(stored);
        for (const grant of this.state.grants) {
          const descriptor = await new ConnectorJsonStore(this.root, `agents/${grant.agentId}/model.json`).load();
          if (!object(descriptor) || descriptor.version !== 1 || descriptor.protocol !== externalConnectorProtocol
            || descriptor.role !== 'model' || descriptor.agentId !== grant.agentId
            || typeof descriptor.token !== 'string' || !/^[A-Za-z0-9_-]{43}$/u.test(descriptor.token)
            || hash(descriptor.token).toString('hex') !== grant.tokenHash) throw failure('storage');
          this.tokens.set(grant.agentId, descriptor.token);
        }
        this.initialized = true;
        this.desired = this.state.enabled;
        if (this.desired) await this.start(++this.generation);
      } catch {
        this.initialized = true;
        this.broken = true;
        this.enabled = false; this.desired = false; this.listening = false; this.generation++;
        this.error = 'connector:storage';
        await this.stopListener();
        throw failure('storage');
      }
    });
  }
  snapshot(): ConnectorGatewayState {
    return {
      enabled: this.enabled, listening: this.listening,
      ...(this.error ? { error: this.error } : {}),
      connections: this.state.grants.filter(grant => !this.revoked.has(grant.agentId)).map(grant => ({
        agentId: grant.agentId, displayName: grant.displayName, roots: grant.roots.map(root => root.path),
        configPath: join(this.root, 'agents', grant.agentId, 'config.json'),
      })),
    };
  }
  private requireReady() {
    if (!this.initialized || this.broken || this.error) throw failure('unavailable');
  }
  private invalidation(agentId?: string, shutdown = false) {
    return Promise.resolve().then(() => this.options.invalidated(agentId, shutdown)).then(() => true, () => false);
  }
  enable() {
    this.requireReady();
    if (this.enabled && this.listening && this.desired) return Promise.resolve(this.snapshot());
    this.desired = true;
    const generation = ++this.generation;
    return this.serial(async () => {
      try {
        await this.start(generation);
        return this.snapshot();
      } catch (error) {
        this.enabled = false; this.listening = false; this.desired = false; this.generation++;
        this.error = errorCode(error);
        await this.stopListener();
        throw failure('unavailable');
      }
    });
  }
  disable() {
    this.desired = false; this.enabled = false; this.listening = false; this.generation++;
    for (const socket of this.sockets) socket.destroy();
    const invalidated = this.invalidation();
    return this.serial(async () => {
      try {
        const invalidationFailed = !await invalidated;
        await this.stopListener();
        this.state = { ...this.state, enabled: false };
        await this.store.save(this.state);
        if (invalidationFailed) throw failure('unavailable');
        if (!this.broken) this.error = undefined;
        return this.snapshot();
      } catch {
        this.error = 'connector:storage';
        throw failure('storage');
      }
    });
  }
  shutdown() {
    this.desired = false; this.enabled = false; this.listening = false; this.generation++;
    for (const socket of this.sockets) socket.destroy();
    const invalidated = this.invalidation(undefined, true);
    return this.serial(async () => {
      if (!await invalidated) this.error = 'connector:unavailable';
      await this.stopListener();
    });
  }
  pair(displayName: string, roots: string[]) {
    this.requireReady();
    const generation = this.generation;
    return this.serial(async () => {
      if (!this.enabled || !this.listening || generation !== this.generation) throw failure('disabled');
      if (typeof displayName !== 'string' || !displayName.trim() || displayName.length > 100
        || /[\u0000-\u001f\u007f]/u.test(displayName)
        || !Array.isArray(roots) || !roots.length || roots.length > 32 || roots.some(root => !localPath(root))
        || new Set(roots.map(key)).size !== roots.length) throw failure('invalid-input');
      if (this.state.grants.length >= 8) throw failure('limit');
      const identities = await Promise.all(roots.map(path =>
        directoryIdentity(path).catch(() => { throw failure('invalid-scope'); })));
      if (!this.enabled || generation !== this.generation) throw failure('disabled');
      const agentId = `agent-${randomUUID()}`, token = randomBytes(32).toString('base64url');
      const grant: SavedGrant = { agentId, displayName: displayName.trim(), roots: identities, tokenHash: hash(token).toString('hex') };
      await this.writeDescriptor(grant, token);
      if (!this.enabled || generation !== this.generation) throw failure('disabled');
      for (const identity of identities) await assertDirectory(identity);
      if (!this.enabled || generation !== this.generation) throw failure('disabled');
      const next: SavedState = { ...this.state, grants: [...this.state.grants, grant] };
      await this.store.save(next);
      this.state = next; this.tokens.set(agentId, token);
      if (!this.enabled || generation !== this.generation) throw failure('disabled');
      return this.snapshot();
    });
  }
  revoke(agentId: string) {
    this.requireReady();
    if (typeof agentId !== 'string' || !/^agent-[a-f0-9-]{36}$/u.test(agentId)) return Promise.reject(failure('invalid-input'));
    this.revoked.add(agentId);
    for (const socket of this.sockets) if (this.socketAgents.get(socket) === agentId) socket.destroy();
    const invalidated = this.invalidation(agentId);
    return this.serial(async () => {
      try {
        const invalidationFailed = !await invalidated;
        const next: SavedState = { ...this.state, grants: this.state.grants.filter(grant => grant.agentId !== agentId) };
        this.state = next;
        await this.store.save(next);
        this.tokens.delete(agentId);
        if (invalidationFailed) throw failure('unavailable');
        return this.snapshot();
      } catch {
        this.desired = false; this.enabled = false; this.listening = false; this.generation++;
        this.error = 'connector:storage';
        await this.stopListener();
        throw failure('storage');
      }
    });
  }
  async validate(cwd: string, roots: string[]) {
    if (!localPath(cwd) || !Array.isArray(roots) || !roots.length || roots.some(root => !localPath(root))) throw failure('invalid-scope');
    const candidates = this.state.grants.filter(grant => !this.revoked.has(grant.agentId)
      && grant.roots.length === roots.length && grant.roots.every(root => roots.some(path => key(path) === key(root.path)))
      && grant.roots.some(root => key(root.path) === key(cwd)));
    if (!candidates.length) throw failure('invalid-scope');
    let error: unknown = failure('invalid-scope');
    for (const grant of candidates) {
      try { await this.validateGrant(grant, this.generation); return; }
      catch (failure) { error = failure; }
    }
    throw error;
  }
  async authorization(agentId: string): Promise<ExternalGrant> {
    const grant = this.state.grants.find(value => value.agentId === agentId);
    const generation = this.generation;
    if (!grant) throw failure('unauthorized');
    await this.validateGrant(grant, generation);
    return this.projectGrant(grant, generation);
  }
  private projectGrant(grant: SavedGrant, generation: number): ExternalGrant {
    return { agentId: grant.agentId, roots: grant.roots.map(root => root.path),
      binding: createHash('sha256').update(JSON.stringify({ agentId: grant.agentId,
        tokenHash: grant.tokenHash, roots: grant.roots })).digest('hex'),
      validate: () => this.validateGrant(grant, generation) };
  }
  private valid(grant: SavedGrant, generation: number) {
    return this.enabled && this.desired && this.listening && generation === this.generation
      && !this.revoked.has(grant.agentId) && this.state.grants.includes(grant);
  }
  private async validateGrant(grant: SavedGrant, generation: number) {
    if (!this.valid(grant, generation)) throw failure('unauthorized');
    try {
      for (const identity of grant.roots) await assertDirectory(identity);
      this.scopeInvalidated.delete(grant);
    } catch (error) {
      if (!this.scopeInvalidated.has(grant)) {
        this.scopeInvalidated.add(grant);
        await this.invalidation(grant.agentId);
      }
      throw error;
    }
    if (!this.valid(grant, generation)) throw failure('unauthorized');
  }
  private async writeDescriptor(grant: SavedGrant, token: string) {
    const address = this.server?.address();
    if (!address || typeof address === 'string') throw failure('unavailable');
    await new ConnectorJsonStore(this.root, `agents/${grant.agentId}/model.json`).save({
      version: 1, protocol: externalConnectorProtocol, role: 'model', agentId: grant.agentId,
      transport: 'tcp', host: '127.0.0.1', port: address.port, token,
    });
    await new ConnectorJsonStore(this.root, `agents/${grant.agentId}/config.json`).save({
      schemaVersion: 1, protocol: externalConnectorProtocol, agentId: grant.agentId, displayName: grant.displayName,
      bridgeRoot: this.root, workspaceRoots: grant.roots.map(root => root.path),
    });
  }
  private async start(generation: number) {
    if (!this.desired || generation !== this.generation) return;
    await this.stopListener();
    const server = createServer(socket => this.receive(socket));
    this.server = server;
    await new Promise<void>((accept, reject) => {
      const failed = () => reject(failure('unavailable'));
      server.once('error', failed);
      server.listen(0, '127.0.0.1', () => { server.off('error', failed); accept(); });
    });
    server.on('error', () => {
      this.enabled = false; this.listening = false; this.desired = false; this.generation++;
      this.error = 'connector:unavailable';
      for (const socket of this.sockets) socket.destroy();
      void this.invalidation();
    });
    for (const grant of this.state.grants) {
      if (!this.desired || generation !== this.generation) { await this.stopListener(); return; }
      await this.writeDescriptor(grant, this.tokens.get(grant.agentId)!);
    }
    if (!this.desired || generation !== this.generation) { await this.stopListener(); return; }
    const next: SavedState = { ...this.state, enabled: true };
    await this.store.save(next);
    this.state = next;
    if (!this.desired || generation !== this.generation) { await this.stopListener(); return; }
    this.enabled = true; this.listening = true; this.error = undefined;
  }
  private async stopListener() {
    this.listening = false;
    for (const socket of this.sockets) socket.destroy();
    const server = this.server;
    this.server = undefined;
    if (server) await new Promise<void>(accept => server.close(() => accept()));
  }
  private receive(socket: Socket) {
    if (!this.enabled || !this.listening || this.sockets.size >= 16 || this.inFlight.size >= 16) { socket.destroy(); return; }
    this.sockets.add(socket);
    socket.on('error', () => {});
    let bytes = Buffer.alloc(0), received = false;
    const frameTimer = setTimeout(() => socket.destroy(), this.options.frameTimeoutMs ?? 5000);
    socket.once('close', () => { clearTimeout(frameTimer); this.sockets.delete(socket); });
    socket.on('data', chunk => {
      if (received) { socket.destroy(); return; }
      if (bytes.length + chunk.length > requestLimit) { socket.destroy(); return; }
      bytes = Buffer.concat([bytes, chunk]);
      const newline = bytes.indexOf(10);
      if (newline < 0) return;
      received = true; clearTimeout(frameTimer);
      if (newline !== bytes.length - 1) { socket.destroy(); return; }
      if (this.inFlight.size >= 16) { this.respond(socket, { ok: false, error: 'connector:busy' }); return; }
      const deadline = setTimeout(() => socket.destroy(), this.options.requestTimeoutMs ?? 30000);
      socket.once('close', () => clearTimeout(deadline));
      const pending = this.request(bytes.subarray(0, newline), socket).then(result => this.respond(socket, { ok: true, result }))
        .catch(error => this.respond(socket, { ok: false, error: errorCode(error) }))
        .finally(() => { clearTimeout(deadline); this.inFlight.delete(pending); });
      this.inFlight.add(pending);
    });
  }
  private async request(bytes: Buffer, socket: Socket) {
    let request: unknown;
    try { request = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
    catch { throw failure('invalid-input'); }
    if (!object(request) || request.version !== 1 || request.protocol !== externalConnectorProtocol
      || typeof request.token !== 'string' || !/^[A-Za-z0-9_-]{43}$/u.test(request.token)
      || Object.keys(request).some(name => !['version', 'protocol', 'token', 'method', 'params'].includes(name)))
      throw failure('unauthorized');
    const digest = hash(request.token);
    const grant = this.state.grants.find(grant => !this.revoked.has(grant.agentId)
      && timingSafeEqual(digest, Buffer.from(grant.tokenHash, 'hex')));
    const generation = this.generation;
    if (!grant || !this.valid(grant, generation)) throw failure('unauthorized');
    this.socketAgents.set(socket, grant.agentId);
    if (typeof request.method !== 'string' || !methods.has(request.method) || !object(request.params)) throw failure('invalid-input');
    await this.validateGrant(grant, generation);
    const result = await this.options.dispatch(this.projectGrant(grant, generation),
      request.method, request.params, () => this.valid(grant, generation) && !socket.destroyed);
    await this.validateGrant(grant, generation);
    return result;
  }
  private respond(socket: Socket, reply: unknown) {
    if (socket.destroyed) return;
    let data: string;
    try { data = JSON.stringify(reply); }
    catch { data = JSON.stringify({ ok: false, error: 'connector:unavailable' }); }
    for (const token of this.tokens.values()) data = data.replaceAll(token, '[redacted]');
    if (Buffer.byteLength(data) > replyLimit) data = JSON.stringify({ ok: false, error: 'connector:response-too-large' });
    socket.end(data + '\n');
  }
}
