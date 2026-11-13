import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const source = ts.createSourceFile('verify-session-import.mjs',
  await readFile(new URL('../scripts/verify-session-import.mjs', import.meta.url), 'utf8'),
  ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const body = source.statements.find(ts.isTryStatement)?.tryBlock.statements;
assert.ok(body);
const start = body.findIndex(statement => statement.getText(source).startsWith('const reimportJob ='));
assert.ok(start >= 0, 'Reimport completion must target the job with the reviewed skipped result');
const verify = new Function('page', 'assert',
  `return (async () => { ${body.slice(start, start + 3).map(statement => statement.getText(source)).join('\n')} })();`);

function fixture(wait: () => Promise<void>, expanded = 'false') {
  const events: string[] = [];
  const summary = {};
  const row = {
    locator(selector: string) {
      if (selector === '.import-job-trigger[aria-expanded="false"]') return {
        async waitFor(options: { timeout: number }) {
          assert.equal(options.timeout, 5000);
          events.push('wait');
          await wait();
        },
      };
      assert.equal(selector, '.import-job-trigger');
      return { async getAttribute(name: string) {
        assert.equal(name, 'aria-expanded');
        events.push('assert');
        return expanded;
      } };
    },
  };
  return { events, page: { locator(selector: string) {
    if (selector === '.import-job-summary') return {
      filter(options: { hasText: string }) { assert.equal(options.hasText, '\u8df3\u8fc7 1'); return summary; },
    };
    assert.equal(selector, '.import-job');
    return { filter(options: { has: unknown }) { assert.equal(options.has, summary); return row; } };
  } } };
}

test('a skipped result does not finish reimport acceptance before the same job collapses', async () => {
  let finish!: () => void;
  const settled = new Promise<void>(resolve => { finish = resolve; });
  const value = fixture(() => settled);
  const pending = verify(value.page, assert);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(value.events, ['wait']);
  finish();
  await pending;
  assert.deepEqual(value.events, ['wait', 'assert']);
});

test('a completion timeout is not retried or replaced with an arbitrary first job', async () => {
  const failure = new Error('The matching job never completed');
  const value = fixture(async () => { throw failure; });
  await assert.rejects(verify(value.page, assert), error => error === failure);
  assert.deepEqual(value.events, ['wait']);
});

test('the exact collapsed-state assertion is retained after the bounded wait', async () => {
  const value = fixture(async () => {}, 'true');
  await assert.rejects(verify(value.page, assert), error =>
    error instanceof assert.AssertionError && error.actual === 'true' && error.expected === 'false');
});
