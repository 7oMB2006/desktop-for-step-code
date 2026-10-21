// StepPage MCP registration acceptance.
//
// Verifies the startup registration path only: the app must register a
// spawnable server (staged node + official bundle) when the bundle is present,
// stay idempotent, never overwrite a user-configured server of the same name,
// preserve disable on relocation, migrate the legacy name, and register nothing
// when no bundle is present. The bundle here is a fixture
// file: a real MCP handshake needs the real bundle and is recorded separately.
import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

const serverName = 'steppage__steppage';
const executablePath = process.env.DESKTOP_VERIFY_EXE;
const nodeName = process.platform === 'darwin' ? 'node' : 'node.exe';
const resources = executablePath ? (process.platform === 'darwin' ? resolve(dirname(executablePath), '../Resources') : join(dirname(executablePath), 'resources')) : resolve('.');
const expectedCommand = join(resources, 'runtime', 'node', nodeName);
const userCommand = 'my-own-steppage-command';
let launchNumber = 0;
let phase = 'initializing';
process.on('exit', code => {
  if (code !== 0) console.error(`StepPage acceptance exited (${code}) during ${phase}`);
});

const reportFailure = async (profile) => {
  const logs = join(profile, 'logs');
  for (const name of await readdir(logs).catch(() => [])) {
    if (!/^crash-.*\.log$/.test(name)) continue;
    const content = await readFile(join(logs, name), 'utf8');
    // Report lifecycle metadata only, never credential content or runtime stderr.
    console.error(content.split(/\r?\n/).filter(line => /^(time|kind|phase): /.test(line)).join('\n'));
  }
};

const launchCase = async (profile, bundlePath) => {
  phase = `launch ${++launchNumber}`;
  console.log(`StepPage acceptance: ${phase}`);
  const env = { ...process.env, DESKTOP_TEST_USER_DATA: profile, DESKTOP_TEST_NO_FOCUS: '1', DESKTOP_STEPPAGE_BUNDLE: bundlePath };
  delete env.ELECTRON_RUN_AS_NODE;
  let app;
  let closing = false;
  try {
    app = await electron.launch({ ...(executablePath ? { executablePath } : { args: [resolve('.')] }), env, timeout: 60000 });
    app.process().on('exit', (code, signal) => {
      if (!closing) console.error(`Unexpected Electron exit during ${phase}: code=${code}, signal=${signal}`);
    });
    phase = `launch ${launchNumber}: window ready`;
    const page = await app.firstWindow();
    await page.locator('.app').waitFor();
    phase = `launch ${launchNumber}: runtime snapshot`;
    await page.evaluate(() => window.desktop.snapshot());
    phase = `launch ${launchNumber}: settings`;
    const settings = await page.evaluate(() => window.desktop.settings());
    return settings.mcp ?? {};
  } catch (error) {
    console.error(`StepPage acceptance failed during ${phase}`);
    await reportFailure(profile);
    throw error;
  } finally {
    closing = true;
    if (app) await app.close();
  }
};

const makeProfile = async () => {
  const profile = await mkdtemp(join(tmpdir(), 'steppage-reg-'));
  await mkdir(join(profile, 'step-runtime'), { recursive: true });
  return profile;
};
const writeFakeBundle = async (profile) => {
  const bundle = join(profile, 'fixture-steppage-bundle.mjs');
  await writeFile(bundle, '// fixture bundle: registration acceptance only, never spawned for tools\n');
  return bundle;
};
const configOf = async (profile) => readFile(join(profile, 'step-runtime', 'config.toml'), 'utf8');
const cleanup = async (profiles) => { for (const profile of profiles) await rm(profile, { recursive: true, force: true }); };

const profiles = [];

const runCases = async () => {
// 1. Bundle present on a clean profile: the server is registered with the
//    staged runtime node as the command and the bundle as the argument.
{
  const profile = await makeProfile(); profiles.push(profile);
  const bundle = await writeFakeBundle(profile);
  const mcp = await launchCase(profile, bundle);
  assert.ok(mcp[serverName], `server ${serverName} must be registered when the bundle exists`);
  assert.equal(mcp[serverName].command, expectedCommand, 'command must be the staged runtime node');
  assert.deepEqual(mcp[serverName].args ?? [], [bundle], 'args must point at the bundle');
  assert.equal(mcp[serverName].enabled, true, 'server must be enabled');
  assert.ok(existsSync(expectedCommand), 'the configured node must exist on disk');
  const config = await configOf(profile);
  assert.ok(config.includes(`[mcp_servers.${serverName}]`), 'the registration must reach the runtime config');
  console.log('case 1 ok: registered ' + mcp[serverName].command);
}

// 2. Same profile again: idempotent, no duplicate entry, nothing overwritten.
{
  const profile = profiles[0];
  const bundle = join(profile, 'fixture-steppage-bundle.mjs');
  const mcp = await launchCase(profile, bundle);
  assert.deepEqual(mcp[serverName]?.args ?? [], [bundle], 'relaunch must not change the registration');
  const config = await configOf(profile);
  const occurrences = config.split(`[mcp_servers.${serverName}]`).length - 1;
  assert.equal(occurrences, 1, `the server must be registered exactly once, found ${occurrences}`);
  console.log('case 2 ok: relaunch idempotent');
}

// 3. User configured this server themselves first: the startup path skips.
{
  const profile = await makeProfile(); profiles.push(profile);
  await writeFile(join(profile, 'step-runtime', 'config.toml'), 'permissionPreset = "ask"\n\n[mcp_servers.steppage]\nenabled = true\ncommand = "' + userCommand + '"\nargs = []\n');  const bundle = await writeFakeBundle(profile);
  const mcp = await launchCase(profile, bundle);
  assert.equal(mcp[serverName]?.command, userCommand, 'a user-configured server must not be overwritten');
  assert.ok(!mcp.steppage, 'the legacy name must migrate, not duplicate the plugin server');
  console.log('case 3 ok: user configuration preserved');
}

// 4. No bundle: nothing registered, builtin behaviour unchanged.
{
  const profile = await makeProfile(); profiles.push(profile);
  const mcp = await launchCase(profile, join(profile, 'no-such-bundle.mjs'));
  assert.ok(!(serverName in mcp), 'no bundle must mean no registration');
  console.log('case 4 ok: no bundle, no registration');
}

// 5. An equivalent TOML spelling (a quoted key) with the user's own command:
//    the startup path must recognise the parsed entry and leave it alone.
{
  const profile = await makeProfile(); profiles.push(profile);
  await writeFile(join(profile, 'step-runtime', 'config.toml'), 'permissionPreset = "ask"\n\n[mcp_servers."steppage"]\nenabled = false\ncommand = "C:\\\\Windows\\\\System32\\\\where.exe"\nargs = ["custom"]\n');
  const bundle = await writeFakeBundle(profile);
  const mcp = await launchCase(profile, bundle);
  assert.equal(mcp[serverName]?.command, 'C:\\Windows\\System32\\where.exe', 'an equivalent TOML spelling must not be overwritten');
  assert.equal(mcp[serverName]?.enabled, false, 'legacy disable must suppress the qualified plugin identity');
  assert.deepEqual(mcp[serverName]?.args, ['custom']);
  assert.ok(!mcp.steppage);
  console.log('case 5 ok: quoted-key configuration recognised and left alone');
}

// 6. A stale desktop-managed entry: the app was reinstalled elsewhere, so the
//    remembered runtime node no longer exists. That entry must be refreshed,
//    not mistaken for user configuration.
{
  const profile = await makeProfile(); profiles.push(profile);
  const bundle = await writeFakeBundle(profile);
  const first = await launchCase(profile, bundle);
  assert.equal(first[serverName]?.command, expectedCommand, 'first launch must register the staged node');
  const configPath = join(profile, 'step-runtime', 'config.toml');
  const written = await readFile(configPath, 'utf8');
  const escaped = expectedCommand.replace(/\\/g, '\\\\');
  assert.ok(written.includes(`command = "${escaped}"`), 'the registered command must be on disk');
  const stalePath = join(profile, 'gone-install', 'runtime', 'node', nodeName);
  await writeFile(configPath, written.replace(`command = "${escaped}"`, `command = "${stalePath.replace(/\\/g, '\\\\')}"`).replace('enabled = true', 'enabled = false'));
  const second = await launchCase(profile, bundle);
  assert.equal(second[serverName]?.command, expectedCommand, 'a stale managed entry must be refreshed to the current node');
  assert.equal(second[serverName]?.enabled, false, 'relocation must not re-enable the server');
  console.log('case 6 ok: stale managed entry refreshed without re-enabling');
}

// 7. Inline TOML and an absent bundle must not erase an explicit disable or secrets.
{
  const profile = await makeProfile(); profiles.push(profile);
  await writeFile(join(profile, 'step-runtime', 'config.toml'),
    'permissionPreset = "ask"\nmcp_servers = { steppage = { enabled = false, command = "custom", args = ["--user"], env = { FIXTURE_SECRET = "not-a-real-secret" } } }\n');
  const missing = join(profile, 'not-installed.mjs');
  const first = await launchCase(profile, missing);
  assert.deepEqual(first[serverName]?.args, ['--user']);
  assert.equal(first[serverName]?.enabled, false);
  assert.ok(first[serverName]?.configuredSecrets.includes('FIXTURE_SECRET'));
  assert.ok(!JSON.stringify(first).includes('not-a-real-secret'), 'secret values must never reach settings');
  const bundle = await writeFakeBundle(profile);
  const retry = await launchCase(profile, bundle);
  assert.equal(retry[serverName]?.command, 'custom');
  assert.equal(retry[serverName]?.enabled, false, 'retry must not undo an explicit disable');
  assert.ok((await configOf(profile)).includes('not-a-real-secret'), 'migration must retain the original secret on disk');
  console.log('case 7 ok: inline disable and secrets survive missing bundle, retry and restart');
}

// 8. A qualified user setting is authoritative over an obsolete managed alias.
{
  const profile = await makeProfile(); profiles.push(profile);
  const bundle = await writeFakeBundle(profile);
  await launchCase(profile, bundle);
  const written = await configOf(profile);
  await writeFile(join(profile, 'step-runtime', 'config.toml'),
    written.replace(`[mcp_servers.${serverName}]`, '[mcp_servers.steppage]')
    + `\n[mcp_servers.${serverName}]\nenabled = false\ncommand = "custom-qualified"\nargs = ["--retain"]\n`);
  const mcp = await launchCase(profile, bundle);
  assert.ok(!mcp.steppage);
  assert.equal(mcp[serverName]?.command, 'custom-qualified');
  assert.equal(mcp[serverName]?.enabled, false);
  assert.deepEqual(mcp[serverName]?.args, ['--retain']);
  console.log('case 8 ok: canonical user setting wins without duplicate managed alias');
}

};

try {
  await runCases();
} finally {
  await cleanup(profiles);
}
phase = 'complete';
console.log('StepPage registration acceptance passed.');
