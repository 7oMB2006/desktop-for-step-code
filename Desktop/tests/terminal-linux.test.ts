import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { join, resolve } from 'node:path';
import { TerminalSessions } from '../electron/terminal-sessions';
import { terminateLinuxProcessTree } from '../electron/runtime';

const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
const stopped = async (pid: number) => {
  try {
    const stat = await readFile(`/proc/${pid}/stat`, 'utf8');
    return ['Z', 'X'].includes(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[0]);
  } catch (error: any) { if (error.code === 'ENOENT' || error.code === 'ESRCH') return true; throw error; }
};

for (const disconnect of [false, true]) {
  test(`real Linux PTY cleans shell and foreground/background jobs on ${disconnect ? 'parent disconnect' : 'close'}`,
    { skip: process.platform !== 'linux', timeout: 15000 }, async () => {
      const cwd = await mkdtemp(join(tmpdir(), 'terminal-linux-'));
      const fixture = join(cwd, 'job.cjs'); const pidFile = join(cwd, 'pids');
      await writeFile(fixture, `process.on('SIGTERM', () => {}); process.on('SIGHUP', () => {});
        require('node:fs').appendFileSync(process.argv[2], process.pid + '\\n');
        if (process.argv[3] === 'fork-detached') {
          require('node:child_process').spawn(process.execPath, [__filename, process.argv[2]], { detached: true, stdio: 'ignore' }).unref();
        }
        setInterval(() => {}, 1000);`);
      const unrelated = spawn(process.execPath, [fixture, join(cwd, 'unrelated')], { cwd, detached: true, stdio: 'ignore' });
      const sessions = new TerminalSessions(process.execPath, resolve('terminal-runtime/host.cjs'), () => {},
        disconnect ? child => new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error('PTY host did not exit after disconnect')), 5000);
          child.once('exit', () => { clearTimeout(timer); resolve(); });
          child.disconnect();
        }) : undefined);
      let pids: number[] = [];
      try {
        const terminal = await sessions.create(cwd);
        assert.equal(terminal.status, 'running');
        assert.match(terminal.title, /^(Bash|Shell) 1$/);
        const command = `${quote(process.execPath)} ${quote(fixture)} ${quote(pidFile)}`;
        sessions.write(terminal.id, `printf '%s\\n' $$ > ${quote(pidFile)}; ${command} & ${command} fork-detached\r`);
        const deadline = Date.now() + 5000;
        while (Date.now() < deadline) {
          pids = (await readFile(pidFile, 'utf8').catch(() => '')).trim().split(/\s+/).filter(Boolean).map(Number);
          if (pids.length === 4) break;
          await new Promise(resolve => setTimeout(resolve, 25));
        }
        assert.equal(pids.length, 4, 'the actual PTY shell ran foreground, background and detached-session descendant jobs');
        assert.deepEqual(await Promise.all(pids.map(stopped)), [false, false, false, false]);
        const processInfo = await Promise.all(pids.map(async pid => {
          const stat = await readFile(`/proc/${pid}/stat`, 'utf8');
          const fields = stat.slice(stat.lastIndexOf(')') + 2).trim().split(/\s+/);
          return { pid, parent: Number(fields[1]), session: Number(fields[3]) };
        }));
        const detached = processInfo.filter(info => info.session !== pids[0]);
        assert.equal(detached.length, 1, 'one real descendant called setsid through detached spawn');
        assert.equal(pids.includes(detached[0].parent), true, 'the separate-session job is still a descendant');
        await sessions.close(terminal.id);
        assert.equal(sessions.list().length, 0);
        assert.deepEqual(await Promise.all(pids.map(stopped)), [true, true, true, true]);
        assert.equal(await stopped(unrelated.pid!), false, 'another session in the same directory is untouched');
      } finally {
        await sessions.stopAll().catch(() => {});
        for (const pid of pids) if (!(await stopped(pid))) await terminateLinuxProcessTree(pid, 10);
        if (unrelated.pid) await terminateLinuxProcessTree(unrelated.pid, 10);
        await rm(cwd, { recursive: true, force: true });
      }
    });
}

for (const closeDuringCleanup of [false, true]) {
  test(`natural Linux shell exit cleans resistant orphan jobs${closeDuringCleanup ? ' even when Close interrupts cleanup' : ''}`,
    { skip: process.platform !== 'linux', timeout: 15000 }, async () => {
      const cwd = await mkdtemp(join(tmpdir(), 'terminal-natural-exit-'));
      const fixture = join(cwd, 'job.cjs'); const pidFile = join(cwd, 'pids');
      await writeFile(fixture, `process.on('SIGTERM', () => {}); process.on('SIGHUP', () => {});
        require('node:fs').appendFileSync(process.argv[2], process.pid + '\\n'); setInterval(() => {}, 1000);`);
      const unrelated = spawn(process.execPath, [fixture, join(cwd, 'unrelated')], { cwd, detached: true, stdio: 'ignore' });
      const sessions = new TerminalSessions(process.execPath, resolve('terminal-runtime/host.cjs'), () => {});
      let pids: number[] = [];
      const waitFor = async (predicate: () => Promise<boolean>) => {
        const deadline = Date.now() + 6000;
        while (!(await predicate())) {
          if (Date.now() >= deadline) throw new Error('Natural-exit fixture timed out');
          await new Promise(resolve => setTimeout(resolve, 20));
        }
      };
      try {
        const terminal = await sessions.create(cwd);
        sessions.write(terminal.id, `printf '%s\\n' $$ > ${quote(pidFile)}; ${quote(process.execPath)} ${quote(fixture)} ${quote(pidFile)} &\r`);
        await waitFor(async () => {
          pids = (await readFile(pidFile, 'utf8').catch(() => '')).trim().split(/\s+/).filter(Boolean).map(Number);
          return pids.length === 2;
        });
        assert.deepEqual(await Promise.all(pids.map(stopped)), [false, false]);
        sessions.write(terminal.id, 'exit\r');
        await waitFor(() => stopped(pids[0]));
        assert.equal(await stopped(pids[1]), false, 'the reparented background job resists HUP and TERM');
        if (closeDuringCleanup) await sessions.close(terminal.id);
        else {
          await waitFor(async () => sessions.list()[0]?.status === 'exited');
          assert.equal(await stopped(pids[1]), true, 'natural exit is reported only after session cleanup');
        }
        await sessions.stopAll();
        assert.deepEqual(await Promise.all(pids.map(stopped)), [true, true]);
        assert.equal(await stopped(unrelated.pid!), false, 'a different session in the same directory remains untouched');
      } finally {
        await sessions.stopAll().catch(() => {});
        for (const pid of pids) if (!(await stopped(pid))) await terminateLinuxProcessTree(pid, 10);
        if (unrelated.pid) await terminateLinuxProcessTree(unrelated.pid, 10);
        await rm(cwd, { recursive: true, force: true });
      }
    });
}
