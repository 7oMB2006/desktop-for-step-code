import test from 'node:test';
import assert from 'node:assert/strict';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { RemoteStore, savedRemote, type SavedRemote } from '../electron/remote-store';

const saved: SavedRemote = { version: 1, identity: { botId: 'bot',
  credentials: { appId: 'PRIVATE-APP', appSecret: 'PRIVATE-SECRET', brand: 'feishu' } },
  access: { actor: 'human', chat: 'chat', workspaces: ['project-a'], sessionId: 'session-a' } };
function storage() {
  const key = randomBytes(32);
  return {
    isEncryptionAvailable: () => true,
    encryptString: (text: string) => {
      const iv = randomBytes(16), cipher = createCipheriv('aes-256-cbc', key, iv);
      return Buffer.concat([iv, cipher.update(text, 'utf8'), cipher.final()]);
    },
    decryptString: (value: Buffer) => {
      const cipher = createDecipheriv('aes-256-cbc', key, value.subarray(0, 16));
      return Buffer.concat([cipher.update(value.subarray(16)), cipher.final()]).toString('utf8');
    },
  };
}
async function fixture(t: { after: (fn: () => Promise<void>) => void }) {
  const root = await mkdtemp(join(tmpdir(), 'remote-store-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return { root, backend: storage() };
}
test('Remote store encrypts a narrow snapshot separately from account credentials', async t => {
  const { root, backend } = await fixture(t), store = new RemoteStore(root, backend);
  assert.equal(await store.load(), undefined);
  await store.save({ ...saved, token: 'DO-NOT-SAVE', queue: ['DO-NOT-SAVE'] } as SavedRemote);
  const encrypted = await readFile(join(root, 'connection.dpapi'));
  assert.doesNotMatch(encrypted.toString('utf8'), /PRIVATE-|human|session-a|project-a/);
  assert.deepEqual(await new RemoteStore(root, backend).load(), saved);
  assert.doesNotMatch(backend.decryptString(encrypted), /DO-NOT-SAVE/);
  assert.deepEqual(await readdir(root), ['connection.dpapi']);
});
test('Remote store refuses unavailable encryption and corrupt ciphertext without plaintext fallback', async t => {
  const { root, backend } = await fixture(t);
  const store = new RemoteStore(root, { ...backend, isEncryptionAvailable: () => false });
  await assert.rejects(store.save(saved), /protection/);
  assert.deepEqual(await readdir(root), []);
  await writeFile(join(root, 'connection.dpapi'), 'broken');
  await assert.rejects(new RemoteStore(root, backend).load(), /unlock/);
  assert.equal(await readFile(join(root, 'connection.dpapi'), 'utf8'), 'broken');
  await store.save(undefined);
  assert.deepEqual(await readdir(root), [], 'Forgetting does not require a working encryption backend');
});
test('Remote store serializes writes and revocation is the last durable operation', async t => {
  const { root, backend } = await fixture(t), store = new RemoteStore(root, backend);
  await Promise.all([store.save(saved), store.save({ ...saved, access: undefined }), store.save(undefined)]);
  assert.equal(await store.load(), undefined);
  assert.deepEqual(await readdir(root), []);
});
test('saved Remote schema rejects malformed scope and strips transient capabilities', () => {
  for (const value of [null, { ...saved, version: 2 }, { ...saved, identity: { ...saved.identity, botId: '' } },
    { ...saved, access: { ...saved.access, workspaces: [] } },
    { ...saved, access: { ...saved.access, workspaces: ['same', 'same'] } }])
    assert.throws(() => savedRemote(value));
  assert.deepEqual(savedRemote({ ...saved, approval: 'old', access: { ...saved.access, runId: 'old' } }), saved);
});
