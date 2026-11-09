import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

test('v0.1.7 retains the complete Desktop patch inventory without duplicate upstream overlays', async () => {
  const root = resolve('../patches/v017');
  const manifest = JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8'));
  const previous = JSON.parse(await readFile(resolve('../patches/v016/manifest.json'), 'utf8'));
  assert.equal(manifest.commit, '29eb460780489801ce8afc8bffc1a2efae7cbded');
  assert.deepEqual(manifest.upstream.commits, []);
  assert.deepEqual(Object.keys(manifest.patches), [...Object.keys(previous.patches),
    'step-code-desktop-v017.patch', 'step-code-desktop-mcp-credentials.patch']);
  assert.deepEqual(Object.keys(manifest.platforms.darwin.patches), Object.keys(previous.platforms.darwin.patches));
  const touched = new Set<string>();
  for (const [name, hash] of Object.entries(manifest.patches)) {
    const bytes = Buffer.from((await readFile(join(root, name), 'utf8')).replace(/\r\n/g, '\n'));
    assert.equal(createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex'), hash, name);
    for (const match of bytes.toString().matchAll(/^\+\+\+ b\/(.+)$/gm)) touched.add(match[1]);
  }
  assert.deepEqual([...touched].sort(), Object.keys(manifest.patchedSources).sort(),
    'Every shared patch output, including added files, must be checked before staging');
  for (const relative of Object.keys(previous.patchedSources)) {
    assert.ok(relative in manifest.patchedSources, `${relative} integration was lost in migration`);
  }
  for (const entries of [manifest.sources, manifest.patchedSources, manifest.platforms.darwin.patchedSources]) {
    for (const [relative, hash] of Object.entries(entries)) {
      assert.ok(touched.has(relative) || relative === 'packages/coding-agent/test/shell-process-tree-darwin.test.ts');
      assert.match(String(hash), /^[0-9a-f]{40}$/);
    }
  }
  for (const [name, hash] of Object.entries(manifest.platforms.darwin.patches)) {
    const bytes = Buffer.from((await readFile(join(root, name), 'utf8')).replace(/\r\n/g, '\n'));
    assert.equal(createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex'), hash, name);
  }
  const plan = await readFile(join(root, 'step-code-desktop-plan.patch'), 'utf8');
  assert.match(plan, /recordPendingProposal\(planHash\)/);
  assert.match(plan, /getLeafId\(\) === leafId/);
  assert.ok(!plan.includes('[Desktop Plan mode active]'), 'Use native mode announcements, not duplicated user text');
  const launch = await readFile(resolve('electron/session-collaboration.ts'), 'utf8');
  assert.match(launch, /'--desktop-plan-review', '--plan-review-surface'/);
  const stage = await readFile(resolve('scripts/stage-runtime.mjs'), 'utf8');
  assert.match(stage, /patches\/v017\/manifest\.json/);
  assert.match(stage, /'desktop-mcp-credential-isolation'/);
  const credentials = await readFile(join(root, 'step-code-desktop-mcp-credentials.patch'), 'utf8');
  assert.match(credentials, /-\s+const credential = readStoredCredential/);
  assert.match(credentials, /\+export const STEP_LOGIN_SUPPLIED_ENV: readonly string\[\] = \[\]/);
});

test('Shared v0.1.6 patch manifest pins every reviewed pre-image, result and patch', async () => {
  const root = resolve('../patches/v016');
  const manifest = JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8'));
  assert.equal(manifest.commit, '81e79bc4b699148d6823fedde9b5e70d9a80255f');
  assert.deepEqual(manifest.upstream.commits.map((entry: { sha: string }) => entry.sha), [
    '7487124e7b27c604535fc8439ccd0d0b81c5c299',
    '90a57820c81c6e78e4a3ea5be3f66694ac038611',
  ]);
  for (const entry of manifest.upstream.commits) {
    const bytes = Buffer.from((await readFile(join(root, entry.patch), 'utf8')).replace(/\r\n/g, '\n'));
    const actual = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
    assert.equal(actual, entry.hash, `${entry.patch} changed without a reviewed manifest update`);
  }
  assert.ok(Object.keys(manifest.sources).every(path => path in manifest.patchedSources));
  assert.deepEqual(Object.keys(manifest.patchedSources).filter(path => !(path in manifest.sources)).sort(), [
    'packages/coding-agent/src/core/session-import/parsers.ts',
    'packages/coding-agent/src/core/session-import/service.ts',
    'packages/coding-agent/src/core/session-import/types.ts',
    'packages/coding-agent/src/features/subagent/display-text.ts',
    'packages/coding-agent/src/modes/rpc/desktop-btw.ts',
    'packages/coding-agent/src/modes/rpc/desktop-completion-review.ts',
    'packages/coding-agent/test/desktop-background-replies.test.ts',
    'packages/coding-agent/test/session-import.test.ts',
  ]);
  assert.deepEqual(Object.keys(manifest.patches).sort(),
    ['step-code-desktop-auto-resume.patch', 'step-code-desktop-background-agents.patch', 'step-code-desktop-background-reply.patch', 'step-code-desktop-btw.patch',
      'step-code-desktop-clarification.patch', 'step-code-desktop-completion-review.patch', 'step-code-desktop-cron-enhancements.patch',
      'step-code-desktop-cron-management.patch',
      'step-code-desktop-cron-recovery-guard.patch', 'step-code-desktop-cron-recovery.patch',
      'step-code-desktop-cron-scope.patch', 'step-code-desktop-cron.patch',
      'step-code-desktop-plan.patch', 'step-code-desktop-plugins.patch', 'step-code-desktop-subagent-redaction.patch',
      'step-code-desktop-template-input.patch', 'step-code-desktop-v016.patch',
      'step-code-desktop.patch', 'step-code-session-import.patch']);
  assert.equal(manifest.sources['packages/coding-agent/src/features/step-cron.ts'], '6f881338a5d4ac34a416706a1e72b1f6e181cff3');
  assert.notEqual(manifest.patchedSources['packages/coding-agent/src/features/step-cron.ts'],
    manifest.sources['packages/coding-agent/src/features/step-cron.ts']);
  assert.ok(manifest.sources['packages/coding-agent/src/features/subagent/lane-lifecycle.ts']);
  assert.ok(await readFile(resolve('scripts/stage-runtime.mjs'), 'utf8').then(text => text.includes("'desktop-subagent-redaction'")),
    'staged runtime advertises the required subagent redaction boundary');
  assert.ok(await readFile(resolve('scripts/stage-runtime.mjs'), 'utf8').then(text => text.includes("'desktop-template-input'")),
    'staged runtime also retains template input provenance');
  for (const [name, hash] of Object.entries(manifest.patches)) {
    const bytes = Buffer.from((await readFile(join(root, name), 'utf8')).replace(/\r\n/g, '\n'));
    const actual = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
    assert.equal(actual, hash, `${name} changed without a reviewed manifest update`);
  }
  for (const sources of [manifest.sources, manifest.patchedSources]) {
    for (const [relative, hash] of Object.entries(sources)) {
      assert.match(relative, /^(packages\/coding-agent\/(?:src|test)\/|scripts\/)[a-zA-Z0-9/_-]+(?:\.test)?\.(?:ts|mjs)$/);
      assert.match(String(hash), /^[0-9a-f]{40}$/);
    }
  }
});

test('Darwin additions retain the complete shared integration and pin their own sources', async () => {
  const root = resolve('../patches/v016');
  const manifest = JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8'));
  const darwin = manifest.platforms.darwin;
  assert.deepEqual(darwin.patchIds, ['desktop-darwin-process-tree']);
  assert.deepEqual(Object.keys(darwin.patchedSources).sort(), [
    'packages/coding-agent/src/utils/shell.ts', 'packages/coding-agent/test/shell-process-tree-darwin.test.ts',
    'packages/coding-agent/test/workflow-extension.test.ts', 'packages/coding-agent/test/workflow-runtime.test.ts',
  ]);
  for (const [name, expected] of Object.entries(darwin.patches)) {
    const bytes = Buffer.from((await readFile(join(root, name), 'utf8')).replace(/\r\n/g, '\n'));
    assert.equal(createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex'), expected);
  }
  const stage = await readFile(resolve('scripts/stage-runtime.mjs'), 'utf8');
  assert.match(stage, /integrationManifest\.patchedSources, \.\.\.platformManifest\?\.patchedSources/);
  assert.match(stage, /'desktop-background-control'/);
  assert.match(stage, /'desktop-background-reply'/);
  assert.match(stage, /'desktop-btw'/);
  assert.ok(!stage.includes('3ba89e0cbfe6be78cccdafb5aeafd2592177cbb8'));
});

test('staging rejects the wrong upstream before touching runtime through every source selector', { skip: !['win32', 'darwin'].includes(process.platform) }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'desktop-stage-'));
  try {
    const upstream = join(root, 'Step-Code');
    const desktop = join(root, 'Desktop');
    const manifest = join(desktop, 'runtime', 'manifest.json');
    await mkdir(upstream);
    await mkdir(join(desktop, 'runtime'), { recursive: true });
    await writeFile(manifest, 'existing-runtime');
    execFileSync('git', ['init', '--quiet', upstream]);
    execFileSync('git', ['-C', upstream, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid',
      '-c', 'commit.gpgsign=false', 'commit', '--quiet', '--allow-empty', '-m', 'Fixture']);
    for (const selector of ['default', 'environment', 'argument']) {
      const env = { ...process.env };
      delete env.DESKTOP_STEP_CODE_SOURCE;
      if (selector === 'environment') env.DESKTOP_STEP_CODE_SOURCE = upstream;
      if (selector === 'argument') env.DESKTOP_STEP_CODE_SOURCE = join(root, 'missing-source');
      const result = spawnSync(process.execPath, [resolve('scripts/stage-runtime.mjs'), ...(selector === 'argument' ? [upstream] : [])],
        { cwd: desktop, env, encoding: 'utf8' });
      assert.equal(result.status, 1, selector);
      assert.match(result.stderr, /does not match the pinned Desktop baseline/, selector);
      assert.equal(await readFile(manifest, 'utf8'), 'existing-runtime', selector);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// A pin bump moves four things together: the guard, the patch, the apply script and the
// instructions. The first three are coupled by the guard itself; this couples the fourth so a
// stale build instruction fails in CI instead of on a contributor's machine.
test('every documented pin matches the staging guard', async () => {
  const guard = await readFile(resolve('scripts/stage-runtime.mjs'), 'utf8');
  const manifest = JSON.parse(await readFile(resolve('../patches/v017/manifest.json'), 'utf8'));
  const pin = manifest.commit;
  assert.match(guard, /const PINNED_COMMIT = integrationManifest.commit/);
  assert.match(pin ?? '', /^[0-9a-f]{40}$/, 'staging guard declares a pin');
  // Dated verification records legitimately keep the pin they were built with, so only the
  // locations that tell someone what to check out are listed here.
  for (const doc of ['../README.md', '../README.zh-CN.md', '../patches/README.md', '../docs/RELEASE.md', '../docs/MACOS.md']) {
    const text = await readFile(resolve(doc), 'utf8');
    assert.ok(text.includes(pin!), `${doc} still documents an older pin than the staging guard`);
  }
  for (const doc of ['../README.md', '../README.zh-CN.md']) {
    const text = await readFile(resolve(doc), 'utf8');
    assert.match(text, /apply-step-code-desktop-patch\.mjs Step-Code patches\\v017\\step-code-desktop\.patch/,
      `${doc} must apply the patch chain for the documented pin`);
  }
  assert.match(await readFile(resolve('../docs/MACOS.md'), 'utf8'),
    /apply-step-code-desktop-patch\.mjs Step-Code patches\/v017\/step-code-desktop\.patch/);
  // The workflow already fails when the two drift, because the applier checks the pinned
  // pre-image hashes, but that error blames the upstream source. Checking here names the cause.
  for (const buildPath of ['../.github/workflows/windows-integration.yml', '../.github/actions/setup-macos/action.yml']) {
    const build = await readFile(resolve(buildPath), 'utf8');
    assert.ok(build.includes(pin!), `${buildPath} still pins an older Step Code revision`);
    assert.match(build, /patches\/v017\/step-code-desktop\.patch/,
      `${buildPath} must apply the patch chain for the checked pin`);
  }
  for (const workflowPath of ['../.github/workflows/macos-integration.yml', '../.github/workflows/macos-acceptance.yml']) {
    const workflow = await readFile(resolve(workflowPath), 'utf8');
    assert.match(workflow, /uses: \.\/\.github\/actions\/setup-macos/, `${workflowPath} must use the checked native build action`);
  }
});

test('runtime packaging and standalone worker helpers use the current integration manifest', async () => {
  for (const helper of [
    'stage-runtime.mjs', 'build-remote-adapter.mjs', 'verify-usage-worker.mjs', 'verify-macos-package.mjs',
    'build-plugin-center-verification.mjs', 'package-plugin-center-preview.mjs',
    'verify-plugin-center-package.mjs',
  ]) {
    const text = await readFile(resolve('scripts', helper), 'utf8');
    const selectors = text.match(/patches\/v\d{3}(?:\/manifest\.json)?/g) ?? [];
    assert.ok(selectors.length > 0, `${helper} must select a reviewed integration manifest`);
    assert.ok(selectors.every(selector => selector.startsWith('patches/v017')),
      `${helper} still selects an older integration manifest`);
  }
});

test('staging includes the capability admin failure classifier', async () => {
  const stage = await readFile(resolve('scripts/stage-runtime.mjs'), 'utf8');
  const admin = await readFile(resolve('electron/capability-admin.mjs'), 'utf8');
  assert.match(admin, /from '\.\/capability-failure\.mjs'/);
  assert.ok(stage.includes("await cp('electron/capability-failure.mjs', join(runtime, 'capability-failure.mjs'))"));
  assert.match(admin, /refreshMarketplace: refreshGitMarketplace/);
  assert.ok(stage.includes("await cp('electron/marketplace-refresh.mjs', join(runtime, 'marketplace-refresh.mjs'))"));
  for (const name of ['build-plugin-center-verification.mjs', 'package-plugin-center-preview.mjs']) {
    const script = await readFile(resolve('scripts', name), 'utf8');
    assert.ok(script.includes("'marketplace-refresh.mjs'"), `${name} must include the Git refresher`);
  }
});
