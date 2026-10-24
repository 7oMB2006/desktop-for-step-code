import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

test('Windows v0.1.5 patch manifest pins every reviewed pre-image, result and patch', async () => {
  const root = resolve('../patches/v015');
  const manifest = JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8'));
  assert.equal(manifest.commit, 'b5dbed938d9ae589397cf522dcf2ff89ecf4c494');
  assert.ok(Object.keys(manifest.sources).every(path => path in manifest.patchedSources));
  assert.deepEqual(Object.keys(manifest.patchedSources).filter(path => !(path in manifest.sources)).sort(), [
    'packages/coding-agent/src/core/session-import/parsers.ts',
    'packages/coding-agent/src/core/session-import/service.ts',
    'packages/coding-agent/src/core/session-import/types.ts',
    'packages/coding-agent/test/session-import.test.ts',
  ]);
  assert.deepEqual(Object.keys(manifest.patches).sort(),
    ['../step-code-desktop-cron-management.patch', '../step-code-desktop-cron.patch', '../step-code-desktop-plugins.patch',
      'step-code-desktop-clarification.patch', 'step-code-desktop-cron-recovery.patch',
      'step-code-desktop-cron-scope.patch',
      'step-code-desktop-plan.patch', 'step-code-desktop.patch', 'step-code-session-import.patch']);
  assert.equal(manifest.sources['packages/coding-agent/src/features/step-cron.ts'], '6f881338a5d4ac34a416706a1e72b1f6e181cff3');
  assert.equal(manifest.patchedSources['packages/coding-agent/src/features/step-cron.ts'], 'e8c8b01996e2db1ce4da00c0217dd5b1f62a6a7c');
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
  const manifest = JSON.parse(await readFile(resolve('../patches/v015/manifest.json'), 'utf8'));
  const pin = process.platform === 'win32' ? manifest.commit
    : guard.match(/: '([0-9a-f]{40})'/)?.[1];
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
