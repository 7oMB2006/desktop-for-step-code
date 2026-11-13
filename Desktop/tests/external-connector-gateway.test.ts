import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdir, mkdtemp, readFile, realpath, rename, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { createConnection } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';
import { ConnectorJsonStore, ExternalConnectorGateway, externalConnectorProtocol } from '../electron/external-connector-gateway';
import type { ExternalGrant } from '../electron/external-connector-tasks';

type Descriptor = { token: string; agentId: string; port: number; protocol: string };
type Dispatch = (grant: ExternalGrant, method: string, params: unknown, valid: () => boolean) => Promise<unknown>;
const envelope = (descriptor: Descriptor, method = 'system.capabilities', params: unknown = {}) => ({
  version: 1, protocol: externalConnectorProtocol, token: descriptor.token, method, params,
});
async function exchange(descriptor: Descriptor, value: unknown): Promise<any> {
  return raw(descriptor.port, Buffer.from(JSON.stringify(value) + '\n'));
}
async function raw(port: number, bytes: Buffer): Promise<any> {
  return new Promise((accept, reject) => {
    const socket = createConnection({ host: '127.0.0.1', port });
    let data = '';
    const timer = setTimeout(() => { socket.destroy(); reject(new Error('Fixture socket did not settle')); }, 5000);
    const finish = (value?: unknown) => { clearTimeout(timer); socket.destroy(); accept(value); };
    socket.on('connect', () => socket.write(bytes));
    socket.on('data', chunk => {
      data += chunk.toString();
      if (data.includes('\n')) {
        try { finish(JSON.parse(data.slice(0, data.indexOf('\n')))); }
        catch (error) { clearTimeout(timer); socket.destroy(); reject(error); }
      }
    });
    socket.on('error', () => finish());
    socket.on('close', () => finish());
  });
}
async function fixture(t: TestContext, dispatch: Dispatch = async (grant, method) => ({
  protocol: externalConnectorProtocol, agentId: grant.agentId, roots: grant.roots, method,
}), options: { frameTimeoutMs?: number; requestTimeoutMs?: number } = {}) {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'dfsc-connectors-')));
  const root = join(directory, 'external'), workspace = join(directory, 'project');
  await mkdir(workspace);
  const invalidations: (string | undefined)[] = [];
  const gateway = new ExternalConnectorGateway(root, {
    ...options, dispatch, invalidated: agentId => { invalidations.push(agentId); },
  });
  await gateway.initialize();
  t.after(async () => {
    await gateway.shutdown();
    await rm(directory, { recursive: true, force: true });
  });
  const pair = async (displayName = 'Fixture Agent', roots = [workspace]) => {
    const state = await gateway.pair(displayName, roots);
    const connection = state.connections.at(-1)!;
    const config = JSON.parse(await readFile(connection.configPath, 'utf8'));
    const descriptor = JSON.parse(await readFile(join(root, 'agents', connection.agentId, 'model.json'), 'utf8')) as Descriptor;
    return { connection, config, descriptor };
  };
  return { directory, root, workspace, gateway, invalidations, pair };
}

test('connector gateway is default-off and exports only nonsecret management state', async t => {
  const { gateway, workspace, root, pair } = await fixture(t);
  assert.deepEqual(gateway.snapshot(), { enabled: false, listening: false, connections: [] });
  await assert.rejects(gateway.pair('Agent', [workspace]), /connector:disabled/u);
  await gateway.enable();
  const { connection, config, descriptor } = await pair();
  assert.equal(descriptor.protocol, externalConnectorProtocol);
  assert.equal(config.protocol, externalConnectorProtocol);
  assert.equal(config.bridgeRoot, root);
  assert.deepEqual(config.workspaceRoots, [await realpath(workspace)]);
  assert.equal(config.agentId, descriptor.agentId);
  assert.equal(config.token, undefined);
  assert.equal(JSON.stringify(gateway.snapshot()).includes(descriptor.token), false);
  assert.equal((await readFile(join(root, 'state.json'), 'utf8')).includes(descriptor.token), false);
  assert.equal(connection.configPath.endsWith('config.json'), true);
  const reply = await exchange(descriptor, envelope(descriptor));
  assert.equal(reply.ok, true);
  assert.equal(reply.result.agentId, connection.agentId);
  assert.deepEqual(reply.result.roots, [await realpath(workspace)]);
  if (process.platform !== 'win32') assert.equal((await stat(join(root, 'agents', connection.agentId, 'model.json'))).mode & 0o777, 0o600);
});

test('connector gateway requires exact protocol and independent credentials', async t => {
  let calls = 0;
  const { gateway, pair } = await fixture(t, async grant => { calls++; return { agentId: grant.agentId }; });
  await gateway.enable();
  const first = await pair('First'), second = await pair('Second');
  const base = envelope(first.descriptor);
  for (const request of [
    { ...base, token: randomBytes(32).toString('base64url') },
    { ...base, token: '' }, { ...base, protocol: undefined }, { ...base, protocol: 'legacy' },
    { ...base, version: 2 }, { ...base, agentId: second.connection.agentId },
    { ...base, source: 'human' }, { ...base, origin: { human: true } },
  ]) assert.equal((await exchange(first.descriptor, request)).ok, false);
  assert.equal(calls, 0);
  assert.equal((await exchange(first.descriptor, base)).result.agentId, first.connection.agentId);
  assert.equal((await exchange(second.descriptor, envelope(second.descriptor))).result.agentId, second.connection.agentId);
  assert.notEqual(first.descriptor.token, second.descriptor.token);
});

test('connector gateway rejects malformed, unsupported, oversized and multi-frame requests', async t => {
  let calls = 0;
  const { gateway, pair } = await fixture(t, async () => { calls++; return {}; });
  await gateway.enable();
  const { descriptor } = await pair();
  for (const method of ['human.grant', 'approval.grant', 'command', 'task.accept', '__proto__']) {
    const reply = await exchange(descriptor, envelope(descriptor, method));
    assert.deepEqual(reply, { ok: false, error: 'connector:invalid-input' });
  }
  assert.equal((await exchange(descriptor, envelope(descriptor, 'task.list', []))).ok, false);
  assert.deepEqual(await raw(descriptor.port, Buffer.from('not json\n')), { ok: false, error: 'connector:invalid-input' });
  assert.deepEqual(await raw(descriptor.port, Buffer.from([0xff, 10])), { ok: false, error: 'connector:invalid-input' });
  assert.equal(await raw(descriptor.port, Buffer.alloc(64 * 1024 + 1, 65)), undefined);
  const frame = JSON.stringify(envelope(descriptor)) + '\n';
  assert.equal(await raw(descriptor.port, Buffer.from(frame + frame)), undefined);
  assert.equal(await raw(descriptor.port, Buffer.from('GET / HTTP/1.1\r\n\r\n')), undefined);
  assert.equal(calls, 0);
});

test('connector gateway bounds idle sockets, response size and raw errors', async t => {
  let reply: unknown = {};
  const { gateway, pair } = await fixture(t, async () => {
    if (reply instanceof Error) throw reply;
    return reply;
  }, { frameTimeoutMs: 50 });
  await gateway.enable();
  const { descriptor } = await pair();
  const other = await pair('Other');
  assert.equal(await raw(descriptor.port, Buffer.from('{')), undefined);
  reply = { text: `${descriptor.token}:${other.descriptor.token}` };
  assert.deepEqual((await exchange(descriptor, envelope(descriptor))).result, { text: '[redacted]:[redacted]' });
  reply = { text: 'x'.repeat(128 * 1024) };
  assert.deepEqual(await exchange(descriptor, envelope(descriptor)), { ok: false, error: 'connector:response-too-large' });
  reply = new Error(`Sensitive path ${descriptor.token}`);
  assert.deepEqual(await exchange(descriptor, envelope(descriptor)), { ok: false, error: 'connector:unavailable' });
  reply = new Error('connector:credential-secret');
  assert.deepEqual(await exchange(descriptor, envelope(descriptor)), { ok: false, error: 'connector:unavailable' });
});

test('connector gateway timeout does not replay a dispatched operation', async t => {
  let release!: () => void, calls = 0;
  const gate = new Promise<void>(accept => { release = accept; });
  const { gateway, pair } = await fixture(t, async () => { calls++; await gate; return {}; }, { requestTimeoutMs: 40 });
  await gateway.enable();
  const { descriptor } = await pair();
  assert.equal(await exchange(descriptor, envelope(descriptor)), undefined);
  release();
  await new Promise(accept => setTimeout(accept, 5));
  assert.equal(calls, 1);
});

test('connector gateway bounds handlers even when clients disconnect before dispatch settles', async t => {
  let release!: () => void, calls = 0;
  const gate = new Promise<void>(accept => { release = accept; });
  const { gateway, pair } = await fixture(t, async () => { calls++; await gate; return {}; }, { requestTimeoutMs: 100 });
  await gateway.enable();
  const { descriptor } = await pair();
  for (let index = 0; index < 16; index++) assert.equal(await exchange(descriptor, envelope(descriptor)), undefined);
  assert.equal(await exchange(descriptor, envelope(descriptor)), undefined);
  assert.equal(calls, 16);
  release();
  await new Promise(accept => setTimeout(accept, 10));
  assert.equal((await exchange(descriptor, envelope(descriptor))).ok, true);
  assert.equal(calls, 17);
});

test('connector gateway limits connection count and validates pairing input', async t => {
  const { gateway, workspace, pair } = await fixture(t);
  await gateway.enable();
  for (const [name, roots] of [
    ['', [workspace]], ['x'.repeat(101), [workspace]], ['bad\nname', [workspace]],
    ['Agent', []], ['Agent', [workspace, workspace]], ['Agent', ['relative']],
    ['Agent', ['\\\\server\\share']], ['Agent', Array(33).fill(workspace)],
  ] as [string, string[]][]) await assert.rejects(gateway.pair(name, roots), /connector:invalid-input/u);
  for (let index = 0; index < 8; index++) await pair(`Agent ${index}`);
  await assert.rejects(pair('Ninth'), /connector:limit/u);
  assert.equal(gateway.snapshot().connections.length, 8);
});

test('connector gateway pins canonical root identity, not just the original pathname', async t => {
  let calls = 0;
  const { gateway, workspace, pair } = await fixture(t, async () => { calls++; return {}; });
  await gateway.enable();
  const { descriptor } = await pair();
  await gateway.validate(workspace, [workspace]);
  await assert.rejects(gateway.validate(join(workspace, 'child'), [workspace]), /connector:invalid-scope/u);
  await rename(workspace, `${workspace}-original`);
  await mkdir(workspace);
  const result = await exchange(descriptor, envelope(descriptor));
  assert.equal(result.ok, false);
  assert.equal(result.error, 'connector:scope-changed');
  await assert.rejects(gateway.validate(workspace, [workspace]), /connector:scope-changed/u);
  assert.equal(calls, 0);
  const replacement = await pair('Reauthorized directory');
  await gateway.validate(workspace, [workspace]);
  assert.equal((await exchange(replacement.descriptor, envelope(replacement.descriptor))).ok, true);
  assert.equal((await exchange(descriptor, envelope(descriptor))).error, 'connector:scope-changed');
});

test('connector gateway refuses a linked project and linked private storage', async t => {
  const { gateway, workspace, directory } = await fixture(t);
  const link = join(directory, 'project-link');
  try { await symlink(workspace, link, process.platform === 'win32' ? 'junction' : 'dir'); }
  catch (error: any) {
    if (['EPERM', 'EACCES', 'ENOSYS'].includes(error.code)) { t.skip('Directory links are unavailable'); return; }
    throw error;
  }
  await gateway.enable();
  await assert.rejects(gateway.pair('Linked', [link]), /connector:invalid-scope/u);
  const store = new ConnectorJsonStore(link, 'private.json');
  await assert.rejects(store.save({ token: 'must-not-be-written' }), /connector:storage/u);
});

test('connector gateway revokes immediately and validates again after awaiting work', async t => {
  let entered!: () => void, release!: () => void;
  let dispatchValid: (() => boolean) | undefined, dispatchGrant: ExternalGrant | undefined;
  const ready = new Promise<void>(accept => { entered = accept; });
  const gate = new Promise<void>(accept => { release = accept; });
  const { gateway, pair, invalidations } = await fixture(t, async (grant, _method, _params, valid) => {
    dispatchGrant = grant; dispatchValid = valid; entered(); await gate;
    await grant.validate!();
    return { completed: true };
  });
  await gateway.enable();
  const first = await pair('First'), second = await pair('Second');
  const inFlight = exchange(first.descriptor, envelope(first.descriptor));
  await ready;
  assert.equal(dispatchValid!(), true);
  const revoking = gateway.revoke(first.connection.agentId);
  assert.equal(dispatchValid!(), false);
  await assert.rejects(dispatchGrant!.validate!(), /connector:unauthorized/u);
  await revoking;
  release();
  assert.equal(await inFlight, undefined);
  assert.equal(invalidations.includes(first.connection.agentId), true);
  assert.equal((await exchange(first.descriptor, envelope(first.descriptor))).ok, false);
  assert.equal(gateway.snapshot().connections[0].agentId, second.connection.agentId);
});

test('connector grant validator detects a directory replacement during an asynchronous native step', async t => {
  let entered!: () => void, release!: () => void;
  const ready = new Promise<void>(accept => { entered = accept; });
  const gate = new Promise<void>(accept => { release = accept; });
  const { gateway, workspace, pair } = await fixture(t, async grant => {
    entered(); await gate; await grant.validate!(); return {};
  });
  await gateway.enable();
  const { descriptor } = await pair();
  const request = exchange(descriptor, envelope(descriptor));
  await ready;
  await rename(workspace, `${workspace}-original`);
  await mkdir(workspace);
  release();
  assert.deepEqual(await request, { ok: false, error: 'connector:scope-changed' });
});

test('connector gateway revalidates queued read results after a directory replacement', async t => {
  let entered!: () => void, queued!: () => void, release!: () => void, reads = 0;
  const ready = new Promise<void>(accept => { entered = accept; });
  const waiting = new Promise<void>(accept => { queued = accept; });
  const gate = new Promise<void>(accept => { release = accept; });
  let tail: Promise<unknown> = Promise.resolve();
  const { gateway, workspace, pair } = await fixture(t, async (_grant, method) => {
    const result = tail.then(async () => {
      if (method === 'run.submit') { entered(); await gate; return { accepted: true }; }
      reads++;
      return { summary: 'Private queued result' };
    });
    tail = result.catch(() => {});
    if (method === 'task.get') queued();
    return result;
  });
  await gateway.enable();
  const { descriptor } = await pair();
  const running = exchange(descriptor, envelope(descriptor, 'run.submit'));
  await ready;
  const read = exchange(descriptor, envelope(descriptor, 'task.get', { taskId: 'fixture' }));
  await waiting;
  await rename(workspace, `${workspace}-original`);
  await mkdir(workspace);
  release();
  assert.deepEqual(await running, { ok: false, error: 'connector:scope-changed' });
  assert.deepEqual(await read, { ok: false, error: 'connector:scope-changed' });
  assert.equal(reads, 1, 'A previously authenticated queued read cannot return a stale-authority result');
});

test('connector gateway persists revocation and refreshes endpoints without replay on restart', async t => {
  let calls = 0;
  const { gateway, root, pair, workspace } = await fixture(t, async () => { calls++; return {}; });
  await gateway.enable();
  const first = await pair('First'), second = await pair('Second');
  await gateway.revoke(first.connection.agentId);
  await gateway.shutdown();
  const restored = new ExternalConnectorGateway(root, { dispatch: async () => { calls++; return {}; }, invalidated: () => {} });
  t.after(() => restored.shutdown());
  await restored.initialize();
  assert.equal(restored.snapshot().enabled, true);
  assert.equal(restored.snapshot().listening, true);
  assert.equal(calls, 0);
  assert.deepEqual(restored.snapshot().connections.map(item => item.agentId), [second.connection.agentId]);
  await restored.validate(workspace, [workspace]);
  const descriptor = JSON.parse(await readFile(join(root, 'agents', second.connection.agentId, 'model.json'), 'utf8'));
  assert.equal(descriptor.token, second.descriptor.token);
  assert.equal((await exchange(descriptor, envelope(descriptor))).ok, true);
  assert.equal((await exchange(descriptor, { ...envelope(descriptor), token: first.descriptor.token })).ok, false);
});

test('connector gateway disable persists while shutdown preserves enable preference', async t => {
  const { gateway, root, pair } = await fixture(t);
  await gateway.enable();
  const { descriptor } = await pair();
  await gateway.disable();
  assert.equal(gateway.snapshot().enabled, false);
  assert.equal(await exchange(descriptor, envelope(descriptor)), undefined);
  const restored = new ExternalConnectorGateway(root, { dispatch: async () => ({}), invalidated: () => {} });
  t.after(() => restored.shutdown());
  await restored.initialize();
  assert.equal(restored.snapshot().listening, false);
  assert.equal(restored.snapshot().connections.length, 1);
  await restored.enable();
  assert.equal(restored.snapshot().listening, true);
});

test('connector gateway resolves enable/disable races using the latest local intent', async t => {
  const { gateway } = await fixture(t);
  const enabling = gateway.enable(), disabling = gateway.disable();
  await Promise.all([enabling, disabling]);
  assert.equal(gateway.snapshot().listening, false);
  const disablingAgain = gateway.disable(), enablingAgain = gateway.enable();
  await Promise.all([disablingAgain, enablingAgain]);
  assert.equal(gateway.snapshot().listening, true);
});

test('connector gateway fails closed when revocation cannot be saved', async t => {
  const { gateway, root, pair } = await fixture(t);
  await gateway.enable();
  const { connection, descriptor } = await pair();
  await rename(join(root, 'state.json'), join(root, 'state-backup.json'));
  await mkdir(join(root, 'state.json'));
  await assert.rejects(gateway.revoke(connection.agentId), /connector:storage/u);
  assert.equal(gateway.snapshot().enabled, false);
  assert.equal(gateway.snapshot().listening, false);
  assert.equal(gateway.snapshot().error, 'connector:storage');
  assert.equal(await exchange(descriptor, envelope(descriptor)), undefined);
  await rm(join(root, 'state.json'), { recursive: true });
  await gateway.disable();
  const restored = new ExternalConnectorGateway(root, { dispatch: async () => ({}), invalidated: () => {} });
  t.after(() => restored.shutdown());
  await restored.initialize();
  assert.equal(restored.snapshot().connections.length, 0, 'Retrying disable durably preserves the revoked identity');
});

test('connector shutdown closes the listener even when task invalidation fails', async t => {
  const { gateway, root, pair } = await fixture(t);
  await gateway.enable();
  const { connection } = await pair();
  await gateway.shutdown();
  const failing = new ExternalConnectorGateway(root, {
    dispatch: async () => ({}), invalidated: () => { throw new Error('Sensitive task persistence failure'); },
  });
  t.after(() => failing.shutdown());
  await failing.initialize();
  const descriptor = JSON.parse(await readFile(join(root, 'agents', connection.agentId, 'model.json'), 'utf8'));
  await failing.shutdown();
  assert.equal(failing.snapshot().listening, false);
  assert.equal(await exchange(descriptor, envelope(descriptor)), undefined);
  assert.equal(failing.snapshot().error, 'connector:unavailable');
});

test('connector private JSON store rejects damaged data and unsafe relative paths', async t => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'dfsc-connectors-store-')));
  t.after(() => rm(directory, { recursive: true, force: true }));
  for (const path of ['../escape.json', '/absolute.json', 'a\\b.json', 'con.json', 'agents/../model.json'])
    assert.throws(() => new ConnectorJsonStore(directory, path), /connector:storage/u);
  const store = new ConnectorJsonStore(directory, 'tasks.json');
  assert.equal(await store.load(), undefined);
  await store.save({ version: 1, tasks: [] });
  assert.deepEqual(await store.load(), { version: 1, tasks: [] });
  await writeFile(join(directory, 'tasks.json'), '{damaged');
  await assert.rejects(store.load(), /connector:storage/u);
  await assert.rejects(store.save({ text: 'x'.repeat(1024 * 1024) }), /connector:storage/u);
});

test('connector gateway refuses corrupt state and mismatched descriptor credentials', async t => {
  const { gateway, root, pair } = await fixture(t);
  await gateway.enable();
  const { connection, descriptor } = await pair();
  await gateway.shutdown();
  await writeFile(join(root, 'agents', connection.agentId, 'model.json'), JSON.stringify({ ...descriptor, token: randomBytes(32).toString('base64url') }));
  const restored = new ExternalConnectorGateway(root, { dispatch: async () => ({}), invalidated: () => {} });
  t.after(() => restored.shutdown());
  await assert.rejects(restored.initialize(), /connector:storage/u);
  assert.equal(restored.snapshot().listening, false);
  assert.equal(restored.snapshot().error, 'connector:storage');
  assert.throws(() => restored.enable(), /connector:unavailable/u);
});
