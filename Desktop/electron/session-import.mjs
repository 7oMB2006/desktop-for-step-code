import { createInterface } from 'node:readline';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const agentDir = process.env.STEP_CODING_AGENT_DIR;
const sessionRoot = process.env.STEP_CODING_AGENT_SESSION_DIR;
if (!agentDir || !sessionRoot || !process.env.STEPCODE_STORAGE_ROOT_DIR)
  throw new Error('Session import requires an isolated Desktop profile');
const { SessionImportService } = await import(pathToFileURL(join(root, 'step/dist/bundle/index.js')).href);
const send = value => process.stdout.write(JSON.stringify(value) + '\n');
const service = new SessionImportService({
  agentDir, sessionRoot, onPersisted: () => send({ type: 'desktop_sessions_changed' }),
});
const jobs = values => values.map(job => ({
  ...job, results: job.results.map(({ path, ...result }) => result),
}));
const watching = new Set();
async function watch(id) {
  watching.add(id);
  try {
    while ((await service.getJob(id)).status === 'running')
      await new Promise(resolve => setTimeout(resolve, 250));
  } finally {
    watching.delete(id);
    send({ type: 'desktop_import_state', running: watching.size > 0 });
  }
}
async function dispatch(request) {
  switch (request.type) {
    case 'scan': return service.scan(request.options);
    case 'preview': return service.preview(request.candidateId);
    case 'start': {
      const job = await service.start(request.selections);
      // Start observation after replying, so terminal state cannot precede the job.
      setTimeout(() => { void watch(job.id); }, 0);
      return jobs([job])[0];
    }
    case 'jobs': return jobs(await service.listJobs());
    case 'cancel': return jobs([await service.cancel(request.jobId)])[0];
    case 'close': await service.close(); return null;
    default: throw new Error('Invalid import operation');
  }
}
// Preserve operation ordering, especially preview capabilities versus a new scan.
let queue = Promise.resolve();
createInterface({ input: process.stdin }).on('line', line => {
  queue = queue.then(async () => {
    let request;
    try {
      request = JSON.parse(line);
      const data = await dispatch(request);
      send({ id: request.id, type: 'response', success: true, data });
    } catch (error) {
      // Parser errors can contain foreign source content. Do not relay or log it.
      const message = error?.status === 409 ? 'Preview expired or source changed. Scan and preview again.'
        : 'Session import operation failed. Check source format, directories and available disk space.';
      send({ id: request?.id, type: 'response', success: false, error: message });
    }
  });
}).on('close', () => { void queue.then(() => service.close()); });
