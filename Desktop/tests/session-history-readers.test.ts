import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { SessionHistoryReaders, type HistoryRequest } from '../electron/session-history-readers';
import { assertReadingBudget, MAX_READING_BYTES, MAX_READING_MESSAGES, MAX_READING_BLOCKS } from '../electron/session-reading-budget';

const request = (id: string): HistoryRequest => ({ root: '/fixture', profile: '/fixture', file: `/${id}`, sessionId: id, cwd: '/project' });
const reading = (sessionId: string) => ({ sessionId, messages: [{ role: 'user', content: sessionId }], modelChanges: [] });
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(yes => { resolve = yes; });
  return { promise, resolve };
}
const tick = () => new Promise<void>(resolve => setImmediate(resolve));

test('two surfaces share one source; leaving one cannot cancel the other', async t => {
  const gate = deferred<ReturnType<typeof reading>>();
  let starts = 0, signal!: AbortSignal;
  const readers = new SessionHistoryReaders(async (_request, value) => { starts++; signal = value; return gate.promise; });
  t.after(() => readers.close());
  const main = readers.read('main:1:0', 1, request('A'), 'v1');
  const mini = readers.read('mini:2:0', 1, request('A'), 'v1');
  readers.cancel('main:1:0', 1);
  assert.equal(await main, null);
  assert.equal(signal.aborted, false);
  gate.resolve(reading('A'));
  assert.deepEqual(await mini, reading('A'));
  assert.equal(starts, 1);
});

test('last subscriber cancels; another reader waits for confirmed process close', async t => {
  const closed = deferred<void>();
  const starts: string[] = [];
  let signal!: AbortSignal;
  const readers = new SessionHistoryReaders(async (value, current) => {
    starts.push(value.sessionId);
    if (value.sessionId === 'A') { signal = current; await closed.promise; }
    return reading(value.sessionId);
  });
  t.after(() => readers.close());
  const old = readers.read('main', 1, request('A'), 'v1');
  const latest = readers.read('main', 2, request('B'), 'v1');
  assert.equal(await old, null);
  assert.equal(signal.aborted, true);
  assert.deepEqual(starts, ['A']);
  closed.resolve();
  assert.deepEqual(await latest, reading('B'));
  assert.deepEqual(starts, ['A', 'B']);
});

test('main navigation replaces only its waiter and cannot starve mini', async t => {
  const gate = deferred<void>();
  const starts: string[] = [];
  const readers = new SessionHistoryReaders(async value => {
    starts.push(value.sessionId);
    if (value.sessionId === 'active') await gate.promise;
    return reading(value.sessionId);
  });
  t.after(() => readers.close());
  const active = readers.read('active', 1, request('active'), 'v1');
  const main = readers.read('main', 1, request('A'), 'v1');
  const mini = readers.read('mini', 1, request('mini'), 'v1');
  const latest = readers.read('main', 2, request('B'), 'v1');
  assert.equal(await main, null);
  gate.resolve();
  await Promise.all([active, mini, latest]);
  assert.deepEqual(starts, ['active', 'mini', 'B']);
});

test('queue timeout does not cancel another consumer or consume execution time', async t => {
  const gate = deferred<void>();
  let signal!: AbortSignal;
  const readers = new SessionHistoryReaders(async (value, current) => {
    signal = current; await gate.promise; return reading(value.sessionId);
  }, 15, 500);
  t.after(() => readers.close());
  const active = readers.read('main', 1, request('A'), 'v1');
  assert.deepEqual(await readers.read('mini', 1, request('B'), 'v1'), { sessionId: 'B', unavailable: 'queue-timeout' });
  assert.equal(signal.aborted, false);
  gate.resolve();
  assert.deepEqual(await active, reading('A'));
});

test('execution deadline cancels and reports a typed timeout', async t => {
  const readers = new SessionHistoryReaders(async (value, signal) => {
    await delay(500, undefined, { signal }); return reading(value.sessionId);
  }, 500, 15);
  t.after(() => readers.close());
  assert.deepEqual(await readers.read('main', 1, request('A'), 'v1'), { sessionId: 'A', unavailable: 'timeout' });
});

test('changed source retries once under the same subscription', async t => {
  let calls = 0;
  const readers = new SessionHistoryReaders(async () => {
    calls++; return { unavailable: 'changed' as const };
  });
  t.after(() => readers.close());
  assert.deepEqual(await readers.read('main', 1, request('A'), 'v1'), { sessionId: 'A', unavailable: 'changed' });
  assert.equal(calls, 2);
});

test('reload withdraws old generation; stale cancellation cannot affect the new selection', async t => {
  const closed = deferred<void>();
  const readers = new SessionHistoryReaders(async value => { await closed.promise; return reading(value.sessionId); });
  t.after(() => readers.close());
  const old = readers.read('7:0:main', 4, request('A'), 'v1');
  readers.forgetWindow('7:');
  const latest = readers.read('7:1:main', 1, request('A'), 'v1');
  readers.cancel('7:0:main', 4);
  assert.equal(await old, null);
  closed.resolve();
  assert.deepEqual(await latest, reading('A'));
  assert.equal(await readers.read('7:1:main', 1, request('B'), 'v1'), null, 'Revision replay cannot start a reader');
});

test('late completion cannot publish to a withdrawn subscriber; close rejects future reads', async () => {
  const gate = deferred<ReturnType<typeof reading>>();
  const readers = new SessionHistoryReaders(() => gate.promise);
  const old = readers.read('main', 1, request('A'), 'v1');
  readers.cancel('main', 1);
  assert.equal(await old, null);
  gate.resolve(reading('A'));
  await tick();
  await readers.close();
  assert.equal(await readers.read('main', 2, request('B'), 'v1'), null);
});

test('final display budget counts UTF-8, decorations and model changes, not JS characters', () => {
  assert.doesNotThrow(() => assertReadingBudget(reading('A')));
  const large = { ...reading('A'), messages: [{ role: 'user', content: '\u4e2d'.repeat(Math.ceil(MAX_READING_BYTES / 3)) }] };
  assert.throws(() => assertReadingBudget(large), /response-limit/);
  assert.throws(() => assertReadingBudget({ ...reading('A'),
    messages: [{ role: 'assistant', content: '', details: { text: 'x'.repeat(MAX_READING_BYTES) } }] }), /response-limit/);
  assert.throws(() => assertReadingBudget({ ...reading('A'),
    modelChanges: [{ id: 'x'.repeat(MAX_READING_BYTES), userTimestamp: 1, from: { id: '', provider: '', name: '' }, to: { id: '', provider: '', name: '' } }] }), /response-limit/);
});

test('message and content-block limits reject many small nodes', () => {
  assert.throws(() => assertReadingBudget({ sessionId: 'A', messages: Array.from({ length: MAX_READING_MESSAGES + 1 },
    () => ({ role: 'user', content: '' })) }), /node-limit/);
  assert.throws(() => assertReadingBudget({ sessionId: 'A', messages: [{ role: 'user',
    content: Array.from({ length: MAX_READING_BLOCKS + 1 }, () => ({ type: 'text', text: '' })) }] }), /node-limit/);
});
