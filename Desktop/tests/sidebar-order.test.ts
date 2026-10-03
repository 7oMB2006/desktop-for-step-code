import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Session } from '../src/contracts';
import { moveSession, orderSessions, reconcileSessionOrder, validateSidebarPreferences } from '../src/sidebar-order';

const sessions: Session[] = ['a', 'b', 'c'].map((id, index) => ({ id, path: '', cwd: 'C:/project', firstMessage: id, messageCount: 1, modified: `2026-10-0${index + 1}` }));
const key = (path: string) => path.replaceAll('\\', '/').toLowerCase();

test('manual ordering is the default and ignores updated timestamps and catalog order', () => {
  const preferences = { sessionOrder: ['b', 'a', 'c'] };
  assert.deepEqual(orderSessions([...sessions].reverse(), preferences).map(s => s.id), ['b', 'a', 'c']);
  assert.deepEqual(orderSessions(sessions.map(s => ({ ...s, modified: '2030' })), preferences).map(s => s.id), ['b', 'a', 'c']);
});

test('new sessions enter at the top without disturbing existing order; stale and duplicate IDs are removed', () => {
  assert.deepEqual(reconcileSessionOrder(['b', 'a', 'b', 'gone'], sessions), ['c', 'b', 'a']);
  assert.deepEqual(reconcileSessionOrder([], sessions), ['a', 'b', 'c']);
});

test('updated ordering can be selected without modifying saved manual order', () => {
  const preferences = { sessionSort: 'updated' as const, sessionOrder: ['b', 'a', 'c'] };
  assert.deepEqual(orderSessions(sessions, preferences).map(s => s.id), ['c', 'b', 'a']);
  assert.deepEqual(preferences.sessionOrder, ['b', 'a', 'c']);
});

test('moving a session before or after a target preserves other groups and ignores invalid moves', () => {
  assert.deepEqual(moveSession(['a', 'other', 'b', 'c'], 'c', 'a', false), ['c', 'a', 'other', 'b']);
  assert.deepEqual(moveSession(['a', 'b', 'c'], 'a', 'b', true), ['b', 'a', 'c']);
  assert.deepEqual(moveSession(['a', 'b'], 'a', 'a', false), ['a', 'b']);
  assert.deepEqual(moveSession(['a', 'b'], 'unknown', 'b', true), ['a', 'b']);
});

test('sidebar preferences validate at the IPC boundary and canonicalize pins', () => {
  assert.deepEqual(validateSidebarPreferences({ pinnedWorkspaces: ['C:\\Project'], sessionSort: 'manual', sessionOrder: ['b', 'a'] }, sessions, ['C:/project'], key),
    { pinnedWorkspaces: ['c:/project'], sessionSort: 'manual', sessionOrder: ['c', 'b', 'a'] });
  for (const patch of [{ sessionSort: 'bad' }, { sessionOrder: [123] }, { pinnedWorkspaces: ['C:/unknown'] }, { pinnedWorkspaces: 'bad' }]) {
    assert.throws(() => validateSidebarPreferences(patch as never, sessions, ['C:/project'], key));
  }
});

test('workspace reorder only accepts permutations of remembered projects', () => {
  const workspaces = ['C:/A', 'C:/B'];
  assert.deepEqual(validateSidebarPreferences({ workspaces: ['C:\\B', 'c:/a'] }, sessions, workspaces, key), { workspaces: ['C:/B', 'C:/A'] });
  for (const order of [['C:/A'], ['C:/A', 'C:/A'], ['C:/A', 'C:/unknown'], [null, 'C:/A']]) {
    assert.throws(() => validateSidebarPreferences({ workspaces: order } as never, sessions, workspaces, key));
  }
});
