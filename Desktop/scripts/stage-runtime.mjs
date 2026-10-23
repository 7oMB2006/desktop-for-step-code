import { cp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve, dirname, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { assertStagingNodeVersion } from './staging-node-version.mjs';
const upstream = resolve(process.argv[2] ?? process.env.DESKTOP_STEP_CODE_SOURCE ?? '../Step-Code');
const runtime = resolve('runtime');
if (!((process.platform === 'win32' && process.arch === 'x64') || (process.platform === 'darwin' && ['arm64', 'x64'].includes(process.arch)))) throw new Error('Stage on Windows x64 or macOS arm64/x64');
const nodeExecutable = process.platform === 'win32' ? 'node.exe' : 'node';
const windowsManifest = JSON.parse(await readFile(new URL('../../patches/v015/manifest.json', import.meta.url), 'utf8'));
const PINNED_COMMIT = process.platform === 'win32'
  ? windowsManifest.commit
  : '3ba89e0cbfe6be78cccdafb5aeafd2592177cbb8';
const patchFile = process.platform === 'win32' ? 'patches/v015/step-code-desktop.patch' : 'patches/step-code-desktop.patch';
const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: upstream, encoding: 'utf8' }).trim();
if (commit !== PINNED_COMMIT) {
  // Naming both sides keeps a stale build instruction from reading as a broken checkout.
  throw new Error(`Step Code source does not match the pinned Desktop baseline: source is at ${commit}, pinned is ${PINNED_COMMIT}; check out the pinned commit and reapply ${patchFile}`);
}
assertStagingNodeVersion(process.version, process.platform);
// The manifest advertises the patch set below, so staging must prove the sources are
// actually patched instead of trusting the working tree. `pnpm package` never applies the
// patch itself; CI does it separately, and an unpatched checkout staged locally would
// ship a runtime whose manifest claims patches that are not there.
const patchedFiles = process.platform === 'win32'
  ? Object.entries(windowsManifest.patchedSources).map(([relative, expected]) => [relative.split('/').at(-1), relative, expected])
  : [
  ['step-cron.ts', 'packages/coding-agent/src/features/step-cron.ts', 'ce12a4056070feac64d5847fd743e57c6ac073d7'],
  ['step-questionnaire.ts', 'packages/coding-agent/src/features/step-questionnaire.ts', 'ef6f3da34d401f6bdda4b33765938363df8b9926'],
  ['step-plan.ts', 'packages/coding-agent/src/features/step-plan.ts', '31fcf9db425d54bdba864630488ca7b8aef838bd'],
  ['plan-mode-tools.ts', 'packages/coding-agent/src/features/plan-mode-tools.ts', '671e70c74ad4ca9614fd641db8597649d6121cb4'],
  ['auth-storage.ts', 'packages/coding-agent/src/core/auth-storage.ts', 'a25fff15510b1bd9f009483717727f2fe19dc442'],
  ['index.ts', 'packages/coding-agent/src/index.ts', '07195ff412c52287ce060ecf0cd434a31685047b'],
  ['build-coding-agent-bundle.mjs', 'scripts/build-coding-agent-bundle.mjs', '93aaca8db784bd66e45d0a1e4f177567a7c35272'],
  ['subagent-rpc-adapter.ts', 'packages/coding-agent/src/features/subagent/rpc-adapter.ts', '3ddc850f55fbd4947f0f980db5b4220ed55bb6d0'],
  ['rpc-mode.ts', 'packages/coding-agent/src/modes/rpc/rpc-mode.ts', 'e6a791e25edb478dc65dc4d9c64780e748a6af09'],
  ['rpc-types.ts', 'packages/coding-agent/src/modes/rpc/rpc-types.ts', 'ea782adea7960179e2ae2a9bb2e5df392cd99cd8'],
  ['mcp.ts', 'packages/coding-agent/src/step/mcp.ts', 'dd9bf2ce923497dcf5519ee5ee1aa88192c06731'],
];
const patchedSourceHashes = {};
for (const [name, relative, expected] of patchedFiles) {
  // hash-object applies the repository's own attribute filters (upstream pins
  // `* text=auto eol=lf`), so the check tolerates any line ending a checkout
  // produced instead of rejecting a correctly patched tree.
  const hash = execFileSync('git', ['hash-object', relative], { cwd: upstream, encoding: 'utf8' }).trim();
  if (hash !== expected) {
    throw new Error(`Patched source ${relative} does not match the expected content; apply scripts/apply-step-code-desktop-patch.mjs to the pinned checkout before staging`);
  }
  patchedSourceHashes[name] = hash;
}

const source = join(upstream, 'packages/coding-agent');
// Source hashes alone do not prove that dist/bundle contains those sources.
// Recompile the agent before bundling; the bundle helper only rebuilds the CLI.
const npmEntry = resolve(dirname(process.execPath), process.platform === 'win32' ? 'node_modules/npm/bin/npm-cli.js' : '../lib/node_modules/npm/bin/npm-cli.js');
await readFile(npmEntry);
execFileSync(process.execPath, [npmEntry, '--prefix', source, 'run', 'build'], { cwd: upstream, stdio: 'inherit' });
if (process.platform === 'win32') {
  // Exported management APIs can move the shared usage code into the root entry.
  // The upstream bundler deliberately emits its worker beside that code.
  await readFile(join(source, 'dist/bundle/chunks/activity-worker.js')).catch(error => {
    if (error.code !== 'ENOENT') throw error;
    return readFile(join(source, 'dist/bundle/activity-worker.js'));
  });
}
const currentNode = await readFile(process.execPath);
const nodeSha256 = createHash('sha256').update(currentNode).digest('hex');
let matchingLicense = false;
try {
  const previous = JSON.parse(await readFile(join(runtime, 'manifest.json'), 'utf8'));
  await readFile(join(runtime, 'node/LICENSE'));
  matchingLicense = previous.node === process.version && previous.nodeSha256 === nodeSha256;
} catch {}
await mkdir(join(runtime, 'node'), { recursive: true });
await cp(process.execPath, join(runtime, 'node', nodeExecutable));
if (!matchingLicense) {
  const licenseResponse = await fetch(`https://raw.githubusercontent.com/nodejs/node/${process.version}/LICENSE`);
  if (!licenseResponse.ok) throw new Error('Unable to obtain the matching Node distribution license');
  await writeFile(join(runtime, 'node/LICENSE'), await licenseResponse.text());
}
await cp(join(source, 'dist'), join(runtime, 'step/dist'), { recursive: true });
for (const name of ['package.json', 'README.md']) await cp(join(source, name), join(runtime, 'step', name));
for (const name of ['LICENSE', 'NOTICE', 'THIRD_PARTY_NOTICES.md']) await cp(join(upstream, name), join(runtime, name));
await cp('electron/admin.mjs', join(runtime, 'admin.mjs'));
await cp('electron/capability-admin.mjs', join(runtime, 'capability-admin.mjs'));
await cp('electron/capability-settings.mjs', join(runtime, 'capability-settings.mjs'));
await cp('electron/session-import.mjs', join(runtime, 'session-import.mjs'));
await cp('electron/steppage-config.mjs', join(runtime, 'steppage-config.mjs'));
await cp('electron/usage-overview.mjs', join(runtime, 'usage-overview.mjs'));
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
await writeFile(join(runtime, 'manifest.json'), JSON.stringify({ commit, platform: process.platform, arch: process.arch, node: process.version, nodeSha256, entry: 'step/dist/bundle/step.js', patches: ['windows-build', 'desktop-auth-exports', 'desktop-memory-auth', 'subagent-child-env', 'desktop-summary-rpc', 'desktop-plan-review', 'desktop-clarification-beta', 'desktop-cron-state', 'desktop-cron-management', 'desktop-plugin-management', ...(process.platform === 'win32' ? ['desktop-cron-recovery', 'desktop-session-import', 'desktop-session-cron-scope'] : [])], patchedSourceHashes }, null, 2));
console.log(`Staged Step Code ${commit} with ${process.version}`);
