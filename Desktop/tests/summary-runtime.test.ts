import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { RpcProcess, isolatedEnvironment } from '../electron/runtime';

test('staged summary RPC reads the active task branch and live service catalog without mutating history', { timeout: 90000 }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'desktop-summary-rpc-'));
  const profile = join(dir, 'profile');
  await mkdir(join(profile, 'sessions'), { recursive: true });
  await mkdir(join(profile, 'agent', 'skills', 'summary-fixture'), { recursive: true });
  await writeFile(join(profile, 'agent', 'skills', 'summary-fixture', 'SKILL.md'), '---\nname: summary-fixture\ndescription: Local summary fixture\n---\nRead-only fixture.\n');
  await writeFile(join(profile, 'config.toml'), '[telemetry]\nenabled = false\n[mcp_servers.disabled-fixture]\ncommand = "never-run"\nenabled = false\n');
  const timestamp = new Date().toISOString();
  const sessionPath = join(profile, 'sessions', 'summary.jsonl');
  const snapshot = (title: string) => ({ tasks: [{ id: '1', subject: title, description: 'Fixture detail', status: 'in_progress', blocks: [], blockedBy: [] }], nextId: 2, activePlan: { id: title, title } });
  await writeFile(sessionPath, [
    { type: 'session', version: 3, id: 'summary-rpc', cwd: dir, timestamp },
    { type: 'message', id: 'u', parentId: null, timestamp, message: { role: 'user', content: 'Fixture', timestamp: Date.now() } },
    { type: 'custom', id: 'plan', parentId: 'u', timestamp, customType: 'step-tasks', data: snapshot('Active plan') },
    { type: 'custom', id: 'abandoned', parentId: 'plan', timestamp, customType: 'step-tasks', data: snapshot('Abandoned plan') },
    { type: 'session_info', id: 'leaf', parentId: 'plan', timestamp, name: 'Summary RPC fixture' },
  ].map(value => JSON.stringify(value)).join('\n') + '\n');
  const rpc = new RpcProcess(() => {});
  try {
    rpc.start(resolve('runtime/node/node.exe'), resolve('runtime/step/dist/bundle/step.js'), dir, isolatedEnvironment(profile));
    await rpc.request('get_state', {}, 60000);
    await rpc.request('switch_session', { sessionPath });
    const before = await rpc.request('get_messages');
    const commands = (await rpc.request('get_commands')).commands;
    let summary = await rpc.request('get_desktop_summary');
    const deadline = Date.now() + 10000;
    while (!summary.mcp.some((server: any) => server.name === 'disabled-fixture') && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 100));
      summary = await rpc.request('get_desktop_summary');
    }
    assert.equal(summary.sessionId, 'summary-rpc');
    assert.equal(summary.tasks.activePlan.title, 'Active plan');
    assert.equal(summary.tasks.tasks[0].subject, 'Active plan');
    assert.ok(summary.skillCount >= 1);
    assert.equal(summary.skillCount, commands.filter((command: any) => command.source === 'skill').length);
    assert.deepEqual(summary.mcp.find((server: any) => server.name === 'disabled-fixture'), { name: 'disabled-fixture', status: 'disabled', toolCount: 0 });
    assert.equal(JSON.stringify(summary).includes('never-run'), false);
    assert.deepEqual(await rpc.request('get_messages'), before);
    await rpc.request('new_session');
    const fresh = await rpc.request('get_desktop_summary');
    assert.notEqual(fresh.sessionId, summary.sessionId);
    assert.equal(fresh.tasks, null);
  } finally { await rpc.stop(); }
});
