import { createServer, type Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import { readFile, realpath, stat } from 'node:fs/promises';
import { dirname, extname, resolve, relative, isAbsolute } from 'node:path';
import { parseHTML } from 'linkedom';
import { sensitiveDiffPath } from '../src/review-source';

const types: Record<string, string> = {
  '.html': 'text/html', '.htm': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.ico': 'image/x-icon',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.mp4': 'video/mp4', '.webm': 'video/webm',
};
type Page = { root: string; entry: string; files: Map<string, string>; token: string };
const cssReferences = /url\(\s*["']?([^"')\s]+)["']?\s*\)|@import\s+["']([^"']+)["']/g;
const moduleReferences = /(?:\bfrom\s*|\bimport\s*(?:\(\s*)?)["']((?:\.?\.?\/|\/(?!\/))[^"']+)["']/g;
const sourceSets = (value: string) => value.split(',').map(entry => entry.trim().split(/\s+/)[0]);
function transportSource(source: string, ext: string, token: string) {
  const root = (value: string) => /^\/(?!\/)/.test(value) ? `/${token}${value}` : value;
  const css = (value: string) => value.replace(cssReferences, (match, url, imported) => match.replace(url || imported, root(url || imported)));
  const modules = (value: string) => value.replace(moduleReferences, (match, url) => match.replace(url, root(url)));
  if (ext === '.css') return css(source);
  if (ext === '.js' || ext === '.mjs') return modules(source);
  const { document } = parseHTML(source);
  for (const node of document.querySelectorAll('[src],link[href],video[poster],[srcset],[style],style,script')) {
    for (const attr of ['src', 'href', 'poster']) {
      const value = node.getAttribute(attr);
      if (value) node.setAttribute(attr, root(value));
    }
    const srcset = node.getAttribute('srcset');
    if (srcset && !srcset.includes('data:')) node.setAttribute('srcset', srcset.replace(/(^|,\s*)(\/(?!\/)[^\s,]+)/g, (_match, prefix, url) => prefix + root(url)));
    const style = node.getAttribute('style');
    if (style) node.setAttribute('style', css(style));
    if (node.tagName === 'STYLE') node.textContent = css(node.textContent ?? '');
    if (node.tagName === 'SCRIPT') node.textContent = modules(node.textContent ?? '');
  }
  return document.toString();
}
export class LocalPagePreview {
  private server?: Server;
  private origin?: string;
  private starting?: Promise<void>;
  private pages = new Map<string, Page>();
  async open(path: string): Promise<{ url: string; origin: string }> {
    const canonical = await realpath(path);
    let page = this.pages.get(canonical);
    if (!page) {
      if (this.pages.size >= 64) throw new Error('Local page preview limit reached');
      page = { root: dirname(canonical), entry: canonical, files: new Map(), token: randomUUID() };
      this.pages.set(canonical, page);
    }
    await this.collect(page);
    await this.start();
    const name = relative(page.root, canonical).replaceAll('\\', '/');
    return { url: `${this.origin}/${page.token}/${encodeURIComponent(name)}`, origin: this.origin! };
  }
  private async collect(page: Page) {
    const files = new Map<string, string>();
    const queue = [page.entry];
    for (let i = 0; i < queue.length && files.size < 128; i++) {
      const path = queue[i];
      const rel = relative(page.root, path);
      if (rel === '..' || rel.startsWith('../') || rel.startsWith('..\\') || isAbsolute(rel) || sensitiveDiffPath(path)) continue;
      const ext = extname(path).toLowerCase();
      if (!types[ext]) continue;
      let canonical: string;
      try { canonical = await realpath(path); } catch { continue; }
      const inside = relative(page.root, canonical);
      if (inside === '..' || inside.startsWith('../') || inside.startsWith('..\\') || isAbsolute(inside) || sensitiveDiffPath(canonical)) continue;
      const key = rel.replaceAll('\\', '/');
      if (files.has(key)) continue;
      const info = await stat(canonical);
      if (!info.isFile() || info.size > 8 * 1024 * 1024) continue;
      files.set(key, canonical);
      const references: string[] = [];
      if (['.html', '.htm', '.css', '.js', '.mjs'].includes(ext) && info.size <= 1024 * 1024) {
        const source = await readFile(canonical, 'utf8');
        if (ext === '.html' || ext === '.htm') {
          const { document } = parseHTML(source);
          for (const node of document.querySelectorAll('[src],link[href],video[poster],[srcset],[style],style,script')) {
            for (const attr of ['src', 'href', 'poster']) {
              const value = node.getAttribute(attr);
              if (value) references.push(value);
            }
            const srcset = node.getAttribute('srcset');
            if (srcset && !srcset.includes('data:')) references.push(...sourceSets(srcset));
            const styles = `${node.getAttribute('style') ?? ''} ${node.tagName === 'STYLE' ? node.textContent : ''}`;
            for (const match of styles.matchAll(cssReferences)) references.push(match[1] || match[2]);
            if (node.tagName === 'SCRIPT')
              for (const match of (node.textContent ?? '').matchAll(moduleReferences)) references.push(match[1]);
          }
        } else if (ext === '.css') {
          for (const match of source.matchAll(cssReferences)) references.push(match[1] || match[2]);
        } else {
          // Only literal module dependencies are granted; arbitrary runtime fetches are not.
          for (const match of source.matchAll(moduleReferences)) references.push(match[1]);
        }
      }
      for (const value of references) {
        if (queue.length >= 256 || /^[a-z][a-z\d+.-]*:|^\/\//i.test(value)) continue;
        try {
          const clean = decodeURIComponent(value.split(/[?#]/)[0]);
          if (clean) queue.push(clean.startsWith('/') ? resolve(page.root, `.${clean}`) : resolve(dirname(path), clean));
        } catch { /* Malformed asset addresses stay unavailable. */ }
      }
    }
    page.files = files;
    if (![...files.values()].includes(page.entry)) throw new Error('HTML preview is unavailable or exceeds its limits');
  }
  private async start() {
    if (this.origin) return;
    if (this.starting) return this.starting;
    this.starting = new Promise<void>((done, fail) => {
      const server = createServer(async (request, response) => {
        const deny = (code: number) => { response.writeHead(code); response.end(); };
        if (request.headers.host !== new URL(this.origin!).host || !['GET', 'HEAD'].includes(request.method ?? '')
          || (request.headers.origin && request.headers.origin !== this.origin)) { deny(403); return; }
        try {
          const url = new URL(request.url ?? '/', this.origin);
          const parts = url.pathname.split('/');
          const page = [...this.pages.values()].find(page => page.token === parts[1]);
          const key = decodeURIComponent(parts.slice(2).join('/'));
          const path = page?.files.get(key);
          if (!path || await realpath(path) !== path) { deny(404); return; }
          const info = await stat(path);
          if (!info.isFile() || info.size > 8 * 1024 * 1024) { deny(413); return; }
          const bytes = await readFile(path);
          if (bytes.length > 8 * 1024 * 1024) { deny(413); return; }
          response.writeHead(200, {
            'Content-Type': types[extname(path).toLowerCase()], 'X-Content-Type-Options': 'nosniff',
            'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer',
            'Content-Security-Policy': "default-src 'self' data: blob:; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; connect-src 'self'; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'",
          });
          const ext = extname(path).toLowerCase();
          response.end(request.method === 'HEAD' ? undefined
            : ['.html', '.htm', '.css', '.js', '.mjs'].includes(ext) && bytes.length <= 1024 * 1024
              ? transportSource(bytes.toString('utf8'), ext, page!.token) : bytes);
        } catch { deny(404); }
      });
      this.server = server;
      server.once('error', fail);
      server.listen(0, '127.0.0.1', () => {
        const address = server.address();
        if (!address || typeof address === 'string') { fail(new Error('Preview server failed')); return; }
        this.origin = `http://127.0.0.1:${address.port}`;
        done();
      });
    }).finally(() => { this.starting = undefined; });
    return this.starting;
  }
  dispose() { this.server?.close(); this.server?.closeAllConnections(); this.pages.clear(); }
}
