import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { createHostClient, HostClientError, newRequestId } from '../../../host-client/client.mjs';

const host = createHostClient({ pluginId: 'dfsc-host-example', consumer: 'example' });
const server = new McpServer({ name: 'dfsc-speech-acceptance', version: '1.0.0' });
server.registerTool('synthesize_speech', {
  description: 'Isolated fixture for host TTS authorization and binary results.',
  inputSchema: { text: z.string().min(1).max(1000), voice: z.string().min(1).max(128),
    format: z.enum(['mp3', 'wav', 'pcm']) },
}, async (input, extra) => {
  try {
    const context = await host.context({ signal: extra.signal });
    const capability = context.capabilities.find(item => item.id === 'model.tts');
    if (!capability?.available) throw new HostClientError(capability?.reason ?? 'CAPABILITY_UNAVAILABLE');
    const result = await host.invoke({ requestId: newRequestId(), revision: context.revision,
      capability: 'model.tts', input }, { signal: extra.signal });
    return { content: [result] };
  } catch (error) {
    return { isError: true, content: [{ type: 'text',
      text: error instanceof HostClientError ? error.message : 'dfsc-host:HOST_UNAVAILABLE' }] };
  }
});
process.on('exit', () => host.close());
await server.connect(new StdioServerTransport());
