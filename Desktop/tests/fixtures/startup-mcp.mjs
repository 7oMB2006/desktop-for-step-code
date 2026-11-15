import { createInterface } from 'node:readline';
import { appendFile } from 'node:fs/promises';

const delayMs = Math.max(0, Number(process.env.FIXTURE_MCP_DELAY_MS ?? 0));
const send = (id, result) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n');
createInterface({ input: process.stdin }).on('line', async line => {
  const message = JSON.parse(line);
  if (message.method === 'initialize') {
    if (process.env.FIXTURE_MCP_STARTED) await appendFile(process.env.FIXTURE_MCP_STARTED, 'initialize\n');
    if (process.env.FIXTURE_MCP_NEVER === '1') return;
    await new Promise(resolve => setTimeout(resolve, delayMs));
    send(message.id, { protocolVersion: message.params.protocolVersion, capabilities: { tools: {} },
      serverInfo: { name: 'startup-fixture', version: '1.0.0' } });
  } else if (message.method === 'tools/list') send(message.id, { tools: [] });
  else if (message.method === 'ping') send(message.id, {});
});
