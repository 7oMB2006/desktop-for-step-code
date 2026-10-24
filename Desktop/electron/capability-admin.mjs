import { createInterface } from 'node:readline';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createCapabilitySettings, CapabilityError } from './capability-settings.mjs';

const directory = dirname(fileURLToPath(import.meta.url));
const upstream = await import(pathToFileURL(join(directory, 'step/dist/bundle/index.js')).href);
const manager = createCapabilitySettings(upstream, { root: process.env.STEPCODE_STORAGE_ROOT_DIR });
const send = value => process.stdout.write(`${JSON.stringify(value)}\n`);
let chain = Promise.resolve();
createInterface({ input: process.stdin }).on('line', line => {
  chain = chain.then(async () => {
    let request;
    try {
      request = JSON.parse(line);
      const data = request.type === 'catalog' ? await manager.catalog()
        : request.type === 'mutate' ? await manager.mutate(request.input, AbortSignal.timeout(125000))
        : request.type === 'import' ? await manager.importSkill(request.path)
        : (() => { throw new CapabilityError('invalid-input'); })();
      send({ id: request.id, type: 'response', success: true, data });
    } catch (error) {
      send({ id: request?.id, type: 'response', success: false,
        error: `capability:${error instanceof CapabilityError ? error.code : 'operation-failed'}` });
    }
  });
});
