import { getDomain } from 'tldts';

export function publicBrowserSite(value: string): string | null {
  if (!URL.canParse(value)) return null;
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.port || url.username || url.password
    || !/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/i.test(url.hostname)
    || /\.(?:local|localhost|internal|lan|home|onion)$/i.test(url.hostname)) return null;
  return getDomain(url.hostname, { allowPrivateDomains: true, validateHostname: true });
}

export function publicBrowserResource(url: string, method: string, type: string, site: string): boolean {
  if (method !== 'GET' && method !== 'HEAD') return false;
  const document = type === 'mainFrame' || type === 'subFrame';
  if (document) return publicBrowserSite(url) === site;
  const target = publicBrowserSite(url);
  if (target) return true;
  if (url.startsWith('data:')) return true;
  return url.startsWith('blob:') && publicBrowserSite(url.slice(5)) === site;
}
