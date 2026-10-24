import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Preferences, Session } from '../src/contracts';
import { filterSessions } from '../src/session-search';

const preferences: Preferences = {
  theme: 'light', language: 'zh', workspaces: ['D:\\Projects\\App', 'D:\\Projects\\Other'],
  workspaceNames: { 'd:/projects/app': '阶跃应用' }, archivedSessionIds: ['archived'],
};
const sessions: Session[] = [
  { id: 'named', name: '修复登录', firstMessage: 'Investigate TOKEN refresh', cwd: 'D:\\Projects\\App', path: 'a', modified: '', messageCount: 2 },
  { id: 'untitled', firstMessage: '修复搜索功能', cwd: 'D:\\Projects\\Other', path: 'b', modified: '', messageCount: 1 },
  { id: 'independent', name: 'ＡＰＩ notes', firstMessage: '独立研究', cwd: 'D:\\Projects\\App', independent: true, path: 'c', modified: '', messageCount: 1 },
  { id: 'archived', name: '修复登录', firstMessage: 'TOKEN', cwd: 'D:\\Projects\\App', path: 'd', modified: '', messageCount: 1 },
];
const ids = (query: string) => filterSessions(sessions, preferences, query).map(session => session.id);

test('empty and whitespace queries retain catalog order but exclude archived sessions', () => {
  assert.deepEqual(ids(''), ['named', 'untitled', 'independent']);
  assert.deepEqual(ids(' \n　'), ids(''));
  assert.deepEqual(preferences.archivedSessionIds, ['archived']);
});
test('matches titles, first prompts and renamed project labels without case sensitivity', () => {
  assert.deepEqual(ids('登录'), ['named']);
  assert.deepEqual(ids('token'), ['named']);
  assert.deepEqual(ids('搜索'), ['untitled']);
  assert.deepEqual(ids('阶跃应用'), ['named']);
  assert.deepEqual(ids('独立会话'), ['independent']);
});
test('empty conversations match their displayed fallback title in either language', () => {
  const empty = { ...sessions[0], name: '', firstMessage: '' };
  assert.equal(filterSessions([empty], preferences, '新会话').length, 1);
  assert.equal(filterSessions([empty], { ...preferences, language: 'en' }, 'new session').length, 1);
  assert.equal(filterSessions([empty], preferences, 'TOKEN').length, 0);
});
test('multiple words can match separate fields and never use regex semantics', () => {
  assert.deepEqual(ids('  TOKEN   阶跃 '), ['named']);
  assert.deepEqual(ids('token missing'), []);
  assert.deepEqual(ids('.*'), []);
  assert.deepEqual(ids('['), []);
});
test('normalizes Windows slash styles and compatibility characters', () => {
  assert.deepEqual(ids('d:/projects/other'), ['untitled']);
  assert.deepEqual(ids('D:\\PROJECTS\\OTHER'), ['untitled']);
  assert.deepEqual(ids('API'), ['independent']);
});
test('workspace redirects and actual working directories are both searchable', () => {
  const redirected = { ...sessions[0], cwd: 'D:\\Old', workspacePath: 'D:\\Projects\\Other' };
  assert.equal(filterSessions([redirected], preferences, 'other').length, 1);
  assert.equal(filterSessions([redirected], preferences, 'D:/old').length, 1);
});
test('macOS project identity stays case sensitive and orphaned sessions remain searchable', () => {
  const prefs = { ...preferences, workspaces: ['/Work/App'], workspaceNames: { '/Work/App': 'Mac project' } };
  assert.equal(filterSessions([{ ...sessions[0], cwd: '/Work/App' }], prefs, 'Mac project', 'darwin').length, 1);
  assert.equal(filterSessions([{ ...sessions[0], cwd: '/work/app' }], prefs, '独立会话', 'darwin').length, 1);
});
test('large catalogs preserve object identity, order and source data', () => {
  const many = Array.from({ length: 10000 }, (_, index) => ({
    ...sessions[0], id: `session-${index}`, name: `Conversation ${index}`, firstMessage: `prompt-${index}`,
  }));
  const results = filterSessions(many, preferences, 'prompt-9999');
  assert.equal(results.length, 1);
  assert.equal(results[0], many[9999]);
  assert.equal(many.length, 10000);
  assert.equal(many[0].name, 'Conversation 0');
});
