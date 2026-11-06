import { randomUUID } from 'node:crypto';

export const imageChunkSize = 24 * 1024;
export const imageRequestTimeout = 20000;
const imageLimit = 10 * 1024 * 1024;
const memoryLimit = 32 * 1024 * 1024;
const mimeTypes = new Set(['image/png', 'image/jpeg', 'image/webp']);
const bounded = value => typeof value === 'string' && value.length > 0 && value.length <= 200;
export const imageKey = value => bounded(value) && /^[a-zA-Z0-9_-]+$/.test(value);

// Generated SDK methods omit cancellation options, including during token lookup.
export function mediaHttpInstance(http, signal) {
  const request = options => {
    signal.throwIfAborted();
    return http.request({ ...options, signal: options.signal ? AbortSignal.any([signal, options.signal]) : signal,
      timeout: options.timeout > 0 ? Math.min(options.timeout, imageRequestTimeout) : imageRequestTimeout });
  };
  const instance = { request };
  for (const method of ['get', 'delete', 'head', 'options'])
    instance[method] = (url, options = {}) => request({ ...options, url, method: method.toUpperCase() });
  for (const method of ['post', 'put', 'patch'])
    instance[method] = (url, data, options = {}) => request({ ...options, url, data, method: method.toUpperCase() });
  return instance;
}

function imageMime(bytes) {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png';
  if (bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg';
  if (bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP')
    return 'image/webp';
  throw new Error('Unsupported image');
}

/** In-memory pages only. Slots include SDK calls still settling after cancellation. */
export class RemoteMediaChannel {
  constructor(connection) {
    this.connection = connection;
    this.transfers = new Map();
    this.bytes = 0;
  }
  allocate(size) {
    if (this.bytes + size > memoryLimit) throw new Error('Image memory limit reached');
    const buffer = Buffer.allocUnsafe(size);
    this.bytes += size;
    return buffer;
  }
  create(fence, direction, size = 0) {
    if (this.transfers.size >= 4) throw new Error('Image transfer limit reached');
    const item = { id: randomUUID(), fence, direction, size: 0, offset: 0, bytes: 0, pages: [],
      controller: new AbortController(), expiresAt: this.connection.now() + 120000 };
    if (size) { item.buffer = this.allocate(size); item.bytes = size; item.declaredSize = size; }
    this.transfers.set(item.id, item);
    item.timer = setTimeout(() => this.drop(item), 120000);
    item.timer.unref?.();
    return item;
  }
  valid(item) {
    return !item.cancelled && item.expiresAt > this.connection.now()
      && this.connection.validFence(item.fence)
      && (!item.input || this.connection.inputs.get(item.messageId) === item.input && !item.input.recalled);
  }
  check(item) {
    if (!this.valid(item)) { this.drop(item); throw new Error('Image transfer unavailable'); }
  }
  get(value, direction) {
    const item = this.transfers.get(value.transferId);
    if (!bounded(value.transferId) || !item || value.bindingId !== item.fence.binding.id
      || direction && item.direction !== direction) throw new Error('Invalid image transfer');
    this.check(item);
    return item;
  }
  free(item) {
    clearTimeout(item.timer);
    clearTimeout(item.deadline);
    if (this.transfers.get(item.id) !== item) return;
    this.transfers.delete(item.id);
    this.bytes -= item.bytes;
    item.bytes = 0; item.pages = []; item.buffer = undefined; item.stream = undefined;
  }
  drop(item) {
    item.cancelled = true;
    clearTimeout(item.timer);
    clearTimeout(item.deadline);
    item.controller.abort();
    item.stream?.destroy();
    if (!item.pending) this.free(item);
  }
  startRequest(item) {
    item.pending = true;
    item.deadline = setTimeout(() => this.drop(item), imageRequestTimeout);
    item.deadline.unref?.();
    return this.connection.mediaClient(item.controller.signal);
  }
  reset() { for (const item of this.transfers.values()) this.drop(item); }
  recall(messageId) {
    for (const item of this.transfers.values()) if (item.messageId === messageId) this.drop(item);
  }
  detach(scope) {
    for (const item of this.transfers.values()) if (item.fence.scope === scope) this.drop(item);
  }
  revokeImages(scope) {
    for (const item of this.transfers.values()) if (item.fence.imageScope === scope) this.drop(item);
  }
  close(value) {
    if (!bounded(value.transferId) || value.bindingId !== this.connection.bound?.id) throw new Error('Invalid image transfer');
    const item = this.transfers.get(value.transferId);
    if (item) {
      if (item.fence.binding !== this.connection.bound) throw new Error('Invalid image transfer');
      this.drop(item);
    }
  }
  async open(value) {
    const fence = this.connection.captureFence(value.bindingId);
    const input = this.connection.inputs.get(value.messageId);
    if (!bounded(value.messageId) || !imageKey(value.key) || input?.binding !== fence.binding
      || input.recalled || !input.images?.includes(value.key)) throw new Error('Invalid image resource');
    const item = this.create(fence, 'download');
    item.input = input; item.messageId = value.messageId;
    try {
      const client = this.startRequest(item);
      const response = await client.im.messageResource.get({
        path: { message_id: value.messageId, file_key: value.key }, params: { type: 'image' },
      });
      // Even a stale response owns a stream which must be destroyed.
      item.stream = response.getReadableStream();
      this.check(item);
      const declared = response.headers?.['content-length'];
      if (declared !== undefined && (!/^\d+$/.test(String(declared)) || Number(declared) > imageLimit))
        throw new Error('Invalid image size');
      for await (const raw of item.stream) {
        this.check(item);
        if (!(raw instanceof Uint8Array) || item.size + raw.byteLength > imageLimit) throw new Error('Image size limit reached');
        let offset = 0;
        while (offset < raw.byteLength) {
          const pageOffset = item.size % imageChunkSize;
          if (!pageOffset) {
            const page = this.allocate(Math.min(imageChunkSize, imageLimit - item.size));
            item.bytes += page.length; item.pages.push(page);
          }
          const page = item.pages.at(-1), length = Math.min(page.length - pageOffset, raw.byteLength - offset);
          page.set(raw.subarray(offset, offset + length), pageOffset);
          offset += length; item.size += length;
        }
      }
      this.check(item);
      if (declared !== undefined && Number(declared) !== item.size) throw new Error('Invalid image size');
      item.mimeType = imageMime(item.pages[0]?.subarray(0, item.size) ?? Buffer.alloc(0));
      return { transferId: item.id, mimeType: item.mimeType, size: item.size };
    } catch { item.cancelled = true; throw new Error('Image download unavailable'); }
    finally {
      clearTimeout(item.deadline);
      item.pending = false;
      item.stream?.destroy(); item.stream = undefined;
      if (item.cancelled) this.free(item);
    }
  }
  chunk(value) {
    const item = this.get(value, 'download');
    if (item.pending || !Number.isSafeInteger(value.offset) || value.offset !== item.offset || item.offset >= item.size)
      throw new Error('Invalid image offset');
    const length = Math.min(imageChunkSize, item.size - item.offset);
    const data = item.pages[Math.floor(item.offset / imageChunkSize)].subarray(0, length).toString('base64');
    item.offset += length;
    return { data, end: item.offset === item.size };
  }
  uploadOpen(value) {
    const fence = this.connection.captureImageFence(value.bindingId, value.sessionKey);
    if (!mimeTypes.has(value.mimeType) || !Number.isSafeInteger(value.size) || value.size < 1 || value.size > imageLimit)
      throw new Error('Invalid image upload');
    const item = this.create(fence, 'upload', value.size);
    item.mimeType = value.mimeType;
    return { transferId: item.id };
  }
  uploadChunk(value) {
    const item = this.get(value, 'upload');
    if (item.pending || item.sending || !Number.isSafeInteger(value.offset) || value.offset !== item.size
      || typeof value.data !== 'string' || !value.data.length || value.data.length > imageChunkSize * 4 / 3
      || value.data.length % 4 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value.data))
      throw new Error('Invalid image chunk');
    const bytes = Buffer.from(value.data, 'base64');
    if (bytes.toString('base64') !== value.data || bytes.length > imageChunkSize || item.size + bytes.length > item.declaredSize)
      throw new Error('Invalid image chunk');
    item.buffer.set(bytes, item.size); item.size += bytes.length;
  }
  async uploadSend(value) {
    const item = this.get(value, 'upload');
    if (value.sessionKey !== item.fence.sessionKey || item.pending || item.sending || item.size !== item.declaredSize)
      throw new Error('Invalid image upload');
    item.sending = true;
    try {
      if (imageMime(item.buffer) !== item.mimeType) throw new Error('Invalid image type');
      const client = this.startRequest(item);
      const uploaded = await client.im.image.create({ data: { image_type: 'message', image: item.buffer } });
      this.check(item);
      if (!this.connection.online || !imageKey(uploaded?.image_key))
        throw new Error('Image upload unavailable');
      // Never retry a POST whose receipt is unknown, including after a rebind.
      const sent = await client.im.message.create({
        params: { receive_id_type: 'chat_id' },
        data: { receive_id: item.fence.binding.chat, msg_type: 'image', content: JSON.stringify({ image_key: uploaded.image_key }) },
      });
      this.check(item);
      if (sent?.code !== 0 || !bounded(sent.data?.message_id)) throw new Error('Image send unavailable');
      return { messageId: sent.data.message_id };
    } catch { throw new Error('Image delivery unavailable'); }
    finally { item.pending = false; this.free(item); }
  }
}
