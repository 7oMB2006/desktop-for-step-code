import { randomUUID } from 'node:crypto';
import { lstat } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep, posix } from 'node:path';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import semver from 'semver';
import { digest, object, optionalFile, packageFingerprint, packagePath, plainFile, PluginFileError } from './plugin-files.mjs';

const bounded = (value, max = 160) => {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\u0000-\u001f]/u.test(value))
    throw new PluginFileError('invalid-presentation');
  return value.trim();
};
export function documentUrl(value) {
  try {
    const url = new URL(bounded(value, 2048));
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : undefined;
  } catch { return undefined; }
}
const list = (value, max = 8) => {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > max) throw new PluginFileError('invalid-presentation');
  return value;
};
const markdownPath = value => {
  packagePath(value);
  if (!/\.md$/iu.test(value)) throw new PluginFileError('invalid-path');
  return value;
};
const terms = (value, max, category = false) => {
  const items = list(value, max).map(item => bounded(item, 48));
  if (new Set(items).size !== items.length || category && items.some(item => !/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u.test(item)))
    throw new PluginFileError('invalid-presentation');
  return items;
};
const desktopId = value => {
  const id = bounded(value, 64);
  if (id !== value || !/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u.test(id)) throw new PluginFileError('invalid-presentation');
  return id;
};
const onlyKeys = (value, keys) => {
  if (!object(value) || Object.keys(value).some(key => !keys.includes(key)))
    throw new PluginFileError('invalid-presentation');
};
function parseDesktop(value) {
  onlyKeys(value, ['title', 'surface', 'symbol', 'icon', 'defaultPage', 'pages']);
  if (!['main-view', 'side-panel', 'window'].includes(value.surface)
    || value.symbol !== undefined && !['plug', 'bot', 'book', 'wrench', 'sparkles'].includes(value.symbol))
    throw new PluginFileError('invalid-presentation');
  const pages = list(value.pages).map(page => {
    onlyKeys(page, ['id', 'title', 'document']);
    return { id: desktopId(page.id), title: bounded(page.title), document: markdownPath(bounded(page.document, 256)) };
  });
  if (!pages.length || new Set(pages.map(page => page.id)).size !== pages.length)
    throw new PluginFileError('invalid-presentation');
  const defaultPage = value.defaultPage === undefined ? undefined : desktopId(value.defaultPage);
  if (defaultPage !== undefined && !pages.some(page => page.id === defaultPage))
    throw new PluginFileError('invalid-presentation');
  let icon;
  if (value.icon !== undefined) {
    onlyKeys(value.icon, ['light', 'dark']);
    const imagePath = value => {
      const path = packagePath(bounded(value, 256));
      if (!/\.(?:png|jpe?g|webp|ico)$/iu.test(path)) throw new PluginFileError('invalid-path');
      return path;
    };
    icon = { light: imagePath(value.icon.light),
      ...(value.icon.dark !== undefined ? { dark: imagePath(value.icon.dark) } : {}) };
  }
  return { title: bounded(value.title), surface: value.surface, pages,
    ...(value.symbol !== undefined ? { symbol: value.symbol } : {}),
    ...(icon ? { icon } : {}), ...(defaultPage !== undefined ? { defaultPage } : {}) };
}
function parseRequirements(value) {
  onlyKeys(value, ['dfsc', 'external']);
  const requirements = {};
  if (value.dfsc !== undefined) {
    const range = bounded(value.dfsc, 128);
    if (!semver.validRange(range)) throw new PluginFileError('invalid-presentation');
    requirements.dfsc = range;
  }
  if (value.external !== undefined) requirements.external = list(value.external, 12).map(item => {
    onlyKeys(item, ['name', 'description', 'url', 'optional']);
    if (item.optional !== undefined && typeof item.optional !== 'boolean')
      throw new PluginFileError('invalid-presentation');
    const url = item.url === undefined ? undefined : documentUrl(item.url);
    if (item.url !== undefined && !url) throw new PluginFileError('invalid-presentation');
    return { name: bounded(item.name),
      ...(item.description !== undefined ? { description: bounded(item.description, 512) } : {}),
      ...(url !== undefined ? { url } : {}),
      ...(item.optional !== undefined ? { optional: item.optional } : {}) };
  });
  return requirements;
}
export function parsePresentation(value) {
  if (!object(value) || value.schemaVersion !== 1) throw new PluginFileError('invalid-presentation');
  const names = items => list(items).map(item => {
    if (!object(item)) throw new PluginFileError('invalid-presentation');
    return bounded(item.name);
  }).join(', ') || undefined;
  const documentation = {};
  if (value.documentation !== undefined) {
    if (!object(value.documentation)) throw new PluginFileError('invalid-presentation');
    for (const key of ['readme', 'changelog']) if (value.documentation[key] !== undefined)
      documentation[key] = markdownPath(value.documentation[key]);
  }
  const locales = {};
  if (value.locales !== undefined) {
    if (!object(value.locales) || Object.keys(value.locales).some(key => !['zh', 'en'].includes(key)))
      throw new PluginFileError('invalid-presentation');
    for (const [language, locale] of Object.entries(value.locales)) {
      if (!object(locale)) throw new PluginFileError('invalid-presentation');
      const entry = {};
      if (locale.description !== undefined) entry.description = bounded(locale.description, 2048);
      if (locale.documentation !== undefined) {
        if (!object(locale.documentation)) throw new PluginFileError('invalid-presentation');
        entry.documentation = {};
        for (const key of ['readme', 'changelog']) if (locale.documentation[key] !== undefined)
          entry.documentation[key] = markdownPath(locale.documentation[key]);
      }
      locales[language] = entry;
    }
  }
  const tutorials = list(value.tutorials).map(item => {
    const url = documentUrl(item?.url);
    if (!url || !['author', 'community'].includes(item.kind)) throw new PluginFileError('invalid-presentation');
    const host = new URL(url).hostname;
    const source = /(^|\.)bilibili\.com$/u.test(host) || host === 'b23.tv' ? 'Bilibili'
      : /(^|\.)youtube\.com$/u.test(host) || host === 'youtu.be' ? 'YouTube' : host;
    return { title: bounded(item.title), creator: bounded(item.creator), kind: item.kind, source, url };
  });
  const links = list(value.links).map(item => {
    const url = documentUrl(item?.url);
    if (!url) throw new PluginFileError('invalid-presentation');
    return { title: bounded(item.title), url };
  });
  return { author: names(value.authors), maintainer: names(value.maintainers),
    license: value.license === undefined ? undefined : bounded(value.license, 128), documentation, tutorials, links,
    ...(value.categories !== undefined ? { categories: terms(value.categories, 3, true) } : {}),
    ...(value.keywords !== undefined ? { keywords: terms(value.keywords, 5) } : {}),
    ...(value.desktop !== undefined ? { desktop: parseDesktop(value.desktop) } : {}),
    ...(value.requirements !== undefined ? { requirements: parseRequirements(value.requirements) } : {}),
    ...(Object.keys(locales).length ? { locales } : {}) };
}
async function fileExists(root, path) {
  try {
    const info = await lstat(resolve(root, packagePath(path)));
    return info.isFile() && !info.isSymbolicLink();
  } catch { return false; }
}
function localTarget(from, url) {
  if (typeof url !== 'string' || !url || /^(?:[a-z][\w+.-]*:|\/|\\)/iu.test(url)) return undefined;
  const [path, anchor] = url.split('#', 2);
  try {
    const decoded = decodeURIComponent(path);
    if (/[:\\\0?#]/u.test(decoded)) return undefined;
    const target = path ? posix.normalize(posix.join(posix.dirname(from), decoded)) : from;
    packagePath(target);
    return { path: target, anchor: anchor ? `#${encodeURIComponent(decodeURIComponent(anchor))}` : '' };
  } catch { return undefined; }
}
function imageType(bytes) {
  if (bytes.length > 24 && bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) {
    if (bytes.readUInt32BE(16) > 4096 || bytes.readUInt32BE(20) > 4096 || !bytes.readUInt32BE(16) || !bytes.readUInt32BE(20)) return undefined;
    return 'image/png';
  }
  // Main-process nativeImage validates JPEG/WebP dimensions before they reach the renderer.
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return 'image/jpeg';
  if (bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
}
function desktopImageType(bytes) {
  const mime = imageType(bytes);
  if (mime === 'image/png' && (bytes.readUInt32BE(16) > 512 || bytes.readUInt32BE(20) > 512)) return undefined;
  if (mime) return mime;
  if (bytes.length >= 22 && bytes.readUInt32LE(0) === 0x00010000) {
    const count = bytes.readUInt16LE(4);
    if (count > 0 && count <= 256 && bytes.length >= 6 + count * 16) return 'image/x-icon';
  }
}
export class PluginLibrary {
  references = new Map();
  constructor(root, validateImage) { this.root = resolve(root); this.validateImage = validateImage; }
  invalidate() { this.references.clear(); }
  async project(catalog) {
    const current = new Set();
    const project = async plugin => {
      const { packageDescriptor: descriptor, ...publicPlugin } = plugin;
      if (!descriptor) return publicPlugin;
      try {
        const root = resolve(descriptor.root);
        const rel = relative(this.root, root);
        if (!rel || rel.startsWith(`..${sep}`) || isAbsolute(rel)
          || !['plugins', 'marketplaces'].includes(rel.split(sep)[0])) throw new PluginFileError('invalid-path');
        let cursor = this.root;
        for (const part of rel.split(sep)) {
          cursor = resolve(cursor, part);
          if ((await lstat(cursor)).isSymbolicLink()) throw new PluginFileError('invalid-path');
        }
        const key = digest(JSON.stringify(descriptor));
        let reference = [...this.references.values()].find(item => item.key === key);
        if (!reference) {
          reference = { key, ref: randomUUID(), descriptor: { ...descriptor, repository: publicPlugin.repository }, allowed: new Set() };
          this.references.set(reference.ref, reference);
        }
        current.add(reference.ref);
        let metadata = { documentation: {}, tutorials: [], links: [] }, warnings = [];
        try {
          const bytes = await optionalFile(root, 'dfsc.plugin.json', 65536);
          if (bytes) {
            const value = JSON.parse(bytes.toString('utf8'));
            if (!object(value)) throw new PluginFileError('invalid-presentation');
            const { desktop, requirements, ...presentation } = value;
            metadata = parsePresentation(presentation);
            if (desktop !== undefined) {
              try { metadata.desktop = parseDesktop(desktop); }
              catch { warnings.push('Invalid or unsupported Desktop workspace contribution.'); }
            }
            if (requirements !== undefined) {
              try { metadata.requirements = parseRequirements(requirements); }
              catch { warnings.push('Invalid or unsupported Desktop requirements declaration.'); }
            }
          }
        } catch { warnings.push('Invalid or unsupported Desktop presentation metadata.'); }
        if (!metadata.documentation.readme && await fileExists(root, 'README.md')) metadata.documentation.readme = 'README.md';
        for (const documentation of [metadata.documentation, ...Object.values(metadata.locales ?? {}).map(locale => locale.documentation ?? {})])
          for (const [kind, path] of Object.entries(documentation)) {
            if (!await fileExists(root, path)) delete documentation[kind];
            else reference.allowed.add(path);
          }
        if (metadata.desktop) {
          if (descriptor.kind !== 'installed' || descriptor.provenance !== 'recorded') delete metadata.desktop;
          else {
            try {
              for (const page of metadata.desktop.pages) await plainFile(root, page.document, 256 * 1024);
              const icon = metadata.desktop.icon;
              delete metadata.desktop.icon;
              if (icon) {
                const projectIcon = async path => {
                  try {
                    const bytes = await plainFile(root, path, 128 * 1024), mime = desktopImageType(bytes);
                    if (mime && this.validateImage?.(bytes, 512)) return `data:${mime};base64,${bytes.toString('base64')}`;
                  } catch {}
                };
                const light = await projectIcon(icon.light), dark = icon.dark ? await projectIcon(icon.dark) : undefined;
                if (light) metadata.desktop.icon = { light, ...(dark ? { dark } : {}) };
                if (!light || icon.dark && !dark) warnings.push('Invalid or unavailable Desktop workspace icon.');
              }
              for (const page of metadata.desktop.pages) reference.allowed.add(page.document);
            } catch {
              delete metadata.desktop;
              warnings.push('Invalid or unavailable Desktop workspace document.');
            }
          }
        }
        return { ...publicPlugin, package: { ...metadata, warnings, ref: reference.ref, provenance: descriptor.provenance,
          configurationAvailable: descriptor.kind === 'installed' && descriptor.provenance === 'recorded'
            && await fileExists(root, 'dfsc.settings.json') } };
      } catch { return publicPlugin; }
    };
    const plugins = [];
    for (const plugin of catalog.plugins) plugins.push(await project(plugin));
    const available = [];
    for (const plugin of catalog.available) available.push(await project(plugin));
    for (const ref of this.references.keys()) if (!current.has(ref)) this.references.delete(ref);
    // Catalog size is bounded at the worker boundary; never retain an unbounded token registry.
    while (this.references.size > 1000) this.references.delete(this.references.keys().next().value);
    return { ...catalog, plugins, available };
  }
  async reference(ref) {
    const value = typeof ref === 'string' && this.references.get(ref);
    if (!value) throw new PluginFileError('stale');
    try {
      if (await packageFingerprint(value.descriptor.root) !== value.descriptor.fingerprint) throw new PluginFileError('stale');
    } catch { this.references.delete(ref); throw new PluginFileError('stale'); }
    return value;
  }
  async document(input) {
    if (!object(input) || typeof input.path !== 'string') throw new PluginFileError('invalid-input');
    const reference = await this.reference(input.ref), path = markdownPath(input.path);
    if (!reference.allowed.has(path)) throw new PluginFileError('invalid-path');
    const text = (await plainFile(reference.descriptor.root, path, 256 * 1024)).toString('utf8');
    const tree = unified().use(remarkParse).parse(text);
    const images = {}, links = {};
    let count = 0, imageBytes = 0;
    const definitions = new Map();
    const visit = (node, action) => { action(node); for (const child of node.children ?? []) visit(child, action); };
    visit(tree, node => { if (node.type === 'definition') definitions.set(node.identifier, node.url); });
    const resources = [];
    visit(tree, node => {
      const url = node.url ?? definitions.get(node.identifier);
      if (['link', 'linkReference', 'image', 'imageReference'].includes(node.type) && typeof url === 'string')
        resources.push({ image: node.type.startsWith('image'), url });
    });
    for (const resource of resources) {
      const target = localTarget(path, resource.url);
      if (!target) continue;
      if (!resource.image) {
        if (/\.md$/iu.test(target.path) && reference.allowed.size < 64) {
          links[resource.url] = `${target.path}${target.anchor}`;
          reference.allowed.add(target.path);
        }
        continue;
      }
      if (++count > 8 || images[resource.url]) continue;
      try {
        const bytes = await plainFile(reference.descriptor.root, target.path, 1024 * 1024);
        const mime = imageType(bytes);
        if (!mime || imageBytes + bytes.length > 4 * 1024 * 1024) continue;
        if (mime !== 'image/png' && !this.validateImage?.(bytes)) continue;
        imageBytes += bytes.length;
        images[resource.url] = `data:${mime};base64,${bytes.toString('base64')}`;
      } catch {}
    }
    await this.reference(input.ref);
    return { path, text, images, links };
  }
}
