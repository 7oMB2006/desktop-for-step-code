import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { TerminalSessions } from '../electron/terminal-sessions';

// Exercise the shipped PTY host and native addon rather than a simulated host.
test('macOS zsh terminal reads and writes Unicode in a spaced directory and closes its host', { skip: process.platform !== 'darwin' }, async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'desktop-macos-terminal-')));
  const cwd = join(root, '中文 project');
  await mkdir(cwd);
  let output = '';
  const resources = process.env.DESKTOP_MACOS_RESOURCES ?? resolve('.');
  const terminals = new TerminalSessions(join(resources, 'runtime/node/node'), join(resources, 'terminal-runtime/host.cjs'), event => {
    if (event.type === 'data') output += event.data;
  });
  try {
    const terminal = await terminals.create(cwd);
    assert.match(terminal.title, /^zsh /);
    terminals.write(terminal.id, "printf '\\u9636\\u8dc3-macOS-%s\\n' \"$PWD\"\r");
    const start = Date.now();
    while (!output.includes(`阶跃-macOS-${cwd}`)) {
      if (Date.now() - start > 10000) throw new Error('Native zsh output was not received');
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    terminals.resize(terminal.id, 100, 32);
    await terminals.close(terminal.id);
    assert.deepEqual(terminals.list(), []);
  } finally {
    await terminals.stopAll();
    await rm(root, { recursive: true, force: true });
  }
});
