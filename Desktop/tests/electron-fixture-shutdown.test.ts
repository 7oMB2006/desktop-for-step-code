import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { runInNewContext } from 'node:vm';
import test from 'node:test';

const { closeDesktopFixture, closeDesktopFixtureAndWait, releaseExitedFixturePipes } = await import(new URL('../scripts/close-desktop-fixture.mjs', import.meta.url).href);

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
  let settled = false;
  const closing = closeDesktopFixtureAndWait({ process: () => child, windows: () => [], context: () => new EventEmitter(), close: async () => {} }, 1000)
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
      assert.equal(child.stdout.destroyed, false, 'closed pages cannot overtake the context close event');
      context.emit('close');
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

test('fixture pipe release waits for a successful process exit and every page to close', () => {
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
    assert.ok(child.stdio.every(pipe => pipe === null || pipe.destroyed), 'extra Playwright pipes must also close');
  } finally { dispose(); }
});

test('a context marked closing must deliver its close event before launcher pipes are released', () => {
  const { child, page, context, dispose } = fixture();
  Object.assign(context, { isClosed: () => true });
  try {
    child.exitCode = 0;
    page.closed = true;
    child.emit('exit', 0);
    page.emit('close');
    assert.ok(child.stdio.every(pipe => pipe === null || !pipe.destroyed));
    context.emit('close');
    assert.ok(child.stdio.every(pipe => pipe === null || pipe.destroyed));
  } finally { dispose(); }
  assert.equal(context.listenerCount('close'), 0);
});

test('closed pages cannot release a live process pipe', () => {
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

test('all application pages must close before any pipe is released', () => {
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
    assert.equal(child.stdout.destroyed, true);
  } finally { dispose(); }
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
