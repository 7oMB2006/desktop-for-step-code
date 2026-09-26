import test from 'node:test';
import assert from 'node:assert/strict';
import { cacheHitRate, displayedUsage, updateRunMetrics } from '../src/performance';

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

test('missing cache usage stays unknown and a new run clears previous metrics', () => {
  assert.equal(cacheHitRate({ input: 100, output: 50, cacheRead: 0, cacheWrite: 0 }), undefined);
  const first = updateRunMetrics(null, { type: 'agent_start' }, 0);
  const next = updateRunMetrics(first, { type: 'agent_start' }, 5000);
  assert.equal(next?.startedAt, 5000);
  assert.equal(next?.tools, 0);
  assert.equal(updateRunMetrics(null, { type: 'message_end', message: { role: 'assistant' } }, 10), null);
});
