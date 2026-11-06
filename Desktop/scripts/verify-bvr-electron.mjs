import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { join, isAbsolute } from 'node:path';
import { _electron as electron } from 'playwright';

const options = {};
for (let index = 2; index < process.argv.length; index += 2) {
  const key = process.argv[index], value = process.argv[index + 1];
  assert.ok(['--main', '--output'].includes(key) && !options[key] && isAbsolute(value ?? ''),
    'Use --main <built main.cjs with sibling renderer/preloads> --output <new absolute directory>');
  options[key] = value;
}
assert.ok(options['--main'] && options['--output']);
await mkdir(options['--output'], { recursive: false });
const profile = join(options['--output'], 'profile');
await mkdir(profile);
await writeFile(join(profile, 'preferences.json'), JSON.stringify({ language: 'en', theme: 'light', workspaces: [], autoCheckUpdates: false }));
const env = { ...process.env, DESKTOP_TEST_USER_DATA: profile, DESKTOP_TEST_NO_FOCUS: '1' };
delete env.ELECTRON_RUN_AS_NODE;
delete env.STEP_API_KEY;
let app;
const descriptor = join(profile, 'step-runtime', 'bvr', 'host.json');
try {
  const executablePath = process.env.DESKTOP_VERIFY_EXE;
  app = await electron.launch({ ...(executablePath ? { executablePath } : {}),
    args: executablePath ? [] : [options['--main']], env, timeout: 60000 });
  const page = await app.firstWindow();
  await page.waitForFunction(() => Boolean(window.desktop));
  const snapshot = await page.evaluate(() => window.desktop.snapshot());
  const host = JSON.parse(await readFile(descriptor, 'utf8'));
  assert.equal(host.version, 1);
  assert.equal(new URL(host.url).hostname, '127.0.0.1');
  assert.match(host.token, /^[a-f0-9]{64}$/);
  assert.ok(!JSON.stringify(snapshot).includes(host.token), 'Bridge capability must stay out of renderer state');
  assert.equal(await page.evaluate(() => typeof window.require), 'undefined');
  const response = await fetch(`${host.url}/context`, { method: 'POST',
    headers: { Authorization: `Bearer ${host.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ runtimePid: 12345 }) });
  assert.equal(response.status, 403, 'Absent BVR opt-in must fail closed');
  await app.close();
  app = undefined;
  await assert.rejects(access(descriptor), /ENOENT/);
  await writeFile(join(options['--output'], 'verification.json'), JSON.stringify({
    realElectron: true, isolatedProfile: true, realProviderRequests: false,
    checks: ['new main process starts with BVR bridge', 'bridge token excluded from renderer snapshot',
      'renderer has no Node access', 'plugin install alone is not host authorization', 'quit removes descriptor'],
  }, null, 2));
  console.log('BVR Electron smoke passed: isolated startup, renderer isolation, opt-in rejection, descriptor cleanup.');
} finally { await app?.close(); }
