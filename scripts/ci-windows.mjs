import { spawn, execFileSync } from 'node:child_process';
import { appendFileSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { acceptanceGroups, acceptanceTimeouts, validateInventory, windowsGroups } from './ci-acceptance.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export function groupScripts(group) {
  if (!windowsGroups.includes(group)) throw new Error(`Unknown Windows acceptance group: ${group}`);
  return acceptanceGroups[group];
}

export function executeScript(script, { cwd, timeout, signal } = {}) {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script], {
      cwd, stdio: 'inherit', windowsHide: true, detached: process.platform !== 'win32',
    });
    let stopped;
    const stop = reason => {
      if (stopped || child.exitCode !== null || child.signalCode !== null) return;
      stopped = new Error(reason);
      if (!child.pid) return;
      try {
        // Only terminate this script's process tree, never unrelated Electron windows.
        if (process.platform === 'win32') {
          execFileSync('taskkill', ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true, stdio: 'pipe', timeout: 10000 });
        } else {
          process.kill(-child.pid, 'SIGKILL');
        }
      } catch (error) {
        stopped = new Error(`${reason}; process-tree termination failed`, { cause: error });
        reject(stopped);
      }
    };
    const abort = () => stop('Acceptance cancelled');
    const timer = timeout ? setTimeout(() => stop(`Acceptance timed out after ${timeout}ms`), timeout) : undefined;
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    child.once('error', reject);
    child.once('close', (code, exitSignal) => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      if (stopped) reject(stopped);
      else if (code !== 0) reject(new Error(`Acceptance exited with ${exitSignal ?? code}`));
      else resolve();
    });
  });
}

export async function runGroup(group, {
  execute = executeScript, record = () => {}, log = console.log, signal,
} = {}) {
  const scripts = groupScripts(group);
  const rows = [];
  for (const script of scripts) {
    signal?.throwIfAborted();
    log(`::group::${script}`);
    const started = performance.now();
    let failure;
    let failed = false;
    try {
      await execute(join('scripts', script), { cwd: join(root, 'Desktop'), timeout: acceptanceTimeouts[script], signal });
    } catch (error) {
      failed = true;
      failure = error;
    } finally {
      rows.push({ script, status: failed ? 'failure' : 'success', seconds: Number(((performance.now() - started) / 1000).toFixed(3)) });
      log(`::endgroup::`);
      log(`${script}: ${rows.at(-1).status} (${rows.at(-1).seconds}s)`);
      await record(rows);
    }
    if (failed) throw new Error(`${script} failed`, { cause: failure });
  }
  signal?.throwIfAborted();
  return rows;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const group = process.env.CI_WINDOWS_GROUP;
  validateInventory(readdirSync(join(root, 'Desktop/scripts')).filter(file => /^verify-.*\.mjs$/.test(file)));
  const scripts = groupScripts(group);
  if (process.argv.length === 3 && process.argv[2] === '--list') {
    console.log(`${group}: ${scripts.length} serial checks\n${scripts.join('\n')}`);
  } else if (process.argv.length !== 2) {
    throw new Error('Expected no argument or --list');
  } else {
    const controller = new AbortController();
    const interrupt = () => controller.abort(new Error('Acceptance interrupted'));
    process.once('SIGINT', interrupt);
    process.once('SIGTERM', interrupt);
    const destination = join(root, 'Desktop/test-results');
    mkdirSync(destination, { recursive: true });
    const report = { group, expected: scripts.length, complete: false, results: [] };
    const save = () => writeFileSync(join(destination, `ci-${group}.json`), JSON.stringify(report, null, 2) + '\n');
    save();
    try {
      report.results = await runGroup(group, {
        signal: controller.signal,
        record: rows => { report.results = [...rows]; save(); },
      });
      report.complete = true;
    } finally {
      save();
      if (process.env.GITHUB_STEP_SUMMARY) {
        appendFileSync(process.env.GITHUB_STEP_SUMMARY,
          `## Windows ${group}\n\n${report.results.length}/${scripts.length} checks executed; complete: ${report.complete}\n\n`
          + '| Acceptance | Result | Seconds |\n| --- | --- | ---: |\n'
          + report.results.map(row => `| ${row.script} | ${row.status} | ${row.seconds} |`).join('\n') + '\n');
      }
      process.removeListener('SIGINT', interrupt);
      process.removeListener('SIGTERM', interrupt);
    }
    if (process.env.GITHUB_OUTPUT) {
      appendFileSync(process.env.GITHUB_OUTPUT, `group=${group}\ncomplete=true\n`);
    }
  }
}
