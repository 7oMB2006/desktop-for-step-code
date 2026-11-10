import { spawn } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

// Test-only MCP proxy: native discovery performs the real SDK handshake. Tests
// then call that same SDK process without using a paid model to request a tool.
const launch = JSON.parse(process.env.DFSC_LAUNCH_CONTEXT);
if (process.env.DFSC_TEST_RETAIN_LAUNCH === '1')
  await writeFile(join(launch.dataDirectory, 'test-launch.json'), JSON.stringify(launch));
const child = spawn(process.execPath, [process.argv[2]], { stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true });
const pending = new Map();
let seen = 0, reading = false;
process.stdin.pipe(child.stdin);
const lines = createInterface({ input: child.stdout });
lines.on('line', line => {
  let message;
  try { message = JSON.parse(line); } catch { process.exitCode = 1; return; }
  const sequence = pending.get(message.id);
  if (sequence !== undefined) {
    pending.delete(message.id);
    void writeFile(join(launch.dataDirectory, `result-${sequence}.json`), JSON.stringify(message.result));
  } else process.stdout.write(`${line}\n`);
});
const timer = setInterval(async () => {
  if (reading) return;
  reading = true;
  try {
    const command = JSON.parse(await readFile(join(launch.dataDirectory, 'command.json'), 'utf8'));
    if (command.sequence <= seen) return;
    seen = command.sequence;
    if (command.cancelSequence !== undefined) {
      const id = [...pending].find(([, sequence]) => sequence === command.cancelSequence)?.[0];
      if (id) {
        child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/cancelled',
          params: { requestId: id, reason: 'Isolated acceptance cancellation' } })}\n`);
        pending.delete(id);
      }
      await writeFile(join(launch.dataDirectory, `result-${seen}.json`), JSON.stringify({ cancelled: Boolean(id) }));
      return;
    }
    const id = randomUUID();
    pending.set(id, seen);
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call',
      params: { name: command.name, arguments: command.arguments } })}\n`);
  } catch { /* The command file is an optional test-only signal. */ }
  finally { reading = false; }
}, 20);
process.stdin.on('end', () => { clearInterval(timer); child.stdin.end(); });
child.on('exit', code => { clearInterval(timer); process.exitCode = code ?? 1; });
