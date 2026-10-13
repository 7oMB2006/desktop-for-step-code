import { existsSync } from 'node:fs';
import { win32 } from 'node:path';

const terminalVariables = new Set([
  'PATH', 'PATHEXT', 'SYSTEMROOT', 'WINDIR', 'COMSPEC', 'OS',
  'PROGRAMFILES', 'PROGRAMFILES(X86)', 'PROGRAMW6432', 'PROGRAMDATA',
  'COMMONPROGRAMFILES', 'COMMONPROGRAMFILES(X86)', 'COMMONPROGRAMW6432',
  'USERPROFILE', 'HOMEDRIVE', 'HOMEPATH', 'HOME', 'APPDATA', 'LOCALAPPDATA',
  'TEMP', 'TMP', 'USERNAME', 'USERDOMAIN', 'COMPUTERNAME', 'PSMODULEPATH',
  'NUMBER_OF_PROCESSORS', 'PROCESSOR_ARCHITECTURE', 'PROCESSOR_ARCHITEW6432',
  'PROCESSOR_IDENTIFIER', 'PROCESSOR_LEVEL', 'PROCESSOR_REVISION',
  'TERM', 'COLORTERM', 'LANG', 'LC_ALL', 'LC_CTYPE',
  'USER', 'LOGNAME', 'SHELL', 'TMPDIR', 'TZ', 'TERMINFO', 'TERMINFO_DIRS',
  'DISPLAY', 'WAYLAND_DISPLAY', 'XDG_RUNTIME_DIR', 'DBUS_SESSION_BUS_ADDRESS',
]);

export function terminalShell(platform: NodeJS.Platform = process.platform, env: NodeJS.ProcessEnv = process.env,
  available: (path: string) => boolean = existsSync) {
  if (platform === 'win32') {
    const pwsh = win32.join(env.ProgramFiles ?? 'C:\\Program Files', 'PowerShell', '7', 'pwsh.exe');
    const file = available(pwsh) ? pwsh : win32.join(env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    const initialize = "if (Get-Module -ListAvailable PSReadLine) { Import-Module PSReadLine; Set-PSReadLineOption -HistorySaveStyle SaveNothing; if ((Get-Command Set-PSReadLineOption).Parameters.ContainsKey('PredictionSource')) { Set-PSReadLineOption -PredictionSource None } }";
    return { file, args: ['-NoLogo', '-NoProfile', '-NoExit', '-Command', initialize], title: 'PowerShell' };
  }
  // Do not load personal startup scripts into the scrubbed terminal environment.
  if (available('/bin/bash')) return { file: '/bin/bash', args: ['--noprofile', '--norc', '-i'], title: 'Bash' };
  return { file: '/bin/sh', args: ['-i'], title: 'Shell' };
}

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
