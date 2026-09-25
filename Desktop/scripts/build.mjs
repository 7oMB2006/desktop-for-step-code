import { build } from 'esbuild';
import { build as viteBuild } from 'vite';
import './icons.mjs';
await build({ entryPoints: ['electron/main.ts', 'electron/preload.ts'], outdir: 'dist', outExtension: { '.js': '.cjs' }, bundle: true, platform: 'node', format: 'cjs', external: ['electron'], sourcemap: true });
await viteBuild({ base: './', build: { outDir: 'dist/renderer', emptyOutDir: true } });
