import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';

test('staging rejects the wrong upstream before touching runtime through every source selector', async () => {
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
  const pin = guard.match(/const PINNED_COMMIT = '([0-9a-f]{40})'/)?.[1];
  assert.match(pin ?? '', /^[0-9a-f]{40}$/, 'staging guard declares a pin');
  // Dated verification records legitimately keep the pin they were built with, so only the
  // locations that tell someone what to check out are listed here.
  for (const doc of ['../README.md', '../README.zh-CN.md', '../patches/README.md', '../docs/RELEASE.md']) {
    const text = await readFile(resolve(doc), 'utf8');
    assert.ok(text.includes(pin!), `${doc} still documents an older pin than the staging guard`);
  }
  // The workflow already fails when the two drift, because the applier checks the pinned
  // pre-image hashes, but that error blames the upstream source. Checking here names the cause.
  for (const name of ['pr-ci.yml', 'windows-integration.yml']) {
    const workflow = await readFile(resolve(`../.github/workflows/${name}`), 'utf8');
    assert.ok(workflow.includes(pin!), `${name} still pins an older Step Code revision`);
  }
});

test('Linux packaging includes standalone Node PTY binaries and a PNG icon', async () => {
  const { scripts, build } = JSON.parse(await readFile(resolve('package.json'), 'utf8'));
  assert.equal(scripts.package, 'pnpm build && pnpm stage:runtime && electron-builder --win nsis --x64');
  assert.match(scripts['package:linux'], /electron-builder --linux tar\.gz --x64$/);
  assert.deepEqual(build.linux.target, ['tar.gz']);
  assert.equal(build.linux.icon, 'build/icon.png');
  const pty = build.extraResources.find((item: any) => item.to === 'terminal-runtime/node_modules/node-pty');
  assert.ok(pty.filter.includes('prebuilds/win32-${arch}/**'));
  assert.ok(pty.filter.includes('prebuilds/linux-${arch}/**'));
  assert.ok(!pty.filter.some((pattern: string) => pattern.includes('${os}')));
  assert.match(scripts.test, /^node scripts\/build-terminal\.mjs && /);
  assert.ok(pty.filter.includes('build/Release/*.node'));
  assert.ok(pty.filter.includes('build/Release/spawn-helper'));
  assert.ok(build.extraResources.some((item: any) => item.to === 'icon.png'));
});


test('packaging refuses cross-platform, stale and unsupported runtime targets', () => {
  const { assertRuntimeTarget } = createRequire(import.meta.url)('../scripts/verify-package-runtime.cjs');
  const linux = { platform: 'linux', arch: 'x64', nodeExecutable: 'node' };
  const windows = { platform: 'win32', arch: 'x64', nodeExecutable: 'node.exe' };
  assert.doesNotThrow(() => assertRuntimeTarget(linux, 'linux', 1, 'linux', 'x64'));
  assert.doesNotThrow(() => assertRuntimeTarget(windows, 'win32', 1, 'win32', 'x64'));
  assert.throws(() => assertRuntimeTarget(linux, 'win32', 1, 'linux', 'x64'), /cross-platform/);
  assert.throws(() => assertRuntimeTarget(windows, 'linux', 1, 'linux', 'x64'), /does not match/);
  assert.throws(() => assertRuntimeTarget({}, 'linux', 1, 'linux', 'x64'), /does not match/);
  assert.throws(() => assertRuntimeTarget(linux, 'linux', 3, 'linux', 'arm64'), /cross-platform/);
  assert.throws(() => assertRuntimeTarget(linux, 'darwin', 1, 'darwin', 'x64'), /cross-platform/);
});

test('beforePack accepts electron-builder context and the actual staged runtime', async () => {
  const verify = createRequire(import.meta.url)('../scripts/verify-package-runtime.cjs');
  await verify({ packager: { info: { appDir: resolve('.') } }, electronPlatformName: process.platform, arch: 1 });
});
