import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { MAX_IMAGE_BYTES } from '../electron/attachment-utils';
import {
  receiveRemoteImages, sendRemoteImage, REMOTE_IMAGE_CHUNK_BYTES, REMOTE_IMAGE_TOTAL_BYTES,
  REMOTE_IMAGE_MAX_TRANSFERS, REMOTE_IMAGE_OUTSIDE_WORKSPACE, type RemoteImageChannel,
} from '../electron/remote-images';

const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
function png(size = 64) {
  const bytes = Buffer.alloc(size, 23);
  signature.copy(bytes);
  return bytes;
}
type Call = { type: string; args: Record<string, unknown> };
class Channel implements RemoteImageChannel {
  calls: Call[] = [];
  constructor(private handle: (type: string, args: Record<string, unknown>) => unknown | Promise<unknown>) {}
  async request(type: string, args: Record<string, unknown> = {}) {
    this.calls.push({ type, args });
    return this.handle(type, args);
  }
}
function receiver(bytes: Buffer, overrides?: (type: string, args: Record<string, unknown>) => unknown) {
  return new Channel((type, args) => {
    const override = overrides?.(type, args);
    if (override !== undefined) return override;
    if (type === 'imageOpen') return { transferId: `transfer-${args.key}`, mimeType: 'image/png', size: bytes.length };
    if (type === 'imageChunk') {
      const offset = Number(args.offset), end = Math.min(bytes.length, offset + REMOTE_IMAGE_CHUNK_BYTES);
      return { data: bytes.subarray(offset, end).toString('base64'), end: end === bytes.length };
    }
    if (type === 'imageClose') return {};
    throw new Error('Unexpected request');
  });
}
async function files() {
  const root = await mkdtemp(join(tmpdir(), 'desktop-remote-images-'));
  const cwd = join(root, 'workspace'), outside = join(root, 'workspace-neighbor');
  await mkdir(cwd);
  await mkdir(outside);
  const path = join(cwd, 'result.png'), external = join(outside, 'private.png'), bytes = png(REMOTE_IMAGE_CHUNK_BYTES * 2 + 7);
  await writeFile(path, bytes);
  await writeFile(external, bytes);
  return { root, cwd, outside, path, external, bytes, close: () => rm(root, { recursive: true, force: true }) };
}
function uploader(change?: (type: string, args: Record<string, unknown>) => Promise<void>) {
  const chunks: Buffer[] = [];
  const channel = new Channel(async (type, args) => {
    await change?.(type, args);
    if (type === 'imageUploadOpen') return { transferId: 'upload-one' };
    if (type === 'imageUploadChunk') {
      const bytes = Buffer.from(String(args.data), 'base64');
      assert.ok(bytes.length <= REMOTE_IMAGE_CHUNK_BYTES);
      assert.equal(args.offset, chunks.reduce((total, chunk) => total + chunk.length, 0));
      chunks.push(bytes);
      return {};
    }
    if (type === 'imageUploadSend') return { messageId: 'delivered-message' };
    if (type === 'imageClose') return {};
    throw new Error('Unexpected request');
  });
  return { channel, chunks };
}
const current = () => true;
function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
async function ready<T>(promise: Promise<T>) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([promise, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('Fixture transfer did not reach its expected state')), 5000);
    })]);
  } finally { clearTimeout(timer); }
}
const turn = () => new Promise<void>(resolve => setImmediate(resolve));

test('receives only explicit images with sequential, bounded chunks and canonical base64', async () => {
  const bytes = png(REMOTE_IMAGE_CHUNK_BYTES * 2 + 3), channel = receiver(bytes);
  const images = await receiveRemoteImages(channel, 'binding', 'message', ['one', 'two'], current);
  assert.deepEqual(images, ['one', 'two'].map(() => ({ type: 'image', mimeType: 'image/png', data: bytes.toString('base64') })));
  assert.deepEqual(channel.calls.filter(call => call.type === 'imageChunk').map(call => call.args.offset),
    [0, REMOTE_IMAGE_CHUNK_BYTES, REMOTE_IMAGE_CHUNK_BYTES * 2, 0, REMOTE_IMAGE_CHUNK_BYTES, REMOTE_IMAGE_CHUNK_BYTES * 2]);
  assert.deepEqual(channel.calls.filter(call => call.type === 'imageClose').map(call => call.args),
    [{ bindingId: 'binding', transferId: 'transfer-one' }, { bindingId: 'binding', transferId: 'transfer-two' }]);
  assert.ok(channel.calls.every(call => call.args.bindingId === 'binding'));
  assert.ok(channel.calls.filter(call => call.type === 'imageOpen').every(call => call.args.messageId === 'message'));
});

test('validates image reference shapes, duplicates, identifiers and max five before opening anything', async () => {
  for (const keys of [null, 'key', {}, [1], [''], ['a', 'a'], ['a'.repeat(513)], Array.from({ length: 6 }, (_, i) => `key-${i}`)]) {
    const channel = receiver(png());
    await assert.rejects(receiveRemoteImages(channel, 'binding', 'message', keys as any, current), /references/);
    assert.equal(channel.calls.length, 0);
  }
  for (const [bindingId, messageId] of [['', 'message'], ['binding', ''], ['a'.repeat(81), 'message'], ['binding', 'secret\nid']]) {
    const channel = receiver(png());
    await assert.rejects(receiveRemoteImages(channel, bindingId, messageId, ['one'], current), /references/);
    assert.equal(channel.calls.length, 0);
  }
  const channel = receiver(png());
  assert.deepEqual(await receiveRemoteImages(channel, 'binding', 'message', [], current), []);
  assert.equal(channel.calls.length, 0);
  assert.equal((await receiveRemoteImages(channel, 'binding', 'message', ['1', '2', '3', '4', '5'], current)).length, 5);
});

test('rejects malformed imageOpen replies and closes every recoverable transfer', async () => {
  for (const opened of [undefined, null, [], {}, { transferId: '' }, { transferId: 'x'.repeat(81) },
    ...[0, -1, 0.5, '64', NaN, MAX_IMAGE_BYTES + 1].map(size => ({ transferId: 'known', mimeType: 'image/png', size })),
    { transferId: 'known', mimeType: 'image/svg+xml', size: 64 }]) {
    const channel = new Channel(type => type === 'imageOpen' ? opened : {});
    await assert.rejects(receiveRemoteImages(channel, 'binding', 'message', ['one'], current), /metadata/);
    assert.equal(channel.calls.filter(call => call.type === 'imageChunk').length, 0);
    assert.equal(channel.calls.filter(call => call.type === 'imageClose').length,
      opened && !Array.isArray(opened) && opened.transferId === 'known' ? 1 : 0);
  }
});

test('rejects invalid chunk shapes, noncanonical base64, size mismatch and false termination', async () => {
  for (const part of [undefined, null, [], {}, { data: 1, end: true }, { data: '', end: true },
    { data: '!!!!', end: true }, { data: 'AB==', end: true },
    { data: png().toString('base64'), end: 'true' }, { data: png().toString('base64'), end: false },
    { data: png(63).toString('base64'), end: true }, { data: png(65).toString('base64'), end: true },
    { data: png(REMOTE_IMAGE_CHUNK_BYTES + 1).toString('base64'), end: false }]) {
    const channel = new Channel(type => type === 'imageOpen' ? { transferId: 'one', mimeType: 'image/png', size: 64 }
      : type === 'imageChunk' ? part : {});
    await assert.rejects(receiveRemoteImages(channel, 'binding', 'message', ['one'], current));
    assert.equal(channel.calls.filter(call => call.type === 'imageClose').length, 1);
    assert.equal(channel.calls.filter(call => call.type === 'imageChunk').length, 1);
  }
});

test('accepts short nonterminal chunks only when the final sequential byte count is exact', async () => {
  const bytes = png(), offsets: number[] = [];
  const channel = receiver(bytes, (type, args) => {
    if (type !== 'imageChunk') return;
    const offset = Number(args.offset), end = Math.min(bytes.length, offset + 3);
    offsets.push(offset);
    return { data: bytes.subarray(offset, end).toString('base64'), end: end === bytes.length };
  });
  assert.equal((await receiveRemoteImages(channel, 'binding', 'message', ['one'], current))[0].data, bytes.toString('base64'));
  assert.deepEqual(offsets, Array.from({ length: Math.ceil(bytes.length / 3) }, (_, i) => i * 3));
});

test('enforces the aggregate 32 MiB receive budget and never reads the overflow transfer', async () => {
  const channel = receiver(png(MAX_IMAGE_BYTES));
  await assert.rejects(receiveRemoteImages(channel, 'binding', 'message', ['one', 'two', 'three', 'four'], current), /32 MiB/);
  assert.equal(REMOTE_IMAGE_TOTAL_BYTES, 32 * 1024 * 1024);
  assert.equal(channel.calls.filter(call => call.type === 'imageOpen').length, 4);
  assert.equal(channel.calls.filter(call => call.type === 'imageClose').length, 4);
  assert.ok(!channel.calls.some(call => call.type === 'imageChunk' && call.args.transferId === 'transfer-four'));
});

test('accepts exact receive size boundaries and JPEG/WebP magic without trusting file names', async () => {
  const large = png(MAX_IMAGE_BYTES), remainder = png(REMOTE_IMAGE_TOTAL_BYTES - 3 * MAX_IMAGE_BYTES);
  const channel = new Channel((type, args) => {
    const bytes = args.key === 'four' || args.transferId === 'four' ? remainder : large;
    if (type === 'imageOpen') return { transferId: args.key, mimeType: 'image/png', size: bytes.length };
    if (type === 'imageChunk') {
      const offset = Number(args.offset), end = Math.min(bytes.length, offset + REMOTE_IMAGE_CHUNK_BYTES);
      return { data: bytes.subarray(offset, end).toString('base64'), end: end === bytes.length };
    }
  });
  const images = await receiveRemoteImages(channel, 'binding', 'message', ['one', 'two', 'three', 'four'], current);
  assert.equal(images.reduce((total, image) => total + Buffer.from(image.data, 'base64').length, 0), REMOTE_IMAGE_TOTAL_BYTES);
  for (const [bytes, mimeType] of [[Buffer.from([255, 216, 255]), 'image/jpeg'], [Buffer.from('RIFF1234WEBP'), 'image/webp']] as const) {
    const channel = new Channel(type => type === 'imageOpen' ? { transferId: 'one', mimeType, size: bytes.length }
      : type === 'imageChunk' ? { data: bytes.toString('base64'), end: true } : undefined);
    assert.deepEqual(await receiveRemoteImages(channel, 'binding', 'message', ['one'], current),
      [{ type: 'image', mimeType, data: bytes.toString('base64') }]);
  }
});

test('validates receive magic against MIME and sanitizes transport failures', async () => {
  for (const mode of ['magic', 'mime', 'transport']) {
    const bytes = mode === 'magic' ? Buffer.from('<svg>not an image</svg>') : png();
    const channel = receiver(bytes, type => {
      if (mode === 'mime' && type === 'imageOpen') return { transferId: 'one', mimeType: 'image/jpeg', size: bytes.length };
      if (mode === 'transport' && type === 'imageChunk') throw new Error('private-app-secret');
    });
    await assert.rejects(receiveRemoteImages(channel, 'binding', 'message', ['one'], current), error => {
      assert.ok(error instanceof Error);
      assert.doesNotMatch(error.message, /private-app-secret/);
      return true;
    });
    assert.equal(channel.calls.filter(call => call.type === 'imageClose').length, 1);
  }
});

test('receive detach and rebind fencing rejects late results, closes the old binding and never returns partial images', async () => {
  for (const stage of ['imageOpen', 'imageChunk', 'imageClose']) {
    let generation = 1;
    const channel = receiver(png(), type => { if (type === stage) generation = 2; });
    await assert.rejects(receiveRemoteImages(channel, 'old-binding', 'message', ['one', 'two'],
      () => generation === 1), /scope/);
    assert.equal(channel.calls.filter(call => call.type === 'imageOpen').length, 1);
    assert.equal(channel.calls.filter(call => call.type === 'imageClose').length, 1);
    assert.ok(channel.calls.every(call => call.args.bindingId === 'old-binding'));
    if (stage === 'imageOpen') assert.equal(channel.calls.filter(call => call.type === 'imageChunk').length, 0);
  }
  const channel = receiver(png());
  await assert.rejects(receiveRemoteImages(channel, 'binding', 'message', ['one'], () => false), /scope/);
  assert.equal(channel.calls.length, 0);
});

test('cleanup failure does not hide a validated image or replace a receive error', async () => {
  for (const bad of [false, true]) {
    const channel = receiver(bad ? Buffer.from('not an image') : png(), type => {
      if (type === 'imageClose') throw new Error('private cleanup detail');
    });
    if (bad) await assert.rejects(receiveRemoteImages(channel, 'binding', 'message', ['one'], current), /format/);
    else assert.equal((await receiveRemoteImages(channel, 'binding', 'message', ['one'], current)).length, 1);
  }
});

test('sends an explicit workspace image as bounded sequential bytes and returns only confirmed delivery', async () => {
  const f = await files(), { channel, chunks } = uploader();
  try {
    assert.deepEqual(await sendRemoteImage(channel, 'binding', 'session', f.cwd, f.path, current), { messageId: 'delivered-message' });
    assert.deepEqual(Buffer.concat(chunks), f.bytes);
    assert.deepEqual(channel.calls[0], { type: 'imageUploadOpen', args: {
      bindingId: 'binding', sessionKey: 'session', mimeType: 'image/png', size: f.bytes.length,
    } });
    assert.deepEqual(channel.calls.slice(-2), [
      { type: 'imageUploadSend', args: { bindingId: 'binding', sessionKey: 'session', transferId: 'upload-one' } },
      { type: 'imageClose', args: { bindingId: 'binding', transferId: 'upload-one' } },
    ]);
    assert.ok(!JSON.stringify(channel.calls).includes(f.path), 'the helper never receives a local path');
  } finally { await f.close(); }
});

test('the exact 10 MiB upload limit uses void acknowledgements and never exceeds the raw chunk cap', async () => {
  const f = await files(), bytes = png(MAX_IMAGE_BYTES);
  try {
    await writeFile(f.path, bytes);
    let received = 0;
    const channel = new Channel((type, args) => {
      if (type === 'imageUploadOpen') {
        assert.equal(args.size, MAX_IMAGE_BYTES);
        return { transferId: 'one' };
      }
      if (type === 'imageUploadChunk') {
        const chunk = Buffer.from(String(args.data), 'base64');
        assert.equal(args.offset, received);
        assert.ok(chunk.length <= REMOTE_IMAGE_CHUNK_BYTES);
        assert.deepEqual(chunk, bytes.subarray(received, received + chunk.length));
        received += chunk.length;
      }
      if (type === 'imageUploadSend') {
        assert.equal(received, MAX_IMAGE_BYTES);
        return { messageId: 'one' };
      }
    });
    assert.deepEqual(await sendRemoteImage(channel, 'binding', 'session', f.cwd, f.path, current), { messageId: 'one' });
    assert.equal(channel.calls.filter(call => call.type === 'imageClose').length, 1);
  } finally { await f.close(); }
});

test('supports relative paths, literal percent names and all three validated image formats', async () => {
  const f = await files();
  try {
    for (const [name, bytes, mimeType] of [
      ['literal%20image.png', png(), 'image/png'],
      ['photo.JPG', Buffer.from([255, 216, 255, 224]), 'image/jpeg'],
      ['photo.webp', Buffer.from('RIFF1234WEBP'), 'image/webp'],
    ] as const) {
      await writeFile(join(f.cwd, name), bytes);
      const { channel, chunks } = uploader();
      await sendRemoteImage(channel, 'binding', 'session', f.cwd, name, current);
      assert.equal(channel.calls[0].args.mimeType, mimeType);
      assert.deepEqual(Buffer.concat(chunks), bytes);
    }
  } finally { await f.close(); }
});

test('outside paths, traversal and symlink escapes surface the explicit workspace error without uploading', async () => {
  const f = await files();
  try {
    await symlink(f.outside, join(f.cwd, 'escape'), process.platform === 'win32' ? 'junction' : 'dir');
    for (const path of [f.external, join('..', basename(f.outside), 'private.png'), join(f.cwd, 'escape', 'private.png')]) {
      const { channel } = uploader();
      await assert.rejects(sendRemoteImage(channel, 'binding', 'session', f.cwd, path, current),
        { message: REMOTE_IMAGE_OUTSIDE_WORKSPACE });
      assert.equal(channel.calls.length, 0);
    }
    const linkedRoot = join(f.root, 'workspace-alias');
    await symlink(f.cwd, linkedRoot, process.platform === 'win32' ? 'junction' : 'dir');
    await sendRemoteImage(uploader().channel, 'binding', 'session', linkedRoot, 'result.png', current);
    await sendRemoteImage(uploader().channel, 'binding', 'session', linkedRoot, f.path, current);
  } finally { await f.close(); }
});

test('rejects URLs, Markdown, network paths, directories, unsupported formats and oversized or empty files', async () => {
  const f = await files();
  try {
    await writeFile(join(f.cwd, 'wrong.jpg'), png());
    await writeFile(join(f.cwd, 'image.svg'), '<svg></svg>');
    await writeFile(join(f.cwd, 'empty.png'), '');
    await writeFile(join(f.cwd, 'oversized.png'), png(MAX_IMAGE_BYTES + 1));
    await mkdir(join(f.cwd, 'directory.png'));
    for (const path of ['https://example.test/image.png', 'file:///image.png', '\\\\server\\image.png',
      '//server/image.png', '[image](result.png)', 'result.png\n', 'wrong.jpg', 'image.svg',
      'empty.png', 'oversized.png', 'missing.png', 'directory.png']) {
      const { channel } = uploader();
      await assert.rejects(sendRemoteImage(channel, 'binding', 'session', f.cwd, path, current));
      assert.equal(channel.calls.length, 0);
    }
  } finally { await f.close(); }
});

test('rechecks file identity and metadata after upload and rejects replacement or mutation before sending', async () => {
  for (const mode of ['replace', 'mutate', 'escape']) {
    const f = await files();
    try {
      const pivot = join(f.cwd, 'pivot');
      if (mode === 'escape') {
        await symlink(f.cwd, pivot, process.platform === 'win32' ? 'junction' : 'dir');
        await writeFile(join(f.outside, 'result.png'), f.bytes);
      }
      const { channel } = uploader(async type => {
        if (type !== 'imageUploadOpen') return;
        if (mode === 'replace') {
          await rename(f.path, join(f.cwd, 'old.png'));
          await writeFile(f.path, f.bytes);
        } else if (mode === 'mutate') await writeFile(f.path, png(f.bytes.length + 1));
        else {
          await rm(pivot, { recursive: true, force: true });
          await symlink(f.outside, pivot, process.platform === 'win32' ? 'junction' : 'dir');
        }
      });
      await assert.rejects(sendRemoteImage(channel, 'binding', 'session', f.cwd,
        mode === 'escape' ? join(pivot, 'result.png') : f.path, current), /changed|unavailable/);
      assert.equal(channel.calls.filter(call => call.type === 'imageUploadSend').length, 0);
      assert.equal(channel.calls.filter(call => call.type === 'imageClose').length, 1);
    } finally { await f.close(); }
  }
});

test('upload scope invalidation at every RPC boundary rejects late replies and cleans only the captured binding', async () => {
  const f = await files();
  try {
    for (const stage of ['imageUploadOpen', 'imageUploadChunk', 'imageUploadSend', 'imageClose']) {
      let generation = 1;
      const { channel } = uploader(async type => { if (type === stage) generation = 2; });
      await assert.rejects(sendRemoteImage(channel, 'old-binding', 'session', f.cwd, f.path, () => generation === 1), /scope/);
      assert.equal(channel.calls.filter(call => call.type === 'imageClose').length, 1);
      assert.ok(channel.calls.every(call => call.args.bindingId === 'old-binding'));
      assert.equal(channel.calls.filter(call => call.type === 'imageUploadSend').length,
        ['imageUploadSend', 'imageClose'].includes(stage) ? 1 : 0);
    }
    const { channel } = uploader();
    await assert.rejects(sendRemoteImage(channel, 'binding', 'session', f.cwd, f.path, () => false), /scope/);
    assert.equal(channel.calls.length, 0);
  } finally { await f.close(); }
});

test('local file operations are fenced before any upload; scope callback exceptions are sanitized', async () => {
  const f = await files();
  try {
    for (const expireAt of [2, 6, 10, 14]) {
      let checks = 0;
      const { channel } = uploader();
      await assert.rejects(sendRemoteImage(channel, 'binding', 'session', f.cwd, f.path,
        () => ++checks < expireAt), /scope/);
      assert.equal(channel.calls.length, 0);
    }
    for (const operation of [
      () => sendRemoteImage(uploader().channel, 'binding', 'session', f.cwd, f.path, () => { throw new Error('private scope detail'); }),
      () => receiveRemoteImages(receiver(png()), 'binding', 'message', ['one'], () => { throw new Error('private scope detail'); }),
    ]) await assert.rejects(operation(), { message: 'Remote image scope is no longer available' });
  } finally { await f.close(); }
});

test('failed chunk upload closes the transfer without sending, exposing transport details or retrying', async () => {
  const f = await files(), { channel } = uploader(async type => {
    if (type === 'imageUploadChunk') throw new Error('private SDK secret');
  });
  try {
    await assert.rejects(sendRemoteImage(channel, 'binding', 'session', f.cwd, f.path, current), error => {
      assert.ok(error instanceof Error);
      assert.doesNotMatch(error.message, /private SDK secret/);
      return true;
    });
    assert.equal(channel.calls.filter(call => call.type === 'imageUploadChunk').length, 1);
    assert.equal(channel.calls.filter(call => call.type === 'imageUploadSend').length, 0);
    assert.equal(channel.calls.filter(call => call.type === 'imageClose').length, 1);
  } finally { await f.close(); }
});

test('malformed upload metadata or acknowledgements never reach send and still clean known transfers', async () => {
  const f = await files();
  try {
    for (const stage of ['open', 'chunk']) {
      for (const bad of [null, [], 1, '', { transferId: '' }, { transferId: 'x'.repeat(81) }]) {
        const channel = new Channel(type => type === 'imageUploadOpen' ? stage === 'open' ? bad : { transferId: 'known' }
          : type === 'imageUploadChunk' ? bad : {});
        await assert.rejects(sendRemoteImage(channel, 'binding', 'session', f.cwd, f.path, current));
        assert.equal(channel.calls.filter(call => call.type === 'imageUploadSend').length, 0);
        assert.equal(channel.calls.filter(call => call.type === 'imageClose').length, stage === 'chunk' ? 1 : 0);
      }
    }
  } finally { await f.close(); }
});

test('ambiguous sends are attempted once, not retried, and upload success alone is never delivery', async () => {
  const f = await files();
  try {
    for (const response of [undefined, null, {}, { uploaded: true }, { messageId: '' }, { messageId: 1 }, { messageId: 'bad\nid' }, 'throw']) {
      const channel = new Channel(type => {
        if (type === 'imageUploadOpen') return { transferId: 'known' };
        if (type === 'imageUploadSend') {
          if (response === 'throw') throw new Error('private-secret-from-sdk');
          return response;
        }
        return {};
      });
      await assert.rejects(sendRemoteImage(channel, 'binding', 'session', f.cwd, f.path, current), error => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /not confirmed|not automatically retry/);
        assert.doesNotMatch(error.message, /private-secret-from-sdk/);
        return true;
      });
      assert.equal(channel.calls.filter(call => call.type === 'imageUploadSend').length, 1);
      assert.equal(channel.calls.filter(call => call.type === 'imageClose').length, 1);
    }
  } finally { await f.close(); }
});

test('best effort close failure cannot cause a second send or conceal successful delivery', async () => {
  const f = await files(), { channel } = uploader(async type => {
    if (type === 'imageClose') throw new Error('private cleanup secret');
  });
  try {
    assert.deepEqual(await sendRemoteImage(channel, 'binding', 'session', f.cwd, f.path, current), { messageId: 'delivered-message' });
    assert.equal(channel.calls.filter(call => call.type === 'imageUploadSend').length, 1);
    assert.equal(channel.calls.filter(call => call.type === 'imageClose').length, 1);
  } finally { await f.close(); }
});

test('reserves at most four per-channel upload slots before allocating files, including hung upload opens', async t => {
  const f = await files(), gate = deferred(), started = Array.from({ length: 4 }, () => deferred());
  const allocate = Buffer.alloc, allocations: number[] = [];
  t.mock.method(Buffer, 'alloc', (...args: Parameters<typeof Buffer.alloc>) => {
    allocations.push(args[0]); return allocate(...args);
  });
  let opens = 0;
  const channel = new Channel(async type => {
    if (type === 'imageUploadOpen') {
      const index = opens++;
      started[index]?.resolve();
      await gate.promise;
      return { transferId: `held-${index}` };
    }
    if (type === 'imageUploadSend') return { messageId: 'confirmed' };
    return {};
  });
  const sends = Array.from({ length: 4 }, (_, index) =>
    sendRemoteImage(channel, `binding-${index}`, 'session', f.cwd, f.path, current));
  const settled = Promise.allSettled(sends);
  try {
    await ready(Promise.all(started.map(event => event.promise)));
    assert.equal(REMOTE_IMAGE_MAX_TRANSFERS, 4);
    assert.equal(allocations.filter(size => size === f.bytes.length).length, 4);
    await assert.rejects(sendRemoteImage(channel, 'replacement-binding', 'session', f.cwd, f.path, current), /maximum 4/);
    assert.equal(opens, 4);
    assert.equal(allocations.filter(size => size === f.bytes.length).length, 4);
    assert.equal(channel.calls.filter(call => call.type === 'imageClose').length, 0);
    // An unrelated channel owns a separate budget.
    await sendRemoteImage(uploader().channel, 'other-binding', 'session', f.cwd, f.path, current);
    gate.resolve();
    assert.ok((await ready(settled)).every(result => result.status === 'fulfilled'));
    await sendRemoteImage(channel, 'next-binding', 'session', f.cwd, f.path, current);
    assert.equal(channel.calls.filter(call => call.type === 'imageClose').length, 5);
  } finally {
    gate.resolve();
    await settled;
    await f.close();
  }
});

test('receive and send share a 32 MiB reservation before allocation, including the exact budget boundary', async t => {
  const f = await files(), large = png(MAX_IMAGE_BYTES), smallSize = REMOTE_IMAGE_TOTAL_BYTES - 3 * MAX_IMAGE_BYTES;
  const smallPath = join(f.cwd, 'small.png');
  await writeFile(f.path, large);
  await writeFile(smallPath, png(smallSize));
  const download = deferred(), started = Array.from({ length: 4 }, () => deferred());
  const uploads = new Map(['one', 'two', 'small'].map(id => [id, deferred()]));
  const allocate = Buffer.alloc, allocations: number[] = [];
  t.mock.method(Buffer, 'alloc', (...args: Parameters<typeof Buffer.alloc>) => {
    allocations.push(args[0]); return allocate(...args);
  });
  const channel = new Channel(async (type, args) => {
    if (type === 'imageOpen') return { transferId: 'download', mimeType: 'image/png', size: MAX_IMAGE_BYTES };
    if (type === 'imageChunk') { started[0].resolve(); await download.promise; throw new Error('private download error'); }
    if (type === 'imageUploadOpen') {
      const id = String(args.bindingId);
      started[id === 'one' ? 1 : id === 'two' ? 2 : 3].resolve();
      await uploads.get(id)?.promise;
      return { transferId: `upload-${id}` };
    }
    if (type === 'imageUploadSend') return { messageId: 'confirmed' };
    return {};
  });
  const incoming = receiveRemoteImages(channel, 'incoming-binding', 'message', ['one'], current);
  const sends = ['one', 'two'].map(id => sendRemoteImage(channel, id, 'session', f.cwd, f.path, current));
  const settled = Promise.allSettled([incoming, ...sends]);
  let small: Promise<unknown> | undefined;
  try {
    await ready(Promise.all(started.slice(0, 3).map(event => event.promise)));
    assert.equal(allocations.filter(size => size === MAX_IMAGE_BYTES).length, 3);
    await assert.rejects(sendRemoteImage(channel, 'overflow', 'session', f.cwd, f.path, current), /32 MiB/);
    assert.equal(allocations.filter(size => size === MAX_IMAGE_BYTES).length, 3);
    assert.equal(channel.calls.filter(call => call.type === 'imageUploadOpen').length, 2);
    small = sendRemoteImage(channel, 'small', 'session', f.cwd, smallPath, current);
    await ready(started[3].promise);
    assert.equal(allocations.filter(size => size === smallSize).length, 1);
    assert.equal(allocations.reduce((total, size) => total + size, 0), REMOTE_IMAGE_TOTAL_BYTES);
    download.resolve();
    await assert.rejects(incoming, /operation failed/);
    // Settling a failed receive releases only its own bytes and slot.
    await sendRemoteImage(channel, 'replacement', 'session', f.cwd, f.path, current);
    assert.equal(allocations.filter(size => size === MAX_IMAGE_BYTES).length, 4);
  } finally {
    download.resolve();
    for (const gate of uploads.values()) gate.resolve();
    await settled;
    await small;
    await f.close();
  }
});

test('cancellation before dispatch never allocates or contacts the helper', async t => {
  const controller = new AbortController(), { channel } = uploader();
  controller.abort(new Error('private cancellation reason'));
  const allocate = t.mock.method(Buffer, 'alloc');
  await assert.rejects(sendRemoteImage(channel, 'binding', 'session', '/unused', 'unused.png', current, controller.signal),
    /cancelled.*not confirmed.*not automatically retry/);
  assert.equal(allocate.mock.callCount(), 0);
  assert.equal(channel.calls.length, 0);
});

test('abort of a pending upload open closes its late captured ID before any chunks or sends', async () => {
  const f = await files(), controller = new AbortController(), opened = deferred(), response = deferred();
  let settled = false;
  const channel = new Channel(async type => {
    if (type === 'imageUploadOpen') { opened.resolve(); await response.promise; return { transferId: 'late-owner' }; }
    return {};
  });
  const sending = sendRemoteImage(channel, 'old-binding', 'old-session', f.cwd, f.path, current, controller.signal);
  const outcome = sending.then(value => ({ value, error: undefined }), error => ({ error, value: undefined }));
  void outcome.then(() => { settled = true; });
  try {
    await ready(opened.promise);
    controller.abort();
    await turn();
    assert.equal(settled, false);
    assert.equal(channel.calls.filter(call => call.type === 'imageClose').length, 0);
    response.resolve();
    assert.match((await ready(outcome)).error.message, /cancelled/);
    assert.deepEqual(channel.calls.map(call => call.type), ['imageUploadOpen', 'imageClose']);
    assert.deepEqual(channel.calls[1].args, { bindingId: 'old-binding', transferId: 'late-owner' });
  } finally {
    response.resolve();
    await outcome;
    await f.close();
  }
});

for (const stage of ['imageUploadChunk', 'imageUploadSend']) {
  for (const order of ['close-first', 'rpc-first']) {
    test(`abort immediately closes the exact owner during ${stage}; ${order} cannot release its reservation early`, async t => {
      const f = await files(), controller = new AbortController(), closeGate = deferred();
      const ids = ['old-binding', 'peer-one', 'peer-two', 'peer-three'];
      const rpc = new Map(ids.map(id => [id, deferred()]));
      const started = new Map(ids.map(id => [id, deferred()]));
      const allocate = Buffer.alloc, allocations: number[] = [];
      t.mock.method(Buffer, 'alloc', (...args: Parameters<typeof Buffer.alloc>) => {
        allocations.push(args[0]); return allocate(...args);
      });
      const channel = new Channel(async (type, args) => {
        const id = String(args.bindingId);
        if (type === 'imageUploadOpen') return { transferId: `transfer-${id}` };
        if (type === stage) { started.get(id)?.resolve(); await rpc.get(id)?.promise; }
        if (type === 'imageUploadSend') return { messageId: `message-${id}` };
        if (type === 'imageClose' && id === 'old-binding') await closeGate.promise;
        return {};
      });
      const sends = ids.map((id, index) =>
        sendRemoteImage(channel, id, `session-${index}`, f.cwd, f.path, current, index === 0 ? controller.signal : undefined));
      const settled = Promise.allSettled(sends);
      let ownerSettled = false;
      const owner = sends[0].then(value => ({ value, error: undefined }), error => ({ error, value: undefined }));
      void owner.then(() => { ownerSettled = true; });
      const stillReserved = async () => {
        await assert.rejects(sendRemoteImage(channel, 'overflow-binding', 'other-session', f.cwd, f.path, current), /maximum 4/);
        assert.equal(allocations.filter(size => size === f.bytes.length).length, 4);
        assert.equal(ownerSettled, false);
      };
      try {
        await ready(Promise.all([...started.values()].map(event => event.promise)));
        controller.abort(new Error('private cancellation reason'));
        assert.deepEqual(channel.calls.filter(call => call.type === 'imageClose').map(call => call.args),
          [{ bindingId: 'old-binding', transferId: 'transfer-old-binding' }], 'close is dispatched synchronously on abort');
        await stillReserved();
        if (order === 'close-first') closeGate.resolve();
        else rpc.get('old-binding')!.resolve();
        await turn();
        await stillReserved();
        if (order === 'close-first') rpc.get('old-binding')!.resolve();
        else closeGate.resolve();
        const result = await ready(owner);
        assert.match(result.error.message, /cancelled.*not confirmed.*not automatically retry/);
        assert.doesNotMatch(result.error.message, /private cancellation reason/);
        assert.equal(channel.calls.filter(call => call.type === 'imageUploadSend' && call.args.bindingId === 'old-binding').length,
          stage === 'imageUploadSend' ? 1 : 0);
        await sendRemoteImage(channel, 'replacement-binding', 'replacement-session', f.cwd, f.path, current);
        assert.equal(allocations.filter(size => size === f.bytes.length).length, 5);
        assert.equal(channel.calls.filter(call => call.type === 'imageClose' && call.args.bindingId === 'old-binding').length, 1);
        assert.equal(channel.calls.filter(call => call.type === 'imageClose' && String(call.args.bindingId).startsWith('peer-')).length, 0);
      } finally {
        closeGate.resolve();
        for (const gate of rpc.values()) gate.resolve();
        await settled;
        await f.close();
      }
    });
  }
}
