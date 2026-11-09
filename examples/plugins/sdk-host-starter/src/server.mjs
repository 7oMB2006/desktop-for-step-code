import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { createHostClient, HostClientError, newRequestId } from '../../host-client/client.mjs';

const major = Number(process.versions.node.split('.')[0]);
if (major !== 24 || process.versions.node.localeCompare('24.16.0', undefined, { numeric: true }) < 0) {
  process.stderr.write('This example requires tested Node.js 24.16.0 or later in major 24.\n');
  process.exit(1);
}
let host;
let startupCode = 'HOST_UNAVAILABLE';
try {
  host = createHostClient({ pluginId: 'dfsc-host-example', consumer: 'example' });
} catch (error) {
  if (error instanceof HostClientError) startupCode = error.code;
}
const server = new McpServer({ name: 'dfsc-host-example', version: '0.1.0' });
const errorResult = error => ({ isError: true, content: [{ type: 'text',
  text: error instanceof HostClientError ? error.message : 'dfsc-host:HOST_UNAVAILABLE' }] });
server.registerTool('host_context', {
  description: 'Read host capability availability; never calls a model.',
  inputSchema: {},
}, async () => {
  try {
    if (!host) throw new HostClientError(startupCode);
    return { content: [{ type: 'text', text: JSON.stringify(await host.context()) }] };
  } catch (error) { return errorResult(error); }
});
server.registerTool('summarize_text', {
  description: 'Request a summary through the explicitly authorized host model; no independent-key fallback.',
  inputSchema: { text: z.string().min(1).max(16384) },
}, async ({ text }) => {
  try {
    if (!host) throw new HostClientError(startupCode);
    const context = await host.context();
    const available = context.capabilities.find(item => item.id === 'model.text');
    if (!available?.available) throw new HostClientError(available?.reason ?? 'CAPABILITY_UNAVAILABLE');
    const result = await host.invoke({ requestId: newRequestId(), revision: context.revision,
      capability: 'model.text', input: { messages: [
        { role: 'system', content: 'Summarize the supplied text concisely.' }, { role: 'user', content: text },
      ] } });
    return { content: [{ type: 'text', text: result.text }] };
  } catch (error) { return errorResult(error); }
});
process.on('exit', () => host?.close());
await server.connect(new StdioServerTransport());
