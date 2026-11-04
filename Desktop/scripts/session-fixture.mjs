import assert from 'node:assert/strict';

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
