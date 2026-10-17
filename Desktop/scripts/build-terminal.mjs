import { build } from 'esbuild';
import { cp, chmod } from 'node:fs/promises';

await build({ entryPoints: ['electron/terminal-host.ts'], outfile: 'terminal-runtime/host.cjs',
  bundle: true, platform: 'node', format: 'cjs', external: ['node-pty'] });
await cp('node_modules/node-pty', 'terminal-runtime/node_modules/node-pty', { recursive: true, dereference: true });

// npm archives may omit the executable bit on node-pty's macOS spawn helper.
if (process.platform === 'darwin') await chmod(`terminal-runtime/node_modules/node-pty/prebuilds/darwin-${process.arch}/spawn-helper`, 0o755);
