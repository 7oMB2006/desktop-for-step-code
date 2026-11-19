import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { TaskbarBadge, completionBadgeText, taskbarBadgeBitmap } from '../electron/taskbar-badge';

test('taskbar badge counts distinct unread sessions and clears only the affected session', () => {
  let focused = 'foreground';
  const archived = new Set<string>();
  const updates: [number, string][] = [];
  const badge = new TaskbarBadge({
    foreground: id => id === focused, archived: id => archived.has(id), language: () => 'en',
    apply: (count, label) => { updates.push([count, label]); return true; },
  });
  badge.sync();
  badge.complete('foreground');
  badge.complete('one');
  badge.complete('one');
  badge.complete('two');
  focused = 'two';
  badge.sync();
  badge.complete('three');
  archived.add('three');
  badge.sync();
  badge.clear('one');
  assert.deepEqual(updates, [
    [0, ''], [1, '1 conversation with an unread reply'], [2, '2 conversations with unread replies'],
    [1, '1 conversation with an unread reply'], [2, '2 conversations with unread replies'],
    [1, '1 conversation with an unread reply'], [0, ''],
  ]);
});

test('taskbar badge retries when the window is unavailable and can reapply on restore', () => {
  let available = false;
  const updates: number[] = [];
  const badge = new TaskbarBadge({
    foreground: () => false, archived: () => false, language: () => 'zh',
    apply: count => { if (available) updates.push(count); return available; },
  });
  badge.complete('session');
  available = true;
  badge.sync();
  badge.sync();
  badge.sync(true);
  assert.deepEqual(updates, [1, 1]);
});

test('native overlay bitmaps have transparent margins and a stable overflow glyph', () => {
  const one = taskbarBadgeBitmap(1);
  assert.equal(one.length, 16 * 16 * 4);
  assert.equal(one[3], 0);
  assert.ok(one.includes(255));
  assert.notDeepEqual(one, taskbarBadgeBitmap(2));
  assert.notDeepEqual(taskbarBadgeBitmap(9), taskbarBadgeBitmap(10));
  assert.deepEqual(taskbarBadgeBitmap(10), taskbarBadgeBitmap(100));
});

test('Dock badge text clears at zero and shares the Windows overflow limit', () => {
  assert.deepEqual([0, 1, 9, 10, 100].map(completionBadgeText), ['', '1', '9', '9+', '9+']);
});
