import test from 'node:test';
import assert from 'node:assert/strict';
import { MINI_INDEPENDENT_PROJECT, miniChatCatalog, miniChatGroups, type MiniChatProject, type MiniChatSession } from '../src/mini-chat-sessions';
import type { Preferences, Session } from '../src/contracts';

const projects: MiniChatProject[] = [
  { id: 'desktop', name: 'Desktop', path: 'C:\\Projects\\Desktop' },
  { id: 'local', name: 'web-app', path: 'C:\\Projects\\web-app' },
  { id: 'client', name: 'web-app', path: 'D:\\Clients\\web-app' },
  { id: 'empty', name: 'Empty project', path: 'C:\\Projects\\empty' },
  { id: MINI_INDEPENDENT_PROJECT, name: 'Independent sessions' },
];
const sessions: MiniChatSession[] = [
  { id: 'one', title: 'Configuration checks', projectId: 'desktop', searchText: 'Verify release permissions' },
  { id: 'two', title: 'Configuration checks', projectId: 'local' },
  { id: 'three', title: 'Configuration checks', projectId: 'client' },
  { id: 'four', title: 'Notes', projectId: MINI_INDEPENDENT_PROJECT, path: 'C:\\Scratch' },
];

test('the current project comes first without losing empty or independent projects', () => {
  const groups = miniChatGroups(projects, sessions, 'local', '');
  assert.deepEqual(groups.map(group => group.project.id), ['local', 'desktop', 'client', 'empty', MINI_INDEPENDENT_PROJECT]);
  assert.equal(groups.find(group => group.project.id === 'empty')!.total, 0);
  assert.deepEqual(groups.at(-1)!.sessions.map(session => session.id), ['four']);
  assert.deepEqual(projects.map(project => project.id), ['desktop', 'local', 'client', 'empty', MINI_INDEPENDENT_PROJECT]);
});

test('same-name projects remain separate and disclose their full paths', () => {
  const groups = miniChatGroups(projects, sessions, 'desktop', 'Configuration');
  assert.deepEqual(groups.map(group => [group.project.id, group.sessions[0].id, group.showPath]), [
    ['desktop', 'one', false], ['local', 'two', true], ['client', 'three', true],
  ]);
});

test('search matches terms across title, project, path and initial prompt', () => {
  for (const [query, expected] of [
    ['web-app configuration', ['two', 'three']], ['D:/clients configuration', ['three']],
    ['desktop release', ['one']], ['ＣＯＮＦＩＧＵＲＡＴＩＯＮ', ['one', 'two', 'three']],
    ['scratch notes', ['four']], ['not-found', []],
  ] as const) {
    assert.deepEqual(miniChatGroups(projects, sessions, 'desktop', query).flatMap(group => group.sessions.map(session => session.id)), expected);
  }
  assert.deepEqual(miniChatGroups(projects, sessions, 'desktop', 'empty project').map(group => group.project.id), ['empty']);
});

test('catalog excludes archives and retains sidebar ordering and project names', () => {
  const preferences: Preferences = {
    language: 'en', theme: 'dark', workspaces: ['C:\\Projects\\Desktop', 'c:/projects/desktop/', 'D:\\Clients\\web-app'],
    workspaceNames: { 'c:/projects/desktop': 'Desktop renamed' }, archivedSessionIds: ['archived'],
    sessionSort: 'manual', sessionOrder: ['two', 'one'],
  };
  const record = (id: string, cwd: string, extra: Partial<Session> = {}): Session =>
    ({ id, cwd, path: `${id}.jsonl`, firstMessage: id, modified: '2026-11-08T00:00:00Z', messageCount: 2, ...extra });
  const { projects: catalogProjects, sessions: catalog } = miniChatCatalog([
    record('one', 'C:\\Projects\\Desktop'), record('two', 'D:\\Clients\\web-app'),
    record('archived', 'C:\\Projects\\Desktop'), record('independent', 'C:\\Projects\\Desktop', { independent: true }),
    record('outside', 'C:\\Other'), record('orphan', 'C:\\Removed', { independent: false }),
    record('subdir', 'D:\\Clients\\web-app\\src', { workspacePath: 'D:\\Clients\\web-app' }),
  ], preferences);
  assert.equal(catalogProjects.length, 3);
  assert.equal(catalogProjects[0].name, 'Desktop renamed');
  assert.deepEqual(catalog.slice(-2).map(session => session.id), ['two', 'one']);
  assert.equal(catalog.some(session => session.id === 'archived'), false);
  assert.equal(catalog.find(session => session.id === 'independent')!.projectId, MINI_INDEPENDENT_PROJECT);
  assert.equal(catalog.find(session => session.id === 'outside')!.projectId, MINI_INDEPENDENT_PROJECT);
  assert.equal(catalog.find(session => session.id === 'orphan')!.projectId, MINI_INDEPENDENT_PROJECT);
  assert.equal(catalog.find(session => session.id === 'subdir')!.projectId, 'd:/clients/web-app');
  assert.equal(miniChatGroups(catalogProjects, catalog, '', '').flatMap(group => group.sessions).length, catalog.length);
});

test('POSIX projects retain case-sensitive identities and names', () => {
  const preferences: Preferences = {
    language: 'zh', theme: 'light', workspaces: ['/Projects/Web', '/Projects/web'],
    workspaceNames: { '/Projects/Web': 'Uppercase project' },
  };
  const sessions: Session[] = ['/Projects/Web', '/Projects/web'].map((cwd, index) => ({
    id: `${index}`, cwd, path: `${cwd}/session.jsonl`, firstMessage: '', modified: '2026-11-08T00:00:00Z', messageCount: 0,
  }));
  const catalog = miniChatCatalog(sessions, preferences, 'darwin');
  assert.deepEqual(catalog.projects.map(project => project.name), ['Uppercase project', 'web', '独立会话']);
  assert.deepEqual(catalog.sessions.map(session => session.projectId), ['/Projects/Web', '/Projects/web']);
  assert.equal(catalog.sessions[0].title, '新会话');
});

test('pinned project order is retained behind the current project', () => {
  const preferences: Preferences = {
    language: 'en', theme: 'light', workspaces: ['C:\\One', 'C:\\Two', 'C:\\Three'],
    pinnedWorkspaces: ['c:/three', 'c:/two'],
  };
  const { projects } = miniChatCatalog([], preferences);
  assert.deepEqual(projects.map(project => project.id), ['c:/three', 'c:/two', 'c:/one', MINI_INDEPENDENT_PROJECT]);
  assert.deepEqual(miniChatGroups(projects, [], 'c:/one', '').map(group => group.project.id),
    ['c:/one', 'c:/three', 'c:/two', MINI_INDEPENDENT_PROJECT]);
  assert.deepEqual(preferences.workspaces, ['C:\\One', 'C:\\Two', 'C:\\Three']);
});
