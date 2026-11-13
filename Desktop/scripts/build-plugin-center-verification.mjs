import assert from 'node:assert/strict';
import { mkdir, readdir, readFile, copyFile, symlink, access, realpath, stat } from 'node:fs/promises';
import { resolve, join, isAbsolute } from 'node:path';
import { build } from 'esbuild';
import { build as viteBuild } from 'vite';

const output = process.argv[2];
if (!output || !isAbsolute(output)) throw new Error('Pass a new absolute verification output directory');
const runtime = resolve(process.env.DESKTOP_TEST_RUNTIME ?? 'runtime');
const integration = JSON.parse(await readFile('../patches/v017/manifest.json', 'utf8'));
const staged = JSON.parse(await readFile(join(runtime, 'manifest.json'), 'utf8'));
assert.equal(staged.commit, integration.commit, 'Verification runtime must use the current pin');
assert.deepEqual(staged.patchedSourceHashes, {
  ...integration.patchedSources, ...integration.platforms?.[process.platform]?.patchedSources,
}, 'Verification runtime must contain the complete current patch set');
try { await access(output); throw new Error('Output already exists; choose a new directory'); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
await mkdir(join(output, 'runtime'), { recursive: true });
for (const name of await readdir(runtime, { withFileTypes: true })) {
  const source = join(runtime, name.name), target = join(output, 'runtime', name.name);
  if ((await stat(source)).isDirectory())
    await symlink(await realpath(source), target, process.platform === 'win32' ? 'junction' : 'dir');
  else {
    const current = resolve('electron', name.name);
    await copyFile(await access(current).then(() => current).catch(() => source), target);
  }
}
for (const name of ['plugin-files.mjs', 'theme-composition.mjs', 'marketplace-refresh.mjs', 'runtime-compile-cache.mjs',
  'plugin-schema-update.mjs', 'windows-runtime-job.ps1'])
  await copyFile(resolve('electron', name), join(output, 'runtime', name));
await mkdir(join(output, 'build'));
for (const name of ['icon.ico', 'icon.png', 'tray.png'])
  await copyFile(resolve('build', name), join(output, 'build', name));
const define = { DESKTOP_USAGE_OVERVIEW_PREVIEW: 'false' };
await build({ entryPoints: ['electron/main.ts', 'electron/preload.ts', 'electron/tray-preload.ts', 'electron/keyless-fetch.ts'],
  outdir: output, outExtension: { '.js': '.cjs' }, bundle: true, platform: 'node', format: 'cjs', external: ['electron'], define });
await viteBuild({ base: './', define, build: { outDir: join(output, 'renderer'), emptyOutDir: false,
  rolldownOptions: { input: ['index.html', 'tray-menu.html'] } } });
console.log(output);
