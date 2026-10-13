import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AuthVault, CredentialStorageUnavailableError } from '../electron/auth-vault';
import { withLoginPreflight } from '../electron/login-preflight';
import { credentialStorageText } from '../src/credential-storage';

const noCredentialAccess = {
  encryptString: () => { throw new Error('Preflight must not encrypt'); },
  decryptString: () => { throw new Error('Preflight must not decrypt'); },
};

test('Linux preflight blocks login before OAuth for unavailable, basic_text, unknown and missing backends', async () => {
  for (const language of ['zh', 'en'] as const) {
    for (const [available, backend] of [[false, 'gnome_libsecret'], [true, 'basic_text'],
      [true, 'unknown'], [true, undefined]] as const) {
      let logins = 0;
      const vault = new AuthVault('unused-preflight-root', {
        ...noCredentialAccess,
        isEncryptionAvailable: () => available,
        getSelectedStorageBackend: backend === undefined ? undefined : () => backend,
      }, 'linux');
      await assert.rejects(withLoginPreflight(vault, language, async () => { logins++; }), error => {
        assert.ok(error instanceof CredentialStorageUnavailableError);
        assert.equal(error.message, credentialStorageText(language).unavailable);
        assert.ok(error.cause instanceof CredentialStorageUnavailableError);
        return true;
      });
      assert.equal(logins, 0);
    }
  }
});

test('Linux preflight permits login exactly once after each secure-backend check and preserves its result', async () => {
  for (const backend of ['gnome_libsecret', 'kwallet', 'kwallet5', 'kwallet6'] as const) {
    const events: string[] = [];
    const vault = new AuthVault('unused-preflight-root', {
      ...noCredentialAccess,
      isEncryptionAvailable: () => { events.push('available'); return true; },
      getSelectedStorageBackend: () => { events.push('backend'); return backend; },
    }, 'linux');
    const result = { loggedIn: true };
    assert.equal(await withLoginPreflight(vault, 'en', async () => { events.push('login'); return result; }), result);
    assert.deepEqual(events, ['available', 'backend', 'login']);
  }
});

test('preflight does not start login before asynchronous readiness finishes', async () => {
  let finish!: () => void;
  const ready = new Promise<void>(resolve => { finish = resolve; });
  let logins = 0;
  const login = withLoginPreflight({ assertAvailable: () => ready }, 'en', async () => { logins++; return null; });
  await Promise.resolve();
  assert.equal(logins, 0);
  finish();
  assert.equal(await login, null);
  assert.equal(logins, 1);
});

test('preflight repeats readiness after a successful status check rather than trusting the old result', async () => {
  let available = true;
  let logins = 0;
  const vault = new AuthVault('unused-preflight-root', {
    ...noCredentialAccess,
    isEncryptionAvailable: () => available,
    getSelectedStorageBackend: () => 'gnome_libsecret',
  }, 'linux');
  assert.equal(await vault.availability(), true);
  available = false;
  await assert.rejects(withLoginPreflight(vault, 'en', async () => { logins++; }), CredentialStorageUnavailableError);
  assert.equal(logins, 0);
});

test('keyring loss after preflight fails credential saving closed with localized guidance and preserves the vault', async () => {
  for (const language of ['zh', 'en'] as const) {
    const root = await mkdtemp(join(tmpdir(), 'login-preflight-race-'));
    try {
      let available = true;
      let logins = 0;
      const encryptedBefore = Buffer.from('fixture-only-existing-ciphertext');
      await writeFile(join(root, 'auth.dpapi'), encryptedBefore);
      const vault = new AuthVault(root, {
        ...noCredentialAccess,
        isEncryptionAvailable: () => available,
        getSelectedStorageBackend: () => 'gnome_libsecret',
      }, 'linux');
      await assert.rejects(withLoginPreflight(vault, language, async () => {
        logins++;
        available = false;
        await vault.save({ step: { access: 'fixture-only-new-key' } });
        return 'must not report success';
      }), error => {
        assert.ok(error instanceof CredentialStorageUnavailableError);
        assert.equal(error.message, credentialStorageText(language).unavailable);
        return true;
      });
      assert.equal(logins, 1);
      assert.deepEqual(await readFile(join(root, 'auth.dpapi')), encryptedBefore);
      assert.deepEqual(await readdir(root), ['auth.dpapi']);
    } finally { await rm(root, { recursive: true, force: true }); }
  }
});

test('unexpected readiness errors block login and propagate unchanged', async () => {
  const failure = new Error('Native keyring call failed');
  let logins = 0;
  const vault = new AuthVault('unused-preflight-root', {
    ...noCredentialAccess,
    isEncryptionAvailable: () => { throw failure; },
    getSelectedStorageBackend: () => 'gnome_libsecret',
  }, 'linux');
  await assert.rejects(withLoginPreflight(vault, 'zh', async () => { logins++; }), error => error === failure);
  assert.equal(logins, 0);
});

test('reported readiness does not mask later encryption failures or overwrite saved credentials', async () => {
  const root = await mkdtemp(join(tmpdir(), 'login-preflight-encryption-failure-'));
  try {
    const failure = new Error('Native encryption failed after readiness');
    const encryptedBefore = Buffer.from('fixture-only-existing-ciphertext');
    await writeFile(join(root, 'auth.dpapi'), encryptedBefore);
    const vault = new AuthVault(root, {
      ...noCredentialAccess,
      isEncryptionAvailable: () => true,
      getSelectedStorageBackend: () => 'gnome_libsecret',
      encryptString: () => { throw failure; },
    }, 'linux');
    assert.equal(await vault.availability(), true);
    await assert.rejects(withLoginPreflight(vault, 'en', () => vault.save({
      step: { access: 'fixture-only-new-key' },
    })), error => error === failure);
    assert.deepEqual(await readFile(join(root, 'auth.dpapi')), encryptedBefore);
    assert.deepEqual(await readdir(root), ['auth.dpapi']);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('ordinary login failures propagate unchanged even when their message resembles a storage error', async () => {
  const vault = { assertAvailable: async () => {} };
  for (const failure of [new Error('OAuth cancelled'), new Error(credentialStorageText('en').unavailable)]) {
    await assert.rejects(withLoginPreflight(vault, 'zh', async () => { throw failure; }), error => error === failure);
  }
});
