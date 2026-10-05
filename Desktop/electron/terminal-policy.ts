const terminalVariables = new Set([
  'PATH', 'PATHEXT', 'SYSTEMROOT', 'WINDIR', 'COMSPEC', 'OS',
  'PROGRAMFILES', 'PROGRAMFILES(X86)', 'PROGRAMW6432', 'PROGRAMDATA',
  'COMMONPROGRAMFILES', 'COMMONPROGRAMFILES(X86)', 'COMMONPROGRAMW6432',
  'USERPROFILE', 'HOMEDRIVE', 'HOMEPATH', 'HOME', 'APPDATA', 'LOCALAPPDATA',
  'TEMP', 'TMP', 'USERNAME', 'USERDOMAIN', 'COMPUTERNAME', 'PSMODULEPATH',
  'NUMBER_OF_PROCESSORS', 'PROCESSOR_ARCHITECTURE', 'PROCESSOR_ARCHITEW6432',
  'PROCESSOR_IDENTIFIER', 'PROCESSOR_LEVEL', 'PROCESSOR_REVISION',
  'TERM', 'COLORTERM', 'LANG', 'LC_ALL', 'LC_CTYPE',
]);

export function terminalEnvironment(source: NodeJS.ProcessEnv) {
  return Object.fromEntries(Object.entries(source).filter(([key, value]) => value !== undefined &&
    terminalVariables.has(key.toUpperCase()))) as NodeJS.ProcessEnv;
}

export function terminalSize(cols: unknown, rows: unknown) {
  if (!Number.isInteger(cols) || !Number.isInteger(rows) || (cols as number) < 2 || (cols as number) > 500 ||
    (rows as number) < 1 || (rows as number) > 300) throw new Error('Invalid terminal dimensions');
  return { cols: cols as number, rows: rows as number };
}

export function terminalInput(data: unknown): string {
  if (typeof data !== 'string' || data.length > 65536) throw new Error('Invalid terminal input');
  return data;
}
