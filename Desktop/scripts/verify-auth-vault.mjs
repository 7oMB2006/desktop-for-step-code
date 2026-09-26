import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const profile = await mkdtemp(join(tmpdir(), 'desktop-auth-vault-'));
const dataRoot = join(profile, 'step-runtime');
const marker = 'fixture-only-vault-key';
await mkdir(dataRoot, { recursive: true });
await writeFile(join(dataRoot, 'auth.json'), JSON.stringify({
  step: { type: 'oauth', access: marker, refresh: 'fixture', expires: Number.MAX_SAFE_INTEGER, profile: 'platform_cn' },
}));

const env = { ...process.env, DESKTOP_TEST_USER_DATA: profile };
delete env.ELECTRON_RUN_AS_NODE;
const executablePath = process.env.DESKTOP_VERIFY_EXE;
const launch = () => electron.launch({ ...(executablePath ? { executablePath } : { args: [resolve('.')] }), env, timeout: 60000 });
let app = await launch();
try {
  const page = await app.firstWindow();
  await page.getByRole('heading', { name: '让想法阶跃星辰' }).waitFor();
  await page.evaluate(() => window.desktop.snapshot());
  const encrypted = await readFile(join(dataRoot, 'auth.dpapi'));
  assert.equal(encrypted.includes(Buffer.from(marker)), false);
  await assert.rejects(readFile(join(dataRoot, 'auth.json')), { code: 'ENOENT' });
  assert.equal(await app.evaluate(({ safeStorage }) => safeStorage.isEncryptionAvailable()), true);
  assert.equal(await page.evaluate(async () => (await window.desktop.settings()).account.loggedIn), true);

  await page.evaluate(() => window.desktop.logout());
  assert.equal(await page.evaluate(async () => (await window.desktop.settings()).account.loggedIn), false);
  await page.evaluate(() => window.desktop.login('platform_cn', 'fixture-only-second-key'));
  assert.equal((await readFile(join(dataRoot, 'auth.dpapi'))).includes(Buffer.from('fixture-only-second-key')), false);
  await assert.rejects(readFile(join(dataRoot, 'auth.json')), { code: 'ENOENT' });
} finally { await app.close(); }

app = await launch();
try {
  const page = await app.firstWindow();
  await page.getByRole('heading', { name: '让想法阶跃星辰' }).waitFor();
  await page.evaluate(() => window.desktop.snapshot());
  assert.equal(await page.evaluate(async () => (await window.desktop.settings()).account.loggedIn), true);
  await assert.rejects(readFile(join(dataRoot, 'auth.json')), { code: 'ENOENT' });
} finally { await app.close(); }
console.log('Vault migration, login, logout, and relaunch passed with isolated fixture credentials.');
