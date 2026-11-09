// Windows launchers can exit before every inherited Playwright pipe reaches EOF.
const processExists = pid => {
  try { process.kill(pid, 0); return true; }
  catch (error) { return error.code !== 'ESRCH'; }
};

// A dead Electron process can leave its inspector TCP transport waiting for EOF.
// Capture only this launch's loopback inspector socket, never arbitrary handles.
export function releaseExitedFixtureInspector(app, identity, handles = process._getActiveHandles(), alive = processExists) {
  if (!Number.isSafeInteger(identity?.pid) || identity.pid <= 0
    || !Number.isSafeInteger(identity.debugPort) || identity.debugPort <= 0 || identity.debugPort > 65535) return () => {};
  const sockets = handles.filter(socket => socket.remoteAddress === '127.0.0.1'
    && socket.remotePort === identity.debugPort && typeof socket.destroy === 'function' && !socket.destroyed);
  if (sockets.length !== 1) return () => {};
  const socket = sockets[0];
  const child = app.process();
  const timer = setInterval(() => {
    if (socket.destroyed) { clearInterval(timer); return; }
    if (child.exitCode !== 0 || app.windows().some(page => !page.isClosed()) || alive(identity.pid)) return;
    clearInterval(timer);
    socket.destroy();
  }, 25);
  timer.unref();
  return () => clearInterval(timer);
}

export function releaseExitedFixturePipes(app) {
  const child = app.process();
  const pages = app.windows();
  let pendingRelease;
  const ready = () => child.exitCode === 0 && !app.windows().some(page => !page.isClosed());
  const release = () => {
    if (!ready() || pendingRelease) return;
    // Finish forwarding page/exit events before disposal. Context closure can
    // itself wait for launcher pipe EOF, so it cannot gate releasing these pipes.
    pendingRelease = setImmediate(() => {
      pendingRelease = undefined;
      if (ready()) for (const pipe of child.stdio ?? [child.stdout, child.stderr]) pipe?.destroy();
    });
  };
  child.on('exit', release);
  for (const page of pages) page.on('close', release);
  release();
  return () => {
    clearImmediate(pendingRelease);
    child.off('exit', release);
    for (const page of pages) page.off('close', release);
  };
}

// Both the launcher and controller must finish; an exit event cannot abandon app.close().
export async function closeDesktopFixtureAndWait(app, timeout = 30000) {
  const child = app.process();
  const context = app.context();
  let onContextClose;
  const contextClosed = new Promise(resolve => {
    onContextClose = resolve;
    context.once('close', onContextClose);
  });
  let onExit;
  const exited = new Promise(resolve => {
    if (child.exitCode !== null) resolve();
    else { onExit = resolve; child.once('exit', onExit); }
  });
  let timer;
  try {
    await Promise.race([
      Promise.all([closeDesktopFixture(app), exited, contextClosed]),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Fixture shutdown timed out after ${timeout}ms`)), timeout);
      }),
    ]);
  } finally {
    clearTimeout(timer);
    context.off('close', onContextClose);
    if (onExit) child.off('exit', onExit);
  }
}

// Isolated fixtures must still exercise orderly shutdown and flush their saved state.
export async function closeDesktopFixture(app) {
  const inspector = process.platform === 'win32' && typeof app.evaluate === 'function'
    ? await app.evaluate(() => ({ pid: process.pid, debugPort: process.debugPort })).catch(() => undefined) : undefined;
  const disposeInspector = inspector ? releaseExitedFixtureInspector(app, inspector) : () => {};
  const pages = app.windows();
  for (const page of pages) {
    await page.evaluate(() => {
      if (!window.desktop) return;
      const answer = state => {
        if (state?.request?.phase === 'review') {
          void window.desktop.quitRespond(state.request.id, true).catch(() => {});
        }
      };
      window.desktop.onEvent(event => {
        if (event.type === 'desktop_quit_review') answer(event.state);
      });
      void window.desktop.snapshot().then(value => answer(value.quitReview)).catch(() => {});
    }).catch(() => {});
  }
  const dispose = releaseExitedFixturePipes(app);
  try { await app.close(); }
  finally { dispose(); disposeInspector(); }
}
