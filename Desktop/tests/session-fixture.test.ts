import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import test from 'node:test';

const { waitForSessionFixtureSnapshot } = await import(new URL('../scripts/session-fixture.mjs', import.meta.url).href);

test('fixture polling awaits each IPC snapshot until the response has settled', async () => {
  const pending = { messages: [], state: { isStreaming: false } };
  const streaming = { messages: ['response'], state: { isStreaming: true } };
  const settled = { messages: ['response'], state: { isStreaming: false } };
  const snapshots = [pending, streaming, settled];
  let reads = 0;
  const page = {
    evaluate: async (callback: () => unknown) => runInNewContext(`(${callback.toString()})()`, {
      window: { desktop: { snapshot: async () => snapshots[reads++] } },
    }),
  };
  const actual = await waitForSessionFixtureSnapshot(page,
    (snapshot: typeof settled) => snapshot.messages.length === 1 && !snapshot.state.isStreaming, 'a settled response');
  assert.equal(actual, settled);
  assert.equal(reads, 3, 'a Promise or a streaming response cannot satisfy the wait early');
});

test('fixture polling awaits a predicate that resolves false before retrying', async () => {
  let reads = 0;
  const page = { evaluate: async () => ++reads };
  assert.equal(await waitForSessionFixtureSnapshot(page, async (value: number) => value === 2, 'the second snapshot'), 2);
  assert.equal(reads, 2);
});

test('fixture polling fails within its deadline when no snapshot matches', async () => {
  let reads = 0;
  await assert.rejects(waitForSessionFixtureSnapshot({ evaluate: async () => ++reads },
    () => false, 'a missing model request', 0), /Timed out waiting for a missing model request/);
  assert.equal(reads, 1);
});

test('fixture polling preserves IPC failures', async () => {
  const failure = new Error('Snapshot IPC disconnected');
  await assert.rejects(waitForSessionFixtureSnapshot({ evaluate: async () => { throw failure; } },
    () => true, 'a connected session'), error => error === failure);
});
