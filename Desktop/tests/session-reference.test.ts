import test from 'node:test';
import assert from 'node:assert/strict';
import { sessionReference, sessionIdFromReference, sessionLinkRanges } from '../src/session-reference';

test('session references round-trip stable IDs without exposing filesystem paths', () => {
  const id = '01a0f626-0a65-78b1-b1ab-4ff5dd2e2de1';
  assert.equal(sessionReference(id), `stepcode-desktop://sessions/${id}`);
  assert.equal(sessionIdFromReference(`  ${sessionReference(id)}\n`), id);
  assert.equal(sessionIdFromReference(id), id);
});

test('session references reject other schemes, paths and unexpected URL components', () => {
  for (const value of [
    '', '../auth.json', 'D:\\sessions\\one.json', 'codex://threads/one',
    'https://sessions/one', 'stepcode-desktop://other/one',
    'stepcode-desktop://sessions/one?token=secret', 'stepcode-desktop://sessions/one#fragment',
    'stepcode-desktop://user@sessions/one', 'stepcode-desktop://sessions:123/one',
    'stepcode-desktop://sessions/one/two', 'stepcode-desktop://sessions/%6fne',
    'stepcode-desktop://sessions/a/../one', 'stepcode-desktop://sessions/', 'a'.repeat(101),
  ]) assert.throws(() => sessionIdFromReference(value), /Expected a session/);
  assert.throws(() => sessionReference('../one'), /Invalid session/);
});

test('inline references recognize canonical URLs next to prose, not malformed prefixes', () => {
  const ref = sessionReference('example-01');
  assert.deepEqual(sessionLinkRanges(`See (${ref}).`).map(({ href, from, to }) => ({ href, from, to })),
    [{ href: ref, from: 5, to: 5 + ref.length }]);
  assert.deepEqual(sessionLinkRanges(`${ref}/sub ${ref}?q=1 ${ref}#name https://${ref} ${ref}.html`), []);
});
