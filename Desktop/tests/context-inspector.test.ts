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
