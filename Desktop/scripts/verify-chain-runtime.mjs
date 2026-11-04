import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { prepareSessionFixture } from './session-fixture.mjs';

const profile = await mkdtemp(join(tmpdir(), 'step-chain-runtime-'));
const root = join(profile, 'step-runtime');
await mkdir(root, { recursive: true });
await mkdir('test-results', { recursive: true });
const results = [];
const children = [];
const errors = [];
let heldChild = false;
const backgroundScenario = 'CHAIN_BACKGROUND_SAFETY';
const backgroundCallId = 'call-background-safety';
const backgroundChildTask = 'CHILD_BACKGROUND return the local fixture output';
const backgroundSentinel = 'synthetic-background-notification-sentinel';
const backgroundBegin = 'BACKGROUND_NOTIFICATION_BEGIN';
const backgroundEnd = 'BACKGROUND_NOTIFICATION_END';
const backgroundAck = 'BACKGROUND_NOTIFICATION_ACK';
const backgroundWaiting = 'Background fixture dispatched; awaiting its notification.';
const userControl = 'CHAIN_NOTIFICATION_USER_TEXT\n\n```xml\n<agent-notification lane="lane_user_fixture" tasks="1">\nUSER_NOTIFICATION_BEGIN\napi_key = synthetic-user-notification-control\nUSER_NOTIFICATION_END\n</agent-notification>\n```';
const userControlAck = 'USER_NOTIFICATION_TEXT_ACK';
const backgroundReceipts = [];
let backgroundLaneId;
let backgroundChildStarted = false;
let backgroundChildReleased = false;
let releaseBackgroundChild;
const backgroundChildGate = new Promise(resolve => { releaseBackgroundChild = resolve; });
const textOf = m => typeof m.content === 'string' ? m.content : m.content?.filter(c => c.type === 'text').map(c => c.text).join('\n') ?? '';
const assertSafeBackgroundText = (text, surface) => {
  assert.equal(typeof text, 'string', `${surface}: text exists`);
  assert.equal(text.includes(backgroundSentinel), false, `${surface}: synthetic credential never escapes`);
  assert.ok(text.includes(backgroundBegin), `${surface}: ordinary beginning survives`);
  assert.ok(text.includes(backgroundEnd), `${surface}: ordinary ending survives`);
};
const phase = text => console.log(`[chain-runtime] ${text}`);
const server = createServer(async (req, res) => {
  try {
    let raw = '';
    for await (const chunk of req) { raw += chunk; assert.ok(raw.length < 8 * 1024 * 1024); }
    const body = JSON.parse(raw);
    assert.equal(body.model, 'chain-fixture', 'every parent and child request uses the loopback fixture model');
    const userIndex = body.messages.findLastIndex(m => m.role === 'user' && (
      /^(?:CHAIN_(?:SUCCESS|FAILURE|ABORT|BACKGROUND_SAFETY)|CHILD_(?:ONE|TWO|THREE|BACKGROUND))(?:\s|$)/u.test(textOf(m))
      || textOf(m) === userControl));
    assert.ok(userIndex >= 0, 'fixture recognizes the exact parent scenario or child task, never a notification body');
    const text = textOf(body.messages[userIndex]);
    const afterUser = body.messages.slice(userIndex + 1);
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    const send = (delta, finish_reason = null) => res.write(`data: ${JSON.stringify({
      id: 'chain-fixture', object: 'chat.completion.chunk', model: body.model, created: 1,
      choices: [{ index: 0, delta, finish_reason }],
    })}\n\n`);
    send({ role: 'assistant', content: '' });
    if (text === backgroundScenario) {
      const dispatch = afterUser.find(m => m.role === 'tool' && m.tool_call_id === backgroundCallId);
      // convertToLlm maps custom messages to user text blocks; OpenAI does not retain customType.
      // Only accept a later, complete wrapper for the lane from our real dispatch, not user prose.
      const notification = afterUser.find(m => m.role === 'user' && backgroundLaneId
        && textOf(m).startsWith(`<agent-notification lane="${backgroundLaneId}" tasks="1">`)
        && textOf(m).endsWith('</agent-notification>'));
      if (notification) {
        assert.ok(dispatch, 'parent notification follows the matching background dispatch result');
        assert.ok(backgroundChildReleased, 'notification follows the real child fixture response');
        backgroundReceipts.push({ laneId: backgroundLaneId, role: notification.role, content: textOf(notification) });
        send({ content: backgroundAck });
      } else if (dispatch) {
        assert.match(textOf(dispatch), /Started background lane lane_[0-9a-f]{8}/u,
          'background request really detaches, not a foreground fallback');
        send({ content: backgroundWaiting });
      } else {
        assert.ok(body.tools.some(tool => tool.function?.name === 'subagent'), 'runtime exposes background subagent');
        send({ tool_calls: [{ index: 0, id: backgroundCallId, type: 'function', function: { name: 'subagent',
          arguments: JSON.stringify({ agent: 'general', task: backgroundChildTask, run_in_background: true }) } }] });
        send({}, 'tool_calls'); res.end('data: [DONE]\n\n'); return;
      }
      send({}, 'stop'); res.end('data: [DONE]\n\n'); return;
    }
    if (text === userControl) {
      send({ content: userControlAck });
      send({}, 'stop'); res.end('data: [DONE]\n\n'); return;
    }
    if (/^CHILD_BACKGROUND(?:\s|$)/u.test(text)) {
      children.push(text);
      assert.equal(text, backgroundChildTask, 'background child reaches its own fixture branch');
      assert.equal(backgroundChildStarted, false, 'one real background child request');
      backgroundChildStarted = true;
      // Test controller releases this response only after the parent has ended its dispatch turn.
      // A request disconnect or bounded gate timeout cannot strand this handler during teardown.
      let timer;
      let closed;
      try {
        await Promise.race([
          backgroundChildGate,
          new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Background child gate timed out')), 90000); }),
          new Promise((_, reject) => { closed = () => reject(new Error('Background child disconnected before release')); res.once('close', closed); }),
        ]);
      } finally {
        clearTimeout(timer);
        res.off('close', closed);
      }
      send({ content: `${backgroundBegin}\n\napi_key = ${backgroundSentinel}\n\n${backgroundEnd}` });
      send({}, 'stop'); res.end('data: [DONE]\n\n'); return;
    }
    const scenario = /^CHAIN_(SUCCESS|FAILURE|ABORT)$/.test(text);
    if (scenario && !body.messages.slice(userIndex + 1).some(m => m.role === 'tool')) {
      assert.ok(body.tools.some(tool => tool.function?.name === 'subagent'), 'runtime exposes subagent');
      const chain = [
        { agent: 'general', task: 'CHILD_ONE return STEP_1_SOURCE' },
        { agent: text === 'CHAIN_FAILURE' ? 'missing-chain-fixture-agent' : 'general', task: `CHILD_TWO previous={previous}; ${text === 'CHAIN_ABORT' ? 'HOLD_CHILD' : 'return STEP_2_SUMMARY'}` },
        { agent: 'general', task: 'CHILD_THREE previous={previous}; return STEP_3_FINAL' },
      ];
      send({ tool_calls: [{ index: 0, id: `call-${text}`, type: 'function', function: { name: 'subagent', arguments: JSON.stringify({ chain }) } }] });
      send({}, 'tool_calls'); res.end('data: [DONE]\n\n'); return;
    }
    if (scenario) {
      const tool = body.messages.slice(userIndex + 1).find(m => m.role === 'tool');
      results.push({ scenario: text, content: tool.content });
      send({ content: 'Chain fixture inspected the returned tool result.' });
    } else {
      assert.match(text, /^CHILD_(?:ONE|TWO|THREE)(?:\s|$)/u, 'foreground child has an explicit fixture route');
      children.push(text);
      if (text.includes('HOLD_CHILD')) { heldChild = true; return; }
      const output = text.includes('CHILD_THREE') ? 'STEP_3_FINAL' : text.includes('CHILD_TWO') ? 'STEP_2_SUMMARY' : 'STEP_1_SOURCE';
      await new Promise(resolve => setTimeout(resolve, 250));
      send({ content: output });
    }
    send({}, 'stop'); res.end('data: [DONE]\n\n');
  } catch (error) { errors.push(error.message); if (!res.headersSent) res.writeHead(500); res.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
await writeFile(join(profile, 'preferences.json'), JSON.stringify({ theme: 'dark', language: 'zh', workspaces: [] }));
await writeFile(join(root, 'config.toml'), 'defaultProvider = "chain-fixture"\ndefaultModel = "chain-fixture"\npermissionPreset = "approve-for-me"\n[telemetry]\nenabled = false\n');
await writeFile(join(root, 'models.json'), JSON.stringify({ providers: { 'chain-fixture': {
  baseUrl: `http://127.0.0.1:${server.address().port}/v1`, api: 'openai-completions', apiKey: 'local-fixture',
  models: [{ id: 'chain-fixture', name: 'Local chain fixture', contextWindow: 32768, maxTokens: 2048 }],
} } }));
const env = { ...process.env, DESKTOP_TEST_USER_DATA: profile, DESKTOP_TEST_NO_FOCUS: '1' };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ ...(process.env.DESKTOP_VERIFY_EXE ? { executablePath: process.env.DESKTOP_VERIFY_EXE } : { args: [resolve('.')] }), env, timeout: 60000 });
try {
  const page = await app.firstWindow();
  await app.evaluate(({ BrowserWindow }) => { const win = BrowserWindow.getAllWindows()[0]; win.setOpacity(0); win.setIgnoreMouseEvents(true); win.showInactive(); });
  const snapshot = await prepareSessionFixture(page);
  phase('session ready');
  for (const scenario of ['CHAIN_SUCCESS', 'CHAIN_FAILURE', 'CHAIN_ABORT']) {
    const before = await page.evaluate(async () => (await window.desktop.snapshot()).messages.length);
    phase(`${scenario}: submitting`);
    await page.evaluate(({ runtimeId, scenario }) => window.desktop.command('prompt', { message: scenario }, runtimeId), { runtimeId: snapshot.runtimeId, scenario });
    phase(`${scenario}: acknowledged`);
    if (scenario === 'CHAIN_ABORT') {
      const deadline = Date.now() + 30000;
      while (!heldChild && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 100));
      assert.ok(heldChild, 'second child is running before cancellation');
      await page.evaluate(runtimeId => window.desktop.command('abort', {}, runtimeId), snapshot.runtimeId);
    }
    let current;
    let settled = false;
    const deadline = Date.now() + 90000;
    do {
      current = await page.evaluate(() => window.desktop.snapshot());
      const ended = scenario === 'CHAIN_ABORT'
        ? current.messages.slice(before).some(m => m.role === 'toolResult' && m.toolName === 'subagent')
        : results.some(r => r.scenario === scenario) && current.messages.slice(before).some(m => m.role === 'assistant' && m.stopReason === 'stop');
      if (ended && !current.state.isStreaming) { settled = true; break; }
      await new Promise(resolve => setTimeout(resolve, 100));
    } while (Date.now() < deadline);
    assert.ok(settled, `${scenario}: run and authoritative result settled before deadline`);
    assert.equal(current.sessions.some(session => /^(workflow|subagent)-/.test(session.id)), false,
      'real child sessions never enter the user conversation catalog');
    phase(`${scenario}: settled`);
    const tool = current.messages.slice(before).findLast(m => m.role === 'toolResult' && m.toolName === 'subagent');
    assert.ok(tool, 'real runtime returned subagent records');
    assert.deepEqual(tool.details.results.map(r => r.status), scenario === 'CHAIN_SUCCESS' ? ['completed', 'completed', 'completed'] : ['completed', scenario === 'CHAIN_ABORT' ? 'aborted' : 'failed', 'skipped']);
    if (scenario === 'CHAIN_ABORT') continue;
    const returned = results.find(r => r.scenario === scenario)?.content;
    assert.ok(returned, 'parent model received the tool content');
    assert.match(returned, scenario === 'CHAIN_SUCCESS' ? /STEP_3_FINAL/ : /chain did not complete/i);
    if (scenario === 'CHAIN_FAILURE') {
      assert.match(returned, /missing-chain-fixture-agent/);
      await page.locator('.subagent-status-icon[data-state="skipped"]').first().waitFor({ timeout: 10000 });
      await page.screenshot({ path: 'test-results/chain-runtime-failed-skipped.png' });
    }
  }
  phase(`${backgroundScenario}: submitting`);
  const backgroundBefore = (await page.evaluate(() => window.desktop.snapshot())).messages.length;
  await page.evaluate(({ runtimeId, message }) => window.desktop.command('prompt', { message }, runtimeId),
    { runtimeId: snapshot.runtimeId, message: backgroundScenario });
  let backgroundSnapshot;
  let backgroundDispatch;
  let dispatchSettled = false;
  const dispatchDeadline = Date.now() + 90000;
  do {
    backgroundSnapshot = await page.evaluate(() => window.desktop.snapshot());
    const messages = backgroundSnapshot.messages.slice(backgroundBefore);
    backgroundDispatch = messages.find(m => m.role === 'toolResult' && m.toolName === 'subagent'
      && m.toolCallId === backgroundCallId);
    if (backgroundDispatch && backgroundChildStarted && !backgroundSnapshot.state.isStreaming
      && messages.some(m => m.role === 'assistant' && m.stopReason === 'stop' && textOf(m) === backgroundWaiting)) {
      dispatchSettled = true; break;
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  } while (Date.now() < dispatchDeadline);
  assert.ok(dispatchSettled, 'parent dispatch turn ends while the real background child is still gated');
  assert.notEqual(backgroundDispatch.isError, true, 'background dispatch succeeds');
  assert.equal(backgroundDispatch.details.mode, 'single');
  assert.equal(backgroundDispatch.details.status, 'running', 'dispatch is a live background lane');
  assert.match(backgroundDispatch.details.agentId, /^lane_[0-9a-f]{8}$/u);
  backgroundLaneId = backgroundDispatch.details.agentId;
  assert.equal(backgroundReceipts.length, 0, 'no notification is invented before the child completes');
  assert.equal(backgroundSnapshot.messages.slice(backgroundBefore).some(m => m.role === 'custom'
    && m.customType === 'agent-notification'), false, 'gated child has not produced a custom notification');
  phase(`${backgroundScenario}: releasing child after parent dispatch settled`);
  backgroundChildReleased = true;
  releaseBackgroundChild();
  let notificationSettled = false;
  let backgroundNotification;
  const notificationDeadline = Date.now() + 90000;
  do {
    backgroundSnapshot = await page.evaluate(() => window.desktop.snapshot());
    const messages = backgroundSnapshot.messages.slice(backgroundBefore);
    backgroundNotification = messages.find(m => m.role === 'custom' && m.customType === 'agent-notification'
      && m.details?.agentId === backgroundLaneId && m.details.event === 'background_done');
    if (backgroundNotification && backgroundReceipts.length > 0 && !backgroundSnapshot.state.isStreaming
      && messages.some(m => m.role === 'assistant' && m.stopReason === 'stop' && textOf(m) === backgroundAck)) {
      notificationSettled = true; break;
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  } while (Date.now() < notificationDeadline);
  assert.ok(notificationSettled, 'real background completion wakes the parent, delivers custom content and receives its ack');
  assert.equal(backgroundReceipts.length, 1, 'parent receives exactly one final notification');
  assert.equal(backgroundReceipts[0].role, 'user', 'custom notification follows the actual OpenAI user/text contract');
  assert.equal(backgroundReceipts[0].laneId, backgroundLaneId);
  assertSafeBackgroundText(backgroundReceipts[0].content, 'parent-visible notification');
  assert.equal(backgroundNotification.display, true, 'terminal notification is user-visible');
  assert.equal(backgroundNotification.details.status, 'completed');
  assert.deepEqual(backgroundNotification.details.agents, ['general']);
  assertSafeBackgroundText(textOf(backgroundNotification), 'authoritative custom notification');
  assert.equal(backgroundReceipts[0].content, textOf(backgroundNotification),
    'parent model receives the exact authoritative custom content, not the dispatch tool body');
  assertSafeBackgroundText(backgroundNotification.details.detail, 'authoritative notification detail');
  assertSafeBackgroundText(JSON.stringify(backgroundSnapshot.messages.slice(backgroundBefore)), 'authoritative messages');
  assert.equal(backgroundSnapshot.sessions.some(session => /^(workflow|subagent)-/.test(session.id)), false,
    'real background child never enters the user conversation catalog');
  assert.equal(backgroundSnapshot.state.model.provider, 'chain-fixture');
  assert.equal(backgroundSnapshot.state.model.id, 'chain-fixture');
  // Derive DOM locations from the real authoritative identities, never assumed insertion positions.
  const notificationIndex = backgroundSnapshot.messages.findIndex(m => m.role === 'custom'
    && m.customType === 'agent-notification' && m.details?.agentId === backgroundLaneId
    && m.details.event === 'background_done');
  const notificationText = page.locator(`.response-text[data-message-index="${notificationIndex}"]`);
  await notificationText.waitFor({ timeout: 10000 });
  await page.waitForFunction(({ index, begin, end }) => {
    const text = document.querySelector(`.response-text[data-message-index="${index}"]`)?.textContent ?? '';
    return text.includes(begin) && text.includes(end);
  }, { index: notificationIndex, begin: backgroundBegin, end: backgroundEnd }, { timeout: 10000 });
  assertSafeBackgroundText(await notificationText.innerText(), 'rendered notification');
  const backgroundResponse = page.locator('.message.assistant').filter({ has: notificationText });
  assert.equal(await backgroundResponse.count(), 1, 'notification remains in one real assistant response');
  assertSafeBackgroundText(await backgroundResponse.innerText(), 'rendered response');
  assert.equal((await page.locator('.conversation').textContent()).includes(backgroundSentinel), false,
    'rendered chat contains no synthetic credential');
  await app.evaluate(({ clipboard }) => {
    globalThis.chainClipboard = { original: clipboard.writeText, values: [] };
    clipboard.writeText = async text => { globalThis.chainClipboard.values.push(text); };
  });
  try {
    const copyMessage = async button => {
      const before = await app.evaluate(() => globalThis.chainClipboard.values.length);
      await button.dispatchEvent('click');
      const deadline = Date.now() + 10000;
      let copied;
      do {
        copied = await app.evaluate((_electron, before) => globalThis.chainClipboard.values.slice(before), before);
        if (copied.length) break;
        await new Promise(resolve => setTimeout(resolve, 100));
      } while (Date.now() < deadline);
      assert.equal(copied.length, 1, `copy button writes once through preload/IPC; captured=${copied.map(text => JSON.stringify(text.slice(0, 100))).join(', ')}`);
      return copied[0];
    };
    assertSafeBackgroundText(await copyMessage(backgroundResponse.locator('.assistant-actions')
      .getByRole('button', { name: '复制', exact: true })), 'copied background response');
    phase('notification-looking user prose: submitting negative control');
    const controlBefore = backgroundSnapshot.messages.length;
    await page.evaluate(({ runtimeId, message }) => window.desktop.command('prompt', { message }, runtimeId),
      { runtimeId: snapshot.runtimeId, message: userControl });
    await page.waitForFunction(async ({ before, ack }) => {
      const current = await window.desktop.snapshot();
      return !current.state.isStreaming && current.messages.slice(before).some(m => m.role === 'assistant'
        && m.stopReason === 'stop' && (typeof m.content === 'string' ? m.content
          : m.content.filter(c => c.type === 'text').map(c => c.text).join('\n')) === ack);
    }, { before: controlBefore, ack: userControlAck }, { timeout: 90000 });
    const controlSnapshot = await page.evaluate(() => window.desktop.snapshot());
    const controlIndex = controlSnapshot.messages.findIndex(m => m.role === 'user' && textOf(m) === userControl);
    assert.ok(controlIndex >= controlBefore, 'notification-looking text remains the real user message');
    assert.equal(controlSnapshot.messages.slice(controlBefore).some(m => m.role === 'custom'
      && m.customType === 'agent-notification'), false, 'user text never becomes a typed notification');
    assert.equal(backgroundReceipts.length, 1, 'parent receiver never mistakes user prose for another notification');
    assert.equal(children.filter(text => /^CHILD_BACKGROUND(?:\s|$)/u.test(text)).length, 1,
      'user negative control never dispatches another child');
    assertSafeBackgroundText(JSON.stringify(controlSnapshot.messages.slice(backgroundBefore)), 'authoritative messages after user control');
    const controlUser = page.locator(`.message.user[data-message-index="${controlIndex}"]`);
    await controlUser.getByText('api_key = synthetic-user-notification-control', { exact: false }).waitFor({ timeout: 10000 });
    assert.ok((await controlUser.innerText()).includes('api_key = synthetic-user-notification-control'),
      'notification-looking user text is not blanket-redacted');
    assert.equal(await copyMessage(controlUser.locator('.user-actions').getByRole('button', { name: '复制', exact: true })), userControl,
      'copy preserves the exact ordinary user text instead of applying notification redaction');
  } finally {
    await app.evaluate(({ clipboard }) => { clipboard.writeText = globalThis.chainClipboard.original; });
  }
  phase(`${backgroundScenario}: safe notification, authoritative history, render, copy and user negative control passed`);
  assert.ok(children.some(text => text.includes('CHILD_TWO') && text.includes('STEP_1_SOURCE')));
  assert.ok(children.some(text => text.includes('CHILD_THREE') && text.includes('STEP_2_SUMMARY')));
  assert.deepEqual(errors, []);
  console.log('Real chain runtime passed: foreground previous propagation, final content, failure, cancellation and skipped step; real background custom notification, safe authoritative messages, chat/copy and user-text negative control. Loopback fixture model only; zero external model calls.');
} catch (error) {
  const page = await app.firstWindow().catch(() => undefined);
  const snapshot = await page?.evaluate(() => window.desktop.snapshot()).catch(() => undefined);
  console.error('Chain runtime diagnostic', JSON.stringify({
    heldChild, children, errors, backgroundChildStarted, backgroundChildReleased,
    backgroundReceipts: backgroundReceipts.length,
    results: snapshot?.messages.filter(message => message.toolName === 'subagent').map(message => ({
      isError: message.isError, results: message.details?.results?.map(result => ({
        agent: result.agent, status: result.status, stopReason: result.stopReason, lastEvent: result.lastEvent,
      })),
    })),
    pendingRequests: snapshot?.requests?.map(request => ({ method: request.method, title: request.title })),
  }));
  throw error;
} finally {
  await app.evaluate(({ BrowserWindow }) => { for (const win of BrowserWindow.getAllWindows()) win.destroy(); }).catch(() => {});
  await app.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
}
