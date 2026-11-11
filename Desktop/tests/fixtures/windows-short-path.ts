import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { realpath } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';

export async function windowsShortPath(path: string, ownedRoot: string) {
  assert.equal(process.platform, 'win32');
  const root = resolve(ownedRoot), target = resolve(path);
  const offset = relative(root, target);
  assert.ok(!isAbsolute(offset) && offset !== '..' && !offset.startsWith(`..${sep}`));
  // cmd expands short names natively; Unicode output avoids a PowerShell/COM cold start.
  const child = spawnSync('cmd.exe', ['/d', '/u', '/v:off', '/s', '/c',
    'for %I in ("%DFSC_SHORT_PATH_FIXTURE%") do @echo "%~sI"'], {
    encoding: 'utf16le', windowsVerbatimArguments: true, windowsHide: true,
    timeout: 10000, maxBuffer: 64 * 1024,
    env: { ...process.env, DFSC_SHORT_PATH_FIXTURE: target },
  });
  if (child.error) throw child.error;
  assert.equal(child.status, 0, 'Native short alias lookup must exit successfully');
  const result = child.stdout.trim();
  assert.match(result, /^"[^"\r\n]+"$/);
  const short = result.slice(1, -1);
  assert.ok(isAbsolute(short));
  assert.equal((await realpath(short)).toLowerCase(), (await realpath(target)).toLowerCase(),
    'Short alias must identify the exact isolated fixture target');
  return short;
}
