import { test } from 'node:test';
import assert from 'node:assert/strict';
import { themeQueueSamples, updateThemeQueue } from './fixtures/theme-pack-queue';
import { quotePresentation } from '../src/chat-quotes';

test('preview queue uses real quote serialization and isolated sample data', () => {
  const queue = themeQueueSamples();
  assert.equal(quotePresentation(queue[0].message)?.quotes[0].annotation, '保持原来的星海构图。');
  queue[0].message = 'changed';
  assert.notEqual(themeQueueSamples()[0].message, 'changed');
});
test('preview edits are versioned and stale or invalid operations are rejected', () => {
  const queue = themeQueueSamples();
  const args = { id: queue[1].id, version: 1, message: '新的检查内容' };
  const result = updateThemeQueue(queue, 'queue_edit', args);
  assert.equal(result.messages[1].version, 2);
  assert.equal(result.messages[1].message, args.message);
  assert.equal(queue[1].version, 1);
  assert.throws(() => updateThemeQueue(result.messages, 'queue_edit', args), /已变化/);
  assert.throws(() => updateThemeQueue(queue, 'queue_edit', { ...args, message: '' }), /有效/);
  assert.throws(() => updateThemeQueue(queue, 'queue_edit', { ...args, message: 'x'.repeat(100001) }), /有效/);
  assert.throws(() => updateThemeQueue(queue, 'unknown', args), /不支持/);
});
test('withdraw and steer affect only the selected in-memory item', () => {
  const queue = themeQueueSamples();
  const args = { id: queue[1].id, version: 1 };
  const removed = updateThemeQueue(queue, 'queue_remove', args);
  assert.equal(removed.delivered, undefined);
  assert.deepEqual(removed.messages.map(item => item.id), [queue[0].id, queue[2].id]);
  assert.deepEqual(updateThemeQueue(queue, 'queue_steer', args).delivered, queue[1]);
  assert.deepEqual(updateThemeQueue(queue, 'queue_steer_first').delivered, queue[0]);
  assert.throws(() => updateThemeQueue([], 'queue_steer_first'), /已变化/);
  assert.equal(queue.length, 3);
});
