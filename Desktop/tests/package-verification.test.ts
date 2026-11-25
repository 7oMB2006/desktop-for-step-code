import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, realpath, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative } from 'node:path';
import test from 'node:test';
import { mkdtemp, removeTestProfile } from '../scripts/test-profile.mjs';
import { defaultRuntimeBaseline } from '../scripts/runtime-baseline.mjs';

const copiedHelpers = ['admin.mjs', 'windows-runtime-job.ps1', 'capability-admin.mjs', 'capability-failure.mjs',
  'marketplace-refresh.mjs', 'capability-settings.mjs', 'plugin-files.mjs', 'plugin-read-scope.mjs', 'plugin-release.mjs',
  'theme-composition.mjs', 'plugin-update.mjs', 'plugin-schema-update.mjs', 'plugin-configuration.mjs',
  'session-import.mjs', 'session-history.mjs', 'session-search.mjs', 'steppage-config.mjs', 'usage-overview.mjs',
  'desktop-sessions.mjs', 'desktop-remote.mjs', 'desktop-web-search.mjs', 'native-step-search.mjs',
  'runtime-compile-cache.mjs', 'remote-channel.mjs',
  'remote-channel-core.mjs', 'remote-media-channel.mjs', 'remote-card.mjs', 'remote-form.mjs'];
const bundledHelpers = ['compaction-configuration.mjs', 'project-instructions.mjs', 'remote-markdown.mjs',
  'session-reading-worker.mjs'];
const windowsOnly = { skip: process.platform !== 'win32' };

type Fixture = { root: string; script: string; runtime: string; terminal: string; electron: string };

async function fixture(action: (value: Fixture) => Promise<void>, missing?: string) {
  const owned = await mkdtemp(join(tmpdir(), 'desktop-package-preflight-'));
  const root = await realpath(owned);
  const repository = join(root, 'checkout'), desktop = join(repository, 'Desktop');
  const runtime = join(root, 'shared-runtime'), terminal = join(root, 'shared-terminal');
  const electron = join(root, 'shared-electron');
  const file = async (path: string, content: string | Uint8Array) => {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content);
  };
  try {
    const script = join(desktop, 'scripts/package-verification.mjs');
    await file(script, await readFile(new URL('../scripts/package-verification.mjs', import.meta.url)));
    await file(join(desktop, 'scripts/runtime-baseline.mjs'), await readFile(new URL('../scripts/runtime-baseline.mjs', import.meta.url)));
    for (const path of [runtime, terminal, electron, join(desktop, 'node_modules/electron')])
      await mkdir(path, { recursive: true });
    await symlink(runtime, join(desktop, 'runtime'), 'junction');
    await symlink(terminal, join(desktop, 'terminal-runtime'), 'junction');
    await symlink(electron, join(desktop, 'node_modules/electron/dist'), 'junction');
    const node = 'Synthetic fixture bytes, never executed.';
    await file(join(runtime, 'node/node.exe'), node);
    const patchedSources = { 'fixture/source.ts': 'fixture-source-hash' };
    const commit = 'fixture-pinned-commit';
    await file(join(repository, 'patches', defaultRuntimeBaseline, 'manifest.json'), JSON.stringify({ commit, patchedSources }));
    await file(join(runtime, 'manifest.json'), JSON.stringify({
      commit, patchedSourceHashes: patchedSources, platform: 'win32', arch: 'x64',
      nodeSha256: createHash('sha256').update(node).digest('hex'),
    }));
    for (const name of copiedHelpers) {
      const content = `// Synthetic copied helper: ${name}\n`;
      await file(join(desktop, 'electron', name), content);
      if (name !== missing) await file(join(runtime, name), content);
    }
    for (const name of bundledHelpers)
      if (name !== missing) await file(join(runtime, name), `// Synthetic bundled helper: ${name}\n`);
    await action({ root, script, runtime, terminal, electron });
  } finally { await removeTestProfile(owned); }
}

async function rejectedBeforeOutput(value: Fixture, output: string, expected: RegExp) {
  const withinOwned = relative(value.root, output);
  assert.ok(withinOwned && !withinOwned.startsWith('..') && !isAbsolute(withinOwned),
    'The fixture must never pass real package input paths to the CLI');
  const result = spawnSync(process.execPath, [value.script, output], {
    encoding: 'utf8', timeout: 15000, windowsHide: true,
    env: { ...process.env, DESKTOP_RUNTIME_BASELINE: defaultRuntimeBaseline },
  });
  assert.ifError(result.error);
  assert.notEqual(result.status, 0, result.stdout);
  assert.equal(result.signal, null);
  assert.match(result.stderr, expected);
  await assert.rejects(lstat(output), { code: 'ENOENT' },
    'Preflight must fail before mkdir(output), staging or electron-builder');
  return result.stderr;
}

for (const input of ['runtime', 'terminal', 'electron'] as const) {
  test(`package preflight rejects output inside the external ${input} input`, windowsOnly,
    () => fixture(async value => {
      const output = join(value[input], 'verification-output');
      await rejectedBeforeOutput(value, output, /Output must not overlap shared package inputs/);
    }));
}

for (const name of [...copiedHelpers, ...bundledHelpers]) {
  test(`package preflight rejects missing required helper ${name} before creating output`, windowsOnly,
    () => fixture(async value => {
      const stderr = await rejectedBeforeOutput(value, join(value.root, 'verification-output'), /ENOENT/);
      assert.ok(stderr.includes(name), 'The rejected helper is identified in the fixture failure');
    }, name));
}

test('package preflight rejects a copied helper that differs from the checkout', windowsOnly,
  () => fixture(async value => {
    await writeFile(join(value.runtime, 'marketplace-refresh.mjs'), '// Different fixture bytes\n');
    await rejectedBeforeOutput(value, join(value.root, 'verification-output'),
      /Runtime helper must match this checkout: marketplace-refresh\.mjs/);
  }));

test('package preflight rejects empty bundled helpers before creating output', windowsOnly,
  () => fixture(async value => {
    await writeFile(join(value.runtime, 'remote-markdown.mjs'), '');
    await rejectedBeforeOutput(value, join(value.root, 'verification-output'),
      /Missing bundled runtime helper: remote-markdown\.mjs/);
  }));
