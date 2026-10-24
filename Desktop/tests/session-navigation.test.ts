import test from 'node:test';
import assert from 'node:assert/strict';
import { SessionNavigation } from '../electron/session-navigation';
import { SessionRuntimes, type WorkerTransport } from '../electron/session-runtimes';
import { SessionReadingCache, captureReadingPosition, restoreReadingPosition } from '../src/session-reading';
import { parseHTML } from 'linkedom';
import type { Session } from '../src/contracts';
import { setTimeout as delay } from 'node:timers/promises';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const tick = () => new Promise<void>(resolve => setImmediate(resolve));

test('connected sessions bypass two cold startups without releasing shared mutation protection', async () => {
  const gates = new Map([['A', deferred<string>()], ['B', deferred<string>()]]);
  const cold: string[] = [], committed: string[] = [];
  const navigation = new SessionNavigation(async id => {
    cold.push(id);
    return gates.get(id)?.promise ?? id;
  }, id => { committed.push(id); return id; }, () => {}, {
    reuse: id => id === 'resident' ? Promise.resolve(id) : undefined,
  });
  const first = navigation.select('A');
  const second = navigation.select('B');
  let result: string | null | undefined;
  const resident = navigation.select('resident').then(value => { result = value; });
  try {
    await tick();
    assert.equal(result, 'resident', 'A connected session must not queue behind cold startups');
    assert.deepEqual(cold, ['A', 'B'], 'Resident switching cannot start another runtime');
    assert.equal(navigation.selecting, false);
    assert.equal(navigation.busy, true, 'Account/settings mutations remain locked');
  } finally {
    for (const [id, gate] of gates) gate.resolve(id);
    await Promise.all([first, second, resident]);
    await tick();
  }
  assert.deepEqual(committed, ['resident']);
  assert.equal(navigation.busy, false);
});

test('slow resident snapshots neither consume cold slots nor override a newer selection', async () => {
  const residentGate = deferred<string>(), aGate = deferred<string>(), bGate = deferred<string>();
  const cold: string[] = [], committed: string[] = [];
  const navigation = new SessionNavigation(async id => {
    cold.push(id);
    return id === 'A' ? aGate.promise : bGate.promise;
  }, id => { committed.push(id); return id; }, () => {}, {
    reuse: id => id === 'resident' ? residentGate.promise : undefined,
  });
  const resident = navigation.select('resident');
  const first = navigation.select('A');
  const second = navigation.select('B');
  try {
    assert.deepEqual(cold, ['A', 'B'], 'Only cold preparations count against the two-startup limit');
    bGate.resolve('B');
    assert.equal(await second, 'B');
    residentGate.resolve('resident');
    await tick();
    assert.deepEqual(committed, ['B'], 'Late resident snapshots cannot steal the active session');
  } finally {
    residentGate.resolve('resident'); aGate.resolve('A'); bGate.resolve('B');
    await Promise.all([resident, first, second]);
    await tick();
  }
});

test('obsolete startup does not suspend bounded idle recycling or remove protected runtimes', async () => {
  const gate = deferred<void>();
  const pool = new SessionRuntimes(() => {}, () => {
    let id = '';
    const transport: WorkerTransport = {
      start(_node, _entry, cwd) { id = cwd; },
      async request(type) {
        if (type === 'get_state') {
          if (id === 'slow') await gate.promise;
          return { sessionId: id, isStreaming: false };
        }
        if (type === 'get_messages') return { messages: [{ role: 'user', content: id }] };
        if (type === 'get_available_models') return { models: [] };
        return {};
      },
      respond() {}, async stop() {},
    };
    return transport;
  });
  const recycle = () => pool.recycle(worker => navigation.pending(worker.state?.sessionId));
  const recycling: Promise<void>[] = [];
  const navigation = new SessionNavigation(
    id => pool.prepare('node', 'step', id, {}, `${id}.jsonl`),
    worker => { pool.activate(worker); return worker.state!.sessionId; }, () => {},
    { settled: () => { recycling.push(recycle()); } });
  try {
    const running = await pool.prepare('node', 'step', 'running', {}, 'running.jsonl');
    running.busy = true;
    const goal = await pool.prepare('node', 'step', 'goal', {}, 'goal.jsonl');
    goal.launch!.goal = { status: 'active', objective: 'fixture', id: 'goal', sessionId: 'goal',
      tokensUsed: 0, timeUsedSeconds: 0, iteration: 1, createdAt: '', updatedAt: '' };
    const cron = await pool.prepare('node', 'step', 'cron', {}, 'cron.jsonl');
    cron.cron = { version: 1, status: 'ready', jobs: [
      { id: 'job', recurring: true, durable: false, nextFireAt: Date.now() + 60000 },
    ] };
    const slow = navigation.select('slow');
    await tick();
    for (let index = 0; index < 8; index++) {
      assert.equal(await navigation.select(`fast-${index}`), `fast-${index}`);
      await Promise.all(recycling);
    }
    assert.equal(await slow, null);
    assert.equal(navigation.busy, true);
    assert.equal(navigation.selecting, false);
    assert.equal(recycling.length, 8, 'Each completed navigation can reclaim idle workers');
    assert.equal(pool.workers.size, 7, 'Three protected workers, one startup, active and two idle');
    for (const worker of [running, goal, cron]) assert.equal(pool.workers.get(worker.id), worker);
    assert.equal(pool.active?.state?.sessionId, 'fast-7');
    gate.resolve();
    await tick();
    await Promise.all(recycling);
    assert.equal(navigation.busy, false);
    assert.equal(pool.workers.size, 6);
    assert.equal(pool.active?.state?.sessionId, 'fast-7');
  } finally {
    gate.resolve();
    await tick();
    await Promise.all(recycling);
    await pool.stopAll();
  }
});

test('navigation bounds preparation, skips queued targets, and commits only the latest', async () => {
  const aGate = deferred<string>(), bGate = deferred<string>();
  const prepared: string[] = [], committed: string[] = [], busy: boolean[] = [];
  const navigation = new SessionNavigation(async id => {
    prepared.push(id); return id === 'A' ? aGate.promise : id === 'B' ? bGate.promise : id;
  }, id => { committed.push(id); return id; }, value => busy.push(value));
  const a = navigation.select('A');
  const b = navigation.select('B');
  const c = navigation.select('C');
  const d = navigation.select('D');
  assert.equal(await a, null);
  assert.equal(await b, null);
  assert.equal(await c, null);
  assert.deepEqual(prepared, ['A', 'B']);
  aGate.resolve('A');
  assert.equal(await d, 'D');
  assert.deepEqual(prepared, ['A', 'B', 'D']);
  assert.deepEqual(committed, ['D']);
  assert.equal(navigation.selecting, false, 'Latest runtime is usable before obsolete startup finishes');
  assert.equal(navigation.busy, true, 'Shared mutations remain locked during background preparation');
  bGate.resolve('B');
  await bGate.promise;
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(busy, [true, false]);
});
test('latest selection does not wait for a slow overtaken startup', async () => {
  const gate = deferred<string>();
  const committed: string[] = [];
  const navigation = new SessionNavigation(id => id === 'slow' ? gate.promise : Promise.resolve(id),
    id => { committed.push(id); return id; });
  const slow = navigation.select('slow');
  assert.equal(await navigation.select('fast'), 'fast');
  assert.equal(await slow, null);
  gate.resolve('slow');
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(committed, ['fast']);
  assert.equal(navigation.busy, false);
});
test('cooperative pre-start cancellation skips obsolete launches and can retry the same target', async () => {
  const launched: string[] = [];
  const navigation = new SessionNavigation(async (id, signal) => {
    await delay(10, undefined, { signal });
    launched.push(id);
    return id;
  }, id => id);
  const a = navigation.select('A');
  const b = navigation.select('B');
  const latest = navigation.select('A');
  assert.equal(await a, null);
  assert.equal(await b, null);
  assert.equal(await latest, 'A');
  assert.deepEqual(launched, ['A']);
  assert.equal(navigation.busy, false);
});
test('returning to an in-progress target reuses preparation and latest failure releases the selection', async () => {
  const gate = deferred<string>();
  const prepared: string[] = [];
  const navigation = new SessionNavigation(async id => {
    prepared.push(id);
    return id === 'A' ? gate.promise : id;
  }, id => id);
  const first = navigation.select('A');
  const second = navigation.select('B');
  const latest = navigation.select('A');
  gate.resolve('A');
  assert.equal(await first, null);
  assert.equal(await second, null);
  assert.equal(await latest, 'A');
  assert.deepEqual(prepared, ['A', 'B']);
  assert.equal(navigation.busy, false);
});
test('superseded startup failure does not cancel the latest target', async () => {
  const gate = deferred<string>();
  let active = 'original';
  const navigation = new SessionNavigation(id => id === 'bad' ? gate.promise : Promise.resolve(id),
    id => active = id);
  const bad = navigation.select('bad');
  const good = navigation.select('good');
  gate.reject(new Error('startup failed'));
  assert.equal(await bad, null);
  assert.equal(await good, 'good');
  assert.equal(active, 'good');
});
test('latest failure preserves the confirmed identity and subsequent selection can retry', async () => {
  let active = 'original';
  const navigation = new SessionNavigation(async id => {
    if (id === 'bad') throw new Error('startup failed');
    return id;
  }, id => active = id);
  await assert.rejects(navigation.select('bad'), /startup failed/);
  assert.equal(active, 'original');
  assert.equal(navigation.busy, false);
  assert.equal(await navigation.select('retry'), 'retry');
});
const session = (id: string): Session => ({ id, path: id, cwd: '.', firstMessage: id, modified: '1', messageCount: 1 });
test('reading cache stores only detached transcript data and evicts least recently read entries', () => {
  const cache = new SessionReadingCache(2);
  const messages = [{ role: 'user', content: 'original' }];
  cache.set(session('a'), messages);
  messages[0].content = 'mutated';
  assert.deepEqual(cache.get(session('a')), { sessionId: 'a', messages: [{ role: 'user', content: 'original' }] });
  cache.set(session('b'), messages);
  cache.get(session('a'));
  cache.set(session('c'), messages);
  assert.equal(cache.get(session('b')), undefined);
  assert.ok(cache.get(session('a')));
});
test('reading cache invalidates changed or deleted histories and respects serialized byte budget', () => {
  const cache = new SessionReadingCache(6, 200);
  cache.set(session('a'), [{ role: 'user', content: 'short' }]);
  assert.equal(cache.get({ ...session('a'), modified: '2' }), undefined);
  cache.set(session('a'), [{ role: 'user', content: 'short' }]);
  assert.equal(cache.get({ ...session('a'), messageCount: 2 }), undefined);
  cache.set(session('a'), [{ role: 'user', content: 'x'.repeat(200) }]);
  assert.equal(cache.get(session('a')), undefined);
  cache.set(session('a'), [{ role: 'user', content: 'short' }]);
  cache.retain([]);
  assert.equal(cache.get(session('a')), undefined);
});

test('reading anchors survive inserted history and reflow, but never borrow a deleted entry identity', () => {
  const { document } = parseHTML('<div id="scroll"><div class="messages"><article data-message-index="0"></article></div></div>');
  const viewport = document.getElementById('scroll')! as unknown as HTMLElement;
  const article = document.querySelector('article')! as unknown as HTMLElement;
  viewport.scrollTop = 500;
  viewport.getBoundingClientRect = () => ({ top: 100 } as DOMRect);
  article.getBoundingClientRect = () => ({ top: 125, bottom: 300 } as DOMRect);
  const message = { role: 'user', content: 'question', entryId: 'stable', timestamp: 1 };
  const position = captureReadingPosition(viewport, [message], false);
  assert.equal(position.anchor?.entryId, 'stable');
  article.dataset.messageIndex = '1';
  article.getBoundingClientRect = () => ({ top: 190, bottom: 365 } as DOMRect);
  restoreReadingPosition(viewport, [{ role: 'user', content: 'inserted' }, message], position);
  assert.equal(viewport.scrollTop, 565);
  viewport.scrollTop = 0;
  restoreReadingPosition(viewport, [{ role: 'user', content: 'replacement', timestamp: 1 }], position);
  assert.equal(viewport.scrollTop, 500, 'Missing stable entry falls back to stored scroll top, not another question');
});
