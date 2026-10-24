import test from 'node:test';
import assert from 'node:assert/strict';
import { createTwoFilesPatch } from 'diff';
import { clmChanges, clmTextTitle } from '../src/clm-diff';

test('CLM readable changes retain saved before/after fragments without structural headers', () => {
  const header = '[[CTX_TURN document=doc index=1 role=notes id=account protected=false]]';
  const before = `${header}\n# Account investigation\nOld response may overwrite the current account.\n`;
  const after = `${header}\n# Account investigation\nValidate identity on request and response.\n`;
  const changes = clmChanges(createTwoFilesPatch('LIVE_CONTEXT.md', 'LIVE_CONTEXT.md', before, after));
  assert.equal(changes.length, 1);
  assert.equal(changes[0].role, 'notes');
  assert.equal(changes[0].title, 'Account investigation');
  assert.match(changes[0].before, /Old response/);
  assert.match(changes[0].after, /Validate identity/);
  assert.doesNotMatch(changes[0].before + changes[0].after, /CTX_TURN/);
});

test('CLM fragments without a nearby header remain readable and do not invent an identity', () => {
  const same = Array.from({ length: 20 }, (_, i) => `line ${i}`).join('\n');
  const changes = clmChanges(createTwoFilesPatch('LIVE_CONTEXT.md', 'LIVE_CONTEXT.md', `${same}\nold\n`, `${same}\nnew\n`));
  assert.equal(changes.length, 1);
  assert.equal(changes[0].role, undefined);
  assert.ok(changes[0].beforeLine > 1, 'hunk is explicitly a fragment');
  assert.doesNotMatch(changes[0].before, /line 0\n/);
});

test('CLM handles additions, deletions, separate blocks and unavailable diffs', () => {
  const header = (id: string) => `[[CTX_TURN document=doc index=1 role=notes id=${id} protected=false]]`;
  const changes = clmChanges(createTwoFilesPatch('LIVE_CONTEXT.md', 'LIVE_CONTEXT.md',
    `${header('removed')}\nremoved note\n`, `${header('added')}\nadded note\n`));
  assert.equal(changes.length, 2);
  assert.equal(changes[0].after, '');
  assert.equal(changes[1].before, '');
  assert.deepEqual(clmChanges('not a diff'), []);
  assert.deepEqual(clmChanges('@@ -1,1 +1,1 @@\n-old\n+new\n'), [{
    id: '0:fragment-0', title: 'new', before: 'old', after: 'new', role: undefined, beforeLine: 1, afterLine: 1,
  }]);
  assert.equal(clmTextTitle('\n## Heading\nbody', 'fallback'), 'Heading');
});
