import { createInterface } from 'node:readline';
import { ConfigurationReader, clearInheritedCredentials } from './configuration.mjs';

clearInheritedCredentials();
const configuration = new ConfigurationReader(new URL('../', import.meta.url));
let chain = Promise.resolve();
createInterface({ input: process.stdin }).on('line', line => {
  chain = chain.then(async () => {
    let request;
    try {
      if (line.length > 65536) throw new Error('Invalid request');
      request = JSON.parse(line);
      if (request.id === undefined) return;
      let result;
      if (request.method === 'initialize') {
        await configuration.current();
        result = { protocolVersion: request.params.protocolVersion,
          capabilities: { tools: {} }, serverInfo: { name: 'dfsc-config-example', version: '0.1.0' } };
      }
      else if (request.method === 'ping') result = {};
      else if (request.method === 'tools/list') result = { tools: [{
        name: 'format_note', description: 'Format supplied text using local saved settings. No network access.',
        inputSchema: { type: 'object', properties: { text: { type: 'string', maxLength: 4000 } }, required: ['text'], additionalProperties: false },
      }] };
      else if (request.method === 'tools/call' && request.params?.name === 'format_note') {
        const text = request.params.arguments?.text;
        if (typeof text !== 'string' || text.length > 4000) throw new Error('Invalid text');
        const { values } = await configuration.current();
        const formatted = `${values.prefix ?? ''}${values.uppercase ? text.toUpperCase() : text}`.slice(0, values.limit);
        result = { content: [{ type: 'text', text: formatted }] };
      } else throw new Error('Unsupported request');
      process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: request.id, result })}\n`);
    } catch {
      if (request?.id !== undefined) process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: request.id,
        error: { code: -32000, message: 'Request unavailable. Review configuration and restart the service.' } })}\n`);
    }
  });
});
