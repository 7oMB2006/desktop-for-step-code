export type CredentialStorageState = 'unchecked' | 'checking' | 'ready' | 'unavailable';

export function credentialStorageText(language: string) {
  return language === 'en' ? {
    title: 'Secure credential storage',
    ready: 'A secure keyring was detected. Storage is checked again before sign-in.',
    unchecked: 'Check secure storage before signing in.',
    checking: 'Checking secure storage… Complete or cancel any system keyring dialog.',
    checkingAction: 'Checking…',
    check: 'Check secure storage',
    retry: 'Check again',
    guidance: 'Linux needs an unlocked GNOME Keyring or KWallet in this desktop session. A system dialog may ask you to unlock or set up the keyring. After configuring it, fully quit and reopen the app, then check again. Credentials are never saved in plaintext.',
    unavailable: 'Secure credential storage is unavailable. Unlock or configure GNOME Keyring or KWallet in this desktop session, fully quit and reopen the app, then check again. Sign-in cannot continue without secure storage.',
  } : {
    title: '安全凭据存储',
    ready: '已检测到安全密钥环；登录前会再次检查。',
    unchecked: '请先检查安全存储，再登录账户。',
    checking: '正在检查安全存储…请在系统密钥环对话框中完成操作或取消。',
    checkingAction: '正在检查…',
    check: '检查安全存储',
    retry: '重新检查',
    guidance: 'Linux 需要当前桌面会话中已解锁的 GNOME Keyring 或 KWallet。系统可能提示解锁或设置密钥环。配置后请完全退出并重新打开应用，再次检查。凭据不会以明文保存。',
    unavailable: '安全凭据存储不可用。请在当前桌面会话中解锁或配置 GNOME Keyring 或 KWallet，完全退出并重新打开应用后再次检查。安全存储就绪前无法继续登录。',
  };
}

export function loginStorageReady(platform: string, state: CredentialStorageState): boolean {
  return platform !== 'linux' || state === 'ready';
}
