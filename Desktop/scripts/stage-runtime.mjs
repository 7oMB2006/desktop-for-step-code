import { cp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve, dirname, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { assertStagingNodeVersion } from './staging-node-version.mjs';
const upstream = resolve(process.argv[2] ?? process.env.DESKTOP_STEP_CODE_SOURCE ?? '../Step-Code');
const runtime = resolve('runtime');
if (!((process.platform === 'win32' && process.arch === 'x64') || (process.platform === 'darwin' && ['arm64', 'x64'].includes(process.arch)))) throw new Error('Stage on Windows x64 or macOS arm64/x64');
const nodeExecutable = process.platform === 'win32' ? 'node.exe' : 'node';
const integrationManifest = JSON.parse(await readFile(new URL('../../patches/v016/manifest.json', import.meta.url), 'utf8'));
const platformManifest = integrationManifest.platforms?.[process.platform];
const PINNED_COMMIT = integrationManifest.commit;
const patchFile = 'patches/v016/step-code-desktop.patch';
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
const patchedFiles = Object.entries({ ...integrationManifest.patchedSources, ...platformManifest?.patchedSources })
  // Full paths distinguish core/extensions/types.ts from session-import/types.ts.
  .map(([relative, expected]) => [relative, relative, expected]);
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
for (const worker of ['activity-worker.js', 'session-index-worker.js', 'image-resize-worker.js']) {
  // Worker URLs are relative to their owning bundle chunk, not always the root.
  await readFile(join(source, 'dist/bundle/chunks', worker)).catch(error => {
    if (error.code !== 'ENOENT') throw error;
    return readFile(join(source, 'dist/bundle', worker));
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
// Restaging over an identical binary is a pure rewrite; behavior-monitoring security
// software can deny rewriting a live node.exe while still allowing the first copy.
const stagedNode = join(runtime, 'node', nodeExecutable);
const alreadyStaged = await readFile(stagedNode).then(staged => staged.equals(currentNode)).catch(() => false);
if (!alreadyStaged) await cp(process.execPath, stagedNode);
if (!matchingLicense) {
  // The Node distribution ships its own license, which is the exact copy for the
  // bundled binary; the version-tagged remote file is the fallback for a bare node.
  const licenseText = await readFile(join(dirname(process.execPath), 'LICENSE'), 'utf8').catch(() => undefined)
    ?? await (async () => {
      const licenseResponse = await fetch(`https://raw.githubusercontent.com/nodejs/node/${process.version}/LICENSE`);
      if (!licenseResponse.ok) throw new Error('Unable to obtain the matching Node distribution license');
      return licenseResponse.text();
    })();
  await writeFile(join(runtime, 'node/LICENSE'), licenseText);
}
// A bundle rebuild can rename chunks or remove obsolete exports. Copying over the
// old dist would retain those files in the packaged runtime. All source guards and
// the upstream build above have succeeded before replacing this generated tree.
await rm(join(runtime, 'step/dist'), { recursive: true, force: true });
await cp(join(source, 'dist'), join(runtime, 'step/dist'), { recursive: true });
for (const name of ['package.json', 'README.md']) await cp(join(source, name), join(runtime, 'step', name));
for (const name of ['LICENSE', 'NOTICE', 'THIRD_PARTY_NOTICES.md']) await cp(join(upstream, name), join(runtime, name));
await cp('electron/admin.mjs', join(runtime, 'admin.mjs'));
await cp('electron/capability-admin.mjs', join(runtime, 'capability-admin.mjs'));
await cp('electron/capability-settings.mjs', join(runtime, 'capability-settings.mjs'));
await cp('electron/session-import.mjs', join(runtime, 'session-import.mjs'));
await cp('electron/session-history.mjs', join(runtime, 'session-history.mjs'));
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
await writeFile(join(runtime, 'manifest.json'), JSON.stringify({ commit, upstreamCommits: (integrationManifest.upstream?.commits ?? []).map(entry => entry.sha), platform: process.platform, arch: process.arch, node: process.version, nodeSha256, entry: 'step/dist/bundle/step.js', patches: ['windows-build', 'desktop-auth-exports', 'desktop-memory-auth', 'subagent-child-env', 'desktop-summary-rpc', 'desktop-plan-review', 'desktop-clarification-beta', 'desktop-cron-state', 'desktop-cron-management', 'desktop-plugin-management', 'desktop-cron-recovery', 'desktop-cron-management-beta', 'desktop-cron-recovery-guard', 'desktop-session-import', 'desktop-session-cron-scope', 'desktop-auto-resume-origin', 'desktop-background-lifecycle', ...(platformManifest?.patchIds ?? [])], patchedSourceHashes }, null, 2));
console.log(`Staged Step Code ${commit} with ${process.version}`);
