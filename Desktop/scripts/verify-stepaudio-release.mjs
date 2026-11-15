import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { auditPluginRelease } from '../electron/plugin-release.mjs';
import { createCapabilitySettings } from '../electron/capability-settings.mjs';
import { PluginConfigurationStore } from '../electron/plugin-configuration.mjs';
import { stagePluginRelease } from './plugin-release.mjs';
import { mkdtemp, removeTestProfile } from './test-profile.mjs';

const options = Object.fromEntries(Array.from({ length: (process.argv.length - 2) / 2 },
  (_, index) => process.argv.slice(2 + index * 2, 4 + index * 2)));
assert.equal(process.argv.length, 8, 'Pass --source, --runtime and a new --output directory');
assert.deepEqual(Object.keys(options).sort(), ['--output', '--runtime', '--source']);
for (const value of Object.values(options)) assert.ok(isAbsolute(value));
const source = resolve(options['--source']), runtime = resolve(options['--runtime']);
const output = resolve(options['--output']);
await mkdir(output, { recursive: false });
const scratch = await mkdtemp(join(output, 'scratch-'));
let client, transport, server;
const report = { passed: false, noRealCredentials: true, externalModelRequests: 0, fixtureRequests: 0 };
const fixturePaths = [];
try {
  const root = join(scratch, 'profile'), market = join(scratch, 'market');
  await mkdir(join(market, 'plugins'), { recursive: true });
  await mkdir(join(market, '.step-plugin'));
  await mkdir(join(root, 'agent'), { recursive: true });
  const manifest = { schemaVersion: 1, files: [
    'step.plugin.json', 'dfsc.plugin.json', 'dfsc.settings.json', 'package.json',
    'dist', 'data', 'docs', 'README.md', 'CHANGELOG.md', 'LICENSE', 'UPSTREAM.md', 'icon.png',
    '.env.example', 'provider.example', 'scripts/configure.mjs', 'src/lib/env-file.js', 'src/lib/errors.js',
  ] };
  report.originalAudit = await auditPluginRelease(source);
  assert.equal(report.originalAudit.ok, false, 'This diagnostic must reproduce the development-directory problem');
  assert.ok(report.originalAudit.issues.some(item => item.code === 'release-runtime-dependency'));
  const release = join(market, 'plugins/dfsc-stepaudio');
  report.releaseAudit = await stagePluginRelease(source, release, { manifest });
  assert.equal(report.releaseAudit.ok, true);
  await writeFile(join(output, 'release-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  await writeFile(join(market, '.step-plugin/marketplace.json'), JSON.stringify({
    name: 'release-verification', plugins: [{ name: 'dfsc-stepaudio', source: 'plugins/dfsc-stepaudio' }],
  }));
  Object.assign(process.env, { HOME: root, USERPROFILE: root, STEPCODE_STORAGE_ROOT_DIR: root,
    STEP_CODING_AGENT_DIR: join(root, 'agent'), STEP_CODING_AGENT_SESSION_DIR: join(root, 'sessions'),
    STEPCODE_AUTH_PATH: join(root, 'auth.json') });
  const upstream = await import(pathToFileURL(join(runtime, 'step/dist/bundle/index.js')).href);
  const manager = createCapabilitySettings(upstream, { root });
  const signal = () => AbortSignal.timeout(30000);
  await manager.mutate({ action: 'marketplace-add', source: market }, signal());
  await manager.mutate({ action: 'plugin-install', name: 'dfsc-stepaudio', marketplace: 'release-verification' }, signal());
  const catalog = await manager.catalog();
  const plugin = catalog.plugins.find(item => item.id === 'dfsc-stepaudio');
  assert.equal(plugin?.packageDescriptor?.provenance, 'recorded');
  assert.ok(catalog.mcp.some(item => item.name === 'dfsc-stepaudio__stepaudio' && item.enabled));
  const installed = join(root, 'plugins/dfsc-stepaudio');
  report.installedAudit = await auditPluginRelease(installed);
  assert.equal(report.installedAudit.ok, true);
  assert.ok(!(await readdir(installed)).includes('node_modules'));
  server = createServer((request, response) => {
    report.fixtureRequests++;
    fixturePaths.push(request.url);
    response.writeHead(503, { 'content-type': 'application/json' });
    response.end('{"error":{"message":"Local fixture: use bundled catalog"}}');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const store = new PluginConfigurationStore(root), descriptor = { ...plugin.packageDescriptor, ref: 'release-fixture' };
  const initial = await store.read(descriptor);
  await store.save(descriptor, { ref: descriptor.ref, revision: initial.revision,
    values: { ...initial.values, mode: 'openapi', base_url: `http://127.0.0.1:${server.address().port}/v1`,
      output_dir: join(scratch, 'audio-output') },
    secrets: { api_key: { action: 'replace', value: 'release-fixture-not-a-real-key' } } });
  // The official SDK is a test-harness dependency only. The installed child has no dependency tree.
  const sdk = join(source, 'node_modules/@modelcontextprotocol/sdk/dist/esm');
  const { Client } = await import(pathToFileURL(join(sdk, 'client/index.js')).href);
  const { StdioClientTransport } = await import(pathToFileURL(join(sdk, 'client/stdio.js')).href);
  client = new Client({ name: 'dfsc-release-verification', version: '1.0.0' });
  transport = new StdioClientTransport({ command: join(runtime, 'node', process.platform === 'win32' ? 'node.exe' : 'node'),
    args: [join(installed, 'dist/index.js')], cwd: installed, stderr: 'pipe',
    env: { HOME: root, USERPROFILE: root, STEPCODE_STORAGE_ROOT_DIR: root,
      STEP_CODING_AGENT_DIR: join(root, 'agent'), TEMP: scratch, TMP: scratch,
      ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}) } });
  await client.connect(transport, { timeout: 15000 });
  const tools = await client.listTools({}, { timeout: 15000 });
  assert.deepEqual(tools.tools.map(item => item.name).sort(), ['clone_voice', 'list_voices', 'text_to_speech']);
  const voices = await client.callTool({ name: 'list_voices', arguments: { scope: 'official' } }, undefined, { timeout: 15000 });
  assert.notEqual(voices.isError, true);
  const voicesData = JSON.parse(voices.content[0].text);
  assert.equal(voicesData.official.source, 'local-catalog');
  assert.ok(voicesData.official.voices.length > 0);
  const invalid = await client.callTool({ name: 'text_to_speech', arguments: { text: '' } }, undefined, { timeout: 15000 });
  assert.equal(invalid.isError, true);
  assert.equal(report.fixtureRequests, 1, 'Invalid synthesis must not make a second API request');
  assert.match(fixturePaths[0], /^\/v1\/audio\/system_voices/u);
  report.tools = tools.tools.map(item => item.name).sort();
  report.localVoices = voicesData.official.voices.length;
  report.checks = ['read-only original audit', 'whitelist staging', 'native marketplace install',
    'installation receipt', 'managed synthetic configuration', 'official SDK stdio handshake',
    'tool listing', 'bundled voice catalog fallback', 'invalid synthesis without an API request'];
  await client.close();
  client = undefined;
  transport = undefined;
  await manager.mutate({ action: 'plugin-remove', id: 'dfsc-stepaudio' }, signal());
  assert.ok(!(await manager.catalog()).plugins.some(item => item.id === 'dfsc-stepaudio'));
  report.checks.push('native uninstall');
  report.passed = true;
} finally {
  try {
    await client?.close();
    await transport?.close();
    if (server) {
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
    }
    await removeTestProfile(scratch);
  } finally {
    await writeFile(join(output, 'verification.json'), `${JSON.stringify(report, null, 2)}\n`);
  }
}
assert.equal(report.passed, true);
console.log('Clean StepAudio release passed: native install, managed fixture, real MCP handshake, local catalog and uninstall.');
