import assert from 'node:assert/strict';

export async function waitForNewSessionButton(page, theme) {
  await page.waitForFunction(theme => document.querySelector('.new-chat')?.disabled === false
    && (theme === undefined || document.documentElement.dataset.theme === theme), theme);
}

// Playwright's browser-side polling treats a Promise itself as truthy.
// Poll IPC snapshots in Node so each resolved value is actually checked.
export async function waitForSessionFixtureSnapshot(page, predicate, label, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  do {
    const snapshot = await page.evaluate(() => window.desktop.snapshot());
    if (await predicate(snapshot)) return snapshot;
    if (Date.now() >= deadline) break;
    await new Promise(resolve => setTimeout(resolve, 40));
  } while (Date.now() < deadline);
  assert.fail(`Timed out waiting for ${label}`);
}

// Fresh-profile checks must explicitly exercise the onboarding escape hatch.
export async function skipFirstRunFixture(page) {
  await page.getByRole('heading', { name: '连接模型服务', exact: true }).waitFor({ timeout: 60000 });
  const before = await page.evaluate(() => window.desktop.snapshot());
  assert.equal(before.firstRun?.required, true);
  assert.equal(before.runtimeId, undefined, 'onboarding must not start a session worker');
  await page.getByRole('button', { name: '稍后设置', exact: true }).click();
  await page.locator('.new-session').waitFor({ timeout: 60000 });
  const after = await page.evaluate(() => window.desktop.snapshot());
  assert.equal(after.firstRun?.required, false);
  assert.equal(after.runtimeId, undefined, 'skipping setup must leave a draft');
}

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
