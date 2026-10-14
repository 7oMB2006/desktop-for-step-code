import test from 'node:test';
import assert from 'node:assert/strict';
import { cacheHitRate, displayedUsage, outputTokensPerSecond, updateRunMetrics } from '../src/performance';

test('run metrics accumulate finalized usage once across streaming updates and tool calls', () => {
  let run = updateRunMetrics(null, { type: 'agent_start' }, 1000);
  run = updateRunMetrics(run, { type: 'turn_start' }, 1100);
  run = updateRunMetrics(run, { type: 'message_update', usage: { input: 10, output: 2, cacheRead: 10, cacheWrite: 0 }, assistantMessageEvent: { type: 'text_delta', delta: 'Hello' } }, 1400);
  assert.equal(run?.firstTextAt, 1400);
  assert.equal(displayedUsage(run!).output, 2);
  run = updateRunMetrics(run, { type: 'message_end', message: { role: 'assistant', content: [{ type: 'text', text: 'Hello' }], usage: { input: 10, output: 4, cacheRead: 10, cacheWrite: 0 } } }, 1500);
  assert.equal(displayedUsage(run!).output, 4);
  run = updateRunMetrics(run, { type: 'tool_execution_start', toolCallId: 'one' }, 1600);
  run = updateRunMetrics(run, { type: 'tool_execution_end', toolCallId: 'one' }, 1900);
  run = updateRunMetrics(run, { type: 'turn_start' }, 2000);
  run = updateRunMetrics(run, { type: 'message_end', message: { role: 'assistant', content: [], usage: { input: 20, output: 6, cacheRead: 0, cacheWrite: 0 } } }, 2500);
  run = updateRunMetrics(run, { type: 'agent_end' }, 2600);
  assert.equal(run?.turns, 2);
  assert.equal(run?.tools, 1);
  assert.equal(run?.toolTimeMs, 300);
  assert.equal(run?.finishedAt, 2600);
  assert.deepEqual(displayedUsage(run!), { input: 30, output: 10, cacheRead: 10, cacheWrite: 0 });
  assert.equal(cacheHitRate(displayedUsage(run!)), 0.25);
});

test('TPS aggregates completed output streams without tools, first-token waits or final metadata delays', () => {
  let run = updateRunMetrics(null, { type: 'agent_start' }, 0);
  run = updateRunMetrics(run, { type: 'message_start', message: { role: 'assistant' } }, 100);
  run = updateRunMetrics(run, { type: 'message_update', assistantMessageEvent: { type: 'thinking_delta', delta: 'a' } }, 1000);
  run = updateRunMetrics(run, { type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: 'b' } }, 2000);
  assert.equal(outputTokensPerSecond(run), undefined, 'do not guess tokens from text');
  run = updateRunMetrics(run, { type: 'message_end', message: { role: 'assistant', usage: { output: 48 } } }, 5000);
  assert.equal(outputTokensPerSecond(run), 48);
  run = updateRunMetrics(run, { type: 'tool_execution_start', toolCallId: 'one' }, 6000);
  run = updateRunMetrics(run, { type: 'tool_execution_end', toolCallId: 'one' }, 66000);
  assert.equal(outputTokensPerSecond(run), 48);
  run = updateRunMetrics(run, { type: 'message_start', message: { role: 'assistant' } }, 67000);
  run = updateRunMetrics(run, { type: 'message_update', assistantMessageEvent: { type: 'toolcall_delta', delta: '{' } }, 70000);
  run = updateRunMetrics(run, { type: 'message_update', assistantMessageEvent: { type: 'toolcall_delta', delta: '}' } }, 73000);
  run = updateRunMetrics(run, { type: 'message_end', message: { role: 'assistant', usage: { output: 72 } } }, 75000);
  assert.equal(outputTokensPerSecond(run), 30, 'weight by stream duration rather than averaging TPS');
  run = updateRunMetrics(run, { type: 'agent_end' }, 90000);
  assert.equal(outputTokensPerSecond(run), 30);
  assert.equal(outputTokensPerSecond(updateRunMetrics(run, { type: 'agent_start' }, 100000)), undefined);
});

test('working phase follows thinking, prose and tool events without reading historical prose', () => {
  let run = updateRunMetrics(null, { type: 'agent_start' }, 0);
  assert.equal(run?.phase, 'responding');
  run = updateRunMetrics(run, { type: 'message_start', message: { role: 'assistant' } }, 5);
  assert.equal(run?.phase, 'responding');
  run = updateRunMetrics(run, { type: 'message_update', assistantMessageEvent: { type: 'thinking_start' } }, 10);
  assert.equal(run?.phase, 'thinking');
  run = updateRunMetrics(run, { type: 'message_update', assistantMessageEvent: { type: 'thinking_end' } }, 20);
  assert.equal(run?.phase, 'thinking');
  run = updateRunMetrics(run, { type: 'message_update', assistantMessageEvent: { type: 'text_start' } }, 30);
  assert.equal(run?.phase, 'executing');
  run = updateRunMetrics(run, { type: 'message_update', assistantMessageEvent: { type: 'thinking_delta', delta: 'a' } }, 40);
  assert.equal(run?.phase, 'thinking');
  run = updateRunMetrics(run, { type: 'tool_execution_start', toolCallId: 'one' }, 50);
  assert.equal(run?.phase, 'executing');
  run = updateRunMetrics(run, { type: 'agent_end' }, 60);
  run = updateRunMetrics(run, { type: 'message_update', assistantMessageEvent: { type: 'thinking_start' } }, 70);
  assert.equal(run?.phase, 'executing', 'late events cannot revive a completed phase');
});

test('unmeasured, invalid, single-chunk, hidden and interrupted output does not fabricate TPS', () => {
  for (const usage of [undefined, { output: NaN }, { output: -1 }, { output: 0 }]) {
    let run = updateRunMetrics(null, { type: 'agent_start' }, 0);
    run = updateRunMetrics(run, { type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: 'a' } }, 1000);
    run = updateRunMetrics(run, { type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: 'b' } }, 2000);
    run = updateRunMetrics(run, { type: 'message_end', message: { role: 'assistant', usage } }, 3000);
    assert.equal(outputTokensPerSecond(run), undefined);
  }
  for (const stopReason of ['aborted', 'error']) {
    let run = updateRunMetrics(null, { type: 'agent_start' }, 0);
    run = updateRunMetrics(run, { type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: 'a' } }, 1000);
    run = updateRunMetrics(run, { type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: 'b' } }, 2000);
    run = updateRunMetrics(run, { type: 'message_end', message: { role: 'assistant', usage: { output: 48 }, stopReason } }, 3000);
    assert.equal(outputTokensPerSecond(run), undefined);
  }
  let run = updateRunMetrics(null, { type: 'agent_start' }, 0);
  run = updateRunMetrics(run, { type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: '' } }, 1000);
  run = updateRunMetrics(run, { type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: 'one chunk' } }, 2000);
  run = updateRunMetrics(run, { type: 'message_end', message: { role: 'assistant', usage: { output: 48 } } }, 3000);
  assert.equal(outputTokensPerSecond(run), undefined);
  run = updateRunMetrics(run, { type: 'message_end', message: { role: 'assistant', usage: { output: 48 } } }, 4000);
  assert.equal(outputTokensPerSecond(run), undefined);
});

test('missing cache usage stays unknown and a new run clears previous metrics', () => {
  assert.equal(cacheHitRate({ input: 100, output: 50, cacheRead: 0, cacheWrite: 0 }), undefined);
  const first = updateRunMetrics(null, { type: 'agent_start' }, 0);
  const next = updateRunMetrics(first, { type: 'agent_start' }, 5000);
  assert.equal(next?.startedAt, 5000);
  assert.equal(next?.tools, 0);
  assert.equal(updateRunMetrics(null, { type: 'message_end', message: { role: 'assistant' } }, 10), null);
});
