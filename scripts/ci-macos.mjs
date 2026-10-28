import { appendFileSync, createWriteStream, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { finished } from 'node:stream/promises';
import { StringDecoder } from 'node:string_decoder';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { defaultAcceptanceTimeout, macosGroupScripts, validateMacosInventory } from './ci-acceptance.mjs';
import { runGroup } from './ci-windows.mjs';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// Keep each script's output in the diagnostics artifact as well as the console.
// Source and packaged runs use separate directories so the latter cannot erase
// the evidence from the former. Resolve/reject only after the logfile is flushed.
export async function executeWithLog(script, {
  cwd, timeout = defaultAcceptanceTimeout, signal,
  logDirectory = join(root, 'Desktop/test-results/logs', process.env.DESKTOP_VERIFY_EXE ? 'package' : 'source', process.env.CI_MACOS_GROUP ?? 'all'),
  stdout = process.stdout, stderr = process.stderr,
} = {}) {
  signal?.throwIfAborted();
  const name = script.split(/[\\/]/).at(-1);
  mkdirSync(logDirectory, { recursive: true });
  const stream = createWriteStream(join(logDirectory, `${name}.log`), { flags: 'w' });
  const flushed = finished(stream);
  // A disk error can occur while the child is still running. Keep the rejection
  // handled until its process tree and stdio have been closed below.
  flushed.catch(() => {});
  const stamp = line => {
    if (!stream.destroyed && !stream.writableEnded) stream.write(`[${new Date().toISOString()}] ${line}\n`);
  };
  try {
    await once(stream, 'open');
    signal?.throwIfAborted();
    stamp(`cwd: ${cwd ?? process.cwd()}`);
    stamp(`timeout: ${timeout ?? 'none'}`);
    const result = await new Promise((resolveResult, reject) => {
      const child = spawn(process.execPath, [script], {
        cwd, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, detached: process.platform !== 'win32',
      });
      let stopped, spawnError, closed = false;
      const stop = reason => {
        // A leader can exit while descendants still hold its inherited pipes.
        // Keep the deadline/abort active until stdio actually closes.
        if (stopped || closed) return;
        stopped = new Error(reason);
        if (process.platform === 'win32' && (child.exitCode !== null || child.signalCode !== null)) {
          // taskkill cannot recover an exited leader's tree, and its PID could
          // have been reused. Close only our pipe handles and report failure.
          child.stdout.destroy(); child.stderr.destroy();
          return;
        }
        if (!child.pid) return;
        try {
          // Terminate only this acceptance script's process tree.
          if (process.platform === 'win32') {
            execFileSync(join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'taskkill.exe'),
              ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true, stdio: 'pipe', timeout: 10000 });
          } else {
            process.kill(-child.pid, 'SIGKILL');
          }
        } catch (error) {
          stopped = new Error(`${reason}; process-tree termination failed`, { cause: error });
          stamp(stopped.message);
          reject(stopped);
        }
      };
      const logFailed = () => stop('Acceptance log write failed');
      stream.once('error', logFailed);
      for (const [label, pipe, consoleStream] of [['stdout', child.stdout, stdout], ['stderr', child.stderr, stderr]]) {
        const decoder = new StringDecoder('utf8');
        const capture = text => {
          if (text && !stream.destroyed && !stream.writableEnded) stream.write(`[${label}] ${text}`);
        };
        pipe.on('data', chunk => { capture(decoder.write(chunk)); consoleStream.write(chunk); });
        pipe.once('end', () => capture(decoder.end()));
      }
      const abort = () => stop('Acceptance cancelled');
      const timer = timeout ? setTimeout(() => stop(`Acceptance timed out after ${timeout}ms`), timeout) : undefined;
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) abort();
      child.once('error', error => { spawnError = error; stamp(`spawn error: ${error.message}`); });
      // 'close', unlike 'exit', means both output pipes have drained.
      child.once('close', (code, exitSignal) => {
        closed = true;
        clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
        stream.removeListener('error', logFailed);
        if (!stream.destroyed && !stream.writableEnded) stream.write('\n');
        stamp(`exit: code=${exitSignal ?? code} stopped=${stopped ? stopped.message : 'no'}`);
        resolveResult({ code, exitSignal, stopped, spawnError });
      });
    });
    stream.end();
    await flushed;
    if (result.spawnError) throw result.spawnError;
    if (result.stopped) throw result.stopped;
    if (result.code !== 0) throw new Error(`Acceptance exited with ${result.exitSignal ?? result.code}`);
  } finally {
    if (!stream.writableEnded) stream.end();
    await flushed;
  }
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
    const mode = process.env.DESKTOP_VERIFY_EXE ? 'package' : 'source';
    const destination = join(root, 'Desktop/test-results');
    const logDirectory = join(destination, 'logs', mode, group);
    mkdirSync(destination, { recursive: true });
    const report = { group, expected: scripts.length, complete: false, active: null, results: [] };
    const save = () => writeFileSync(join(destination, `ci-macos-${mode}-${group}.json`), JSON.stringify(report, null, 2) + '\n');
    save();
    try {
      report.results = await runGroup(group, {
        scripts,
        signal: controller.signal,
        execute: (script, options) => executeWithLog(script, { ...options, logDirectory }),
        record: (rows, active) => { report.results = [...rows]; report.active = active; save(); },
      });
      report.complete = true;
    } finally {
      save();
      if (process.env.GITHUB_STEP_SUMMARY) {
        appendFileSync(process.env.GITHUB_STEP_SUMMARY,
          `## macOS ${mode} ${group}\n\n${report.results.length}/${scripts.length} checks executed; complete: ${report.complete}\n\n`
          + '| Acceptance | Result | Seconds | Artifact log |\n| --- | --- | ---: | --- |\n'
          + report.results.map(row => `| ${row.script} | ${row.status} | ${row.seconds} | \`logs/${mode}/${group}/${row.script}.log\` |`).join('\n')
          + '\n\nLogs are retained in the `macos-fixture-diagnostics-*` artifact.\n');
      }
      process.removeListener('SIGINT', interrupt);
      process.removeListener('SIGTERM', interrupt);
    }
    if (process.env.GITHUB_OUTPUT) {
      appendFileSync(process.env.GITHUB_OUTPUT, `group=${group}\ncomplete=true\n`);
    }
  }
}
