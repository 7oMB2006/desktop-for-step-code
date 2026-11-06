import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const { RemoteConnection } = await import(new URL('../electron/remote-channel-core.mjs', import.meta.url).href);
const { imageChunkSize, imageRequestTimeout, mediaHttpInstance } = await import(new URL('../electron/remote-media-channel.mjs', import.meta.url).href);
const tick = () => new Promise<void>(resolve => setImmediate(resolve));
const MiB = 1024 * 1024;
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function png(size = 50) {
  const bytes = Buffer.alloc(size, 97);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(bytes);
  return bytes;
}
function resource(bytes: Buffer, headers = {}) {
  const stream = Readable.from([bytes]);
  return { headers, stream, getReadableStream: () => stream };
}
function fixture() {
  let now = Date.now();
  const events: any[] = [], downloads: any[] = [], uploads: any[] = [], sends: any[] = [];
  let download: (value: any, signal: AbortSignal) => Promise<any> = async () => resource(png());
  let upload: (value: any, signal: AbortSignal) => Promise<any> = async () => ({ image_key: 'img_uploaded' });
  let send: (value: any, signal: AbortSignal) => Promise<any> = async () => ({ code: 0, data: { message_id: 'sent-image' } });
  class Gate {
    seen = new Set<string>();
    accept(raw: any) {
      if (raw.message.message_type !== 'text' || this.seen.has(raw.message.message_id)) return { action: 'ignore' };
      this.seen.add(raw.message.message_id);
      return { action: 'accept', message: { id: raw.message.message_id, text: JSON.parse(raw.message.content).text } };
    }
    close() {}
  }
  const connection = new RemoteConnection({ LarkInboundGate: Gate }, (event: any) => events.push(event), () => now);
  connection.bound = { id: 'binding', actor: 'human', chat: 'chat' };
  connection.botId = 'bot'; connection.online = true;
  connection.mediaClient = (signal: AbortSignal) => ({ im: {
    messageResource: { get: async (value: any) => { downloads.push(value); return download(value, signal); } },
    image: { create: async (value: any) => { uploads.push(value); return upload(value, signal); } },
    message: { create: async (value: any) => { sends.push(value); return send(value, signal); } },
  } });
  const imageScope = (active = true, runId = 'run') => connection.command('imageScope', {
    bindingId: 'binding', sessionKey: 'session', runId, active,
  });
  const scope = (active = true) => connection.command('sessionScope', { bindingId: 'binding', sessionKey: 'session', active });
  scope(); imageScope();
  const accept = (id = 'incoming', key = 'img_incoming', actor = 'human', chat = 'chat') => connection.message({
    sender: { sender_type: 'user', sender_id: { open_id: actor } },
    message: { message_id: id, chat_id: chat, chat_type: 'p2p', message_type: 'image',
      create_time: now + 1, content: JSON.stringify({ image_key: key }) },
  });
  const open = (messageId = 'incoming', key = 'img_incoming') => connection.command('imageOpen', { bindingId: 'binding', messageId, key });
  const uploadOpen = (size = 50, mimeType = 'image/png') => connection.command('imageUploadOpen',
    { bindingId: 'binding', sessionKey: 'session', mimeType, size });
  const write = (transferId: string, bytes: Buffer, offset = 0) => connection.command('imageUploadChunk',
    { bindingId: 'binding', transferId, offset, data: bytes.toString('base64') });
  const finish = (transferId: string, sessionKey = 'session') => connection.command('imageUploadSend', { bindingId: 'binding', transferId, sessionKey });
  return { connection, events, downloads, uploads, sends, accept, open, scope, imageScope, uploadOpen, write, finish,
    advance: (ms: number) => { now += ms; },
    download: (next: typeof download) => { download = next; }, upload: (next: typeof upload) => { upload = next; },
    send: (next: typeof send) => { send = next; },
    recall: (id = 'incoming') => connection.recalled({ message_id: id, chat_id: 'chat', recall_type: 'message_owner' }),
    close: (transferId: string) => connection.command('imageClose', { bindingId: 'binding', transferId }),
    chunk: (transferId: string, offset: number) => connection.command('imageChunk', { bindingId: 'binding', transferId, offset }),
  };
}

const adapterPath = new URL('../runtime/remote/lark-adapter.cjs', import.meta.url);
let nativeClientId = 0;
function nativeFixture(t: TestContext, handle?: (request: any, respond: () => unknown) => unknown) {
  if (!existsSync(adapterPath)) { t.skip('Requires an existing staged lark-adapter; this test never builds or stages it'); return; }
  const adapter = createRequire(import.meta.url)(fileURLToPath(adapterPath));
  let Client = adapter.Client;
  if (!Client) {
    // Older staged adapters bundle Client through LarkApi without exporting it.
    const api = new adapter.LarkApi({ appId: 'offline-sdk-contract', appSecret: 'offline-secret', brand: 'feishu' });
    t.after(() => api.close());
    Client = api.client.constructor;
  }
  const f = fixture(), requests: any[] = [], streams: Readable[] = [];
  t.after(() => f.connection.close());
  const credentials = { appId: `offline-media-test-${++nativeClientId}`, appSecret: 'offline-secret', brand: 'feishu' };
  const logger = { error() {}, warn() {}, info() {}, debug() {}, trace() {} };
  const httpInstance = { request: async (request: any) => {
    requests.push(request);
    assert.ok(request.signal instanceof AbortSignal);
    assert.equal(request.timeout, imageRequestTimeout);
    const respond = () => {
      const path = new URL(request.url).pathname;
      if (path === '/open-apis/auth/v3/tenant_access_token/internal')
        return { code: 0, tenant_access_token: 'offline-token', expire: 7200 };
      if (path === '/open-apis/im/v1/images') return { code: 0, data: { image_key: 'img_native' } };
      if (path === '/open-apis/im/v1/messages') return { code: 0, data: { message_id: 'native-message' } };
      if (path === '/open-apis/im/v1/messages/incoming/resources/img_incoming') {
        const stream = Readable.from([png()]);
        streams.push(stream);
        return { data: stream, headers: { 'content-length': '50' } };
      }
      throw new Error('Unexpected offline SDK request');
    };
    return handle ? handle(request, respond) : respond();
  } };
  f.connection.adapter = { ...adapter, Client };
  f.connection.credentials = credentials;
  f.connection.reactionApi = new Client({ ...credentials, logger, httpInstance });
  delete f.connection.mediaClient;
  return { ...f, requests, streams };
}

function aborted(signal: AbortSignal) {
  return new Promise<never>((_resolve, reject) => {
    if (signal.aborted) reject(new Error('Offline request aborted'));
    else signal.addEventListener('abort', () => reject(new Error('Offline request aborted')), { once: true });
  });
}

test('downloads require the resource key on the same authenticated accepted message', async t => {
  const f = fixture(); t.after(() => f.connection.close());
  f.accept('foreign', 'img_foreign', 'other'); f.accept('other-chat', 'img_other', 'human', 'other');
  f.accept(); f.accept('second', 'img_second');
  for (const [messageId, key] of [['unknown', 'img_incoming'], ['incoming', 'img_second'], ['foreign', 'img_foreign'],
    ['other-chat', 'img_other'], ['incoming', 'https://elsewhere/image'], ['incoming', '../resource']])
    await assert.rejects(f.open(messageId, key), /Invalid image resource/);
  assert.equal(f.downloads.length, 0);
  const opened = await f.open();
  assert.deepEqual(f.downloads[0], { path: { message_id: 'incoming', file_key: 'img_incoming' }, params: { type: 'image' } });
  assert.equal(opened.mimeType, 'image/png'); assert.equal(opened.size, 50);
  f.close(opened.transferId); f.close(opened.transferId);
  assert.equal(f.connection.media.bytes, 0);
});

test('download chunks are exact sequential 24 KiB base64 payloads well below the JSONL limit', async t => {
  const f = fixture(); t.after(() => f.connection.close()); f.accept();
  const bytes = png(imageChunkSize * 2 + 19), r = resource(bytes);
  f.download(async () => r);
  const opened = await f.open();
  const chunks = [];
  assert.throws(() => f.chunk(opened.transferId, 1), /offset/);
  for (let offset = 0; offset < bytes.length; offset += imageChunkSize) {
    const chunk = f.chunk(opened.transferId, offset);
    assert.ok(JSON.stringify({ id: 'x'.repeat(80), type: 'response', success: true, data: chunk }).length < 65536);
    assert.ok(Buffer.from(chunk.data, 'base64').length <= imageChunkSize);
    assert.equal(chunk.end, offset + imageChunkSize >= bytes.length);
    chunks.push(Buffer.from(chunk.data, 'base64'));
  }
  assert.deepEqual(Buffer.concat(chunks), bytes);
  assert.throws(() => f.chunk(opened.transferId, 0), /offset/);
  f.close(opened.transferId);
  assert.equal(r.stream.destroyed, true);
  assert.equal(f.connection.media.bytes, 0); assert.equal(f.connection.media.transfers.size, 0);
});

test('magic bytes, not untrusted MIME headers, select PNG, JPEG and WebP', async t => {
  const f = fixture(); t.after(() => f.connection.close()); f.accept();
  const samples = [
    [png(), 'image/png'],
    [Buffer.from([255, 216, 255, 224, 0, 16]), 'image/jpeg'],
    [Buffer.from('RIFF0000WEBPVP8 '), 'image/webp'],
  ] as const;
  for (const [bytes, mimeType] of samples) {
    f.download(async () => resource(bytes, { 'content-type': 'application/octet-stream', 'content-length': String(bytes.length) }));
    const opened = await f.open();
    assert.equal(opened.mimeType, mimeType);
    f.close(opened.transferId);
  }
  for (const bytes of [Buffer.alloc(0), Buffer.from('<svg></svg>'), Buffer.from('GIF89a'), Buffer.from('RIFFnope')]) {
    const r = resource(bytes); f.download(async () => r);
    await assert.rejects(f.open(), /^Error: Image download unavailable$/);
    assert.equal(r.stream.destroyed, true); assert.equal(f.connection.media.bytes, 0);
  }
});

test('download size is bounded even without Content-Length and failures destroy all buffered pages', async t => {
  const f = fixture(); t.after(() => f.connection.close()); f.accept();
  for (const r of [resource(png(), { 'content-length': String(10 * MiB + 1) }),
    resource(png(), { 'content-length': '1' }), resource(png(), { 'content-length': 'invalid' }),
    resource(png(10 * MiB + 1))]) {
    f.download(async () => r);
    await assert.rejects(f.open(), /^Error: Image download unavailable$/);
    assert.equal(r.stream.destroyed, true);
    assert.equal(f.connection.media.bytes, 0); assert.equal(f.connection.media.transfers.size, 0);
  }
  f.download(async () => resource(png(10 * MiB)));
  const exact = await f.open();
  assert.equal(exact.size, 10 * MiB);
  f.close(exact.transferId);
});

test('resource recall cancels an in-flight SDK response and forbids subsequent reads or opens', async t => {
  const f = fixture(); t.after(() => f.connection.close()); f.accept();
  const gate = deferred<any>(), r = resource(png()); f.download(async () => gate.promise);
  const opened = f.open(), rejected = assert.rejects(opened, /^Error: Image download unavailable$/);
  f.recall();
  gate.resolve(r); await rejected;
  assert.equal(r.stream.destroyed, true);
  assert.equal(f.connection.media.transfers.size, 0); assert.equal(f.connection.media.bytes, 0);
  await assert.rejects(f.open(), /Invalid image resource/);
  assert.equal(f.events.filter(event => event.kind === 'recalled').length, 1);
});

test('recall destroys a partially read stream and a completed transfer, without touching a sibling message', async t => {
  const f = fixture(); t.after(() => f.connection.close()); f.accept(); f.accept('sibling', 'img_sibling');
  const sibling = await f.open('sibling', 'img_sibling');
  const gate = deferred<void>();
  const stream = Readable.from((async function* () { yield png(imageChunkSize); await gate.promise; yield png(); })());
  f.download(async () => ({ getReadableStream: () => stream }));
  const pending = f.open(), rejected = assert.rejects(pending, /download unavailable/); await tick();
  assert.ok(f.connection.media.bytes > imageChunkSize);
  f.recall(); gate.resolve(); await rejected;
  assert.equal(stream.destroyed, true);
  assert.equal(f.chunk(sibling.transferId, 0).end, true);
  f.recall('sibling');
  assert.throws(() => f.chunk(sibling.transferId, 0), /transfer/);
  assert.equal(f.connection.media.bytes, 0);
});

test('uploads enforce exact offsets, declared size, canonical base64 and matching magic before SDK calls', async t => {
  const f = fixture(); t.after(() => f.connection.close());
  for (const [size, mime] of [[0, 'image/png'], [10 * MiB + 1, 'image/png'], [1.5, 'image/png'], [50, 'image/gif']] as const)
    assert.throws(() => f.uploadOpen(size, mime), /Invalid image upload/);
  const bytes = png(), { transferId } = f.uploadOpen(bytes.length);
  assert.throws(() => f.write(transferId, bytes, 1), /chunk/);
  assert.throws(() => f.connection.command('imageUploadChunk', { bindingId: 'binding', transferId, offset: 0, data: '!!!!' }), /chunk/);
  assert.throws(() => f.connection.command('imageUploadChunk', { bindingId: 'binding', transferId, offset: 0, data: 'YR==' }), /chunk/);
  await assert.rejects(f.finish(transferId), /Invalid image upload/);
  f.write(transferId, bytes.subarray(0, 10));
  assert.throws(() => f.write(transferId, bytes, 0), /chunk/);
  assert.throws(() => f.write(transferId, bytes, 10), /chunk/);
  f.write(transferId, bytes.subarray(10), 10);
  await assert.rejects(f.finish(transferId, 'different-session'), /Invalid image upload/);
  const sent = await f.finish(transferId);
  assert.deepEqual(sent, { messageId: 'sent-image' });
  assert.deepEqual(f.uploads[0], { data: { image_type: 'message', image: bytes } });
  assert.deepEqual(f.sends[0], { params: { receive_id_type: 'chat_id' },
    data: { receive_id: 'chat', msg_type: 'image', content: JSON.stringify({ image_key: 'img_uploaded' }) } });
  assert.equal(f.connection.media.bytes, 0);
  const mismatch = f.uploadOpen(50, 'image/jpeg');
  f.write(mismatch.transferId, png());
  await assert.rejects(f.finish(mismatch.transferId), /^Error: Image delivery unavailable$/);
  assert.equal(f.uploads.length, 1); assert.equal(f.connection.media.bytes, 0);
});

test('outbound chunks and total uploads stay within 24 KiB, 10 MiB, 32 MiB and four live slots', async t => {
  const f = fixture(); t.after(() => f.connection.close());
  const { transferId } = f.uploadOpen(imageChunkSize * 2 + 5);
  assert.throws(() => f.write(transferId, png(imageChunkSize + 1)), /chunk/);
  const bytes = png(imageChunkSize * 2 + 5);
  for (let offset = 0; offset < bytes.length; offset += imageChunkSize)
    f.write(transferId, bytes.subarray(offset, offset + imageChunkSize), offset);
  await f.finish(transferId);
  const transfers = Array.from({ length: 4 }, () => f.uploadOpen(8 * MiB));
  assert.equal(f.connection.media.bytes, 32 * MiB);
  assert.throws(() => f.uploadOpen(1), /limit/);
  for (const item of transfers) f.close(item.transferId);
  const large = Array.from({ length: 3 }, () => f.uploadOpen(10 * MiB));
  assert.throws(() => f.uploadOpen(3 * MiB), /memory limit/);
  assert.equal(f.connection.media.transfers.size, 3); assert.equal(f.connection.media.bytes, 30 * MiB);
  for (const item of large) f.close(item.transferId);
  assert.equal(f.connection.media.bytes, 0);
});

test('download pages and upload buffers share one memory budget, and a failed reader frees only its own pages', async t => {
  const f = fixture(); t.after(() => f.connection.close()); f.accept();
  const uploads = Array.from({ length: 3 }, () => f.uploadOpen(10 * MiB));
  const r = resource(png(3 * MiB)); f.download(async () => r);
  await assert.rejects(f.open(), /^Error: Image download unavailable$/);
  assert.equal(r.stream.destroyed, true);
  assert.equal(f.connection.media.transfers.size, 3);
  assert.equal(f.connection.media.bytes, 30 * MiB);
  for (const upload of uploads) f.close(upload.transferId);
  const stream = Readable.from((async function* () { yield png(); throw new Error('PRIVATE-SDK-ERROR'); })());
  f.download(async () => ({ getReadableStream: () => stream }));
  await assert.rejects(f.open(), /^Error: Image download unavailable$/);
  assert.equal(stream.destroyed, true); assert.equal(f.connection.media.bytes, 0);
});

test('foreign binding IDs cannot read, overwrite, send or close another binding transfer', async t => {
  const f = fixture(); t.after(() => f.connection.close()); f.accept();
  const downloaded = await f.open(), uploaded = f.uploadOpen();
  for (const type of ['imageChunk', 'imageUploadChunk', 'imageClose']) {
    assert.throws(() => f.connection.command(type, { bindingId: 'foreign', transferId: type === 'imageChunk'
      ? downloaded.transferId : uploaded.transferId, offset: 0, data: png().toString('base64') }), /Invalid image transfer/);
  }
  await assert.rejects(f.connection.command('imageUploadSend', { bindingId: 'foreign', transferId: uploaded.transferId, sessionKey: 'session' }),
    /Invalid image transfer/);
  assert.equal(f.connection.media.transfers.size, 2);
  assert.equal(f.chunk(downloaded.transferId, 0).end, true);
  f.write(uploaded.transferId, png());
  await f.finish(uploaded.transferId);
  f.close(downloaded.transferId);
});

test('pending downloads count toward the shared slot limit until their cancelled SDK calls actually settle', async t => {
  const f = fixture(); t.after(() => f.connection.close()); f.accept();
  const gates = Array.from({ length: 4 }, () => deferred<any>());
  let index = 0; f.download(async () => gates[index++].promise);
  const pending = gates.map(() => assert.rejects(f.open(), /download unavailable/));
  await assert.rejects(f.open(), /transfer limit/);
  f.recall();
  await assert.rejects(f.open(), /Invalid image resource/);
  assert.equal(f.connection.media.transfers.size, 4);
  assert.throws(() => f.uploadOpen(), /transfer limit/);
  for (const gate of gates) gate.resolve(resource(png()));
  await Promise.all(pending);
  assert.equal(f.connection.media.transfers.size, 0);
});

test('detach and reattach invalidate old uploads even when a late upload returns a usable key', async t => {
  const f = fixture(); t.after(() => f.connection.close());
  const gate = deferred<any>(); f.upload(async () => gate.promise);
  const { transferId } = f.uploadOpen(); f.write(transferId, png());
  const pending = f.finish(transferId), rejected = assert.rejects(pending, /delivery unavailable/);
  f.scope(false);
  assert.throws(() => f.uploadOpen(), /unavailable/);
  f.scope(true); f.imageScope();
  gate.resolve({ image_key: 'img_late' }); await rejected;
  assert.equal(f.sends.length, 0); assert.equal(f.connection.media.bytes, 0);
  const next = f.uploadOpen();
  f.close(next.transferId);
});

test('a new peer or same-id binding object can never receive an old transfer completion', async t => {
  const f = fixture(); t.after(() => f.connection.close()); f.accept();
  const downloadGate = deferred<any>(), r = resource(png()); f.download(async () => downloadGate.promise);
  const download = assert.rejects(f.open(), /download unavailable/);
  const uploadGate = deferred<any>(); f.upload(async () => uploadGate.promise);
  const { transferId } = f.uploadOpen(); f.write(transferId, png());
  const upload = assert.rejects(f.finish(transferId), /delivery unavailable/);
  f.connection.command('unbind', { bindingId: 'binding' });
  f.connection.command('bindSaved', { bindingId: 'binding', peer: { actor: 'other', chat: 'other-chat' } });
  f.scope(); f.imageScope();
  downloadGate.resolve(r); uploadGate.resolve({ image_key: 'img_old_peer' });
  await Promise.all([download, upload]);
  assert.equal(r.stream.destroyed, true); assert.equal(f.sends.length, 0);
  assert.equal(f.connection.media.transfers.size, 0); assert.equal(f.connection.media.bytes, 0);
});

test('ambiguous image sends are never retried and completion after detach cannot escape as a receipt', async t => {
  const f = fixture(); t.after(() => f.connection.close());
  f.send(async () => { throw new Error('PRIVATE-SECRET'); });
  let opened = f.uploadOpen(); f.write(opened.transferId, png());
  await assert.rejects(f.finish(opened.transferId), /^Error: Image delivery unavailable$/);
  await assert.rejects(f.finish(opened.transferId), /Invalid image transfer/);
  assert.equal(f.sends.length, 1);
  const gate = deferred<any>(); f.send(async () => gate.promise);
  opened = f.uploadOpen(); f.write(opened.transferId, png());
  const pending = f.finish(opened.transferId), rejected = assert.rejects(pending, /delivery unavailable/); await tick();
  assert.equal(f.sends.length, 2);
  f.scope(false); gate.resolve({ code: 0, data: { message_id: 'late-receipt' } }); await rejected;
  assert.equal(f.connection.media.bytes, 0);
  assert.doesNotMatch(JSON.stringify(f.events), /PRIVATE-|late-receipt/);
});

test('explicit close, expiry and helper close release memory and destroy late downloads', async t => {
  const f = fixture(); t.after(() => f.connection.close()); f.accept();
  const opened = await f.open();
  f.advance(120001);
  assert.throws(() => f.chunk(opened.transferId, 0), /unavailable/);
  assert.equal(f.connection.media.bytes, 0);
  const uploaded = f.uploadOpen(); f.close(uploaded.transferId);
  assert.throws(() => f.write(uploaded.transferId, png()), /Invalid image transfer/);
  const gate = deferred<any>(), r = resource(png()); f.download(async () => gate.promise);
  const pending = assert.rejects(f.open(), /download unavailable/);
  await f.connection.close();
  gate.resolve(r); await pending;
  assert.equal(r.stream.destroyed, true);
  assert.equal(f.connection.media.transfers.size, 0); assert.equal(f.connection.media.bytes, 0);
});

test('image uploads consume the unwrapped pinned SDK image_key, not a fabricated response envelope', async t => {
  const f = fixture(); t.after(() => f.connection.close());
  for (const result of [null, {}, { code: 0, data: { image_key: 'img_wrapped' } }, { image_key: '../invalid' }]) {
    f.upload(async () => result);
    const { transferId } = f.uploadOpen(); f.write(transferId, png());
    await assert.rejects(f.finish(transferId), /delivery unavailable/);
  }
  assert.equal(f.sends.length, 0); assert.equal(f.connection.media.bytes, 0);
  f.upload(async () => ({ image_key: 'img_unwrapped' }));
  const { transferId } = f.uploadOpen(); f.write(transferId, png());
  assert.deepEqual(await f.finish(transferId), { messageId: 'sent-image' });
  assert.equal(JSON.parse(f.sends[0].data.content).image_key, 'img_unwrapped');
});

test('image scopes require the exact bound active session and valid run identifiers', async t => {
  const f = fixture(); t.after(() => f.connection.close());
  const command = { bindingId: 'binding', sessionKey: 'session', runId: 'run', active: true };
  for (const patch of [{ bindingId: 'other' }, { sessionKey: '' }, { runId: '' }, { runId: 'x'.repeat(201) }, { active: 1 }])
    assert.throws(() => f.connection.command('imageScope', { ...command, ...patch }), /Invalid image scope/);
  assert.throws(() => f.connection.command('imageScope', { ...command, sessionKey: 'unattached' }), /Session is unavailable/);
  f.scope(false);
  assert.throws(() => f.imageScope(), /Session is unavailable/);
  f.scope();
  assert.throws(() => f.uploadOpen(), /Image run is unavailable/);
  f.imageScope();
  f.close(f.uploadOpen().transferId);
});

test('same-run grants are idempotent, revocation and replacement invalidate old uploads permanently', async t => {
  const f = fixture(); t.after(() => f.connection.close());
  const first = f.uploadOpen(); f.write(first.transferId, png());
  const original = f.connection.imageScopes.get('session');
  f.imageScope(); assert.equal(f.connection.imageScopes.get('session'), original);
  f.imageScope(false, 'older-run');
  assert.equal(f.connection.imageScopes.get('session'), original);
  assert.deepEqual(await f.finish(first.transferId), { messageId: 'sent-image' });
  const revoked = f.uploadOpen(); f.write(revoked.transferId, png());
  f.connection.online = false; f.imageScope(false);
  assert.equal(original.active, false); assert.equal(f.connection.media.bytes, 0);
  f.connection.online = true;
  assert.throws(() => f.uploadOpen(), /Image run is unavailable/);
  f.imageScope();
  assert.notEqual(f.connection.imageScopes.get('session'), original);
  await assert.rejects(f.finish(revoked.transferId), /Invalid image transfer/);
  const replaced = f.uploadOpen(); f.write(replaced.transferId, png());
  f.imageScope(true, 'new-run'); f.imageScope(false, 'run');
  assert.equal(f.connection.imageScopes.get('session').active, true);
  await assert.rejects(f.finish(replaced.transferId), /Invalid image transfer/);
  const next = f.uploadOpen(); f.write(next.transferId, png());
  await f.finish(next.transferId);
  assert.equal(f.sends.length, 2);
});

test('run scope revocation, replacement and explicit close abort pending uploads before any message POST', async t => {
  for (const revoke of [(f: any, _id: string) => f.imageScope(false),
    (f: any, _id: string) => f.imageScope(true, 'next-run'), (f: any, id: string) => f.close(id)]) {
    const f = fixture(); t.after(() => f.connection.close());
    const gate = deferred<any>(); let signal!: AbortSignal;
    f.upload(async (_value, captured) => { signal = captured; return gate.promise; });
    const { transferId } = f.uploadOpen(); f.write(transferId, png());
    const pending = assert.rejects(f.finish(transferId), /delivery unavailable/);
    revoke(f, transferId);
    assert.equal(signal.aborted, true);
    // An uncooperative fake SDK still owns its slot until it settles.
    assert.equal(f.connection.media.transfers.size, 1); assert.equal(f.connection.media.bytes, 50);
    gate.resolve({ image_key: 'img_late' }); await pending;
    assert.equal(f.sends.length, 0); assert.equal(f.connection.media.transfers.size, 0);
    assert.equal(f.connection.media.bytes, 0);
  }
});

test('session detach, reset and helper close clear image grants and abort pending SDK calls', async t => {
  for (const revoke of [(f: any) => f.scope(false), (f: any) => f.connection.reset(), (f: any) => f.connection.close()]) {
    const f = fixture(); t.after(() => f.connection.close());
    let signal!: AbortSignal;
    f.upload(async (_value, captured) => { signal = captured; return aborted(signal); });
    const { transferId } = f.uploadOpen(); f.write(transferId, png());
    const pending = assert.rejects(f.finish(transferId), /delivery unavailable/);
    await revoke(f); await pending;
    assert.equal(signal.aborted, true); assert.equal(f.connection.imageScopes.size, 0);
    assert.equal(f.connection.media.transfers.size, 0); assert.equal(f.connection.media.bytes, 0);
    assert.equal(f.sends.length, 0);
  }
});

test('media HTTP adapter covers SDK token helpers and preserves stream flags while bounding native cancellation', async () => {
  const calls: any[] = [], controller = new AbortController(), other = new AbortController();
  const http = mediaHttpInstance({ request: async (options: any) => { calls.push(options); return options; } }, controller.signal);
  await http.post('/token', { fixture: true });
  await http.request({ url: '/resource', responseType: 'stream', $return_headers: true, timeout: 60000, signal: other.signal });
  assert.equal(calls[0].method, 'POST'); assert.deepEqual(calls[0].data, { fixture: true });
  assert.equal(calls[0].timeout, imageRequestTimeout);
  assert.equal(calls[1].responseType, 'stream'); assert.equal(calls[1].$return_headers, true);
  assert.equal(calls[1].timeout, imageRequestTimeout);
  other.abort(); assert.equal(calls[1].signal.aborted, true); assert.equal(calls[0].signal.aborted, false);
  controller.abort();
  assert.throws(() => http.request({ url: '/never-issued' }), /abort/i);
  assert.equal(calls.length, 2);
});

test('existing runtime SDK contract: token acquisition, unwrapped upload, message envelope and native resource stream', async t => {
  const f = nativeFixture(t); if (!f) return;
  assert.ok(imageRequestTimeout > 0 && imageRequestTimeout < 30000);
  f.accept();
  const opened = await f.open();
  assert.equal(opened.mimeType, 'image/png'); assert.equal(opened.size, 50);
  assert.equal(f.chunk(opened.transferId, 0).data, png().toString('base64'));
  f.close(opened.transferId);
  assert.equal(f.streams[0].destroyed, true);
  const upload = f.uploadOpen(); f.write(upload.transferId, png());
  assert.deepEqual(await f.finish(upload.transferId), { messageId: 'native-message' });
  const requests = f.requests.filter(request => !request.url.includes('/auth/'));
  assert.equal(requests.length, 3);
  assert.equal(requests[0].params.type, 'image'); assert.equal(requests[0].responseType, 'stream');
  assert.equal(requests[0].$return_headers, true);
  assert.equal(requests[1].data.image_type, 'message');
  assert.deepEqual(requests[1].data.image, png());
  assert.equal(requests[2].params.receive_id_type, 'chat_id');
  assert.equal(requests[2].data.receive_id, 'chat');
  assert.equal(JSON.parse(requests[2].data.content).image_key, 'img_native');
  assert.equal(f.connection.media.bytes, 0);
});

test('native SDK deadlines abort token lookup, upload, download headers and message POST without losing slots', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  for (const phase of ['token', 'upload', 'download', 'send']) {
    const started = deferred<void>(); let signal!: AbortSignal;
    const f = nativeFixture(t, (request, respond) => {
      const path = new URL(request.url).pathname;
      const target = phase === 'token' ? path.includes('/auth/') : phase === 'upload' ? path.endsWith('/images')
        : phase === 'download' ? path.includes('/resources/') : path.endsWith('/messages');
      if (!target) return respond();
      signal = request.signal; started.resolve();
      return aborted(signal);
    });
    if (!f) return;
    f.accept();
    let operation: Promise<any>;
    if (phase === 'download') operation = f.open();
    else {
      const { transferId } = f.uploadOpen(); f.write(transferId, png());
      operation = f.finish(transferId);
    }
    const pending = assert.rejects(operation, /unavailable/);
    await started.promise;
    assert.equal(f.connection.media.transfers.size, 1); assert.equal(signal.aborted, false);
    t.mock.timers.tick(imageRequestTimeout - 1);
    assert.equal(signal.aborted, false);
    t.mock.timers.tick(1); await pending;
    assert.equal(signal.aborted, true); assert.equal(f.connection.media.transfers.size, 0);
    assert.equal(f.connection.media.bytes, 0);
    assert.equal(f.requests.filter(request => new URL(request.url).pathname.endsWith('/messages')).length, phase === 'send' ? 1 : 0);
    f.close(f.uploadOpen().transferId);
    await f.connection.close();
  }
});

test('download deadlines destroy a stalled native stream and free its pages only after the reader settles', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const stream = new Readable({ read() {} });
  stream.push(png());
  const f = nativeFixture(t, (request, respond) => request.url.includes('/resources/')
    ? { data: stream, headers: {} } : respond());
  if (!f) { stream.destroy(); return; }
  f.accept();
  const pending = assert.rejects(f.open(), /download unavailable/);
  await tick();
  assert.ok(f.connection.media.bytes > 0);
  t.mock.timers.tick(imageRequestTimeout);
  assert.equal(stream.destroyed, true);
  assert.equal(f.connection.media.transfers.size, 1);
  await pending;
  assert.equal(f.connection.media.transfers.size, 0); assert.equal(f.connection.media.bytes, 0);
});

test('native SDK token lookup completing after run revocation cannot issue a new upload or message', async t => {
  const gate = deferred<any>(), started = deferred<void>(); let signal!: AbortSignal;
  const f = nativeFixture(t, (request, respond) => {
    if (!request.url.includes('/auth/')) return respond();
    signal = request.signal; started.resolve(); return gate.promise;
  });
  if (!f) return;
  const { transferId } = f.uploadOpen(); f.write(transferId, png());
  const pending = assert.rejects(f.finish(transferId), /delivery unavailable/);
  await started.promise;
  f.imageScope(false); assert.equal(signal.aborted, true);
  assert.equal(f.connection.media.transfers.size, 1);
  gate.resolve({ code: 0, tenant_access_token: 'offline-late-token', expire: 7200 });
  await pending;
  assert.equal(f.requests.length, 1); assert.equal(f.connection.media.transfers.size, 0);
});

test('native SDK scope revocation and imageClose cancel pending upload HTTP before message issuance', async t => {
  for (const cancel of [(f: any, _id: string) => { f.imageScope(false); f.imageScope(true, 'replacement'); },
    (f: any, id: string) => f.close(id)]) {
    const started = deferred<void>(); let signal!: AbortSignal;
    const f = nativeFixture(t, (request, respond) => {
      if (!request.url.endsWith('/images')) return respond();
      signal = request.signal; started.resolve(); return aborted(signal);
    });
    if (!f) return;
    const { transferId } = f.uploadOpen(); f.write(transferId, png());
    const pending = assert.rejects(f.finish(transferId), /delivery unavailable/);
    await started.promise;
    cancel(f, transferId); await pending;
    assert.equal(signal.aborted, true); assert.equal(f.connection.media.bytes, 0);
    assert.equal(f.requests.filter(request => request.url.endsWith('/messages')).length, 0);
  }
});

test('four hung native SDK downloads retain their slots during cancellation then recover at the deadline', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const started = deferred<void>(), signals: AbortSignal[] = [];
  const f = nativeFixture(t, (request, respond) => {
    if (!request.url.includes('/resources/')) return respond();
    signals.push(request.signal);
    if (signals.length === 4) started.resolve();
    return aborted(request.signal);
  });
  if (!f) return;
  f.accept();
  const pending = Array.from({ length: 4 }, () => assert.rejects(f.open(), /download unavailable/));
  await started.promise;
  assert.throws(() => f.uploadOpen(), /transfer limit/);
  t.mock.timers.tick(imageRequestTimeout);
  assert.equal(f.connection.media.transfers.size, 4);
  assert.ok(signals.every(signal => signal.aborted));
  await Promise.all(pending);
  assert.equal(f.connection.media.transfers.size, 0); assert.equal(f.connection.media.bytes, 0);
  const { transferId } = f.uploadOpen(); f.write(transferId, png());
  assert.deepEqual(await f.finish(transferId), { messageId: 'native-message' });
});
