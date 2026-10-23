import { test } from 'node:test';
import assert from 'node:assert/strict';
import { onTaskCompletion, playCompletionSound, prepareCompletionSound } from '../src/completion-sound';

test('live completion feedback is scoped, non-replaying and cannot suppress the sound', async () => {
  const calls: string[] = [];
  const original = globalThis.Audio;
  class FakeAudio {
    currentTime = 9;
    preload = '';
    load() { calls.push('load'); }
    play() { calls.push(`sound:${this.currentTime}`); return Promise.resolve(); }
  }
  globalThis.Audio = FakeAudio as unknown as typeof Audio;
  const bad = onTaskCompletion(() => { calls.push('bad'); throw new Error('visual failure'); });
  const first = onTaskCompletion(scope => { calls.push(`${scope.runtimeId}:${scope.sessionId}`); });
  try {
    prepareCompletionSound();
    prepareCompletionSound();
    assert.deepEqual(calls, ['load']);
    playCompletionSound({ runtimeId: 'runtime-a', sessionId: 'session-a' });
    assert.deepEqual(calls, ['load', 'bad', 'runtime-a:session-a', 'sound:0']);
    first(); bad();
    const later = onTaskCompletion(() => calls.push('later'));
    assert.equal(calls.includes('later'), false, 'Mounting a panel cannot replay old completion');
    playCompletionSound({ runtimeId: 'runtime-b', sessionId: 'session-b' });
    assert.deepEqual(calls.slice(-2), ['later', 'sound:0']);
    later();
    playCompletionSound();
    assert.equal(calls.at(-1), 'sound:0', 'Hidden/absent panels still receive the normal sound');
    await Promise.resolve();
  } finally {
    first(); bad();
    globalThis.Audio = original;
  }
});
