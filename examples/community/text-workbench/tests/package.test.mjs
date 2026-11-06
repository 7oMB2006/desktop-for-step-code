import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, readdir, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve, join } from 'node:path';
import { DEFAULTS } from '../plugins/text-workbench/server/text.mjs';
import { startMcp } from './mcp-client.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const directory = join(root, 'plugins/text-workbench');
const json = async path => JSON.parse(await readFile(join(root, path), 'utf8'));

test('native market, presentation, settings and actual consumer agree without host exceptions', async () => {
  const market = await json('.step-plugin/marketplace.json');
  const native = await json('plugins/text-workbench/step.plugin.json');
  const presentation = await json('plugins/text-workbench/dfsc.plugin.json');
  const settings = await json('plugins/text-workbench/dfsc.settings.json');
  assert.equal(market.plugins[0].source, './plugins/text-workbench');
  assert.equal(market.plugins[0].name, native.id);
  assert.equal(native.mcpServers[settings.consumer.server].env.STEPFUN_API_KEY, 'DFSC_INDEPENDENT_PLUGIN');
  assert.deepEqual(native.mcpServers.text.args, ['server/stdio.mjs']);
  assert.equal(native.repository, undefined);
  assert.deepEqual(presentation.tutorials, []);
  assert.deepEqual(presentation.links, []);
  assert.deepEqual(presentation.categories, ['text-documents']);
  assert.deepEqual(presentation.keywords, ['plain text', 'text cleanup']);
  assert.equal(presentation.documentation.readme, 'docs/GUIDE.md');
  const defaults = Object.fromEntries(settings.groups.flatMap(group => group.fields).map(field => [field.id, field.default]));
  for (const field of settings.groups.flatMap(group => group.fields))
    assert.match(field.id, /^[a-z][a-z0-9_-]{0,47}$/u);
  assert.deepEqual(defaults, DEFAULTS);
  assert.equal(settings.consumer.kind, 'json-file-v1');
  assert.ok((await readFile(join(directory, 'commands/tidy-text.md'), 'utf8')).includes('$ARGUMENTS'));
  assert.ok((await stat(join(directory, 'skills/text-workbench/SKILL.md'))).isFile());
  assert.match(await readFile(join(directory, 'LICENSE'), 'utf8'), /MIT License/);
  assert.equal(createHash('sha256').update(await readFile(join(directory, 'server/configuration.mjs'))).digest('hex'),
    '0228969c84d2b7f8943b41e0b14522b1b20dc2d374ea06ab603cd339a2e65c79', 'Public starter reader remains unmodified');
});

test('local icon is bounded PNG and every documented relative resource exists inside the package', async () => {
  const icon = await readFile(join(directory, 'assets/icon.png'));
  assert.equal(icon.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  assert.equal(icon.readUInt32BE(16), 96);
  assert.ok(icon.length < 128 * 1024);
  for (const name of ['README.md', 'docs/GUIDE.md', 'docs/SETTINGS.md', 'CHANGELOG.md']) {
    const text = await readFile(join(directory, name), 'utf8');
    assert.doesNotMatch(text, /https?:\/\/|[A-Z]:\\/u, 'No made-up public links or machine paths in package docs');
    for (const match of text.matchAll(/\]\(([^)#]+)(?:#[^)]*)?\)/gu)) {
      const target = resolve(directory, name, '..', match[1]);
      assert.ok(target.startsWith(`${resolve(directory)}/`) || target.startsWith(`${resolve(directory)}\\`));
      assert.ok((await stat(target)).isFile());
    }
  }
});

test('local lock matches every shipped file and does not pretend to be a public Git commit', async () => {
  const lock = await json('source-lock.json');
  assert.equal(lock.gitCommit, null); assert.equal(lock.published, false);
  const paths = [];
  async function walk(path = '') {
    for (const entry of await readdir(join(directory, path), { withFileTypes: true })) {
      assert.equal(entry.isSymbolicLink(), false);
      const child = path ? `${path}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await walk(child); else paths.push(child);
    }
  }
  await walk();
  assert.deepEqual(lock.files.map(file => file.path).sort(), paths.sort());
  for (const item of lock.files) {
    const bytes = await readFile(join(directory, item.path));
    assert.equal(item.size, bytes.length);
    assert.equal(item.sha256, createHash('sha256').update(bytes).digest('hex'), item.path);
  }
});

test('the standalone process fails closed outside a trusted installed configuration', async () => {
  const client = startMcp(directory);
  try {
    const reply = await client.request('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
    assert.equal(reply.error.code, -32000);
    assert.doesNotMatch(JSON.stringify(reply), /[A-Z]:\\|DFSC_INDEPENDENT_PLUGIN/);
    assert.equal((await client.request('tools/list')).error.code, -32000);
    assert.equal(client.stderr(), '');
  } finally { await client.close(); }
});
