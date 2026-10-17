import { readFile, writeFile, rename, rm, lstat, realpath } from 'node:fs/promises';
import { dirname, basename, join } from 'node:path';
import { execFile } from 'node:child_process';

export interface MacInstallPlan { token: string; pid: number; target: string; staged: string; backup: string; version: string; folder: string; targetInode: number }
export function validateInstallPlan(plan: MacInstallPlan) {
  if (!/^[a-f0-9-]{36}$/.test(plan.token) || !Number.isSafeInteger(plan.pid) || plan.pid <= 1
    || basename(plan.target) !== 'Desktop for Step Code.app' || !plan.target.startsWith('/')
    || plan.staged !== join(dirname(plan.target), `.dfsc-next-${plan.token}.app`)
    || plan.backup !== join(dirname(plan.target), `.dfsc-backup-${plan.token}.app`)
    || !Number.isSafeInteger(plan.targetInode) || !plan.folder.startsWith('/')) throw new Error('Invalid update transaction');
}
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
export async function runMacInstall(plan: MacInstallPlan, launch: (path: string) => Promise<number | void> = async (path: string) => {
  const child = execFile(join(plan.folder, 'launcher'), [], { timeout: 120000, maxBuffer: 16384 });
  child.stdin!.on('error', () => {});
  child.stdin!.end(JSON.stringify({ action: 'launch', path }));
  return await new Promise<number>((done, fail) => {
    let result = ''; child.stdout!.on('data', value => { result += value; });
    child.on('error', fail); child.on('close', code => {
      try { const pid = JSON.parse(result).pid; if (code !== 0 || !Number.isSafeInteger(pid) || pid <= 1) throw new Error('Launch failed'); done(pid); } catch (error) { fail(error); }
    });
  });
}, alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } }, timeout = 180000) {
  validateInstallPlan(plan);
  const statePath = join(plan.folder, 'result.json');
  let moved = false; let replaced = false; let acknowledged = false; let installedInode: number | undefined; let launchedPid: number | void = undefined;
  const result = async (status: string) => writeFile(statePath, JSON.stringify({ status, version: plan.version }), { mode: 0o600 });
  try {
    const deadline = Date.now() + 60000;
    while (alive(plan.pid)) { if (Date.now() > deadline) throw new Error('Previous application did not quit'); await delay(250); }
    const target = await lstat(plan.target);
    if (!target.isDirectory() || target.isSymbolicLink() || target.ino !== plan.targetInode || await realpath(plan.target) !== plan.target) throw new Error('Application changed');
    const staged = await lstat(plan.staged);
    if (!staged.isDirectory() || staged.isSymbolicLink() || await realpath(plan.staged) !== plan.staged) throw new Error('Invalid staged application');
    await rename(plan.target, plan.backup); moved = true;
    await rename(plan.staged, plan.target); replaced = true;
    installedInode = (await lstat(plan.target)).ino;
    launchedPid = await launch(plan.target);
    const expires = Date.now() + timeout;
    for (;;) {
      try { if (await readFile(join(plan.folder, 'ack'), 'utf8') === plan.token) break; } catch {}
      if (Date.now() > expires) throw new Error('The new application did not start');
      await delay(250);
    }
    acknowledged = true;
    await result('installed');
    await rm(plan.backup, { recursive: true });
  } catch {
    if (acknowledged) return;
    if (launchedPid) {
      // LaunchServices verifies the bundle identity again before terminating the
      // unacknowledged instance; never signal a potentially reused PID blindly.
      await new Promise<void>(done => {
        const child = execFile(join(plan.folder, 'launcher'), [], { timeout: 10000 }, () => done());
        child.stdin?.on('error', () => {});
        child.stdin?.end(JSON.stringify({ action: 'stop', path: plan.target, pid: String(launchedPid) }));
      });
    }
    try {
      if (moved) {
        if (replaced) {
          const replacement = await lstat(plan.target).catch((error: NodeJS.ErrnoException) => {
            if (error.code === 'ENOENT') return undefined;
            throw error;
          });
          if (replacement) {
            if (replacement.ino !== installedInode) { await result('recovery-required'); return; }
            await rename(plan.target, plan.staged);
          }
        }
        await rename(plan.backup, plan.target);
      }
    } catch {
      await result('recovery-required'); return;
    }
    await result('rolled-back');
    await launch(plan.target).catch(() => {});
  } finally {
    try { await rm(plan.staged, { recursive: true, force: true }); }
    catch { if (!acknowledged) await result('recovery-required'); }
    await writeFile(join(plan.folder, 'finished'), plan.token, { mode: 0o600 });
  }
}
// A copied standalone Node executes this helper after the Electron process exits.
if (process.argv[2] === '--install') {
  void readFile(process.argv[3], 'utf8').then(JSON.parse).then(async plan => {
    validateInstallPlan(plan);
    if (plan.pid !== process.ppid || plan.folder !== dirname(process.argv[3])) throw new Error('Invalid helper parent');
    await writeFile(join(plan.folder, 'ready'), plan.token, { mode: 0o600 });
    await runMacInstall(plan);
  }).catch(() => { process.exitCode = 1; });
}
