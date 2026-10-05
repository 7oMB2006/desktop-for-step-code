import { build } from 'esbuild';
import { build as viteBuild } from 'vite';
import { cp, mkdir } from 'node:fs/promises';
import './icons.mjs';
import './build-terminal.mjs';
await build({ entryPoints: ['electron/main.ts', 'electron/preload.ts'], outdir: 'dist', outExtension: { '.js': '.cjs' }, bundle: true, platform: 'node', format: 'cjs', external: ['electron'], sourcemap: true });
await viteBuild({ base: './', build: { outDir: 'dist/renderer', emptyOutDir: true } });
await mkdir('dist/licenses', { recursive: true });
for (const [source, name] of [
  ['@number-flow/react/LICENSE.md', 'number-flow-react.txt'],
  ['number-flow/LICENSE.md', 'number-flow.txt'],
  ['esm-env/LICENSE', 'esm-env.txt'],
  ['@xterm/xterm/LICENSE', 'xterm.txt'],
  ['@xterm/addon-fit/LICENSE', 'xterm-addon-fit.txt'],
  ['node-pty/LICENSE', 'node-pty.txt'],
  ['node-pty/deps/winpty/LICENSE', 'winpty.txt'],
]) await cp(`node_modules/${source}`, `dist/licenses/${name}`);
