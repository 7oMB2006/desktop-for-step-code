import test from 'node:test';
import assert from 'node:assert/strict';
import { clmSnapshot } from '../electron/clm';

test('CLM projection retains entry identity, not revision-number identity, and removes private fields', () => {
  const result = clmSnapshot({ sessionId: 'session', enabled: false, path: 'private-path', total: 2,
    revisions: [{ entryId: 'a', revision: 4, kind: 'edit' }, { entryId: 'b', revision: 4, kind: 'compaction' }],
    selected: { entryId: 'a', blocks: [{ id: '1', role: 'assistant', text: 'safe\napiKey=secret\nsk-abcdefghijkl' }], diff: '- apiKey=private\n+ safe' },
    lastOutcome: { accepted: true, revision: 4, archivePath: 'private-path', beforeTokens: -3, afterTokens: 50 },
  }, 'session');
  assert.equal(result.revisions.length, 2);
  assert.equal(result.enabled, false);
  assert.equal(result.lastOutcome?.beforeTokens, undefined);
  assert.equal(result.lastOutcome?.afterTokens, 50);
  assert.equal(JSON.stringify(result).includes('private'), false);
  assert.equal(JSON.stringify(result).includes('secret'), false);
  assert.equal(JSON.stringify(result).includes('sk-abcdefghijkl'), false);
});

test('CLM rejects a different session and does not invent details for foreign entries', () => {
  assert.throws(() => clmSnapshot({ sessionId: 'other', enabled: true, revisions: [] }, 'session'));
  assert.throws(() => clmSnapshot({}, 'session'));
  const result = clmSnapshot({ sessionId: 'session', enabled: true, revisions: [],
    selected: { entryId: 'abandoned', blocks: [{ text: 'must not display' }] } }, 'session');
  assert.equal(result.selected, undefined);
  assert.equal(result.tokens, undefined);
});
