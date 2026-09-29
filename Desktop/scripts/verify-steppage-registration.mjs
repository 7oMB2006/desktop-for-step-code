// StepPage MCP registration acceptance.
//
// Verifies the startup registration path only: the app must register a
// spawnable server (staged node + official bundle) when the bundle is present,
// stay idempotent, never overwrite a user-configured server of the same name,
// and register nothing when no bundle is present. The bundle here is a fixture
// file: a real MCP handshake needs the real bundle and is recorded separately.
import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const serverName = 'steppage';
const expectedCommand = join(resolve('runtime'), 'node', 'node.exe');
const userCommand = 'my-own-steppage-command';

const launchCase = async (profile, bundlePath) => {
  const env = { ...process.env, DESKTOP_TEST_USER_DATA: profile, DESKTOP_TEST_NO_FOCUS: '1', DESKTOP_STEPPAGE_BUNDLE: bundlePath };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ args: [resolve('.')], env, timeout: 60000 });
  try {
    const page = await app.firstWindow();
    await page.getByRole('heading', { name: '让想法阶跃星辰' }).waitFor();
    await page.evaluate(() => window.desktop.snapshot());
    const settings = await page.evaluate(() => window.desktop.settings());
    return settings.mcp ?? {};
  } finally {
    await app.close();
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
  await writeFile(join(profile, 'step-runtime', 'config.toml'), 'permissionPreset = "ask"\n\n[mcp_servers."steppage"]\nenabled = true\ncommand = "C:\\\\Windows\\\\System32\\\\where.exe"\nargs = []\n');
  const bundle = await writeFakeBundle(profile);
  const mcp = await launchCase(profile, bundle);
  assert.equal(mcp[serverName]?.command, 'C:\\Windows\\System32\\where.exe', 'an equivalent TOML spelling must not be overwritten');
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
  const stalePath = join(profile, 'gone-install', 'runtime', 'node', 'node.exe');
  await writeFile(configPath, written.replace(`command = "${escaped}"`, `command = "${stalePath.replace(/\\/g, '\\\\')}"`));
  const second = await launchCase(profile, bundle);
  assert.equal(second[serverName]?.command, expectedCommand, 'a stale managed entry must be refreshed to the current node');
  console.log('case 6 ok: stale managed entry refreshed');
}

await cleanup(profiles);
console.log('StepPage registration acceptance passed.');
