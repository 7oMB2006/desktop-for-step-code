import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { dataOnlyThemeFingerprint, packageFingerprint } from '../electron/plugin-files.mjs';

async function fixture(t: test.TestContext) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'dfsc-theme-safety-')));
  const manifest = { id: 'theme', name: 'Theme', version: '1.0.0', skills: [], commands: [], agents: [] };
  const save = (value: unknown) => writeFile(join(root, 'step.plugin.json'), JSON.stringify(value));
  await save(manifest);
  await writeFile(join(root, 'dfsc.theme.json'), '{"schemaVersion":1,"renderer":"stellar-v1"}');
  t.after(() => rm(root, { recursive: true, force: true, maxRetries: 5 }));
  return { root, manifest, save };
}

test('pure theme proof freezes the full package, including undeclared assets', async t => {
  const f = await fixture(t);
  const before = await dataOnlyThemeFingerprint(f.root, 'theme');
  assert.equal(before, await packageFingerprint(f.root));
  await writeFile(join(f.root, 'scene.json'), '{"stars":1}');
  const after = await dataOnlyThemeFingerprint(f.root, 'theme');
  assert.equal(after, await packageFingerprint(f.root));
  assert.notEqual(after, before);
  assert.equal(await dataOnlyThemeFingerprint(f.root, 'different-id'), undefined);
});

for (const extra of [
  { entry: 'index.js' }, { skills: ['skills'] }, { commands: ['commands'] }, { agents: ['agents'] },
  { mcpServers: { tools: { command: 'never-run' } } }, { mcpServers: 'mcp.json' },
  { skills: null }, { futureCapability: {} }, { provision: {} },
]) {
  test(`pure theme proof refuses ${JSON.stringify(extra)}`, async t => {
    const f = await fixture(t);
    await f.save({ ...f.manifest, ...extra });
    assert.equal(await dataOnlyThemeFingerprint(f.root, 'theme'), undefined);
  });
}

for (const key of ['skills', 'commands', 'agents'] as const) {
  test(`pure theme proof requires explicit empty ${key}, even without a conventional directory`, async t => {
    const f = await fixture(t);
    const omitted: Record<string, unknown> = { ...f.manifest };
    delete omitted[key];
    await f.save(omitted);
    assert.equal(await dataOnlyThemeFingerprint(f.root, 'theme'), undefined);
    await mkdir(join(f.root, key));
    await writeFile(join(f.root, key, key === 'skills' ? 'SKILL.md' : 'hidden.md'), '# Undeclared capability');
    assert.equal(await dataOnlyThemeFingerprint(f.root, 'theme'), undefined);
  });
}

test('pure theme proof accepts an empty service declaration but not missing or unknown theme metadata', async t => {
  const f = await fixture(t);
  await f.save({ ...f.manifest, mcpServers: {} });
  assert.equal(await dataOnlyThemeFingerprint(f.root, 'theme'), await packageFingerprint(f.root));
  for (const metadata of ['{}', '{"schemaVersion":2,"renderer":"stellar-v1"}', '{"schemaVersion":1,"renderer":"executable"}', '{']) {
    await writeFile(join(f.root, 'dfsc.theme.json'), metadata);
    assert.equal(await dataOnlyThemeFingerprint(f.root, 'theme'), undefined);
  }
  await rm(join(f.root, 'dfsc.theme.json'));
  assert.equal(await dataOnlyThemeFingerprint(f.root, 'theme'), undefined);
});

test('pure theme proof refuses a linked package subtree', async t => {
  const f = await fixture(t);
  const target = join(f.root, 'assets');
  await mkdir(target);
  await symlink(target, join(f.root, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.equal(await dataOnlyThemeFingerprint(f.root, 'theme'), undefined);
});
