import { spawn, type IPty } from 'node-pty';

let pty: IPty | undefined;
let sequence = 0;
const pending = new Map<number, number>();
let outstanding = 0;
let paused = false;
const send = (message: unknown) => { if (process.connected) process.send?.(message); };
process.on('message', (message: any) => {
  try {
    if (message.type === 'start' && !pty) {
      const initialize = "if (Get-Module -ListAvailable PSReadLine) { Import-Module PSReadLine; Set-PSReadLineOption -HistorySaveStyle SaveNothing; if ((Get-Command Set-PSReadLineOption).Parameters.ContainsKey('PredictionSource')) { Set-PSReadLineOption -PredictionSource None } }";
      pty = spawn(message.shell, ['-NoLogo', '-NoProfile', '-NoExit', '-Command', initialize], {
        name: 'xterm-256color', cwd: message.cwd, env: process.env,
        cols: message.cols, rows: message.rows, useConpty: true,
      });
      send({ type: 'ready' });
      pty.onData(data => {
        const seq = ++sequence;
        const bytes = Buffer.byteLength(data);
        pending.set(seq, bytes); outstanding += bytes;
        send({ type: 'data', seq, data });
        if (outstanding >= 256 * 1024 && !paused) { paused = true; pty!.pause(); }
      });
      pty.onExit(({ exitCode }) => { send({ type: 'exit', exitCode }); process.exitCode = 0; process.disconnect(); });
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
process.on('disconnect', () => { try { pty?.kill(); } catch {} process.exit(0); });
