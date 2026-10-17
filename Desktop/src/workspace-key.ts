/** Shared by the isolated renderer and main process; callers supply the OS. */
export function normalizedWorkspaceKey(path: string, platform: string): string {
  const normalized = (platform === 'win32' ? path.replace(/\\/g, '/') : path).replace(/\/+$/, '');
  return platform === 'win32' ? normalized.toLowerCase() : normalized;
}

/** File identity keeps POSIX case/backslashes and folds Windows separator aliases. */
export function normalizedFileKey(path: string, platform: string): string {
  return normalizedWorkspaceKey(path, platform).replace(/^\.\//, '');
}
