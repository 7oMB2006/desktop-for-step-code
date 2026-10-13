import { credentialStorageText } from '../src/credential-storage';
import { AuthVault, CredentialStorageUnavailableError } from './auth-vault';

// Keep the login and its credential save in this callback: the keyring can
// become unavailable after this check, and save must still fail closed.
export async function withLoginPreflight<T>(
  vault: Pick<AuthVault, 'assertAvailable'>,
  language: 'zh' | 'en',
  login: () => Promise<T>,
): Promise<T> {
  try {
    await vault.assertAvailable();
    return await login();
  } catch (error) {
    if (error instanceof CredentialStorageUnavailableError) {
      throw new CredentialStorageUnavailableError(credentialStorageText(language).unavailable, { cause: error });
    }
    throw error;
  }
}
