import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ComposerStore, parseComposerOwner } from '../electron/composer-store';
import { WindowComposerClient } from '../src/use-window-composer';
import { emptyComposer, type ComposerSnapshot, type ComposerValue } from '../src/window-conversation';
import type { DesktopBridge } from '../src/contracts';
import { parseWindowPresentation } from '../electron/window-presentation';

const owner = { sessionId: 'one' };
const value = (text: string): ComposerValue => ({ ...emptyComposer(), text });
function fixture() {
  const clients: WindowComposerClient[] = [];
  const store = new ComposerStore(snapshot => clients.forEach(client => client.accept(snapshot)));
  const bridge = {
    composerRead: async target => store.read(target),
    composerWrite: async input => store.write(input),
    composerTake: async (target, revision) => store.take(target, revision),
    composerRestore: async receipt => store.restore(receipt),
  } as DesktopBridge;
  const client = () => {
    const instance = new WindowComposerClient(bridge, () => {}, () => {});
    clients.push(instance); instance.select(owner); return instance;
  };
  return { clients, store, bridge, client };
}
test('store CAS rejects stale writes and consumes the input exactly once', () => {
  const store = new ComposerStore(() => {});
  assert.equal(store.write({ owner, revision: 0, value: value('original') }).accepted, true);
  assert.equal(store.write({ owner, revision: 0, value: value('obsolete') }).accepted, false);
  const sent = store.take(owner, 1);
  assert.equal(sent.receipt.value.text, 'original');
  assert.throws(() => store.take(owner, 1), /changed/);
  assert.throws(() => store.take(owner, 2), /already/);
  store.write({ owner, revision: 2, value: value('newer') });
  const restored = store.restore(sent.receipt);
  assert.equal(restored.value.text, 'original\nnewer');
  assert.throws(() => store.restore(sent.receipt), /expired/);
});
test('draft promotion preserves input and an in-flight restoration receipt', () => {
  const store = new ComposerStore(() => {});
  store.write({ owner: { draftId: 'd' }, revision: 0, value: value('first') });
  const sent = store.take({ draftId: 'd' }, 1);
  store.promote('d', 'one');
  assert.deepEqual(store.read({ draftId: 'd' }).owner, { sessionId: 'one' });
  assert.equal(store.restore(sent.receipt).value.text, 'first');
});
test('settled receipts cannot restore already accepted messages', () => {
  const store = new ComposerStore(() => {});
  store.write({ owner, revision: 0, value: value('sent') });
  const { receipt } = store.take(owner, 1);
  store.settle(receipt.token);
  assert.throws(() => store.restore(receipt), /expired/);
});
test('main owns submission recovery even if the submitting renderer reloads', async () => {
  const store = new ComposerStore(() => {});
  store.write({ owner, revision: 0, value: value('sent') });
  const { receipt } = store.take(owner, 1);
  let reject!: (error: Error) => void;
  const submitting = store.submit(receipt.token, owner, () => new Promise<void>((_, fail) => { reject = fail; }));
  await assert.rejects(store.submit(receipt.token, owner, async () => {}), /expired/);
  assert.throws(() => store.restore(receipt), /expired/);
  store.write({ owner, revision: 2, value: value('typed in another window') });
  reject(new Error('Runtime disconnected'));
  await assert.rejects(submitting, /disconnected/);
  assert.equal(store.read(owner).value.text, 'sent\ntyped in another window');
  assert.throws(() => store.restore(receipt), /expired/);
});
test('an abandoned take restores unsent input and newer shared edits after draft promotion', () => {
  const store = new ComposerStore(() => {});
  const draft = { draftId: 'abandoned' };
  store.write({ owner: draft, revision: 0, value: value('never submitted') });
  const { receipt } = store.take(draft, 1, 10);
  store.promote(draft.draftId, 'created');
  const owner = { sessionId: 'created' };
  store.write({ owner, revision: store.read(owner).revision, value: value('newer input') });
  store.recover(20);
  assert.equal(store.read(owner).value.text, 'newer input', 'Another renderer cannot abandon this take');
  store.recover(10);
  assert.equal(store.read(owner).value.text, 'never submitted\nnewer input');
  store.recover(10);
  assert.equal(store.read(owner).value.text, 'never submitted\nnewer input', 'Repeated unload does not duplicate recovery');
  assert.throws(() => store.restore(receipt), /expired/);
});
test('renderer loss never restores or duplicates an already submitted input', async () => {
  const store = new ComposerStore(() => {});
  store.write({ owner, revision: 0, value: value('in flight') });
  const { receipt } = store.take(owner, 1, 10);
  let finish!: () => void;
  const submitted = store.submit(receipt.token, owner, () => new Promise<void>(resolve => { finish = resolve; }));
  store.recover(10);
  assert.equal(store.read(owner).value.text, '');
  finish(); await submitted;
  store.recover(10);
  assert.equal(store.read(owner).value.text, '');
  assert.throws(() => store.restore(receipt), /expired/);
});
test('successful submission settles once and cannot cross conversation ownership', async () => {
  const store = new ComposerStore(() => {});
  store.write({ owner, revision: 0, value: value('sent') });
  const { receipt } = store.take(owner, 1);
  let calls = 0;
  await assert.rejects(store.submit(receipt.token, { sessionId: 'two' }, async () => { calls++; }), /different conversation/);
  assert.equal(calls, 0);
  assert.equal(store.read(owner).value.text, 'sent');
  const retry = store.take(owner, store.read(owner).revision).receipt;
  assert.equal(await store.submit(retry.token, owner, async () => { calls++; return 'accepted'; }), 'accepted');
  assert.equal(calls, 1);
  await assert.rejects(store.submit(retry.token, owner, async () => { calls++; }), /expired/);
  assert.equal(calls, 1);
});
test('reject malformed owners, quotes, sources, revisions and presentation payloads', () => {
  assert.throws(() => parseComposerOwner({ sessionId: 'one', draftId: 'two' }));
  const store = new ComposerStore(() => {});
  assert.equal(store.write({ owner, revision: NaN, value: value('') }).accepted, false);
  assert.throws(() => store.write({ owner, revision: 0, value: { ...value(''), quotes: [{} as never] } }));
  assert.throws(() => parseWindowPresentation({ position: { follow: true, top: Infinity }, disclosures: [] }));
  assert.deepEqual(parseWindowPresentation({ position: { follow: false, top: 20 }, disclosures: [['x', { revision: 'v', expanded: true }]] }),
    { position: { follow: false, top: 20 }, disclosures: [['x', { revision: 'v', expanded: true }]] });
});
test('two clean clients share edits and do not mistake their own event echo for a conflict', async () => {
  const { client } = fixture();
  const a = client(), b = client();
  await Promise.all([a.flush(), b.flush()]);
  a.update(owner, () => value('from main')); await a.flush();
  assert.equal(b.active!.value.text, 'from main');
  b.update(owner, () => value('from mini')); await b.flush();
  assert.equal(a.active!.value.text, 'from mini');
  assert.equal(a.active!.conflict || b.active!.conflict, false);
});
test('early typing survives an initial empty snapshot', async () => {
  const { client, store } = fixture();
  const a = client();
  a.update(owner, () => value('typed before read'));
  await a.flush();
  assert.equal(store.read(owner).value.text, 'typed before read');
});
test('true simultaneous edits retain the losing local draft until an explicit decision', async () => {
  const { client, bridge, store } = fixture();
  const a = client(), b = client();
  await Promise.all([a.flush(), b.flush()]);
  const pending: (() => void)[] = [];
  bridge.composerWrite = input => new Promise(resolve => pending.push(() => resolve(store.write(input))));
  a.update(owner, () => value('A')); b.update(owner, () => value('B'));
  await new Promise(resolve => setImmediate(resolve));
  pending[0](); pending[1]();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(a.active!.conflict, false);
  assert.equal(b.active!.conflict, true);
  assert.equal(b.active!.value.text, 'B');
  await b.resolveConflict(false);
  assert.equal(b.active!.value.text, 'A');
});
test('a late write response never replaces a newer remote snapshot', async () => {
  const { client, store, bridge } = fixture();
  const a = client(); await a.flush();
  let finish!: () => void;
  bridge.composerWrite = async input => {
    const result = store.write(input);
    await new Promise<void>(resolve => { finish = resolve; });
    return result;
  };
  a.update(owner, () => value('A'));
  await new Promise(resolve => setImmediate(resolve));
  store.write({ owner, revision: 1, value: value('B') });
  finish(); await a.flush();
  assert.equal(a.active!.confirmed!.revision, 2);
  assert.equal(a.active!.value.text, 'B');
});
test('two remote revisions cannot overwrite a pending local write that loses CAS', async () => {
  const { client, store, bridge } = fixture();
  const a = client(); await a.flush();
  const original = bridge.composerWrite;
  let finish!: () => void;
  bridge.composerWrite = input => new Promise(resolve => { finish = () => resolve(store.write(input)); });
  a.update(owner, () => value('keep my unsynchronized input'));
  await new Promise(resolve => setImmediate(resolve));
  store.write({ owner, revision: 0, value: value('remote first') });
  store.write({ owner, revision: 1, value: value('remote second') });
  assert.equal(a.active!.value.text, 'keep my unsynchronized input');
  assert.equal(a.active!.conflict, true);
  finish();
  await assert.rejects(a.flush(), /COMPOSER_CONFLICT/);
  assert.equal(a.active!.value.text, 'keep my unsynchronized input');
  bridge.composerWrite = original;
  await a.resolveConflict(true);
  assert.equal(store.read(owner).value.text, 'keep my unsynchronized input');
});
test('typing while take awaits is not cleared and failure recovery keeps both inputs', async () => {
  const { client, store, bridge } = fixture();
  const a = client(); await a.flush();
  a.update(owner, () => value('sent')); await a.flush();
  let finish!: () => void;
  bridge.composerTake = async (target, revision) => {
    const result = store.take(target, revision);
    await new Promise<void>(resolve => { finish = resolve; });
    return result;
  };
  const taking = a.take(value('sent'));
  await new Promise(resolve => setImmediate(resolve));
  a.update(owner, () => value('next'));
  finish();
  const receipt = await taking;
  await a.flush();
  assert.equal(a.active!.value.text, 'next');
  await a.restore(receipt!);
  assert.equal(a.active!.value.text, 'sent\nnext');
});
test('late event revisions are ignored', async () => {
  const { client, store } = fixture();
  const a = client(); await a.flush();
  a.update(owner, () => value('new')); await a.flush();
  a.accept({ owner, revision: 0, value: value('old') } satisfies ComposerSnapshot);
  assert.equal(a.active!.value.text, store.read(owner).value.text);
});
test('text-only synchronization omits unchanged image payloads in writes and broadcasts', async () => {
  const { client, bridge } = fixture();
  const a = client(), b = client(); await Promise.all([a.flush(), b.flush()]);
  const attachment = { kind: 'image' as const, name: 'screenshot.png',
    content: { type: 'image', mimeType: 'image/png', data: 'A'.repeat(1000000) } };
  a.update(owner, previous => ({ ...previous, attachments: [attachment] })); await a.flush();
  assert.equal(b.active!.value.attachments.length, 1);
  let bytes = 0;
  const write = bridge.composerWrite;
  bridge.composerWrite = async input => {
    bytes += JSON.stringify(input).length;
    const result = await write(input);
    bytes += JSON.stringify(result).length;
    return result;
  };
  a.update(owner, previous => ({ ...previous, text: 'Caption' })); await a.flush();
  assert.ok(bytes < 1000);
  assert.equal(b.active!.value.attachments[0].name, 'screenshot.png');
  assert.equal(b.active!.value.text, 'Caption');
});
test('a missed delta resynchronizes from main instead of applying it to an obsolete baseline', async () => {
  const { client, clients, store } = fixture();
  const a = client(); await a.flush();
  clients.length = 0;
  store.write({ owner, revision: 0, value: value('missed first edit') });
  store.write({ owner, revision: 1, value: value('missed second edit') });
  clients.push(a);
  store.write({ owner, revision: 2, value: { text: 'latest edit' } });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(a.active!.value.text, store.read(owner).value.text);
  assert.equal(a.active!.confirmed!.revision, 3);
});
