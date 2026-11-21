import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHostClient } from './client.mjs';
import { ConfigurationReader } from './configuration.mjs';

// Preserve the frozen SDK consumer on legacy launches.
if (JSON.parse(process.env.DFSC_LAUNCH_CONTEXT).independentCapabilities) {
  const host = createHostClient({ pluginId: 'dfsc-host-example', consumer: 'example' });
  const config = await new ConfigurationReader(new URL('.', import.meta.url)).current();
  if (config.revision !== host.configurationRevision || !config.secrets.key) throw new Error('Invalid fixture configuration');
  await writeFile(join(host.dataDirectory, 'routed-fixture.json'), JSON.stringify({
    mode: host.mode, independentCapabilities: host.independentCapabilities, configurationMatched: true,
  }));
}
await import('./dist/server.mjs');
