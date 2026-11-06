import assert from 'node:assert/strict';
import { test } from 'node:test';

// Scripts live outside the typechecked include set, so import the real helper
// through its URL like the other script-backed protocol tests do.
const { expectCronBlockedMove } = await import(new URL('../scripts/expect-cron-blocked-move.mjs', import.meta.url).href);

type MoveOutcome = Error | 'resolved';

// One mock page is the dependency boundary for every case: it records the exact
// evaluate arguments and keeps the 500 ms retry waits instant.
const mockPage = (outcomes: MoveOutcome[]) => {
  const calls: Array<{ id: string; destination: string }> = [];
  const waits: number[] = [];
  let served = 0;
  return {
    calls,
    waits,
    async evaluate(_evaluate: unknown, argument: { id: string; destination: string }) {
      calls.push(argument);
      const outcome = outcomes[Math.min(served, outcomes.length - 1)];
      served += 1;
      if (outcome === 'resolved') return { state: { sessionId: argument.id } };
      throw outcome;
    },
    async waitForTimeout(milliseconds: number) { waits.push(milliseconds); },
  };
};

const busy = () => new Error("Error invoking remote method 'desktop': Error: Session operation in progress");
const cronBlocked = (detail = 'MOVE_CRON_HOST: job-1') => new Error(`Error invoking remote method 'desktop': Error: ${detail}`);

test('two transient operation races before the Cron rejection still pass', async () => {
  const page = mockPage([busy(), busy(), cronBlocked()]);
  await expectCronBlockedMove(page, 'move-one', '/destination');
  assert.equal(page.calls.length, 3);
  assert.deepEqual(page.calls[2], { id: 'move-one', destination: '/destination' });
  assert.deepEqual(page.waits, [500, 500]);
});

test('an immediate Cron rejection passes without waiting', async () => {
  const page = mockPage([cronBlocked('MOVE_CRON_ASSOCIATED: owned')]);
  await expectCronBlockedMove(page, 'move-two', '/destination');
  assert.equal(page.calls.length, 1);
  assert.deepEqual(page.waits, []);
});

test('an unexpectedly successful move is rejected after a single call', async () => {
  const page = mockPage(['resolved']);
  await assert.rejects(expectCronBlockedMove(page, 'move-one', '/destination'), (error: any) => {
    assert.match(error.message, /unexpectedly succeeded/);
    assert.doesNotMatch(error.message, /cron|scheduled/i);
    return true;
  });
  assert.equal(page.calls.length, 1);
  assert.deepEqual(page.waits, []);
});

test('a non-transient failure preserves the original error', async () => {
  const original = new Error('Background agent output safety is unavailable');
  const page = mockPage([original]);
  await assert.rejects(expectCronBlockedMove(page, 'move-one', '/destination'), (error: any) => {
    assert.equal(error, original);
    return true;
  });
  assert.equal(page.calls.length, 1);
  assert.deepEqual(page.waits, []);
});

test('other operation errors are not retried as the preflight session-operation rejection', async () => {
  const original = new Error('Remote operation in progress after delivery');
  const page = mockPage([original]);
  await assert.rejects(expectCronBlockedMove(page, 'move-one', '/destination'), error => error === original);
  assert.equal(page.calls.length, 1);
  assert.deepEqual(page.waits, []);
});

test('a permanently busy session rejects after six calls and keeps the last error', async () => {
  const last = busy();
  const page = mockPage([busy(), busy(), busy(), busy(), busy(), last]);
  await assert.rejects(expectCronBlockedMove(page, 'move-one', '/destination'), (error: any) => {
    assert.equal(error, last);
    return true;
  });
  assert.equal(page.calls.length, 6);
  assert.deepEqual(page.waits, [500, 500, 500, 500, 500]);
});

test('every Cron ownership code and the legacy wording count as the Cron rejection', async () => {
  for (const detail of ['MOVE_CRON_HOST: job-1, job-2', 'MOVE_CRON_ASSOCIATED: owned', 'MOVE_CRON_UNAVAILABLE',
    'Cron host still owns this session', 'The scheduled task blocks the move']) {
    const page = mockPage([cronBlocked(detail)]);
    await expectCronBlockedMove(page, 'move-one', '/destination');
    assert.equal(page.calls.length, 1, detail);
  }
});

test('the helper drives exactly the page it is given', async () => {
  const page = mockPage([cronBlocked()]);
  const decoy = mockPage([busy()]);
  await expectCronBlockedMove(page, 'move-one', '/destination');
  assert.deepEqual(page.calls[0], { id: 'move-one', destination: '/destination' });
  assert.deepEqual(decoy.calls, []);
});
