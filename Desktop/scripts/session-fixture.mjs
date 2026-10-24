// Presentation checks need a real worker, unlike the user-facing draft page.
// Call explicitly from an isolated Electron test profile, never from product code.
export async function prepareSessionFixture(page) {
  const composerReady = () => {
    const input = document.querySelector('.composer > .composer-input');
    return Boolean(input && !input.disabled);
  };
  await page.waitForFunction(composerReady, undefined, { timeout: 60000 });
  const snapshot = await page.evaluate(async () => {
    const current = await window.desktop.snapshot();
    return current.draftId ? window.desktop.newIndependentSession() : current;
  });
  if (!snapshot.runtimeId) throw new Error('Session fixture has no runtime');
  await page.reload();
  await page.waitForFunction(composerReady, undefined, { timeout: 60000 });
  return snapshot;
}
