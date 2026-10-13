import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, writeFile, stat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AuthVault, CredentialStorageUnavailableError } from '../electron/auth-vault';

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

test('explicit Linux availability checks use only secure-backend readiness and leave files untouched', async () => {
  const root = await mkdtemp(join(tmpdir(), 'auth-vault-readiness-'));
  try {
    const files = ['auth.dpapi', 'auth.json', 'legacy-auth.json'];
    for (const file of files) await writeFile(join(root, file), 'not a credential store');
    for (const backend of ['gnome_libsecret', 'kwallet', 'kwallet5', 'kwallet6'] as const) {
      const checked: string[] = [];
      const vault = new AuthVault(root, {
        isEncryptionAvailable: () => { checked.push('available'); return true; },
        getSelectedStorageBackend: () => { checked.push('backend'); return backend; },
        encryptString: () => { throw new Error('Readiness must not encrypt'); },
        decryptString: () => { throw new Error('Readiness must not decrypt'); },
      }, 'linux');
      assert.equal(await vault.availability(), true);
      assert.equal(await vault.assertAvailable(), undefined);
      assert.deepEqual(checked, ['available', 'backend', 'available', 'backend']);
    }
    assert.deepEqual((await readdir(root)).sort(), files.sort());
    for (const file of files) assert.equal(await readFile(join(root, file), 'utf8'), 'not a credential store');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('Linux availability rejects unavailable, basic_text, unknown and missing keyring backends', async () => {
  const root = await mkdtemp(join(tmpdir(), 'auth-vault-readiness-unavailable-'));
  try {
    for (const [available, backend] of [[false, 'gnome_libsecret'], [true, 'basic_text'],
      [true, 'unknown'], [true, undefined]] as const) {
      const vault = new AuthVault(root, {
        isEncryptionAvailable: () => available,
        getSelectedStorageBackend: backend === undefined ? undefined : () => backend,
        encryptString: () => { throw new Error('Readiness must not encrypt'); },
        decryptString: () => { throw new Error('Readiness must not decrypt'); },
      }, 'linux');
      assert.equal(await vault.availability(), false);
      await assert.rejects(vault.assertAvailable(), CredentialStorageUnavailableError);
    }
    assert.deepEqual(await readdir(root), []);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('availability errors fail closed while assertAvailable preserves the underlying unexpected error', async () => {
  const failure = new Error('Native backend readiness failed');
  const vault = new AuthVault('unused-readiness-root', {
    ...safeStorageMock,
    isEncryptionAvailable: () => { throw failure; },
  }, 'linux');
  assert.equal(await vault.availability(), false);
  await assert.rejects(vault.assertAvailable(), error => error === failure);
});

test('a successful availability result is not cached by assertAvailable or save', async () => {
  const root = await mkdtemp(join(tmpdir(), 'auth-vault-readiness-race-'));
  try {
    let available = true;
    let encryptions = 0;
    const vault = new AuthVault(root, {
      ...safeStorageMock,
      isEncryptionAvailable: () => available,
      encryptString: plain => { encryptions++; return safeStorageMock.encryptString(plain); },
    }, 'linux');
    assert.equal(await vault.availability(), true);
    available = false;
    await assert.rejects(vault.assertAvailable(), CredentialStorageUnavailableError);
    await assert.rejects(vault.save(credentials), CredentialStorageUnavailableError);
    assert.equal(await vault.availability(), false);
    assert.equal(encryptions, 0);
    assert.deepEqual(await readdir(root), []);
    available = true;
    assert.equal(await vault.availability(), true);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('Windows readiness retains the encryption-availability rule without querying Linux backends', async () => {
  let available = true;
  const vault = new AuthVault('unused-readiness-root', {
    ...safeStorageMock,
    isEncryptionAvailable: () => available,
    getSelectedStorageBackend: () => { throw new Error('Windows must not query the Linux backend'); },
  }, 'win32');
  assert.equal(await vault.availability(), true);
  await vault.assertAvailable();
  available = false;
  assert.equal(await vault.availability(), false);
  await assert.rejects(vault.assertAvailable(), {
    name: 'CredentialStorageUnavailableError', message: 'Secure credential storage is unavailable',
  });
});

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

test('clearing Linux credentials removes the vault and permits the next launch without a keyring', async () => {
  const emptyStores = [{}, { step: null }, { step: ' \n\t' },
    { step: {}, providers: [] }, { step: { tokens: [null, ' ', {}, []] } }];
  for (const empty of emptyStores) {
    const root = await mkdtemp(join(tmpdir(), 'auth-vault-linux-clear-'));
    try {
      const vault = new AuthVault(root, safeStorageMock, 'linux');
      await vault.save(credentials);
      await vault.save(empty);
      await assert.rejects(readFile(join(root, 'auth.dpapi')), { code: 'ENOENT' });
      const unavailable = { ...safeStorageMock, isEncryptionAvailable: () => false,
        decryptString: () => { throw new Error('Decryption must not be attempted'); } };
      assert.deepEqual(await new AuthVault(root, unavailable, 'linux').load(), {});
      assert.deepEqual(await readdir(root), [], 'clearing must not leave ciphertext or temporary files');
    } finally { await rm(root, { recursive: true, force: true }); }
  }
});

test('clearing an empty Linux store never needs a backend and is idempotent', async () => {
  const root = await mkdtemp(join(tmpdir(), 'auth-vault-linux-clear-unavailable-'));
  try {
    const storage = { ...safeStorageMock,
      isEncryptionAvailable: () => { throw new Error('The backend must not be consulted'); },
      encryptString: () => { throw new Error('Encryption must not be attempted'); } };
    const vault = new AuthVault(root, storage, 'linux');
    await vault.save({});
    await writeFile(join(root, 'auth.dpapi'), safeStorageMock.encryptString(JSON.stringify(credentials)));
    await vault.save({ step: { access: null, refresh: '', providers: [] } });
    await vault.save({});
    assert.deepEqual(await vault.load(), {});
    assert.deepEqual(await readdir(root), []);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('a failed Linux vault deletion rejects the save instead of reporting a successful clear', async () => {
  const root = await mkdtemp(join(tmpdir(), 'auth-vault-linux-clear-failure-'));
  try {
    const path = join(root, 'auth.dpapi');
    await mkdir(path);
    await writeFile(join(path, 'preserve'), marker);
    const storage = { ...safeStorageMock,
      isEncryptionAvailable: () => { throw new Error('The backend must not be consulted'); } };
    await assert.rejects(new AuthVault(root, storage, 'linux').save({}),
      (error: NodeJS.ErrnoException) => error.path === path && error.code !== 'ENOENT');
    assert.equal(await readFile(join(path, 'preserve'), 'utf8'), marker);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('nonempty Linux data still requires a keyring and cannot erase an existing vault', async () => {
  const root = await mkdtemp(join(tmpdir(), 'auth-vault-linux-nonempty-'));
  try {
    const encrypted = safeStorageMock.encryptString(JSON.stringify(credentials));
    await writeFile(join(root, 'auth.dpapi'), encrypted);
    const vault = new AuthVault(root, { ...safeStorageMock, isEncryptionAvailable: () => false }, 'linux');
    for (const data of [credentials, { step: 0 }, { step: false }, { step: { tokens: ['', marker] } }]) {
      await assert.rejects(vault.save(data), /Secure credential storage/);
      assert.deepEqual(await readFile(join(root, 'auth.dpapi')), encrypted);
    }
    await assert.rejects(vault.load(), /Secure credential storage/);
    assert.deepEqual(await readFile(join(root, 'auth.dpapi')), encrypted);
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

test('Windows continues to encrypt empty stores and require DPAPI for saving or loading them', async () => {
  const root = await mkdtemp(join(tmpdir(), 'auth-vault-windows-empty-'));
  try {
    const storage = { ...safeStorageMock, getSelectedStorageBackend: undefined };
    const vault = new AuthVault(root, storage, 'win32');
    await vault.save(credentials);
    await vault.save({});
    const encrypted = await readFile(join(root, 'auth.dpapi'));
    assert.deepEqual(JSON.parse(storage.decryptString(encrypted)), {});
    assert.deepEqual(await vault.load(), {});
    const unavailable = new AuthVault(root, { ...storage, isEncryptionAvailable: () => false }, 'win32');
    await assert.rejects(unavailable.save({}), /Secure credential storage is unavailable/);
    await assert.rejects(unavailable.load(), /Secure credential storage is unavailable/);
    assert.deepEqual(await readFile(join(root, 'auth.dpapi')), encrypted);
  } finally { await rm(root, { recursive: true, force: true }); }
});
