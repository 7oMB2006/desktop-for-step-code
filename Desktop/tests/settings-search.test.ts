import assert from 'node:assert/strict';
import test from 'node:test';
import { searchSettings, type SettingsCategory } from '../src/settings-search';

const categories: readonly SettingsCategory[] = [
  ['general', '通用', 'General'], ['appearance', '外观', 'Appearance'],
  ['mcp', 'MCP', 'MCP'], ['account', '账户', 'Account'],
];

test('finds settings across languages and ranks exact labels ahead of aliases', () => {
  assert.equal(searchSettings('声音', categories, 'zh')[0]?.anchor, 'completionSound');
  assert.equal(searchSettings('ＧＥＮＥＲＡＬ  SOUND', categories, 'zh')[0]?.label, '完成提示音');
  assert.equal(searchSettings('外观 字号', categories, 'zh')[0]?.anchor, 'typography');
  assert.equal(searchSettings('用量统计', categories, 'zh')[0]?.anchor, 'usage');
});

test('matches categories without dumping every setting under that category', () => {
  assert.deepEqual(searchSettings('general', categories, 'zh').map(({ anchor, category }) => [anchor, category]), [['', 'general']]);
  assert.deepEqual(searchSettings('MCP', categories, 'zh').map(({ category }) => category), ['mcp']);
});

test('blank and unknown searches return no results', () => {
  assert.deepEqual(searchSettings('  ', categories, 'zh'), []);
  assert.deepEqual(searchSettings('unmatched-search-term', categories, 'zh'), []);
});
