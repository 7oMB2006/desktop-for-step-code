import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';

// Exercise actual workflow RPC children, not injected renderer status records.
const profile = await mkdtemp(join(tmpdir(), 'desktop-workflow-'));
const workspace = join(profile, 'workspace');
await mkdir(workspace, { recursive: true });
await mkdir(join(profile, 'step-runtime'), { recursive: true });
await writeFile(join(profile, 'preferences.json'), JSON.stringify({ language: 'zh', theme: 'dark', workspaces: [workspace] }));
await writeFile(join(profile, 'step-runtime/config.toml'), 'permissionPreset = "approve-for-me"\n[telemetry]\nenabled = false\n');
const text = message => typeof message.content === 'string' ? message.content
  : message.content?.filter(block => block.type === 'text').map(block => block.text ?? '').join('\n') ?? '';
const requests = [];
let providerId;
let releaseChild;
let childHeld = false;
const recoveryCalls = new Map();
let recoveryHeld = false;
let holdRecovery = true;
let releaseRecovery;
const server = createServer(async (req, res) => {
  try {
    assert.equal(req.headers.authorization, 'Bearer workflow-fixture-key');
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw);
    const userIndex = body.messages.findLastIndex(message => message.role === 'user' && text(message).includes('WORKFLOW-'));
    const task = text(body.messages[userIndex] ?? {});
    requests.push({ model: body.model, task });
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    const send = (delta, finish_reason = null) => res.write(`data: ${JSON.stringify({
      id: 'workflow-fixture', object: 'chat.completion.chunk', created: 1, model: body.model,
      choices: [{ index: 0, delta, finish_reason }],
    })}\n\n`);
    send({ role: 'assistant', content: '' });
    if (recoveryCalls.has(task) && !body.messages.slice(userIndex + 1).some(message => message.role === 'tool')) {
      send({ tool_calls: [{ index: 0, id: task, type: 'function',
        function: { name: 'workflow', arguments: JSON.stringify(recoveryCalls.get(task)) } }] });
      send({}, 'tool_calls');
    } else if (recoveryCalls.has(task)) {
      send({ content: `${task}-DONE` }); send({}, 'stop');
    } else if (task === 'WORKFLOW-PARENT' && !body.messages.slice(userIndex + 1).some(message => message.role === 'tool')) {
      assert.ok(body.tools.some(tool => tool.function?.name === 'workflow'));
      const model = `${providerId}/fixture-workflow`;
      const options = JSON.stringify({ model, retries: 1 });
      const script = `const outputs = await parallel([() => agent("WORKFLOW-CHILD-A", ${options}), () => agent("WORKFLOW-CHILD-B", ${options})]); return await agent("WORKFLOW-FINAL " + JSON.stringify(outputs), ${options});`;
      send({ tool_calls: [{ index: 0, id: 'workflow-call', type: 'function',
        function: { name: 'workflow', arguments: JSON.stringify({ script, agentTimeoutMs: 30000 }) } }] });
      send({}, 'tool_calls');
    } else if (task === 'WORKFLOW-PARENT') {
      const result = body.messages.slice(userIndex + 1).find(message => message.role === 'tool');
      assert.match(text(result), /WORKFLOW-CHAIN-DONE/);
      send({ content: 'WORKFLOW-PARENT-DONE' }); send({}, 'stop');
    } else {
      if (task === 'WORKFLOW-RECOVERY-B' && holdRecovery) {
        recoveryHeld = true;
        await new Promise(resolve => { releaseRecovery = resolve; res.on('close', resolve); });
        if (res.destroyed) return;
      }
      if (task === 'WORKFLOW-CHILD-A') {
        childHeld = true;
        await new Promise(resolve => { releaseChild = resolve; });
      }
      if (task.startsWith('WORKFLOW-FINAL')) {
        assert.match(task, /WORKFLOW-CHILD-A-DONE/);
        assert.match(task, /WORKFLOW-CHILD-B-DONE/);
      }
      send({ content: task.startsWith('WORKFLOW-FINAL') ? 'WORKFLOW-CHAIN-DONE' : `${task}-DONE` });
      send({}, 'stop');
    }
    res.end('data: [DONE]\n\n');
  } catch (error) {
    console.error('Workflow fixture failed:', error.message);
    if (!res.headersSent) res.writeHead(500);
    res.end();
  }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const env = { ...process.env, DESKTOP_TEST_USER_DATA: profile, DESKTOP_TEST_NO_FOCUS: '1' };
delete env.ELECTRON_RUN_AS_NODE;
const launch = () => electron.launch({ ...(process.env.DESKTOP_VERIFY_EXE
  ? { executablePath: process.env.DESKTOP_VERIFY_EXE } : { args: [resolve('.')] }), env, timeout: 60000 });
let app = await launch();
let page;
const waitSnapshot = async predicate => {
  const until = Date.now() + 60000;
  while (Date.now() < until) {
    const state = await page.evaluate(() => window.desktop.snapshot());
    if (await predicate(state)) return state;
    await page.waitForTimeout(100);
  }
  throw new Error('Workflow snapshot wait timed out');
};
try {
  page = await app.firstWindow();
  await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    window.setOpacity(0); window.setIgnoreMouseEvents(true); window.showInactive();
  });
  await page.waitForFunction(() => document.querySelector('.composer textarea') && !document.querySelector('.composer textarea').disabled);
  await page.evaluate(async ({ workspace, baseUrl }) => {
    await window.desktop.saveProvider({ id: '', name: 'Workflow fixture', baseUrl, api: 'openai-completions',
      enabled: true, keyless: false, models: [{ id: 'fixture-workflow', name: 'Workflow', reasoning: false, vision: false,
        contextWindow: 128000, maxTokens: 16384 }] }, 'workflow-fixture-key');
    await window.desktop.beginSession(workspace);
  }, { workspace, baseUrl: `http://127.0.0.1:${server.address().port}/v1` });
  providerId = await page.evaluate(async () => (await window.desktop.settings()).providers[0].id);
  const state = await page.evaluate(() => window.desktop.snapshot());
  await page.evaluate(async ({ providerId, runtimeId }) => {
    // Draft model selection is supported before the first real message.
    await window.desktop.command('set_model', { provider: providerId, modelId: 'fixture-workflow' }, runtimeId);
  }, { providerId, runtimeId: state.runtimeId });
  await page.evaluate(draftId => window.desktop.createDraftSession(draftId), state.draftId);
  const prompting = page.evaluate(() => window.desktop.command('prompt', { message: 'WORKFLOW-PARENT' }));
  prompting.catch(() => {});
  await waitSnapshot(state => state.state?.isStreaming);
  const until = Date.now() + 60000;
  while (!childHeld && Date.now() < until) {
    await page.evaluate(async () => {
      const state = await window.desktop.snapshot();
      for (const request of state.requests ?? []) {
        assertRequest(request);
        await window.desktop.command('extension_ui_response', { id: request.id, confirmed: true }, request.runtimeId);
      }
      function assertRequest(request) {
        if (request.method !== 'confirm' || !request.title?.startsWith('Approve workflow'))
          throw new Error('Unexpected fixture approval');
      }
    });
    await page.waitForTimeout(100);
  }
  assert.equal(childHeld, true, 'real workflow child started');
  const children = [];
  const walk = async directory => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (entry.name.endsWith('.jsonl')) {
        const header = JSON.parse((await readFile(path, 'utf8')).split('\n')[0]);
        if (header.id.startsWith('workflow-')) children.push(header.id);
      }
    }
  };
  const persistedUntil = Date.now() + 10000;
  while (!children.length && Date.now() < persistedUntil) {
    await walk(join(profile, 'step-runtime/sessions'));
    if (!children.length) await page.waitForTimeout(100);
  }
  assert.ok(children.length >= 1, 'child transcripts exist on disk');
  const visible = await page.evaluate(() => window.desktop.sessions());
  assert.equal(visible.some(session => /^(workflow|subagent)-/.test(session.id)), false);
  const refused = await page.evaluate(async id => {
    const results = [];
    for (const action of ['navigateSession', 'switchSession']) {
      try { await window.desktop[action](id); results.push(false); } catch { results.push(true); }
    }
    return results;
  }, children[0]);
  assert.deepEqual(refused, [true, true], 'child transcripts cannot be reopened as independent parent runtimes');
  releaseChild();
  await prompting;
  const finished = await waitSnapshot(state => !state.state?.isStreaming
    && state.messages.some(message => message.role === 'assistant' && text(message).includes('WORKFLOW-PARENT-DONE'))
    && state.messages.some(message => message.toolCallId === 'workflow-call' && message.desktopWorkflow?.agents.length === 3));
  assert.ok(finished.messages.some(message => message.role === 'toolResult' && message.toolCallId === 'workflow-call' && !message.isError));
  assert.equal(requests.filter(request => request.task.startsWith('WORKFLOW-FINAL')).length, 1);
  assert.equal(finished.sessions.some(session => /^(workflow|subagent)-/.test(session.id)), false);
  const result = finished.messages.find(message => message.role === 'toolResult' && message.toolCallId === 'workflow-call');
  const saved = result.desktopWorkflow;
  assert.equal(saved.status, 'completed');
  assert.equal(saved.agents.length, 3);
  assert.ok(saved.agents.every(agent => agent.status === 'completed'));
  const sessionId = finished.state.sessionId;
  const requestCount = requests.length;
  await app.evaluate(({ app }) => app.exit(0));
  await app.close();
  app = await launch();
  page = await app.firstWindow();
  await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    window.setOpacity(0); window.setIgnoreMouseEvents(true); window.showInactive();
  });
  await waitSnapshot(state => state.status === 'ready' && state.sessions.some(session => session.id === sessionId));
  await page.evaluate(id => window.desktop.switchSession(id), sessionId);
  const restored = await waitSnapshot(state => state.state?.sessionId === sessionId
    && state.messages.some(message => message.toolCallId === 'workflow-call'));
  const restoredResult = restored.messages.find(message => message.role === 'toolResult' && message.toolCallId === 'workflow-call');
  assert.deepEqual(restoredResult.desktopWorkflow, saved, 'restart hydrates the complete persisted orchestration snapshot');
  assert.equal(restored.state.isStreaming, false);
  assert.equal(restored.launch.ultracode, false, 'workflow execution does not grant standing consent');
  assert.equal(requests.length, requestCount, 'restoring history does not rerun children');
  assert.equal(restored.sessions.some(session => /^(workflow|subagent)-/.test(session.id)), false);
  const options = JSON.stringify({ model: `${providerId}/fixture-workflow`, retries: 1 });
  const script = `await agent("WORKFLOW-RECOVERY-A", ${options}); await agent("WORKFLOW-RECOVERY-B", ${options}); return await agent("WORKFLOW-RECOVERY-C", ${options});`;
  recoveryCalls.set('WORKFLOW-STOP', { script, agentTimeoutMs: 30000 });
  const submitRecovery = async task => {
    await page.evaluate(message => window.desktop.command('prompt', { message }), task);
    return waitSnapshot(async state => {
      for (const request of state.requests ?? []) {
        if (request.method !== 'confirm' || !request.title?.startsWith('Approve workflow')) throw new Error('Unexpected recovery approval');
        await page.evaluate(request => window.desktop.command('extension_ui_response', { id: request.id, confirmed: true }, request.runtimeId), request);
      }
      return !state.state.isStreaming && state.messages.some(message => message.toolCallId === task);
    });
  };
  const pending = submitRecovery('WORKFLOW-STOP');
  pending.catch(() => {});
  const deadline = Date.now() + 30000;
  while (!recoveryHeld && Date.now() < deadline) {
    await page.waitForTimeout(100);
  }
  assert.ok(recoveryHeld, 'second recovery child started before abort');
  const runRoot = join(workspace, '.stepcode/workflows/runs');
  const activeFlows = await Promise.all((await readdir(runRoot)).map(async id => JSON.parse(await readFile(join(runRoot, id, 'progress.json'), 'utf8'))));
  const activeFlow = activeFlows.find(flow => flow.status === 'running');
  assert.ok(activeFlow?.runId, 'persisted progress exposes recovery run identity');
  await page.evaluate(() => window.desktop.command('abort'));
  await pending;
  await waitSnapshot(state => state.messages.find(message => message.toolCallId === 'WORKFLOW-STOP')?.desktopWorkflow?.status === 'aborted');
  const cloned = await page.evaluate(id => window.desktop.cloneSession(id), sessionId);
  assert.equal(cloned.messages.find(message => message.toolCallId === 'WORKFLOW-STOP')?.desktopWorkflow?.status, 'aborted',
    'cloned session restores bound interruption immediately');
  await page.evaluate(id => window.desktop.switchSession(id), sessionId);
  holdRecovery = false;
  releaseRecovery?.();
  const count = task => requests.filter(request => request.task === task).length;
  assert.equal(count('WORKFLOW-RECOVERY-A'), 1);
  assert.equal(count('WORKFLOW-RECOVERY-B'), 1);
  assert.equal(count('WORKFLOW-RECOVERY-C'), 0);
  recoveryCalls.set('WORKFLOW-RESUME', { script, resumeFromRunId: activeFlow.runId, agentTimeoutMs: 30000 });
  const resumed = await submitRecovery('WORKFLOW-RESUME');
  const resumedFlow = resumed.messages.find(message => message.toolCallId === 'WORKFLOW-RESUME').desktopWorkflow;
  assert.equal(resumedFlow.status, 'completed');
  await waitSnapshot(state => state.messages.find(message => message.toolCallId === 'WORKFLOW-RESUME')?.desktopWorkflow?.agents[0]?.status === 'cached');
  assert.equal(count('WORKFLOW-RECOVERY-A'), 1, 'completed prefix is cached');
  assert.equal(count('WORKFLOW-RECOVERY-B'), 2, 'aborted task reruns');
  assert.equal(count('WORKFLOW-RECOVERY-C'), 1);
  const changedScript = script.replace('WORKFLOW-RECOVERY-B', 'WORKFLOW-RECOVERY-B-CHANGED');
  recoveryCalls.set('WORKFLOW-CHANGED', { script: changedScript, resumeFromRunId: resumedFlow.runId, agentTimeoutMs: 30000 });
  const changed = await submitRecovery('WORKFLOW-CHANGED');
  assert.equal(changed.messages.find(message => message.toolCallId === 'WORKFLOW-CHANGED').desktopWorkflow.status, 'completed');
  assert.equal(count('WORKFLOW-RECOVERY-A'), 1);
  assert.equal(count('WORKFLOW-RECOVERY-B-CHANGED'), 1);
  assert.equal(count('WORKFLOW-RECOVERY-C'), 2, 'steps after the changed call rerun');
  recoveryHeld = false; holdRecovery = true;
  recoveryCalls.set('WORKFLOW-CRASH', { script, agentTimeoutMs: 30000 });
  const crashing = submitRecovery('WORKFLOW-CRASH');
  crashing.catch(() => {});
  const crashDeadline = Date.now() + 30000;
  while (!recoveryHeld && Date.now() < crashDeadline) await page.waitForTimeout(100);
  assert.ok(recoveryHeld);
  const crashRuns = await Promise.all((await readdir(runRoot)).map(async id => JSON.parse(await readFile(join(runRoot, id, 'progress.json'), 'utf8'))));
  const crashedRun = crashRuns.find(flow => flow.status === 'running');
  assert.ok(crashedRun?.runId);
  execFileSync('taskkill.exe', ['/PID', String(app.process().pid), '/T', '/F'], { windowsHide: true });
  await crashing.catch(() => {});
  holdRecovery = false; releaseRecovery?.();
  app = await launch(); page = await app.firstWindow();
  await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    window.setOpacity(0); window.setIgnoreMouseEvents(true); window.showInactive();
  });
  await waitSnapshot(state => state.status === 'ready' && state.sessions.some(session => session.id === sessionId));
  await page.evaluate(id => window.desktop.switchSession(id), sessionId);
  const afterCrash = await waitSnapshot(state => state.state?.sessionId === sessionId && !state.state.isStreaming);
  const crashResult = afterCrash.messages.find(message => message.toolCallId === 'WORKFLOW-CRASH');
  assert.equal(crashResult, undefined, 'abrupt termination did not persist a final tool result');
  await page.reload();
  const orphan = page.locator('.workflow-inline').last();
  await orphan.locator('.subagent-status-icon[data-state="pending"]').waitFor();
  assert.equal(await orphan.locator('.subagent-status-icon[data-state="running"]').count(), 0);
  await orphan.locator('.workflow-heading').click();
  await page.locator('#subagent-panel .workflow-overview .subagent-status-icon[data-state="pending"]').waitFor();
  await page.screenshot({ path: 'test-results/workflow-crash-restored-unknown.png' });
  recoveryCalls.set('WORKFLOW-CRASH-RESUME', { script, resumeFromRunId: crashedRun.runId, agentTimeoutMs: 30000 });
  const aBefore = count('WORKFLOW-RECOVERY-A');
  const bBefore = count('WORKFLOW-RECOVERY-B');
  const cBefore = count('WORKFLOW-RECOVERY-C');
  const crashResumed = await submitRecovery('WORKFLOW-CRASH-RESUME');
  assert.equal(crashResumed.messages.find(message => message.toolCallId === 'WORKFLOW-CRASH-RESUME').desktopWorkflow.status, 'completed');
  assert.equal(count('WORKFLOW-RECOVERY-A'), aBefore, 'crash recovery reuses the committed journal prefix');
  assert.equal(count('WORKFLOW-RECOVERY-B'), bBefore + 1);
  assert.equal(count('WORKFLOW-RECOVERY-C'), cBefore + 1);
  assert.equal(crashResumed.sessions.some(session => /^(workflow|subagent)-/.test(session.id)), false);
  console.log('Workflow runtime passed: parallel/chain execution, history restart, stop/resume cache reuse, changed-prefix invalidation, forced-crash unknown state and explicit resume. Local HTTP fixture only.');
} catch (error) {
  console.error('Workflow profile:', profile);
  if (page) console.error('Workflow snapshot:', JSON.stringify(await page.evaluate(() => window.desktop.snapshot()).catch(() => null)));
  throw error;
} finally {
  releaseChild?.();
  releaseRecovery?.();
  server.closeAllConnections();
  if (page) await page.evaluate(async () => {
    const state = await window.desktop.snapshot();
    for (const request of state.requests ?? [])
      await window.desktop.command('extension_ui_response', { id: request.id, cancelled: true }, request.runtimeId);
    if (state.state?.isStreaming) await window.desktop.command('abort', {}, state.runtimeId);
  }).catch(() => {});
  // This app and its profile belong solely to the fixture; never touch a live user process.
  await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
  await app.close();
  await new Promise(resolve => server.close(resolve));
}
