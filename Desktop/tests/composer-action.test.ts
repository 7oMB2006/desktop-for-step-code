import assert from 'node:assert/strict';
import { test } from 'node:test';
import { composerAction } from '../src/composer-action';

test('idle uses send, with text or attachments required for content', () => {
  assert.deepEqual(composerAction(false, '', 0), { mode: 'send', hasContent: false });
  assert.deepEqual(composerAction(false, 'hello', 0), { mode: 'send', hasContent: true });
  assert.deepEqual(composerAction(false, '', 1), { mode: 'send', hasContent: true });
});

test('running switches stop to send for queued content and back on clear', () => {
  assert.deepEqual(composerAction(true, '', 0), { mode: 'stop', hasContent: false });
  assert.equal(composerAction(true, 'next', 0).mode, 'send');
  assert.equal(composerAction(true, '', 1).mode, 'send');
  assert.equal(composerAction(true, ' \n ', 0).mode, 'stop');
});
