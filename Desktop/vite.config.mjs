import { createRequire } from 'node:module';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { defineConfig } from 'vite';

const require = createRequire(import.meta.url);
const decodeRequire = createRequire(require.resolve('micromark-util-decode-string'));
const pdfRoot = new URL('./node_modules/pdfjs-dist/', import.meta.url);

function pdfPreviewAssets() {
  const moduleId = 'virtual:pdf-preview-fonts';
  const folders = { cMapUrl: 'cmaps', standardFontDataUrl: 'standard_fonts' };
  return {
    name: 'pdf-preview-assets',
    resolveId(id) { if (id === moduleId) return `\0${id}`; },
    load(id) {
      if (id !== `\0${moduleId}`) return;
      const data = Object.fromEntries(Object.entries(folders).map(([kind, folder]) => {
        const root = new URL(`${folder}/`, pdfRoot);
        const files = readdirSync(root).filter(name => /\.(bcmap|pfb|ttf)$/.test(name));
        return [kind, Object.fromEntries(files.map(name => [name, readFileSync(new URL(name, root), 'base64')]))];
      }));
      return `export default ${JSON.stringify(data)};`;
    },
    generateBundle() {
      for (const name of ['openjpeg_nowasm_fallback.js', 'jbig2_nowasm_fallback.js']) {
        this.emitFile({ type: 'asset', fileName: `pdf-preview-decoder/${name}`, source: readFileSync(new URL(`wasm/${name}`, pdfRoot)) });
      }
      for (const [root, name, output] of [
        ['cmaps', 'LICENSE', 'pdf-cmaps.txt'],
        ['standard_fonts', 'LICENSE_FOXIT', 'pdf-foxit-fonts.txt'],
        ['standard_fonts', 'LICENSE_LIBERATION', 'pdf-liberation-fonts.txt'],
        ...['LICENSE_JBIG2', 'LICENSE_OPENJPEG', 'LICENSE_PDFJS_JBIG2', 'LICENSE_PDFJS_OPENJPEG']
          .map(name => ['wasm', name, `pdf-${name.toLowerCase()}.txt`]),
      ]) this.emitFile({ type: 'asset', fileName: `licenses/${output}`, source: readFileSync(new URL(join(root, name).replaceAll('\\', '/'), pdfRoot)) });
    },
  };
}

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

export default defineConfig({ worker: markdownWorker, plugins: [pdfPreviewAssets()] });
