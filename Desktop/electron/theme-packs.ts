import { lstat, open, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, resolve, relative, isAbsolute, sep } from 'node:path';
import type { StellarScene, ThemeImage, ThemePack } from '../src/theme-packs';
import { contrastRatio } from '../src/theme';
import { parseThemeComposition } from './theme-composition.mjs';
import { plainFile } from './plugin-files.mjs';
import { MAX_THEME_IMAGE_BYTES, validateThemeImage, type ThemeImageDecoder } from './theme-images';

const safeName = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,79}$/;
const color = /^#[0-9a-f]{6}$/i;
const record = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);
const bounded = (v: unknown, min: number, max: number): v is number =>
  typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;

// Bounded data only. Never evaluate plugin scripts or expose filesystem paths.
async function boundedFile(root: string, path: string, limit: number) {
  const target = resolve(root, path), rel = relative(root, target);
  if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new Error('Invalid theme path');
  let current = root;
  for (const part of ['', ...rel.split(sep)]) {
    if (part) current = join(current, part);
    if ((await lstat(current)).isSymbolicLink()) throw new Error('Theme links are not supported');
  }
  const file = await open(target, 'r');
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > limit) throw new Error('Theme file too large');
    const bytes = Buffer.alloc(limit + 1);
    const { bytesRead } = await file.read(bytes, 0, bytes.length, 0);
    if (bytesRead > limit) throw new Error('Theme file too large');
    return bytes.subarray(0, bytesRead);
  } finally { await file.close(); }
}
async function json(root: string, path: string, limit: number) {
  return JSON.parse((await boundedFile(root, path, limit)).toString('utf8')) as unknown;
}
async function readCover(root: string, folder: string, filename: unknown) {
  if (filename !== 'cover.png') return undefined;
  try {
    const bytes = await boundedFile(root, `${folder}/cover.png`, 512 * 1024);
    if (bytes.length < 33 || !bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))
      || bytes.readUInt32BE(8) !== 13 || bytes.toString('ascii', 12, 16) !== 'IHDR') return undefined;
    const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20);
    if (!width || !height || width > 1920 || height > 1080) return undefined;
    return `data:image/png;base64,${bytes.toString('base64')}`;
  } catch { return undefined; }
}

export function validateScene(value: unknown): StellarScene {
  if (!record(value) || !record(value.dragons) || value.dragons.stride !== 7
    || !Array.isArray(value.dragons.groups) || value.dragons.groups.length !== 2 || !record(value.duck))
    throw new Error('Invalid stellar scene');
  function points(v: Record<string, any>, stride: number) {
    if (!bounded(v.width, 1, 4096) || !bounded(v.height, 1, 4096)
      || !bounded(v.width / v.height, .2, 5)
      || !Array.isArray(v.points) || !v.points.length || v.points.length > 500000 || v.points.length % stride
      || !v.points.every((n: unknown, i: number) => bounded(n, 0, i % stride < 2 ? 4096 : 255)))
      throw new Error('Invalid stellar points');
  }
  points(value.duck, 6);
  if (value.duck.stride !== 6) throw new Error('Invalid duck stride');
  for (const g of value.dragons.groups) {
    if (!record(g)) throw new Error('Invalid dragon');
    points(g, 7);
    if (!g.points.some((n: number, i: number) => i % 7 === 3 && n === 0))
      throw new Error('Empty dragon silhouette');
    if (!bounded(g.layoutWidth, 1, 4096) || !bounded(g.layoutHeight, 1, 4096)
      || !record(g.eye) || !record(g.relic)
      || !['x', 'y', 'rx', 'ry'].every(k => bounded(g.eye[k], 0, 4096))
      || !bounded(g.eye.rx, .01, 4096) || !bounded(g.eye.ry, .01, 4096)
      || !['x', 'y', 'radius'].every(k => bounded(g.relic[k], 0, 4096))
      || !Array.isArray(g.palette) || g.palette.length < 2 || g.palette.length > 16
      || !g.palette.every((p: unknown) => Array.isArray(p) && p.length === 3 && p.every(n => bounded(n, 0, 255))))
      throw new Error('Invalid dragon geometry');
  }
  return value as unknown as StellarScene;
}

export class ThemePacks {
  packs: ThemePack[] = [];
  private scenes = new Map<string, StellarScene>();
  private covers = new Map<string, string>();
  private images = new Map<string, ThemeImage>();
  constructor(private root: string, private decodeImage?: ThemeImageDecoder) { this.root = resolve(root); }
  async refresh() {
    const packs: ThemePack[] = [], scenes = new Map<string, StellarScene>(), covers = new Map<string, string>();
    const images = new Map<string, ThemeImage>();
    let retainedImageBytes = 0;
    let entries;
    try {
      if ((await lstat(this.root)).isSymbolicLink()) throw new Error('Invalid plugins directory');
      entries = await readdir(this.root, { withFileTypes: true });
    } catch { this.packs = []; this.scenes.clear(); this.covers.clear(); this.images.clear(); return; }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name)).slice(0, 128)) {
      if (!entry.isDirectory() || !safeName.test(entry.name)) continue;
      try {
        const manifest = await json(this.root, `${entry.name}/step.plugin.json`, 32768);
        const raw = await json(this.root, `${entry.name}/dfsc.theme.json`, 32768);
        if (!record(manifest) || typeof manifest.id !== 'string' || !safeName.test(manifest.id) || !record(raw)
          || typeof raw.name !== 'string' || !raw.name.trim() || raw.name.length > 80 || /[\u0000-\u001f]/u.test(raw.name)
          || typeof manifest.version !== 'string' || manifest.version.length > 32
          || !record(raw.colors) || !['light', 'dark'].includes(raw.scheme)) continue;
        const composition = parseThemeComposition(raw);
        // This is a material restriction, not a restriction on the background.
        if (composition.ui === 'stellar-v1' && raw.scheme !== 'dark') continue;
        const colors: Record<string, string> = {};
        for (const key of ['bg', 'side', 'surface', 'ink', 'muted', 'border', 'code', 'accent']) {
          if (typeof raw.colors[key] !== 'string' || !color.test(raw.colors[key])) throw new Error('Invalid theme color');
          colors[key] = raw.colors[key];
        }
        for (const fg of ['ink', 'muted']) for (const bg of ['bg', 'side', 'surface', 'code'])
          if (contrastRatio(colors[fg], colors[bg]) < 4.5) throw new Error('Unreadable theme palette');
        const scene = composition.background.renderer === 'stellar-v1'
          ? validateScene(await json(this.root, `${entry.name}/scene.json`, 6 * 1024 * 1024)) : undefined;
        let image: ThemeImage | undefined;
        if (composition.background.renderer === 'image-v1') {
          if (!this.decodeImage) throw new Error('Image decoder unavailable');
          const filename = composition.background.source!;
          const bytes = await plainFile(join(this.root, entry.name), filename, MAX_THEME_IMAGE_BYTES);
          image = validateThemeImage(bytes, filename, this.decodeImage);
          if (retainedImageBytes + image.dataUrl.length > 48 * 1024 * 1024) throw new Error('Theme image budget exceeded');
        }
        const id = `plugin:${entry.name}` as const;
        const cover = await readCover(this.root, entry.name, raw.cover);
        if (cover) covers.set(id, cover);
        const author = typeof raw.author === 'string' && raw.author.length <= 80
          && !/[\u0000-\u001f]/u.test(raw.author) ? raw.author.trim() : undefined;
        const revision = createHash('sha256').update(JSON.stringify([composition, scene]))
          .update(image?.dataUrl ?? '').update(cover ?? '').digest('hex');
        packs.push({ id, name: raw.name, version: manifest.version, revision, renderer: composition.background.renderer, composition,
          author, hasCover: Boolean(cover),
          palette: { bg: colors.bg, side: colors.side, surface: colors.surface, ink: colors.ink,
            muted: colors.muted, border: colors.border, code: colors.code, accent: colors.accent,
            id, scheme: raw.scheme, group: 'plugin',
            name: [raw.name, raw.name], title: [raw.name, raw.name], mood: ['', ''] } });
        if (scene) scenes.set(id, scene);
        if (image) { images.set(id, image); retainedImageBytes += image.dataUrl.length; }
        // Bound total retained geometry as well as each individual file.
        if (packs.length >= 8) break;
      } catch { /* A malformed pack must not prevent Desktop startup. */ }
    }
    this.packs = packs;
    this.scenes = scenes;
    this.covers = covers;
    this.images = images;
  }
  poster(id: unknown) {
    if (typeof id !== 'string' || !this.packs.some(pack => pack.id === id)) throw new Error('Theme unavailable');
    return this.covers.get(id) ?? this.images.get(id)?.dataUrl;
  }
  image(id: unknown) {
    if (typeof id !== 'string' || !this.images.has(id)) throw new Error('Theme image unavailable');
    return this.images.get(id)!;
  }
  scene(id: unknown) {
    if (typeof id !== 'string' || !this.scenes.has(id)) throw new Error('Theme unavailable');
    return this.scenes.get(id)!;
  }
}
