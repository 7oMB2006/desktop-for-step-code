import test from 'node:test';
import assert from 'node:assert/strict';
import { moveSessionToWorkspace, relocatedWorkspace, relocateWorkspace as relocate, removeWorkspace as remove } from '../electron/workspace-management';
import type { Preferences } from '../src/contracts';

const removeWorkspace = (p: Preferences, path: string) => remove(p, path, 'win32');
const relocateWorkspace = (p: Preferences, from: string, to: string, sessions: readonly { id: string; cwd: string }[]) => relocate(p, from, to, sessions, 'win32');

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

test('macOS case-distinct projects keep separate names, pins, selection and history redirects', () => {
  const p: Preferences = { theme: 'light', language: 'en', workspaces: ['/Work/Foo', '/Work/foo'],
    workspace: '/Work/foo', workspaceNames: { '/Work/Foo': 'Upper', '/Work/foo': 'Lower' },
    pinnedWorkspaces: ['/Work/Foo', '/Work/foo'], collapsedWorkspaces: ['/Work/Foo'] };
  const removed = remove(p, '/Work/Foo', 'darwin');
  assert.deepEqual(removed.workspaces, ['/Work/foo']);
  assert.equal(removed.workspace, '/Work/foo');
  assert.deepEqual(removed.workspaceNames, { '/Work/foo': 'Lower' });
  const moved = relocate(p, '/Work/Foo', '/Work/New', [{ id: 'upper', cwd: '/Work/Foo' }, { id: 'lower', cwd: '/Work/foo' }], 'darwin');
  assert.deepEqual(moved.workspaces, ['/Work/New', '/Work/foo']);
  assert.deepEqual(moved.workspaceSessionRedirects, { upper: '/Work/New' });
  assert.equal(moved.workspace, '/Work/foo');
});

test('moving an independent history changes only its durable cwd association', () => {
  const source: Preferences = { ...base(), collapsedWorkspaces: ['d:/other', '__independent__'],
    workspaceSessionRedirects: { unrelated: 'D:\\Elsewhere' } };
  const session = { id: 'independent', path: 'D:\\Profile\\sessions\\history.jsonl', cwd: 'D:\\Scratch' };
  const result = moveSessionToWorkspace(source, session, 'd:/OTHER/', 'win32');
  assert.deepEqual(result.workspaceSessionRedirects, { unrelated: 'D:\\Elsewhere', independent: 'D:\\Other' });
  assert.deepEqual(result.collapsedWorkspaces, ['__independent__']);
  assert.equal(result.workspace, source.workspace, 'background movement does not change the selected project');
  assert.deepEqual(result.workspaces, source.workspaces);
  assert.deepEqual(result.workspaceNames, source.workspaceNames);
  assert.equal(session.path, 'D:\\Profile\\sessions\\history.jsonl', 'history file is not relocated');
  assert.deepEqual(source.workspaceSessionRedirects, { unrelated: 'D:\\Elsewhere' });
});

test('repeated single-session moves overwrite the same redirect and survive project removal', () => {
  const first = moveSessionToWorkspace(base(), { id: 'one', path: 'history', cwd: 'D:\\Scratch' }, 'D:\\Old', 'win32');
  const second = moveSessionToWorkspace(first, { id: 'one', path: 'history', cwd: 'D:\\Old' }, 'D:\\Other', 'win32');
  assert.deepEqual(second.workspaceSessionRedirects, { one: 'D:\\Other' });
  assert.equal(relocatedWorkspace('D:\\Old', second, 'neighbor'), 'D:\\Old');
  assert.equal(relocatedWorkspace('D:\\Scratch', removeWorkspace(second, 'D:\\Other'), 'one'), 'D:\\Other');
});

test('single-session moves reject unknown, unchanged and unsaved destinations', () => {
  const session = { id: 'one', path: 'history', cwd: 'D:\\Old' };
  assert.throws(() => moveSessionToWorkspace(base(), session, 'D:\\Missing', 'win32'), /Unknown destination/);
  assert.throws(() => moveSessionToWorkspace(base(), session, 'd:/OLD/', 'win32'), /already in/);
  assert.throws(() => moveSessionToWorkspace(base(), { ...session, path: '' }, 'D:\\Other', 'win32'), /Save/);
  assert.throws(() => moveSessionToWorkspace(base(), { ...session, id: '' }, 'D:\\Other', 'win32'), /Save/);
});

test('single-session moves respect case-distinct macOS projects', () => {
  const preferences: Preferences = { theme: 'dark', language: 'en', workspaces: ['/Work/Foo', '/Work/foo'] };
  const session = { id: 'one', path: '/profile/history', cwd: '/Work/Foo' };
  assert.equal(moveSessionToWorkspace(preferences, session, '/Work/foo', 'darwin').workspaceSessionRedirects?.one, '/Work/foo');
  assert.throws(() => moveSessionToWorkspace(preferences, session, '/work/foo', 'darwin'), /Unknown destination/);
});
