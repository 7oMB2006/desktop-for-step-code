import assert from 'node:assert/strict';
import { test } from 'node:test';
import { contextCapacityColors, contextMessageCounts, contextMessageJson, contextMessagePreview, finiteAmount } from '../src/context-inspector';
import type { Message } from '../src/contracts';

test('capacity colors use a fixed bounded scale with neutral unknown and zero', () => {
  for (const value of [null, undefined, NaN, -1, 0]) assert.equal(contextCapacityColors(value), undefined);
  assert.ok(contextCapacityColors(7.1)!.light.includes('158'));
  assert.ok(contextCapacityColors(50)!.light.includes('0.0000'));
  assert.ok(contextCapacityColors(80)!.light.includes('0.1000 25'));
  assert.ok(contextCapacityColors(100)!.light.includes('0.2000 25'));
  assert.deepEqual(contextCapacityColors(120), contextCapacityColors(100));
});
test('context user counts include only visible Goal inputs and ordinary users', () => {
  assert.deepEqual(contextMessageCounts([
    { role: 'custom', customType: 'desktop-goal-input', content: 'Goal' },
    { role: 'custom', customType: 'desktop-goal-input', display: false, content: 'Hidden input' },
    { role: 'custom', customType: 'step-goal', display: false, content: 'Continue' },
    { role: 'custom', customType: 'other', content: 'Other custom message' },
    { role: 'user', content: 'Next' },
  ]), { all: 5, user: 2, assistant: 0, toolResult: 0 });
});

test('context message categories count roles, not tool calls or token shares', () => {
  const messages: Message[] = [
    { role: 'user', content: 'question' },
    { role: 'assistant', content: [{ type: 'toolCall', name: 'read_file' }, { type: 'toolCall', name: 'search' }] },
    { role: 'toolResult', content: 'result' },
    { role: 'compactionSummary', content: 'summary' },
  ];
  assert.deepEqual(contextMessageCounts(messages), { all: 4, user: 1, assistant: 1, toolResult: 1 });
  assert.equal(contextMessagePreview(messages[1]), 'read_file');
  assert.equal(contextMessagePreview({ role: 'assistant', content: [{ type: 'thinking', thinking: 'a\nb' }] }), 'a b');
  const summary = { role: 'compactionSummary', summary: 'retained summary' } as Message;
  assert.equal(contextMessagePreview(summary), 'retained summary');
  assert.equal(JSON.parse(contextMessageJson(summary)).summary, 'retained summary');
  assert.equal(finiteAmount(null), undefined);
  assert.equal(finiteAmount(NaN), undefined);
  assert.equal(finiteAmount(-1), undefined);
  assert.equal(finiteAmount(0), 0);
});

test('message previews normalize whitespace before applying their display limit', () => {
  const text = ` first${'\t\n\r '.repeat(80)}second\u00a0\u2003\u2028\u2029\ufeffthird `;
  assert.equal(contextMessagePreview({ role: 'toolResult', content: text }), text.replace(/\s+/g, ' ').slice(0, 160));
  assert.equal(contextMessagePreview({ role: 'toolResult', content: `a${' '.repeat(200)}${'b'.repeat(200)}` }),
    `a ${'b'.repeat(158)}`);
});

test('message previews bound long tool output and pathological whitespace scans', () => {
  const output = `tool output ${'x'.repeat(2_000_000)}`;
  assert.equal(contextMessagePreview({ role: 'toolResult', content: output }), output.slice(0, 160));
  assert.equal(contextMessagePreview({ role: 'toolResult', content: `${' '.repeat(2_000_000)}not scanned` }), ' ...');
  assert.equal(contextMessagePreview({ role: 'toolResult', content: `prefix${' '.repeat(8192)}not scanned` }), 'prefix ...');
  assert.equal(contextMessagePreview({ role: 'toolResult', content: `${' '.repeat(8191)}x` }), ' x');
  assert.equal(contextMessagePreview({ role: 'toolResult', content: `${' '.repeat(8192)}x` }), ' ...');
});

test('message previews keep surrogate pairs intact at display and scan boundaries', () => {
  const emoji = '\ud83d\ude80';
  assert.equal(contextMessagePreview({ role: 'assistant', content: `${'x'.repeat(158)}${emoji}tail` }), `${'x'.repeat(158)}${emoji}`);
  assert.equal(contextMessagePreview({ role: 'assistant', content: `${'x'.repeat(159)}${emoji}tail` }), 'x'.repeat(159));
  assert.equal(contextMessagePreview({ role: 'assistant', content: `${' '.repeat(8191)}${emoji}` }), ' ...');
  assert.equal(contextMessagePreview({ role: 'assistant', content: `${'x'.repeat(155)}${emoji}${' '.repeat(8192)}` }),
    `${'x'.repeat(155)}${emoji}...`);
  assert.equal(contextMessagePreview({ role: 'assistant', content: `${'x'.repeat(156)}${emoji}${' '.repeat(8192)}` }),
    `${'x'.repeat(156)}...`);
});

test('message previews preserve source priority and role fallbacks', () => {
  assert.equal(contextMessagePreview({ role: 'assistant', content: [
    { type: 'toolCall', name: 'tool fallback' }, { type: 'thinking', thinking: 'thought fallback' }, { type: 'text', text: 'text first' },
  ] }), 'text first');
  assert.equal(contextMessagePreview({ role: 'assistant', content: [] }), 'assistant');
  assert.equal(contextMessagePreview({ role: 'toolResult', content: [], toolName: 'read_file' }), 'read_file');
  assert.equal(contextMessagePreview({ role: 'bashExecution', content: [], command: 'pwd' }), 'pwd');
  assert.equal(contextMessagePreview({ role: 'compactionSummary', content: [], summary: 'retained summary' }), 'retained summary');
  assert.equal(contextMessagePreview({ role: 'assistant', content: '' }), '');
});

test('message JSON omits image bytes, named secrets and unapproved message fields', () => {
  const message = {
    role: 'assistant', provider: 'fixture', model: 'test-model', timestamp: 1,
    content: [{ type: 'toolCall', name: 'test', arguments: { api_key: 'private-key', password: 'private-password', safe: 'visible', env: { SECRET: 'value' } } },
      { type: 'image', data: 'base64-secret', mimeType: 'image/png' }],
    authorization: 'private-auth', usage: { input: 2, output: 3, cacheRead: 0, cacheWrite: 0 },
  };
  const json = contextMessageJson(message);
  assert.ok(!json.includes('private') && !json.includes('base64-secret'));
  const parsed = JSON.parse(json);
  assert.equal(parsed.content[0].arguments.safe, 'visible');
  assert.equal(parsed.content[0].arguments.api_key, '[omitted]');
  assert.equal(parsed.content[1].data, '[omitted]');
  assert.equal(parsed.usage.input, 2);
  assert.equal(parsed.provider, 'fixture');
});

test('inspector bounds nesting and displayed payloads', () => {
  const json = contextMessageJson({ role: 'toolResult', content: Array.from({ length: 400 }, () => ({ type: 'text', text: 'x'.repeat(7000) })) });
  assert.ok(json.length < 24100);
  assert.ok(json.includes('[display limit]'));
});
