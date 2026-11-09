import { createServer } from 'vite';

const port = Number(process.env.DESKTOP_PREVIEW_PORT || 5183);
const server = await createServer({
  cacheDir: 'test-results/plugin-market-info/vite-cache',
  server: { host: '127.0.0.1', port, strictPort: true },
});
await server.listen();
console.log(`Plugin marketplace preview: http://127.0.0.1:${port}/tests/fixtures/plugin-center-live.html?metadata=1`);
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => {
  void server.close().then(() => process.exit(0));
});
