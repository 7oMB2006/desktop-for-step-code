import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { CronHistory } from '../electron/cron-history';
import type { SessionRuntime } from '../electron/session-runtimes';

test('Cron journal distinguishes delivery, execution, approval and authoritative completion without private content', async t => {
  const root = await mkdtemp(join(tmpdir(), 'cron-history-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const history = new CronHistory(root, () => 100);
  const worker = { id: 'host', cwd: 'D:/project', state: { sessionId: 'chat' }, messages: [], failed: false, interrupted: false } as unknown as SessionRuntime;
  history.event(worker, { type: 'message_start', message: {
    role: 'custom', customType: 'step-cron', content: 'PRIVATE PROMPT', display: true, details: { id: 'one', createdAt: 10 },
  } } as any);
  assert.equal(history.list(worker.cwd)[0].state, 'triggered');
  assert.equal(history.uncertain(worker.cwd), true);
  history.event(worker, { type: 'message_start', message: { role: 'assistant', content: [] } } as any);
  assert.equal(history.list(worker.cwd)[0].state, 'running');
  history.event(worker, { type: 'extension_ui_request', method: 'confirm', message: 'PRIVATE APPROVAL' } as any);
  assert.equal(history.list(worker.cwd)[0].state, 'waiting');
  worker.messages = [{ role: 'assistant', content: [], stopReason: 'stop' }] as any;
  history.event(worker, { type: 'agent_end' });
  assert.equal(history.list(worker.cwd)[0].state, 'completed');
  assert.equal(history.uncertain(worker.cwd), false);
  const bytes = await readFile(join(root, (await readdir(root))[0]), 'utf8');
  assert.ok(!bytes.includes('PRIVATE'));
  assert.equal(new CronHistory(root).list(worker.cwd)[0].state, 'completed');
});
test('Host loss and unrelated user turns are unknown, never successful; records stay bounded', async t => {
  const root = await mkdtemp(join(tmpdir(), 'cron-history-loss-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const history = new CronHistory(root);
  const worker = { id: 'host', cwd: 'D:/project', state: { sessionId: 'chat' }, messages: [] } as unknown as SessionRuntime;
  for (const type of ['desktop_exit', 'message_start']) {
    history.event(worker, { type: 'message_start', message: { role: 'custom', customType: 'step-cron', display: true } } as any);
    history.event(worker, { type, message: { role: 'user', content: 'Other task' } } as any);
    history.event(worker, { type: 'agent_end' });
  }
  assert.ok(history.list(worker.cwd).every(row => row.state === 'unknown'));
  for (let i = 0; i < 210; i++) history.record(worker.cwd, 'chat', 'recovered');
  assert.equal(history.list(worker.cwd).length, 200);
  assert.equal(history.uncertain(worker.cwd), true, 'Display rotation must not acknowledge unresolved execution');
  const reopened = new CronHistory(root);
  assert.equal(reopened.uncertain(worker.cwd), true, 'The safety latch survives restart');
  reopened.acknowledge(worker.cwd);
  assert.equal(new CronHistory(root).uncertain(worker.cwd), false);
});
test('Restarted unfinished runs require explicit acknowledgment without being relabeled successful', async t => {
  const root = await mkdtemp(join(tmpdir(), 'cron-history-review-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const history = new CronHistory(root, () => 100);
  const worker = { id: 'host', cwd: 'D:/project', state: { sessionId: 'chat' }, messages: [] } as unknown as SessionRuntime;
  history.event(worker, { type: 'message_start', message: { role: 'custom', customType: 'step-cron', display: true } } as any);
  const reopened = new CronHistory(root, () => 200);
  assert.equal(reopened.list(worker.cwd)[0].state, 'unknown');
  assert.equal(reopened.uncertain(worker.cwd), true);
  reopened.acknowledge(worker.cwd);
  assert.equal(reopened.list(worker.cwd)[0].state, 'unknown');
  assert.equal(reopened.list(worker.cwd)[0].reviewedAt, 200);
  assert.equal(reopened.uncertain(worker.cwd), false);
  assert.equal(new CronHistory(root).uncertain(worker.cwd), false);
  const file = join(root, (await readdir(root))[0]);
  const row = reopened.list(worker.cwd)[0];
  for (const change of [{ updatedAt: 1e20 }, { jobId: '../escape' }, { reviewedAt: 'approved' }, { reason: 'private output' }]) {
    await writeFile(file, JSON.stringify([{ ...row, ...change }]));
    assert.throws(() => reopened.list(worker.cwd), /Invalid/);
  }
});
test('Delivery alone cannot reuse the preceding response as a successful Cron execution', async t => {
  const root = await mkdtemp(join(tmpdir(), 'cron-history-delivery-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const history = new CronHistory(root);
  const worker = { id: 'host', cwd: 'D:/project', state: { sessionId: 'chat' },
    messages: [{ role: 'assistant', stopReason: 'stop' }] } as unknown as SessionRuntime;
  history.event(worker, { type: 'message_start', message: { role: 'custom', customType: 'step-cron', display: true } } as any);
  history.event(worker, { type: 'agent_end' });
  assert.equal(history.list(worker.cwd)[0].state, 'unknown');
  assert.equal(history.uncertain(worker.cwd), true);
});
test('Legacy journals migrate on write and malformed rotation latches fail closed', async t => {
  const root = await mkdtemp(join(tmpdir(), 'cron-history-migrate-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const history = new CronHistory(root, () => 100);
  history.record('D:/project', 'chat', 'unknown');
  const file = join(root, (await readdir(root))[0]);
  await writeFile(file, JSON.stringify(history.list('D:/project')));
  const reopened = new CronHistory(root);
  assert.equal(reopened.uncertain('D:/project'), true);
  reopened.record('D:/project', 'chat', 'recovered');
  const document = JSON.parse(await readFile(file, 'utf8'));
  assert.equal(document.version, 1);
  assert.equal(document.entries.length, 2);
  assert.equal(reopened.uncertain('D:/project'), true);
  for (const change of [{ unconfirmed: undefined }, { unconfirmed: 'false' }, { version: 2 }, { entries: null }]) {
    await writeFile(file, JSON.stringify({ ...document, ...change }));
    assert.throws(() => reopened.uncertain('D:/project'), /Invalid/);
  }
});
