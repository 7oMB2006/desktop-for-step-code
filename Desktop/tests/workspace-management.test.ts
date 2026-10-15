import test from 'node:test';
import assert from 'node:assert/strict';
import { relocatedWorkspace, relocateWorkspace, removeWorkspace } from '../electron/workspace-management';
import type { Preferences } from '../src/contracts';

const base = (): Preferences => ({ theme: 'light', language: 'zh', workspaces: ['D:\\Old', 'D:\\Other'],
  workspace: 'D:\\Old', workspaceNames: { 'd:/old': 'My project' }, pinnedWorkspaces: ['d:/old'] });

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
  const result = relocateWorkspace(base(), 'd:/old', 'D:\\New');
  assert.deepEqual(result.workspaces, ['D:\\New', 'D:\\Other']);
  assert.equal(result.workspace, 'D:\\New');
  assert.deepEqual(result.workspaceNames, { 'd:/new': 'My project' });
  assert.deepEqual(result.pinnedWorkspaces, ['d:/new']);
  assert.equal(relocatedWorkspace('D:\\Old', result), 'D:\\New');
  assert.equal(relocatedWorkspace('D:\\Old\\unrelated', result), 'D:\\Old\\unrelated');
});

test('repeated relocation flattens redirects and survives project removal', () => {
  const first = relocateWorkspace(base(), 'D:\\Old', 'D:\\New');
  const second = relocateWorkspace(first, 'D:\\New', 'D:\\Final');
  assert.equal(relocatedWorkspace('D:\\Old', second), 'D:\\Final');
  assert.equal(relocatedWorkspace('D:\\New', second), 'D:\\Final');
  assert.equal(relocatedWorkspace('D:\\Old', removeWorkspace(second, 'D:\\Final')), 'D:\\Final');
  const restored = relocateWorkspace(second, 'D:\\Final', 'D:\\Old');
  assert.equal(relocatedWorkspace('D:\\Old', restored), 'D:\\Old');
  assert.equal(relocatedWorkspace('D:\\New', restored), 'D:\\Old');
});

test('unknown projects and already registered destinations are rejected', () => {
  assert.throws(() => removeWorkspace(base(), 'D:\\Missing'), /Unknown workspace/);
  assert.throws(() => relocateWorkspace(base(), 'D:\\Missing', 'D:\\New'), /Unknown workspace/);
  assert.throws(() => relocateWorkspace(base(), 'D:\\Old', 'D:\\Other'), /already a project/);
});
