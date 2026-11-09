import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, open, realpath, rename, unlink } from 'node:fs/promises';
import type { Stats } from 'node:fs';
import { basename, dirname, extname, isAbsolute, join, resolve } from 'node:path';
import {
  DEFAULT_BACKGROUND_OPTIONS, normalizeBackgroundOptions, validateBackgroundPatch,
  type BackgroundImageDescriptor, type StoredBackgroundState,
} from '../src/custom-background';
import { plainFile } from './plugin-files.mjs';
import {
  MAX_THEME_IMAGE_BYTES, MAX_THEME_IMAGE_EDGE, MAX_THEME_IMAGE_PIXELS,
  validateThemeImage, type ThemeImage, type ThemeImageDecoder,
} from './theme-images';

interface SavedBackground {
  schemaVersion: 1;
  instance?: string;
  options: StoredBackgroundState['options'];
  image?: BackgroundImageDescriptor;
}

const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const failure = (code = 'storage') => new Error(`custom-background:${code}`);
const sameFile = (a: Stats, b: Stats) => a.dev === b.dev && a.ino === b.ino;
const revisionPattern = /^[a-f0-9]{64}$/u;
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const validInstance = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= 512 && !/[\u0000-\u001f\u007f]/u.test(value);
const assetName = (revision: string) => `image-${revision}.png`;

function descriptor(value: unknown): BackgroundImageDescriptor | undefined {
  if (value === undefined) return;
  if (!record(value) || Object.keys(value).length !== 3 || typeof value.revision !== 'string'
    || !revisionPattern.test(value.revision)
    || typeof value.width !== 'number' || !Number.isInteger(value.width) || value.width < 1 || value.width > MAX_THEME_IMAGE_EDGE
    || typeof value.height !== 'number' || !Number.isInteger(value.height) || value.height < 1 || value.height > MAX_THEME_IMAGE_EDGE
    || value.width * value.height > MAX_THEME_IMAGE_PIXELS) throw failure('invalid');
  return { revision: value.revision, width: value.width, height: value.height };
}

export class CustomBackgroundStore {
  private readonly userData: string;
  private readonly root: string;
  private writes: Promise<unknown> = Promise.resolve();
  private initialized = false;
  private instance?: string;
  private parentIdentity?: Stats;
  private directoryIdentity?: Stats;
  private current: StoredBackgroundState = { options: { ...DEFAULT_BACKGROUND_OPTIONS } };

  constructor(userData: string, private readonly decodeImage: ThemeImageDecoder) {
    this.userData = resolve(userData);
    this.root = join(this.userData, 'custom-background');
  }

  state(): StoredBackgroundState { return structuredClone(this.current); }
  isBoundTo(instance?: string): boolean { return this.initialized && this.instance === instance; }

  private enqueue<T>(action: () => Promise<T>): Promise<T> {
    const operation = this.writes.then(async () => {
      if (!this.initialized) await this.load();
      return action();
    });
    this.writes = operation.catch(() => {});
    return operation;
  }

  private async directory(create = false, expected?: Stats): Promise<Stats> {
    const parent = await lstat(this.userData);
    if (!parent.isDirectory() || parent.isSymbolicLink() || resolve(await realpath(this.userData)) !== this.userData)
      throw failure();
    if (this.parentIdentity && !sameFile(this.parentIdentity, parent)) throw failure();
    if (create) {
      try { await mkdir(this.root, { mode: 0o700 }); }
      catch (error: any) { if (error.code !== 'EEXIST') throw error; }
    }
    const directory = await lstat(this.root);
    if (!directory.isDirectory() || directory.isSymbolicLink() || resolve(await realpath(this.root)) !== this.root
      || expected && !sameFile(expected, directory)
      || this.directoryIdentity && !sameFile(this.directoryIdentity, directory)
      || !sameFile(parent, await lstat(this.userData))) throw failure();
    this.parentIdentity ??= parent;
    this.directoryIdentity ??= directory;
    return directory;
  }

  private async leaf(name: string, limit: number): Promise<Buffer> {
    const directory = await this.directory();
    const bytes = await plainFile(this.root, name, limit);
    await this.directory(false, directory);
    return bytes;
  }

  private async readImage(image: BackgroundImageDescriptor): Promise<ThemeImage> {
    const bytes = await this.leaf(assetName(image.revision), MAX_THEME_IMAGE_BYTES);
    if (sha256(bytes) !== image.revision) throw failure('invalid');
    let normalized: ThemeImage;
    try { normalized = validateThemeImage(bytes, 'background.png', this.decodeImage); }
    catch { throw failure('invalid'); }
    if (normalized.width !== image.width || normalized.height !== image.height) throw failure('invalid');
    return normalized;
  }

  private async load(): Promise<void> {
    this.initialized = true;
    try {
      await this.directory(true);
      let bytes: Buffer;
      try { bytes = await this.leaf('state.json', 16384); }
      catch (error: any) { if (error.code === 'ENOENT') return; throw error; }
      let saved: unknown;
      try { saved = JSON.parse(bytes.toString('utf8')); }
      catch { throw failure('invalid'); }
      if (!record(saved) || saved.schemaVersion !== 1
        || Object.keys(saved).some(key => !['schemaVersion', 'instance', 'options', 'image'].includes(key))
        || saved.instance !== undefined && !validInstance(saved.instance)
        || !record(saved.options)) throw failure('invalid');
      const image = descriptor(saved.image);
      this.instance = saved.instance;
      this.current = { options: normalizeBackgroundOptions(saved.options), ...(image ? { image } : {}) };
      // An unbound profile must never activate a copied or half-written configuration.
      if (!this.instance) this.current.options.enabled = false;
      if (image) {
        try { await this.readImage(image); }
        catch (error: any) {
          this.current.issue = error.code === 'ENOENT' ? 'missing'
            : error.message === 'custom-background:invalid' || error.message === 'Invalid theme image' ? 'invalid' : 'storage';
        }
      }
    } catch (error: any) {
      this.current = { options: { ...DEFAULT_BACKGROUND_OPTIONS },
        issue: error.message === 'custom-background:invalid' ? 'invalid' : 'storage' };
      this.instance = undefined;
    }
  }

  initialize(): Promise<StoredBackgroundState> { return this.enqueue(async () => this.state()); }

  private async writeState(next: StoredBackgroundState, instance: string | undefined): Promise<void> {
    const directory = await this.directory(true);
    const temporary = `state-${randomUUID()}.tmp`;
    const target = join(this.root, temporary);
    const saved: SavedBackground = { schemaVersion: 1, options: next.options,
      ...(instance ? { instance } : {}), ...(next.image ? { image: next.image } : {}) };
    let created = false;
    try {
      const handle = await open(target, 'wx', 0o600);
      created = true;
      try { await handle.writeFile(JSON.stringify(saved)); await handle.sync(); }
      finally { await handle.close(); }
      await this.directory(false, directory);
      try {
        const current = await lstat(join(this.root, 'state.json'));
        if (!current.isFile() || current.isSymbolicLink()) throw failure();
      } catch (error: any) { if (error.code !== 'ENOENT') throw error; }
      await rename(target, join(this.root, 'state.json'));
      created = false;
      await this.directory(false, directory);
    } catch {
      throw failure();
    } finally {
      if (created) await this.removeTemporary(temporary, directory);
    }
  }

  private async removeTemporary(name: string, directory: Stats): Promise<void> {
    try {
      await this.directory(false, directory);
      const file = await lstat(join(this.root, name));
      if (file.isFile() && !file.isSymbolicLink()) await unlink(join(this.root, name));
    } catch { /* Failed writes must not remove an entry from a replaced directory. */ }
  }

  private async discard(image: BackgroundImageDescriptor): Promise<void> {
    try {
      const directory = await this.directory();
      const bytes = await this.leaf(assetName(image.revision), MAX_THEME_IMAGE_BYTES);
      if (sha256(bytes) !== image.revision) return;
      await this.directory(false, directory);
      await unlink(join(this.root, assetName(image.revision)));
    } catch { /* An inactive cleanup failure cannot invalidate the committed image. */ }
  }

  private async stage(bytes: Buffer, image: BackgroundImageDescriptor): Promise<boolean> {
    const directory = await this.directory(true);
    const name = assetName(image.revision);
    const target = join(this.root, name);
    let existing: Stats | undefined;
    try {
      existing = await lstat(target);
      if (!existing.isFile() || existing.isSymbolicLink()) throw failure();
      if (existing.size <= MAX_THEME_IMAGE_BYTES && (await this.leaf(name, MAX_THEME_IMAGE_BYTES)).equals(bytes))
        return false;
    } catch (error: any) { if (error.code !== 'ENOENT') throw failure(); }
    // Publish only complete images; an interrupted legacy write may have left a partial candidate.
    const temporary = `image-${randomUUID()}.tmp`;
    let created = false;
    try {
      const handle = await open(join(this.root, temporary), 'wx', 0o600);
      created = true;
      try { await handle.writeFile(bytes); await handle.sync(); }
      finally { await handle.close(); }
      await this.directory(false, directory);
      let current: Stats | undefined;
      try { current = await lstat(target); }
      catch (error: any) { if (error.code !== 'ENOENT') throw error; }
      if (existing ? !current || !current.isFile() || current.isSymbolicLink()
        || !sameFile(existing, current) || existing.size !== current.size || existing.mtimeMs !== current.mtimeMs
        : current !== undefined) throw failure();
      await rename(join(this.root, temporary), target);
      created = false;
      await this.directory(false, directory);
      // A repaired image already referenced by committed metadata must survive metadata-write failure.
      return this.current.image?.revision !== image.revision;
    } catch {
      throw failure();
    } finally {
      if (created) await this.removeTemporary(temporary, directory);
    }
  }

  image(revision: unknown): Promise<ThemeImage> {
    return this.enqueue(async () => {
      if (typeof revision !== 'string' || !revisionPattern.test(revision) || revision !== this.current.image?.revision)
        throw failure('stale-image');
      try {
        const image = await this.readImage(this.current.image);
        delete this.current.issue;
        return { ...image };
      } catch (error: any) {
        this.current.issue = error.code === 'ENOENT' ? 'missing'
          : error.message === 'custom-background:invalid' || error.message === 'Invalid theme image' ? 'invalid' : 'storage';
        throw failure(this.current.issue);
      }
    });
  }

  importFile(path: string): Promise<StoredBackgroundState> {
    return this.enqueue(async () => {
      if (!this.instance) throw failure('unavailable');
      const extension = typeof path === 'string' ? extname(path).toLowerCase() : '';
      if (typeof path !== 'string' || !isAbsolute(path) || path.includes('\0')
        || !['.png', '.jpg', '.jpeg'].includes(extension)) throw failure('invalid-image');
      let image: ThemeImage;
      try {
        const selected = await lstat(path);
        if (!selected.isFile() || selected.isSymbolicLink()) throw failure('invalid-image');
        const canonical = await realpath(path);
        const bytes = await plainFile(dirname(canonical), basename(canonical), MAX_THEME_IMAGE_BYTES);
        const after = await lstat(path);
        if (after.isSymbolicLink() || !sameFile(selected, after) || selected.size !== after.size
          || selected.mtimeMs !== after.mtimeMs || await realpath(path) !== canonical) throw failure('invalid-image');
        image = validateThemeImage(bytes, extension === '.png' ? 'background.png' : 'background.jpg', this.decodeImage);
      } catch { throw failure('invalid-image'); }
      const bytes = Buffer.from(image.dataUrl.slice('data:image/png;base64,'.length), 'base64');
      const candidate: BackgroundImageDescriptor = { revision: sha256(bytes), width: image.width, height: image.height };
      const previous = this.current.image;
      const next: StoredBackgroundState = { options: { ...this.current.options, enabled: true }, image: candidate };
      const created = await this.stage(bytes, candidate);
      try { await this.writeState(next, this.instance); }
      catch (error) { if (created) await this.discard(candidate); throw error; }
      this.current = next;
      if (previous && previous.revision !== candidate.revision) await this.discard(previous);
      return this.state();
    });
  }

  save(value: unknown): Promise<StoredBackgroundState> {
    let patch: ReturnType<typeof validateBackgroundPatch>;
    try { patch = validateBackgroundPatch(value); }
    catch (error) { return Promise.reject(error); }
    return this.enqueue(async () => {
      if (patch.enabled && !this.instance) throw failure('unavailable');
      if (patch.enabled) {
        if (!this.current.image) throw failure('missing');
        try { await this.readImage(this.current.image); }
        catch (error: any) {
          throw failure(error.code === 'ENOENT' ? 'missing'
            : error.message === 'custom-background:invalid' ? 'invalid' : 'storage');
        }
      }
      const next: StoredBackgroundState = { ...this.state(), options: { ...this.current.options, ...patch } };
      await this.writeState(next, this.instance);
      this.current = next;
      return this.state();
    });
  }

  remove(): Promise<StoredBackgroundState> {
    return this.enqueue(async () => {
      const previous = this.current.image;
      const next: StoredBackgroundState = { options: { ...this.current.options, enabled: false } };
      await this.writeState(next, this.instance);
      this.current = next;
      if (previous) await this.discard(previous);
      return this.state();
    });
  }

  bind(instance?: string): Promise<StoredBackgroundState> {
    if (instance !== undefined && !validInstance(instance)) return Promise.reject(failure('invalid-input'));
    return this.enqueue(async () => {
      if (instance === this.instance) return this.state();
      const next: StoredBackgroundState = { ...this.state(), options: { ...this.current.options, enabled: false } };
      await this.writeState(next, instance);
      this.instance = instance;
      this.current = next;
      return this.state();
    });
  }
}
