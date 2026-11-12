import { createInterface } from 'node:readline';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createCapabilitySettings, CapabilityError } from './capability-settings.mjs';
import { capabilityFailureCode, capabilityFailureDetails } from './capability-failure.mjs';
import { refreshGitMarketplace } from './marketplace-refresh.mjs';

const directory = dirname(fileURLToPath(import.meta.url));
const upstream = await import(pathToFileURL(join(directory, 'step/dist/bundle/index.js')).href);
const manager = createCapabilitySettings(upstream, { root: process.env.STEPCODE_STORAGE_ROOT_DIR,
  refreshMarketplace: refreshGitMarketplace });
const send = value => process.stdout.write(`${JSON.stringify(value)}\n`);
let chain = Promise.resolve();
let shuttingDown = false, active;
const input = createInterface({ input: process.stdin });
input.on('line', line => {
  let control;
  try { control = JSON.parse(line); } catch {}
  if (shuttingDown) return;
  if (control?.type === 'shutdown') {
    shuttingDown = true;
    input.close();
    process.stdin.pause();
    active?.abort();
    // Drain admitted work (including its finally blocks) before acknowledging.
    void chain.then(() => new Promise((resolve, reject) => {
      process.stdout.write(`${JSON.stringify({ id: control.id, type: 'response', success: true,
        data: { shutdown: true } })}\n`, error => error ? reject(error) : resolve());
    })).then(() => {
      process.exitCode ??= 0;
      process.stdin.destroy();
    }, () => {
      process.exitCode = 1;
      process.stdin.destroy();
    });
    return;
  }
  chain = chain.then(async () => {
    let request;
    try {
      request = JSON.parse(line);
      if (shuttingDown) throw new CapabilityError('operation-denied');
      active = new AbortController();
      const data = request.type === 'catalog' ? await manager.catalog()
        : request.type === 'initialize' ? await manager.initialize()
        : request.type === 'mutate' ? await manager.mutate(request.input,
          AbortSignal.any([active.signal, AbortSignal.timeout(125000)]))
        : request.type === 'plugin-update-preflight' ? await manager.preflightUpdate(request.input,
          AbortSignal.any([active.signal, AbortSignal.timeout(125000)]))
        : request.type === 'import' ? await manager.importSkill(request.path)
        : (() => { throw new CapabilityError('invalid-input'); })();
      send({ id: request.id, type: 'response', success: true, data });
    } catch (error) {
      send({ id: request?.id, type: 'response', success: false,
        error: `capability:${capabilityFailureCode(error)}`, details: capabilityFailureDetails(error) });
    } finally {
      active = undefined;
    }
  });
});
