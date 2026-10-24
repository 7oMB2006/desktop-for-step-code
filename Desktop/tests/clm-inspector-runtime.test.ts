import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { RpcProcess, isolatedEnvironment } from '../electron/runtime';
import { clmSnapshot } from '../electron/clm';

test('CLM inspector reads only the active branch and never mutates history', {
  timeout: 60000,
}, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'clm-inspector-'));
  const profile = join(directory, 'profile');
  await mkdir(join(profile, 'sessions'), { recursive: true });
  await writeFile(join(profile, 'config.toml'), '[telemetry]\nenabled = false\n[compaction]\ncontextProjection = "off"\n');
  const timestamp = new Date().toISOString();
  const file = join(profile, 'sessions', 'clm.jsonl');
  const checkpoint = (text: string, revision = 1) => ({ version: 1, revision, sourceCount: 1, sourceDigest: 'fixture',
    messages: [{ role: 'user', content: text, timestamp: 1 }], sourceIndexes: [0], diff: '- older\n+ retained' });
  await writeFile(file, [
    { type: 'session', version: 3, id: 'clm-inspector', cwd: directory, timestamp },
    { type: 'message', id: 'u', parentId: null, timestamp, message: { role: 'user', content: 'Keep requirements', timestamp: 1 } },
    { type: 'custom', id: 'r1', parentId: 'u', timestamp, customType: 'step-live-context', data: checkpoint('Accepted contents') },
    { type: 'custom', id: 'abandoned', parentId: 'r1', timestamp, customType: 'step-live-context', data: checkpoint('ABANDONED CONTENT', 2) },
    { type: 'custom', id: 'reset', parentId: 'r1', timestamp, customType: 'step-live-context', data: { version: 1, reset: true, revision: 2 } },
    { type: 'session_info', id: 'leaf', parentId: 'reset', timestamp, name: 'CLM read-only fixture' },
  ].map(row => JSON.stringify(row)).join('\n') + '\n');
  const rpc = new RpcProcess(() => {});
  try {
    rpc.start(resolve('runtime/node', process.platform === 'win32' ? 'node.exe' : 'node'), resolve('runtime/step/dist/bundle/step.js'), directory, isolatedEnvironment(profile));
    await rpc.request('get_state', {}, 60000);
    await rpc.request('switch_session', { sessionPath: file });
    const before = await readFile(file, 'utf8');
    const latest = clmSnapshot(await rpc.request('get_desktop_clm'), 'clm-inspector');
    assert.deepEqual(latest.revisions.map(item => item.entryId), ['r1', 'reset']);
    assert.equal(latest.enabled, false);
    assert.equal(latest.selected?.entryId, 'reset');
    assert.equal(latest.selected?.blocks.length, 0);
    const previous = clmSnapshot(await rpc.request('get_desktop_clm', { entryId: 'r1' }), 'clm-inspector');
    assert.match(previous.selected!.blocks[0].text, /Accepted contents/);
    assert.equal(previous.selected!.blocks[0].protected, true);
    assert.match(previous.selected!.diff, /retained/);
    await assert.rejects(rpc.request('get_desktop_clm', { entryId: 'abandoned' }), /active branch/);
    assert.equal(await readFile(file, 'utf8'), before);
    await rpc.request('prompt', { message: '/clm on' });
    assert.equal((await rpc.request('get_desktop_clm')).enabled, true);
    await rpc.request('prompt', { message: '/clm off' });
    assert.equal((await rpc.request('get_desktop_clm')).enabled, false);
  } finally { await rpc.stop(); }
});
