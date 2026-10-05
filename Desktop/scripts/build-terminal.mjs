import { build } from 'esbuild';
import { cp } from 'node:fs/promises';

await build({ entryPoints: ['electron/terminal-host.ts'], outfile: 'terminal-runtime/host.cjs',
  bundle: true, platform: 'node', format: 'cjs', external: ['node-pty'] });
await cp('node_modules/node-pty', 'terminal-runtime/node_modules/node-pty', { recursive: true, dereference: true });
