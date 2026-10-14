import { cp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve, dirname, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
const upstream = resolve(process.argv[2] ?? process.env.DESKTOP_STEP_CODE_SOURCE ?? '../Step-Code');
const runtime = resolve('runtime');
if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('Build this Windows x64 preview on Windows x64');
const PINNED_COMMIT = '3ba89e0cbfe6be78cccdafb5aeafd2592177cbb8';
const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: upstream, encoding: 'utf8' }).trim();
if (commit !== PINNED_COMMIT) {
  // Naming both sides keeps a stale build instruction from reading as a broken checkout.
  throw new Error(`Step Code source does not match the pinned Desktop baseline: source is at ${commit}, pinned is ${PINNED_COMMIT}; check out the pinned commit and reapply patches/step-code-desktop.patch`);
}
// The manifest advertises the patch set below, so staging must prove the sources are
// actually patched instead of trusting the working tree. `pnpm package` never applies the
// patch itself; CI does it separately, and an unpatched checkout staged locally would
// ship a runtime whose manifest claims patches that are not there.
const patchedFiles = [
  ['step-questionnaire.ts', 'packages/coding-agent/src/features/step-questionnaire.ts', 'ef6f3da34d401f6bdda4b33765938363df8b9926'],
  ['step-plan.ts', 'packages/coding-agent/src/features/step-plan.ts', '31fcf9db425d54bdba864630488ca7b8aef838bd'],
  ['plan-mode-tools.ts', 'packages/coding-agent/src/features/plan-mode-tools.ts', '671e70c74ad4ca9614fd641db8597649d6121cb4'],
  ['auth-storage.ts', 'packages/coding-agent/src/core/auth-storage.ts', 'a25fff15510b1bd9f009483717727f2fe19dc442'],
  ['index.ts', 'packages/coding-agent/src/index.ts', '8c4e177db7bf1c45b4ea4c9c9508e2be6c1f39a3'],
  ['build-coding-agent-bundle.mjs', 'scripts/build-coding-agent-bundle.mjs', '93aaca8db784bd66e45d0a1e4f177567a7c35272'],
  ['subagent-rpc-adapter.ts', 'packages/coding-agent/src/features/subagent/rpc-adapter.ts', '3ddc850f55fbd4947f0f980db5b4220ed55bb6d0'],
  ['rpc-mode.ts', 'packages/coding-agent/src/modes/rpc/rpc-mode.ts', '9ba054b6fe48ee7839ed66095215d4c985f56e4e'],
  ['rpc-types.ts', 'packages/coding-agent/src/modes/rpc/rpc-types.ts', '63e73570b724e9cecdfa192d984b5ea9b24677cb'],
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
const npmEntry = join(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js');
await readFile(npmEntry);
execFileSync(process.execPath, [npmEntry, '--prefix', source, 'run', 'build'], { cwd: upstream, stdio: 'inherit' });
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
await writeFile(join(runtime, 'manifest.json'), JSON.stringify({ commit, node: process.version, nodeSha256, entry: 'step/dist/bundle/step.js', patches: ['windows-build', 'desktop-auth-exports', 'desktop-memory-auth', 'subagent-child-env', 'desktop-summary-rpc', 'desktop-plan-review', 'desktop-clarification-beta'], patchedSourceHashes }, null, 2));
console.log(`Staged Step Code ${commit} with ${process.version}`);
