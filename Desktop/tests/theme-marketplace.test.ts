import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, realpath, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { CapabilityService } from '../electron/capability-service';
import { isolatedEnvironment } from '../electron/runtime';
import { ThemePacks } from '../electron/theme-packs';

test('real marketplace management installs and removes the declarative stellar theme', async t => {
  // Match native plugin fixtures: macOS /var and Windows short TMP aliases
  // must not become the capability service's canonical storage boundary.
  const root = await realpath(await mkdtemp(join(tmpdir(), 'dfsc-theme-market-')));
  await mkdir(join(root, 'agent'));
  const runtime = resolve(process.env.DESKTOP_TEST_RUNTIME ?? 'runtime');
  const service = new CapabilityService({ root, runtime,
    node: join(runtime, 'node', process.platform === 'win32' ? 'node.exe' : 'node'),
    environment: () => isolatedEnvironment(root) });
  t.after(async () => {
    await service.stop();
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });
  const themes = new ThemePacks(join(root, 'plugins'));
  await service.mutate({ action: 'marketplace-add', source: resolve('../theme-marketplace') });
  const catalog = await service.catalog();
  const entry = catalog.available.find(p => p.name === 'stellar-cruise');
  assert.ok(entry);
  assert.equal(entry.installed, false);
  await service.mutate({ action: 'plugin-install', name: entry.name, marketplace: entry.marketplace });
  const installed = (await service.catalog()).plugins.find(p => p.id === 'stellar-cruise');
  assert.ok(installed);
  assert.deepEqual(installed.mcpServers, []);
  assert.deepEqual(installed.warnings, []);
  await themes.refresh();
  assert.equal(themes.packs[0]?.id, 'plugin:stellar-cruise');
  assert.ok(themes.scene('plugin:stellar-cruise').duck.points.length);
  await service.mutate({ action: 'plugin-remove', id: 'stellar-cruise' });
  await themes.refresh();
  assert.deepEqual(themes.packs, []);
  assert.throws(() => themes.scene('plugin:stellar-cruise'));
});
