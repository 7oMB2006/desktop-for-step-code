import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { parseHTML } from 'linkedom';
import { SidebarTree, type SidebarPreferences } from '../src/SidebarTree';
import { createSidebarActivityReader, updateSidebarSessionNames } from '../src/sidebar-state';
import type { RuntimeSummary, Session } from '../src/contracts';

const session = (id: string, patch: Partial<Session> = {}): Session => ({
  id, cwd: 'D:\\Project', path: `${id}.jsonl`, firstMessage: `First ${id}`, name: id,
  modified: '2026-11-08T00:00:00.000Z', messageCount: 2, ...patch,
});
const runtime = (id: string, status: RuntimeSummary['status'], patch: Partial<RuntimeSummary> = {}): RuntimeSummary => ({
  sessionId: id, runtimeId: `runtime-${id}`, cwd: 'D:\\Project', status, ...patch,
});

test('runtime metrics and unchanged names retain the original session array and objects', () => {
  const sessions = [session('a'), session('b')];
  const next = updateSidebarSessionNames(sessions, [runtime('a', 'running', { name: 'a', backgroundCount: 2 })]);
  assert.equal(next, sessions);
  assert.equal(next[0], sessions[0]);
});
test('runtime names update only their row and preserve first-match and empty-value semantics', () => {
  const sessions = [session('a'), session('b')];
  const next = updateSidebarSessionNames(sessions, [runtime('a', 'running', { name: '', firstMessage: '' }),
    runtime('a', 'idle', { name: 'Must not win' })]);
  assert.notEqual(next, sessions);
  assert.notEqual(next[0], sessions[0]);
  assert.equal(next[0].name, '');
  assert.equal(next[0].firstMessage, sessions[0].firstMessage);
  assert.equal(next[1], sessions[1]);
  assert.equal(sessions[0].name, 'a');
});
test('activity projections retain identity across irrelevant runtime metadata', () => {
  const read = createSidebarActivityReader();
  const saved = new Map([['a', 'running' as const]]);
  const before = read([runtime('a', 'running')], saved, []);
  assert.equal(read([runtime('a', 'running', { backgroundCount: 8, name: 'Changed' })], saved, []), before);
  assert.equal(before.get('a'), 'running');
});
test('unread completion clears independently and never masks waiting or failures', () => {
  const read = createSidebarActivityReader();
  const saved = new Map<string, RuntimeSummary['status']>();
  const runtimes = [runtime('a', 'completed'), runtime('b', 'waiting'), runtime('c', 'failed')];
  assert.deepEqual([...read(runtimes, saved, ['a', 'b', 'c', 'd'])],
    [['a', 'completed'], ['b', 'waiting'], ['c', 'failed'], ['d', 'completed']]);
  const cleared = read(runtimes, saved, []);
  assert.equal(cleared.has('a'), false);
  assert.equal(cleared.get('b'), 'waiting');
  assert.equal(cleared.get('c'), 'failed');
});
test('current runtime status wins over saved status and the first duplicate wins', () => {
  const read = createSidebarActivityReader();
  const saved = new Map<string, RuntimeSummary['status']>([['a', 'running'], ['b', 'interrupted']]);
  assert.deepEqual([...read([runtime('a', 'waiting'), runtime('a', 'idle')], saved, [])],
    [['a', 'waiting'], ['b', 'interrupted']]);
  assert.equal(read([], saved, []).get('a'), 'running');
});

const actions = { navigate() {}, context() {}, toggle() {}, moveSession() {}, moveWorkspace() {}, create() {}, openProject() {} };
const preferences: SidebarPreferences = { language: 'en', workspace: 'D:\\Project', workspaces: ['D:\\Project', 'D:\\Other'] };
function render(sessions: Session[], patch: Partial<Parameters<typeof SidebarTree>[0]> = {}) {
  const markup = renderToStaticMarkup(createElement(SidebarTree, {
    sessions, preferences, platform: 'win32', activities: new Map(), disclosure: new Map(), query: '', highlightQuery: '',
    available: true, loading: false, navigating: false, drag: null, actions, ...patch,
  }));
  return parseHTML(`<html><body>${markup}</body></html>`).document;
}
test('tree retains ordered, independent, archived and explicitly hidden session boundaries', () => {
  const sessions = [session('a'), session('b', { independent: true }), session('c', { cwd: 'D:\\Missing' }),
    session('hidden', { cwd: 'D:\\Missing', independent: false }), session('archived')];
  const document = render(sessions, { preferences: { ...preferences, archivedSessionIds: ['archived'], sessionOrder: ['c', 'b', 'a'] } });
  assert.deepEqual([...document.querySelectorAll('.session-row')].map(row => row.getAttribute('data-reorder-id')), ['c', 'b', 'a']);
  assert.equal(document.querySelectorAll('[data-reorder-kind="workspace"]').length, 2);
  assert.equal(document.querySelector('.workspace-heading.current .workspace-toggle')?.getAttribute('aria-label'), 'Project');
});
test('search keeps source previews, optional highlighting and forced-open groups', () => {
  const document = render([session('a'), session('b', { name: 'Other' })], {
    preferences: { ...preferences, collapsedWorkspaces: ['d:/project'] }, query: 'First a', highlightQuery: 'First a',
  });
  assert.equal(document.querySelectorAll('.session-row').length, 1);
  assert.ok(document.querySelector('.session-search-match'));
  assert.equal(document.querySelector('[data-reorder-id="d:/project"] .workspace-toggle')?.getAttribute('aria-expanded'), 'true');
  assert.equal(document.querySelector('.session-row button')?.hasAttribute('aria-keyshortcuts'), false);
  assert.equal(document.querySelector('.session-search-preview')?.textContent, 'First a');
});
test('optimistic disclosure overrides saved state without deleting mounted session rows', () => {
  const document = render([session('a')], {
    preferences: { ...preferences, collapsedWorkspaces: ['d:/project'] }, disclosure: new Map([['d:/project', { open: true }]]),
  });
  const group = document.querySelector('[data-reorder-id="d:/project"]')!;
  assert.equal(group.querySelector('.workspace-toggle')?.getAttribute('aria-expanded'), 'true');
  assert.equal(group.querySelector('.workspace-disclosure')?.hasAttribute('inert'), false);
  assert.equal(group.querySelectorAll('.session-row').length, 1);
});
test('loading navigation keeps selectable rows but disables their mutation menus', () => {
  const document = render([session('a')], { loading: true, navigating: true, selected: 'a', slow: 'a',
    activities: new Map([['a', 'waiting']]) });
  const row = document.querySelector('.session-row')!;
  assert.equal(row.querySelector('button')?.hasAttribute('disabled'), false);
  assert.equal(row.querySelector('button')?.getAttribute('aria-current'), 'page');
  assert.equal(row.querySelector('.icon-button')?.hasAttribute('disabled'), true);
  assert.equal(row.getAttribute('data-reorder-locked'), 'true');
  assert.ok(row.querySelector('.session-navigation-spinner'));
});
test('pinned groups, drop markers and language changes retain the original DOM vocabulary', () => {
  const document = render([session('a')], { preferences: { ...preferences, language: 'zh', pinnedWorkspaces: ['d:/project'] },
    drag: { id: 'a', target: 'd:/project', after: true, workspaceTarget: 'D:\\Other' } });
  assert.ok(document.querySelector('.pinned-projects [data-reorder-id="d:/project"].drop-after'));
  assert.ok(document.querySelector('[data-reorder-id="a"].session-dragging'));
  assert.ok(document.querySelector('[data-reorder-id="d:/other"].session-drop-target'));
  assert.equal(document.querySelector('nav')?.getAttribute('aria-label'), '工作区与会话');
});
