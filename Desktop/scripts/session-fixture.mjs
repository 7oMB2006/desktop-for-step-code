// Presentation checks need a real worker, unlike the user-facing draft page.
// Call explicitly from an isolated Electron test profile, never from product code.
export async function prepareSessionFixture(page) {
  await page.waitForFunction(() => !document.querySelector('.composer > textarea')?.disabled, undefined, { timeout: 60000 });
  const snapshot = await page.evaluate(async () => {
    const current = await window.desktop.snapshot();
    return current.draftId ? window.desktop.newIndependentSession() : current;
  });
  if (!snapshot.runtimeId) throw new Error('Session fixture has no runtime');
  await page.reload();
  await page.waitForFunction(() => !document.querySelector('.composer > textarea')?.disabled, undefined, { timeout: 60000 });
  return snapshot;
}
