import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { realpath } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';

export async function windowsShortPath(path: string, ownedRoot: string) {
  assert.equal(process.platform, 'win32');
  const root = resolve(ownedRoot), target = resolve(path);
  const offset = relative(root, target);
  assert.ok(!isAbsolute(offset) && offset !== '..' && !offset.startsWith(`..${sep}`));
  const script = [
    "$ErrorActionPreference = 'Stop'",
    "$ProgressPreference = 'SilentlyContinue'",
    '$folder = (New-Object -ComObject Scripting.FileSystemObject).GetFolder($env:DFSC_SHORT_PATH_FIXTURE)',
    '[Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($folder.ShortPath))',
  ].join('; ');
  const result = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand',
    Buffer.from(script, 'utf16le').toString('base64')], {
    encoding: 'utf8', timeout: 10000, maxBuffer: 64 * 1024,
    env: { ...process.env, DFSC_SHORT_PATH_FIXTURE: target },
  }).trim();
  assert.match(result, /^[A-Za-z0-9+/]+={0,2}$/);
  const short = Buffer.from(result, 'base64').toString('utf16le');
  assert.ok(isAbsolute(short));
  assert.equal((await realpath(short)).toLowerCase(), (await realpath(target)).toLowerCase(),
    'Short alias must identify the exact isolated fixture target');
  return short;
}
