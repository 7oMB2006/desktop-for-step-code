import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

// Resolve only direct Step Code children of this isolated Electron fixture.
// Never enumerate/terminate unrelated personal runtimes or Electron windows.
export function fixtureRuntimeChildren(ownerPid) {
  assert.ok(Number.isInteger(ownerPid) && ownerPid > 0);
  if (process.platform === 'win32') {
    const command = `@(Get-CimInstance Win32_Process -Filter 'ParentProcessId = ${ownerPid}' | Where-Object {
      $_.Name -eq 'node.exe' -and $_.CommandLine -match 'step[.]js' -and $_.CommandLine -match '--mode'
    } | Select-Object -ExpandProperty ProcessId) | ConvertTo-Json -Compress`;
    const output = execFileSync('powershell.exe', ['-NoProfile', '-Command', command],
      { encoding: 'utf8', windowsHide: true }).trim();
    return output ? [].concat(JSON.parse(output)) : [];
  }
  assert.equal(process.platform, 'darwin', 'Native fixture child discovery requires macOS or Windows');
  return execFileSync('/bin/ps', ['-axo', 'pid=,ppid=,command='], { encoding: 'utf8' })
    .split('\n').flatMap(line => {
      const match = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line);
      return match && Number(match[2]) === ownerPid && /step\.js(?:\s|$)/.test(match[3])
        && /--mode(?:\s|=)/.test(match[3]) ? [Number(match[1])] : [];
    });
}
