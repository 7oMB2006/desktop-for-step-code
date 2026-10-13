import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { parseHTML } from 'linkedom';
import { ArchivedSessions } from '../src/ArchivedSessions';
import type { Preferences, Session } from '../src/contracts';
import { currentPlatform, platformPathKey } from '../src/platform-path';
import { moveSession, validateSidebarPreferences } from '../src/sidebar-order';

const session = (id: string, cwd: string, workspacePath?: string): Session => ({
  id, cwd, workspacePath, path: `/sessions/${id}.jsonl`, firstMessage: id,
  messageCount: 1, modified: '2026-10-13T00:00:00Z',
});

function rendererPlatform<T>(platform: string, run: () => T): T {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'window');
  try {
    Object.defineProperty(globalThis, 'window', { configurable: true, value: { desktop: { platform } } });
    return run();
  } finally {
    if (original) Object.defineProperty(globalThis, 'window', original);
    else Reflect.deleteProperty(globalThis, 'window');
  }
}

function archives(platform: string, sessions: Session[], workspaceNames: Record<string, string> = {}) {
  return rendererPlatform(platform, () => parseHTML(renderToStaticMarkup(createElement(ArchivedSessions, {
    sessions, preferences: { language: 'en', theme: 'light', workspaces: [], workspaceNames }, runtimes: [],
    onOpen() {}, async onRestore() {}, async onDelete() {},
  }))).document);
}

test('Linux archive uses the exact mixed-case workspace key for its title and filter', () => {
  const path = '/home/Dev/MyProject';
  const document = archives('linux', [session('mixed', path)], { [path]: 'Renamed project' });
  assert.equal(document.querySelector('.archive-project h4')?.textContent, 'Renamed project');
  assert.deepEqual([...document.querySelectorAll('option')].map(option => [option.getAttribute('value'), option.textContent]),
    [['', 'All projects'], [path, 'Renamed project']]);
});

test('Linux root workspace does not collide with the all-projects archive filter', () => {
  const document = archives('linux', [session('root', '/')], { '/': 'Root project' });
  assert.equal(document.querySelector('.archive-project h4')?.textContent, 'Root project');
  assert.deepEqual([...document.querySelectorAll('option')].map(option => option.getAttribute('value')), ['', '/']);
});

test('Linux archive keeps case-distinct workspace groups, names, and filter choices separate', () => {
  const upper = '/home/Dev/Foo', lower = '/home/Dev/foo';
  const document = archives('linux', [session('upper', '/unrelated/cwd', upper), session('lower', lower)],
    { [upper]: 'Upper project', [lower]: 'Lower project' });
  const groups = [...document.querySelectorAll('.archive-project')];
  assert.equal(groups.length, 2);
  assert.deepEqual(groups.map(group => [group.querySelector('h4')?.textContent,
    [...group.querySelectorAll('[data-archived-session-id]')].map(row => row.getAttribute('data-archived-session-id'))]),
  [['Upper project', ['upper']], ['Lower project', ['lower']]]);
  assert.deepEqual([...document.querySelectorAll('option')].map(option => option.getAttribute('value')), ['', upper, lower]);
});

test('Linux archive keeps literal-backslash and nested-directory identities separate', () => {
  const literal = '/home/Dev/Foo\\bar', nested = '/home/Dev/Foo/bar';
  const document = archives('linux', [session('literal', literal), session('nested', nested)],
    { [literal]: 'Literal backslash', [nested]: 'Nested directory' });
  assert.deepEqual([...document.querySelectorAll('.archive-project h4')].map(header => header.textContent),
    ['Literal backslash', 'Nested directory']);
  assert.deepEqual([...document.querySelectorAll('option')].map(option => option.getAttribute('value')), ['', literal, nested]);
});

test('Windows archive still merges case and separator aliases and uses the normalized title', () => {
  const document = archives('win32', [session('upper', 'C:\\Projects\\Foo\\'), session('lower', 'c:/projects/foo')],
    { 'c:/projects/foo': 'Windows project' });
  assert.equal(document.querySelectorAll('.archive-project').length, 1);
  assert.equal(document.querySelector('.archive-project h4')?.textContent, 'Windows project');
  assert.equal(document.querySelectorAll('.archive-project [data-archived-session-id]').length, 2);
  assert.deepEqual([...document.querySelectorAll('option')].map(option => option.getAttribute('value')), ['', 'c:/projects/foo']);
});

test('renderer keys preserve Linux pins and workspace reorder through IPC validation', () => {
  rendererPlatform('linux', () => {
    const key = (path: string) => platformPathKey(path, currentPlatform());
    const workspaces = ['/home/Dev/Foo', '/home/Dev/foo'];
    const pinnedWorkspaces = workspaces.map(key);
    assert.deepEqual(validateSidebarPreferences({ pinnedWorkspaces }, [], workspaces, key), { pinnedWorkspaces: workspaces });
    assert.deepEqual(validateSidebarPreferences({ pinnedWorkspaces: [key(workspaces[0])] }, [], [workspaces[0]], key),
      { pinnedWorkspaces: [workspaces[0]] }, 'pinning one mixed-case workspace must not require a lowercase alias');
    const order = moveSession(workspaces.map(key), key(workspaces[1]), key(workspaces[0]), false);
    const patch: Partial<Preferences> = { workspaces: order.map(id => workspaces.find(path => key(path) === id)!) };
    assert.deepEqual(validateSidebarPreferences(patch, [], workspaces, key), { workspaces: [...workspaces].reverse() });
    assert.throws(() => validateSidebarPreferences({ pinnedWorkspaces: [workspaces[0].toLowerCase()] }, [], [workspaces[0]], key),
      /Invalid pinned workspaces/, 'the old renderer key must still be rejected by Linux validation');
    assert.deepEqual(validateSidebarPreferences({ pinnedWorkspaces: [key('/')] }, [], ['/'], key), { pinnedWorkspaces: ['/'] });
  });
});
