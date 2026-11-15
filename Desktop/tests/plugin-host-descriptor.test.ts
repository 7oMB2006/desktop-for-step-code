import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { CapabilityService } from '../electron/capability-service';
import type { RpcProcess } from '../electron/runtime';

function fixture() {
  const root = resolve('fixture-profile'), directory = resolve(root, 'plugins/example');
  const descriptor = { root: directory, kind: 'installed', provenance: 'recorded', id: 'example',
    name: 'example', instance: randomUUID(), fingerprint: 'a'.repeat(64) };
  const calls: Array<{ type: string; args?: Record<string, unknown>; timeout?: number }> = [];
  let stopped = 0;
  const state = { requestError: undefined as Error | undefined, stopError: undefined as Error | undefined };
  const service = new CapabilityService({ root, node: 'unused', runtime: 'unused', environment: () => ({}),
    createWorker: () => ({
      start() {}, async stopManagement() { stopped++; if (state.stopError) throw state.stopError; },
      async request(type: string, args?: Record<string, unknown>, timeout?: number) {
        calls.push({ type, args, timeout });
        if (state.requestError) throw state.requestError;
        return descriptor;
      },
    } as unknown as RpcProcess),
  });
  return { service, descriptor, calls, directory, state, stopped: () => stopped };
}

test('host attachment requests only the narrow native descriptor and never the presentation catalog', async () => {
  const f = fixture();
  try {
    let admitted = 0;
    await f.service.withHostDescriptor('example', f.directory, 'tools', async descriptor => {
      admitted++;
      assert.equal(descriptor.fingerprint, f.descriptor.fingerprint);
      assert.match(descriptor.ref, /^[a-f0-9-]{36}$/);
    });
    assert.equal(admitted, 1);
    assert.deepEqual(f.calls, [{ type: 'host-descriptor',
      args: { input: { pluginId: 'example', root: f.directory, consumer: 'tools' } }, timeout: 30000 }]);
    assert.equal(f.stopped(), 1);
  } finally { await f.service.stop(); }
});

test('descriptor identity and receipt fields must match before a host can launch', async () => {
  for (const change of [
    { id: 'other' }, { root: resolve('other') }, { provenance: 'unknown' },
    { kind: 'available' }, { instance: '' }, { fingerprint: 'invalid' },
  ]) {
    const f = fixture();
    Object.assign(f.descriptor, change);
    try {
      await assert.rejects(f.service.withHostDescriptor('example', f.directory, 'tools',
        async () => assert.fail('Invalid descriptor cannot reach the launch action')), /host-unavailable/);
      assert.equal(f.stopped(), 1);
    } finally { await f.service.stop(); }
  }
});

test('host launch remains inside the capability transaction queue', async () => {
  const f = fixture();
  let release!: () => void, started!: () => void;
  const startedPromise = new Promise<void>(resolve => { started = resolve; });
  const held = new Promise<void>(resolve => { release = resolve; });
  try {
    const first = f.service.withHostDescriptor('example', f.directory, 'tools', async () => {
      started();
      await held;
    });
    await startedPromise;
    const second = f.service.withHostDescriptor('example', f.directory, 'tools', async () => {});
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(f.calls.length, 1);
    release();
    await Promise.all([first, second]);
    assert.equal(f.calls.length, 2);
  } finally { release?.(); await f.service.stop(); }
});

test('a timed-out descriptor closes its management worker and releases the queue without launching', async () => {
  const f = fixture();
  f.state.requestError = new Error('Runtime timed out: host-descriptor');
  try {
    await assert.rejects(f.service.withHostDescriptor('example', f.directory, 'tools',
      async () => assert.fail('Timed-out resolution must not launch')), /timed out/);
    assert.equal(f.stopped(), 1);
    assert.equal(f.service.available, true);
    f.state.requestError = undefined;
    await f.service.withHostDescriptor('example', f.directory, 'tools', async () => {});
    assert.equal(f.calls.length, 2);
    assert.equal(f.stopped(), 2);
  } finally { await f.service.stop(); }
});

test('unconfirmed descriptor-worker shutdown quarantines later launches with a fixed failure code', async () => {
  const f = fixture();
  f.state.stopError = new Error('untrusted worker stderr must not escape');
  try {
    await assert.rejects(f.service.withHostDescriptor('example', f.directory, 'tools',
      async () => assert.fail('Unconfirmed shutdown must not launch')),
    { message: 'capability:management-unavailable' });
    assert.equal(f.service.available, false);
    await assert.rejects(f.service.withHostDescriptor('example', f.directory, 'tools', async () => {}),
      { message: 'capability:management-unavailable' });
    assert.equal(f.calls.length, 1);
  } finally { f.state.stopError = undefined; await f.service.stop(); }
});
