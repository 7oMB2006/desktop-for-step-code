import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import Markdown from 'react-markdown';
import { ChartBar, Clock3, Command, BookOpen, Sparkles, ListTodo, Network, Workflow, FolderCheck, Shield } from 'lucide-react';
import { CommandContextUsage, CompactContextIcon, OrganizeContextIcon, WorkingContextIcon } from '../src/ContextCommandIcon';
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
    ['skills', BookOpen],
    ['workflows', Workflow], ['ultracode', Network], ['trust', FolderCheck], ['permissions', Shield],
    ['compact', CompactContextIcon], ['clm', WorkingContextIcon], ['clm-compact', OrganizeContextIcon]] as const) {
    assert.equal(commandPresentation({ name, source: 'extension' }, true).Icon, Icon);
  }
  assert.equal(commandPresentation({ name: 'usage', source: 'skill' }, true).Icon, BookOpen);
  assert.equal(commandPresentation({ name: 'cron', source: 'prompt' }, true).Icon, Sparkles);
  assert.equal(commandPresentation({ name: 'usage', source: 'skill' }, true).title, 'usage');
  assert.equal(commandPresentation({ name: 'workflows' }, true).title, '工作流');
  assert.equal(commandPresentation({ name: 'skills', source: 'desktop' }, true).title, '技能');
  assert.equal(commandPresentation({ name: 'skills', source: 'desktop' }, false).title, 'Skills');
  assert.equal(commandPresentation({ name: 'compact', source: 'skill' }, true).Icon, BookOpen);
  assert.equal(commandPresentation({ name: 'clm', source: 'prompt' }, true).Icon, Sparkles);
  assert.equal(commandPresentation({ name: 'unknown' }, true).Icon, Command);
  assert.equal(commandPresentation({ name: 'ultraloop' }, true).Icon, Network);
});

test('context icons share live usage rings with small family badges', () => {
  for (const [name, badge] of [
    ['compact', 'o'], ['clm', 'l'], ['clm-compact', 'l'],
  ]) {
    const { Icon } = commandPresentation({ name }, true);
    const html = renderToStaticMarkup(createElement(CommandContextUsage.Provider,
      { value: { usage: { percent: 33, tokens: 84480, contextWindow: 256000 }, language: 'zh' } },
      createElement(Icon, { size: 16 })));
    assert.match(html, /class="context-command-icon /);
    assert.match(html, /aria-hidden="true"/);
    assert.match(html, /--context-percent:33%/);
    assert.ok(html.includes(`class="context-command-badge">${badge}</span>`), html);
    assert.match(html, /width:calc\(16px \+ 7px\)/);
    assert.doesNotMatch(html, /role="meter"|tabindex=/);
    const unknown = renderToStaticMarkup(createElement(Icon, { size: 16 }));
    assert.match(unknown, /context-ring is-unknown/);
  }
});

test('context descriptions explain family, operation and known or unknown live usage', () => {
  for (const [name, zh, en] of [
    ['compact', 'Compact · 压缩当前对话上下文', 'Compact · Compress conversation context'],
    ['clm', 'CLM · 查看工作上下文状态', 'CLM · Inspect working context'],
    ['clm-compact', 'CLM · 手动整理工作上下文', 'CLM · Organize working context'],
  ]) {
    const usage = { percent: 33, tokens: 84480, contextWindow: 256000 };
    assert.ok(commandPresentation({ name }, true, usage).detail.startsWith(zh));
    assert.ok(commandPresentation({ name }, false, usage).detail.startsWith(en));
    assert.match(commandPresentation({ name }, true, usage).detail, /当前上下文已用 33%/);
    assert.match(commandPresentation({ name }, false, usage).detail, /33% of current context used/);
    for (const percent of [null, NaN, Infinity]) {
      const detail = commandPresentation({ name }, true, { ...usage, percent }).detail;
      assert.match(detail, /用量未知/);
      assert.doesNotMatch(detail, /已用 0%/);
    }
    assert.equal(commandPresentation({ name, source: 'skill', description: 'Resource description' }, true, usage).detail, 'Resource description');
  }
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

test('sent command boundaries and escapes agree with the original Markdown source', () => {
  for (const source of [
    '[label](https://example.com)/clm', '**label**/clm', '\\/clm', '&#47;clm',
    'literal \\/clm then /usage', 'escaped \\* and &amp; /clm and /usage',
    'two \\/clm /clm', 'line\r\n/clm', '**bold /clm** then /usage',
  ]) {
    const html = renderToStaticMarkup(createElement(Markdown, {
      children: source, remarkPlugins: [[remarkCommandReferences, commands]],
    }));
    const marked = [...html.matchAll(/data-command="([^"]+)"/g)].map(match => match[1]);
    assert.deepEqual(marked, commandRanges(source, commands).map(range => range.name), source);
    for (const match of html.matchAll(/<span data-command="([^"]+)"[^>]*>([^<]*)<\/span>/g))
      assert.equal(match[2], `/${match[1]}`, source);
  }
});
