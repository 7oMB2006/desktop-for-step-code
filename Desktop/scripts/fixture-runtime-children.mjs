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
      // The native upstream sets process.title = 'step', replacing argv in ps.
      // admin.mjs retains argv and must never be mistaken for a chat worker.
      const runtime = match && (match[3].trim() === 'step' || /step\.js(?:\s|$)/.test(match[3])
        && /--mode(?:\s|=)/.test(match[3]));
      return match && Number(match[2]) === ownerPid && runtime ? [Number(match[1])] : [];
    });
}

export function terminateFixtureTree(ownerPid) {
  assert.ok(Number.isInteger(ownerPid) && ownerPid > 0 && ownerPid !== process.pid);
  if (process.platform === 'win32') {
    execFileSync('taskkill.exe', ['/PID', String(ownerPid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    return;
  }
  assert.equal(process.platform, 'darwin');
  const rows = execFileSync('/bin/ps', ['-axo', 'pid=,ppid='], { encoding: 'utf8' }).trim().split('\n')
    .map(row => row.trim().split(/\s+/).map(Number));
  const terminate = pid => {
    for (const [child, parent] of rows) if (parent === pid) terminate(child);
    try { process.kill(pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
  };
  terminate(ownerPid);
}
