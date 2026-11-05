import { createServer } from 'vite';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const server = await createServer({ root, cacheDir: resolve(root, 'test-results/remote-chat-preview/dev-cache'),
  server: { host: '127.0.0.1', port: 5203, strictPort: false } });
await server.listen();
console.log(`${server.resolvedUrls.local[0]}tests/fixtures/remote-chat.html`);
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => {
  await server.close();
  process.exit(0);
});
