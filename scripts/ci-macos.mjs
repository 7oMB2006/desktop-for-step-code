import { appendFileSync, createWriteStream, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { spawn, execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { macosGroupScripts, validateMacosInventory } from './ci-acceptance.mjs';
import { runGroup } from './ci-windows.mjs';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// GitHub discards job logs once a run ages out, and the structured report only keeps
// per-script durations. Capture each script's own output beside it so a failure can be
// diagnosed after the console is gone; `Upload fixture diagnostics` already ships this
// directory as an artifact.
function executeWithLog(script, options) {
  const name = script.split(/[\\/]/).at(-1);
  const logPath = join(root, 'Desktop/test-results/logs', `${name}.log`);
  mkdirSync(dirname(logPath), { recursive: true });
  const stream = createWriteStream(logPath, { flags: 'w' });
  const stamp = (line) => stream.write(`[${new Date().toISOString()}] ${line}\n`);
  stamp(`cwd: ${options.cwd}`);
  stamp(`timeout: ${options.timeout ?? 'none'}`);
  const child = spawn(process.execPath, [script], {
    cwd: options.cwd, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, detached: process.platform !== 'win32',
  });
  for (const [name, pipe] of [['stdout', child.stdout], ['stderr', child.stderr]]) {
    pipe.on('data', chunk => {
      stream.write(`[${name}] ${chunk}`);
      process[name === 'stdout' ? 'stdout' : 'stderr'].write(chunk);
    });
  }
  return new Promise((resolvePromise, reject) => {
    let stopped;
    const stop = reason => {
      if (stopped || child.exitCode !== null || child.signalCode !== null) return;
      stopped = new Error(reason);
      if (!child.pid) return;
      try {
        if (process.platform === 'win32') {
          execFileSync(join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'taskkill.exe'),
            ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true, stdio: 'pipe', timeout: 10000 });
        } else {
          process.kill(-child.pid, 'SIGKILL');
        }
      } catch (error) {
        stopped = new Error(`${reason}; process-tree termination failed`, { cause: error });
        reject(stopped);
      }
    };
    const abort = () => stop('Acceptance cancelled');
    const timer = options.timeout ? setTimeout(() => stop(`Acceptance timed out after ${options.timeout}ms`), options.timeout) : undefined;
    options.signal?.addEventListener('abort', abort, { once: true });
    if (options.signal?.aborted) abort();
    child.once('error', error => { stamp(`spawn error: ${error.message}`); reject(error); });
    child.once('close', (code, exitSignal) => {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', abort);
      stamp(`exit: code=${exitSignal ?? code} stopped=${stopped ? stopped.message : 'no'}`);
      stream.end();
      if (stopped) reject(stopped);
      else if (code !== 0) reject(new Error(`Acceptance exited with ${exitSignal ?? code}`));
      else resolvePromise();
    });
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const group = process.env.CI_MACOS_GROUP ?? 'all';
  validateMacosInventory(readdirSync(join(root, 'Desktop/scripts')).filter(file => /^verify-.*\.mjs$/.test(file)));
  const scripts = macosGroupScripts(group);
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
    const report = { group, expected: scripts.length, complete: false, active: null, results: [] };
    const save = () => writeFileSync(join(destination, `ci-macos-${process.env.DESKTOP_VERIFY_EXE ? 'package' : 'source'}-${group}.json`), JSON.stringify(report, null, 2) + '\n');
    save();
    try {
      report.results = await runGroup(group, {
        scripts,
        signal: controller.signal,
        execute: executeWithLog,
        record: (rows, active) => { report.results = [...rows]; report.active = active; save(); },
      });
      report.complete = true;
    } finally {
      save();
      const failures = report.results.filter(row => row.status === 'failure');
      if (process.env.GITHUB_STEP_SUMMARY) {
        appendFileSync(process.env.GITHUB_STEP_SUMMARY,
          `## macOS ${process.env.DESKTOP_VERIFY_EXE ? 'package' : 'source'} ${group}\n\n${report.results.length}/${scripts.length} checks executed; complete: ${report.complete}\n\n`
          + '| Acceptance | Result | Seconds | Log |\n| --- | --- | ---: | --- |\n'
          + report.results.map(row => `| ${row.script} | ${row.status} | ${row.seconds} | [${row.script}.log](../tree/logs/${row.script}.log) |`).join('\n') + '\n'
          + (failures.length ? `\nFailure logs are in the \`macos-fixture-diagnostics-*\` artifact under \`logs/\`.\n` : ''));
      }
      process.removeListener('SIGINT', interrupt);
      process.removeListener('SIGTERM', interrupt);
    }
    if (process.env.GITHUB_OUTPUT) {
      appendFileSync(process.env.GITHUB_OUTPUT, `group=${group}\ncomplete=true\n`);
    }
  }
}
