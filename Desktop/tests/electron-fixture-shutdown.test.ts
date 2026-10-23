import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import test from 'node:test';

const { releaseExitedFixturePipes } = await import(new URL('../scripts/close-desktop-fixture.mjs', import.meta.url).href);

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
