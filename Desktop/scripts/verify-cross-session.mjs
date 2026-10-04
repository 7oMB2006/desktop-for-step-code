import { _electron as electron } from 'playwright';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';

const chunk = (delta, finish_reason = null) => `data: ${JSON.stringify({
  id: 'peer-fixture', object: 'chat.completion.chunk', created: 1, model: 'fixture',
  choices: [{ index: 0, delta, finish_reason }],
})}\n\n`;
const textOf = content => typeof content === 'string' ? content : content?.filter(block => block.type === 'text').map(block => block.text).join('\n') ?? '';
const replies = [];
const calls = [];
let targetId;
let targetReference;
let running;
let peerDeliveries = 0;
const server = createServer(async (req, res) => {
  let body = '';
  for await (const part of req) body += part;
  const payload = JSON.parse(body);
  const user = textOf(payload.messages.filter(message => message.role === 'user').at(-1)?.content);
  const label = user.startsWith('Peer-session reference') ? undefined : /PROBE-[A-Z-]+/.exec(user)?.[0];
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  const complete = text => res.end(chunk({ role: 'assistant', content: text }) + chunk({}, 'stop') + 'data: [DONE]\n\n');
  if (payload.messages.at(-1)?.role === 'tool') {
    replies.push({ label, text: textOf(payload.messages.at(-1).content) });
    complete(`${label} COMPLETE`);
  } else if (label) {
    const name = label === 'PROBE-LIST' ? 'desktop_sessions' : label === 'PROBE-READ' ? 'desktop_read_session' : 'desktop_send_message';
    assert.ok(payload.tools.some(tool => tool.function.name === name), `Runtime must register ${name}`);
    const args = name === 'desktop_sessions' ? {} : name === 'desktop_read_session' ? { sessionId: targetReference, limit: 4 }
      : { sessionId: targetReference, message: `HELLO-PEER ${label}` };
    calls.push(name);
    res.end(chunk({ tool_calls: [{ index: 0, id: `call-${replies.length}`, type: 'function', function: { name, arguments: JSON.stringify(args) } }] })
      + chunk({}, 'tool_calls') + 'data: [DONE]\n\n');
  } else if (user === 'KEEP-BUSY') {
    res.write(chunk({ role: 'assistant', content: 'Target is working.' }));
    const timer = setInterval(() => res.write(chunk({ content: ' Still working.' })), 250);
    running = { res, timer };
    res.on('close', () => clearInterval(timer));
  } else if (user.startsWith('Peer-session reference')) {
    peerDeliveries++;
    assert.ok(user.includes('not the peer'));
    assert.ok(user.includes('sourceSessionId'));
    complete(`Peer receipt ${peerDeliveries}`);
  } else complete('Target seed response.');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const profile = await mkdtemp(join(tmpdir(), 'desktop-cross-session-'));
const root = join(profile, 'step-runtime');
await mkdir(join(root, 'sessions'), { recursive: true });
await writeFile(join(profile, 'preferences.json'), JSON.stringify({ language: 'zh', theme: 'light', workspaces: [] }));
await writeFile(join(root, 'config.toml'), 'defaultProvider = "fixture"\ndefaultModel = "fixture"\npermissionPreset = "ask"\n[telemetry]\nenabled = false\n');
await writeFile(join(root, 'models.json'), JSON.stringify({
  providers: { fixture: { baseUrl: `http://127.0.0.1:${server.address().port}/v1`, api: 'openai-completions', apiKey: 'local-test-only',
    models: [{ id: 'fixture', name: 'Peer fixture', contextWindow: 32768, maxTokens: 2048 }] } },
}));
const env = { ...process.env, DESKTOP_TEST_USER_DATA: profile, DESKTOP_TEST_NO_FOCUS: '1' };
delete env.ELECTRON_RUN_AS_NODE;
const executablePath = process.env.DESKTOP_VERIFY_EXE;
const app = await electron.launch({ ...(executablePath ? { executablePath } : { args: [resolve('.')] }), env, timeout: 60000 });
const errors = [];
try {
  const page = await app.firstWindow();
  page.on('pageerror', error => errors.push(error.message));
  await page.getByText('Step Code 已连接', { exact: true }).waitFor({ timeout: 60000 });
  await page.evaluate(() => { HTMLMediaElement.prototype.play = () => Promise.resolve(); });
  const input = page.locator('.composer > textarea');
  const send = async text => { await input.fill(text); await input.press('Enter'); };
  const changeLanguage = async (from, to) => {
    await page.locator('.sidebar-bottom > button').click();
    const settings = page.getByRole('dialog', { name: from === 'zh' ? '设置' : 'Settings', exact: true });
    await settings.getByRole('button', { name: from === 'zh' ? '通用' : 'General', exact: true }).click();
    await settings.getByLabel(/语言|Language/).selectOption(to);
    await page.getByRole('dialog', { name: to === 'zh' ? '设置' : 'Settings', exact: true }).getByRole('button', { name: 'Close', exact: true }).click();
  };
  await send('TARGET-SEED');
  await page.getByText('Target seed response.', { exact: true }).waitFor();
  await page.waitForFunction(async () => !(await window.desktop.snapshot()).state.isStreaming);
  const target = await page.evaluate(() => window.desktop.snapshot());
  targetId = target.state.sessionId;
  await page.getByRole('button', { name: '新建会话', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('.composer > textarea').disabled);
  const source = await page.evaluate(() => window.desktop.snapshot());
  await send('PROBE-LIST');
  await page.getByText('PROBE-LIST COMPLETE', { exact: true }).waitFor();
  assert.ok(replies.find(reply => reply.label === 'PROBE-LIST').text.includes(targetId));
  await app.evaluate(({ clipboard }) => {
    globalThis.sessionCopyTest = { original: clipboard.writeText, values: [] };
    clipboard.writeText = async text => { globalThis.sessionCopyTest.values.push(text); };
  });
  try {
    const beforeCopy = await page.evaluate(() => window.desktop.snapshot());
    await page.locator('.session-row').filter({ hasText: 'TARGET-SEED' }).click({ button: 'right' });
    await page.getByRole('menuitem', { name: '复制会话引用', exact: true }).waitFor();
    await mkdir('test-results', { recursive: true });
    await page.screenshot({ path: 'test-results/session-reference-menu.png' });
    await page.getByRole('menuitem', { name: '复制会话引用', exact: true }).click();
    await page.getByText('已复制会话引用', { exact: true }).waitFor();
    const copied = await app.evaluate(() => globalThis.sessionCopyTest.values);
    assert.deepEqual(copied, [`stepcode-desktop://sessions/${targetId}`]);
    targetReference = copied[0];
    const afterCopy = await page.evaluate(() => window.desktop.snapshot());
    assert.equal(afterCopy.state.sessionId, beforeCopy.state.sessionId);
    assert.deepEqual(afterCopy.unreadSessionIds, beforeCopy.unreadSessionIds);
    assert.equal(await page.getByRole('menu').count(), 0);
  } finally {
    await app.evaluate(({ clipboard }) => { clipboard.writeText = globalThis.sessionCopyTest.original; });
  }
  await send('PROBE-READ');
  await page.getByText('PROBE-READ COMPLETE', { exact: true }).waitFor();
  assert.ok(replies.find(reply => reply.label === 'PROBE-READ').text.includes('Target seed response.'));
  assert.equal((await page.evaluate(() => window.desktop.snapshot())).state.sessionId, source.state.sessionId);
  await mkdir('test-results', { recursive: true });
  await page.screenshot({ path: 'test-results/cross-session-read.png' });

  await send('PROBE-SEND-CANCEL');
  let approval = page.getByRole('dialog', { name: '向另一会话发送消息？' });
  await approval.waitFor();
  assert.ok((await approval.innerText()).includes('HELLO-PEER PROBE-SEND-CANCEL'));
  await approval.getByRole('button', { name: '取消', exact: true }).click();
  await page.getByText('PROBE-SEND-CANCEL COMPLETE', { exact: true }).waitFor();
  assert.equal(peerDeliveries, 0);
  assert.ok(replies.find(reply => reply.label === 'PROBE-SEND-CANCEL').text.includes('"delivered":false'));

  await send('PROBE-SEND-IDLE');
  await approval.waitFor();
  await page.screenshot({ path: 'test-results/cross-session-approval.png' });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(700, 700));
  const bounds = await approval.boundingBox();
  const viewport = page.viewportSize() ?? await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
  assert.ok(bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= viewport.width && bounds.y + bounds.height <= viewport.height);
  await page.screenshot({ path: 'test-results/cross-session-narrow.png' });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1320, 880));
  // The source's request is background-only after switching to the peer.
  await approval.getByRole('button', { name: '稍后处理', exact: true }).click();
  await page.locator('.session-row').filter({ hasText: 'TARGET-SEED' }).locator('button').first().click();
  await page.waitForFunction(() => document.querySelector('.window-session-title')?.textContent === 'TARGET-SEED');
  assert.equal(await page.getByRole('dialog').count(), 0);
  await page.locator('.session-row').filter({ hasText: 'PROBE-LIST' }).locator('button').first().click();
  await approval.waitFor();
  await approval.getByRole('button', { name: '稍后处理', exact: true }).click();
  await page.getByText('此会话有待确认的操作', { exact: true }).waitFor();
  for (const width of [1320, 700, 1600]) {
    await app.evaluate(({ BrowserWindow }, width) => BrowserWindow.getAllWindows()[0].setSize(width, 880), width);
    const review = page.getByRole('button', { name: '查看', exact: true });
    await review.waitFor();
    await page.locator('main > .conversation-scroll-track:not(.hidden)').waitFor();
    await review.click({ trial: true });
    assert.ok(await review.evaluate(button => {
      const bounds = button.getBoundingClientRect();
      return [.15, .5, .85].every(fraction => {
        const target = document.elementFromPoint(bounds.x + bounds.width * fraction, bounds.y + bounds.height / 2);
        return target && button.contains(target);
      });
    }), `Approval review must receive pointer input above the scroll handle at ${width}px`);
    await review.click();
    await approval.waitFor();
    if (width !== 1600) await approval.getByRole('button', { name: '稍后处理', exact: true }).click();
  }
  await page.screenshot({ path: 'test-results/cross-session-review-scroll-guard.png' });
  await approval.getByRole('button', { name: '确认', exact: true }).click();
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1320, 880));
  await page.getByText('PROBE-SEND-IDLE COMPLETE', { exact: true }).waitFor();
  assert.ok(replies.find(reply => reply.label === 'PROBE-SEND-IDLE').text.includes('"delivered":true'));
  await page.waitForFunction(async id => {
    const snapshot = await window.desktop.snapshot();
    return snapshot.runtimes.find(runtime => runtime.sessionId === id)?.status === 'completed';
  }, targetId);
  assert.equal(peerDeliveries, 1);

  await page.evaluate(async ({ runtimeId }) => window.desktop.command('prompt', { message: 'KEEP-BUSY' }, runtimeId), { runtimeId: target.runtimeId });
  await page.waitForFunction(async id => (await window.desktop.snapshot()).runtimes.find(runtime => runtime.sessionId === id)?.status === 'running', targetId);
  await send('PROBE-SEND-QUEUED');
  await approval.waitFor();
  await approval.getByRole('button', { name: '确认', exact: true }).click();
  await page.getByText('PROBE-SEND-QUEUED COMPLETE', { exact: true }).waitFor();
  assert.ok(replies.find(reply => reply.label === 'PROBE-SEND-QUEUED').text.includes('"delivery":"queued"'));
  assert.equal(peerDeliveries, 1);
  clearInterval(running.timer);
  running.res.end(chunk({}, 'stop') + 'data: [DONE]\n\n');
  const deliveryDeadline = Date.now() + 15000;
  while (peerDeliveries !== 2 && Date.now() < deliveryDeadline) await page.waitForTimeout(50);
  assert.equal(peerDeliveries, 2);
  await page.waitForFunction(async () => (await window.desktop.snapshot()).runtimes.every(runtime => runtime.status !== 'running'));
  assert.equal(peerDeliveries, 2);
  const unreadBefore = (await page.evaluate(() => window.desktop.snapshot())).unreadSessionIds;
  assert.ok(unreadBefore.includes(targetId));
  await send('PROBE-READ');
  await page.getByText('PROBE-READ COMPLETE', { exact: true }).nth(1).waitFor();
  assert.ok((await page.evaluate(() => window.desktop.snapshot())).unreadSessionIds.includes(targetId));
  assert.ok(replies.at(-1).text.includes('Peer receipt 2'));

  await page.waitForFunction(async () => !(await window.desktop.snapshot()).state.isStreaming);
  await page.evaluate(id => window.desktop.command('set_permission_preset', { preset: 'read-only' }, id), source.runtimeId);
  await send('PROBE-SEND-READONLY');
  await page.getByText('PROBE-SEND-READONLY COMPLETE', { exact: true }).waitFor();
  assert.ok(replies.at(-1).text.includes('read-only'));
  assert.equal(peerDeliveries, 2);
  assert.equal(await page.getByRole('dialog').count(), 0);
  await page.waitForFunction(async () => !(await window.desktop.snapshot()).state.isStreaming);
  await page.evaluate(id => window.desktop.command('set_permission_preset', { preset: 'ask' }, id), source.runtimeId);
  await changeLanguage('zh', 'en');
  await page.locator('.session-row').filter({ hasText: 'TARGET-SEED' }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Copy session reference', exact: true }).waitFor();
  await page.keyboard.press('Escape');
  await send('PROBE-SEND-ENGLISH');
  const englishApproval = page.getByRole('dialog', { name: 'Send a message to another session?' });
  await englishApproval.waitFor();
  assert.ok((await englishApproval.innerText()).includes('Target: TARGET-SEED'));
  await page.screenshot({ path: 'test-results/cross-session-english.png' });
  await englishApproval.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByText('PROBE-SEND-ENGLISH COMPLETE', { exact: true }).waitFor();
  assert.equal(peerDeliveries, 2);
  await changeLanguage('en', 'zh');
  await send('PROBE-SEND-ABORT');
  await approval.waitFor();
  await page.evaluate(id => window.desktop.command('abort', {}, id), source.runtimeId);
  await page.waitForFunction(async () => (await window.desktop.snapshot()).requests.length === 0);
  assert.equal(peerDeliveries, 2);
  assert.equal((await page.evaluate(() => window.desktop.snapshot())).state.sessionId, source.state.sessionId);
  assert.deepEqual(errors, []);
  assert.ok(calls.includes('desktop_sessions') && calls.includes('desktop_read_session') && calls.includes('desktop_send_message'));
  console.log('Cross-session real RPC/SSE passed: sidebar reference copy without navigation/read-marking, Chinese/English menus, reference-based read/send, registered tools, source-scoped deferred approval, cancel, idle delivery, busy queue, read-only rejection, peer provenance, abort cleanup, narrow layout and English confirmation.');
} catch (error) {
  const page = app.windows()[0];
  if (page) {
    console.log('Cross-session fixture transcript:', JSON.stringify((await page.evaluate(() => window.desktop.snapshot())).messages.slice(-6)));
    console.log('Cross-session fixture provider replies:', JSON.stringify(replies));
    await mkdir('test-results', { recursive: true });
    await page.screenshot({ path: 'test-results/cross-session-failure.png' });
  }
  throw error;
} finally {
  if (running) { clearInterval(running.timer); running.res.destroy(); }
  await app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false }); }).catch(() => {});
  await app.close();
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}
