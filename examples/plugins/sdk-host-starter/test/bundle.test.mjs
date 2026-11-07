import assert from 'node:assert/strict';
import test from 'node:test';
import { cp, mkdtemp, readFile, readdir, realpath, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import Ajv from 'ajv';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { HOST_ENV, parseHostDeclaration } from '../../host-client/protocol.mjs';
import { mockHost } from '../../host-client/testing.mjs';

const source = resolve('plugins/dfsc-host-example');
test('editor schema and runtime parser share every valid/invalid declaration fixture', async () => {
  const schema = JSON.parse(await readFile('../../../docs/plugin-schemas/dfsc.host.schema.json'));
  const validate = new Ajv({ strict: true }).compile(schema);
  const cases = JSON.parse(await readFile('../host-client/declaration-cases.json'));
  for (const item of cases) {
    assert.equal(validate(item.value), item.valid, item.name);
    const manifest = { mcpServers: { example: { command: 'node', args: ['dist/server.mjs'] } } };
    if (item.valid) assert.ok(parseHostDeclaration(item.value, manifest));
    else assert.throws(() => parseHostDeclaration(item.value, manifest));
  }
});
async function installed(t, env = {}) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'dfsc-sdk-install-')));
  let client;
  t.after(async () => {
    try { await client?.close(); }
    finally { await rm(root, { recursive: true, force: true, maxRetries: 5 }); }
  });
  const directory = join(root, 'plugins', 'example');
  await cp(source, directory, { recursive: true });
  assert.ok(!(await readdir(root)).includes('node_modules'));
  const transport = new StdioClientTransport({ command: process.execPath,
    args: [join(directory, 'dist/server.mjs')], cwd: root, stderr: 'pipe', env });
  let stderr = '';
  transport.stderr?.on('data', bytes => { stderr += bytes.toString(); });
  client = new Client({ name: 'dfsc-author-acceptance', version: '1.0.0' });
  await client.connect(transport);
  return { root, directory, client, stderr: () => stderr };
}
test('tracked release payload is bounded and includes official SDK/dependency licenses', async () => {
  const licenses = await readFile(join(source, 'dist/THIRD_PARTY_LICENSES.txt'), 'utf8');
  assert.match(licenses, /@modelcontextprotocol\/sdk@1\.27\.1/);
  assert.match(licenses, /zod@3\.25\.76/);
  const files = await readdir(source, { recursive: true });
  let total = 0, count = 0;
  for (const file of files) {
    assert.doesNotMatch(file, /node_modules|\.env$/);
    const info = await stat(join(source, file));
    if (info.isFile()) {
      count++;
      total += info.size;
      assert.ok(info.size <= 8 * 1024 * 1024, file);
    }
  }
  assert.ok(count <= 1000 && total <= 32 * 1024 * 1024);
});
test('fresh copied SDK bundle handshakes without node_modules, and an old host never gains account fallback', async t => {
  const { client, stderr } = await installed(t, { STEP_API_KEY: 'fixture-never-consumed',
    STEPFUN_API_KEY: 'fixture-never-consumed' });
  assert.deepEqual((await client.listTools()).tools.map(tool => tool.name).sort(), ['host_context', 'summarize_text']);
  const result = await client.callTool({ name: 'summarize_text', arguments: { text: 'offline example' } });
  assert.equal(result.isError, true);
  assert.equal(result.content[0].text, 'dfsc-host:HOST_UNAVAILABLE');
  assert.doesNotMatch(stderr(), /fixture-never-consumed/);
});
test('real SDK tool requests use the host fixture with no independent Key, require consent, and never call a provider', async t => {
  const broker = await mockHost(); t.after(() => broker.close());
  const launch = broker.launch();
  const { client, stderr } = await installed(t, { [HOST_ENV]: JSON.stringify(launch) });
  const context = await client.callTool({ name: 'host_context', arguments: {} });
  assert.equal(JSON.parse(context.content[0].text).capabilities[0].model, 'offline-fixture');
  const denied = await client.callTool({ name: 'summarize_text', arguments: { text: 'not sent to a provider' } });
  assert.equal(denied.isError, true);
  assert.equal(denied.content[0].text, 'dfsc-host:AUTHORIZATION_REQUIRED');
  broker.grant(launch);
  const granted = await client.callTool({ name: 'summarize_text', arguments: { text: 'offline example' } });
  assert.equal(granted.content[0].text, 'Offline fixture summary');
  broker.revoke(launch);
  const revoked = await client.callTool({ name: 'host_context', arguments: {} });
  assert.equal(revoked.content[0].text, 'dfsc-host:STALE_CONTEXT');
  assert.equal(broker.counts.provider, 0);
  assert.doesNotMatch(JSON.stringify([context, denied, granted, revoked, stderr()]), new RegExp(launch.broker.token));
});
test('standard client removes the launch secret before an ordinary native descendant is created', async t => {
  const broker = await mockHost(); t.after(() => broker.close());
  const launch = broker.launch();
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', `
    import { createHostClient } from ${JSON.stringify(new URL('../../host-client/client.mjs', import.meta.url).href)};
    import { spawnSync } from 'node:child_process';
    const client = createHostClient({ pluginId: 'dfsc-host-example', consumer: 'example' });
    const child = spawnSync(process.execPath, ['-e', 'console.log(Boolean(process.env.DFSC_LAUNCH_CONTEXT))'], { encoding: 'utf8' });
    process.stdout.write(child.stdout); client.close();
  `], { encoding: 'utf8', env: { [HOST_ENV]: JSON.stringify(launch) }, windowsHide: true, timeout: 10000 });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), 'false');
});
