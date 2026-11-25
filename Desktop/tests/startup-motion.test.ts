import assert from 'node:assert/strict';
import { test } from 'node:test';
import { STARTUP_FINISH_TIMEOUT_MS, STARTUP_SETTLE_MS, STARTUP_STELLAR_MS, startupFrame } from '../src/startup-motion';

test('startup begins in silence before sparks, acceleration and a settled emblem', () => {
  assert.deepEqual(startupFrame(-100), { birth: 0, gather: 0, resolve: 0, glow: 0 });
  assert.deepEqual(startupFrame(160), startupFrame(0));
  assert.ok(startupFrame(400).birth > 0 && startupFrame(400).birth < .5);
  assert.equal(startupFrame(400).gather, 0, 'sparks precede convergence');
  assert.equal(startupFrame(780).birth, 1);
  assert.ok(startupFrame(900).gather < .05, 'the inward motion holds tension before accelerating');
  assert.ok(startupFrame(1550).gather > .5, 'the middle accelerates decisively');
  assert.equal(startupFrame(1850).resolve, 0, 'the settled footprint has not been released early');
  assert.ok(startupFrame(2100).resolve > 0 && startupFrame(2100).resolve < 1);
  assert.ok(startupFrame(2000).glow > .7);
  const final = startupFrame(STARTUP_STELLAR_MS);
  assert.deepEqual({ ...final, glow: 0 }, { birth: 1, gather: 1, resolve: 1, glow: 0 });
  assert.ok(Math.abs(final.glow) < 1e-12);
  assert.deepEqual(startupFrame(STARTUP_STELLAR_MS + 1000), final);
  for (let time = 0; time <= STARTUP_STELLAR_MS; time += 10) {
    const frame = startupFrame(time), previous = startupFrame(time - 10);
    for (const key of ['birth', 'gather', 'resolve'] as const)
      assert.ok(frame[key] >= previous[key] && frame[key] >= 0 && frame[key] <= 1, key);
    assert.ok(frame.glow >= 0 && frame.glow <= 1);
  }
  assert.ok(STARTUP_STELLAR_MS + STARTUP_SETTLE_MS < STARTUP_FINISH_TIMEOUT_MS);
});
