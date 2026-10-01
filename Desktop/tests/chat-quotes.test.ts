import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fencedSelection, quotePrompt, restoreQuotes, type ChatQuote } from '../src/chat-quotes';
import { composerAction } from '../src/composer-action';

const quote: ChatQuote = { id: 'q1', messageIndex: 1, role: 'assistant', text: 'One\nTwo',
  markdown: 'One\nTwo', startOffset: 0, endOffset: 7 };

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
