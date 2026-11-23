import { createInterface } from 'node:readline';
import { existsSync } from 'node:fs';
import { appendFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';

const delayMs = Math.max(0, Number(process.env.FIXTURE_MCP_DELAY_MS ?? 0));
const releaseFile = process.env.FIXTURE_MCP_RELEASE;
const send = (id, result) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n');
createInterface({ input: process.stdin }).on('line', async line => {
  const message = JSON.parse(line);
  if (message.method === 'initialize') {
    if (process.env.FIXTURE_MCP_STARTED) await appendFile(process.env.FIXTURE_MCP_STARTED, 'initialize\n');
    if (process.env.FIXTURE_MCP_NEVER === '1') return;
    while (releaseFile && !existsSync(releaseFile)) await delay(50);
    if (delayMs) await delay(delayMs);
    send(message.id, { protocolVersion: message.params.protocolVersion, capabilities: { tools: {} },
      serverInfo: { name: 'startup-fixture', version: '1.0.0' } });
  } else if (message.method === 'tools/list') send(message.id, { tools: [] });
  else if (message.method === 'ping') send(message.id, {});
});
