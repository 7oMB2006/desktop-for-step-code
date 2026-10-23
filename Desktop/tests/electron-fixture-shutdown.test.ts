import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { runInNewContext } from 'node:vm';
import test from 'node:test';

const { closeDesktopFixture, releaseExitedFixturePipes } = await import(new URL('../scripts/close-desktop-fixture.mjs', import.meta.url).href);

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
  const page = {
    evaluate: async (callback: () => void) => runInNewContext(`(${callback.toString()})()`, { window: { desktop } }),
  };
  let closed = false;
  await closeDesktopFixture({
    windows: () => [page],
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
});

function fixture() {
  const pipes = Array.from({ length: 4 }, () => new PassThrough());
  const child = Object.assign(new EventEmitter(), {
    exitCode: null as number | null, stdout: pipes[0], stderr: pipes[1], stdio: [null, ...pipes],
  });
  const page = Object.assign(new EventEmitter(), { closed: false, isClosed() { return this.closed; } });
  const app = { process: () => child, windows: () => [page] };
  const dispose = releaseExitedFixturePipes(app);
  return { child, page, dispose };
}

test('fixture pipe release waits for a successful process exit and every page to close', () => {
  const { child, page, dispose } = fixture();
  try {
    child.exitCode = 0;
    child.emit('exit', 0);
    assert.equal(child.stdout.destroyed, false);
    assert.equal(child.stderr.destroyed, false);
    page.closed = true;
    page.emit('close');
    assert.ok(child.stdio.every(pipe => pipe === null || pipe.destroyed), 'extra Playwright pipes must also close');
  } finally { dispose(); }
});

test('closed pages cannot release a live process pipe', () => {
  const { child, page, dispose } = fixture();
  try {
    page.closed = true;
    page.emit('close');
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
  const { child, page, dispose } = fixture();
  try {
    page.closed = true;
    child.exitCode = 1;
    child.emit('exit', 1);
    page.emit('close');
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
  const dispose = releaseExitedFixturePipes({ process: () => child, windows: () => pages });
  try {
    assert.equal(child.stdout.destroyed, false);
    pages[1].isClosed = () => true;
    pages[1].emit('close');
    assert.equal(child.stdout.destroyed, true);
  } finally { dispose(); }
});

test('disposing the fixture guard removes process and page listeners', () => {
  const { child, page, dispose } = fixture();
  dispose();
  assert.equal(child.listenerCount('exit'), 0);
  assert.equal(page.listenerCount('close'), 0);
  child.exitCode = 0;
  page.closed = true;
  child.emit('exit', 0);
  page.emit('close');
  assert.equal(child.stdout.destroyed, false);
});
