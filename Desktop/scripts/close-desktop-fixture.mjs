// Windows launchers can exit before every inherited Playwright pipe reaches EOF.
export function releaseExitedFixturePipes(app) {
  const child = app.process();
  const pages = app.windows();
  const context = app.context();
  let contextClosed = false;
  const release = () => {
    if (!contextClosed || child.exitCode !== 0 || app.windows().some(page => !page.isClosed())) return;
    for (const pipe of child.stdio ?? [child.stdout, child.stderr]) pipe?.destroy();
  };
  // The launcher close disposes Playwright's context channel. Preserve its close
  // event first; isClosed() also returns true while a context is merely closing.
  const onContextClose = () => { contextClosed = true; release(); };
  context.on('close', onContextClose);
  child.on('exit', release);
  for (const page of pages) page.on('close', release);
  release();
  return () => {
    context.off('close', onContextClose);
    child.off('exit', release);
    for (const page of pages) page.off('close', release);
  };
}

// Both the launcher and controller must finish; an exit event cannot abandon app.close().
export async function closeDesktopFixtureAndWait(app, timeout = 30000) {
  const child = app.process();
  let onExit;
  const exited = new Promise(resolve => {
    if (child.exitCode !== null) resolve();
    else { onExit = resolve; child.once('exit', onExit); }
  });
  let timer;
  try {
    await Promise.race([
      Promise.all([closeDesktopFixture(app), exited]),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Fixture shutdown timed out after ${timeout}ms`)), timeout);
      }),
    ]);
  } finally {
    clearTimeout(timer);
    if (onExit) child.off('exit', onExit);
  }
}

// Isolated fixtures must still exercise orderly shutdown and flush their saved state.
export async function closeDesktopFixture(app) {
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
  finally { dispose(); }
}
