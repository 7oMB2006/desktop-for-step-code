import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { runInNewContext } from 'node:vm';
import test from 'node:test';

const { closeDesktopFixture, closeDesktopFixtureAndWait, releaseExitedFixturePipes, releaseExitedFixtureInspector } = await import(new URL('../scripts/close-desktop-fixture.mjs', import.meta.url).href);

test('launcher exit cannot complete shutdown before the driver close settles', async () => {
  const { child, page, context, dispose } = fixture();
  dispose();
  let release!: () => void;
  const driverClose = new Promise<void>(resolve => { release = resolve; });
  let settled = false;
  const closing = closeDesktopFixtureAndWait({ process: () => child, windows: () => [page], context: () => context,
    close: async () => { child.exitCode = 0; child.emit('exit', 0); await driverClose; page.closed = true; page.emit('close'); context.emit('close'); } }, 1000)
    .then(() => { settled = true; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(settled, false, 'a successful launcher exit does not abandon the controller close promise');
  release();
  await closing;
  assert.equal(settled, true);
  assert.equal(child.listenerCount('exit'), 0);
  assert.equal(page.listenerCount('close'), 0);
  assert.equal(context.listenerCount('close'), 0);
});

test('driver close errors remain failures even after a successful launcher exit', async () => {
  const child = Object.assign(new EventEmitter(), { exitCode: null as number | null });
  await assert.rejects(closeDesktopFixtureAndWait({ process: () => child, windows: () => [], context: () => new EventEmitter(),
    close: async () => { child.exitCode = 0; child.emit('exit', 0); throw new Error('Driver close failed'); } }, 1000), /Driver close failed/);
  assert.equal(child.listenerCount('exit'), 0);
});

test('driver closure alone cannot complete shutdown before the launcher exits', async () => {
  const child = Object.assign(new EventEmitter(), { exitCode: null as number | null });
  const context = new EventEmitter();
  let settled = false;
  const closing = closeDesktopFixtureAndWait({ process: () => child, windows: () => [], context: () => context,
    close: async () => { context.emit('close'); } }, 1000)
    .then(() => { settled = true; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(settled, false);
  child.exitCode = 0; child.emit('exit', 0);
  await closing;
  assert.equal(child.listenerCount('exit'), 0);
});

test('a stalled driver close keeps the bounded shutdown failure', async () => {
  const child = Object.assign(new EventEmitter(), { exitCode: null as number | null });
  let release!: () => void;
  const stalled = new Promise<void>(resolve => { release = resolve; });
  await assert.rejects(closeDesktopFixtureAndWait({ process: () => child, windows: () => [], context: () => new EventEmitter(), close: () => stalled }, 20), /shutdown timed out/);
  assert.equal(child.listenerCount('exit'), 1, 'only the in-flight close helper pipe guard remains, not the wait listener');
  release();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(child.listenerCount('exit'), 0);
});

test('orderly fixture shutdown answers existing and changed quit reviews without forcing application exit', async () => {
  const replies: [string, boolean][] = [];
  let onEvent: (event: unknown) => void = () => {};
  const desktop = {
    onEvent: (listener: typeof onEvent) => { onEvent = listener; },
    snapshot: async () => ({ quitReview: { request: { id: 'initial', phase: 'review' } } }),
    quitRespond: async (id: string, approved: boolean) => {
      replies.push([id, approved]);
      if (id === 'initial') throw new Error('Quit confirmation changed');
    },
  };
  const page = Object.assign(new EventEmitter(), {
    isClosed: () => false,
    evaluate: async (callback: () => void) => runInNewContext(`(${callback.toString()})()`, { window: { desktop } }),
  });
  let closed = false;
  const child = new EventEmitter();
  await closeDesktopFixture({
    process: () => child,
    windows: () => [page],
    context: () => new EventEmitter(),
    close: async () => {
      onEvent({ type: 'unrelated', state: { request: { id: 'ignored', phase: 'review' } } });
      onEvent({ type: 'desktop_quit_review', state: { request: { id: 'waiting', phase: 'closing' } } });
      onEvent({ type: 'desktop_quit_review', state: { request: { id: 'updated', phase: 'review' } } });
      await new Promise(resolve => setImmediate(resolve));
      assert.deepEqual(replies, [['initial', true], ['updated', true]]);
      closed = true;
    },
  });
  assert.equal(closed, true);
  assert.equal(child.listenerCount('exit'), 0);
});

test('bounded shutdown completes while a failed acceptance leaves an approval pending', async () => {
  const child = Object.assign(new EventEmitter(), { exitCode: null as number | null });
  const context = new EventEmitter();
  let onEvent: (event: unknown) => void = () => {};
  let acceptQuit!: () => void;
  const reviewed = new Promise<void>(resolve => { acceptQuit = resolve; });
  const desktop = {
    onEvent: (listener: typeof onEvent) => { onEvent = listener; },
    snapshot: async () => ({ requests: [{ id: 'pending-tool', method: 'confirm' }] }),
    quitRespond: async (id: string, approved: boolean) => {
      assert.equal(id, 'quit-with-pending-approval');
      assert.equal(approved, true);
      acceptQuit();
    },
  };
  const page = Object.assign(new EventEmitter(), {
    closed: false, isClosed() { return this.closed; },
    evaluate: async (callback: () => void) => runInNewContext(`(${callback.toString()})()`, { window: { desktop } }),
  });
  await closeDesktopFixtureAndWait({
    process: () => child, windows: () => [page], context: () => context,
    close: async () => {
      onEvent({ type: 'desktop_quit_review', state: { request: { id: 'quit-with-pending-approval', phase: 'review' } } });
      await reviewed;
      child.exitCode = 0; child.emit('exit', 0);
      page.closed = true; page.emit('close'); context.emit('close');
    },
  }, 1000);
  assert.equal(child.listenerCount('exit'), 0);
  assert.equal(page.listenerCount('close'), 0);
  assert.equal(context.listenerCount('close'), 0);
});

test('orderly fixture shutdown releases inherited pipes only after successful exit and closed pages', async () => {
  const { child, page, context, dispose } = fixture();
  dispose();
  await closeDesktopFixture({
    process: () => child,
    windows: () => [page],
    context: () => context,
    close: async () => {
      child.exitCode = 0;
      child.emit('exit', 0);
      assert.equal(child.stdout.destroyed, false);
      page.closed = true;
      page.emit('close');
      assert.equal(child.stdout.destroyed, false, 'pipe disposal must not interrupt close event delivery');
      await new Promise(resolve => setImmediate(resolve));
      assert.ok(child.stdio.every(pipe => pipe === null || pipe.destroyed));
    },
  });
  assert.equal(child.listenerCount('exit'), 0);
  assert.equal(page.listenerCount('close'), 0);
});

test('failed fixture shutdown removes pipe guards without hiding the error', async () => {
  const { child, page, context, dispose } = fixture();
  dispose();
  await assert.rejects(closeDesktopFixture({
    process: () => child,
    windows: () => [page],
    context: () => context,
    close: async () => { throw new Error('Fixture failed to close'); },
  }), /Fixture failed to close/);
  assert.equal(child.listenerCount('exit'), 0);
  assert.equal(page.listenerCount('close'), 0);
  assert.equal(child.stdout.destroyed, false);
});

function fixture() {
  const pipes = Array.from({ length: 4 }, () => new PassThrough());
  const child = Object.assign(new EventEmitter(), {
    exitCode: null as number | null, stdout: pipes[0], stderr: pipes[1], stdio: [null, ...pipes],
  });
  const page = Object.assign(new EventEmitter(), {
    closed: false, isClosed() { return this.closed; }, evaluate: async () => {},
  });
  const context = new EventEmitter();
  const app = { process: () => child, windows: () => [page], context: () => context };
  const dispose = releaseExitedFixturePipes(app);
  return { child, page, context, dispose };
}

test('fixture pipe release waits for a successful process exit and every page to close', async () => {
  const { child, page, context, dispose } = fixture();
  try {
    child.exitCode = 0;
    child.emit('exit', 0);
    assert.equal(child.stdout.destroyed, false);
    assert.equal(child.stderr.destroyed, false);
    page.closed = true;
    page.emit('close');
    assert.equal(child.stdout.destroyed, false);
    context.emit('close');
    await new Promise(resolve => setImmediate(resolve));
    assert.ok(child.stdio.every(pipe => pipe === null || pipe.destroyed), 'extra Playwright pipes must also close');
  } finally { dispose(); }
});

test('context closure can wait for inherited launcher pipes without deadlocking shutdown', async () => {
  const { child, page, context, dispose } = fixture();
  dispose();
  Object.assign(context, { isClosed: () => true });
  const pipesClosed = Promise.all(child.stdio.filter(pipe => pipe !== null).map(pipe =>
    new Promise<void>(resolve => pipe.once('close', resolve))));
  let driverClosed = false;
  await closeDesktopFixtureAndWait({
    process: () => child, windows: () => [page], context: () => context,
    close: async () => {
      child.exitCode = 0;
      child.emit('exit', 0);
      page.closed = true;
      page.emit('close');
      await pipesClosed;
      context.emit('close');
      driverClosed = true;
    },
  }, 1000);
  assert.equal(driverClosed, true);
  assert.ok(child.stdio.every(pipe => pipe === null || pipe.destroyed));
  assert.equal(context.listenerCount('close'), 0);
});

test('successful exit and driver completion cannot replace the actual context close event', async () => {
  const child = Object.assign(new EventEmitter(), { exitCode: null as number | null });
  const context = Object.assign(new EventEmitter(), { isClosed: () => true });
  await assert.rejects(closeDesktopFixtureAndWait({
    process: () => child, windows: () => [], context: () => context,
    close: async () => { child.exitCode = 0; child.emit('exit', 0); },
  }, 20), /shutdown timed out/);
  assert.equal(context.listenerCount('close'), 0);
  assert.equal(child.listenerCount('exit'), 0);
});

test('closed pages cannot release a live process pipe', async () => {
  const { child, page, context, dispose } = fixture();
  try {
    page.closed = true;
    page.emit('close');
    context.emit('close');
    assert.equal(child.stdout.destroyed, false);
    assert.equal(child.stderr.destroyed, false);
    assert.ok(child.stdio.every(pipe => pipe === null || !pipe.destroyed));
    child.exitCode = 0;
    child.emit('exit', 0);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(child.stdout.destroyed, true);
    assert.equal(child.stderr.destroyed, true);
  } finally { dispose(); }
});

test('failed process exit cannot be turned into graceful fixture success', () => {
  const { child, page, context, dispose } = fixture();
  try {
    page.closed = true;
    child.exitCode = 1;
    child.emit('exit', 1);
    page.emit('close');
    context.emit('close');
    assert.equal(child.stdout.destroyed, false);
    assert.equal(child.stderr.destroyed, false);
    assert.ok(child.stdio.every(pipe => pipe === null || !pipe.destroyed));
  } finally { dispose(); }
});

test('all application pages must close before any pipe is released', async () => {
  const child = Object.assign(new EventEmitter(), {
    exitCode: 0, stdout: new PassThrough(), stderr: new PassThrough(),
  });
  const pages = [true, false].map(closed => Object.assign(new EventEmitter(), { isClosed: () => closed }));
  const context = new EventEmitter();
  const dispose = releaseExitedFixturePipes({ process: () => child, windows: () => pages, context: () => context });
  try {
    context.emit('close');
    assert.equal(child.stdout.destroyed, false);
    pages[1].isClosed = () => true;
    pages[1].emit('close');
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(child.stdout.destroyed, true);
  } finally { dispose(); }
});

test('pipe disposal cannot overtake remaining page close listeners', async () => {
  const { child, page, context, dispose } = fixture();
  child.exitCode = 0;
  page.closed = true;
  let forwarded = false;
  page.on('close', () => {
    assert.equal(child.stdout.destroyed, false);
    assert.equal(child.stderr.destroyed, false);
    forwarded = true;
  });
  try {
    page.emit('close');
    assert.equal(forwarded, true);
    assert.equal(child.stdout.destroyed, false);
    await new Promise(resolve => setImmediate(resolve));
    assert.ok(child.stdio.every(pipe => pipe === null || pipe.destroyed));
  } finally { dispose(); }
});

test('disposing a scheduled pipe release leaves the driver pipes intact', async () => {
  const { child, page, context, dispose } = fixture();
  child.exitCode = 0;
  page.closed = true;
  child.emit('exit', 0);
  dispose();
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(child.stdio.every(pipe => pipe === null || !pipe.destroyed));
});

test('disposing the fixture guard removes process and page listeners', () => {
  const { child, page, context, dispose } = fixture();
  dispose();
  assert.equal(child.listenerCount('exit'), 0);
  assert.equal(page.listenerCount('close'), 0);
  assert.equal(context.listenerCount('close'), 0);
  child.exitCode = 0;
  page.closed = true;
  child.emit('exit', 0);
  page.emit('close');
  context.emit('close');
  assert.equal(child.stdout.destroyed, false);
});

test('inspector cleanup requires successful launcher exit, closed pages and a dead native process', async () => {
  const child = { exitCode: null as number | null };
  let pageClosed = false, nativeAlive = true;
  const socket = Object.assign(new PassThrough(), { remoteAddress: '127.0.0.1', remotePort: 34567 });
  const other = Object.assign(new PassThrough(), { remoteAddress: '127.0.0.1', remotePort: 34568 });
  const app = { process: () => child, windows: () => [{ isClosed: () => pageClosed }] };
  const dispose = releaseExitedFixtureInspector(app, { pid: 12345, debugPort: 34567 }, [socket, other],
    (pid: number) => { assert.equal(pid, 12345); return nativeAlive; });
  const tick = () => new Promise(resolve => setTimeout(resolve, 50));
  try {
    await tick();
    assert.equal(socket.destroyed, false);
    child.exitCode = 1; pageClosed = true; nativeAlive = false;
    await tick();
    assert.equal(socket.destroyed, false, 'a failed exit cannot be turned into a graceful close');
    child.exitCode = 0; pageClosed = false;
    await tick();
    assert.equal(socket.destroyed, false, 'an open page keeps its inspector');
    pageClosed = true; nativeAlive = true;
    await tick();
    assert.equal(socket.destroyed, false, 'a dead shell launcher does not prove native Electron exited');
    nativeAlive = false;
    await tick();
    assert.equal(socket.destroyed, true);
    assert.equal(other.destroyed, false, 'unrelated sockets remain untouched');
  } finally { dispose(); socket.destroy(); other.destroy(); }
});

test('inspector cleanup refuses ambiguous, external and invalid launch identities', async () => {
  const app = { process: () => ({ exitCode: 0 }), windows: () => [] };
  const sockets = [
    Object.assign(new PassThrough(), { remoteAddress: '127.0.0.1', remotePort: 34567 }),
    Object.assign(new PassThrough(), { remoteAddress: '127.0.0.1', remotePort: 34567 }),
    Object.assign(new PassThrough(), { remoteAddress: '192.0.2.1', remotePort: 34568 }),
  ];
  const disposers = [
    releaseExitedFixtureInspector(app, { pid: 12345, debugPort: 34567 }, sockets, () => false),
    releaseExitedFixtureInspector(app, { pid: 12345, debugPort: 34568 }, sockets, () => false),
    releaseExitedFixtureInspector(app, { pid: 0, debugPort: 34567 }, [sockets[0]], () => false),
    releaseExitedFixtureInspector(app, { pid: 12345, debugPort: 0 }, [sockets[0]], () => false),
  ];
  try {
    await new Promise(resolve => setTimeout(resolve, 50));
    assert.ok(sockets.every(socket => !socket.destroyed));
  } finally { for (const dispose of disposers) dispose(); for (const socket of sockets) socket.destroy(); }
});

test('disposing an inspector guard leaves its captured socket intact', async () => {
  const socket = Object.assign(new PassThrough(), { remoteAddress: '127.0.0.1', remotePort: 34567 });
  const dispose = releaseExitedFixtureInspector({ process: () => ({ exitCode: 0 }), windows: () => [] },
    { pid: 12345, debugPort: 34567 }, [socket], () => false);
  dispose();
  await new Promise(resolve => setTimeout(resolve, 50));
  assert.equal(socket.destroyed, false);
  socket.destroy();
});
