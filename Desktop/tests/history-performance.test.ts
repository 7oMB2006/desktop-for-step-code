import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { test } from 'node:test';
import { JsonLines } from '../electron/runtime';

test('large history is decoded linearly across small stdout chunks', () => {
  const record = { text: 'x'.repeat(56 * 1024 * 1024) };
  const bytes = Buffer.from(JSON.stringify(record) + '\n');
  let received: unknown;
  const decoder = new JsonLines(value => { received = value; }, 64 * 1024 * 1024);
  const started = performance.now();
  for (let offset = 0; offset < bytes.length; offset += 8192)
    decoder.push(bytes.subarray(offset, offset + 8192));
  const elapsed = performance.now() - started;
  assert.equal((received as typeof record).text.length, record.text.length);
  assert.ok(elapsed < 3000, `56 MiB frame took ${elapsed.toFixed(0)}ms`);
});

test('frame limits are per record and split UTF-8 remains intact', () => {
  const values: unknown[] = [];
  const decoder = new JsonLines(value => values.push(value), 16);
  const bytes = Buffer.from('{"a":"中"}\n{"b":"文"}\n');
  for (const byte of bytes) decoder.push(Buffer.from([byte]));
  assert.deepEqual(values, [{ a: '中' }, { b: '文' }]);
  const combined: unknown[] = [];
  new JsonLines(value => combined.push(value), 8).push(Buffer.from('{"a":1}\n{"b":2}\n'));
  assert.equal(combined.length, 2);
  assert.throws(() => new JsonLines(() => {}, 8).push(Buffer.from('123456789')), /exceeds/);
  assert.throws(() => new JsonLines(() => {}, 8).push(Buffer.from('123456789\n')), /exceeds/);
});
