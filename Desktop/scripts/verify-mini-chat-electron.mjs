import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron as electron } from 'playwright';
import { closeDesktopFixtureAndWait } from './close-desktop-fixture.mjs';
import { settleLayout } from './settle-layout.mjs';

const profile = await mkdtemp(join(tmpdir(), 'desktop-mini-chat-'));
const root = join(profile, 'step-runtime'), workspace = join(profile, 'project');
const output = resolve('test-results/mini-chat-native');
await mkdir(join(root, 'sessions'), { recursive: true }); await mkdir(workspace); await mkdir(output, { recursive: true });
const timestamp = new Date().toISOString();
for (const id of ['one', 'two', 'three']) {
  const lines = [{ type: 'session', version: 3, id, cwd: workspace, timestamp }];
  let parentId = null;
  for (let index = 0; index < 12; index++) {
    for (const role of ['user', 'assistant']) {
      const entry = `${id}-${role}-${index}`;
      lines.push({ type: 'message', id: entry, parentId, timestamp, message: {
        role, timestamp: Date.now() + index,
        content: role === 'user' ? `Question ${index} in ${id}` : [
          { type: 'thinking', thinking: `Reasoning ${index}: retain manually opened details.` },
          { type: 'text', text: `## Answer ${index}\n\nNative MiniChat reuses the actual conversation and composer.\n\n`
            + 'Readable text remains available when switching windows.\n\n'.repeat(3) + '```ts\nconst shared = "one runtime";\n```' },
        ], ...(role === 'assistant' ? { stopReason: 'stop', usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: { total: 0 } } } : {}),
      } });
      parentId = entry;
    }
  }
  lines.push({ type: 'session_info', id: `${id}-name`, parentId, timestamp, name: `Mini ${id}` });
  await writeFile(join(root, 'sessions', `${id}.jsonl`), lines.map(value => JSON.stringify(value)).join('\n') + '\n');
}
await writeFile(join(root, 'config.toml'), 'defaultProvider = "fixture"\ndefaultModel = "fixture"\npermissionPreset = "ask"\n[telemetry]\nenabled = false\n');
await writeFile(join(profile, 'preferences.json'), JSON.stringify({ language: 'zh', theme: 'dark', workspace, workspaces: [workspace] }));
const requests = [];
const held = new Map();
const chunk = (delta, finish_reason = null) => `data: ${JSON.stringify({ id: 'mini-fixture', object: 'chat.completion.chunk', model: 'fixture',
  choices: [{ index: 0, delta, finish_reason }] })}\n\n`;
const textOf = content => typeof content === 'string' ? content : content?.map(block => block.text ?? '').join('\n') ?? '';
const server = createServer(async (request, response) => {
  let body = ''; for await (const part of request) body += part;
  const payload = JSON.parse(body); requests.push(payload);
  const label = textOf(payload.messages.findLast(message => message.role === 'user' && /MINI-/.test(textOf(message.content)))?.content);
  response.writeHead(200, { 'content-type': 'text/event-stream' });
  if (label.includes('MINI-APPROVAL') && !payload.messages.some(message => message.role === 'tool' && message.tool_call_id === 'mini-write')) {
    response.end(chunk({ tool_calls: [{ index: 0, id: 'mini-write', type: 'function',
      function: { name: 'write_file', arguments: JSON.stringify({ path: 'mini-approved.txt', content: 'Explicit MiniChat approval' }) } }] }, 'tool_calls') + 'data: [DONE]\n\n');
  } else if (label.includes('MINI-HOLD')) {
    held.set(label, response); response.write(chunk({ role: 'assistant', content: 'Mini streaming is live.' }));
  } else response.end(chunk({ role: 'assistant', content: `Completed ${label || 'MINI-SEND'}.` }, 'stop') + 'data: [DONE]\n\n');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
await writeFile(join(root, 'models.json'), JSON.stringify({ providers: { fixture: {
  api: 'openai-completions', baseUrl: `http://127.0.0.1:${server.address().port}/v1`, apiKey: 'isolated-mini-fixture',
  models: [{ id: 'fixture', name: 'Mini fixture', contextWindow: 65536, maxTokens: 2048 }],
} } }));
const env = { ...process.env, DESKTOP_TEST_USER_DATA: profile, DESKTOP_TEST_NO_FOCUS: '1' };
delete env.ELECTRON_RUN_AS_NODE;
let app, mini;
const errors = [];
try {
  app = await electron.launch({ args: [resolve('.')], env, timeout: 60000 });
  const main = await app.firstWindow();
  main.setDefaultTimeout(30000); main.on('pageerror', error => errors.push(error.message));
  await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    window.setOpacity(0); window.setIgnoreMouseEvents(true); window.showInactive(); window.setSize(1320, 880);
  });
  await main.getByRole('button', { name: 'Mini one', exact: true }).click();
  await main.waitForFunction(async () => {
    const snapshot = await window.desktop.snapshot();
    return snapshot.state?.sessionId === 'one' && !document.querySelector('.session-reading-preview')
      && document.querySelector('.composer-wrap')?.getAttribute('aria-busy') === 'false'
      && document.querySelector('main .composer-input')?.getAttribute('contenteditable') === 'true';
  }, undefined, { timeout: 60000 });
  await main.locator('main .composer-input').fill('Shared from main');
  const opened = app.waitForEvent('window').catch(error => ({ error }));
  await main.getByRole('button', { name: 'MiniChat', exact: true }).click();
  mini = await opened;
  if (mini.error) throw mini.error;
  mini.setDefaultTimeout(30000); mini.on('pageerror', error => errors.push(error.message));
  await mini.waitForFunction(() => window.desktop?.surface === 'mini' && document.querySelector('main .composer-input'));
  await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows().find(window => window.getTitle() === 'MiniChat');
    window.setOpacity(0); window.setIgnoreMouseEvents(true); window.showInactive();
  });
  const editor = mini.locator('main .composer-input');
  await mini.waitForFunction(() => document.querySelector('main .composer-input')?.textContent === 'Shared from main');
  await editor.fill('Shared from mini');
  await main.waitForFunction(() => document.querySelector('main .composer-input')?.textContent === 'Shared from mini');
  const both = await Promise.all([main.evaluate(() => window.desktop.snapshot()), mini.evaluate(() => window.desktop.snapshot())]);
  assert.equal(both[0].runtimeId, both[1].runtimeId);
  assert.equal(both[0].runtimes.filter(worker => worker.sessionId === 'one').length, 1);
  assert.equal(await mini.locator('.sidebar, .window-bar, .right-tool-rail, .performance-bar').count(), 0);
  assert.equal(await mini.evaluate(() => typeof window.require), 'undefined');
  await assert.rejects(mini.evaluate(() => window.desktop.browserLayout({})), /main window/);
  await assert.rejects(mini.evaluate(() => window.desktop.preferences({ language: 'en' })), /main window/);
  const quote = { id: 'shared-quote', entryId: 'one-assistant-0', messageIndex: 1, role: 'assistant',
    text: 'Native MiniChat', markdown: 'Native MiniChat', startOffset: 0, endOffset: 15 };
  await main.evaluate(async quote => {
    const owner = { sessionId: 'one' }, current = await window.desktop.composerRead(owner);
    await window.desktop.composerWrite({ owner, revision: current.revision, value: { ...current.value, quotes: [quote] } });
  }, quote);
  await mini.locator('.quote-chip').waitFor();
  await main.locator('.quote-chip').waitFor();
  await mini.screenshot({ path: join(output, 'native-dark.png') });
  const selected = await main.evaluate(() => window.desktop.snapshot());
  await mini.getByRole('button', { name: '切换小窗会话' }).click();
  await mini.getByRole('menuitemradio', { name: 'Mini two', exact: true }).click();
  await mini.waitForFunction(async () => (await window.desktop.snapshot()).state?.sessionId === 'two');
  assert.equal((await main.evaluate(() => window.desktop.snapshot())).runtimeId, selected.runtimeId);
  await mini.getByRole('button', { name: '切换小窗会话' }).click();
  await mini.getByRole('menuitemradio', { name: 'Mini one', exact: true }).click();
  await mini.waitForFunction(() => document.querySelector('main .composer-input')?.textContent === 'Shared from mini');
  await mini.locator('.quote-chip').waitFor();
  // Reload between atomic take and prompt restores the abandoned unsent input.
  await mini.evaluate(async () => {
    const owner = { sessionId: 'one' }, current = await window.desktop.composerRead(owner);
    await window.desktop.composerTake(owner, current.revision);
  });
  await main.waitForFunction(() => document.querySelector('main .composer-input')?.textContent === '');
  await mini.reload();
  await mini.waitForFunction(() => document.querySelector('main .composer-input')?.textContent === 'Shared from mini');
  await main.waitForFunction(() => document.querySelector('main .composer-input')?.textContent === 'Shared from mini');
  await mini.locator('.quote-chip').waitFor();
  assert.equal(requests.length, 0, 'Recovering an abandoned take never submits a model request');
  const cold = await Promise.all([
    main.evaluate(() => window.desktop.navigateSession('three')),
    mini.evaluate(() => window.desktop.navigateSession('three')),
  ]);
  assert.equal(cold[0].runtimeId, cold[1].runtimeId, 'Both windows coalesce the same cold startup');
  assert.equal(cold[0].runtimes.filter(worker => worker.sessionId === 'three').length, 1);
  await Promise.all([main.reload(), mini.reload()]);
  await mini.getByRole('button', { name: '切换小窗会话' }).click();
  await mini.getByRole('menuitemradio', { name: 'Mini one', exact: true }).click();
  await mini.waitForFunction(() => document.querySelector('main .composer-input')?.textContent === 'Shared from mini');
  assert.equal((await main.evaluate(() => window.desktop.snapshot())).state.sessionId, 'three');
  await assert.rejects(main.evaluate(() => window.desktop.deleteSession('one')), /both windows|主窗口和小窗/);
  await mini.getByRole('button', { name: '关闭小窗', exact: true }).click();
  await main.getByRole('button', { name: 'MiniChat', exact: true }).click();
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => window.getTitle() === 'MiniChat').showInactive());
  assert.equal((await mini.evaluate(() => window.desktop.snapshot())).state.sessionId, 'one', 'Reopening resumes MiniChat, not main’s different selection');
  await main.getByRole('button', { name: 'Mini one', exact: true }).click();
  await main.waitForFunction(() => document.querySelector('main .composer-input')?.textContent === 'Shared from mini'
    && document.querySelector('.composer-wrap')?.getAttribute('aria-busy') === 'false');
  const waitForPin = async expected => {
    for (let attempt = 0; attempt < 100; attempt++) {
      const pinned = await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().find(window => window.getTitle() === 'MiniChat').isAlwaysOnTop());
      if (pinned === expected) return;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert.fail(`OS pin state never became ${expected}`);
  };
  await mini.getByRole('button', { name: '置顶窗口', exact: true }).click();
  await waitForPin(true);
  await mini.getByRole('button', { name: '取消置顶', exact: true }).click();
  await waitForPin(false);
  await mini.evaluate(() => { window.__soundPlays = 0; HTMLMediaElement.prototype.play = async () => { window.__soundPlays++; }; });
  await main.evaluate(() => { window.__soundPlays = 0; HTMLMediaElement.prototype.play = async () => { window.__soundPlays++; }; });
  // Two windows compete for exactly the same input; only the winner may prompt.
  await editor.fill('MINI-SEND-ONCE');
  await main.waitForFunction(() => document.querySelector('main .composer-input')?.textContent === 'MINI-SEND-ONCE');
  await Promise.all([main.locator('main .composer-action-button').click(), mini.locator('main .composer-action-button').click()]);
  await mini.getByText(/Completed [\s\S]*MINI-SEND-ONCE/).waitFor();
  assert.equal(requests.filter(request => JSON.stringify(request.messages).includes('MINI-SEND-ONCE')).length, 1);
  await mini.waitForFunction(async () => !(await window.desktop.snapshot()).state.isStreaming);
  await main.waitForFunction(() => window.__soundPlays === 1);
  assert.equal(await mini.evaluate(() => window.__soundPlays), 0);
  assert.equal(await main.evaluate(() => window.__soundPlays), 1);
  await editor.fill('MINI-HOLD-STOP'); await editor.press('Enter');
  await mini.getByText('Mini streaming is live.', { exact: true }).waitFor();
  await mini.getByRole('button', { name: '关闭小窗', exact: true }).click();
  assert.equal((await main.evaluate(() => window.desktop.snapshot())).state.isStreaming, true, 'Hiding MiniChat never stops the worker');
  await main.getByRole('button', { name: 'MiniChat', exact: true }).click();
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => window.getTitle() === 'MiniChat').showInactive());
  await mini.getByRole('button', { name: '停止此轮', exact: true }).click();
  await mini.waitForFunction(async () => !(await window.desktop.snapshot()).state.isStreaming);
  // A genuine write-file approval remains pending when the mini window is hidden.
  await editor.fill('MINI-APPROVAL'); await editor.press('Enter');
  await mini.locator('.permission-approval').waitFor();
  const pending = (await mini.evaluate(() => window.desktop.snapshot())).requests[0];
  await mini.getByRole('button', { name: '关闭小窗', exact: true }).click();
  assert.equal((await main.evaluate(() => window.desktop.snapshot())).requests[0].id, pending.id);
  await main.getByRole('button', { name: 'MiniChat', exact: true }).click();
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => window.getTitle() === 'MiniChat').showInactive());
  await mini.locator('.permission-approval').getByRole('button', { name: '批准本次操作', exact: true }).click();
  await mini.waitForFunction(async () => !(await window.desktop.snapshot()).state.isStreaming);
  assert.equal(await readFile(join(workspace, 'mini-approved.txt'), 'utf8'), 'Explicit MiniChat approval');
  assert.equal((await main.evaluate(() => window.desktop.snapshot())).requests.length, 0);
  // Independent reading survives reload; Return explicitly transfers it to main.
  await mini.evaluate(() => {
    const viewport = document.querySelector('.conversation'); viewport.scrollTop = 180;
    viewport.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, bubbles: true }));
    viewport.dispatchEvent(new Event('scroll', { bubbles: true }));
  });
  await mini.getByRole('button', { name: '回到底部', exact: true }).waitFor();
  await mini.waitForTimeout(300);
  const reading = await mini.evaluate(() => document.querySelector('.conversation').scrollTop);
  await mini.reload();
  await mini.waitForFunction(() => document.querySelector('main .composer-input')?.getAttribute('contenteditable') === 'true');
  await mini.waitForFunction(top => Math.abs(document.querySelector('.conversation').scrollTop - top) < 4, reading);
  const anchor = await mini.evaluate(() => {
    const viewport = document.querySelector('.conversation');
    const top = viewport.getBoundingClientRect().top;
    const article = [...viewport.querySelectorAll('.messages > article[data-message-index]')]
      .find(article => article.getBoundingClientRect().bottom > top);
    return { index: article.dataset.messageIndex, offset: article.getBoundingClientRect().top - top };
  });
  await mini.getByRole('button', { name: '回到主窗口', exact: true }).click();
  await main.waitForFunction(anchor => {
    const viewport = document.querySelector('.conversation');
    const article = viewport.querySelector(`article[data-message-index="${anchor.index}"]`);
    return article && Math.abs(article.getBoundingClientRect().top - viewport.getBoundingClientRect().top - anchor.offset) < 4;
  }, anchor);
  const beforeRestart = (await main.evaluate(() => window.desktop.snapshot())).runtimeId;
  const restarted = await main.evaluate(() => window.desktop.restart());
  assert.notEqual(restarted.runtimeId, beforeRestart);
  await mini.waitForFunction(async id => (await window.desktop.snapshot()).runtimeId === id, restarted.runtimeId);
  await mini.waitForFunction(() => document.querySelector('main .composer-input')?.getAttribute('contenteditable') === 'true');
  // Shared first-message drafts promote once, and both views follow that identity.
  await main.evaluate(() => window.desktop.beginSession()).then(() => main.reload());
  await main.waitForFunction(() => document.querySelector('main .composer-input')?.getAttribute('contenteditable') === 'true');
  await main.getByRole('button', { name: 'MiniChat', exact: true }).click();
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => window.getTitle() === 'MiniChat').showInactive());
  await mini.waitForFunction(async () => Boolean((await window.desktop.snapshot()).draftId));
  await mini.evaluate(() => window.desktop.command('set_launch_mode', { mode: 'review', enabled: true }));
  await main.waitForFunction(async () => (await window.desktop.snapshot()).launch.reviewArmed === true);
  await main.evaluate(() => window.desktop.command('set_launch_mode', { mode: 'review', enabled: false }));
  await mini.waitForFunction(async () => (await window.desktop.snapshot()).launch.reviewArmed === false);
  await editor.fill('MINI-FIRST-MESSAGE'); await editor.press('Enter');
  await mini.getByText('Completed MINI-FIRST-MESSAGE.', { exact: true }).waitFor();
  const afterDraft = await Promise.all([main.evaluate(() => window.desktop.snapshot()), mini.evaluate(() => window.desktop.snapshot())]);
  assert.equal(afterDraft[0].runtimeId, afterDraft[1].runtimeId);
  assert.equal(afterDraft[0].draftId, undefined);
  await main.evaluate(() => window.desktop.preferences({ theme: 'light', language: 'en' }));
  await mini.getByRole('button', { name: 'Switch MiniChat conversation', exact: true }).waitFor();
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => window.getTitle() === 'MiniChat').setSize(380, 400));
  await editor.fill('A long draft\n'.repeat(35));
  await editor.focus(); await settleLayout(mini.locator('main .composer'));
  assert.equal(await mini.evaluate(() => {
    const input = document.querySelector('main .composer-input').getBoundingClientRect();
    const send = document.querySelector('main .composer-action-button').getBoundingClientRect();
    return input.top >= 56 && send.bottom <= innerHeight && send.right <= innerWidth;
  }), true, 'Low-height MiniChat keeps the editor and send controls reachable');
  assert.equal(await mini.locator('main .composer').evaluate(element => {
    const rect = element.getBoundingClientRect();
    for (let parent = element.parentElement; parent; parent = parent.parentElement) {
      const style = getComputedStyle(parent), bounds = parent.getBoundingClientRect();
      if (/(hidden|clip|auto|scroll)/.test(style.overflowX) && (rect.left - 4 < bounds.left || rect.right + 4 > bounds.right)) return false;
      if (/(hidden|clip|auto|scroll)/.test(style.overflowY) && (rect.top - 4 < bounds.top || rect.bottom + 4 > bounds.bottom)) return false;
    }
    return true;
  }), true, 'The complete composer focus outline stays inside clipping ancestors');
  await mini.screenshot({ path: join(output, 'native-light-narrow.png') });
  assert.deepEqual(errors, []);
  await writeFile(join(output, 'result.json'), JSON.stringify({ profile, requests: requests.length, errors, verified: true }, null, 2));
  console.log('PASS native MiniChat: coalesced runtime, independent navigation, shared input/quotes/options, abandoned-send recovery, one send/sound, streaming/stop, real approval, hide/reload/return/restart, deletion guard, draft promotion, pin, narrow light/en/focus.');
} catch (error) {
  console.error('Native windows at failure', await app?.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map(window => ({
    title: window.getTitle(), url: window.webContents.getURL(),
  }))).catch(() => []));
  for (const [index, page] of (app?.windows() ?? []).entries()) {
    await page.screenshot({ path: join(output, `failure-${index}.png`) }).catch(() => {});
    console.error(`window ${index}`, await page.locator('body').innerText().catch(() => ''), errors);
  }
  console.error('Isolated profile:', profile);
  throw error;
} finally {
  for (const response of held.values()) response.destroy();
  if (app) await closeDesktopFixtureAndWait(app);
  server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
}
