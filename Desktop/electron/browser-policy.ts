import type { BrowserBounds } from '../src/contracts';

export const MAX_BROWSER_TABS = 12;

export function browserUrl(input: unknown): string {
  if (typeof input !== 'string' || input.length > 8192) throw new Error('Invalid browser address');
  let value = input.trim();
  if (value === 'about:blank') return value;
  if (!value || /[\u0000-\u001f\u007f]/u.test(value)) throw new Error('Invalid browser address');
  if (/^(localhost|127\.0\.0\.1|\[::1\])(?=[:/]|$)/iu.test(value)) value = `http://${value}`;
  else if (!/^[a-z][a-z\d+.-]*:/iu.test(value)) value = `https://${value}`;
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password)
    throw new Error('Only HTTP and HTTPS addresses without credentials are supported');
  return url.href;
}

export function browserNavigation(url: string): boolean {
  try { return browserUrl(url) === url; } catch { return false; }
}

export function browserBounds(input: unknown, width: number, height: number): BrowserBounds | null {
  if (input === null) return null;
  if (!input || typeof input !== 'object') throw new Error('Invalid browser bounds');
  const { x, y, width: w, height: h } = input as BrowserBounds;
  if (![x, y, w, h].every(value => typeof value === 'number' && Number.isFinite(value) && Math.abs(value) < 100000)
    || w < 0 || h < 0) throw new Error('Invalid browser bounds');
  const left = Math.max(0, Math.round(x));
  const top = Math.max(0, Math.round(y));
  const right = Math.min(width, Math.round(x + w));
  const bottom = Math.min(height, Math.round(y + h));
  if (right <= left || bottom <= top) return null;
  return { x: left, y: top, width: right - left, height: bottom - top };
}
