import test from 'node:test';
import assert from 'node:assert/strict';
import { relocatedWorkspace, relocateWorkspace, removeWorkspace } from '../electron/workspace-management';
import type { Preferences } from '../src/contracts';

const base = (): Preferences => ({ theme: 'light', language: 'zh', workspaces: ['D:\\Old', 'D:\\Other'],
  workspace: 'D:\\Old', workspaceNames: { 'd:/old': 'My project' }, pinnedWorkspaces: ['d:/old'] });
const sessions = [{ id: 'old-session', cwd: 'D:\\Old' }, { id: 'unrelated-session', cwd: 'D:\\Old\\unrelated' }];

test('removal only removes the registered grouping and metadata', () => {
  const source = base();
  const result = removeWorkspace(source, 'd:/OLD/');
  assert.deepEqual(result.workspaces, ['D:\\Other']);
  assert.equal(result.workspace, undefined);
  assert.deepEqual(result.workspaceNames, {});
  assert.deepEqual(result.pinnedWorkspaces, []);
  assert.deepEqual(source, base(), 'original preferences remain unchanged');
});

test('relocation preserves position, name, pin and remembered selection', () => {
  const result = relocateWorkspace(base(), 'd:/old', 'D:\\New', sessions);
  assert.deepEqual(result.workspaces, ['D:\\New', 'D:\\Other']);
  assert.equal(result.workspace, 'D:\\New');
  assert.deepEqual(result.workspaceNames, { 'd:/new': 'My project' });
  assert.deepEqual(result.pinnedWorkspaces, ['d:/new']);
  assert.equal(relocatedWorkspace('D:\\Old', result, 'old-session'), 'D:\\New');
  assert.equal(relocatedWorkspace('D:\\Old\\unrelated', result, 'unrelated-session'), 'D:\\Old\\unrelated');
});

test('repeated relocation flattens redirects and survives project removal', () => {
  const first = relocateWorkspace(base(), 'D:\\Old', 'D:\\New', sessions);
  const second = relocateWorkspace(first, 'D:\\New', 'D:\\Final', [{ id: 'new-session', cwd: 'D:\\New' }]);
  assert.equal(relocatedWorkspace('D:\\Old', second, 'old-session'), 'D:\\Final');
  assert.equal(relocatedWorkspace('D:\\New', second, 'new-session'), 'D:\\Final');
  assert.equal(relocatedWorkspace('D:\\Old', removeWorkspace(second, 'D:\\Final'), 'old-session'), 'D:\\Final');
  const restored = relocateWorkspace(second, 'D:\\Final', 'D:\\Old', []);
  assert.equal(relocatedWorkspace('D:\\Old', restored, 'old-session'), 'D:\\Old');
  assert.equal(relocatedWorkspace('D:\\New', restored, 'new-session'), 'D:\\Old');
});

test('reused source paths never redirect newly created histories', () => {
  const moved = relocateWorkspace(base(), 'D:\\Old', 'D:\\New', sessions);
  const reopened = { ...moved, workspaces: [...moved.workspaces, 'D:\\Old'] };
  assert.equal(relocatedWorkspace('D:\\Old', reopened, 'fresh-session'), 'D:\\Old');
  assert.equal(relocatedWorkspace('D:\\Old', reopened, 'old-session'), 'D:\\New');
  const movedAgain = relocateWorkspace(reopened, 'D:\\Old', 'D:\\Third', [{ id: 'fresh-session', cwd: 'D:\\Old' }]);
  assert.equal(relocatedWorkspace('D:\\Old', movedAgain, 'fresh-session'), 'D:\\Third');
  assert.equal(relocatedWorkspace('D:\\Old', movedAgain, 'old-session'), 'D:\\New');
});

test('unknown projects and already registered destinations are rejected', () => {
  assert.throws(() => removeWorkspace(base(), 'D:\\Missing'), /Unknown workspace/);
  assert.throws(() => relocateWorkspace(base(), 'D:\\Missing', 'D:\\New', []), /Unknown workspace/);
  assert.throws(() => relocateWorkspace(base(), 'D:\\Old', 'D:\\Other', []), /already a project/);
});

test('relocation carries collapsed state and removal clears only that project', () => {
  const source = { ...base(), collapsedWorkspaces: ['d:/old', 'd:/other', '__independent__'] };
  const moved = relocateWorkspace(source, 'D:\\Old', 'D:\\New', sessions);
  assert.deepEqual(moved.collapsedWorkspaces, ['d:/new', 'd:/other', '__independent__']);
  assert.deepEqual(removeWorkspace(moved, 'D:\\New').collapsedWorkspaces, ['d:/other', '__independent__']);
  assert.deepEqual(source.collapsedWorkspaces, ['d:/old', 'd:/other', '__independent__']);
});
