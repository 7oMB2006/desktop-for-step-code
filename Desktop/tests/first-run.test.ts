import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FirstRun } from '../electron/first-run';

async function profile(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'desktop-first-run-unit-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

test('fresh Desktop profiles stay pending through interrupted setup and renderer reload', async t => {
  const root = await profile(t);
  const first = new FirstRun(root);
  await first.initialize();
  assert.equal(first.required, true);
  await writeFile(join(root, 'preferences.json'), '{}');
  const restarted = new FirstRun(root);
  await restarted.initialize();
  assert.equal(restarted.required, true, 'setup writes must not bypass unfinished onboarding');
});

for (const outcome of ['completed', 'skipped'] as const) {
  test(`${outcome} survives updates and reinstalls retaining the same Desktop profile`, async t => {
    const root = await profile(t);
    const first = new FirstRun(root);
    await first.initialize();
    await first.finish(outcome);
    await first.finish(outcome);
    const restarted = new FirstRun(root);
    await restarted.initialize();
    assert.equal(restarted.required, false);
    assert.equal(JSON.parse(await readFile(join(root, 'first-run.json'), 'utf8')).outcome, outcome);
    const clean = new FirstRun(await profile(t));
    await clean.initialize();
    assert.equal(clean.required, true);
  });
}

for (const name of ['preferences.json', 'step-runtime/config.toml', 'step-runtime/auth.dpapi',
  'step-runtime/auth.json', 'step-runtime/legacy-auth.json', 'step-runtime/models.json',
  'step-runtime/sessions/project/session.jsonl']) {
  test(`legacy profile with ${name} bypasses onboarding without reading credentials`, async t => {
    const root = await profile(t);
    const file = join(root, name);
    await mkdir(join(file, '..'), { recursive: true });
    await writeFile(file, 'existing user-owned data');
    const first = new FirstRun(root);
    await first.initialize();
    assert.equal(first.required, false);
    assert.equal(await readFile(file, 'utf8'), 'existing user-owned data');
    const restarted = new FirstRun(root);
    await restarted.initialize();
    assert.equal(restarted.required, false);
  });
}

test('Electron caches and empty runtime directories alone are not existing user setup', async t => {
  const root = await profile(t);
  await mkdir(join(root, 'Cache'), { recursive: true });
  await mkdir(join(root, 'step-runtime/sessions'), { recursive: true });
  const first = new FirstRun(root);
  await first.initialize();
  assert.equal(first.required, true);
  await assert.rejects(first.finish('pending' as 'completed'), /Invalid first-run outcome/);
  assert.equal(first.required, true);
});

test('corrupt or future marker preserves the profile without blocking startup or overwriting it', async t => {
  const root = await profile(t);
  for (const content of ['not json', '{"version":2,"outcome":"completed"}', '{"version":1,"outcome":"other"}']) {
    await writeFile(join(root, 'first-run.json'), content);
    const first = new FirstRun(root);
    await first.initialize();
    assert.equal(first.required, false);
    await first.finish('skipped');
    assert.equal(await readFile(join(root, 'first-run.json'), 'utf8'), content);
  }
});
