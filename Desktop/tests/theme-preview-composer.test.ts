import test from 'node:test';
import assert from 'node:assert/strict';
import { createThemePreviewComposer } from './fixtures/theme-pack-composer';
import { emptyComposer } from '../src/window-conversation';

test('offline preview synchronizes drafts without accepting stale writes', async () => {
  const { bridge } = createThemePreviewComposer(), owner = { sessionId: 'preview-one' };
  const initial = await bridge.composerRead(owner);
  initial.value.text = 'must not mutate the store';
  assert.deepEqual((await bridge.composerRead(owner)).value, emptyComposer());
  const write = await bridge.composerWrite({ owner, revision: 0, value: { text: 'offline message' } });
  assert.equal(write.accepted, true);
  const stale = await bridge.composerWrite({ owner, revision: 0, value: { text: 'stale edit' } });
  assert.equal(stale.accepted, false);
  assert.equal(stale.snapshot.value.text, 'offline message');
});

test('offline first send promotes its draft and consumes its receipt exactly once', async () => {
  const preview = createThemePreviewComposer(), owner = { draftId: 'preview-draft' };
  await preview.bridge.composerWrite({ owner, revision: 0, value: { text: 'first message' } });
  const { receipt, snapshot } = await preview.bridge.composerTake(owner, 1);
  assert.deepEqual(snapshot.value, emptyComposer());
  preview.promote(owner.draftId, 'preview-session');
  let submitted = 0;
  await preview.submit(receipt.token, { sessionId: 'preview-session' }, () => { submitted++; });
  await assert.rejects(preview.submit(receipt.token, { sessionId: 'preview-session' }, () => { submitted++; }), /expired/);
  assert.equal(submitted, 1);
  assert.deepEqual((await preview.bridge.composerRead(owner)).owner, { sessionId: 'preview-session' });
});

test('failed offline sends retain both the sent message and newer input', async () => {
  const preview = createThemePreviewComposer(), owner = { sessionId: 'preview-one' };
  await preview.bridge.composerWrite({ owner, revision: 0, value: { text: 'sent message' } });
  const { receipt, snapshot } = await preview.bridge.composerTake(owner, 1);
  await preview.bridge.composerWrite({ owner, revision: snapshot.revision, value: { text: 'newer draft' } });
  const failure = new Error('offline simulated failure');
  await assert.rejects(preview.submit(receipt.token, owner, () => { throw failure; }), error => error === failure);
  assert.equal((await preview.bridge.composerRead(owner)).value.text, 'sent message\nnewer draft');
  await assert.rejects(preview.bridge.composerRestore(receipt), /expired/);
});

test('offline receipts cannot send into a different session', async () => {
  const preview = createThemePreviewComposer(), owner = { sessionId: 'preview-one' };
  await preview.bridge.composerWrite({ owner, revision: 0, value: { text: 'private draft' } });
  await assert.rejects(preview.bridge.composerTake(owner, 0), /Composer changed/);
  const { receipt } = await preview.bridge.composerTake(owner, 1);
  await assert.rejects(preview.submit(receipt.token, { sessionId: 'preview-two' },
    () => assert.fail('must not submit')), /another conversation/);
  assert.equal((await preview.bridge.composerRead(owner)).value.text, 'private draft');
  assert.deepEqual((await preview.bridge.composerRead({ sessionId: 'preview-two' })).value, emptyComposer());
});

test('an in-flight offline receipt cannot be submitted twice or restored early', async () => {
  const preview = createThemePreviewComposer(), owner = { sessionId: 'preview-one' };
  await preview.bridge.composerWrite({ owner, revision: 0, value: { text: 'one send' } });
  const { receipt } = await preview.bridge.composerTake(owner, 1);
  let release!: () => void;
  const waiting = new Promise<void>(resolve => { release = resolve; });
  const submission = preview.submit(receipt.token, owner, () => waiting);
  try {
    await assert.rejects(preview.submit(receipt.token, owner, () => assert.fail('duplicate submission')), /expired/);
    await assert.rejects(preview.bridge.composerRestore(receipt), /expired/);
  } finally { release(); await submission; }
  assert.deepEqual((await preview.bridge.composerRead(owner)).value, emptyComposer());
});
