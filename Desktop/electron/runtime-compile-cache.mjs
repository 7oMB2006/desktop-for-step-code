import { flushCompileCache } from 'node:module';

export default function registerRuntimeCompileCache(pi) {
  let flushed = false;
  pi.on('session_start', () => {
    if (flushed) return;
    flushed = true;
    // Windows stops the process tree forcibly, so do not wait for process exit.
    flushCompileCache();
  });
}
