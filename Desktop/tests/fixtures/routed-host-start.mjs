import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ConfigurationReader } from './configuration.mjs';
import { createHostClient } from './client.mjs';

const host = createHostClient({ pluginId: 'dfsc-host-example', consumer: 'example' });
const { mode, independentCapabilities, configurationRevision, dataDirectory } = host;
if (independentCapabilities !== undefined) {
  const config = await new ConfigurationReader(new URL('.', import.meta.url)).current();
  if (config.revision !== configurationRevision || !config.secrets.key) throw new Error('Invalid fixture configuration');
  const brokerCapabilities = mode === 'follow' ? (await host.context()).capabilities.map(item => item.id) : [];
  await writeFile(join(dataDirectory, 'routed-fixture.json'), JSON.stringify({
    mode, independentCapabilities, configurationMatched: true, brokerCapabilities,
  }));
}
host.close();
// The bundled server supplies the MCP handshake; the current client above consumes the launch.
await import('./dist/server.mjs');
