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
  await app.close();
}
