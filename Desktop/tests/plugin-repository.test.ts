import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PluginRepositoryInfo } from '../electron/plugin-repository.mjs';

test('repository information is opt-in, deduplicated, bounded and cached across service restart', async t => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'dfsc-stars-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  let calls = 0, now = Date.now();
  const fetch: typeof globalThis.fetch = async (url, options) => {
    calls++;
    assert.equal(url, 'https://api.github.com/repos/owner/repo');
    assert.equal(options?.redirect, 'manual');
    assert.equal(options?.credentials, 'omit');
    assert.equal(new Headers(options?.headers).has('Authorization'), false);
    return new Response(JSON.stringify({ stargazers_count: 0 }));
  };
  const service = new PluginRepositoryInfo(root, { fetch, now: () => now });
  assert.deepEqual(await service.snapshot('https://github.com/owner/repo'), { status: 'unknown' });
  assert.equal(calls, 0);
  const snapshots = await Promise.all(Array.from({ length: 8 }, () => service.refresh('https://github.com/owner/repo')));
  assert.equal(calls, 1); assert.equal(snapshots[0].count, 0);
  assert.equal(snapshots[0].status, 'fresh');
  now += 3600000;
  await service.refresh('https://github.com/owner/repo');
  assert.equal(calls, 1);
  assert.equal((await new PluginRepositoryInfo(root, { fetch, now: () => now }).snapshot('https://github.com/owner/repo')).count, 0);
});
test('failed repository queries retain their retry cooldown across a service restart', async t => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'dfsc-stars-retry-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  let calls = 0;
  const fetch: typeof globalThis.fetch = async () => { calls++; throw new Error('offline'); };
  const first = new PluginRepositoryInfo(root, { fetch });
  assert.equal((await first.refresh('https://github.com/owner/repo')).status, 'unavailable');
  assert.equal((await new PluginRepositoryInfo(root, { fetch }).refresh('https://github.com/owner/repo')).status, 'unavailable');
  assert.equal(calls, 1);
});
test('failed, limited, malformed, oversized and redirected requests preserve old snapshots, never invent zero', async t => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'dfsc-stars-errors-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  let now = Date.now(), response = () => new Response('{"stargazers_count":7}');
  const service = new PluginRepositoryInfo(root, { now: () => now, fetch: async () => response() });
  await service.refresh('https://github.com/owner/repo');
  for (const body of [-1, 1.5, null]) {
    now += 6 * 3600000;
    response = () => new Response(JSON.stringify({ stargazers_count: body }));
    const value = await service.refresh('https://github.com/owner/repo');
    assert.equal(value.count, 7); assert.equal(value.status, 'stale');
  }
  for (const status of [302, 403, 404, 429, 500]) {
    now += 6 * 3600000;
    response = () => new Response('', { status });
    assert.equal((await service.refresh('https://github.com/owner/repo')).count, 7);
  }
  now += 6 * 3600000;
  response = () => new Response(' '.repeat(256 * 1024 + 1));
  assert.equal((await service.refresh('https://github.com/owner/repo')).count, 7);
  response = () => new Response('', { status: 429 });
  assert.deepEqual(await service.refresh('https://github.com/owner/unknown'), { status: 'limited' });
  for (const repository of ['https://user:secret@github.com/a/b', 'https://example.com/a/b', 'https://github.com/a/b?token=secret'])
    await assert.rejects(service.refresh(repository), /invalid-input/);
});
test('a timed-out repository query releases its slot and preserves the last real snapshot', { timeout: 15000 }, async t => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'dfsc-stars-timeout-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  let now = Date.now(), timeout = false, aborted = false;
  const service = new PluginRepositoryInfo(root, { now: () => now, fetch: async (_url, options) => {
    if (!timeout) return new Response('{"stargazers_count":3}');
    assert.ok(options?.signal);
    return new Promise((_resolve, reject) => options.signal!.addEventListener('abort', () => {
      aborted = true;
      reject(options.signal!.reason);
    }, { once: true }));
  } });
  await service.refresh('https://github.com/owner/repo');
  now += 6 * 3600000; timeout = true;
  const keepAlive = setTimeout(() => {}, 10000);
  try {
    const result = await service.refresh('https://github.com/owner/repo');
    assert.equal(aborted, true); assert.equal(result.count, 3); assert.equal(result.status, 'stale');
    assert.equal(Reflect.get(service, 'active'), 0);
    assert.equal(Reflect.get(service, 'pending').size, 0);
  } finally { clearTimeout(keepAlive); }
});
test('repository query concurrency never exceeds two', async t => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'dfsc-stars-concurrency-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  let active = 0, maximum = 0;
  const service = new PluginRepositoryInfo(root, { fetch: async () => {
    maximum = Math.max(maximum, ++active);
    await new Promise(resolve => setTimeout(resolve, 10));
    active--; return new Response('{"stargazers_count":1}');
  } });
  await Promise.all(Array.from({ length: 8 }, (_, index) => service.refresh(`https://github.com/owner/repo${index}`)));
  assert.equal(maximum, 2);
});
