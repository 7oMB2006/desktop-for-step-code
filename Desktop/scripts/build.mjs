import { build } from 'esbuild';
import { build as viteBuild } from 'vite';
import { cp, mkdir } from 'node:fs/promises';
import './icons.mjs';
await build({ entryPoints: ['electron/main.ts', 'electron/preload.ts'], outdir: 'dist', outExtension: { '.js': '.cjs' }, bundle: true, platform: 'node', format: 'cjs', external: ['electron'], sourcemap: true });
await viteBuild({ base: './', build: { outDir: 'dist/renderer', emptyOutDir: true } });
await mkdir('dist/licenses', { recursive: true });
for (const [source, name] of [
  ['@number-flow/react/LICENSE.md', 'number-flow-react.txt'],
  ['number-flow/LICENSE.md', 'number-flow.txt'],
  ['esm-env/LICENSE', 'esm-env.txt'],
]) await cp(`node_modules/${source}`, `dist/licenses/${name}`);
