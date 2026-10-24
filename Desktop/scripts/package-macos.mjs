import { valid } from 'semver';
import { execFileSync } from 'node:child_process';
import { build, Platform, Arch } from 'electron-builder';
import { cp, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

if (process.platform !== 'darwin' || process.arch !== 'arm64') throw new Error('Build this preview on an Apple Silicon Mac');
const source = resolve('.');
const manifest = JSON.parse(await readFile('package.json', 'utf8'));
const updateVersion = process.env.DESKTOP_MACOS_RELEASE_VERSION ?? manifest.version;
if (!valid(updateVersion) || updateVersion.replace(/-macos\.\d+$/, '') !== manifest.version) throw new Error('Invalid macOS release version');
const runtime = JSON.parse(await readFile('runtime/manifest.json', 'utf8'));
if (runtime.platform !== process.platform || runtime.arch !== process.arch) throw new Error('Restage the runtime on this Mac before packaging');
const stage = await realpath(await mkdtemp(join(tmpdir(), 'desktop-macos-package-')));
try {
  // esbuild bundles the main-process dependencies and Vite bundles the renderer.
  // Only the separately staged PTY host needs native modules. Avoid collecting the
  // development tree: electron-builder 26 misreads pnpm's hoisted virtual paths.
  for (const name of ['dist', 'runtime', 'terminal-runtime', 'build', 'scripts'])
    await cp(join(source, name), join(stage, name), { recursive: true });
  const { dependencies, devDependencies, pnpm, packageManager, scripts, build: config, ...metadata } = manifest;
  await writeFile(join(stage, 'package.json'), JSON.stringify(metadata, null, 2));
  await writeFile(join(stage, 'macos-update.json'), JSON.stringify({ version: updateVersion, sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), sourceDirty: Boolean(execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim()) }));
  await build({ projectDir: stage, targets: Platform.MAC.createTarget('dir', Arch.arm64), config: {
    ...config, npmRebuild: false,
    extraResources: [...config.extraResources, { from: 'macos-update.json', to: 'macos-update.json' }],
    electronVersion: devDependencies.electron,
    electronDist: join(source, 'node_modules/electron/dist'),
    directories: { output: join(source, 'release') },
  } });
} finally {
  await rm(stage, { recursive: true, force: true });
}
