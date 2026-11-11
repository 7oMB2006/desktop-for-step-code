import assert from 'node:assert/strict';

// Browser-side waitForFunction accepts a Promise before its IPC result is true.
export async function waitForBrowserFixtureSnapshot(page, predicate, label, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  do {
    const snapshot = await page.evaluate(() => window.desktop.browserList());
    if (await predicate(snapshot)) return snapshot;
    if (Date.now() >= deadline) break;
    await new Promise(resolve => setTimeout(resolve, 40));
  } while (Date.now() < deadline);
  assert.fail(`Timed out waiting for ${label}`);
}
