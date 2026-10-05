import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { TerminalSessions } from '../electron/terminal-sessions';
import type { TerminalEvent } from '../src/contracts';

const waitFor = async (predicate: () => boolean) => {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > 5000) throw new Error('Terminal fixture timed out');
    await new Promise(resolve => setTimeout(resolve, 20));
  }
};
test('terminal sessions scope, replay bounds, exit, and cleanup', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'terminal-sessions-'));
  const events: TerminalEvent[] = [];
  const sessions = new TerminalSessions(process.execPath, resolve('tests/fixtures/terminal-host.cjs'), event => events.push(event));
  try {
    const terminal = await sessions.create(cwd);
    assert.equal(terminal.status, 'running');
    assert.equal(sessions.list(cwd).length, 1);
    assert.equal(sessions.list(join(cwd, 'other')).length, 0);
    assert.throws(() => sessions.write('missing', 'hello'), /Unknown terminal/);
    assert.throws(() => sessions.ack(terminal.id, 1), /acknowledgement/);
    sessions.write(terminal.id, 'output');
    await waitFor(() => sessions.list(cwd)[0].chunks.at(-1)?.seq === 5);
    assert.equal(sessions.list(cwd)[0].chunks.length, 4);
    sessions.ack(terminal.id, 5);
    sessions.resize(terminal.id, 120, 40);
    assert.equal(sessions.list(cwd)[0].cols, 120);
    sessions.write(terminal.id, 'exit');
    await waitFor(() => sessions.list(cwd)[0].status === 'exited');
    assert.equal(sessions.list(cwd)[0].exitCode, 7);
    assert.throws(() => sessions.write(terminal.id, 'hello'), /not running/);
    await sessions.close(terminal.id);
    assert.equal(sessions.list(cwd).length, 0);
    assert.ok(events.some(event => event.type === 'closed' && event.id === terminal.id));
    await sessions.stopAll();
    await assert.rejects(sessions.create(cwd), /shutting down/);
  } finally { await sessions.stopAll(); await rm(cwd, { recursive: true, force: true }); }
});
test('closing a starting terminal settles creation rather than leaving it pending', async () => {
  const root = await mkdtemp(join(tmpdir(), 'terminal-start-'));
  const cwd = join(root, 'delayed'); await mkdir(cwd);
  let id = '';
  const sessions = new TerminalSessions(process.execPath, resolve('tests/fixtures/terminal-host.cjs'),
    event => { if (event.type === 'state') id = event.terminal.id; });
  try {
    const creation = sessions.create(cwd);
    const rejected = assert.rejects(creation, /closed/);
    await sessions.close(id);
    await rejected;
    assert.equal(sessions.list(cwd).length, 0);
  } finally { await sessions.stopAll(); await rm(root, { recursive: true, force: true }); }
});
test('terminal count is bounded per directory and failures do not cross directories', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'terminal-count-'));
  const other = join(cwd, 'other'); await mkdir(other);
  const sessions = new TerminalSessions(process.execPath, resolve('tests/fixtures/terminal-host.cjs'), () => {});
  try {
    await Promise.all(Array.from({ length: 8 }, () => sessions.create(cwd)));
    await assert.rejects(sessions.create(cwd), /limit/);
    await sessions.create(other);
    assert.equal(sessions.list(other).length, 1);
    assert.equal(sessions.list(cwd).length, 8);
  } finally { await sessions.stopAll(); await rm(cwd, { recursive: true, force: true }); }
});
