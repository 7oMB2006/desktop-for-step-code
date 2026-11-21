import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ConfigurationReader } from './configuration.mjs';

// Inspect only the fixture metadata; the actual MCP consumer must consume the launch once.
const { mode, independentCapabilities, configurationRevision, dataDirectory } = JSON.parse(process.env.DFSC_LAUNCH_CONTEXT);
const { readHostContext } = await import('./dist/server.mjs');
if (independentCapabilities) {
  const config = await new ConfigurationReader(new URL('.', import.meta.url)).current();
  if (config.revision !== configurationRevision || !config.secrets.key) throw new Error('Invalid fixture configuration');
  const context = await readHostContext();
  await writeFile(join(dataDirectory, 'routed-fixture.json'), JSON.stringify({
    mode, independentCapabilities, configurationMatched: true, brokerCapabilities: context.capabilities.map(item => item.id),
  }));
}
