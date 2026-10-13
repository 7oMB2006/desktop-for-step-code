import assert from 'node:assert/strict';
import test from 'node:test';
import { clmNotice } from '../src/clm-notice';

const status = 'CLM revision 2; ~21089 context tokens.\nIndex: C:\\profile\\index.json\nMirror: C:\\profile\\LIVE_CONTEXT.md\nArchive: C:\\profile\\archive';

test('CLM status is concise and localized without internal paths', () => {
  assert.equal(clmNotice(status, 'zh'), '工作上下文 · 修订 2 · 约 21,089 tokens');
  assert.equal(clmNotice(status, 'en'), 'Working context · Revision 2 · ~21,089 tokens');
});

test('ordinary notifications and incomplete status remain literal', () => {
  for (const message of ['CLM failed', 'Other notification', 'CLM revision 2; ~21089 context tokens.', `${status}\nUnexpected detail`]) {
    assert.equal(clmNotice(message, 'zh'), message);
  }
});
