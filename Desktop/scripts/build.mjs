import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { build as viteBuild } from 'vite';
import { cp, mkdir } from 'node:fs/promises';
import './icons.mjs';
import './build-terminal.mjs';
await build({ entryPoints: ['electron/main.ts', 'electron/preload.ts', 'electron/tray-preload.ts', 'electron/keyless-fetch.ts', 'electron/macos-update-helper.ts'], outdir: 'dist', outExtension: { '.js': '.cjs' }, bundle: true, platform: 'node', format: 'cjs', external: ['electron'], sourcemap: true });
await viteBuild({ base: './', build: { outDir: 'dist/renderer', emptyOutDir: true, rolldownOptions: { input: ['index.html', 'tray-menu.html'] } } });
await mkdir('dist/licenses', { recursive: true });
await mkdir('dist/file-opening', { recursive: true });
await cp('dist/macos-update-helper.cjs', 'dist/file-opening/macos-update-helper.cjs');
if (process.platform === 'darwin') execFileSync('/usr/bin/xcrun', ['swiftc', '-O', 'electron/file-applications-macos.swift', '-o', 'dist/file-opening/file-applications-macos']);
for (const name of ['file-associations.cs', 'file-associations.ps1'])
  await cp(`electron/${name}`, `dist/file-opening/${name}`);
for (const [source, name] of [
  ['@number-flow/react/LICENSE.md', 'number-flow-react.txt'],
  ['react-colorful/LICENSE', 'react-colorful.txt'],
  ['number-flow/LICENSE.md', 'number-flow.txt'],
  ['esm-env/LICENSE', 'esm-env.txt'],
  ['@xterm/xterm/LICENSE', 'xterm.txt'],
  ['@xterm/addon-fit/LICENSE', 'xterm-addon-fit.txt'],
  ['node-pty/LICENSE', 'node-pty.txt'],
  ['node-pty/deps/winpty/LICENSE', 'winpty.txt'],
  ['linkedom/LICENSE', 'linkedom.txt'],
  ['unified/license', 'unified.txt'],
  ['remark-parse/license', 'remark-parse.txt'],
  ['semver/LICENSE', 'semver.txt'],
  ['@xmldom/xmldom/LICENSE', 'xmldom.txt'],
  ['electron-updater/LICENSE', 'electron-updater.txt'],
  ['builder-util-runtime/LICENSE', 'builder-util-runtime.txt'],
]) await cp(`node_modules/${source}`, `dist/licenses/${name}`);
