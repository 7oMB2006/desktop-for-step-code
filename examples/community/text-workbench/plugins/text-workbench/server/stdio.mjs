import { createInterface } from 'node:readline';
import { ConfigurationReader, clearInheritedCredentials } from './configuration.mjs';
import { createRouter } from './protocol.mjs';

clearInheritedCredentials();
const route = createRouter(new ConfigurationReader(new URL('../', import.meta.url)));
for await (const line of createInterface({ input: process.stdin, crlfDelay: Infinity })) {
  let reply;
  try {
    if (Buffer.byteLength(line, 'utf8') > 65536) throw new Error('Frame too large');
    reply = await route(JSON.parse(line));
  } catch {
    reply = { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Invalid JSON or oversized request.' } };
  }
  if (reply) {
    if (!process.stdout.write(`${JSON.stringify(reply)}\n`)) {
      await new Promise(resolve => process.stdout.once('drain', resolve));
    }
  }
}
