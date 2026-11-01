import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

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
    'packages/coding-agent/test/session-import.test.ts',
  ]);
  assert.deepEqual(Object.keys(manifest.patches).sort(),
    ['step-code-desktop-auto-resume.patch', 'step-code-desktop-clarification.patch', 'step-code-desktop-cron-enhancements.patch',
      'step-code-desktop-cron-management.patch',
      'step-code-desktop-cron-recovery-guard.patch', 'step-code-desktop-cron-recovery.patch',
      'step-code-desktop-cron-scope.patch', 'step-code-desktop-cron.patch',
      'step-code-desktop-plan.patch', 'step-code-desktop-plugins.patch', 'step-code-desktop-v016.patch',
      'step-code-desktop.patch', 'step-code-session-import.patch']);
  assert.equal(manifest.sources['packages/coding-agent/src/features/step-cron.ts'], '6f881338a5d4ac34a416706a1e72b1f6e181cff3');
  assert.notEqual(manifest.patchedSources['packages/coding-agent/src/features/step-cron.ts'],
    manifest.sources['packages/coding-agent/src/features/step-cron.ts']);
  assert.ok(manifest.sources['packages/coding-agent/src/features/subagent/lane-lifecycle.ts']);
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
test('every documented pin matches the staging guard', { skip: !['win32', 'darwin'].includes(process.platform) }, async () => {
  const guard = await readFile(resolve('scripts/stage-runtime.mjs'), 'utf8');
  const manifest = JSON.parse(await readFile(resolve('../patches/v016/manifest.json'), 'utf8'));
  const pin = manifest.commit;
  assert.match(guard, /const PINNED_COMMIT = integrationManifest.commit/);
  assert.match(pin ?? '', /^[0-9a-f]{40}$/, 'staging guard declares a pin');
  // Dated verification records legitimately keep the pin they were built with, so only the
  // locations that tell someone what to check out are listed here.
  for (const doc of ['../README.md', '../README.zh-CN.md', '../patches/README.md', '../docs/RELEASE.md']) {
    const text = await readFile(resolve(doc), 'utf8');
    assert.ok(text.includes(pin!), `${doc} still documents an older pin than the staging guard`);
  }
  // The workflow already fails when the two drift, because the applier checks the pinned
  // pre-image hashes, but that error blames the upstream source. Checking here names the cause.
  const workflowPath = process.platform === 'win32' ? '../.github/workflows/windows-integration.yml' : '../.github/workflows/macos-integration.yml';
  const workflow = await readFile(resolve(workflowPath), 'utf8');
  assert.ok(workflow.includes(pin!), `${workflowPath} still pins an older Step Code revision`);
});
