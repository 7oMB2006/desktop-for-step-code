import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

assert.ok(['win32', 'darwin'].includes(process.platform), 'This check covers the pinned runtime');
const runtime = process.env.DESKTOP_MACOS_RESOURCES ? join(process.env.DESKTOP_MACOS_RESOURCES, 'runtime') : resolve('runtime');
const manifest = JSON.parse(await readFile(join(runtime, 'manifest.json'), 'utf8'));
assert.equal(manifest.commit, '81e79bc4b699148d6823fedde9b5e70d9a80255f');
for (const worker of ['activity-worker.js', 'session-index-worker.js', 'image-resize-worker.js']) {
  await readFile(join(runtime, 'step/dist/bundle/chunks', worker)).catch(error => {
    if (error.code !== 'ENOENT') throw error;
    return readFile(join(runtime, 'step/dist/bundle', worker));
  });
}
await mkdir('test-results', { recursive: true });
const root = await mkdtemp(resolve('test-results/usage-worker-'));
try {
  const bundle = join(root, 'standalone-bundle');
  await cp(join(runtime, 'step/dist/bundle'), bundle, { recursive: true });
  await cp(join(runtime, 'step/package.json'), join(root, 'package.json'));
  const sessions = join(root, 'sessions');
  await mkdir(sessions);
  const timestamp = new Date().toISOString();
  const rows = [
    { type: 'session', id: 'isolated-usage', cwd: root, timestamp },
    { type: 'custom', id: 'capabilities', customType: 'step.activity_capabilities', timestamp,
      data: { version: 1, sessionId: 'isolated-usage', sessionRole: 'user' } },
    { type: 'message', id: 'usage', timestamp, message: { role: 'assistant',
      content: [{ type: 'text', text: 'Fixture only' }], usage: { input: 100, output: 5, cacheRead: 20, cacheWrite: 10 } } },
    { type: 'message', id: 'question', parentId: 'usage', timestamp, message: { role: 'user',
      content: [{ type: 'text', text: 'isolated index marker' }], timestamp: Date.now() } },
  ];
  await writeFile(join(sessions, 'session.jsonl'), `${rows.map(row => JSON.stringify(row)).join('\n')}\n`);
  const probe = `
    import assert from 'node:assert/strict';
    import { pathToFileURL } from 'node:url';
    import { join } from 'node:path';
    const root = process.cwd();
    const { scanUsageOverview, openSessionIndex } = await import(pathToFileURL(join(root, 'standalone-bundle/index.js')));
    const scan = signal => scanUsageOverview([join(root, 'sessions')], join(root, 'cache'), root, 'all', signal);
    const first = await scan(new AbortController().signal);
    assert.equal(first.tokens, 135);
    assert.equal(first.chats, 1);
    const cached = await scan(new AbortController().signal);
    assert.equal(cached.tokens, first.tokens);
    const controller = new AbortController();
    const pending = scan(controller.signal);
    controller.abort();
    await assert.rejects(pending, /cancelled/);
    const index = await openSessionIndex({ agentDir: join(root, 'index-profile'),
      roots: [{ path: join(root, 'sessions'), kind: 'default' }], backfill: false });
    try {
      for await (const progress of index.reindex({ full: true })) {}
      assert.equal((await index.status()).state, 'ready', 'The SQLite worker must load, not silently use JSONL fallback');
      const hits = [];
      for await (const batch of index.search({ text: 'isolated index marker', limit: 10 })) hits.push(...batch.hits);
      assert.ok(hits.some(hit => hit.sessionId === 'isolated-usage'));
    } finally { await index.close(); }
    console.log('Standalone workers passed: usage totals/cache/cancellation and SQLite session index search.');
  `;
  const probePath = join(root, 'probe.mjs');
  await writeFile(probePath, probe);
  const result = spawnSync(join(runtime, 'node', process.platform === 'win32' ? 'node.exe' : 'node'), [probePath], {
    cwd: root, encoding: 'utf8', timeout: 30000, windowsHide: true,
  });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  console.log(result.stdout.trim());
} finally {
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
