import { constants, type BigIntStats } from 'node:fs';
import { lstat, open, realpath, type FileHandle } from 'node:fs/promises';
import { extname, isAbsolute, relative, resolve } from 'node:path';
import { artifactFile } from './artifact-files';
import { IMAGE_MIMES, MAX_IMAGES, MAX_IMAGE_BYTES, imageMime } from './attachment-utils';

export const REMOTE_IMAGE_CHUNK_BYTES = 24 * 1024;
export const REMOTE_IMAGE_TOTAL_BYTES = 32 * 1024 * 1024;
export const REMOTE_IMAGE_MAX_TRANSFERS = 4;
export const REMOTE_IMAGE_OUTSIDE_WORKSPACE = 'Image is outside this session workspace. Move it into the workspace before sending.';

export interface RemoteImageChannel {
  request(type: string, args?: Record<string, unknown>): Promise<unknown>;
}
export interface RemoteImage {
  type: 'image';
  mimeType: typeof IMAGE_MIMES[number];
  data: string;
}
// Main captures the original channel/generation, binding, worker/RPC and run.
type StillCurrent = () => boolean;
const extensionMimes: Readonly<Record<string, RemoteImage['mimeType']>> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
};
class ImageError extends Error {}
const cancelledMessage = 'Remote image request was cancelled. Delivery is not confirmed; do not automatically retry.';
const budgets = new WeakMap<RemoteImageChannel, { slots: number; bytes: number }>();

function reserve(channel: RemoteImageChannel) {
  const budget = budgets.get(channel) ?? { slots: 0, bytes: 0 };
  const busy = () => new ImageError('Remote image transfers exceed the active limit (maximum 4 transfers and 32 MiB total)');
  if (budget.slots >= REMOTE_IMAGE_MAX_TRANSFERS) throw busy();
  budget.slots++;
  budgets.set(channel, budget);
  let bytes = 0, released = false;
  return {
    add(size: number) {
      if (budget.bytes + size > REMOTE_IMAGE_TOTAL_BYTES) throw busy();
      budget.bytes += size; bytes += size;
    },
    release() {
      if (released) return;
      released = true;
      budget.bytes -= bytes; budget.slots--;
      if (!budget.slots) budgets.delete(channel);
    },
  };
}

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
function identifier(value: unknown, max = 200): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max && !/[\x00-\x20\x7f]/.test(value);
}
function fence(stillCurrent: StillCurrent, signal?: AbortSignal) {
  let expired = false;
  return () => {
    if (signal?.aborted) throw new ImageError(cancelledMessage);
    try { if (!expired && stillCurrent()) return; } catch {}
    expired = true;
    throw new ImageError('Remote image scope is no longer available');
  };
}
async function request(channel: RemoteImageChannel, type: string, args: Record<string, unknown>) {
  try { return await channel.request(type, args); }
  catch { throw new ImageError('Remote image operation failed. Delivery is not confirmed; do not automatically retry.'); }
}
function transfer(value: unknown) {
  return record(value) && identifier(value.transferId, 80) ? value.transferId : undefined;
}
function acknowledgement(value: unknown) {
  // Commands with no result serialize as either no data or an empty object.
  if (value !== undefined && (!record(value) || Object.keys(value).length !== 0))
    throw new ImageError('Invalid Remote image acknowledgement');
}
async function closeTransfer(channel: RemoteImageChannel, bindingId: string, transferId?: string) {
  if (!transferId) return;
  // Cleanup uses the captured binding, even after detach/rebind, never its replacement.
  try { acknowledgement(await channel.request('imageClose', { bindingId, transferId })); } catch {}
}
function chunkBytes(value: unknown) {
  if (typeof value !== 'string' || !value.length || value.length > 4 * Math.ceil(REMOTE_IMAGE_CHUNK_BYTES / 3)
    || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) throw new ImageError('Invalid Remote image chunk');
  const bytes = Buffer.from(value, 'base64');
  if (!bytes.length || bytes.length > REMOTE_IMAGE_CHUNK_BYTES || bytes.toString('base64') !== value)
    throw new ImageError('Invalid Remote image chunk');
  return bytes;
}

/** Only explicit inbound message image keys may be passed here, never prose or URLs. */
export async function receiveRemoteImages(channel: RemoteImageChannel, bindingId: string, messageId: string,
  keys: readonly string[], stillCurrent: StillCurrent): Promise<RemoteImage[]> {
  const current = fence(stillCurrent);
  current();
  if (!identifier(bindingId, 80) || !identifier(messageId) || !Array.isArray(keys) || keys.length > MAX_IMAGES
    || keys.some(key => !identifier(key, 512)) || new Set(keys).size !== keys.length)
    throw new ImageError('Invalid Remote image references (maximum 5 images)');
  if (!keys.length) return [];
  const reservation = reserve(channel);
  const images: RemoteImage[] = [];
  let total = 0;
  try {
    for (const key of keys) {
      let transferId: string | undefined;
      let image: RemoteImage;
      try {
        current();
        const opened = await request(channel, 'imageOpen', { bindingId, messageId, key });
        transferId = transfer(opened);
        current();
        if (!record(opened) || !transferId || !IMAGE_MIMES.includes(opened.mimeType as RemoteImage['mimeType'])
          || !Number.isSafeInteger(opened.size) || Number(opened.size) <= 0 || Number(opened.size) > MAX_IMAGE_BYTES)
          throw new ImageError('Invalid Remote image metadata (maximum 10 MiB per image)');
        const size = Number(opened.size), mimeType = opened.mimeType as RemoteImage['mimeType'];
        total += size;
        if (total > REMOTE_IMAGE_TOTAL_BYTES) throw new ImageError('Remote images exceed 32 MiB total');
        // Keep all returned image bytes charged until the complete batch settles.
        reservation.add(size);
        const bytes = Buffer.alloc(size);
        let offset = 0;
        while (offset < size) {
          current();
          const part = await request(channel, 'imageChunk', { bindingId, transferId, offset });
          current();
          if (!record(part) || typeof part.end !== 'boolean') throw new ImageError('Invalid Remote image chunk');
          const chunk = chunkBytes(part.data);
          const next = offset + chunk.length;
          if (next > size || part.end !== (next === size)) throw new ImageError('Remote image byte count does not match metadata');
          chunk.copy(bytes, offset);
          offset = next;
        }
        if (imageMime(bytes) !== mimeType) throw new ImageError('Remote image format does not match its bytes');
        image = { type: 'image', mimeType, data: bytes.toString('base64') };
      } finally { await closeTransfer(channel, bindingId, transferId); }
      current();
      images.push(image);
    }
    current();
    return images;
  } finally { reservation.release(); }
}

function inside(root: string, path: string) {
  const part = relative(root, path);
  return part !== '..' && !part.startsWith('../') && !part.startsWith('..\\') && !isAbsolute(part);
}
function sameFile(a: BigIntStats, b: BigIntStats) {
  return b.isFile() && a.dev === b.dev && a.ino === b.ino && a.size === b.size
    && a.mtimeNs === b.mtimeNs && a.ctimeNs === b.ctimeNs;
}
async function workspaceImage(cwd: string, path: string, current: () => void) {
  if (typeof cwd !== 'string' || !isAbsolute(cwd) || /[\x00-\x1f\x7f]/.test(cwd)
    || typeof path !== 'string' || !path.trim() || path.length > 4096 || /[\x00-\x1f\x7f]/.test(path)
    || /^(?:[a-z][a-z\d+.-]*:)/i.test(path) && !/^[a-z]:[\\/]/i.test(path)
    || path.startsWith('\\\\') || path.startsWith('//'))
    throw new ImageError('Expected an explicit local image path, not a URL or network path');
  const reference = process.platform === 'win32' ? path.replace(/^\/([a-z])\//i, '$1:/') : path;
  const lexicalRoot = resolve(cwd), candidate = resolve(lexicalRoot, reference);
  const root = await realpath(lexicalRoot);
  current();
  let canonical: string;
  try { canonical = await realpath(candidate); }
  catch (error) {
    current();
    if (!inside(lexicalRoot, candidate) && !inside(root, candidate)) throw new ImageError(REMOTE_IMAGE_OUTSIDE_WORKSPACE);
    throw error;
  }
  current();
  // Parent directories can be aliases too; authorize the real file, not its spelling.
  if (!inside(root, canonical)) throw new ImageError(REMOTE_IMAGE_OUTSIDE_WORKSPACE);
  // Encode literal percent signs before artifactFile's reference decoder sees the path.
  const artifact = await artifactFile(root, encodeURI(process.platform === 'win32' ? canonical.replaceAll('\\', '/') : canonical));
  current();
  if (!artifact.exists || artifact.path !== canonical || !inside(root, artifact.path))
    throw new ImageError('Remote image file changed or is unavailable');
  const mimeType = extensionMimes[extname(canonical).toLowerCase()];
  if (!mimeType) throw new ImageError('Only PNG, JPEG and WebP image files can be sent');
  const before = await lstat(canonical, { bigint: true });
  current();
  if (!before.isFile() || before.isSymbolicLink()) throw new ImageError('Remote image must be a regular file');
  if (before.size <= 0n || before.size > BigInt(MAX_IMAGE_BYTES)) throw new ImageError('Remote image must contain 1 byte to 10 MiB');
  return { lexicalRoot, root, candidate, canonical, before, mimeType };
}

/** Call only for an explicit delivery tool request after main verifies the live Remote scope. */
export async function sendRemoteImage(channel: RemoteImageChannel, bindingId: string, sessionKey: string,
  cwd: string, path: string, stillCurrent: StillCurrent, signal?: AbortSignal): Promise<{ messageId: string }> {
  const current = fence(stillCurrent, signal);
  let transferId: string | undefined, file: FileHandle | undefined;
  let reservation: ReturnType<typeof reserve> | undefined;
  let closeStarted = false, closing: Promise<void> | undefined;
  const close = () => {
    if (!transferId || closeStarted) return closing;
    closeStarted = true;
    return closing = closeTransfer(channel, bindingId, transferId);
  };
  const abort = () => { void close(); };
  let delivered: { messageId: string };
  signal?.addEventListener('abort', abort, { once: true });
  try {
    current();
    if (!identifier(bindingId, 80) || !identifier(sessionKey)) throw new ImageError('Invalid Remote image target');
    reservation = reserve(channel);
    const source = await workspaceImage(cwd, path, current);
    current();
    reservation.add(Number(source.before.size));
    file = await open(source.canonical, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
    const recheck = async () => {
      current();
      const descriptor = await file!.stat({ bigint: true });
      current();
      const root = await realpath(source.lexicalRoot);
      current();
      const canonical = await realpath(source.candidate);
      current();
      const info = await lstat(source.canonical, { bigint: true });
      current();
      if (root !== source.root || canonical !== source.canonical || !inside(root, canonical)
        || info.isSymbolicLink() || !sameFile(source.before, descriptor) || !sameFile(source.before, info))
        throw new ImageError('Remote image file changed before delivery');
    };
    await recheck();
    const size = Number(source.before.size), bytes = Buffer.alloc(size);
    let offset = 0;
    while (offset < size) {
      current();
      const { bytesRead } = await file.read(bytes, offset, Math.min(REMOTE_IMAGE_CHUNK_BYTES, size - offset), offset);
      current();
      if (!bytesRead) throw new ImageError('Remote image file changed before delivery');
      offset += bytesRead;
    }
    await recheck();
    if (imageMime(bytes) !== source.mimeType) throw new ImageError('Remote image format does not match its bytes');
    current();
    const opened = await request(channel, 'imageUploadOpen', { bindingId, sessionKey, mimeType: source.mimeType, size });
    transferId = transfer(opened);
    if (signal?.aborted) abort();
    current();
    if (!transferId) throw new ImageError('Invalid Remote image upload metadata');
    for (offset = 0; offset < size; offset += REMOTE_IMAGE_CHUNK_BYTES) {
      current();
      acknowledgement(await request(channel, 'imageUploadChunk', {
        bindingId, transferId, offset, data: bytes.subarray(offset, offset + REMOTE_IMAGE_CHUNK_BYTES).toString('base64'),
      }));
      current();
    }
    await recheck();
    current();
    // This non-idempotent send is attempted once. Upload success is not delivery.
    const sent = await request(channel, 'imageUploadSend', { bindingId, sessionKey, transferId });
    current();
    if (!record(sent) || !identifier(sent.messageId)) throw new ImageError('Remote image delivery was not confirmed. Do not automatically retry.');
    delivered = { messageId: sent.messageId };
  } catch (error) {
    if (signal?.aborted) throw new ImageError(cancelledMessage);
    if (error instanceof ImageError) throw error;
    throw new ImageError('Remote image file is unavailable or changed');
  } finally {
    // Never race cancellation against in-flight I/O: its reservation stays owned until both settle.
    await close();
    try { await file?.close(); } catch {}
    signal?.removeEventListener('abort', abort);
    reservation?.release();
  }
  current();
  return delivered;
}
