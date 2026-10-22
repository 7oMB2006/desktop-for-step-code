import { createInterface } from 'node:readline';
import { appendFileSync } from 'node:fs';

if (process.env.DESKTOP_MCP_START_LOG) appendFileSync(process.env.DESKTOP_MCP_START_LOG, 'start\n');
createInterface({ input: process.stdin }).on('line', line => {
  const request = JSON.parse(line);
  if (request.id === undefined) return;
  let result;
  switch (request.method) {
    case 'initialize':
      result = { protocolVersion: request.params.protocolVersion, capabilities: { tools: {} },
        serverInfo: { name: 'desktop-steppage-fixture', version: '1.0.0' } };
      break;
    case 'tools/list':
      result = { tools: [{ name: 'fixture_inspect', description: 'Read-only acceptance fixture',
        inputSchema: { type: 'object', properties: {} } }] };
      break;
    case 'ping': result = {}; break;
    default:
      process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id,
        error: { code: -32601, message: 'Tool execution is not part of this acceptance fixture' } }) + '\n');
      return;
  }
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }) + '\n');
});
