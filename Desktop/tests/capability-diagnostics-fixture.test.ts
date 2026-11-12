import assert from 'node:assert/strict';
import { mkdtemp, readFile, rename, rm, rmdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const { pollCapabilityDiagnostic, readJsonDuringRefresh } = await import(
  new URL('../scripts/capability-diagnostics-fixture.mjs', import.meta.url).href);

test('manifest polling survives an actual missing-file replacement interval without accepting old contents', async t => {
  const root = await mkdtemp(join(tmpdir(), 'dfsc-diagnostic-manifest-'));
  const path = join(root, 'manifest.json'), previous = join(root, 'previous.json');
  t.after(async () => {
    await rm(path, { force: true });
    await rm(previous, { force: true });
    await rmdir(root);
  });
  await writeFile(path, '{"description":"old"}');
  assert.equal((await readJsonDuringRefresh(path)).description, 'old');
  await rename(path, previous);
  await assert.rejects(readFile(path, 'utf8'), { code: 'ENOENT' },
    'The previous direct-read predicate fails during this exact replacement interval');
  let reads = 0;
  const result = await pollCapabilityDiagnostic(async () => {
    const snapshot = await readJsonDuringRefresh(path);
    if (++reads === 1) {
      assert.equal(snapshot, undefined);
      await writeFile(path, '{"description":"new"}');
    }
    return snapshot;
  }, (value: { description: string } | undefined) => value?.description === 'new', 'replacement published');
  assert.equal(result.description, 'new');
  assert.equal(reads, 2);
});

test('only ENOENT is a pending file snapshot; malformed JSON and filesystem failures still fail', async () => {
  assert.equal(await readJsonDuringRefresh('unused', async () => {
    throw Object.assign(new Error('missing'), { code: 'ENOENT' });
  }), undefined);
  await assert.rejects(readJsonDuringRefresh('unused', async () => '{'), SyntaxError);
  for (const code of ['EACCES', 'EPERM', 'EBUSY', 'EIO']) {
    const failure = Object.assign(new Error('filesystem failure'), { code });
    await assert.rejects(readJsonDuringRefresh('unused', async () => { throw failure; }),
      error => error === failure);
  }
});

test('a missing or obsolete manifest cannot turn the polling deadline into success', async () => {
  for (const snapshot of [undefined, { description: 'old' }]) {
    let reads = 0;
    await assert.rejects(pollCapabilityDiagnostic(async () => { reads++; return snapshot; },
      (value: { description: string } | undefined) => value?.description === 'new', 'new revision', 0),
    /Timed out: new revision/);
    assert.equal(reads, 1);
  }
});

test('polling retains the existing shared-settings wait and propagates unrelated failures', async () => {
  let reads = 0;
  assert.equal(await pollCapabilityDiagnostic(async () => {
    if (++reads === 1) throw new Error('IPC failed: Error: Shared settings operation in progress');
    return true;
  }, (value: boolean) => value, 'settings released'), true);
  assert.equal(reads, 2);
  const failure = new Error('IPC disconnected');
  await assert.rejects(pollCapabilityDiagnostic(async () => { throw failure; },
    () => true, 'connected'), error => error === failure);
});

test('both in-flight market manifest checks use the narrow refresh reader', async () => {
  const source = await readFile(new URL('../scripts/verify-capability-diagnostics.mjs', import.meta.url), 'utf8');
  assert.equal((source.match(/poll\(\(\) => readJsonDuringRefresh\(/g) ?? []).length, 2);
  assert.doesNotMatch(source, /poll\(async \(\) => JSON\.parse\(await readFile/);
});
