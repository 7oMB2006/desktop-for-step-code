import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer, type Socket } from 'node:net';
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inspectAgentProfile, PluginConnections, readAgentBridge } from '../electron/plugin-connection';

async function fixture(t: test.TestContext) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'dfsc-connection-')));
  t.after(() => rm(root, { recursive: true, force: true, maxRetries: 5 }));
  const profile = join(root, 'profile'), bridge = join(root, 'bridge'), work = join(root, 'work');
  const outside = join(root, 'outside'), scoped = join(work, 'scoped');
  for (const dir of [join(profile, 'dfsc-bridge'), join(bridge, 'agents', 'test-agent'), scoped, outside])
    await mkdir(dir, { recursive: true });
  await writeFile(join(profile, 'config.yaml'), 'api_key: yaml-marker-secret\n');
  const config = { schemaVersion: 1, agentId: 'test-agent', displayName: 'Test Agent',
    bridgeRoot: bridge, workspaceRoots: [scoped] };
  const saveConfig = (patch = {}) => writeFile(join(profile, 'dfsc-bridge/config.json'), JSON.stringify({ ...config, ...patch }));
  await saveConfig();
  const requests: any[] = [], sockets = new Set<Socket>();
  let respond: (request: any, socket: Socket) => void = (request, socket) => socket.end(JSON.stringify({ ok: true,
    result: request.method === 'system.capabilities' ? { agentId: config.agentId, roots: [work] } : [
      { id: 'visible', title: 'Visible task', phase: 'running', cwd: scoped, origin: { agentProfile: config.agentId } },
      { id: 'foreign', title: 'Foreign identity', phase: 'running', cwd: scoped, origin: { agentProfile: 'other' } },
      { id: 'outside', title: 'Foreign root', phase: 'running', cwd: outside, origin: { agentProfile: config.agentId } },
    ] }) + '\n');
  const server = createServer(socket => {
    sockets.add(socket); socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => {});
    let bytes = '';
    socket.on('data', chunk => {
      bytes += chunk.toString();
      if (!bytes.includes('\n')) return;
      const request = JSON.parse(bytes.slice(0, bytes.indexOf('\n')));
      requests.push(request); respond(request, socket);
    });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    for (const socket of sockets) socket.destroy();
    await new Promise<void>(resolve => server.close(() => resolve()));
  });
  const address = server.address() as { port: number };
  const descriptor = { version: 1, role: 'model', agentId: config.agentId, transport: 'tcp' as const,
    host: '127.0.0.1' as const, port: address.port, token: 'opaque-private-fixture-token' };
  const saveDescriptor = (patch = {}) => writeFile(join(bridge, 'agents/test-agent/model.json'),
    JSON.stringify({ ...descriptor, ...patch }));
  await saveDescriptor();
  return { root, profile, bridge, work, scoped, outside, requests, descriptor, saveConfig, saveDescriptor,
    respond: (handler: typeof respond) => { respond = handler; } };
}

test('read-only profile inspection projects only identity-bound tasks inside intersected real roots', async t => {
  const f = await fixture(t), result = await inspectAgentProfile(f.profile);
  assert.equal(result.status, 'ready');
  assert.deepEqual(result.roots, [f.scoped]);
  assert.deepEqual(result.tasks.map(task => task.id), ['visible']);
  assert.equal(result.agentId, 'test-agent');
  assert.ok(result.checkedAt);
  assert.deepEqual(f.requests.map(r => [r.method, r.params]), [['system.capabilities', {}], ['task.list', { offset: 0 }]]);
  assert.ok(f.requests.every(r => r.token === f.descriptor.token && r.version === 1));
  assert.ok(!JSON.stringify(result).includes(f.descriptor.token));
  assert.ok(!JSON.stringify(result).includes('yaml-marker-secret'));
});

test('generic connector inspection carries the explicit protocol without falling back to legacy credentials', async t => {
  const f = await fixture(t);
  await f.saveConfig({ protocol: 'dfsc-external-v1' });
  assert.equal((await inspectAgentProfile(f.profile)).status, 'identity-mismatch');
  assert.equal(f.requests.length, 0);
  await f.saveDescriptor({ protocol: 'dfsc-external-v1' });
  f.respond((request, socket) => {
    assert.equal(request.protocol, 'dfsc-external-v1');
    socket.end(JSON.stringify({ ok: true, result: request.method === 'system.capabilities'
      ? { protocol: 'dfsc-external-v1', agentId: 'test-agent', roots: [f.work] }
      : [{ id: 'new-task', title: 'Waiting', phase: 'queued', cwd: f.scoped, origin: { agentProfile: 'test-agent' } }] }) + '\n');
  });
  const state = await inspectAgentProfile(f.profile);
  assert.equal(state.status, 'ready');
  assert.equal(state.tasks[0].phase, 'queued');
  const calls = f.requests.length;
  await f.saveConfig({ protocol: undefined });
  assert.equal((await inspectAgentProfile(f.profile)).status, 'identity-mismatch');
  assert.equal(f.requests.length, calls);
});

test('prerequisite diagnostics never guess credentials or fall back to a personal profile', async t => {
  const f = await fixture(t);
  assert.equal((await inspectAgentProfile(join(f.root, 'missing'))).status, 'profile-missing');
  await rm(join(f.profile, 'dfsc-bridge/config.json'));
  assert.equal((await inspectAgentProfile(f.profile)).status, 'companion-missing');
  await f.saveConfig({ bridgeRoot: undefined });
  assert.equal((await inspectAgentProfile(f.profile)).status, 'configuration-invalid');
  await f.saveConfig();
  await rm(join(f.bridge, 'agents/test-agent/model.json'));
  assert.equal((await inspectAgentProfile(f.profile)).status, 'pairing-required');
  await f.saveDescriptor({ role: 'human', token: 'never-display-this' });
  assert.equal((await inspectAgentProfile(f.profile)).status, 'identity-mismatch');
  for (const patch of [{ host: 'localhost' }, { host: '8.8.8.8' }, { port: 0 }, { port: 1.2 }, { token: '' }]) {
    await f.saveDescriptor(patch);
    assert.equal((await inspectAgentProfile(f.profile)).status, 'configuration-invalid');
  }
  assert.equal(f.requests.length, 0);
});

test('identity mismatch, malformed replies and unavailable server fail closed without raw errors', async t => {
  const f = await fixture(t);
  f.respond((_request, socket) => socket.end('{"ok":true,"result":{"agentId":"other","roots":[]}}\n'));
  assert.equal((await inspectAgentProfile(f.profile)).status, 'identity-mismatch');
  assert.equal(f.requests.length, 1, 'no task read before identity check');
  for (const bytes of ['not-json\n', '{"ok":false,"error":"SECRET"}\n', '{}\n', '{"ok":true,"result":[]}\n']) {
    f.respond((_request, socket) => socket.end(bytes));
    const result = await inspectAgentProfile(f.profile);
    assert.notEqual(result.status, 'ready');
    assert.deepEqual(result.tasks, []);
    assert.ok(!JSON.stringify(result).includes('SECRET'));
  }
  await f.saveDescriptor({ port: 1 });
  assert.equal((await inspectAgentProfile(f.profile, 100)).status, 'connection-unavailable');
});

test('JSONL client handles partial data, hard deadlines, oversized data and rejects other methods', async t => {
  const f = await fixture(t);
  f.respond((_request, socket) => { socket.write('{"ok":true,'); socket.end('"result":42}\n'); });
  assert.equal(await readAgentBridge(f.descriptor, 'system.capabilities', 200), 42);
  f.respond((_request, socket) => socket.write('{"ok":true'));
  await assert.rejects(readAgentBridge(f.descriptor, 'task.list', 30), /connection-unavailable/);
  f.respond((_request, socket) => socket.end(Buffer.alloc(2 * 1024 * 1024 + 1, 65)));
  await assert.rejects(readAgentBridge(f.descriptor, 'task.list', 500), /connection-unavailable/);
  const count = f.requests.length;
  await assert.rejects(readAgentBridge(f.descriptor, 'task.create' as never), /connection-unavailable/);
  assert.equal(f.requests.length, count);
});

test('task projection is bounded, sanitized and never includes server transcripts or tool output', async t => {
  const f = await fixture(t);
  f.respond((request, socket) => socket.end(JSON.stringify({ ok: true, result: request.method === 'system.capabilities'
    ? { agentId: 'test-agent', roots: [f.work] }
    : Array.from({ length: 50 }, (_, i) => ({ id: `task-${i}`, title: `Task ${f.descriptor.token}\u202e\n`,
      phase: 'arbitrary-secret-phase', cwd: f.scoped, origin: { agentProfile: 'test-agent' },
      transcript: 'private transcript', toolOutput: 'private tool output' })) }) + '\n'));
  const result = await inspectAgentProfile(f.profile);
  assert.equal(result.tasks.length, 20);
  assert.equal(result.tasks[0].phase, 'unknown');
  assert.equal(result.tasks[0].title, 'Task [redacted]');
  for (const secret of [f.descriptor.token, 'private transcript', 'private tool output', '\u202e'])
    assert.ok(!JSON.stringify(result).includes(secret));
  await f.saveConfig({ workspaceRoots: [f.outside] });
  const noScope = await inspectAgentProfile(f.profile);
  assert.equal(noScope.status, 'ready');
  assert.deepEqual(noScope.roots, []);
  assert.deepEqual(noScope.tasks, []);
});

test('linked configuration and credential directories are rejected before network access', async t => {
  const f = await fixture(t);
  await rm(join(f.profile, 'dfsc-bridge'), { recursive: true });
  const alternate = join(f.root, 'alternate');
  await mkdir(alternate);
  await writeFile(join(alternate, 'config.json'), JSON.stringify({ schemaVersion: 1 }));
  try { await symlink(alternate, join(f.profile, 'dfsc-bridge'), process.platform === 'win32' ? 'junction' : 'dir'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'EPERM') { t.skip('Links unavailable'); return; } throw error; }
  assert.notEqual((await inspectAgentProfile(f.profile)).status, 'ready');
  assert.equal(f.requests.length, 0);
});

test('explicit profile selection persists only paths, supports forgetting and rejects stale in-flight probes', async t => {
  const f = await fixture(t), key = 'a'.repeat(64), store = new PluginConnections(f.root);
  assert.equal((await store.snapshot(key)).status, 'unselected');
  await assert.rejects(store.choose('foreign-ref', f.profile), /invalid-input/);
  await assert.rejects(store.choose(key, f.outside), /ENOENT|invalid-input/);
  await store.choose(key, f.profile);
  assert.equal((await new PluginConnections(f.root).snapshot(key)).status, 'ready');
  const bytes = await readFile(join(f.root, 'desktop-plugins/bridge-profiles.json'), 'utf8');
  assert.deepEqual(JSON.parse(bytes), { [key]: f.profile });
  assert.ok(!bytes.includes(f.descriptor.token));
  let release!: () => void;
  const received = new Promise<void>(resolve => {
    f.respond((_request, socket) => {
      release = () => socket.end('{"ok":true,"result":{"agentId":"test-agent","roots":[]}}\n');
      resolve();
    });
  });
  const pending = store.snapshot(key);
  await received;
  await store.choose(key, null);
  // Supply both fixed reads so the probe completes before its stale-selection check.
  f.respond((_request, socket) => socket.end('{"ok":true,"result":[]}\n'));
  release();
  await assert.rejects(pending, /stale/);
  assert.equal((await store.snapshot(key)).status, 'unselected');
  assert.equal((await new PluginConnections(f.root).snapshot('b'.repeat(64))).status, 'unselected');
});
