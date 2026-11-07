import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
export default defineConfig({
  define: { DESKTOP_USAGE_OVERVIEW_PREVIEW: 'false' },
  server: { host: '127.0.0.1', port: 4197, strictPort: true,
    fs: { allow: [fileURLToPath(new URL('..', import.meta.url))] } },
});
