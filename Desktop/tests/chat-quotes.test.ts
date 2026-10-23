import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fencedSelection, quotePresentation, quotePrompt, restoreQuotes, sameQuoteSelection, type ChatQuote } from '../src/chat-quotes';
import { composerAction } from '../src/composer-action';

const quote: ChatQuote = { id: 'q1', messageIndex: 1, role: 'assistant', text: 'One\nTwo',
  markdown: 'One\nTwo', startOffset: 0, endOffset: 7 };

test('annotations merge only when their source coordinates match', () => {
  const note = { ...quote, annotation: 'first', blockIndex: 0 };
  assert.equal(sameQuoteSelection(note, { ...note, id: 'new', annotation: 'second' }), true);
  assert.equal(sameQuoteSelection(note, { ...note, startOffset: 10, endOffset: 17 }), false);
  assert.equal(sameQuoteSelection(note, { ...note, blockIndex: 1 }), false);
  assert.equal(sameQuoteSelection(note, { ...note, endOffset: 8 }), false);
  assert.equal(sameQuoteSelection(note, quote), false);
  assert.equal(sameQuoteSelection(quote, { ...quote, startOffset: 10, endOffset: 17 }), true);
});

test('plain drafts remain unchanged, including slash commands', () => {
  assert.equal(quotePrompt('/compact', [], 'zh'), '/compact');
});
test('quotes are reference text separated from the current user instruction', () => {
  const prompt = quotePrompt('Explain this', [quote], 'en');
  assert.match(prompt, /earlier assistant message:\n> One\n> Two/);
  assert.ok(prompt.endsWith('Current user message:\nExplain this'));
  assert.ok(!prompt.includes('startOffset'));
  assert.match(quotePrompt('解释一下', [quote], 'zh'), /用户本轮消息：\n解释一下$/);
});
test('quote-only prompts are sendable even while the agent is active', () => {
  assert.equal(composerAction(true, '', 1).mode, 'send');
  assert.match(quotePrompt('', [quote], 'en'), /> One/);
  assert.ok(!quotePrompt('', [quote], 'en').includes('Current user message:'));
});
test('code selection fences safely contain nested backticks', () => {
  assert.equal(fencedSelection('const a = 1;', 'ts'), '```ts\nconst a = 1;\n```');
  assert.equal(fencedSelection('```md\ntext\n```'), '````\n```md\ntext\n```\n````');
});
test('send failure restores quotes without losing newer context or duplicating ids', () => {
  const next = { ...quote, id: 'q2', text: 'new' };
  assert.deepEqual(restoreQuotes([quote], [next]), [quote, next]);
  assert.deepEqual(restoreQuotes([quote], [quote, next]), [quote, next]);
});

test('sent quote presentation restores both languages and exact reply whitespace', () => {
  for (const language of ['zh', 'en'] as const) {
    const quotes = [quote, { ...quote, role: 'user' as const, markdown: '> nested\n\n```ts\nconst x = 1;\n```\n' }];
    const draft = '\n  explain\n\nCurrent user message:\n引用 1，来自此前的助手消息：\n';
    const result = quotePresentation(quotePrompt(draft, quotes, language));
    assert.ok(result);
    assert.equal(result.draft, draft);
    assert.deepEqual(result.quotes.map(item => [item.role, item.markdown]),
      quotes.map(item => [item.role, item.markdown]));
    assert.equal(quotePresentation(quotePrompt('', quotes, language))?.draft, '');
  }
});

test('quote presentation preserves marker-like excerpt text and empty selections', () => {
  const markdown = '用户本轮消息：\n\n引用 2，来自此前的用户消息：\n> raw quote\n````\n```';
  assert.equal(quotePresentation(quotePrompt('reply', [{ ...quote, markdown }], 'zh'))?.quotes[0].markdown, markdown);
  assert.equal(quotePresentation(quotePrompt('', [{ ...quote, markdown: '' }], 'en'))?.quotes[0].markdown, '');
});

test('ordinary and malformed quote text remains ordinary Markdown', () => {
  const prompt = quotePrompt('reply', [quote], 'en');
  for (const text of ['hello\n> quote', '', prompt.replace('Quote 1,', 'Quote 2,'),
    prompt.replace('> One', 'One'), prompt.replace('reply', '   '),
    prompt.replace('\n\nCurrent user message:', '\nCurrent user message:')]) {
    assert.equal(quotePresentation(text), null);
  }
});

test('annotations round-trip independently for each quote, including delimiter-like text', () => {
  for (const language of ['zh', 'en'] as const) {
    const annotation = '请改成按原目录归组。\n\n| prefix\n用户本轮消息：\n> quote\nUser annotation on this quote:';
    const prompt = quotePrompt('一起调整', [quote, { ...quote, annotation }], language);
    const parsed = quotePresentation(prompt);
    assert.ok(parsed);
    assert.equal(parsed.quotes[0].annotation, undefined);
    assert.equal(parsed.quotes[1].annotation, annotation);
    assert.equal(parsed.quotes[1].markdown, quote.markdown);
    assert.equal(parsed.draft, '一起调整');
    assert.equal(quotePrompt(parsed.draft, parsed.quotes, language), prompt);
    assert.equal(quotePresentation(quotePrompt('', [{ ...quote, annotation }], language))?.draft, '');
    assert.equal(quotePresentation(prompt.replace('| 请改成按原目录归组。', 'broken')), null);
  }
});

test('annotations survive delivery failure and whitespace edits without changing legacy quotes', () => {
  const annotated = { ...quote, annotation: '  note\n ' };
  assert.equal(restoreQuotes([annotated], [])[0].annotation, annotated.annotation);
  assert.equal(quotePresentation(quotePrompt('', [annotated], 'en'))?.quotes[0].annotation, annotated.annotation);
  assert.equal(quotePrompt('', [{ ...quote, annotation: '' }], 'en'), quotePrompt('', [quote], 'en'));
});
