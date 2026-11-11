import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readdir, readFile, writeFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { RpcProcess, isolatedEnvironment } from '../electron/runtime';

async function filesIn(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true }).catch(error => {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return [];
    throw error;
  });
  return (await Promise.all(entries.map(entry => entry.isDirectory()
    ? filesIn(join(root, entry.name)) : [join(root, entry.name)]))).flat();
}

test('compile cache survives forced stop, tolerates corruption, and never restores old module values', { timeout: 60000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'desktop-compile-cache-'));
  const entry = join(root, 'fixture.mjs'), cache = join(root, 'cache');
  const extension = pathToFileURL(resolve('electron/runtime-compile-cache.mjs')).href;
  const node = resolve('runtime/node', process.platform === 'win32' ? 'node.exe' : 'node');
  const rpc = new RpcProcess(() => {});
  const fixture = (revision: number) => `
    import { createInterface } from 'node:readline';
    import { getCompileCacheDir } from 'node:module';
    import register from ${JSON.stringify(extension)};
    let start;
    register({ on(name, handler) {
      if (name !== 'session_start') throw new Error('Unexpected lifecycle mutation');
      start = handler;
    } });
    start();
    createInterface({ input: process.stdin }).on('line', line => {
      const command = JSON.parse(line);
      if (command.type === 'switch_session') start();
      process.stdout.write(JSON.stringify({ type: 'response', id: command.id, success: true,
        data: { revision: ${revision}, cache: !!getCompileCacheDir() } }) + '\\n');
    });
  `;
  const start = (path = cache, extra: NodeJS.ProcessEnv = {}) =>
    rpc.start(node, entry, root, { ...isolatedEnvironment(root),
      NODE_DISABLE_COMPILE_CACHE: undefined, NODE_COMPILE_CACHE: path, ...extra });
  try {
    await writeFile(entry, fixture(1));
    start();
    assert.deepEqual(await rpc.request('get_state'), { revision: 1, cache: true });
    const files = await filesIn(cache);
    assert.ok(files.length > 0, 'Cache is on disk while the first worker remains alive');
    assert.ok((await Promise.all(files.map(file => stat(file)))).some(info => info.size > 0));
    const before = await Promise.all(files.map(async file => [file, (await stat(file)).mtimeMs]));
    await rpc.request('switch_session');
    assert.deepEqual(await Promise.all(files.map(async file => [file, (await stat(file)).mtimeMs])), before);
    await rpc.stop();
    start();
    assert.deepEqual(await rpc.request('get_state'), { revision: 1, cache: true });
    await rpc.stop();
    for (const file of files) await writeFile(file, 'invalid-bytecode-cache');
    start();
    assert.deepEqual(await rpc.request('get_state'), { revision: 1, cache: true });
    await rpc.stop();
    await writeFile(entry, fixture(2));
    start();
    assert.deepEqual(await rpc.request('get_state'), { revision: 2, cache: true });
    await rpc.stop();
    const blocked = join(root, 'not-a-directory');
    await writeFile(blocked, 'owned fixture');
    start(join(blocked, 'cache'));
    assert.deepEqual(await rpc.request('get_state'), { revision: 2, cache: false });
    await rpc.stop();
    const disabled = join(root, 'disabled');
    start(disabled, { NODE_DISABLE_COMPILE_CACHE: '1' });
    assert.deepEqual(await rpc.request('get_state'), { revision: 2, cache: false });
    await rpc.stop();
    assert.deepEqual(await filesIn(disabled), []);
  } finally {
    await rpc.stop();
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test('staged cache extension flushes actual upstream modules without changing authoritative restoration', { timeout: 60000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'desktop-native-cache-'));
  const cache = join(root, 'compile-cache');
  const sessions = join(root, 'sessions');
  const extension = resolve('runtime/runtime-compile-cache.mjs');
  assert.equal(await readFile(extension, 'utf8'), await readFile(resolve('electron/runtime-compile-cache.mjs'), 'utf8'));
  await mkdir(sessions);
  await writeFile(join(root, 'config.toml'), 'defaultProvider = "fixture"\ndefaultModel = "fixture"\n[telemetry]\nenabled = false\n');
  await writeFile(join(root, 'models.json'), JSON.stringify({ providers: {
    fixture: { api: 'openai-completions', baseUrl: 'http://127.0.0.1:1/v1', apiKey: 'local-test-only',
      models: [{ id: 'fixture', name: 'Cache fixture' }] },
  } }));
  const saved = join(sessions, 'saved.jsonl');
  const save = async (revision: number) => {
    const timestamp = new Date().toISOString();
    await writeFile(saved, [
      { type: 'session', version: 3, id: 'cache-restoration', cwd: root, timestamp },
      { type: 'message', id: 'question', parentId: null, timestamp,
        message: { role: 'user', content: [{ type: 'text', text: `Saved revision ${revision}` }], timestamp: Date.now() } },
    ].map(entry => JSON.stringify(entry)).join('\n') + '\n');
  };
  const rpc = new RpcProcess(() => {});
  try {
    for (const revision of [1, 2]) {
      await save(revision);
      rpc.start(resolve('runtime/node', process.platform === 'win32' ? 'node.exe' : 'node'),
        resolve('runtime/step/dist/bundle/step.js'), root,
        { ...isolatedEnvironment(root), NODE_DISABLE_COMPILE_CACHE: undefined, NODE_COMPILE_CACHE: cache },
        ['--include-live-events', '--extension', extension]);
      await rpc.request('get_state');
      assert.ok((await filesIn(cache)).length > 0);
      await rpc.request('switch_session', { sessionPath: saved });
      assert.equal((await rpc.request('get_state')).sessionId, 'cache-restoration');
      assert.match(JSON.stringify(await rpc.request('get_messages')), new RegExp(`Saved revision ${revision}`));
      if (revision === 2)
        assert.doesNotMatch(JSON.stringify(await rpc.request('get_messages')), /Saved revision 1/);
      await rpc.stop();
    }
  } finally {
    await rpc.stop();
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
