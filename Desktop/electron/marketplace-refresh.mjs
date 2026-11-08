import { execFile } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { capabilityFailureDetails, marketplaceFailureCode } from './capability-failure.mjs';

export async function refreshGitMarketplace(path, signal, execute = execFile, timeout = 120000) {
  const started = performance.now();
  try {
    await new Promise((resolve, reject) => {
      let ready = false, closed = false, completed = false, failure;
      const finish = () => {
        if (!ready || !closed || !completed) return;
        if (!failure) { resolve(); return; }
        failure.details.elapsedMs = Math.round(performance.now() - started);
        reject(Object.assign(new Error(`capability:${failure.code}`), failure));
      };
      const child = execute('git', ['-C', path, 'pull', '--ff-only', '--quiet'], {
        timeout, signal, windowsHide: true, encoding: 'utf8', maxBuffer: 1024 * 1024,
      }, (error, _stdout, stderr) => {
        if (error) {
          // Use stderr only for local classification, never as diagnostic payload.
          const code = marketplaceFailureCode({ ...error, message: error.message, stderr }, signal);
          failure = {
            code,
            details: capabilityFailureDetails({ details: {
              operation: 'marketplace-refresh',
              elapsedMs: Math.round(performance.now() - started),
              gitExitCode: error.code,
              gitSignal: error.signal,
              gitSystemCode: error.code,
            } }),
          };
        }
        completed = true;
        finish();
      });
      // Abort callbacks can precede process close; do not admit another writer yet.
      if (child && typeof child.once === 'function') child.once('close', (code, signal) => {
        if (failure) {
          failure.details = capabilityFailureDetails({ details: {
            ...failure.details,
            gitExitCode: code ?? failure.details.gitExitCode,
            gitSignal: signal ?? failure.details.gitSignal,
          } });
        }
        closed = true;
        finish();
      });
      else closed = true;
      ready = true;
      finish();
    });
  } catch (error) {
    if (capabilityFailureDetails(error)) throw error;
    const code = marketplaceFailureCode(error, signal);
    throw Object.assign(new Error(`capability:${code}`), { code, details: {
      operation: 'marketplace-refresh', elapsedMs: Math.round(performance.now() - started),
      gitExitCode: null, gitSignal: null, gitSystemCode: null,
    } });
  }
}
