import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import Markdown from 'react-markdown';
import { ChartBar, Clock3, Command, BookOpen, Sparkles, ListTodo, Network } from 'lucide-react';
import { commandRanges, remarkCommandReferences } from '../src/command-references';
import { commandPresentation } from '../src/command-presentation';
import { desktopCommands } from '../src/composer-commands';

const commands = desktopCommands(['usage', 'cron', 'todos', 'workflows', 'plan', 'mcp']
  .map(name => ({ name, source: 'extension' })));

test('command decorations identify all occurrences after prose, newlines and Unicode', () => {
  const draft = 'a /clm  🧪 /usage\n/cron 和 /clm-compact 保留\n/todos， /workflows.';
  const ranges = commandRanges(draft, commands);
  assert.deepEqual(ranges.map(range => range.name), ['clm', 'usage', 'cron', 'clm-compact', 'todos', 'workflows']);
  for (const range of ranges) assert.equal(draft.slice(range.from, range.to), `/${range.name}`);
  assert.equal(draft.slice(0, ranges[0].from), 'a ');
  assert.deepEqual(commandRanges('/clm /clm', commands).map(range => range.from), [0, 5]);
  assert.deepEqual(commandRanges('试试 /clm，再看 /usage。', commands).map(range => range.name), ['clm', 'usage']);
  assert.deepEqual(commandRanges('/clm-other /clm/dir /usage2', commands), []);
  assert.deepEqual(commandRanges('/skill:check.v2?', [{ name: 'skill:check.v2', source: 'skill' }])
    .map(range => range.name), ['skill:check.v2']);
  assert.deepEqual(commandRanges('/skill:checkXv2', [{ name: 'skill:check.v2', source: 'skill' }]), []);
});

test('code, links, paths, unknown and incomplete commands stay ordinary text', () => {
  for (const draft of [
    '`/clm`', '```\n/clm\n```', 'https://example.com/clm', 'C:/clm', '/clm/file',
    '正文/clm', '/cl', '/unknown', '[/clm](https://example.com)', '<https://example.com/clm>',
    '\\/clm', '![image /clm](https://example.com/a.png)',
  ]) assert.deepEqual(commandRanges(draft, commands), [], draft);
});

test('the shared icons match their existing surfaces and retain skill/template provenance', () => {
  for (const [name, Icon] of [['usage', ChartBar], ['cron', Clock3], ['todos', ListTodo],
    ['workflows', Network], ['clm', Command], ['clm-compact', Command]] as const) {
    assert.equal(commandPresentation({ name, source: 'extension' }, true).Icon, Icon);
  }
  assert.equal(commandPresentation({ name: 'usage', source: 'skill' }, true).Icon, BookOpen);
  assert.equal(commandPresentation({ name: 'cron', source: 'prompt' }, true).Icon, Sparkles);
  assert.equal(commandPresentation({ name: 'usage', source: 'skill' }, true).title, 'usage');
  assert.equal(commandPresentation({ name: 'workflows' }, true).title, '工作流');
});

test('sent messages decorate commands inline without losing Markdown or decorating code and links', () => {
  const html = renderToStaticMarkup(createElement(Markdown, {
    children: 'a /clm **保留粗体**\n\n/usage /cron\n\n`/clm`\n\n[/todos](https://example.com)',
    remarkPlugins: [[remarkCommandReferences, commands]],
  }));
  assert.equal((html.match(/data-command="/g) ?? []).length, 3, html);
  assert.match(html, /<strong>保留粗体<\/strong>/);
  assert.match(html, /<code>\/clm<\/code>/);
  assert.match(html, /<a href="https:\/\/example.com">\/todos<\/a>/);
  assert.match(html, /a <span data-command="clm"/);
});
