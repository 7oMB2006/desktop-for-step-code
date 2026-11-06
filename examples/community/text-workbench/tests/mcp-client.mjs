import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { dirname, join } from 'node:path';
import { once } from 'node:events';

export function startMcp(directory) {
  const env = { ...process.env };
  for (const key of Object.keys(env))
    if (/key|token|secret|password|authorization|cookie|^STEP|^OPENAI|^ANTHROPIC|^AZURE/iu.test(key)) delete env[key];
  env.STEPFUN_API_KEY = 'DFSC_INDEPENDENT_PLUGIN';
  const child = spawn(process.execPath, [join(directory, 'server/stdio.mjs')], {
    // Do not let the test client's cwd lock the package during Windows uninstall.
    cwd: dirname(directory), env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
  });
  let next = 0, stderr = '';
  const pending = new Map();
  const stopped = once(child, 'exit');
  function rejectAll(error) {
    for (const waiter of pending.values()) { clearTimeout(waiter.timer); waiter.reject(error); }
    pending.clear();
  }
  child.on('error', error => rejectAll(error));
  child.on('exit', () => rejectAll(new Error('MCP process exited.')));
  child.stderr.on('data', bytes => { stderr = `${stderr}${bytes}`.slice(-4096); });
  createInterface({ input: child.stdout }).on('line', line => {
    let reply;
    try { reply = JSON.parse(line); }
    catch { rejectAll(new Error('Non-protocol stdout.')); return; }
    const waiter = pending.get(reply.id);
    if (!waiter) return;
    pending.delete(reply.id); clearTimeout(waiter.timer);
    waiter.resolve(reply);
  });
  return {
    stderr: () => stderr,
    request(method, params) {
      const id = ++next;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { pending.delete(id); reject(new Error(`MCP timeout: ${method}`)); }, 15000);
        pending.set(id, { resolve, reject, timer });
        child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
      });
    },
    notify(method) { child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method })}\n`); },
    async close() {
      child.stdin.end();
      const timer = setTimeout(() => child.kill(), 2500);
      try { await stopped; }
      finally { clearTimeout(timer); rejectAll(new Error('MCP client closed.')); }
    },
  };
}
