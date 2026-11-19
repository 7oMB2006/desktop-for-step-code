import assert from 'node:assert/strict';
import { isAbsolute, resolve } from 'node:path';
import { build, preview } from 'vite';

const output = process.argv[2];
const port = Number(process.argv[3] ?? 5187);
assert.ok(output && isAbsolute(output), 'Pass an absolute web build output directory');
assert.ok(Number.isInteger(port) && port >= 1024 && port <= 65535, 'Invalid loopback port');
const outDir = resolve(output);
await build({
  base: './',
  define: { DESKTOP_USAGE_OVERVIEW_PREVIEW: 'false' },
  build: { outDir, emptyOutDir: false, rolldownOptions: { input: 'tool-status-preview.html' } },
});
const server = await preview({ build: { outDir }, preview: { host: '127.0.0.1', port, strictPort: true } });
console.log(`Preview ready: http://127.0.0.1:${port}/tool-status-preview.html`);
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.httpServer.close(() => process.exit(0)));
