/** Shared path identity for main-process and renderer-owned workspace scopes.
 * Linux filenames retain case and literal backslashes. Callers resolve paths
 * before comparing when absolute/canonical identity is required. */
export function platformPathKey(path: string, platform: string): string {
  return platform === 'win32'
    ? path.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
    : path.replace(/\/+$/, '') || (path.startsWith('/') ? '/' : '');
}

/** Renderer reads only the readonly preload value; Node consumers use their host. */
export function currentPlatform(): string {
  if (typeof window !== 'undefined') return window.desktop?.platform ?? 'unknown';
  return typeof process !== 'undefined' ? process.platform : 'unknown';
}
