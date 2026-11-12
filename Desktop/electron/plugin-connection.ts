import { createConnection } from 'node:net';
import { lstat, realpath, stat } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { PluginConnection } from '../src/capabilities';
import { redactSensitiveText } from '../src/subagent-redact';
import { object, optionalFile, writePrivateJson } from './plugin-files.mjs';

const empty = (status: PluginConnection['status'], profile?: string): PluginConnection =>
  ({ status, ...(profile ? { profile } : {}), roots: [], tasks: [] });
const localPath = (value: unknown): value is string => typeof value === 'string' && value.length <= 4096
  && isAbsolute(value) && !/[\u0000-\u001f\u007f]/u.test(value) && !/^[/\\]{2}/u.test(value);
const text = (value: unknown, limit = 160) => typeof value === 'string'
  ? redactSensitiveText(value).replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/gu, '').slice(0, limit) : '';
const within = (root: string, path: string) => {
  const remainder = relative(root, path);
  return !remainder || remainder !== '..' && !remainder.startsWith(`..${sep}`) && !isAbsolute(remainder);
};
async function profileExists(profile: string) {
  if (!localPath(profile) || resolve(await realpath(profile)) !== resolve(profile)) return false;
  const marker = join(profile, 'config.yaml');
  const info = await lstat(marker);
  // The marker may contain API keys. Check its identity without opening its contents.
  return info.isFile() && !info.isSymbolicLink() && resolve(await realpath(marker)) === marker;
}
type Descriptor = { token: string; agentId: string; transport: 'tcp'; host: '127.0.0.1'; port: number; protocol?: 'dfsc-external-v1' }
  | { token: string; agentId: string; transport: 'unix'; socket: string };

// Only two fixed read methods exist here. Neither callers nor package metadata supply RPC methods.
export function readAgentBridge(descriptor: Descriptor, method: 'system.capabilities' | 'task.list', timeout = 8000): Promise<unknown> {
  if (!['system.capabilities', 'task.list'].includes(method)) return Promise.reject(new Error('connection-unavailable'));
  return new Promise((accept, reject) => {
    const socket = createConnection(descriptor.transport === 'tcp'
      ? { host: descriptor.host, port: descriptor.port } : { path: descriptor.socket });
    let bytes = Buffer.alloc(0), settled = false;
    const finish = (error?: Error, value?: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      socket.destroy();
      error ? reject(error) : accept(value);
    };
    const deadline = setTimeout(() => finish(new Error('connection-unavailable')), timeout);
    socket.on('error', () => finish(new Error('connection-unavailable')));
    socket.on('end', () => finish(new Error('connection-unavailable')));
    socket.on('connect', () => socket.write(JSON.stringify({ version: 1, token: descriptor.token,
      ...('protocol' in descriptor && descriptor.protocol ? { protocol: descriptor.protocol } : {}),
      method, params: method === 'task.list' ? { offset: 0 } : {} }) + '\n'));
    socket.on('data', chunk => {
      if (bytes.length + chunk.length > 2 * 1024 * 1024) return finish(new Error('connection-unavailable'));
      bytes = Buffer.concat([bytes, chunk]);
      const newline = bytes.indexOf(10);
      if (newline < 0) return;
      try {
        const reply = JSON.parse(bytes.subarray(0, newline).toString('utf8'));
        if (!object(reply) || reply.ok !== true) throw new Error('Rejected');
        finish(undefined, reply.result);
      } catch { finish(new Error('connection-unavailable')); }
    });
  });
}

export async function inspectAgentProfile(profile: string, timeout?: number): Promise<PluginConnection> {
  const result = empty('profile-missing', profile);
  try {
    if (!await profileExists(profile)) return result;
    result.status = 'companion-missing';
    const configuration = await optionalFile(profile, 'dfsc-bridge/config.json');
    if (!configuration) return result;
    result.status = 'configuration-invalid';
    const config = JSON.parse(configuration.toString('utf8'));
    if (!object(config) || config.schemaVersion !== 1 || typeof config.agentId !== 'string'
      || !/^[a-z0-9][a-z0-9_-]{0,63}$/u.test(config.agentId)
      || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/u.test(config.agentId)
      || typeof config.displayName !== 'string' || !config.displayName.trim() || config.displayName.length > 100
      || config.workspaceRoots !== undefined && (!Array.isArray(config.workspaceRoots)
        || config.workspaceRoots.length > 32 || !config.workspaceRoots.every(localPath))) return result;
    if (config.protocol !== undefined && config.protocol !== 'dfsc-external-v1') return result;
    result.agentId = config.agentId;
    // Omission deliberately does not guess a personal or another application's Bridge profile.
    if (!localPath(config.bridgeRoot)) return result;
    const bridgeRoot = await realpath(config.bridgeRoot).catch(() => undefined);
    result.status = 'pairing-required';
    if (!bridgeRoot || !localPath(bridgeRoot)) return result;
    const descriptorBytes = await optionalFile(bridgeRoot, `agents/${config.agentId}/model.json`);
    if (!descriptorBytes) return result;
    result.status = 'identity-mismatch';
    const value = JSON.parse(descriptorBytes.toString('utf8'));
    if (!object(value) || value.version !== 1 || value.role !== 'model' || value.agentId !== config.agentId) return result;
    if (config.protocol !== value.protocol
      || value.protocol !== undefined && value.protocol !== 'dfsc-external-v1') return result;
    result.status = 'configuration-invalid';
    if (typeof value.token !== 'string' || !value.token || value.token.length > 4096) return result;
    let descriptor: Descriptor;
    if (value.transport === 'tcp' && value.host === '127.0.0.1'
      && typeof value.port === 'number' && Number.isInteger(value.port) && value.port >= 1 && value.port <= 65535)
      descriptor = { token: value.token, agentId: config.agentId, transport: 'tcp', host: '127.0.0.1', port: value.port,
        ...(value.protocol === 'dfsc-external-v1' ? { protocol: value.protocol } : {}) };
    else if ((value.transport === 'unix' || value.transport === undefined) && process.platform !== 'win32' && localPath(value.socket))
      descriptor = { token: value.token, agentId: config.agentId, transport: 'unix', socket: value.socket };
    else return result;
    const safe = (value: unknown, limit = 160) => text(typeof value === 'string'
      ? value.replaceAll(descriptor.token, '[redacted]') : '', limit);
    result.profile = safe(profile, 4096);
    result.agentId = safe(config.agentId, 64);
    result.displayName = safe(config.displayName, 100);
    result.status = 'connection-unavailable';
    const capabilities = await readAgentBridge(descriptor, 'system.capabilities', timeout);
    if (!object(capabilities) || capabilities.agentId !== config.agentId) {
      result.status = 'identity-mismatch'; return result;
    }
    if (config.protocol === 'dfsc-external-v1' && capabilities.protocol !== config.protocol) {
      result.status = 'identity-mismatch'; return result;
    }
    if (!Array.isArray(capabilities.roots) || capabilities.roots.length > 32 || !capabilities.roots.every(localPath)) return result;
    const declared: string[] = config.workspaceRoots ?? [];
    const authorized: string[] = await Promise.all(capabilities.roots.map((path: string) => realpath(path)));
    const scoped = await Promise.all(declared.map(path => realpath(path)));
    const roots = [...new Set(scoped.length ? authorized.flatMap(root =>
      scoped.flatMap(path => within(root, path) ? [path] : within(path, root) ? [root] : [])) : authorized)];
    const tasks = await readAgentBridge(descriptor, 'task.list', timeout);
    if (!Array.isArray(tasks) || tasks.length > 50) return result;
    const projected: PluginConnection['tasks'] = [];
    for (const task of tasks) {
      if (!object(task) || !object(task.origin) || task.origin.agentProfile !== config.agentId
        || !localPath(task.cwd) || typeof task.id !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/u.test(task.id)) continue;
      const cwd = await realpath(task.cwd).catch(() => undefined);
      if (!cwd || !roots.some(root => within(root, cwd))) continue;
      projected.push({ id: safe(task.id, 128), title: safe(task.title), cwd: safe(cwd, 4096),
        phase: typeof task.phase === 'string' && ['creating', 'queued', 'running', 'waiting', 'review', 'paused', 'completed', 'accepted', 'stopped', 'failed', 'interrupted'].includes(task.phase)
          ? task.phase : 'unknown' });
      if (projected.length === 20) break;
    }
    result.status = 'ready';
    result.roots = roots.map(root => safe(root, 4096));
    result.tasks = projected;
    result.checkedAt = Date.now();
    return result;
  } catch {
    // Profile contents, credentials and transport errors never become renderer error strings.
    return { ...result, roots: [], tasks: [] };
  }
}

export class PluginConnections {
  private pending: Promise<unknown> = Promise.resolve();
  constructor(private root: string) {}
  private async bindings(): Promise<Record<string, string>> {
    const bytes = await optionalFile(this.root, 'desktop-plugins/bridge-profiles.json', 1024 * 1024);
    if (!bytes) return {};
    const value = JSON.parse(bytes.toString('utf8'));
    if (!object(value) || Object.keys(value).length > 100
      || Object.entries(value).some(([ref, path]) => !/^[a-f0-9]{64}$/u.test(ref) || !localPath(path)))
      throw new Error('capability:storage');
    return value as Record<string, string>;
  }
  private serial<T>(action: () => Promise<T>): Promise<T> {
    const pending = this.pending.then(action);
    this.pending = pending.catch(() => {});
    return pending;
  }
  choose(ref: string, profile: string | null): Promise<void> {
    if (!/^[a-f0-9]{64}$/u.test(ref)) return Promise.reject(new Error('capability:invalid-input'));
    return this.serial(async () => {
      const bindings = await this.bindings();
      if (profile === null) delete bindings[ref];
      else {
        if (!localPath(profile)) throw new Error('capability:invalid-input');
        const canonical = await realpath(profile);
        if (!(await stat(canonical)).isDirectory()
          || !await profileExists(canonical)) throw new Error('capability:invalid-input');
        if (!bindings[ref] && Object.keys(bindings).length >= 100) throw new Error('capability:too-large');
        bindings[ref] = canonical;
      }
      await writePrivateJson(this.root, 'bridge-profiles.json', bindings);
    });
  }
  async snapshot(ref: string): Promise<PluginConnection> {
    if (!/^[a-f0-9]{64}$/u.test(ref)) throw new Error('capability:invalid-input');
    await this.pending;
    const profile = (await this.bindings())[ref];
    if (!profile) return empty('unselected');
    const result = await inspectAgentProfile(profile);
    await this.pending;
    if ((await this.bindings())[ref] !== profile) throw new Error('capability:stale');
    return result;
  }
}
