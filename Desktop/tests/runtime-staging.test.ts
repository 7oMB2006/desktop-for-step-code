import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

test('staging rejects the wrong upstream before touching runtime through every source selector', { skip: process.platform !== 'win32' }, async () => {
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
test('every documented pin matches the staging guard', { skip: process.platform !== 'win32' }, async () => {
  const guard = await readFile(resolve('scripts/stage-runtime.mjs'), 'utf8');
  const pin = guard.match(/const PINNED_COMMIT = '([0-9a-f]{40})'/)?.[1];
  assert.match(pin ?? '', /^[0-9a-f]{40}$/, 'staging guard declares a pin');
  // Dated verification records legitimately keep the pin they were built with, so only the
  // locations that tell someone what to check out are listed here.
  for (const doc of ['../README.md', '../README.zh-CN.md', '../patches/README.md', '../docs/RELEASE.md']) {
    const text = await readFile(resolve(doc), 'utf8');
    assert.ok(text.includes(pin!), `${doc} still documents an older pin than the staging guard`);
  }
});
