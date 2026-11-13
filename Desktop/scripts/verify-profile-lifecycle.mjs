import assert from 'node:assert/strict';
import { mkdir, readFile, realpath, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright';
import { executeWithLog } from '../../scripts/ci-macos.mjs';
import { closeDesktopFixtureAndWait } from './close-desktop-fixture.mjs';

const script = fileURLToPath(import.meta.url);
const root = resolve(dirname(script), '..');
const evidence = resolve(process.env.DESKTOP_VERIFY_OUTPUT || join(root, 'test-results/profile-lifecycle'));
const mode = process.argv[2];
const cookieUrl = 'https://profile-lifecycle.invalid';

if (mode === 'cleanup' || mode === 'retain') {
  const caseRoot = await realpath(process.argv[3]);
  process.env.TEMP = caseRoot;
  process.env.TMP = caseRoot;
  process.env.TMPDIR = caseRoot;
  process.env.DESKTOP_KEEP_TEST_PROFILES = mode === 'retain' ? '1' : '0';
  const { mkdtemp } = await import('./test-profile.mjs');
  const profile = await mkdtemp(join(caseRoot, 'desktop-profile-lifecycle-'));
  const marker = join(caseRoot, 'child-result.json');
  await writeFile(marker, JSON.stringify({ profile, verified: false }));
  await writeFile(join(profile, 'preferences.json'), JSON.stringify({
    language: 'en', theme: 'original-light', workspaces: [], autoCheckUpdates: false,
  }));
  const env = { ...process.env, DESKTOP_TEST_USER_DATA: profile, DESKTOP_TEST_NO_FOCUS: '1' };
  for (const key of Object.keys(env)) {
    if (/^(STEPCODE_|STEP_CODING_AGENT_|DESKTOP_DEV_URL$|ELECTRON_RUN_AS_NODE$)/i.test(key)) delete env[key];
  }
  const executablePath = process.env.DESKTOP_VERIFY_EXE;
  for (let launch = 0; launch < 2; launch++) {
    const app = await electron.launch({ executablePath, args: executablePath ? [] : [root], env, timeout: 60000 });
    try {
      const page = await app.firstWindow();
      await page.waitForFunction(() => window.desktop && document.querySelector('.new-chat'), undefined, { timeout: 60000 });
      const actualPath = await app.evaluate(({ app }) => app.getPath('userData'));
      assert.equal(await realpath(actualPath), await realpath(profile));
      if (launch === 0) {
        await app.evaluate(async ({ session }, url) => {
          await session.defaultSession.cookies.set({
            url, name: 'lifecycle-fixture', value: 'synthetic-fixture', expirationDate: Date.now() / 1000 + 3600,
          });
          await session.defaultSession.cookies.flushStore();
        }, cookieUrl);
      } else {
        const values = await app.evaluate(async ({ session }, url) =>
          (await session.defaultSession.cookies.get({ url, name: 'lifecycle-fixture' })).map(cookie => cookie.value), cookieUrl);
        assert.deepEqual(values, ['synthetic-fixture']);
      }
    } finally {
      await closeDesktopFixtureAndWait(app);
    }
  }
  await writeFile(marker, JSON.stringify({ profile, verified: true, relaunchPersistence: true }));
} else {
  assert.equal(mode, undefined, 'Expected no arguments or an internal lifecycle case');
  const { mkdtemp, removeTestProfile } = await import('./test-profile.mjs');
  await mkdir(evidence, { recursive: true });
  const results = [];
  for (const childMode of ['cleanup', 'retain']) {
    const caseRoot = await realpath(await mkdtemp(join(tmpdir(), 'desktop-profile-lifecycle-case-')));
    console.log(`Lifecycle ${childMode} fixture root: ${caseRoot}`);
    await executeWithLog(script, {
      cwd: root, args: [childMode, caseRoot], timeout: 180000,
      logDirectory: evidence, logName: childMode,
    });
    const result = JSON.parse(await readFile(join(caseRoot, 'child-result.json'), 'utf8'));
    assert.equal(dirname(result.profile), caseRoot);
    assert.equal(result.verified, true);
    assert.equal(result.relaunchPersistence, true);
    if (childMode === 'cleanup') {
      await assert.rejects(stat(result.profile), { code: 'ENOENT' });
    } else {
      assert.equal((await stat(result.profile)).isDirectory(), true);
      const log = await readFile(join(evidence, `${childMode}.log`), 'utf8');
      assert.ok(log.includes(`Retained test profile: ${result.profile}`));
    }
    await removeTestProfile(caseRoot);
    const fixtureRemoved = process.env.DESKTOP_KEEP_TEST_PROFILES !== '1';
    if (fixtureRemoved) await assert.rejects(stat(caseRoot), { code: 'ENOENT' });
    results.push({ mode: childMode, ...result, expectedRetentionVerified: true, fixtureRemoved });
    console.log(`Passed ${childMode}: real Electron relaunch and exact profile lifecycle`);
  }
  await writeFile(join(evidence, 'results.json'), `${JSON.stringify({ ok: true, results }, null, 2)}\n`);
}
