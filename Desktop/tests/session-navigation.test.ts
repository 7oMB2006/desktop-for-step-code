import test from 'node:test';
import assert from 'node:assert/strict';
import { SessionNavigation } from '../electron/session-navigation';
import { SessionReadingCache, captureReadingPosition, restoreReadingPosition } from '../src/session-reading';
import { parseHTML } from 'linkedom';
import type { Session } from '../src/contracts';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
test('navigation prepares serially, skips intermediate targets, and commits only the latest', async () => {
  const gate = deferred<string>();
  const prepared: string[] = [], committed: string[] = [], busy: boolean[] = [];
  const navigation = new SessionNavigation(async id => {
    prepared.push(id); return id === 'A' ? gate.promise : id;
  }, id => { committed.push(id); return id; }, value => busy.push(value));
  const a = navigation.select('A');
  const b = navigation.select('B');
  const c = navigation.select('C');
  assert.equal(await b, null);
  assert.deepEqual(prepared, ['A']);
  gate.resolve('A');
  assert.equal(await a, null);
  assert.equal(await c, 'C');
  assert.deepEqual(prepared, ['A', 'C']);
  assert.deepEqual(committed, ['C']);
  assert.deepEqual(busy, [true, false]);
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
