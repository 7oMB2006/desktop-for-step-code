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
async function readPublic(url: URL, signal: AbortSignal, limit: number, redirects = 0): Promise<{ bytes: Buffer; type: string; url: URL }> {
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const addresses = await lookup(host, { all: true });
  if (!addresses.length || addresses.some(item => !publicAddress(item.address))) throw new Error('Non-public destination');
  signal.throwIfAborted();
  const selected = addresses[0];
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
        if (redirects >= 3) { reject(new Error('Too many redirects')); return; }
        try { resolve(readPublic(previewUrl(new URL(response.headers.location, url).href), signal, limit, redirects + 1)); }
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
      const page = await readPublic(url, controller.signal, 768 * 1024);
      if (!['text/html', 'application/xhtml+xml'].includes(page.type)) return { url: url.href };
      const metadata = previewMetadata(page.bytes.toString('utf8'), page.url);
      let icon: string | undefined;
      try {
        const image = await readPublic(previewUrl(metadata.iconUrl), controller.signal, 96 * 1024);
        // SVG stays in an image data URL, never inline DOM. Chromium image mode
        // disables scripts and external resources, and the renderer CSP remains closed.
        if (['image/svg+xml', 'image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/x-icon', 'image/vnd.microsoft.icon'].includes(image.type))
          icon = `data:${image.type};base64,${image.bytes.toString('base64')}`;
      } catch { /* The globe remains when the site's favicon is unavailable. */ }
      return { url: url.href, title: metadata.title, description: metadata.description, icon };
    } catch { return { url: url.href }; }
    finally { clearTimeout(timer); active--; }
  })();
  if (cache.size >= 128) cache.delete(cache.keys().next().value!);
  cache.set(url.href, { expires: Date.now() + 10 * 60_000, value: result });
  return result;
}
