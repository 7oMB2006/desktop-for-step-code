import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizedWorkspaceKey } from '../src/workspace-key';
import { migrateWorkspaceIdentity } from '../electron/workspace-management';

test('Windows identity remains insensitive while POSIX case and literal backslashes survive', () => {
  assert.equal(normalizedWorkspaceKey('C:\\Work\\Foo\\', 'win32'), 'c:/work/foo');
  assert.notEqual(normalizedWorkspaceKey('/Work/Foo', 'darwin'), normalizedWorkspaceKey('/Work/foo', 'darwin'));
  assert.equal(normalizedWorkspaceKey('/Work/a\\b/', 'darwin'), '/Work/a\\b');
});

test('old macOS metadata is migrated only to an unambiguous registered project', () => {
  const base = { theme: 'light' as const, language: 'en' as const, workspaces: ['/Work/Foo'],
    workspaceNames: { '/work/foo': 'Name' }, pinnedWorkspaces: ['/work/foo'], collapsedWorkspaces: ['/work/foo'] };
  const migrated = migrateWorkspaceIdentity(base, 'darwin');
  assert.deepEqual(migrated.workspaceNames, { '/Work/Foo': 'Name' });
  assert.deepEqual(migrated.pinnedWorkspaces, ['/Work/Foo']);
  assert.deepEqual(migrated.collapsedWorkspaces, ['/Work/Foo']);
  const ambiguous = { ...base, workspaces: ['/Work/Foo', '/Work/foo'] };
  assert.deepEqual(migrateWorkspaceIdentity(ambiguous, 'darwin').workspaceNames, {});
  assert.deepEqual(migrateWorkspaceIdentity(ambiguous, 'darwin').pinnedWorkspaces, []);
  assert.equal(migrateWorkspaceIdentity(base, 'win32'), base);
});
