import { spawn, type IPty } from 'node-pty';
import { captureLinuxProcessSession, terminateLinuxProcessSession, terminateLinuxProcessTree, type LinuxProcessSession } from './runtime';

let pty: IPty | undefined;
let sequence = 0;
const pending = new Map<number, number>();
let outstanding = 0;
let paused = false;
let shellExited = false;
let linuxSession: Promise<LinuxProcessSession> | undefined;
let cleanup: Promise<void> | undefined;
const send = (message: unknown) => { if (process.connected) process.send?.(message); };
const stop = () => cleanup ??= (async () => {
  if (process.platform === 'linux' && pty) {
    const identity = await linuxSession?.catch(() => undefined);
    // Live descendants may own separate sessions (setsid). Preserve tree
    // cleanup first, then collect jobs reparented after the shell exited.
    const treeStopped = await terminateLinuxProcessTree(pty.pid, 1500, identity?.started);
    const sessionStopped = identity ? await terminateLinuxProcessSession(identity) : true;
    if (!treeStopped || !sessionStopped) throw new Error('Could not stop terminal jobs');
  } else { try { pty?.kill(); } catch {} }
})();
process.on('message', (message: any) => {
  try {
    if (message.type === 'start' && !pty) {
      pty = spawn(message.shell, message.args, {
        name: 'xterm-256color', cwd: message.cwd,
        env: process.platform === 'win32' ? process.env : { ...process.env, HISTFILE: '/dev/null', HISTSIZE: '0', HISTFILESIZE: '0' },
        cols: message.cols, rows: message.rows, ...(process.platform === 'win32' ? { useConpty: true } : {}),
      });
      if (process.platform === 'linux') linuxSession = captureLinuxProcessSession(pty.pid);
      pty.onData(data => {
        const seq = ++sequence;
        const bytes = Buffer.byteLength(data);
        pending.set(seq, bytes); outstanding += bytes;
        send({ type: 'data', seq, data });
        if (outstanding >= 256 * 1024 && !paused) { paused = true; pty!.pause(); }
      });
      pty.onExit(({ exitCode }) => {
        shellExited = true;
        const finished = () => { send({ type: 'exit', exitCode }); process.exitCode = 0; if (process.connected) process.disconnect(); };
        // Bash may have exited while HUP-resistant jobs remain in its session.
        // Do not report a successful natural exit before those jobs are gone.
        if (process.platform === 'linux') void stop().then(finished, () => {
          send({ type: 'failed' }); if (process.connected) process.disconnect();
        });
        else finished();
      });
      if (linuxSession) void linuxSession.then(identity => {
        if (!shellExited) send({ type: 'ready', linuxSession: identity });
      }, () => { send({ type: 'failed' }); if (process.connected) process.disconnect(); });
      else send({ type: 'ready' });
    } else if (message.type === 'write') pty?.write(message.data);
    else if (message.type === 'resize') pty?.resize(message.cols, message.rows);
    else if (message.type === 'ack') {
      for (const [seq, bytes] of pending) {
        if (seq > message.seq) break;
        outstanding -= bytes; pending.delete(seq);
      }
      if (paused && outstanding <= 64 * 1024) { paused = false; pty?.resume(); }
    }
  } catch {
    send({ type: 'failed' });
    pty?.kill();
    process.disconnect();
  }
});
process.on('disconnect', () => {
  // Also clean up if the main process exits unexpectedly. Session ownership
  // survives the shell PID being reaped and background jobs becoming orphans.
  void stop().then(() => process.exit(0), () => process.exit(1));
});
