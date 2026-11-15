import assert from 'node:assert/strict';
import { readFile, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { PluginHostBindingStore } from '../electron/plugin-host-contract.mjs';
import { COLD_START_PAYLOAD_FILES, COLD_START_PLUGIN_IDS, createColdStartPluginFixture } from '../scripts/session-plugin-cold-start-fixture.mjs';
import { mkdtemp, removeTestProfile } from '../scripts/test-profile.mjs';

test('cold-start fixture persists the host selection and duplicates a functional desktop package with dependencies', async t => {
  const profile = await realpath(await mkdtemp(join(tmpdir(), 'dfsc-cold-fixture-unit-')));
  let fixture: Awaited<ReturnType<typeof createColdStartPluginFixture>> | undefined;
  t.after(async () => {
    try { await fixture?.model.close(); }
    finally { await removeTestProfile(profile); }
  });
  fixture = await createColdStartPluginFixture(profile, process.execPath, { payloadFiles: 98 });
  assert.ok(COLD_START_PAYLOAD_FILES >= 3920, 'Native acceptance must match the production file-count order');
  assert.deepEqual(fixture.inventory.installed, fixture.inventory.marketplace);
  assert.equal(fixture.inventory.installed.files, 104);
  assert.ok(fixture.inventory.installed.bytes > 98 * 8000);
  for (const directory of [join(fixture.root, 'plugins', COLD_START_PLUGIN_IDS.large),
    join(fixture.root, 'marketplaces', 'startup-synthetic-market', 'plugins', COLD_START_PLUGIN_IDS.large)]) {
    const manifest = JSON.parse(await readFile(join(directory, 'step.plugin.json'), 'utf8'));
    assert.ok(manifest.mcpServers.tools, 'The slow package is functional, not a resource-only theme');
    const desktop = JSON.parse(await readFile(join(directory, 'dfsc.plugin.json'), 'utf8')).desktop;
    assert.equal(desktop.surface, 'main-view');
    assert.equal(desktop.pages.length, 3, 'Large packages must exercise the actual desktop metadata path');
    assert.equal(JSON.parse(await readFile(join(directory, 'node_modules', 'synthetic-000', 'package.json'), 'utf8')).version, '0.0.0');
  }
  const selection = await new PluginHostBindingStore(fixture.root).current(fixture.descriptor);
  assert.ok('mode' in selection, 'The fixture was configured before application launch');
  assert.equal(selection.mode, 'independent');
  assert.equal(selection.configurationCurrent, true);
  assert.equal(selection.configurationRevision, fixture.configurationRevision);
  assert.match(await readFile(join(fixture.root, 'config.toml'), 'utf8'),
    /\[mcp_servers\."startup-dependency-tools__tools"\]\nenabled = false/);
});

test('cold-start acceptance never warms the capability catalog or diagnostic before measuring interaction', async () => {
  const source = await readFile(new URL('../scripts/verify-session-plugin-cold-start.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /capabilityCatalog\s*\(|diagnose-plugin-startup|await\s+configure\s*\(/);
  const setup = source.indexOf('fixture = await createColdStartPluginFixture');
  const launch = source.indexOf('app = await electron.launch');
  const interaction = source.indexOf('entry.interactionStartedMs = elapsed()');
  const click = source.indexOf('await target.click()');
  const reply = source.indexOf('entry.replyReceivedMs = elapsed()');
  assert.ok(setup >= 0 && setup < launch && launch < interaction && interaction < click && click < reply);
  assert.match(source, /entry\.appReadyObservedMs = elapsed\(\)/);
  assert.match(source, /entry\.firstActionableMs = elapsed\(\)/);
  assert.match(source, /entry\.runtimeStartupTiming = answered\.runtimeStartupTiming/);
  assert.match(source, /entry\.replyReceivedMs < 30000/);
  assert.match(source, /entry\.interactionToReplyMs < 15000/);
});
