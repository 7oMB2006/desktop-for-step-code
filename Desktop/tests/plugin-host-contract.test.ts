import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, writeFile, readFile, realpath, rm, readdir, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { PluginHostBindingStore, parseHostDeclaration } from '../electron/plugin-host-contract.mjs';
import { PluginConfigurationStore } from '../electron/plugin-configuration.mjs';
import { createHostClient, newRequestId } from '../../examples/plugins/host-client/client.mjs';
import { HOST_ENV, LIMITS, parseInvoke, parseLaunch, parseResult, takeLaunchContext } from '../../examples/plugins/host-client/protocol.mjs';
import { mockHost } from '../../examples/plugins/host-client/testing.mjs';

const { installationReceipt, packageFingerprint, writeReceipts } =
  await import(new URL('../electron/plugin-files.mjs', import.meta.url).href);
const declaration = { schemaVersion: 1, hostApiVersion: 1,
  consumer: { kind: 'mcp-stdio', server: 'example' }, capabilities: ['model.text'] };
const manifest = { id: 'dfsc-host-example', mcpServers: {
  example: { command: 'node', args: ['dist/server.mjs'], env: { STEPFUN_API_KEY: 'DFSC_INDEPENDENT_PLUGIN' } },
} };
const identity = { pluginId: manifest.id, consumer: 'example' };
const invocation = (revision: string) => ({ requestId: newRequestId(), revision,
  capability: 'model.text' as const, input: { messages: [{ role: 'user' as const, content: 'offline fixture' }] } });
async function fixture(t: test.TestContext, settings = false, host = declaration) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'dfsc-host-contract-')));
  t.after(() => rm(root, { recursive: true, force: true, maxRetries: 5 }));
  const directory = join(root, 'plugins', 'example');
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, 'step.plugin.json'), JSON.stringify(manifest));
  await writeFile(join(directory, 'dfsc.host.json'), JSON.stringify(host));
  if (settings) await writeFile(join(directory, 'dfsc.settings.json'), JSON.stringify({
    schemaVersion: 1, consumer: { kind: 'json-file-v1', server: 'example' },
    groups: [{ id: 'connection', title: 'Connection', fields: [
      { id: 'key', label: 'Independent key', type: 'secret', required: true },
    ] }],
  }));
  const fingerprint = await packageFingerprint(directory);
  const receipt = installationReceipt({ name: 'example' }, { name: 'fixture', kind: 'local', path: root }, manifest, fingerprint);
  receipt.state = 'installed';
  await writeReceipts(root, { version: 1, installations: [receipt] });
  const descriptor = { root: directory, kind: 'installed', name: 'example', id: receipt.id,
    fingerprint, instance: receipt.instance, provenance: 'recorded', ref: 'fixture' };
  return { root, directory, receipt, descriptor, store: new PluginHostBindingStore(root) };
}
test('host schema fixtures and native consumer binding reject self-authorized and ambiguous declarations', async () => {
  const cases = JSON.parse(await readFile(resolve('../examples/plugins/host-client/declaration-cases.json'), 'utf8'));
  for (const item of cases) {
    if (item.valid) assert.equal(parseHostDeclaration(item.value, manifest).hostApiVersion, 1);
    else assert.throws(() => parseHostDeclaration(item.value, manifest), /dfsc-host:/, item.name);
  }
  for (const mcpServers of [
    'mcp.json', { example: { url: 'https://example.invalid/mcp' } },
    { other: { command: 'node' } }, { example: { command: 'node', env: { DFSC_LAUNCH_CONTEXT: '{}' } } },
    { example: { command: 'node', env: { dfsc_host_token: 'author-controlled' } } },
  ]) assert.throws(() => parseHostDeclaration(declaration, { mcpServers }));
});
test('a host-only consumer follows without any independent configuration and writes only outside its package', async t => {
  const { root, directory, descriptor, store } = await fixture(t);
  const broker = await mockHost(); t.after(() => broker.close());
  assert.equal((await store.current(descriptor)).revision, 'unconfigured');
  const selection = await store.select(descriptor, { revision: 'unconfigured', mode: 'follow' });
  await assert.rejects(store.select(descriptor, { revision: selection.revision,
    mode: 'follow', models: { 'model.asr': 'not-declared' } }));
  const wire = broker.launch();
  const launch = await store.launch(descriptor, wire);
  assert.equal(launch.revision, selection.revision);
  assert.equal(launch.configurationRevision, null);
  assert.equal(launch.dataDirectory, join(root, 'desktop-plugins/data', descriptor.instance));
  assert.equal(await packageFingerprint(directory), descriptor.fingerprint);
  const environment = { [HOST_ENV]: JSON.stringify(launch) };
  const client = createHostClient({ ...identity, environment });
  t.after(() => client.close());
  assert.equal(Object.keys(environment).length, 0);
  const context = await client.context();
  await assert.rejects(client.invoke(invocation(context.revision)), /AUTHORIZATION_REQUIRED/);
  assert.equal(broker.counts.provider, 0);
  assert.deepEqual((await readdir(directory)).sort(), ['dfsc.host.json', 'step.plugin.json']);
});
test('dedicated speech model selections create new revisions without permitting a stored chat-model override', async t => {
  const { root, directory, descriptor, receipt } = await fixture(t);
  await writeFile(join(directory, 'dfsc.host.json'), JSON.stringify({ ...declaration,
    capabilities: ['model.text', 'model.asr', 'model.tts'] }));
  const fingerprint = await packageFingerprint(directory);
  await writeReceipts(root, { version: 1, installations: [{ ...receipt, fingerprint }] });
  const current = { ...descriptor, fingerprint };
  const store = new PluginHostBindingStore(root);
  const first = await store.select(current, { revision: 'unconfigured', mode: 'follow',
    models: { 'model.asr': 'fixture-asr', 'model.tts': 'fixture-tts' } });
  const changed = await store.select(current, { revision: first.revision, mode: 'follow',
    models: { 'model.asr': 'fixture-asr-v2', 'model.tts': 'fixture-tts' } });
  assert.notEqual(changed.revision, first.revision);
  assert.equal(changed.models['model.asr'], 'fixture-asr-v2');
  await assert.rejects(store.select(current, { revision: changed.revision, mode: 'follow',
    models: { 'model.text': 'forged-chat-model' } } as never));
});
test('mode commits require a valid independent revision; failed and concurrent switches preserve the winner', async t => {
  const { root, descriptor, store } = await fixture(t, true);
  const saved = await store.select(descriptor, { revision: 'unconfigured', mode: 'follow' });
  const path = join(root, 'desktop-plugins/host/bindings', `${descriptor.instance}.json`);
  const original = await readFile(path);
  await assert.rejects(store.select(descriptor, { revision: saved.revision, mode: 'independent' }));
  assert.deepEqual(await readFile(path), original);
  const configuration = new PluginConfigurationStore(root);
  const configured = await configuration.save(descriptor, { ref: descriptor.ref, revision: 'unconfigured', values: {},
    secrets: { key: { action: 'replace', value: 'fixture-independent-key' } } });
  const independent = await store.select(descriptor, { revision: saved.revision,
    mode: 'independent', configurationRevision: configured.revision });
  assert.equal(independent.configurationRevision, configured.revision);
  const broker = await mockHost(); t.after(() => broker.close());
  const launch = await store.launch(descriptor, broker.launch());
  assert.equal(launch.broker, undefined);
  assert.doesNotMatch(JSON.stringify(launch), /fixture-independent-key/);
  const transitions = await Promise.allSettled([
    store.select(descriptor, { revision: independent.revision, mode: 'follow' }),
    store.select(descriptor, { revision: independent.revision, mode: 'follow' }),
  ]);
  assert.equal(transitions.filter(item => item.status === 'fulfilled').length, 1);
  assert.equal(transitions.filter(item => item.status === 'rejected').length, 1);
});
test('orphan snapshots do not commit a mode, and corruption, unknown sources and changed packages fail closed', async t => {
  const { root, directory, descriptor, store } = await fixture(t);
  const first = await store.select(descriptor, { revision: 'unconfigured', mode: 'follow' });
  const snapshot = join(root, 'desktop-plugins/host/selections', descriptor.instance);
  await writeFile(join(snapshot, `${'f'.repeat(64)}.json`), '{"mode":"independent"}');
  assert.equal((await store.current(descriptor)).revision, first.revision);
  const path = join(root, 'desktop-plugins/host/bindings', `${descriptor.instance}.json`);
  const bytes = await readFile(path);
  await writeFile(path, '{');
  await assert.rejects(store.current(descriptor));
  await writeFile(path, bytes);
  await assert.rejects(store.current({ ...descriptor, provenance: 'unknown' }));
  await writeFile(join(directory, 'changed.txt'), 'changed');
  await assert.rejects(store.current(descriptor));
});
for (const changedDeclaration of [false, true]) test(`updated packages require explicit source reselection (declaration changed: ${changedDeclaration})`, async t => {
  const { root, directory, descriptor, receipt, store } = await fixture(t, false, {
    ...declaration, capabilities: ['model.text', 'model.asr'],
  });
  const first = await store.select(descriptor, { revision: 'unconfigured', mode: 'follow',
    models: { 'model.asr': 'old-asr' } });
  const pointerPath = join(root, 'desktop-plugins/host/bindings', `${descriptor.instance}.json`);
  const snapshotPath = join(root, 'desktop-plugins/host/selections', descriptor.instance, `${first.revision}.json`);
  const pointer = await readFile(pointerPath), snapshot = await readFile(snapshotPath);
  await writeFile(join(directory, 'updated.txt'), 'new package');
  if (changedDeclaration) await writeFile(join(directory, 'dfsc.host.json'), JSON.stringify({
    ...declaration, capabilities: ['model.text'],
  }));
  const fingerprint = await packageFingerprint(directory), next = { ...descriptor, fingerprint };
  await writeReceipts(root, { version: 1, installations: [{ ...receipt, fingerprint }] });
  const reset = await store.current(next);
  assert.equal(reset.revision, 'unconfigured');
  assert.equal('mode' in reset, false);
  assert.equal('models' in reset, false);
  assert.deepEqual(await readFile(pointerPath), pointer);
  assert.deepEqual(await readFile(snapshotPath), snapshot);
  const broker = await mockHost(); t.after(() => broker.close());
  await assert.rejects(store.launch(descriptor, broker.launch()), /stale/);
  await assert.rejects(store.launch(next, broker.launch()), /invalid-configuration/);
  await assert.rejects(store.select(next, { revision: first.revision, mode: 'follow' }), /stale-configuration/);
  const selected = await store.select(next, { revision: 'unconfigured', mode: 'follow' });
  assert.notEqual(selected.revision, first.revision);
  assert.equal((await store.launch(next, broker.launch())).revision, selected.revision);
  assert.deepEqual(await readFile(snapshotPath), snapshot, 'Explicit reselection does not erase history');
});
test('older-package selections must still have a valid identity and structure before being reset', async t => {
  const { root, directory, descriptor, receipt, store } = await fixture(t);
  const selected = await store.select(descriptor, { revision: 'unconfigured', mode: 'follow' });
  const pointerPath = join(root, 'desktop-plugins/host/bindings', `${descriptor.instance}.json`);
  const snapshotPath = join(root, 'desktop-plugins/host/selections', descriptor.instance, `${selected.revision}.json`);
  const pointer = JSON.parse(await readFile(pointerPath, 'utf8'));
  const snapshot = JSON.parse(await readFile(snapshotPath, 'utf8'));
  await writeFile(join(directory, 'updated.txt'), 'new package');
  const fingerprint = await packageFingerprint(directory), next = { ...descriptor, fingerprint };
  await writeReceipts(root, { version: 1, installations: [{ ...receipt, fingerprint }] });
  for (const changed of [
    { instance: randomUUID() }, { pluginId: 'foreign-plugin' }, { fingerprint: 'not-a-hash' },
    { declarationHash: 'not-a-hash' }, { consumer: '../foreign' }, { revision: 'f'.repeat(64) },
    { mode: 'unknown' }, { mode: 'follow', configurationRevision: 'f'.repeat(64) },
    { mode: 'independent', configurationRevision: null }, { authorized: true },
    { models: { 'model.text': 'not-allowed' } }, { models: { 'model.asr': '\0' } },
    { mode: 'independent', configurationRevision: 'f'.repeat(64), models: { 'model.asr': 'fixture' } },
  ]) {
    const bytes = JSON.stringify({ ...snapshot, ...changed });
    await writeFile(snapshotPath, bytes);
    await writeFile(pointerPath, JSON.stringify({ ...pointer,
      contentHash: createHash('sha256').update(bytes).digest('hex') }));
    await assert.rejects(store.current(next), Error, JSON.stringify(changed));
  }
});
test('changed independent settings stop launches, but never prevent explicit recovery to follow mode', async t => {
  const { descriptor, store } = await fixture(t, true);
  const configuration = new PluginConfigurationStore(resolve(descriptor.root, '../..'));
  const first = await configuration.save(descriptor, { ref: descriptor.ref, revision: 'unconfigured', values: {},
    secrets: { key: { action: 'replace', value: 'first-independent-key' } } });
  const selected = await store.select(descriptor, { revision: 'unconfigured',
    mode: 'independent', configurationRevision: first.revision });
  await configuration.save(descriptor, { ref: descriptor.ref, revision: first.revision, values: {},
    secrets: { key: { action: 'replace', value: 'second-independent-key' } } });
  const broker = await mockHost(); t.after(() => broker.close());
  await assert.rejects(store.launch(descriptor, broker.launch()), /stale-configuration/);
  const following = await store.select(descriptor, { revision: selected.revision, mode: 'follow' });
  assert.equal(following.mode, 'follow');
  assert.equal((await store.launch(descriptor, broker.launch())).mode, 'follow');
});
test('stored pointers and hashed snapshots reject unexpected fields and invalid configuration references', async t => {
  const { root, descriptor, store } = await fixture(t);
  const selected = await store.select(descriptor, { revision: 'unconfigured', mode: 'follow' });
  const pointerPath = join(root, 'desktop-plugins/host/bindings', `${descriptor.instance}.json`);
  const snapshotPath = join(root, 'desktop-plugins/host/selections', descriptor.instance, `${selected.revision}.json`);
  const pointer = JSON.parse(await readFile(pointerPath, 'utf8'));
  const snapshot = JSON.parse(await readFile(snapshotPath, 'utf8'));
  await writeFile(pointerPath, JSON.stringify({ ...pointer, authorized: true }));
  await assert.rejects(store.current(descriptor), /stale/);
  for (const changed of [
    { declaration: { consumer: { server: 'foreign' }, capabilities: ['model.tts'] } },
    { receipt: { instance: randomUUID() } },
    { configurationCurrent: true },
    { mode: 'independent', configurationRevision: null },
    { mode: 'independent', configurationRevision: 'not-a-revision' },
  ]) {
    const bytes = JSON.stringify({ ...snapshot, ...changed });
    await writeFile(snapshotPath, bytes);
    await writeFile(pointerPath, JSON.stringify({ ...pointer,
      contentHash: createHash('sha256').update(bytes).digest('hex') }));
    await assert.rejects(store.current(descriptor), /stale/);
  }
});
test('launch refuses redirected data storage and uninstall, without granting a new installation old bindings', async t => {
  const { root, descriptor, store, receipt } = await fixture(t);
  await store.select(descriptor, { revision: 'unconfigured', mode: 'follow' });
  const broker = await mockHost(); t.after(() => broker.close());
  const outside = join(root, 'outside');
  await mkdir(outside);
  await writeFile(join(outside, 'marker'), 'retained');
  await mkdir(join(root, 'desktop-plugins/data'));
  const link = join(root, 'desktop-plugins/data', descriptor.instance);
  await symlink(outside, link, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(store.launch(descriptor, broker.launch()));
  assert.deepEqual(await readdir(outside), ['marker']);
  await rm(link, { recursive: true, force: true });
  await writeReceipts(root, { version: 1, installations: [{ ...receipt, state: 'removing' }] });
  await assert.rejects(store.current(descriptor));
  const instance = randomUUID();
  await writeReceipts(root, { version: 1, installations: [{ ...receipt, instance }] });
  assert.equal((await store.current({ ...descriptor, instance })).revision, 'unconfigured');
});
test('client consumes even invalid launch secrets and rejects unsupported, expired, foreign and remote contexts', async t => {
  const broker = await mockHost(); t.after(() => broker.close());
  const launch = broker.launch();
  for (const changed of [
    { version: 'dfsc-launch-v2' }, { pluginId: 'another-plugin' }, { consumer: 'other' },
    { broker: { ...launch.broker, origin: 'https://example.invalid' } },
    { broker: { ...launch.broker, expiresAt: Date.now() - 1 } },
    { broker: { ...launch.broker, expiresAt: Date.now() + LIMITS.lease + 10000 } },
    { broker: { ...launch.broker, origin: `${launch.broker.origin}/redirect` } },
    { authorized: true },
  ]) {
    const environment = { [HOST_ENV]: JSON.stringify({ ...launch, ...changed }) };
    assert.throws(() => takeLaunchContext(environment, identity));
    assert.equal(environment[HOST_ENV], undefined);
  }
  const environment = { [HOST_ENV]: '{' };
  assert.throws(() => takeLaunchContext(environment, identity));
  assert.equal(environment[HOST_ENV], undefined);
  assert.throws(() => parseLaunch({ ...launch, mode: 'independent', configurationRevision: 'a'.repeat(64) }, identity));
});
test('client never retries authorization, stale context or revocation and keeps leases and cancellation separate', async t => {
  const broker = await mockHost(); t.after(() => broker.close());
  const a = broker.launch(), b = broker.launch({ instance: randomUUID() });
  const client = createHostClient({ ...identity, environment: { [HOST_ENV]: JSON.stringify(a) } });
  const other = createHostClient({ ...identity, environment: { [HOST_ENV]: JSON.stringify(b) } });
  t.after(() => { client.close(); other.close(); });
  const context = await client.context();
  const request = invocation(context.revision);
  await assert.rejects(client.invoke(request), /AUTHORIZATION_REQUIRED/);
  assert.equal(broker.counts.invoke, 1);
  broker.grant(a);
  assert.equal((await client.invoke(request)).text, 'Offline fixture summary');
  assert.equal(await other.cancel(request.requestId), false);
  assert.equal(await client.cancel(request.requestId), true);
  broker.changeRevision(a);
  await assert.rejects(client.invoke(invocation(context.revision)), /STALE_CONTEXT/);
  broker.revoke(a);
  await assert.rejects(client.context(), /STALE_CONTEXT/);
  assert.ok(await other.context());
  assert.doesNotMatch(JSON.stringify(client), new RegExp(a.broker.token));
});
test('client bounds and normalizes malformed and credential-bearing replies without exposing response bodies', async t => {
  const broker = await mockHost(); t.after(() => broker.close());
  const launch = broker.launch();
  for (const response of [
    async () => new Response('secret-provider-body', { status: 500, headers: { 'content-type': 'text/plain' } }),
    async () => Response.json({ version: 1, error: { code: 'DENIED', key: 'secret-provider-body' } }, { status: 403 }),
    async () => Response.json({ version: 1, revision: 'a'.repeat(64), capabilities: [], token: 'secret-provider-body' }),
    async () => new Response('{}', { headers: { 'content-type': 'application/json', 'content-length': String(LIMITS.launch + 1) } }),
  ]) {
    const client = createHostClient({ ...identity, environment: { [HOST_ENV]: JSON.stringify(launch) }, fetch: response });
    await assert.rejects(client.context(), error => error instanceof Error && !error.message.includes('secret-provider-body'));
    client.close();
  }
});
test('media contracts reject URL fetches, output paths, malformed base64 and mismatched audio formats', () => {
  const value = { requestId: newRequestId(), revision: 'a'.repeat(64), capability: 'model.tts' as const,
    input: { text: 'offline', voice: 'fixture', format: 'wav' as const } };
  assert.ok(parseInvoke(value));
  for (const input of [
    { ...value.input, outputPath: 'C:/private.wav' }, { ...value.input, url: 'https://example.invalid/audio' },
  ]) assert.throws(() => parseInvoke({ ...value, input }));
  const audio = { version: 1, requestId: value.requestId,
    result: { type: 'audio', mimeType: 'audio/wav', data: Buffer.from('fixture').toString('base64') } };
  assert.equal(parseResult(audio, value).type, 'audio');
  for (const result of [
    { type: 'audio', url: 'https://example.invalid/audio' },
    { ...audio.result, mimeType: 'audio/mpeg' }, { ...audio.result, data: 'invalid!' },
  ]) assert.throws(() => parseResult({ ...audio, result }, value));
});
test('media contracts accept multi-megabyte payloads without overflowing the validation stack', () => {
  const value = { requestId: newRequestId(), revision: 'a'.repeat(64) };
  for (const size of [4 * 1024 * 1024, 4 * 1024 * 1024 + 1, 4 * 1024 * 1024 + 2, 23 * 1024 * 1024]) {
    const data = Buffer.alloc(size, 0xa5).toString('base64');
    const video = { ...value, capability: 'model.video' as const, input: {
      messages: [{ role: 'user' as const, content: 'inspect' }], video: { mimeType: 'video/mp4', data },
    } };
    assert.deepEqual(parseInvoke(video), video);
    const audio = { ...value, capability: 'model.asr' as const, input: { audio: { mimeType: 'audio/wav', data } } };
    assert.deepEqual(parseInvoke(audio), audio);
    const speech = { ...value, capability: 'model.tts' as const,
      input: { text: 'fixture', voice: 'fixture', format: 'wav' as const } };
    const result = { version: 1, requestId: value.requestId, result: { type: 'audio', mimeType: 'audio/wav', data } };
    if (size > LIMITS.audio) assert.throws(() => parseResult(result, speech), /dfsc-host:TOO_LARGE/);
    else assert.deepEqual(parseResult(result, speech), result.result);
  }
  assert.throws(() => parseInvoke({ ...value, capability: 'model.asr',
    input: { audio: { mimeType: 'audio/wav', data: Buffer.alloc(24 * 1024 * 1024).toString('base64') } } }),
  /dfsc-host:TOO_LARGE/);
});
test('media contracts require canonical padded base64, including zero padding bits', () => {
  const value = { requestId: newRequestId(), revision: 'a'.repeat(64) };
  const speech = { ...value, capability: 'model.tts' as const,
    input: { text: 'fixture', voice: 'fixture', format: 'wav' as const } };
  for (const data of ['', 'Zg', 'Zh==', 'Zm9=', '_w==', '/w=_', 'AAAA====', 'Zm=9', 'Zg==\n', 'YWJj\n===']) {
    assert.throws(() => parseInvoke({ ...value, capability: 'model.asr',
      input: { audio: { mimeType: 'audio/wav', data } } }), /dfsc-host:INVALID_REQUEST/, data);
    assert.throws(() => parseInvoke({ ...value, capability: 'model.video', input: {
      messages: [{ role: 'user', content: 'inspect' }], video: { mimeType: 'video/mp4', data },
    } }), /dfsc-host:INVALID_REQUEST/, data);
    assert.throws(() => parseResult({ version: 1, requestId: value.requestId,
      result: { type: 'audio', mimeType: 'audio/wav', data } }, speech), /dfsc-host:INVALID_REQUEST/, data);
  }
});
test('the offline speech fixture returns the requested audio MIME without a provider call', async t => {
  const broker = await mockHost(); t.after(() => broker.close());
  const launch = broker.launch({ capabilities: ['model.tts'] });
  broker.grant(launch);
  const client = createHostClient({ ...identity, environment: { [HOST_ENV]: JSON.stringify(launch) } });
  t.after(() => client.close());
  const context = await client.context();
  for (const [format, mimeType] of [['mp3', 'audio/mpeg'], ['wav', 'audio/wav'], ['pcm', 'audio/pcm']] as const) {
    const result = await client.invoke({ requestId: newRequestId(), revision: context.revision, capability: 'model.tts',
      input: { text: 'offline fixture', voice: 'fixture', format } });
    assert.equal(result.type, 'audio');
    if (result.type === 'audio') assert.equal(result.mimeType, mimeType);
  }
  assert.equal(broker.counts.provider, 0);
});
test('aborted requests cancel once and client closure aborts pending reads without exposing launch secrets', async t => {
  const broker = await mockHost(); t.after(() => broker.close());
  const launch = broker.launch(), controller = new AbortController();
  let cancellations = 0;
  let invoked!: () => void;
  const started = new Promise<void>(done => { invoked = done; });
  const client = createHostClient({ ...identity, environment: { [HOST_ENV]: JSON.stringify(launch) },
    fetch: async (url, options) => {
      if (String(url).endsWith('/cancel')) {
        cancellations++;
        return Response.json({ version: 1, requestId: JSON.parse(String(options?.body)).requestId, cancelled: true });
      }
      invoked();
      return new Promise<Response>((_resolve, reject) =>
        options?.signal?.addEventListener('abort', () => reject(new Error('private transport detail')), { once: true }));
    } });
  const request = client.invoke(invocation('a'.repeat(64)), { signal: controller.signal });
  await started;
  controller.abort();
  await assert.rejects(request, /CANCELLED/);
  assert.equal(cancellations, 1);
  const pending = client.context();
  client.close();
  await assert.rejects(pending, /CLOSED/);
});
