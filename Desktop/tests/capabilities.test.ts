import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile, symlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { CapabilityService } from '../electron/capability-service';
import { isolatedEnvironment } from '../electron/runtime';
import type { CapabilityMutation } from '../src/capabilities';

const runtime = resolve('runtime');
const iconPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jCj0AAAAASUVORK5CYII=', 'base64');
async function fixture(t: test.TestContext) {
  const folder = await mkdtemp(join(tmpdir(), 'desktop-capabilities-'));
  const root = join(folder, 'desktop');
  await mkdir(join(root, 'agent'), { recursive: true });
  const service = new CapabilityService({
    root, runtime, node: join(runtime, 'node', process.platform === 'win32' ? 'node.exe' : 'node'),
    environment: () => isolatedEnvironment(root),
  });
  t.after(async () => { await service.stop(); await rm(folder, { recursive: true, force: true }); });
  return { folder, root, service };
}
async function marketplace(folder: string, options: { id?: string; link?: boolean } = {}) {
  const source = join(folder, 'fixture-market');
  await mkdir(join(source, '.step-plugin'), { recursive: true });
  await mkdir(join(source, 'example', 'skills', 'review'), { recursive: true });
  await writeFile(join(source, '.step-plugin', 'marketplace.json'), JSON.stringify({
    name: 'fixture-community', plugins: [{ name: 'example', source: './example', description: 'Fixture tools' }],
  }));
  await writeFile(join(source, 'example', 'step.plugin.json'), JSON.stringify({
    id: options.id ?? 'example', name: 'Example plugin', version: '1.0.0',
    mcpServers: { tools: { command: 'fixture-never-run', env: { PRIVATE_KEY: 'fixture-private-value' } } },
    skills: ['skills'],
  }));
  await writeFile(join(source, 'example', 'skills', 'review', 'SKILL.md'),
    '---\nname: review\ndescription: Fixture review\n---\n\nNever execute this fixture.\n');
  return source;
}

test('capability catalog uses Desktop storage and materializes only the built-in market', async t => {
  const { root, service } = await fixture(t);
  const first = await service.catalog();
  assert.ok(first.marketplaces.some(source => source.kind === 'builtin'));
  assert.deepEqual(first.plugins, []);
  assert.ok(first.available.some(plugin => plugin.name === 'playwright'));
  assert.deepEqual(first.skills, []);
  assert.deepEqual(first.mcp, []);
  const second = await service.catalog();
  assert.deepEqual(second, first);
  assert.ok((await readFile(join(root, 'marketplaces', first.marketplaces[0].name, '.step-plugin/marketplace.json'), 'utf8')).length);
});

test('marketplace install, plugin resources, and uninstall follow upstream folder identity', async t => {
  const { folder, service, root } = await fixture(t);
  const source = await marketplace(folder, { id: 'manifest-id' });
  await service.mutate({ action: 'marketplace-add', source });
  let catalog = await service.catalog();
  const entry = catalog.available.find(plugin => plugin.name === 'example')!;
  assert.equal(entry.installed, false);
  await service.mutate({ action: 'plugin-install', name: entry.name, marketplace: entry.marketplace });
  catalog = await service.catalog();
  assert.equal(catalog.plugins[0].id, 'manifest-id');
  assert.equal(catalog.available.find(plugin => plugin.name === 'example')?.installed, true);
  assert.ok(catalog.mcp.some(server => server.name === 'manifest-id__tools' && server.source === 'plugin'));
  assert.ok(catalog.skills.some(skill => skill.name === 'review' && skill.source === 'plugin'
    && skill.pluginName === 'Example plugin' && !skill.toggleable && !skill.deletable));
  assert.doesNotMatch(JSON.stringify(catalog), /fixture-private-value/);
  await assert.rejects(service.mutate({ action: 'plugin-install', name: entry.name, marketplace: entry.marketplace }));
  await service.mutate({ action: 'plugin-remove', id: 'manifest-id' });
  assert.equal((await service.catalog()).plugins.length, 0);
  await assert.rejects(readFile(join(root, 'plugins', 'example', 'step.plugin.json')));
});

test('DFSC Beta PNG icons survive installation while invalid paths and files fall back', async t => {
  const { folder, service, root } = await fixture(t);
  const source = await marketplace(folder);
  const manifestPath = join(source, 'example', 'step.plugin.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  await writeFile(manifestPath, JSON.stringify({ ...manifest, icon: 'logo.png' }));
  await writeFile(join(source, 'example', 'logo.png'), iconPng);
  await service.mutate({ action: 'marketplace-add', source });
  const entry = (await service.catalog()).available.find(plugin => plugin.name === 'example')!;
  assert.deepEqual(entry.icon, { kind: 'png', dataUrl: `data:image/png;base64,${iconPng.toString('base64')}` });
  await service.mutate({ action: 'plugin-install', name: entry.name, marketplace: entry.marketplace });
  const directory = join(root, 'plugins', 'example');
  assert.deepEqual((await service.catalog()).plugins[0].icon, entry.icon);
  for (const icon of ['../logo.png', 'https://example.invalid/logo.png', 'C:\\private\\logo.png', 'logo.svg', 'missing.png']) {
    await writeFile(join(directory, 'step.plugin.json'), JSON.stringify({ ...manifest, icon }));
    assert.equal((await service.catalog()).plugins[0].icon, undefined, icon);
  }
  await writeFile(join(directory, 'step.plugin.json'), JSON.stringify({ ...manifest, icon: 'logo.png' }));
  for (const bytes of [Buffer.from('<svg/>'), Buffer.alloc(128 * 1024 + 1), (() => {
    const bytes = Buffer.from(iconPng); bytes.writeUInt32BE(513, 16); return bytes;
  })()]) {
    await writeFile(join(directory, 'logo.png'), bytes);
    assert.equal((await service.catalog()).plugins[0].icon, undefined);
  }
  const external = join(folder, 'external-images');
  await mkdir(external);
  await writeFile(join(external, 'logo.png'), iconPng);
  await symlink(external, join(directory, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
  await writeFile(join(directory, 'step.plugin.json'), JSON.stringify({ ...manifest, icon: 'linked/logo.png' }));
  assert.equal((await service.catalog()).plugins[0].icon, undefined);
});

test('built-in plugin placeholders use Step branding, not a third-party matching id', async t => {
  const { service, root } = await fixture(t);
  const entry = (await service.catalog()).available.find(plugin => plugin.name === 'playwright')!;
  assert.deepEqual(entry.icon, { kind: 'step' });
  await service.mutate({ action: 'plugin-install', name: entry.name, marketplace: entry.marketplace });
  assert.deepEqual((await service.catalog()).plugins[0].icon, { kind: 'step' });
  const path = join(root, 'plugins', 'playwright', 'step.plugin.json');
  const manifest = JSON.parse(await readFile(path, 'utf8'));
  await writeFile(path, JSON.stringify({ ...manifest, description: 'A different plugin using the same id' }));
  assert.equal((await service.catalog()).plugins[0].icon, undefined);
});

test('plugin MCP disable uses an override and enable removes only that override', async t => {
  const { folder, root, service } = await fixture(t);
  await service.mutate({ action: 'marketplace-add', source: await marketplace(folder) });
  const entry = (await service.catalog()).available.find(plugin => plugin.name === 'example')!;
  await service.mutate({ action: 'plugin-install', name: entry.name, marketplace: entry.marketplace });
  await service.mutate({ action: 'mcp-toggle', name: 'example__tools', enabled: false });
  assert.equal((await service.catalog()).mcp.find(server => server.name === 'example__tools')?.enabled, false);
  const disabled = await readFile(join(root, 'config.toml'), 'utf8');
  assert.match(disabled, /enabled = false/);
  await service.mutate({ action: 'mcp-toggle', name: 'example__tools', enabled: true });
  assert.equal((await service.catalog()).mcp.find(server => server.name === 'example__tools')?.enabled, true);
  assert.doesNotMatch(await readFile(join(root, 'config.toml'), 'utf8'), /example__tools/);
});

test('MCP toggle preserves credentials, allowlists, headers, and timeouts', async t => {
  const { root, service } = await fixture(t);
  await writeFile(join(root, 'config.toml'), `
[mcp_servers.custom]
url = "https://example.invalid/mcp"
enabled_tools = []
tool_timeout_sec = 42
[mcp_servers.custom.http_headers]
Authorization = "fixture-secret-header"
`);
  await service.mutate({ action: 'mcp-toggle', name: 'custom', enabled: false });
  await service.mutate({ action: 'mcp-toggle', name: 'custom', enabled: true });
  const saved = await readFile(join(root, 'config.toml'), 'utf8');
  assert.match(saved, /fixture-secret-header/);
  assert.match(saved, /enabled_tools = \[\]/);
  assert.match(saved, /tool_timeout_sec = 42/);
  assert.doesNotMatch(JSON.stringify(await service.catalog()), /fixture-secret-header/);
});

test('skills can be created, switched using upstream settings rules, and deleted', async t => {
  const { root, service } = await fixture(t);
  await service.mutate({ action: 'skill-create', name: 'local-review', description: 'Use for "reviews": safely',
    instructions: 'Review the task.' });
  const skill = (await service.catalog()).skills.find(item => item.name === 'local-review')!;
  assert.ok(skill.enabled && skill.toggleable && skill.deletable);
  assert.match(skill.id, /^[a-f0-9]{64}$/);
  assert.doesNotMatch(skill.id, /SKILL.md/);
  await service.mutate({ action: 'skill-toggle', id: skill.id, enabled: false });
  assert.equal((await service.catalog()).skills.find(item => item.id === skill.id)?.enabled, false);
  await service.mutate({ action: 'skill-toggle', id: skill.id, enabled: true });
  assert.equal((await service.catalog()).skills.find(item => item.id === skill.id)?.enabled, true);
  await service.mutate({ action: 'skill-remove', id: skill.id });
  assert.equal((await service.catalog()).skills.length, 0);
  await assert.rejects(readFile(join(root, 'agent', 'skills', 'local-review', 'SKILL.md')));
});

test('skill import copies its resources without touching its source and rejects duplicates', async t => {
  const { folder, root, service } = await fixture(t);
  const source = join(folder, 'import-me');
  await mkdir(join(source, 'references'), { recursive: true });
  await writeFile(join(source, 'SKILL.md'), '---\nname: imported\ndescription: Import fixture\n---\nUse references.');
  await writeFile(join(source, 'references', 'note.md'), 'Fixture reference.');
  await service.importSkill(source);
  assert.equal((await service.catalog()).skills.find(skill => skill.name === 'imported')?.deletable, true);
  assert.equal(await readFile(join(root, 'agent/skills/imported/references/note.md'), 'utf8'), 'Fixture reference.');
  await assert.rejects(service.importSkill(source), /already-exists/);
  assert.match(await readFile(join(source, 'SKILL.md'), 'utf8'), /Import fixture/);
});

test('remove marketplace leaves installed plugins intact and builtin sources are read-only', async t => {
  const { folder, service } = await fixture(t);
  await service.mutate({ action: 'marketplace-add', source: await marketplace(folder) });
  const catalog = await service.catalog();
  const entry = catalog.available.find(plugin => plugin.name === 'example')!;
  await service.mutate({ action: 'plugin-install', name: entry.name, marketplace: entry.marketplace });
  const source = catalog.marketplaces.find(item => item.kind === 'local')!;
  await service.mutate({ action: 'marketplace-remove', name: source.name });
  assert.equal((await service.catalog()).plugins.length, 1);
  const builtin = catalog.marketplaces.find(item => item.kind === 'builtin')!;
  for (const action of ['marketplace-remove', 'marketplace-update'] as const)
    await assert.rejects(service.mutate({ action, name: builtin.name }), /read-only/);
});

test('a Git marketplace clones and updates through upstream without changing installed plugin files', async t => {
  const { folder, service, root } = await fixture(t);
  const source = await marketplace(folder);
  const git = (...args: string[]) => execFileSync('git', args, { cwd: source, encoding: 'utf8', stdio: 'pipe' });
  git('init', '--quiet');
  git('add', '--', '.');
  const commit = () => git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid',
    '-c', 'commit.gpgsign=false', 'commit', '--quiet', '-am', 'Fixture market');
  commit();
  await service.mutate({ action: 'marketplace-add', source: pathToFileURL(source).href });
  const before = await service.catalog();
  const market = before.marketplaces.find(item => item.kind === 'git')!;
  assert.ok(market);
  const entry = before.available.find(item => item.name === 'example')!;
  await service.mutate({ action: 'plugin-install', name: entry.name, marketplace: entry.marketplace });
  const manifest = join(source, '.step-plugin', 'marketplace.json');
  const data = JSON.parse(await readFile(manifest, 'utf8'));
  data.plugins[0].description = 'Updated marketplace description';
  await writeFile(manifest, JSON.stringify(data));
  commit();
  await service.mutate({ action: 'marketplace-update', name: market.name });
  const after = await service.catalog();
  assert.equal(after.available.find(item => item.name === 'example')?.description, 'Updated marketplace description');
  assert.equal(after.plugins[0].version, '1.0.0');
  assert.match(await readFile(join(root, 'plugins', 'example', 'step.plugin.json'), 'utf8'), /fixture-private-value/);
  assert.doesNotMatch(JSON.stringify(after), /fixture-private-value/);
});

test('invalid actions, path traversal, invalid booleans, and credential URLs are rejected', async t => {
  const { service } = await fixture(t);
  for (const input of [
    { action: 'plugin-remove', id: '../../outside' },
    { action: 'plugin-install', name: '..', marketplace: 'fixture' },
    { action: 'skill-create', name: '../outside', description: 'x', instructions: 'x' },
    { action: 'mcp-toggle', name: 'missing', enabled: 'false' },
    { action: 'marketplace-add', source: 'https://user:password@example.invalid/private.git' },
    { action: 'marketplace-add', source: 'https://example.invalid/private.git?token=secret' },
    { action: 'unknown' },
  ]) await assert.rejects(service.mutate(input as CapabilityMutation), /capability:/);
});

test('management refuses symbolic links and never deletes a linked external skill', async t => {
  const { folder, root, service } = await fixture(t);
  const outside = join(folder, 'outside');
  await mkdir(outside);
  await writeFile(join(outside, 'SKILL.md'), '---\nname: external\ndescription: External fixture\n---\nKeep.');
  await mkdir(join(root, 'agent', 'skills'), { recursive: true });
  await symlink(outside, join(root, 'agent', 'skills', 'external'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(service.catalog(), /invalid-path/);
  assert.match(await readFile(join(outside, 'SKILL.md'), 'utf8'), /Keep/);
});
