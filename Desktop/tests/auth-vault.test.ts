import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AuthVault } from '../electron/auth-vault';

// Plain node has no Electron safeStorage backend; a deterministic byte-wise
// stand-in keeps the ciphertext free of any readable credential text. These
// cases cover vault conflict and migration policy, while the real DPAPI round
// trip is exercised by scripts/verify-auth-vault.mjs.
const MASK = 0x5a;
const mask = (buffer: Buffer) => {
  const bytes = Buffer.from(buffer);
  for (let index = 0; index < bytes.length; index++) bytes[index] ^= MASK;
  return bytes;
};
const safeStorageMock = {
  isEncryptionAvailable: () => true,
  encryptString: (plain: string) => mask(Buffer.from(plain, 'utf8')),
  decryptString: (buffer: Buffer) => mask(buffer).toString('utf8'),
};
const vault = (root: string) => new AuthVault(root, safeStorageMock);

const marker = 'fixture-only-vault-key';
const credentials = { step: { type: 'oauth', access: marker, refresh: 'fixture', expires: Number.MAX_SAFE_INTEGER, profile: 'platform_cn' } };

test('dpapi credentials with an empty plaintext store keep the vault and drop the plaintext', async () => {
  const root = await mkdtemp(join(tmpdir(), 'auth-vault-empty-plain-'));
  await writeFile(join(root, 'auth.dpapi'), safeStorageMock.encryptString(JSON.stringify(credentials)));
  await writeFile(join(root, 'auth.json'), JSON.stringify({}));
  const data = await vault(root).load();
  assert.deepEqual(data, credentials);
  await assert.rejects(readFile(join(root, 'auth.json')), { code: 'ENOENT' }, 'the leftover plaintext must be removed');
  assert.equal((await readFile(join(root, 'auth.dpapi'))).toString('utf8').includes(marker), false, 'the vault stays encrypted');
});

test('dpapi credentials with different real plaintext credentials still fail closed', async () => {
  const root = await mkdtemp(join(tmpdir(), 'auth-vault-conflict-'));
  await writeFile(join(root, 'auth.dpapi'), safeStorageMock.encryptString(JSON.stringify(credentials)));
  await writeFile(join(root, 'auth.json'), JSON.stringify({ step: { type: 'oauth', access: 'fixture-only-other-key' } }));
  await assert.rejects(vault(root).load(), /Conflicting desktop credential files/);
});

test('plaintext credentials without a vault migrate into the vault and drop the plaintext', async () => {
  const root = await mkdtemp(join(tmpdir(), 'auth-vault-migrate-'));
  await writeFile(join(root, 'auth.json'), JSON.stringify(credentials));
  const data = await vault(root).load();
  assert.deepEqual(data, credentials);
  await assert.rejects(readFile(join(root, 'auth.json')), { code: 'ENOENT' }, 'the plaintext is removed after migration');
  const stored = safeStorageMock.decryptString(await readFile(join(root, 'auth.dpapi')));
  assert.deepEqual(JSON.parse(stored), credentials, 'the vault holds the same credentials');
});

test('no vault and no plaintext returns an empty store', async () => {
  const root = await mkdtemp(join(tmpdir(), 'auth-vault-empty-'));
  assert.deepEqual(await vault(root).load(), {});
});

test('a whitespace-only plaintext file counts as an empty store', async () => {
  const root = await mkdtemp(join(tmpdir(), 'auth-vault-blank-'));
  await writeFile(join(root, 'auth.dpapi'), safeStorageMock.encryptString(JSON.stringify(credentials)));
  await writeFile(join(root, 'auth.json'), '\n  \n');
  const data = await vault(root).load();
  assert.deepEqual(data, credentials);
  await assert.rejects(readFile(join(root, 'auth.json')), { code: 'ENOENT' }, 'the blank plaintext is removed');
});
