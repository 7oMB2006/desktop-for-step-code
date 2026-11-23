const directoryUnavailable = ['Project directory unavailable: ', '项目目录不可用：'] as const;

export class WorkspaceDirectoryError extends Error {
  constructor(readonly path: string, language: 'en' | 'zh') {
    super(`${directoryUnavailable[language === 'zh' ? 1 : 0]}${path}`);
  }
}

export function unavailableDirectory(error: unknown) {
  // Electron invoke forwards only the message, with an IPC-specific prefix.
  const message = (error instanceof Error ? error.message : String(error))
    .replace(/^Error invoking remote method '[^']+': Error: /, '');
  const prefix = directoryUnavailable.find(value => message.startsWith(value));
  return prefix ? message.slice(prefix.length) || undefined : undefined;
}
