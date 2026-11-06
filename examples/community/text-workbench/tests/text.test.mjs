import assert from 'node:assert/strict';
import test from 'node:test';
import { analyzeText, DEFAULTS, optionsFrom, prepareList, validateText } from '../plugins/text-workbench/server/text.mjs';
import { createRouter } from '../plugins/text-workbench/server/protocol.mjs';

test('default cleanup preserves first occurrence, case and original list markers', () => {
  assert.equal(prepareList(' alpha \r\nbeta\r alpha\nAlpha\n- marked\n\n', DEFAULTS).text,
    '## \u6574\u7406\u7ed3\u679c\n\n- alpha\n- beta\n- Alpha\n- - marked');
});
test('every setting affects actual list output and truncation is explicit', () => {
  const result = prepareList('beta\nalpha\nbeta', {
    heading: '', style: 'numbered', max_items: 1, deduplicate: true, order: 'ascending',
  });
  assert.equal(result.text, '1. alpha\n\n\u53e6\u6709 1 \u6761\u672a\u5c55\u793a\uff08\u53d7\u6700\u591a\u8f93\u51fa\u6761\u6570\u9650\u5236\uff09\u3002');
  assert.deepEqual({ ...result, text: undefined }, { text: undefined, items: 1, removedDuplicates: 1, omitted: 1 });
  assert.equal(prepareList('a\nb\na', { ...DEFAULTS, heading: 'Todo', style: 'checklist', deduplicate: false, order: 'descending' }).text,
    '## Todo\n\n- [ ] b\n- [ ] a\n- [ ] a');
});
test('empty input and mixed line endings have documented counts', () => {
  assert.deepEqual(analyzeText(''), { unicodeCodePoints: 0, utf16CodeUnits: 0, lines: 0, nonEmptyLines: 0, uniqueLines: 0, repeatedLines: 0 });
  assert.deepEqual(analyzeText('a\r\na\rb\n'), { unicodeCodePoints: 7, utf16CodeUnits: 7, lines: 4, nonEmptyLines: 3, uniqueLines: 2, repeatedLines: 1 });
  assert.equal(prepareList(' \n\t', DEFAULTS).items, 0);
});
test('Unicode code points are not UTF-16 units or visual graphemes', () => {
  const result = analyzeText('\u{1f600}\ne\u0301');
  assert.equal(result.unicodeCodePoints, 4);
  assert.equal(result.utf16CodeUnits, 5);
  assert.equal(result.nonEmptyLines, 2);
});
test('rejects invalid input rather than silently dropping or truncating it', () => {
  for (const input of [{}, [], null, { text: 1 }, { text: 'a', path: 'x' }, { text: '\0' }, { text: 'a'.repeat(16001) }])
    assert.throws(() => validateText(input));
  assert.equal(validateText({ text: 'a'.repeat(16000) }).length, 16000);
});
test('rejects malformed saved options and noninteger limits', () => {
  for (const values of [null, [], { style: 'code' }, { order: 'random' }, { heading: 'a\nb' },
    { heading: 'a'.repeat(61) }, { max_items: 0 }, { max_items: 1.5 }, { deduplicate: 'true' }])
    assert.throws(() => optionsFrom(values));
});
test('MCP negotiation, listing, tool calls and notifications use real business logic', async () => {
  let reads = 0;
  const route = createRouter({ current: async () => { reads++; return { values: DEFAULTS }; } });
  const request = (method, params, id = 1) => route({ jsonrpc: '2.0', id, method, params });
  assert.equal((await request('tools/list')).error.code, -32000);
  assert.equal(await route({ jsonrpc: '2.0', method: 'notifications/initialized' }), undefined);
  assert.equal((await request('initialize', { protocolVersion: '2025-03-26' })).result.protocolVersion, '2025-03-26');
  assert.deepEqual((await request('tools/list')).result.tools.map(tool => tool.name), ['prepare_list', 'analyze_text']);
  assert.match((await request('tools/call', { name: 'prepare_list', arguments: { text: 'a\na' } })).result.content[0].text, /- a$/u);
  assert.equal(JSON.parse((await request('tools/call', { name: 'analyze_text', arguments: { text: 'a\na' } })).result.content[0].text).repeatedLines, 1);
  assert.equal(reads, 3);
  assert.equal((await request('initialize', { protocolVersion: '2025-03-26' })).error.code, -32602);
  assert.equal((await request('missing')).error.code, -32601);
  assert.equal((await request('tools/call', { name: 'missing', arguments: {} })).error.code, -32602);
  assert.equal((await request('tools/call', { name: 'prepare_list', arguments: { text: 1 } })).error.code, -32602);
});
test('configuration revocation or change yields a tool error without leaking payloads', async () => {
  let revoked = false;
  const route = createRouter({ current: async () => {
    if (revoked) throw new Error('private-path-and-secret-do-not-echo');
    return { values: DEFAULTS };
  } });
  await route({ jsonrpc: '2.0', id: 'init', method: 'initialize', params: { protocolVersion: '2025-03-26' } });
  revoked = true;
  const response = await route({ jsonrpc: '2.0', id: 0, method: 'tools/call', params: { name: 'analyze_text', arguments: { text: 'x' } } });
  assert.equal(response.result.isError, true);
  assert.doesNotMatch(JSON.stringify(response), /private-path-and-secret/);
});
test('invalid envelopes fail closed and unsupported versions negotiate explicitly', async () => {
  const route = createRouter({ current: async () => ({ values: DEFAULTS }) });
  for (const request of [null, [], 1, { id: 1, method: 'ping' }, { jsonrpc: '2.0', id: null, method: 'ping' }])
    assert.equal((await route(request)).error.code, -32600);
  const response = await route({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: 'unknown' } });
  assert.equal(response.result.protocolVersion, '2025-03-26');
});
