import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, stat, rm } from 'node:fs/promises';
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
  getSelectedStorageBackend: () => 'gnome_libsecret' as const,
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

test('equivalent credentials with reordered keys preserve the vault and remove redundant plaintext', async () => {
  const root = await mkdtemp(join(tmpdir(), 'auth-vault-reordered-'));
  const encrypted = safeStorageMock.encryptString(JSON.stringify(credentials));
  await writeFile(join(root, 'auth.dpapi'), encrypted);
  await writeFile(join(root, 'auth.json'), JSON.stringify({
    step: { profile: 'platform_cn', expires: Number.MAX_SAFE_INTEGER, refresh: 'fixture', access: marker, type: 'oauth' },
  }));
  assert.deepEqual(await vault(root).load(), credentials);
  assert.deepEqual(await readFile(join(root, 'auth.dpapi')), encrypted, 'the encrypted vault must not be rewritten');
  await assert.rejects(readFile(join(root, 'auth.json')), { code: 'ENOENT' });
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

test('Linux accepts only available OS keyring backends and writes owner-only ciphertext', async () => {
  for (const backend of ['gnome_libsecret', 'kwallet', 'kwallet5', 'kwallet6'] as const) {
    const root = await mkdtemp(join(tmpdir(), 'auth-vault-linux-'));
    try {
      const storage = { ...safeStorageMock, getSelectedStorageBackend: () => backend };
      const vault = new AuthVault(root, storage, 'linux');
      await vault.save(credentials);
      assert.deepEqual(await vault.load(), credentials);
      const encrypted = await readFile(join(root, 'auth.dpapi'));
      assert.equal(encrypted.includes(Buffer.from(marker)), false);
      if (process.platform === 'linux') assert.equal((await stat(join(root, 'auth.dpapi'))).mode & 0o777, 0o600);
    } finally { await rm(root, { recursive: true, force: true }); }
  }
});

test('Linux rejects basic_text, unknown and missing backends before encryption, decryption or plaintext migration', async () => {
  for (const backend of ['basic_text', 'unknown', undefined] as const) {
    const root = await mkdtemp(join(tmpdir(), 'auth-vault-insecure-'));
    try {
      const storage = { ...safeStorageMock,
        getSelectedStorageBackend: backend === undefined ? undefined : () => backend,
        encryptString: () => { throw new Error('Encryption must not be attempted'); },
        decryptString: () => { throw new Error('Decryption must not be attempted'); } };
      const vault = new AuthVault(root, storage, 'linux');
      assert.deepEqual(await vault.load(), {}, 'no-credential startup does not require a keyring');
      await assert.rejects(vault.save(credentials), /Secure credential storage.*GNOME Keyring or KWallet/);
      await assert.rejects(readFile(join(root, 'auth.dpapi')), { code: 'ENOENT' });
      const plain = JSON.stringify(credentials);
      await writeFile(join(root, 'auth.json'), plain);
      await assert.rejects(vault.load(), /Secure credential storage/);
      assert.equal(await readFile(join(root, 'auth.json'), 'utf8'), plain, 'failed migration preserves the source');
      const encrypted = safeStorageMock.encryptString(plain);
      await writeFile(join(root, 'auth.dpapi'), encrypted);
      await assert.rejects(vault.load(), /Secure credential storage/);
      assert.deepEqual(await readFile(join(root, 'auth.dpapi')), encrypted, 'failed unlock preserves the vault');
    } finally { await rm(root, { recursive: true, force: true }); }
  }
});

test('an unavailable keyring permits an empty Linux profile but cannot save secrets', async () => {
  const root = await mkdtemp(join(tmpdir(), 'auth-vault-unavailable-'));
  try {
    const storage = { ...safeStorageMock, isEncryptionAvailable: () => false };
    const vault = new AuthVault(root, storage, 'linux');
    await writeFile(join(root, 'auth.json'), '{}');
    assert.deepEqual(await vault.load(), {});
    await assert.rejects(readFile(join(root, 'auth.json')), { code: 'ENOENT' });
    await assert.rejects(vault.save(credentials), /Secure credential storage/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('Windows retains DPAPI behavior without a Linux backend API', async () => {
  const root = await mkdtemp(join(tmpdir(), 'auth-vault-windows-'));
  try {
    const storage = { ...safeStorageMock, getSelectedStorageBackend: undefined };
    const vault = new AuthVault(root, storage, 'win32');
    await vault.save(credentials);
    assert.deepEqual(await vault.load(), credentials);
    await assert.rejects(new AuthVault(root, { ...storage, isEncryptionAvailable: () => false }, 'win32').load(),
      /Secure credential storage is unavailable/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
