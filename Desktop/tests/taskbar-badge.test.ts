import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { TaskbarBadge, completionBadgeText } from '../electron/taskbar-badge';

test('taskbar badge counts distinct unread sessions and clears only the affected session', () => {
  let focused = 'foreground';
  const archived = new Set<string>();
  const updates: number[] = [];
  const badge = new TaskbarBadge({
    foreground: id => id === focused, archived: id => archived.has(id),
    apply: count => { updates.push(count); return true; },
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
  assert.deepEqual(updates, [0, 1, 2, 1, 2, 1, 0]);
});

test('taskbar badge retries when its platform sink is unavailable and can reapply on restore', () => {
  let available = false;
  const updates: number[] = [];
  const badge = new TaskbarBadge({
    foreground: () => false, archived: () => false,
    apply: count => { if (available) updates.push(count); return available; },
  });
  badge.complete('session');
  available = true;
  badge.sync();
  badge.sync();
  badge.sync(true);
  assert.deepEqual(updates, [1, 1]);
});

test('Dock badge text clears at zero and caps the displayed count at 9+', () => {
  assert.deepEqual([0, 1, 9, 10, 100].map(completionBadgeText), ['', '1', '9', '9+', '9+']);
});
