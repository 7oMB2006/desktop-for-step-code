import { createRequire } from 'node:module';
import { defineConfig } from 'vite';

const require = createRequire(import.meta.url);
const decodeRequire = createRequire(require.resolve('micromark-util-decode-string'));

export const markdownWorker = {
  plugins: () => [{
    name: 'worker-character-references',
    enforce: 'pre',
    resolveId(id) {
      // The package's browser entry uses document; Workers need its entity table.
      if (id === 'decode-named-character-reference') return decodeRequire.resolve(id);
    },
  }],
};

export default defineConfig({ worker: markdownWorker });
