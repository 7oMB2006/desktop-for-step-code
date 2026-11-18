import { appendFile, access } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { setTimeout as delay } from 'node:timers/promises';

const [role, events, release, fail] = process.argv.slice(2);
const record = event => appendFile(events, JSON.stringify({ event, role, pid: process.pid, parent: process.ppid }) + '\n');
const exists = file => access(file).then(() => true, () => false);
const input = createInterface({ input: process.stdin });
input.on('line', line => void (async () => {
  const request = JSON.parse(line);
  if (request.id === undefined) return;
  let result;
  if (request.method === 'initialize') {
    await record('initialize');
    if (role === 'target' && await exists(fail)) { process.exitCode = 1; input.close(); process.stdin.destroy(); return; }
    result = { protocolVersion: request.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: role, version: '1' } };
  } else if (request.method === 'tools/list') {
    result = { tools: [{ name: 'format_note', inputSchema: { type: 'object', properties: {} } }] };
  } else if (request.method === 'tools/call') {
    await record('call');
    for (let attempt = 0; role === 'target' && !await exists(release) && attempt < 1200; attempt++) await delay(50);
    await record('finished');
    result = { content: [{ type: 'text', text: 'fixture tool completed' }] };
  } else result = {};
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }) + '\n');
})().catch(() => { process.exitCode = 1; }));
