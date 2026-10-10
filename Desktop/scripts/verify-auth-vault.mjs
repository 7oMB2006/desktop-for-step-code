import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const profile = await realpath(await mkdtemp(join(tmpdir(), 'desktop-auth-vault-')));
const dataRoot = join(profile, 'step-runtime');
const marker = 'fixture-only-vault-key';
await mkdir(dataRoot, { recursive: true });
await writeFile(join(dataRoot, 'auth.json'), JSON.stringify({
  step: { type: 'oauth', access: marker, refresh: 'fixture', expires: Number.MAX_SAFE_INTEGER, profile: 'platform_cn' },
}));

const env = { ...process.env, DESKTOP_TEST_USER_DATA: profile, DESKTOP_TEST_NO_FOCUS: '1' };
delete env.ELECTRON_RUN_AS_NODE;
const executablePath = process.env.DESKTOP_VERIFY_EXE;
let phase = 'launch';
let closing = false;
const mark = value => { phase = value; console.log(`Vault acceptance: ${value}`); };
const launch = async () => {
  closing = false;
  const application = await electron.launch({ ...(executablePath ? { executablePath } : { args: [resolve('.')] }), env, timeout: 60000 });
  application.process().on('exit', (code, signal) => {
    if (!closing) console.error(`Unexpected vault Electron exit during ${phase}: code=${code}, signal=${signal}`);
  });
  await application.firstWindow();
  await application.evaluate(({ BrowserWindow, dialog }) => {
    const window = BrowserWindow.getAllWindows()[0];
    window.setOpacity(0); window.setIgnoreMouseEvents(true); window.showInactive();
    dialog.showMessageBox = async () => ({ response: 1 });
  });
  return application;
};
process.on('uncaughtExceptionMonitor', error => console.error(`Vault failure during ${phase}:`, error));
let app = await launch();
try {
  mark('migration readiness');
  const page = await app.firstWindow();
  await page.getByRole('heading', { name: /^(让想法阶跃星辰|星辰因你而阶跃)$/ }).waitFor();
  await page.evaluate(() => window.desktop.snapshot());
  const encrypted = await readFile(join(dataRoot, 'auth.dpapi'));
  assert.equal(encrypted.includes(Buffer.from(marker)), false);
  await assert.rejects(readFile(join(dataRoot, 'auth.json')), { code: 'ENOENT' });
  assert.equal(await app.evaluate(({ safeStorage }) => safeStorage.isEncryptionAvailable()), true);
  assert.equal(await page.evaluate(async () => (await window.desktop.settings()).account.loggedIn), true);

  mark('logout');
  await page.evaluate(() => window.desktop.logout());
  assert.equal(await page.evaluate(async () => (await window.desktop.settings()).account.loggedIn), false);
  mark('login and encrypted persistence');
  await page.evaluate(() => window.desktop.login('platform_cn', 'fixture-only-second-key'));
  assert.equal((await readFile(join(dataRoot, 'auth.dpapi'))).includes(Buffer.from('fixture-only-second-key')), false);
  await assert.rejects(readFile(join(dataRoot, 'auth.json')), { code: 'ENOENT' });
} finally { closing = true; await app.close(); }

mark('relaunch');
app = await launch();
try {
  mark('restored account');
  const page = await app.firstWindow();
  await page.getByRole('heading', { name: /^(让想法阶跃星辰|星辰因你而阶跃)$/ }).waitFor();
  await page.evaluate(() => window.desktop.snapshot());
  assert.equal(await page.evaluate(async () => (await window.desktop.settings()).account.loggedIn), true);
  await assert.rejects(readFile(join(dataRoot, 'auth.json')), { code: 'ENOENT' });
} finally { closing = true; await app.close(); }
console.log('Vault migration, login, logout, and relaunch passed with isolated fixture credentials.');
