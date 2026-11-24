import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { parseHTML } from 'linkedom';
import type { LinkPreview } from '../src/contracts';

export function publicAddress(address: string): boolean {
  if (isIP(address) === 4) {
    const [a, b] = address.split('.').map(Number);
    return a !== 0 && a !== 10 && a !== 127 && a < 224 && !(a === 169 && b === 254)
      && !(a === 172 && b >= 16 && b <= 31) && !(a === 192 && b === 168)
      && !(a === 100 && b >= 64 && b <= 127) && !(a === 198 && (b === 18 || b === 19));
  }
  // Restrict IPv6 to global unicast; mapped IPv4 and local ranges stay excluded.
  return isIP(address) === 6 && /^[23][0-9a-f]{3}:/i.test(address);
}
export function previewUrl(value: unknown): URL {
  if (typeof value !== 'string' || value.length > 4096) throw new Error('Invalid URL');
  const url = new URL(value);
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password
    || (url.port && !['80', '443'].includes(url.port))) throw new Error('Unsupported URL');
  url.hash = '';
  return url;
}
async function resolvePublic(url: URL) {
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const addresses = await lookup(host, { all: true });
  if (!addresses.length || addresses.some(item => !publicAddress(item.address))) throw new Error('Non-public destination');
  return addresses[0];
}
async function readPreviewResource(url: URL, signal: AbortSignal, limit: number, redirects = 0,
  localOrigin?: string): Promise<{ bytes: Buffer; type: string; url: URL }> {
  const selected = localOrigin ? await resolveLoopback(url, localOrigin) : await resolvePublic(url);
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    // Pin the validated DNS answer to the request, including every redirect.
    const req = (url.protocol === 'https:' ? httpsRequest : httpRequest)(url, {
      signal, headers: { 'User-Agent': 'DesktopLinkPreview/1.0', Accept: 'text/html,image/*', 'Accept-Encoding': 'identity' },
      family: selected.family,
      lookup: (_host, _options, callback) => callback(null, selected.address, selected.family),
    }, response => {
      const code = response.statusCode ?? 0;
      if (code >= 300 && code < 400 && response.headers.location) {
        response.resume();
        if (localOrigin || redirects >= 3) { reject(new Error('Redirect unavailable')); return; }
        try { resolve(readPreviewResource(previewUrl(new URL(response.headers.location, url).href), signal, limit, redirects + 1)); }
        catch (error) { reject(error); }
        return;
      }
      if (code !== 200) { response.resume(); reject(new Error('Unavailable')); return; }
      const chunks: Buffer[] = []; let size = 0;
      response.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > limit) { response.destroy(new Error('Preview too large')); return; }
        chunks.push(chunk);
      });
      response.on('error', reject);
      response.on('end', () => resolve({ bytes: Buffer.concat(chunks), type: String(response.headers['content-type'] ?? '').split(';')[0], url }));
    });
    req.on('error', reject); req.end();
  });
}
const iconLimit = 96 * 1024;
const iconTypes = new Set(['image/svg+xml', 'image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/x-icon', 'image/vnd.microsoft.icon']);

function faviconType(value: string) {
  const type = value.split(';')[0].trim().toLowerCase();
  return iconTypes.has(type) ? type : undefined;
}

export function inlineFavicon(value: string) {
  if (value.length > Math.ceil(iconLimit / 3) * 4 + 64) return undefined;
  const match = /^data:(image\/[a-z.+-]+);base64,([a-z0-9+/]+={0,2})$/i.exec(value);
  if (match && iconTypes.has(match[1].toLowerCase()) && Buffer.byteLength(match[2], 'base64') <= iconLimit) return value;
}

async function resolveLoopback(url: URL, origin: string) {
  if (!['http:', 'https:'].includes(url.protocol) || url.origin !== origin || url.username || url.password)
    throw new Error('Non-local favicon');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const addresses = await lookup(host, { all: true });
  if (!addresses.length || addresses.some(item => !['127.0.0.1', '::1'].includes(item.address))) throw new Error('Non-loopback destination');
  return addresses[0];
}

export async function fetchSameOriginFavicon(address: string, page: URL, signal: AbortSignal,
  fetchResource: (address: string, options: RequestInit) => Promise<Response>) {
  if (address.length > 4096) return;
  const url = new URL(address);
  if (!['http:', 'https:'].includes(url.protocol) || url.origin !== page.origin || url.username || url.password) return;
  const response = await fetchResource(url.href, { signal, credentials: 'omit', redirect: 'error',
    headers: { Accept: 'image/*' } });
  const type = faviconType(response.headers.get('content-type') ?? '');
  if (response.status !== 200 || !type || Number(response.headers.get('content-length')) > iconLimit) {
    await response.body?.cancel();
    return;
  }
  if (!response.body) return;
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > iconLimit) { await reader.cancel(); return; }
    chunks.push(value);
  }
  return `data:${type};base64,${Buffer.concat(chunks).toString('base64')}`;
}

export async function fetchFavicon(address: string, signal: AbortSignal, page?: URL) {
  const localOrigin = page && ['localhost', '127.0.0.1', '[::1]'].includes(page.hostname) ? page.origin : undefined;
  const url = localOrigin && address.length <= 4096 ? new URL(address) : previewUrl(address);
  // A private or local page must not cause an out-of-partition request to another host.
  if (!localOrigin && page && page.origin !== url.origin) await resolvePublic(page);
  const image = await readPreviewResource(url, signal, iconLimit, 0, localOrigin);
  // Render as an image only: Chromium does not execute SVG scripts or load its external resources.
  const type = faviconType(image.type);
  if (type) return `data:${type};base64,${image.bytes.toString('base64')}`;
}
export function previewMetadata(html: string, url: URL): Pick<LinkPreview, 'title' | 'description'> & { iconUrl: string } {
  const { document } = parseHTML(html);
  const meta = (key: string) => document.querySelector(`meta[property="${key}"],meta[name="${key}"]`)?.getAttribute('content') ?? '';
  const clean = (value: string, max: number) => value.replace(/\s+/gu, ' ').trim().slice(0, max);
  const icon = document.querySelector('link[rel~="icon"]')?.getAttribute('href');
  return { title: clean(meta('og:title') || document.querySelector('title')?.textContent || '', 180),
    description: clean(meta('og:description') || meta('description'), 320),
    iconUrl: new URL(icon || '/favicon.ico', url).href };
}
const cache = new Map<string, { expires: number; value: Promise<LinkPreview> }>();
let active = 0;
export async function linkPreview(value: unknown): Promise<LinkPreview> {
  const url = previewUrl(value);
  const old = cache.get(url.href);
  if (old && old.expires > Date.now()) return old.value;
  if (active >= 4) return { url: url.href };
  const result = (async (): Promise<LinkPreview> => {
    active++;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6500);
    try {
      const page = await readPreviewResource(url, controller.signal, 768 * 1024);
      if (!['text/html', 'application/xhtml+xml'].includes(page.type)) return { url: url.href };
      const metadata = previewMetadata(page.bytes.toString('utf8'), page.url);
      let icon: string | undefined;
      try {
        icon = await fetchFavicon(metadata.iconUrl, controller.signal);
      } catch { /* The globe remains when the site's favicon is unavailable. */ }
      return { url: url.href, title: metadata.title, description: metadata.description, icon };
    } catch { return { url: url.href }; }
    finally { clearTimeout(timer); active--; }
  })();
  if (cache.size >= 128) cache.delete(cache.keys().next().value!);
  cache.set(url.href, { expires: Date.now() + 10 * 60_000, value: result });
  return result;
}
