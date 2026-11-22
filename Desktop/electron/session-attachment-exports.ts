import { randomUUID } from 'node:crypto';
import { lstat, mkdir, open, readdir, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import type { Content, Message } from '../src/contracts';
import { isUserMessage } from '../src/user-message';
import { decodeImageUrl, imageFileName, IMAGE_MIMES, MAX_IMAGES } from './attachment-utils';
import { activeHistory, type HistoryEntry } from './session-branching';
import type { SessionRuntime } from './session-runtimes';

const MAX_GROUPS = 20;
const MAX_EXPORT_FILES = 128;
const MAX_EXPORT_BYTES = 128 * 1024 * 1024;
const CACHE_FILE = /^image-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(?:png|jpg|webp)$/;

type Image = Content & { data: string; mimeType: string };
type ExportedImage = { imageIndex: number; mimeType: string; path: string; size: number };
type Job = {
  path: string; size: number; created: boolean; waiters: number; retained: boolean;
  result: Promise<ExportedImage>; cleanup?: Promise<void>;
};

function imageGroup(entry: HistoryEntry) {
  const custom = entry as HistoryEntry & Pick<Message, 'customType' | 'content' | 'display'> & { timestamp?: string };
  const message = entry.type === 'message' && entry.message?.role === 'user' ? entry.message
    : custom.type === 'custom_message' && custom.customType === 'desktop-goal-input' && custom.display === true
      ? { role: 'custom', customType: custom.customType, content: custom.content, timestamp: Date.parse(custom.timestamp ?? '') }
      : undefined;
  if (!message || !isUserMessage(message) || !Array.isArray(message.content)) return undefined;
  const images = message.content.filter((block): block is Image => block.type === 'image' && !block.historical
    && typeof block.data === 'string' && block.data.length > 0 && IMAGE_MIMES.some(mime => mime === block.mimeType));
  if (!images.length) return undefined;
  return { messageId: entry.id, timestamp: Number.isFinite(message.timestamp) ? message.timestamp : undefined,
    images: images.slice(0, MAX_IMAGES) };
}

export class SessionAttachmentExports {
  private jobs = new Map<SessionRuntime, Map<string, Job>>();
  private cleaning = new Set<Promise<void>>();
  private count = 0;
  private size = 0;

  constructor(private directory: string) {}

  async clearStale() {
    // The app's single-instance profile owns this scratch directory.
    if (!(await lstat(this.directory).catch(() => undefined))?.isDirectory()) return;
    const entries = await readdir(this.directory, { withFileTypes: true }).catch(() => []);
    await Promise.all(entries.filter(entry => entry.isFile() && CACHE_FILE.test(entry.name))
      .map(entry => unlink(join(this.directory, entry.name)).catch(() => {})));
  }

  async request(worker: SessionRuntime, request: Record<string, unknown>, assertOwner: () => void) {
    const { operation, messageId, imageIndex } = request;
    const allowed = operation === 'list' ? ['action', 'operation'] : ['action', 'operation', 'messageId', 'imageIndex'];
    if ((operation !== 'list' && operation !== 'export') || Object.keys(request).some(key => !allowed.includes(key)))
      throw new Error('Expected an attachment list or export request');
    if (messageId !== undefined && (typeof messageId !== 'string' || !messageId.trim() || messageId.length > 200)
      || imageIndex !== undefined && (typeof imageIndex !== 'number' || !Number.isInteger(imageIndex) || imageIndex < 1 || imageIndex > MAX_IMAGES))
      throw new Error('Invalid attachment selection');
    assertOwner();
    const scope = this.jobs.get(worker) ?? new Map<string, Job>();
    this.jobs.set(worker, scope);
    const check = () => {
      assertOwner();
      if (this.jobs.get(worker) !== scope) throw new Error('Source session connection expired');
    };
    // Model context omits compacted turns; the saved branch still owns their images.
    const history = await worker.rpc.request('get_entries');
    check();
    if (!Array.isArray(history.entries) || (history.leafId !== null && typeof history.leafId !== 'string'))
      throw new Error('Session attachment history is unavailable');
    const messages = [];
    let group: ReturnType<typeof imageGroup>;
    for (const entry of activeHistory(history.entries, history.leafId).reverse()) {
      if (messageId !== undefined && entry.id !== messageId) continue;
      group = imageGroup(entry);
      if (operation === 'export' && (group || messageId !== undefined)) break;
      if (!group) continue;
      messages.push({ messageId: group.messageId, timestamp: group.timestamp,
        images: group.images.map(({ mimeType }, i) => ({ imageIndex: i + 1, mimeType })) });
      if (messages.length === MAX_GROUPS) break;
    }
    if (operation === 'list') return { messages };
    if (!group) throw new Error(messageId === undefined ? 'No user image attachments in the current conversation'
      : 'The selected message has no user image attachments in the active branch; list the attachments again');
    const selected = group.images.map((image, i) => ({ image, index: i + 1 }))
      .filter(({ index }) => imageIndex === undefined || imageIndex === index);
    if (!selected.length) throw new Error('Image index not found in the selected message');
    const acquired: { key: string; job: Job }[] = [];
    try {
      for (const { image, index } of selected) {
        const key = JSON.stringify([group.messageId, index]);
        const job = scope.get(key) ?? this.createJob(image, index);
        // Reserve the pending write before yielding so concurrent exports share it.
        scope.set(key, job);
        job.waiters++;
        acquired.push({ key, job });
      }
      const images = await Promise.all(acquired.map(({ job }) => job.result));
      check();
      for (const { job } of acquired) job.retained = true;
      return { messageId: group.messageId, images };
    } finally {
      const cleanup = [];
      for (const { key, job } of acquired) {
        if (--job.waiters || job.retained) continue;
        if (scope.get(key) === job) scope.delete(key);
        cleanup.push(this.remove(job));
      }
      await Promise.all(cleanup);
    }
  }

  private createJob(image: Image, imageIndex: number) {
    const { bytes, mimeType } = decodeImageUrl(`data:${image.mimeType};base64,${image.data}`);
    const size = bytes.length;
    if (this.count >= MAX_EXPORT_FILES || this.size + size > MAX_EXPORT_BYTES)
      throw new Error('Temporary attachment cache is full; reconnect the session to clear its exports');
    const path = join(this.directory, imageFileName(`image-${randomUUID()}`, mimeType));
    this.count++;
    this.size += size;
    const result = this.write(path, bytes, () => { job.created = true; })
      .then(() => ({ imageIndex, mimeType, path, size }));
    const job: Job = { path, size, created: false, waiters: 0, retained: false, result };
    return job;
  }

  private async write(path: string, bytes: Buffer, onCreated: () => void) {
    try {
      await mkdir(this.directory, { recursive: true, mode: 0o700 });
      if (!(await lstat(this.directory)).isDirectory()) throw new Error('Invalid cache directory');
      const file = await open(path, 'wx', 0o600);
      onCreated();
      try { await file.writeFile(bytes); } finally { await file.close(); }
    } catch {
      throw new Error('Could not write the temporary attachment');
    }
  }

  private remove(job: Job) {
    if (job.cleanup) return job.cleanup;
    const cleaning = job.result.catch(() => undefined).then(async () => {
      const deleted = !job.created || await unlink(job.path).then(() => true, error => error.code === 'ENOENT');
      // Keep failed deletions against the quota until a new launch can clear them.
      if (deleted) { this.count--; this.size -= job.size; }
    }).finally(() => { this.cleaning.delete(cleaning); });
    job.cleanup = cleaning;
    this.cleaning.add(cleaning);
    return cleaning;
  }

  detach(worker: SessionRuntime) {
    const scope = this.jobs.get(worker);
    this.jobs.delete(worker);
    for (const job of scope?.values() ?? []) this.remove(job);
  }

  async stop() {
    for (const worker of this.jobs.keys()) this.detach(worker);
    await Promise.all(this.cleaning);
  }
}
