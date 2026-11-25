import { defineConfig, mergeConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import desktopConfig from './vite.config.mjs';
export default defineConfig(mergeConfig(desktopConfig, {
  cacheDir: 'node_modules/.vite-stellar-preview',
  define: { DESKTOP_USAGE_OVERVIEW_PREVIEW: 'false' },
  server: { host: '127.0.0.1', port: 4197, strictPort: true,
    fs: { allow: [fileURLToPath(new URL('..', import.meta.url))] } },
}));
