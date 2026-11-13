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

test('real marketplace background adapter requires a recorded install and is revoked on uninstall', async t => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'dfsc-background-market-')));
  await mkdir(join(root, 'agent'));
  const runtime = resolve(process.env.DESKTOP_TEST_RUNTIME ?? 'runtime');
  const service = new CapabilityService({ root, runtime,
    node: join(runtime, 'node', process.platform === 'win32' ? 'node.exe' : 'node'),
    environment: () => isolatedEnvironment(root) });
  t.after(async () => {
    await service.stop();
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });
  assert.equal(await service.customBackgroundContext(), undefined);
  await service.mutate({ action: 'marketplace-add', source: resolve('../theme-marketplace') });
  const entry = (await service.catalog()).available.find(plugin => plugin.name === 'custom-background');
  assert.ok(entry?.package);
  assert.equal(entry.package.hostConfiguration, undefined, 'A market listing is not an installed adapter');
  assert.equal(entry.package.dataOnlyTheme, undefined);
  await assert.rejects(service.customBackgroundContext(entry.package.ref), /capability:stale/);
  await service.mutate({ action: 'plugin-install', name: entry.name, marketplace: entry.marketplace, ref: entry.package.ref },
    async policy => { assert.equal(policy.scope, 'runtime', 'Host background adapters do not bypass runtime gates'); });
  const catalog = await service.catalog(), plugin = catalog.plugins.find(item => item.id === 'custom-background');
  assert.ok(plugin?.package);
  assert.equal(plugin.name, '自定义背景');
  assert.equal(plugin.package.hostConfiguration, 'custom-background-v1');
  assert.equal(plugin.package.configurationAvailable, false);
  assert.equal(plugin.package.dataOnlyTheme, undefined);
  assert.deepEqual(plugin.mcpServers, []);
  assert.deepEqual(catalog.mcp.filter(server => server.pluginId === plugin.id), []);
  assert.deepEqual(catalog.skills.filter(skill => skill.pluginName === plugin.name), []);
  const installed = await service.customBackgroundContext(plugin.package.ref);
  assert.ok(installed);
  await service.mutate({ action: 'plugin-remove', id: plugin.id },
    async policy => { assert.equal(policy.scope, 'runtime'); });
  assert.equal(await service.customBackgroundContext(), undefined);
  await assert.rejects(service.customBackgroundContext(installed.ref), /capability:stale/);
  const available = (await service.catalog()).available.find(item => item.name === 'custom-background')!;
  await service.mutate({ action: 'plugin-install', name: available.name,
    marketplace: available.marketplace, ref: available.package!.ref });
  const reinstalled = await service.customBackgroundContext();
  assert.ok(reinstalled);
  assert.notEqual(reinstalled.instance, installed.instance, 'Reinstall has a new activation binding');
  await assert.rejects(service.customBackgroundContext(installed.ref), /capability:stale/);
});
