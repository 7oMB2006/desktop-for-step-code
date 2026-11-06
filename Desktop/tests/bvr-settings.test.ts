import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { parseEnv } from 'node:util';
import { BvrSettings } from '../electron/bvr-settings';
import type { BvrConfiguration, BvrConfigurationInput } from '../src/bvr-settings';

function input(value: BvrConfiguration, runtimeDirectory: string): BvrConfigurationInput {
  const { revision, mode, apiBase, model, asrApiBase, asrModel, cookieFile, proxy, downloadDirectory, preferCaptions } = value;
  return { revision, mode, runtimeDirectory, apiBase, model, asrApiBase, asrModel, cookieFile, proxy, downloadDirectory, preferCaptions };
}
async function fixture(t: test.TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'desktop-bvr-settings-'));
  t.after(() => rm(root, { recursive: true, force: true, maxRetries: 3 }));
  const runtime = join(root, 'runtime');
  await mkdir(join(runtime, 'src'), { recursive: true });
  await writeFile(join(runtime, 'src', 'index.ts'), 'throw new Error("Must not execute runtime during environment checks");');
  await writeFile(join(runtime, 'package.json'), JSON.stringify({ name: 'bilibili-video-research-mcp', dfscConfigurationVersion: 1 }));
  for (const name of ['tsx', 'dotenv', '@modelcontextprotocol/sdk', '@google/genai', 'zod', 'ffmpeg-static', 'yt-dlp-exec']) {
    const directory = join(runtime, 'node_modules', name);
    await mkdir(join(directory, 'server'), { recursive: true });
    await writeFile(join(directory, 'package.json'), JSON.stringify({ name, main: 'index.js' }));
    await writeFile(join(directory, 'index.js'), 'throw new Error("Do not execute");');
    await writeFile(join(directory, 'server/index.js'), 'throw new Error("Do not execute");');
  }
  let invalidated = 0;
  const store = new BvrSettings(root, () => { invalidated++; });
  return { root, runtime, store, invalidated: () => invalidated };
}
test('BVR reads never opt in; environment checks never import or call the runtime', async t => {
  const { store, root, runtime, invalidated } = await fixture(t);
  const draft = await store.read();
  assert.equal(draft.configured, false);
  assert.equal(draft.mode, 'dfsc');
  await assert.rejects(readFile(join(root, 'bvr/config.json')), /ENOENT/);
  assert.equal((await store.check(input(draft, runtime))).dependencies, true);
  assert.equal(invalidated(), 0);
  await assert.rejects(readFile(join(root, 'bvr/config.json')), /ENOENT/);
  const saved = await store.save(input(draft, runtime));
  assert.equal(saved.configured, true);
  assert.equal(invalidated(), 1);
  const config = JSON.parse(await readFile(join(root, 'bvr/config.json'), 'utf8'));
  assert.equal(config.hostAccess, 'confirm');
});
test('independent main and ASR require separate explicit connections and never expose keys', async t => {
  const { store, runtime, root } = await fixture(t);
  const draft = { ...input(await store.read(), runtime), mode: 'independent' as const, apiKey: 'main-private-unique' };
  await assert.rejects(store.save(draft), /bvr:missing-key/);
  const saved = await store.save({ ...draft, asrApiKey: 'asr-private-unique', asrApiBase: 'https://api.stepfun.ai/step_plan/v1', asrModel: 'asr-specific' });
  assert.equal(saved.hasApiKey, true);
  assert.equal(saved.hasAsrApiKey, true);
  assert.doesNotMatch(JSON.stringify(saved), /private-unique/);
  const config = JSON.parse(await readFile(join(root, 'bvr/config.json'), 'utf8'));
  const env = parseEnv(await readFile(config.envFile, 'utf8'));
  assert.equal(env.STEPFUN_API_KEY, 'main-private-unique');
  assert.equal(env.STEPFUN_ASR_API_KEY, 'asr-private-unique');
  assert.equal(env.STEPFUN_ASR_BASE_URL, 'https://api.stepfun.ai/step_plan/v1');
  const updated = await store.save({ ...input(saved, runtime), model: 'changed-model' });
  assert.equal(updated.hasAsrApiKey, true);
  await assert.rejects(readFile(config.envFile), /ENOENT/, 'only the superseded managed env is removed');
  assert.equal((await readdir(join(root, 'bvr'))).filter(name => name.endsWith('.env')).length, 1);
  await assert.rejects(store.save({ ...input(updated, runtime), apiBase: 'https://example.com/v1' }), /bvr:invalid-endpoint/);
});
test('stale and simultaneous saves preserve the winning configuration and leave no temp files', async t => {
  const { store, runtime, root } = await fixture(t);
  const draft = input(await store.read(), runtime);
  const results = await Promise.allSettled([store.save(draft), store.save(draft)]);
  assert.equal(results.filter(value => value.status === 'fulfilled').length, 1);
  await assert.rejects(store.save(draft), /bvr:stale/);
  assert.equal((await readdir(join(root, 'bvr'))).filter(name => name.endsWith('.tmp')).length, 0);
});
test('legacy external env is retained, non-Step providers are not overwritten, paths round trip', async t => {
  const { store, runtime, root } = await fixture(t);
  const envFile = join(root, 'original.env');
  await mkdir(join(root, 'bvr'));
  await writeFile(envFile, "CODEX_VIDEO_PROVIDER='gemini'\nGEMINI_API_KEY='private-legacy'\n");
  await writeFile(join(root, 'bvr/config.json'), JSON.stringify({ schemaVersion: 1, runtimeDirectory: runtime, envFile }));
  const legacy = await store.read();
  assert.equal(legacy.legacyProvider, 'other');
  await assert.rejects(store.save(input(legacy, runtime)), /bvr:legacy-provider/);
  await writeFile(envFile, "CODEX_VIDEO_PROVIDER='stepfun'\nSTEPFUN_API_KEY='private-legacy'\n");
  const saved = await store.save({ ...input(await store.read(), runtime), mode: 'dfsc',
    downloadDirectory: join(root, "O'Neil"), cookieFile: join(root, 'space # path.txt') });
  assert.equal(saved.downloadDirectory, join(root, "O'Neil"));
  assert.equal(saved.cookieFile, join(root, 'space # path.txt'));
  assert.match(await readFile(envFile, 'utf8'), /private-legacy/);
});
test('legacy runtime without separate-ASR support cannot pretend to apply the new settings', async t => {
  const { store, runtime, root } = await fixture(t);
  await writeFile(join(runtime, 'package.json'), JSON.stringify({ name: 'bilibili-video-research-mcp' }));
  await assert.rejects(store.save(input(await store.read(), runtime)), /bvr:runtime-upgrade/);
  await assert.rejects(readFile(join(root, 'bvr/config.json')), /ENOENT/);
});
test('legacy endpoint normalization preserves region; credential-bearing connection values never reach the renderer', async t => {
  const { store, runtime, root } = await fixture(t);
  const envFile = join(root, 'legacy.env');
  await mkdir(join(root, 'bvr'));
  await writeFile(join(root, 'bvr/config.json'), JSON.stringify({ schemaVersion: 1, runtimeDirectory: runtime, envFile }));
  await writeFile(envFile, "CODEX_VIDEO_PROVIDER=stepfun\nSTEPFUN_BASE_URL=https://api.stepfun.ai/v1/\nSTEPFUN_ASR_BASE_URL=https://api.stepfun.ai/step_plan/v1/\n");
  const known = await store.read();
  assert.equal(known.apiBase, 'https://api.stepfun.ai/v1');
  assert.equal(known.asrApiBase, 'https://api.stepfun.ai/step_plan/v1');
  await writeFile(envFile, "CODEX_VIDEO_PROVIDER=stepfun\nSTEPFUN_BASE_URL=https://private-user:private-key@example.com/v1\nHTTPS_PROXY=http://private-proxy:private-key@localhost:8080\n");
  const blocked = await store.read();
  assert.doesNotMatch(JSON.stringify(blocked), /private-user|private-key|private-proxy/);
  assert.equal(blocked.legacyProvider, 'other');
  await assert.rejects(store.save(input(blocked, runtime)), /bvr:legacy-provider/);
});
