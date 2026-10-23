import { _electron as electron } from 'playwright';
import { build } from 'esbuild';
import { mkdtemp, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import assert from 'node:assert/strict';

await mkdir('test-results', { recursive: true });
await build({ entryPoints: ['tests/fixtures/native-update-download-main.ts'], outfile: 'test-results/native-update-download-main.cjs',
  bundle: true, platform: 'node', format: 'cjs', external: ['electron'] });
const env = { ...process.env, DESKTOP_TEST_USER_DATA: await mkdtemp(join(tmpdir(), 'step-native-update-profile-')) };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ args: [resolve('test-results/native-update-download-main.cjs')], env });
try {
  await app.firstWindow();
  for (const [mode, expected] of [['complete', 'verified'], ['metadata', 'metadata'], ['corrupt', 'integrity'], ['cancel', 'cancelled'], ['retry', 'verified']]) {
    const result = await app.evaluate(async (_electron, mode) =>
      globalThis.updateDownloadFixture.run(mode, mode === 'cancel' ? 250 : 0), mode);
    console.log(`${mode}: ${JSON.stringify(result)}`);
    assert.equal(result.outcome, expected, `${mode}: ${JSON.stringify(result)}`);
    assert.ok(result.requests >= 1, `${mode}: ${JSON.stringify(result)}`);
    if (mode === 'metadata') assert.equal(result.requests, 1, 'invalid metadata cannot download the executable');
    if (mode === 'cancel') {
      assert.ok(result.requests >= 2, 'cancellation must exercise the installer transfer after metadata');
      assert.ok(result.progress >= 1, 'cancel after observed transfer progress, not a machine-dependent delay');
    }
    const probes = await app.evaluate(async () => globalThis.updateDownloadFixture.probe());
    assert.deepEqual(probes, ['probe-ok', 'probe-ok'], `${mode}: download hooks must not remain on either session`);
  }
  console.log('Native update download passed: real NSIS updater parsing, streaming, hashing, cancellation and retry; no installer executed.');
} finally { await app.close(); }
