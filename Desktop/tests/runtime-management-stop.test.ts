import assert from 'node:assert/strict';
import test from 'node:test';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { once } from 'node:events';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { isolatedEnvironment, RpcCommandError, RpcManagementStopError, RpcProcess } from '../electron/runtime';
import { diagnoseCapabilityMutation } from '../electron/capability-diagnostics';

async function bounded<T>(promise: Promise<T>, milliseconds = 3000): Promise<T> {
  let timer: NodeJS.Timeout;
  try {
    return await Promise.race([promise, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('Synthetic process cleanup timed out')), milliseconds);
    })]);
  } finally { clearTimeout(timer!); }
}

const fixture = `
const fs = require('node:fs');
const input = require('node:readline').createInterface({ input: process.stdin });
const scenario = process.env.FIXTURE_SCENARIO;
const send = value => process.stdout.write(JSON.stringify(value) + '\\n');
const end = code => { input.close(); process.stdin.destroy(); process.exitCode = code; };
let work;
input.on('line', line => {
  const request = JSON.parse(line);
  const reply = data => send({ type: 'response', id: request.id, success: true, data });
  if (request.type === 'fixture-release') { fs.writeFileSync('cleaned', 'yes'); end(0); return; }
  if (request.type === 'pending') {
    work = setTimeout(() => { fs.writeFileSync('committed', 'yes'); reply({ committed: true }); }, 10000);
    return;
  }
  if (request.type === 'exit-now') { reply({}); end(0); return; }
  if (request.type !== 'shutdown') { reply({ pid: process.pid }); return; }
  const ack = () => reply({ shutdown: true });
  if (scenario === 'linger') { ack(); return; }
  if (scenario === 'wrong-id') {
    send({ type: 'response', id: 'wrong', success: true, data: { shutdown: true } }); end(0); return;
  }
  if (scenario === 'bad-ack') { reply({ shutdown: false }); return; }
  if (scenario === 'negative') {
    send({ type: 'response', id: request.id, success: false, error: 'no' }); return;
  }
  if (scenario === 'protocol') { process.stdout.write('not-json\\n'); return; }
  if (scenario === 'no-ack') { end(0); return; }
  if (scenario === 'nonzero') { ack(); end(3); return; }
  if (scenario === 'drain') {
    clearTimeout(work); fs.writeFileSync('drained', 'yes'); ack(); end(0); return;
  }
  ack();
  if (scenario === 'gated') return;
  setTimeout(() => { fs.writeFileSync('cleaned', 'yes'); end(0); }, 80);
});
`;

async function withWorker(scenario: string, run: (context: {
  rpc: RpcProcess; child: ChildProcessWithoutNullStreams; root: string; events: unknown[];
}) => Promise<void>, source = fixture, setup?: (root: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), 'rpc-management-stop-'));
  const events: unknown[] = [];
  const rpc = new RpcProcess(event => events.push(event));
  let child: ChildProcessWithoutNullStreams | undefined, closed: Promise<unknown> | undefined;
  try {
    await setup?.(root);
    const entry = join(root, source === fixture ? 'fixture.cjs' : 'capability-admin.mjs');
    await writeFile(entry, source);
    rpc.start(process.execPath, entry, root, { ...isolatedEnvironment(root), FIXTURE_SCENARIO: scenario });
    child = (rpc as unknown as { child: ChildProcessWithoutNullStreams }).child;
    closed = once(child, 'close');
    await bounded(rpc.request(source === fixture ? 'ready' : 'catalog'));
    await run({ rpc, child, root, events });
  } finally {
    if (child) {
      // These fixtures own no uncontrolled descendants; never invoke host taskkill.
      if (child.exitCode === null && child.signalCode === null) child.kill();
      await bounded(closed!);
      assert.ok(child.exitCode !== null || child.signalCode !== null);
    }
    await rm(root, { recursive: true, force: true });
  }
}

test('management stop joins callers, drains and confirms exit rather than trusting ACK', { timeout: 10000 }, async () => {
  await withWorker('gated', async ({ rpc, child, root, events }) => {
    let stopped = false;
    const acknowledged = once(child.stdout, 'data');
    const first = rpc.stopManagement().then(() => { stopped = true; });
    const second = rpc.stopManagement();
    await bounded(acknowledged);
    assert.equal(stopped, false);
    assert.equal(child.exitCode, null);
    assert.throws(() => rpc.start(process.execPath, 'unused', root, {}), /still stopping/);
    await assert.rejects(rpc.request('ready'), /not connected/);
    child.stdin.write('{"type":"fixture-release"}\n');
    await Promise.all([first, second]);
    assert.equal(child.exitCode, 0);
    assert.equal(rpc.pid, undefined);
    assert.equal(await readFile(join(root, 'cleaned'), 'utf8'), 'yes');
    assert.deepEqual(events, []);
  });
});

test('management stop still decodes a buffered ACK after the exit notification', { timeout: 10000 }, async () => {
  await withWorker('delayed', async ({ rpc, child }) => {
    const stopped = rpc.stopManagement();
    child.emit('exit', 0, null);
    await stopped;
    assert.equal(child.exitCode, 0);
  });
});

test('request timeout is followed by management abort/drain and confirmed exit', { timeout: 10000 }, async () => {
  await withWorker('drain', async ({ rpc, root, child }) => {
    await assert.rejects(rpc.request('pending', {}, 20), /timed out/);
    await rpc.stopManagement();
    assert.equal(child.exitCode, 0);
    assert.equal(await readFile(join(root, 'drained'), 'utf8'), 'yes');
    await assert.rejects(readFile(join(root, 'committed')), { code: 'ENOENT' });
  });
});

for (const scenario of ['linger', 'bad-ack', 'negative', 'protocol']) {
  test(`management ${scenario} rejects and retains a disconnected owner`, { timeout: 10000 }, async () => {
    await withWorker(scenario, async ({ rpc, child, root }) => {
      await assert.rejects(rpc.stopManagement(100), error => {
        assert.ok(error instanceof RpcManagementStopError);
        assert.equal(error.code, 'management-stop-unconfirmed');
        assert.equal(error.shutdownAcknowledged, scenario === 'linger');
        assert.equal(error.exitConfirmed, false);
        return true;
      });
      assert.equal(rpc.pid, child.pid);
      assert.equal(child.exitCode, null);
      await assert.rejects(rpc.request('ready'), /not connected/);
      assert.throws(() => rpc.start(process.execPath, 'unused', root, {}), /already started/);
    });
  });
}

for (const scenario of ['wrong-id', 'no-ack', 'nonzero']) {
  test(`management ${scenario} cannot count as a confirmed clean shutdown`, { timeout: 10000 }, async () => {
    await withWorker(scenario, async ({ rpc, root }) => {
      await assert.rejects(rpc.stopManagement(), error => {
        assert.ok(error instanceof RpcManagementStopError);
        assert.equal(error.shutdownAcknowledged, scenario === 'nonzero');
        assert.equal(error.exitConfirmed, true);
        return true;
      });
      await assert.rejects(rpc.stopManagement(), RpcManagementStopError);
      assert.throws(() => rpc.start(process.execPath, 'unused', root, {}), /already started/);
    });
  });
}

test('invalid management deadline does not disconnect a live worker', { timeout: 10000 }, async () => {
  await withWorker('delayed', async ({ rpc }) => {
    await assert.rejects(rpc.stopManagement(0), RangeError);
    await rpc.request('ready');
    await rpc.stopManagement();
  });
});

test('a worker that exited before stop is not mistaken for acknowledged cleanup', { timeout: 10000 }, async () => {
  await withWorker('delayed', async ({ rpc, child }) => {
    const closed = once(child, 'close');
    await rpc.request('exit-now');
    await bounded(closed);
    assert.equal(rpc.pid, undefined);
    await assert.rejects(rpc.stopManagement(), error => {
      assert.ok(error instanceof RpcManagementStopError);
      assert.equal(error.shutdownAcknowledged, false);
      assert.equal(error.exitConfirmed, true);
      return true;
    });
  });
});

test('ordinary Windows stop still rejects a failed tree helper', {
  skip: process.platform !== 'win32', timeout: 10000,
}, async () => {
  await withWorker('delayed', async ({ rpc, root }) => {
    await copyFile(join(process.env.SystemRoot!, 'System32/where.exe'), join(root, 'taskkill.exe'));
    const previous = process.env.PATH;
    try {
      process.env.PATH = root;
      await assert.rejects(rpc.stop(), /process-tree termination failed/);
      assert.ok(rpc.pid);
      await assert.rejects(rpc.request('ready'), /not connected/);
    } finally { process.env.PATH = previous; }
  });
});

test('actual admin shutdown preserves initialize, aborts active work and rejects queued work', { timeout: 10000 }, async () => {
  const admin = await readFile(new URL('../electron/capability-admin.mjs', import.meta.url), 'utf8');
  await withWorker('admin', async ({ rpc, root, child }) => {
    assert.deepEqual(await rpc.request('initialize'), { initialized: true });
    await assert.rejects(rpc.request('mutate', { input: {} }, 30), /timed out/);
    const queued = assert.rejects(rpc.request('import', { path: 'must-not-run' }), /Runtime stopped/);
    await Promise.all([rpc.stopManagement(), queued]);
    assert.equal(child.exitCode, 0);
    assert.equal(await readFile(join(root, 'drained'), 'utf8'), 'yes');
    await assert.rejects(readFile(join(root, 'imported')), { code: 'ENOENT' });
  }, admin, async root => {
    await mkdir(join(root, 'step/dist/bundle'), { recursive: true });
    await writeFile(join(root, 'step/dist/bundle/index.js'), 'module.exports = {};');
    await writeFile(join(root, 'capability-failure.mjs'),
      'export const capabilityFailureCode = () => "operation-denied"; export const capabilityFailureDetails = () => undefined;');
    await writeFile(join(root, 'marketplace-refresh.mjs'), 'export const refreshGitMarketplace = () => {};');
    await writeFile(join(root, 'capability-settings.mjs'), `
import { writeFile } from 'node:fs/promises';
export class CapabilityError extends Error {}
export function createCapabilitySettings() {
  return {
    catalog: async () => ({}),
    initialize: async () => ({ initialized: true }),
    async mutate(_input, signal) {
      try {
        await new Promise((_, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason), { once: true });
          signal.throwIfAborted();
        });
      } finally {
        await new Promise(resolve => setTimeout(resolve, 30));
        await writeFile('drained', 'yes');
      }
    },
    async importSkill() { await writeFile('imported', 'yes'); },
  };
}
`);
  });
});

test('actual admin transports only sanitized Git details into main-process diagnostics', { timeout: 10000 }, async () => {
  const admin = await readFile(new URL('../electron/capability-admin.mjs', import.meta.url), 'utf8');
  await withWorker('admin', async ({ rpc }) => {
    const records: unknown[] = [];
    await assert.rejects(diagnoseCapabilityMutation('capabilityMutate', { action: 'marketplace-update' }, async mark => {
      mark('mutation');
      try { return await rpc.request('mutate', { input: {} }); }
      catch (error) {
        assert.ok(error instanceof RpcCommandError);
        assert.doesNotMatch(JSON.stringify(error) + error.message, /private-fixture-path|stderr|fatal/);
        throw error;
      }
    }, async (error, details) => { records.push({ message: error.message, ...details }); }),
    /capability:marketplace-failed; diagnostic:[a-f0-9]{12}/);
    const record = records[0] as Record<string, unknown>;
    assert.equal(record.gitExitCode, 128);
    assert.ok(typeof record.elapsedMs === 'number' && record.elapsedMs >= 0);
    assert.equal(record.operation, 'marketplace-refresh');
    assert.equal(record.operationPhase, 'mutation');
    assert.doesNotMatch(JSON.stringify(records), /private-fixture-path|stderr|fatal/);
    await rpc.stopManagement();
  }, admin, async root => {
    await mkdir(join(root, 'step/dist/bundle'), { recursive: true });
    await writeFile(join(root, 'step/dist/bundle/index.js'), 'module.exports = {};');
    for (const name of ['capability-failure.mjs', 'marketplace-refresh.mjs'])
      await copyFile(new URL(`../electron/${name}`, import.meta.url), join(root, name));
    await writeFile(join(root, 'capability-settings.mjs'), `
export class CapabilityError extends Error {}
export function createCapabilitySettings(_upstream, options) {
  return { catalog: async () => ({}),
    mutate: (_input, signal) => options.refreshMarketplace('private-fixture-path', signal) };
}
`);
  });
});
