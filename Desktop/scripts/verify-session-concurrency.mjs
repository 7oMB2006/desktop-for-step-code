import { _electron as electron } from 'playwright';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, writeFile, readFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';

const streams = new Map();
const stopped = new Set();
const systemPrompts = new Map();
const userPrompts = new Map();
const chunk = (delta, finish_reason = null, usage) => `data: ${JSON.stringify({
  id: 'concurrency-fixture', object: 'chat.completion.chunk', created: 1, model: 'fixture',
  choices: [{ index: 0, delta, finish_reason }], ...(usage ? { usage } : {}),
})}\n\n`;
const finish = label => {
  const stream = streams.get(label);
  assert.ok(stream, `Missing stream ${label}`);
  clearInterval(stream.timer);
  stream.res.end(chunk({}, 'stop', { prompt_tokens: 12, completion_tokens: 8, total_tokens: 20 }) + 'data: [DONE]\n\n');
};
const server = createServer(async (req, res) => {
  let body = '';
  for await (const part of req) body += part;
  const payload = JSON.parse(body);
  const lastUser = payload.messages.filter(message => message.role === 'user').at(-1);
  const content = typeof lastUser?.content === 'string' ? lastUser.content : JSON.stringify(lastUser?.content);
  const label = /RUN-[A-Z]/.exec(content)?.[0] ?? 'RUN-X';
  systemPrompts.set(label, payload.messages.filter(message => ['system', 'developer'].includes(message.role)).map(message => typeof message.content === 'string' ? message.content : JSON.stringify(message.content)).join('\n'));
  userPrompts.set(label, typeof lastUser?.content === 'string' ? lastUser.content : lastUser?.content?.filter(block => block.type === 'text').map(block => block.text).join('\n'));
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  if (payload.messages.at(-1)?.role === 'tool') {
    res.end(chunk({ role: 'assistant', content: 'Approval completed.' }) + chunk({}, 'stop') + 'data: [DONE]\n\n');
    return;
  }
  res.write(chunk({ role: 'assistant', content: `${label} output 0. ` }));
  let count = 0;
  const timer = setInterval(() => res.write(chunk({ content: `${label} output ${++count}. ` })), 250);
  streams.set(label, { res, timer });
  res.on('close', () => { clearInterval(timer); stopped.add(label); });
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const profile = await mkdtemp(join(tmpdir(), 'desktop-concurrent-'));
const root = join(profile, 'step-runtime');
const projectADirectory = join(profile, 'project-a');
const projectA = join(profile, 'project-a-alias');
const projectB = join(profile, 'project-b');
await mkdir(projectADirectory); await mkdir(projectB);
await symlink(projectADirectory, projectA, process.platform === 'win32' ? 'junction' : 'dir');
await mkdir(join(root, 'sessions'), { recursive: true });
await writeFile(join(profile, 'preferences.json'), JSON.stringify({ language: 'zh', theme: 'light', workspaces: [projectA, projectB] }));
await writeFile(join(root, 'config.toml'), 'defaultProvider = "fixture"\ndefaultModel = "fixture"\npermissionPreset = "ask"\n[telemetry]\nenabled = false\n');
const config = join(profile, 'fixture.json');
await writeFile(config, JSON.stringify({
  defaultProvider: 'fixture', defaultModel: 'fixture',
  providers: { fixture: { baseUrl: `http://127.0.0.1:${server.address().port}/v1`, api: 'openai-completions', apiKey: 'local-test-only',
    models: [{ id: 'fixture', name: 'Concurrent fixture', contextWindow: 32768, maxTokens: 2048 }] } },
}));
await writeFile(join(root, 'models.json'), await readFile(config));
const env = { ...process.env, DESKTOP_TEST_USER_DATA: profile, DESKTOP_TEST_NO_FOCUS: '1' };
delete env.ELECTRON_RUN_AS_NODE;
const executablePath = process.env.DESKTOP_VERIFY_EXE;
const app = await electron.launch({ ...(executablePath ? { executablePath } : { args: [resolve('.')] }), env, timeout: 60000 });
const errors = [];
try {
  const page = await app.firstWindow();
  page.on('pageerror', error => errors.push(error.message));
  await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    window.setOpacity(0); window.setIgnoreMouseEvents(true); window.showInactive();
  });
  await page.getByText('Step Code 已连接', { exact: true }).waitFor({ timeout: 60000 });
  await page.evaluate(() => {
    window.completionPlays = [];
    window.nativeMediaPlay = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () {
      window.completionPlays.push(this.src);
      return Promise.resolve();
    };
  });
  const input = page.getByRole('textbox', { name: '消息', exact: true });
  const initialEmpty = await page.evaluate(() => window.desktop.snapshot());
  await input.fill('Empty session draft');
  for (let i = 0; i < 5; i++) {
    const reused = await page.evaluate(id => window.desktop.command('new_session', {}, id), initialEmpty.runtimeId);
    assert.equal(reused.runtimeId, initialEmpty.runtimeId);
    assert.equal(reused.state.sessionId, initialEmpty.state.sessionId);
    assert.equal(reused.runtimes.length, initialEmpty.runtimes.length);
    assert.equal(reused.sessions.length, initialEmpty.sessions.length);
  }
  assert.equal(await input.inputValue(), 'Empty session draft');
  await input.fill('RUN-A');
  await input.press('Enter');
  await page.waitForFunction(() => document.querySelector('.messages')?.textContent.includes('RUN-A output')).catch(async error => {
    const snapshot = await page.evaluate(() => window.desktop.snapshot());
    console.log('Isolated fixture state:', JSON.stringify({ model: snapshot.state?.model, messages: snapshot.messages, models: snapshot.models.map(model => [model.provider, model.id]) }));
    throw error;
  });
  const a = await page.evaluate(() => window.desktop.snapshot());
  assert.equal(a.state.isStreaming, true);
  await input.fill('Draft A');
  await page.getByRole('button', { name: '新建会话', exact: true }).click();
  await input.fill('RUN-B');
  await page.getByRole('button', { name: '发送', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.messages')?.textContent.includes('RUN-B output'));
  const b = await page.evaluate(() => window.desktop.snapshot());
  assert.notEqual(a.runtimeId, b.runtimeId);
  assert.equal(b.runtimes.filter(runtime => runtime.status === 'running').length, 2);
  assert.equal(await page.locator('.session-activity.running').count(), 2);
  assert.ok(await page.locator('.session-row > button:first-child').evaluateAll(buttons => buttons.every(button => button.firstElementChild?.classList.contains('session-activity'))));
  assert.equal(await page.locator('.session-activity[data-tooltip]').count(), 0);
  assert.ok(await page.locator('.session-row > button:first-child').evaluateAll(buttons => buttons.every(button => {
    const bounds = button.getBoundingClientRect();
    const text = button.querySelector('span').getBoundingClientRect();
    return text.left - bounds.left <= 10;
  })), 'Session titles have no leftover internal status slot');
  const warmSwitchTimes = await page.evaluate(async ids => {
    const times = [];
    for (const id of ids) {
      const start = performance.now();
      await window.desktop.switchSession(id);
      times.push(performance.now() - start);
    }
    return times;
  }, [a.state.sessionId, b.state.sessionId]);
  console.log('Resident session switch IPC milliseconds:', warmSwitchTimes.map(time => Math.round(time)));
  assert.ok(warmSwitchTimes.every(time => time < 300), 'Resident navigation must not wait for full RPC/catalog refresh');
  assert.ok(await page.locator('.independent-group .session-activity').evaluateAll(dots => dots.every(dot => {
    const icon = dot.closest('.workspace-group').querySelector('.workspace-heading svg').getBoundingClientRect();
    const bounds = dot.getBoundingClientRect();
    const row = dot.closest('.session-row').getBoundingClientRect();
    return Math.abs(bounds.x + bounds.width / 2 - icon.x - icon.width / 2) < 1 && bounds.right < row.left;
  })), 'Status dots occupy the group-icon gutter outside the selected row');
  assert.ok(!(await page.locator('.messages').textContent()).includes('RUN-A output'));
  await mkdir('test-results', { recursive: true });
  await page.screenshot({ path: 'test-results/concurrent-two-running.png' });
  await input.fill('Draft B');
  await page.evaluate(() => {
    const start = performance.now();
    const observer = new MutationObserver(() => {
      if (document.querySelector('.window-session-title')?.textContent !== 'RUN-A' || document.querySelector('.composer > textarea')?.value !== 'Draft A') return;
      window.residentSwitchPaintMs = performance.now() - start;
      observer.disconnect();
    });
    observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true });
  });
  await page.locator('.session-row').filter({ hasText: 'RUN-A' }).locator('button').first().click();
  await page.waitForFunction(() => document.querySelector('.composer > textarea')?.value === 'Draft A').catch(async error => {
    console.log('Navigation fixture:', await page.evaluate(async () => ({
      draft: document.querySelector('.composer > textarea')?.value,
      rows: [...document.querySelectorAll('.session-row')].map(row => [row.textContent, row.className]),
      error: document.querySelector('.error-banner')?.textContent,
      active: (await window.desktop.snapshot()).state?.sessionId,
    })));
    await page.screenshot({ path: 'test-results/concurrent-failed-navigation.png' });
    throw error;
  });
  console.log('Resident session title/draft paint milliseconds:', Math.round(await page.evaluate(() => window.residentSwitchPaintMs)));
  await page.waitForFunction(() => document.querySelector('.messages')?.textContent.includes('RUN-A output'));
  assert.ok(!(await page.locator('.messages').textContent()).includes('RUN-B output'));
  await page.locator('.session-row').filter({ hasText: 'RUN-B' }).locator('button').first().click();
  await page.waitForFunction(() => document.querySelector('.composer > textarea')?.value === 'Draft B');
  await input.fill('');
  await page.getByRole('button', { name: '停止此轮', exact: true }).click();
  await page.getByRole('button', { name: '发送', exact: true }).waitFor();
  const afterStop = await page.evaluate(() => window.desktop.snapshot());
  assert.equal(afterStop.runtimes.find(runtime => runtime.runtimeId === a.runtimeId).status, 'running');
  assert.equal(afterStop.runtimes.find(runtime => runtime.runtimeId === b.runtimeId).status, 'interrupted');
  assert.equal(await page.evaluate(() => window.completionPlays.length), 0);
  assert.equal(await page.locator('.session-activity.interrupted').evaluate(dot => getComputedStyle(dot).animationName), 'none');
  assert.ok(stopped.has('RUN-B'));
  assert.ok(!stopped.has('RUN-A'));
  await page.evaluate(id => window.desktop.command('set_permission_preset', { preset: 'read-only' }, id), b.runtimeId);
  const scopedPermissions = await page.evaluate(() => window.desktop.snapshot());
  assert.equal(scopedPermissions.permissionPreset, 'read-only');
  assert.equal(scopedPermissions.runtimes.find(runtime => runtime.runtimeId === a.runtimeId).status, 'running');
  await page.evaluate(id => window.desktop.command('set_permission_preset', { preset: 'ask' }, id), b.runtimeId);
  await input.fill('Idle draft B');
  await assert.rejects(page.evaluate(() => window.desktop.command('abort', {}, 'expired-runtime')), /not connected/);
  await assert.rejects(page.evaluate(() => window.desktop.saveMcp('blocked', { command: 'node', args: [], enabled: false })), /Stop/);

  // Ask A for a real write_file tool only after switching away to B.
  const aStream = streams.get('RUN-A');
  clearInterval(aStream.timer);
  aStream.res.end(chunk({ tool_calls: [{ index: 0, id: 'concurrent-write', type: 'function', function: {
    name: 'write_file', arguments: JSON.stringify({ path: 'approved.txt', content: 'approved in A only' }),
  } }] }) + chunk({}, 'tool_calls') + 'data: [DONE]\n\n');
  await page.waitForFunction(() => document.querySelector('.session-activity.waiting'));
  assert.equal(await page.getByRole('dialog').count(), 0, 'Background approval must not open over B');
  await page.screenshot({ path: 'test-results/concurrent-background-approval.png' });
  await page.locator('.session-row').filter({ hasText: 'RUN-A' }).locator('button').first().click();
  const approval = page.getByRole('dialog');
  await approval.waitFor();
  assert.equal(await input.inputValue(), 'Draft A');
  await approval.getByRole('button', { name: '稍后处理', exact: true }).click();
  await page.getByText('此会话有待确认的操作', { exact: true }).waitFor();
  await page.locator('.session-row').filter({ hasText: 'RUN-B' }).locator('button').first().click();
  assert.equal(await page.getByRole('dialog').count(), 0);
  await page.locator('.session-row').filter({ hasText: 'RUN-A' }).locator('button').first().click();
  await approval.waitFor();
  await approval.getByRole('button', { name: '确认', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.messages')?.textContent.includes('Approval completed.'));
  await page.waitForFunction(() => document.querySelector('.composer-action-button')?.getAttribute('data-action') === 'send');
  assert.equal(await readFile(join(a.preferences.workspace, 'approved.txt'), 'utf8'), 'approved in A only');
  const done = await page.evaluate(() => window.desktop.snapshot());
  assert.equal(done.state.sessionId, a.state.sessionId);
  assert.equal(done.requests.length, 0);
  assert.ok(done.stats.assistantMessages > 0);
  assert.equal(done.runtimes.find(runtime => runtime.runtimeId === a.runtimeId).status, 'idle');
  await page.waitForFunction(() => window.completionPlays.length === 1);
  assert.equal(await page.locator('.session-activity.completed').count(), 0, 'Foreground completion is already read');
  const decodedSound = await page.evaluate(async () => {
    const context = new AudioContext();
    try {
      const bytes = await (await fetch(window.completionPlays[0])).arrayBuffer();
      const decoded = await context.decodeAudioData(bytes);
      const audio = new Audio(window.completionPlays[0]);
      audio.muted = true;
      await window.nativeMediaPlay.call(audio);
      const playing = !audio.paused && audio.readyState >= 2;
      audio.pause();
      return { duration: decoded.duration, channels: decoded.numberOfChannels, playing };
    } finally { await context.close(); }
  });
  assert.ok(decodedSound.duration > 0 && decodedSound.channels > 0);
  assert.equal(decodedSound.playing, true);

  // Shared-directory concurrency must send directly, with collaboration rules in system context.
  await input.fill('RUN-C');
  await input.press('Enter');
  await page.waitForFunction(() => document.querySelector('.messages')?.textContent.includes('RUN-C output'));
  const resident = await page.evaluate(async () => {
    const snapshot = await window.desktop.snapshot();
    return window.desktop.command('new_session', {}, snapshot.runtimeId);
  });
  // A renderer navigation applies the host-created empty same-directory session.
  await page.locator('.session-row').filter({ hasText: 'RUN-B' }).locator('button').first().click();
  await page.locator('.session-row').filter({ hasText: '新会话' }).first().locator('button').first().click();
  assert.equal((await page.evaluate(() => window.desktop.snapshot())).runtimeId, resident.runtimeId);
  await app.evaluate(({ dialog }) => {
    globalThis.sharedWarnings = 0;
    globalThis.originalMessageBox = dialog.showMessageBox;
    dialog.showMessageBox = async (_window, options) => {
      if (options.type === 'warning') { globalThis.sharedWarnings++; return { response: 1, checkboxChecked: false }; }
      return globalThis.originalMessageBox(_window, options);
    };
  });
  await input.fill('RUN-D');
  await input.press('Enter');
  await page.waitForFunction(() => document.querySelector('.messages')?.textContent.includes('RUN-D output'));
  const parallelSameDirectory = await page.evaluate(() => window.desktop.snapshot());
  assert.equal(parallelSameDirectory.runtimes.filter(runtime => runtime.status === 'running').length, 2);
  assert.equal(await app.evaluate(() => globalThis.sharedWarnings), 0, 'Shared-directory sends must not display a generic confirmation');
  for (const label of ['RUN-A', 'RUN-B', 'RUN-C', 'RUN-D']) {
    assert.ok(systemPrompts.get(label)?.includes('# Shared workspace collaboration'), label);
    assert.ok(systemPrompts.get(label)?.includes('Stage only your task'), label);
    assert.ok(systemPrompts.get(label)?.includes('You are'), 'The base system prompt remains present');
    assert.equal(userPrompts.get(label), label, 'System guidance must not contaminate user prompts');
  }
  await page.screenshot({ path: 'test-results/concurrent-shared-directory-direct.png' });
  finish('RUN-D');
  await page.getByRole('button', { name: '发送', exact: true }).waitFor();
  finish('RUN-C');
  await page.waitForFunction(async () => (await window.desktop.snapshot()).runtimes.every(runtime => runtime.status !== 'running'));
  await page.waitForFunction(() => window.completionPlays.length === 3);
  const completionSnapshot = await page.evaluate(() => window.desktop.snapshot());
  assert.ok(completionSnapshot.unreadSessionIds.includes(a.state.sessionId));
  assert.ok(!completionSnapshot.unreadSessionIds.includes(resident.state.sessionId));
  assert.equal(await page.locator('.session-activity.completed').count(), 1);
  assert.equal(await page.locator('.session-activity.completed').evaluate(dot => getComputedStyle(dot).animationName), 'none');
  await page.screenshot({ path: 'test-results/concurrent-completion-status.png' });
  await page.locator('.independent-group').screenshot({ path: 'test-results/session-status-gutter.png' });
  // More than two idle background workers are recycled; drafts follow sessions,
  // not process identities, and restored history still comes from upstream.
  await page.getByRole('button', { name: '新建会话', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('.composer > textarea')?.disabled);
  await assert.rejects(page.evaluate(id => window.desktop.command('get_session_stats', {}, id), b.runtimeId), /not connected/);
  await page.locator('.session-row').filter({ hasText: 'RUN-B' }).locator('button').first().click();
  await page.waitForFunction(() => document.querySelector('.composer > textarea')?.value === 'Idle draft B');
  const restoredB = await page.evaluate(() => window.desktop.snapshot());
  assert.notEqual(restoredB.runtimeId, b.runtimeId);
  assert.equal(restoredB.state.sessionId, b.state.sessionId);
  assert.ok(JSON.stringify(restoredB.messages).includes('RUN-B output'));
  await page.locator('.session-row').filter({ hasText: 'RUN-A' }).locator('button').first().click();
  await page.waitForFunction(() => document.querySelector('.window-session-title')?.textContent === 'RUN-A');
  await page.waitForFunction(() => !document.querySelector('.session-activity.completed'));
  const readSnapshot = await page.evaluate(() => window.desktop.snapshot());
  assert.ok(!readSnapshot.unreadSessionIds.includes(a.state.sessionId));
  await page.getByRole('button', { name: '新建会话', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('.composer > textarea')?.disabled);
  assert.equal(await page.locator('.session-activity.completed').count(), 0, 'Leaving the read session does not restore its dot');
  for (const theme of ['dark', 'light']) {
    await page.evaluate(theme => window.desktop.preferences({ theme }), theme);
    await page.getByRole('button', { name: '新建会话', exact: true }).click();
    await page.waitForFunction(theme => document.documentElement.dataset.theme === theme && [...document.querySelectorAll('button')].find(button => button.textContent === '新建会话')?.disabled === false, theme);
    await page.screenshot({ path: `test-results/concurrent-${theme}.png` });
  }
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(700, 700));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.screenshot({ path: 'test-results/concurrent-narrow.png' });
  // Exercise project creation too: different directories keep independent
  // empty workers, returning to one reuses its original session identity.
  const emptyA = await page.evaluate(path => window.desktop.workspace(path), projectA);
  assert.notEqual(emptyA.preferences.workspace, projectA, 'Opening the directory alias must return its canonical workspace path');
  assert.ok(emptyA.preferences.workspaces.includes(emptyA.preferences.workspace));
  const emptyB = await page.evaluate(path => window.desktop.workspace(path), projectB);
  assert.notEqual(emptyA.runtimeId, emptyB.runtimeId);
  const returnedA = await page.evaluate(path => window.desktop.workspace(path), emptyA.preferences.workspace);
  assert.equal(returnedA.runtimeId, emptyA.runtimeId);
  assert.equal(returnedA.state.sessionId, emptyA.state.sessionId);
  for (let i = 0; i < 5; i++) {
    const reused = await page.evaluate(id => window.desktop.command('new_session', {}, id), emptyA.runtimeId);
    assert.equal(reused.runtimeId, emptyA.runtimeId);
    assert.equal(reused.sessions.length, returnedA.sessions.length);
    assert.equal(reused.runtimes.length, returnedA.runtimes.length);
  }
  console.log('Empty-session reuse passed: repeated creation preserves worker/session identity and draft; separate projects stay independent, including a canonicalized directory alias.');
  assert.deepEqual(errors, []);
  console.log('Concurrent real RPC/SSE passed: background streams, targeted abort, scoped approvals, drafts across recycling, direct shared-directory sends with system collaboration rules, statistics, themes, narrow layout, left status dots and decoded completion audio (playback intercepted).');
} finally {
  for (const stream of streams.values()) { clearInterval(stream.timer); stream.res.destroy(); }
  await app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false }); }).catch(() => {});
  await app.close();
  await new Promise(resolve => server.close(resolve));
}
