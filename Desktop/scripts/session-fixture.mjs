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

export async function waitForSessionFixtureTools(page, runtimeId, timeoutMs = 30000) {
  return waitForSessionFixtureSnapshot(page, snapshot => {
    assert.ok(snapshot.runtimeId);
    if (runtimeId) assert.equal(snapshot.runtimeId, runtimeId, 'tool readiness cannot switch workers');
    const startup = snapshot.state?.desktopStartup;
    if (!startup) return snapshot.status === 'connected';
    assert.equal(startup.cleanupConfirmed, true);
    assert.notEqual(startup.discovery, 'failed');
    assert.ok(startup.tools.every(tool => tool.status !== 'failed' && tool.cleanupConfirmed !== false),
      'missing or uncertain tools cannot be ignored by this fixture');
    return startup.targetBound && startup.modelReady && startup.discovery === 'ready'
      && startup.tools.every(tool => ['connected', 'disabled'].includes(tool.status));
  }, 'execution-ready fixture tools', timeoutMs);
}

// A cold draft can refuse its first send while discovery is still running.
// Exercise that UI path, then retry once only after a proven, unpersisted refusal.
export async function submitColdSessionFixture(page, send, timeoutMs = 30000) {
  const before = await page.evaluate(() => window.desktop.snapshot());
  assert.ok(before.draftId, 'cold-send acceptance must start from a real draft');
  const input = page.locator('.composer > .composer-input');
  const text = await input.evaluate(element => element.value);
  const users = snapshot => snapshot.messages.filter(message => message.role === 'user');
  const accepted = snapshot => users(snapshot).length > 0
    || snapshot.state?.isStreaming || snapshot.state?.desktopStartup?.firstPromptAcceptedAt !== undefined;
  assert.equal(users(before).length, 0);
  const refusal = [
    '消息未发送。请等待工具就绪后重试；如果连接失败，请重新连接此会话。',
    'Message not sent. Retry when tools are ready, or reconnect this conversation if the connection failed.',
  ];
  let refused = false;
  await send();
  const result = await waitForSessionFixtureSnapshot(page, async snapshot => {
    if (accepted(snapshot)) { refused = false; return true; }
    const alerts = await page.getByRole('alert').allTextContents();
    refused = Boolean(snapshot.runtimeId && snapshot.state?.sessionId)
      && alerts.some(alert => refusal.includes(alert.trim()));
    return refused;
  }, 'an accepted cold send or an explicit startup refusal', timeoutMs);
  if (!refused) return result;
  assert.ok(result.runtimeId && result.state?.sessionId);
  assert.deepEqual(users(result), users(before), 'a startup refusal cannot persist a user turn');
  await waitForSessionFixtureSnapshot(page, snapshot => {
    assert.equal(snapshot.runtimeId, result.runtimeId, 'refused-send readiness cannot change workers');
    assert.equal(snapshot.state?.sessionId, result.state.sessionId);
    assert.deepEqual(users(snapshot), users(before));
    assert.equal(Boolean(accepted(snapshot)), false, 'another accepted submission cannot be retried');
    const startup = snapshot.state?.desktopStartup;
    assert.ok(startup, 'a startup refusal must expose authoritative readiness');
    assert.equal(startup.cleanupConfirmed, true);
    assert.notEqual(startup.discovery, 'failed');
    assert.ok(startup.tools.every(tool => tool.status !== 'failed' && tool.cleanupConfirmed !== false),
      'missing or uncertain tools cannot be retried by this fixture');
    return startup.targetBound && startup.modelReady && startup.discovery === 'ready'
      && startup.tools.every(tool => ['connected', 'disabled'].includes(tool.status));
  }, 'the refused cold runtime to finish discovery', timeoutMs);
  await page.waitForFunction(text => document.querySelector('.composer > .composer-input')?.value === text
    && document.querySelector('.composer-action-button')?.disabled === false, text);
  await send();
  return waitForSessionFixtureSnapshot(page, accepted,
    'the explicitly retried cold submission', timeoutMs);
}

export async function submitSessionFixture(page, send) {
  const snapshot = await page.evaluate(() => window.desktop.snapshot());
  if (snapshot.draftId) return submitColdSessionFixture(page, send);
  await waitForSessionFixtureTools(page, snapshot.runtimeId);
  return send();
}

// Startup queries can outlive the editable composer. Retry only a rejected
// preflight, never a failed or partially completed restart.
export async function restartIdleSessionFixture(page, runtimeId, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try { return await page.evaluate(() => window.desktop.restart()); }
    catch (error) {
      if (!String(error.message).endsWith('Error: Session operation in progress')) throw error;
      const current = await page.evaluate(() => window.desktop.snapshot());
      assert.equal(current.runtimeId, runtimeId, 'A refused restart must retain the original runtime');
      if (Date.now() >= deadline) throw error;
      await new Promise(resolve => setTimeout(resolve, 40));
    }
  }
}

export async function relocateIdleWorkspaceFixture(page, path, runtimeId, dialogCount, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  const beforeDialogs = await dialogCount();
  assert.ok(Number.isSafeInteger(beforeDialogs) && beforeDialogs >= 0,
    'Relocation readiness requires a valid directory-dialog counter');
  for (;;) {
    try { return await page.evaluate(path => window.desktop.relocateWorkspace(path), path); }
    catch (error) {
      if (!String(error.message).endsWith('Error: Session operation in progress')) throw error;
      // A refusal after the dialog may belong to a partially completed operation.
      if (await dialogCount() !== beforeDialogs) throw error;
      const current = await page.evaluate(() => window.desktop.snapshot());
      assert.equal(current.runtimeId, runtimeId, 'A refused relocation must retain the original runtime');
      if (Date.now() >= deadline) throw error;
      await new Promise(resolve => setTimeout(resolve, 40));
    }
  }
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
