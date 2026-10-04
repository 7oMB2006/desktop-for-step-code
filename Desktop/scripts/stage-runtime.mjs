import { cp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve, dirname, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
const upstream = resolve(process.argv[2] ?? process.env.DESKTOP_STEP_CODE_SOURCE ?? '../Step-Code');
const runtime = resolve('runtime');
if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('Build this Windows x64 preview on Windows x64');
const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: upstream, encoding: 'utf8' }).trim();
if (commit !== '519e4de4ed2162d3667be1821cb92ada6b884e5a') {
  throw new Error('Step Code source does not match the pinned Desktop baseline; build the pinned checkout and pass its path to stage:runtime');
}
// The manifest advertises the patch set below, so staging must prove the sources are
// actually patched instead of trusting the working tree. `pnpm package` never applies the
// patch itself; CI does it separately, and an unpatched checkout staged locally would
// ship a runtime whose manifest claims patches that are not there.
const patchedFiles = [
  ['auth-storage.ts', 'packages/coding-agent/src/core/auth-storage.ts', 'a25fff15510b1bd9f009483717727f2fe19dc442'],
  ['index.ts', 'packages/coding-agent/src/index.ts', '394a944cd4758b705e3f5d87a7b94aae0a23abec'],
  ['build-coding-agent-bundle.mjs', 'scripts/build-coding-agent-bundle.mjs', 'da69d6cf5582c7e4f762ac2ecbb543fbc2ef87c8'],
  ['subagent-rpc-adapter.ts', 'packages/coding-agent/src/features/subagent/rpc-adapter.ts', '3ddc850f55fbd4947f0f980db5b4220ed55bb6d0'],
];
const patchedSourceHashes = {};
for (const [name, relative, expected] of patchedFiles) {
  const bytes = await readFile(join(upstream, relative));
  const hash = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
  if (hash !== expected) {
    throw new Error(`Patched source ${relative} does not match the expected content; apply scripts/apply-step-code-desktop-patch.mjs to the pinned checkout before staging`);
  }
  patchedSourceHashes[name] = hash;
}

const source = join(upstream, 'packages/coding-agent');
const currentNode = await readFile(process.execPath);
const nodeSha256 = createHash('sha256').update(currentNode).digest('hex');
let matchingLicense = false;
try {
  const previous = JSON.parse(await readFile(join(runtime, 'manifest.json'), 'utf8'));
  await readFile(join(runtime, 'node/LICENSE'));
  matchingLicense = previous.node === process.version && previous.nodeSha256 === nodeSha256;
} catch {}
await mkdir(join(runtime, 'node'), { recursive: true });
await cp(process.execPath, join(runtime, 'node/node.exe'));
if (!matchingLicense) {
  const licenseResponse = await fetch(`https://raw.githubusercontent.com/nodejs/node/${process.version}/LICENSE`);
  if (!licenseResponse.ok) throw new Error('Unable to obtain the matching Node distribution license');
  await writeFile(join(runtime, 'node/LICENSE'), await licenseResponse.text());
}
await cp(join(source, 'dist'), join(runtime, 'step/dist'), { recursive: true });
for (const name of ['package.json', 'README.md']) await cp(join(source, name), join(runtime, 'step', name));
for (const name of ['LICENSE', 'NOTICE', 'THIRD_PARTY_NOTICES.md']) await cp(join(upstream, name), join(runtime, name));
await cp('electron/admin.mjs', join(runtime, 'admin.mjs'));
await cp('electron/desktop-sessions.mjs', join(runtime, 'desktop-sessions.mjs'));
await cp('../LICENSE', join(runtime, 'DESKTOP-LICENSE'));
const require = createRequire(join(source, 'package.json'));
async function resolvePackageDirectory(name) {
  let directory = dirname(require.resolve(name));
  while (true) {
    try {
      const manifest = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'));
      if (manifest.name === name) return directory;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    const parent = dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  throw new Error(`Unable to locate package directory for ${name}`);
}
for (const name of ['jiti', '@silvia-odwyer/photon-node']) {
  const packageDirectory = await resolvePackageDirectory(name);
  await cp(packageDirectory, join(runtime, 'step/node_modules', name), { recursive: true, dereference: true });
}
await writeFile(join(runtime, 'manifest.json'), JSON.stringify({ commit, node: process.version, nodeSha256, entry: 'step/dist/bundle/step.js', patches: ['windows-build', 'desktop-auth-exports', 'desktop-memory-auth', 'subagent-child-env'], patchedSourceHashes }, null, 2));
console.log(`Staged Step Code ${commit} with ${process.version}`);
