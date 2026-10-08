// Crash log acceptance: a real startup failure must leave a readable file.
// Uses fixture credentials in an isolated profile; no real account is involved.
import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const sleep = ms => new Promise(r => setTimeout(r, ms));
const profile = await mkdtemp(join(tmpdir(), 'desktop-crash-log-'));
const dataRoot = join(profile, 'step-runtime');
const logsDir = join(profile, 'logs');
const marker = 'fixture-crash-log-key';
await mkdir(dataRoot, { recursive: true });

const env = { ...process.env, DESKTOP_TEST_USER_DATA: profile, DESKTOP_TEST_NO_FOCUS: '1' };
delete env.ELECTRON_RUN_AS_NODE;
const executablePath = process.env.DESKTOP_VERIFY_EXE;
const launch = () => electron.launch({ ...(executablePath ? { executablePath } : { args: [resolve('.')] }), env, timeout: 60000 });

// 1. A real encrypted vault: start once with a plaintext legacy file, which the
//    app migrates to auth.dpapi and removes. (Fixture credential only.)
await writeFile(join(dataRoot, 'auth.json'), JSON.stringify({
  step: { type: 'oauth', access: marker, refresh: 'fixture', expires: Number.MAX_SAFE_INTEGER, profile: 'platform_cn' },
}));

let app = await launch();
try {
  const page = await app.firstWindow();
  await page.getByRole('heading', { name: /^(让想法阶跃星辰|星辰因你而阶跃)$/ }).waitFor();
  await page.evaluate(() => window.desktop.snapshot());
} finally { await app.close(); }

const encrypted = await readFile(join(dataRoot, 'auth.dpapi'));
assert.equal(encrypted.includes(Buffer.from(marker)), false, 'vault content must be encrypted');
await assert.rejects(readFile(join(dataRoot, 'auth.json')), { code: 'ENOENT' }, 'legacy plaintext must be gone');

// Empty runtime placeholders and reordered equivalent credentials must not
// conflict with or rewrite the already encrypted vault.
for (const legacy of [
  {},
  { step: { profile: 'platform_cn', expires: Number.MAX_SAFE_INTEGER, refresh: 'fixture', access: marker, type: 'oauth' } },
]) {
  await writeFile(join(dataRoot, 'auth.json'), JSON.stringify(legacy));
  app = await launch();
  try {
    const page = await app.firstWindow();
    await page.getByRole('heading', { name: /^(让想法阶跃星辰|星辰因你而阶跃)$/ }).waitFor();
    await page.evaluate(() => window.desktop.snapshot());
  } finally { await app.close(); }
  assert.deepEqual(await readFile(join(dataRoot, 'auth.dpapi')), encrypted, 'migration must preserve the encrypted vault bytes');
  await assert.rejects(readFile(join(dataRoot, 'auth.json')), { code: 'ENOENT' }, 'redundant plaintext must be removed');
}
console.log('Credential migration passed: empty placeholder and reordered equivalent data; encrypted vault unchanged.');

// 2. Conflict: a different plaintext credential beside the encrypted vault.
//    vault.load() refuses this state instead of guessing, which is the failure
//    this acceptance drives.
await writeFile(join(dataRoot, 'auth.json'), JSON.stringify({
  step: { type: 'oauth', access: 'fixture-conflicting-key', refresh: 'fixture', expires: Number.MAX_SAFE_INTEGER, profile: 'platform_cn' },
}));

// 3. The next launch must fail, and the failure must leave a crash log.
try { app = await launch(); } catch { app = null; }
if (app) {
  try { await app.firstWindow(); } catch { /* startup failed before a window appeared */ }
}

const deadline = Date.now() + 30000;
let logs = [];
while (Date.now() < deadline) {
  try { logs = await readdir(logsDir); } catch { logs = []; }
  if (logs.some(name => name.startsWith('crash-') && name.endsWith('.log'))) break;
  await sleep(500);
}
// 4. Background acceptance suppresses the native error dialog and exits.
//    If a failed fixture is still alive, only tear down that test process tree.
if (app) {
  try {
    const pid = app.process().pid;
    execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
  } catch {
    // app already exited on its own; nothing to kill
  }
}

assert.ok(logs.some(name => name.startsWith('crash-') && name.endsWith('.log')), `no crash log under ${logsDir}; found ${JSON.stringify(logs)}`);
const crashName = logs.find(name => name.startsWith('crash-') && name.endsWith('.log'));
const crash = await readFile(join(logsDir, crashName), 'utf8');

assert.match(crash, /kind: startup-failure/, 'crash log must name the failure kind');
assert.match(crash, /error: Error: Conflicting desktop credential files/, 'crash log must carry the real error');
assert.match(crash, /phase: runtime staged/, 'crash log must say what the app was doing');
assert.match(crash, /version: \d+\.\d+\.\d+/, 'crash log must name the app version');
assert.match(crash, /packaged: (true|false)/, 'crash log must say whether the build is packaged');
assert.match(crash, /stack: /, 'crash log must carry the stack');
assert.match(crash, /userData: /, 'crash log must point at userData');
assert.ok(!crash.includes('fixture-conflicting-key'), 'the log must not echo credential values');

// 5. The conflicting plaintext file is left untouched for the user to inspect.
assert.equal((await readFile(join(dataRoot, 'auth.json'), 'utf8')).includes('fixture-conflicting-key'), true);

await rm(profile, { recursive: true, force: true });
console.log(`Crash log acceptance passed: ${crashName}`);
console.log('--- crash log content ---');
console.log(crash.trim());
