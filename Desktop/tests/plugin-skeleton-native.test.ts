import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { cp, copyFile, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { CapabilityService } from '../electron/capability-service';
import { SessionRuntimes } from '../electron/session-runtimes';
import { isolatedEnvironment } from '../electron/runtime';
import type { RuntimeEvent } from '../src/contracts';

async function fixture() {
  const folder = await realpath(await mkdtemp(join(tmpdir(), 'dfsc-skeleton-native-'))), root = join(folder, 'profile');
  await mkdir(join(root, 'agent'), { recursive: true });
  const runtime = join(folder, 'runtime'), cached = resolve(process.env.DESKTOP_TEST_RUNTIME ?? 'runtime');
  await mkdir(runtime);
  for (const name of ['step', 'node']) await symlink(join(cached, name), join(runtime, name), process.platform === 'win32' ? 'junction' : 'dir');
  for (const name of ['capability-admin.mjs', 'capability-settings.mjs', 'plugin-files.mjs'])
    await copyFile(resolve('electron', name), join(runtime, name));
  const service = new CapabilityService({ root, runtime, node: join(runtime, 'node', process.platform === 'win32' ? 'node.exe' : 'node'),
    environment: () => isolatedEnvironment(root) });
  const market = join(folder, 'market');
  await cp(resolve('../examples/plugins/config-starter'), market, { recursive: true });
  return { folder, root, runtime, service, market };
}
test('native installation preserves provenance and blocks two package names declaring the same runtime ID', { timeout: 90000 }, async () => {
  const { folder, service, market, root } = await fixture();
  try {
    await service.mutate({ action: 'marketplace-add', source: market });
    const installs = await Promise.allSettled(Array.from({ length: 2 }, () =>
      service.mutate({ action: 'plugin-install', name: 'dfsc-config-example', marketplace: 'dfsc-config-example-local' })));
    assert.equal(installs.filter(result => result.status === 'fulfilled').length, 1);
    assert.match(String(installs.find(result => result.status === 'rejected')!.reason), /already-exists/);
    let catalog = await service.catalog();
    const plugin = catalog.plugins[0], ref = plugin.package!.ref;
    assert.equal(plugin.package?.provenance, 'recorded');
    assert.equal(plugin.package?.configurationAvailable, true);
    assert.doesNotMatch(JSON.stringify(catalog), /packageDescriptor|installations\.json/);
    assert.match((await service.document({ ref, path: 'README.md' })).text, /DFSC Configuration Example/);
    const settings = await service.configuration({ ref });
    await service.configuration({ ref }, { ref, revision: settings.revision, values: settings.values, secrets: {} });
    const sourceName = catalog.marketplaces.find(source => source.kind !== 'builtin')!.name;
    await service.mutate({ action: 'marketplace-remove', name: sourceName });
    catalog = await service.catalog();
    assert.equal(catalog.plugins[0].package?.provenance, 'recorded');
    assert.equal(catalog.plugins[0].marketplace, 'dfsc-config-example-local');
    // Reusing the same marketplace folder must not claim an earlier installation.
    await service.mutate({ action: 'marketplace-add', source: market });
    catalog = await service.catalog();
    const replacement = catalog.available.find(item => item.name === 'dfsc-config-example')!;
    assert.equal(replacement.installed, false);
    assert.equal(replacement.blocked, true);
    assert.equal(catalog.plugins[0].package?.provenance, 'recorded');
    const other = join(folder, 'other');
    await cp(market, other, { recursive: true });
    await writeFile(join(other, '.step-plugin/marketplace.json'), JSON.stringify({ name: 'other-market',
      plugins: [{ name: 'different-folder', source: './plugins/dfsc-config-example' }] }));
    await service.mutate({ action: 'marketplace-add', source: other });
    await assert.rejects(service.mutate({ action: 'plugin-install', name: 'different-folder', marketplace: 'other-market' }), /already-exists/);
    await service.mutate({ action: 'plugin-remove', id: plugin.id });
    const binding = JSON.parse(await readFile(join(root, 'desktop-plugins/bindings/dfsc-config-example.json'), 'utf8'));
    assert.equal(binding.revoked, true);
    await assert.rejects(service.document({ ref, path: 'README.md' }), /stale/);
  } finally { await service.stop(); await rm(folder, { recursive: true, force: true, maxRetries: 5 }); }
});
test('raw marketplace duplicates and legacy installations remain unambiguous', { timeout: 90000 }, async () => {
  const { folder, service, market, root } = await fixture();
  try {
    const manifest = { name: 'duplicates', plugins: [
      { name: 'same-package', source: './plugins/dfsc-config-example' },
      { name: 'same-package', source: './plugins/dfsc-config-example' },
    ] };
    await writeFile(join(market, '.step-plugin/marketplace.json'), JSON.stringify(manifest));
    await service.mutate({ action: 'marketplace-add', source: market });
    let catalog = await service.catalog();
    assert.equal(catalog.available.find(item => item.name === 'same-package')?.blocked, true);
    await assert.rejects(service.mutate({ action: 'plugin-install', name: 'same-package', marketplace: 'duplicates' }), /plugin-conflict/);
    await mkdir(join(root, 'plugins'), { recursive: true });
    await cp(join(market, 'plugins/dfsc-config-example'), join(root, 'plugins/legacy'), { recursive: true });
    catalog = await service.catalog();
    const legacy = catalog.plugins.find(item => item.id === 'dfsc-config-example')!;
    assert.equal(legacy.package?.provenance, 'unknown');
    assert.equal(legacy.package?.configurationAvailable, false);
    await assert.rejects(service.configuration({ ref: legacy.package!.ref }), /invalid-configuration/);
    await cp(join(root, 'plugins/legacy'), join(root, 'plugins/duplicate'), { recursive: true });
    catalog = await service.catalog();
    assert.equal(catalog.plugins.find(item => item.id === legacy.id)?.package?.provenance, 'conflict');
    await assert.rejects(service.mutate({ action: 'plugin-remove', id: legacy.id }), /plugin-conflict/);
  } finally { await service.stop(); await rm(folder, { recursive: true, force: true, maxRetries: 5 }); }
});
test('native normalized IDs block a second installation and restrict existing conflicting copies', { timeout: 90000 }, async () => {
  const { folder, service, market, root } = await fixture();
  try {
    const source = join(market, 'plugins/dfsc-config-example'), manifestPath = join(source, 'step.plugin.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    await writeFile(manifestPath, JSON.stringify({ ...manifest, id: ' dfsc-config-example ' }));
    const other = join(market, 'plugins/other-folder');
    await cp(source, other, { recursive: true });
    await writeFile(join(other, 'step.plugin.json'), JSON.stringify(manifest));
    await writeFile(join(market, '.step-plugin/marketplace.json'), JSON.stringify({ name: 'normalized-ids', plugins: [
      { name: 'first-folder', source: './plugins/dfsc-config-example' },
      { name: 'other-folder', source: './plugins/other-folder' },
    ] }));
    await service.mutate({ action: 'marketplace-add', source: market });
    await service.mutate({ action: 'plugin-install', name: 'first-folder', marketplace: 'normalized-ids' });
    const before = await readFile(join(root, 'desktop-plugins/installations.json'));
    const candidate = (await service.catalog()).available.find(item => item.name === 'other-folder')!;
    await assert.rejects(service.mutate({ action: 'plugin-install', name: candidate.name,
      marketplace: candidate.marketplace, ref: candidate.package!.ref }), /already-exists/);
    assert.ok((await readFile(join(root, 'desktop-plugins/installations.json'))).equals(before));
    await assert.rejects(readFile(join(root, 'plugins/other-folder/step.plugin.json')), { code: 'ENOENT' });
    await cp(other, join(root, 'plugins/external-copy'), { recursive: true });
    const catalog = await service.catalog(), plugin = catalog.plugins[0];
    assert.equal(plugin.package?.provenance, 'conflict');
    assert.ok(catalog.warnings.some(warning => warning.includes('Conflicting installed plugin ID')));
    await assert.rejects(service.configuration({ ref: plugin.package!.ref }), /invalid-configuration/);
    await assert.rejects(service.mutate({ action: 'plugin-toggle', id: plugin.id, enabled: false }), /plugin-conflict/);
    await assert.rejects(service.mutate({ action: 'plugin-remove', id: plugin.id }), /plugin-conflict/);
    assert.ok((await readFile(join(root, 'desktop-plugins/installations.json'))).equals(before));
  } finally { await service.stop(); await rm(folder, { recursive: true, force: true, maxRetries: 5 }); }
});
test('rejected uninstall preserves configuration and successful uninstall revokes only the selected instance', { timeout: 90000 }, async () => {
  const { folder, service, market, root } = await fixture();
  try {
    const schemaPath = join(market, 'plugins/dfsc-config-example/dfsc.settings.json');
    const schema = JSON.parse(await readFile(schemaPath, 'utf8'));
    schema.groups[0].fields.push({ id: 'key', label: 'Key', type: 'secret' });
    await writeFile(schemaPath, JSON.stringify(schema));
    await service.mutate({ action: 'marketplace-add', source: market });
    await service.mutate({ action: 'plugin-install', name: 'dfsc-config-example', marketplace: 'dfsc-config-example-local' });
    const plugin = (await service.catalog()).plugins[0], ref = plugin.package!.ref;
    const initial = await service.configuration({ ref });
    const saved = await service.configuration({ ref }, { ref, revision: initial.revision,
      values: { ...initial.values, prefix: 'Preserved ' }, secrets: { key: { action: 'replace', value: 'fixture-private-key' } } });
    const receiptPath = join(root, 'desktop-plugins/installations.json');
    const bindingPath = join(root, 'desktop-plugins/bindings/dfsc-config-example.json');
    const receiptBytes = await readFile(receiptPath), bindingBytes = await readFile(bindingPath);
    const duplicate = join(root, 'plugins/duplicate');
    await cp(join(root, 'plugins/dfsc-config-example'), duplicate, { recursive: true });
    await assert.rejects(service.mutate({ action: 'plugin-remove', id: plugin.id }), /plugin-conflict/);
    assert.ok((await readFile(bindingPath)).equals(bindingBytes), 'preflight rejection must not revoke configuration');
    assert.ok((await readFile(receiptPath)).equals(receiptBytes));
    await rm(duplicate, { recursive: true });
    const restored = (await service.catalog()).plugins[0].package!.ref;
    const current = await service.configuration({ ref: restored });
    assert.equal(current.configured, true);
    assert.equal(current.revision, saved.revision);
    assert.equal(current.values.prefix, 'Preserved ');
    const kept = await service.configuration({ ref: restored }, { ref: restored, revision: current.revision,
      values: current.values, secrets: { key: { action: 'keep' } } });
    assert.equal(kept.hasSecret.key, true);
    const receipts = JSON.parse(receiptBytes.toString('utf8')), selected = receipts.installations[0];
    const other = { ...selected, folder: 'unpublished-copy', instance: '00000000-0000-4000-8000-000000000000', state: 'pending' };
    receipts.installations.push(other);
    await writeFile(receiptPath, JSON.stringify(receipts));
    const otherBinding = join(root, 'desktop-plugins/bindings/unpublished-copy.json');
    const otherBytes = JSON.stringify({ version: 1, instance: other.instance, id: other.id, revoked: false });
    await writeFile(otherBinding, otherBytes);
    await service.mutate({ action: 'plugin-remove', id: plugin.id });
    const revoked = JSON.parse(await readFile(bindingPath, 'utf8'));
    assert.equal(revoked.revoked, true);
    assert.equal(revoked.instance, selected.instance);
    assert.equal(revoked.id, selected.id);
    assert.equal(await readFile(otherBinding, 'utf8'), otherBytes);
    assert.deepEqual(JSON.parse(await readFile(receiptPath, 'utf8')).installations, [other]);
  } finally { await service.stop(); await rm(folder, { recursive: true, force: true, maxRetries: 5 }); }
});
test('native catalog reports interrupted installation and removal without granting a configuration identity', { timeout: 90000 }, async () => {
  const { folder, service, market, root } = await fixture();
  try {
    await service.mutate({ action: 'marketplace-add', source: market });
    await service.mutate({ action: 'plugin-install', name: 'dfsc-config-example', marketplace: 'dfsc-config-example-local' });
    const receiptPath = join(root, 'desktop-plugins/installations.json');
    const receipts = JSON.parse(await readFile(receiptPath, 'utf8'));
    for (const state of ['pending', 'removing']) {
      receipts.installations[0].state = state;
      await writeFile(receiptPath, JSON.stringify(receipts));
      const catalog = await service.catalog(), plugin = catalog.plugins[0];
      assert.ok(catalog.warnings.some(warning => warning.includes('Incomplete plugin operation')));
      assert.equal(plugin.package?.provenance, 'unknown');
      assert.equal(plugin.package?.configurationAvailable, false);
      await assert.rejects(service.configuration({ ref: plugin.package!.ref }), /invalid-configuration/);
      assert.equal(JSON.parse(await readFile(receiptPath, 'utf8')).installations[0].state, state);
    }
  } finally { await service.stop(); await rm(folder, { recursive: true, force: true, maxRetries: 5 }); }
});
test('real native runtime discovers and calls the configured MCP without inheriting account credentials', { timeout: 90000 }, async () => {
  const { folder, root, runtime, service, market } = await fixture();
  const events: RuntimeEvent[] = [];
  const pool = new SessionRuntimes(event => {
    events.push(event);
    if (event.type === 'extension_ui_request' && event.method === 'confirm') {
      const worker = pool.workers.get(event.runtimeId);
      if (worker) queueMicrotask(() => pool.respondToRequest(worker, { id: event.id, confirmed: true }));
    }
  });
  let calls = 0, providerError: unknown;
  const server = createServer(async (request, response) => {
    try {
      if (request.method === 'GET') { response.setHeader('Content-Type', 'application/json'); response.end('{"data":[]}'); return; }
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      const frame = (delta: unknown, finish_reason: string | null = null) => `data: ${JSON.stringify({
        id: 'local', object: 'chat.completion.chunk', model: 'local', created: 1, choices: [{ index: 0, delta, finish_reason }],
      })}\n\n`;
      if (calls++ === 0) {
        const tool = body.tools?.find((item: { function: { name: string } }) => item.function.name === 'dfsc-config-example__notes__format_note');
        assert.ok(tool, 'native runtime must expose the installed plugin tool');
        response.write(frame({ role: 'assistant', tool_calls: [{ index: 0, id: 'note-call', type: 'function',
          function: { name: tool.function.name, arguments: '{"text":"hello"}' } }] }));
        response.end(`${frame({}, 'tool_calls')}data: [DONE]\n\n`);
      } else {
        assert.match(JSON.stringify(body.messages), /QA HELLO/);
        response.end(`${frame({ role: 'assistant', content: 'Native configurable plugin verified.' })}${frame({}, 'stop')}data: [DONE]\n\n`);
      }
    } catch (error) { providerError = error; response.end(); }
  });
  try {
    const packageRoot = join(market, 'plugins/dfsc-config-example');
    const script = join(packageRoot, 'server/stdio.mjs');
    const original = await readFile(script, 'utf8');
    await writeFile(script, original.replace('clearInheritedCredentials();',
      `if (process.env.STEPFUN_API_KEY !== 'DFSC_INDEPENDENT_PLUGIN') throw new Error('Credential isolation failed');\nclearInheritedCredentials();`));
    const manifestPath = join(packageRoot, 'step.plugin.json'), manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    manifest.mcpServers.notes.command = process.execPath;
    await writeFile(manifestPath, JSON.stringify(manifest));
    await service.mutate({ action: 'marketplace-add', source: market });
    await service.mutate({ action: 'plugin-install', name: 'dfsc-config-example', marketplace: 'dfsc-config-example-local' });
    const plugin = (await service.catalog()).plugins[0], ref = plugin.package!.ref;
    const config = await service.configuration({ ref });
    await service.configuration({ ref }, { ref, revision: config.revision, values: { prefix: 'QA ', uppercase: true, limit: 100 }, secrets: {} });
    await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    const baseUrl = `http://127.0.0.1:${address.port}/v1`, models = join(root, 'local-models.json');
    await writeFile(join(root, 'auth.json'), JSON.stringify({ step: { type: 'api_key', key: 'fixture-account-must-not-inherit' } }));
    await writeFile(join(root, 'config.toml'), '[telemetry]\nenabled = false\n');
    await writeFile(models, JSON.stringify({ defaultProvider: 'fixture', defaultModel: 'local', providers: { fixture: {
      baseUrl, api: 'openai-completions', apiKey: 'local-fixture', models: [
        { id: 'local', name: 'Local fixture', input: ['text'], contextWindow: 32768, maxTokens: 1024 },
      ],
    } } }));
    const worker = await pool.open(join(runtime, 'node', process.platform === 'win32' ? 'node.exe' : 'node'),
      join(runtime, 'step/dist/bundle/step.js'), folder, { ...isolatedEnvironment(root),
        STEPCODE_CONFIG_PATH: models });
    await worker.rpc.request('prompt', { message: 'Use the local note formatter for hello.' });
    const deadline = Date.now() + 30000;
    while (!events.some(event => event.type === 'agent_end') && !providerError && Date.now() < deadline)
      await new Promise(done => setTimeout(done, 25));
    if (providerError) throw providerError;
    assert.match(JSON.stringify(await worker.rpc.request('get_messages')), /Native configurable plugin verified/);
    assert.equal(calls, 2);
    const summary = await worker.rpc.request('get_desktop_summary');
    assert.ok(summary.mcp.some((server: { name: string; status: string }) => server.name === 'dfsc-config-example__notes' && server.status === 'connected'));
    assert.doesNotMatch(JSON.stringify([events, summary]), /fixture-account-must-not-inherit/);
  } finally {
    await pool.stopAll(); await service.stop();
    server.closeAllConnections();
    if (server.listening) await new Promise<void>(done => server.close(() => done()));
    await rm(folder, { recursive: true, force: true, maxRetries: 5 });
  }
});
