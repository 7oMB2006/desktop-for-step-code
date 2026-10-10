import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'node:http';

// Exercise actual workflow RPC children, not injected renderer status records.
const profile = await mkdtemp(join(tmpdir(), 'desktop-workflow-'));
const workspace = join(profile, 'workspace');
await mkdir(workspace, { recursive: true });
await mkdir(join(profile, 'step-runtime'), { recursive: true });
await writeFile(join(profile, 'preferences.json'), JSON.stringify({ language: 'zh', theme: 'dark', workspaces: [workspace] }));
await writeFile(join(profile, 'step-runtime/config.toml'), 'permissionPreset = "bypass"\n[telemetry]\nenabled = false\n');
const text = message => typeof message.content === 'string' ? message.content
  : message.content?.filter(block => block.type === 'text').map(block => block.text ?? '').join('\n') ?? '';
const requests = [];
let providerId;
let releaseChild;
let childHeld = false;
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
    if (task === 'WORKFLOW-PARENT' && !body.messages.slice(userIndex + 1).some(message => message.role === 'tool')) {
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
const app = await electron.launch({ ...(process.env.DESKTOP_VERIFY_EXE
  ? { executablePath: process.env.DESKTOP_VERIFY_EXE } : { args: [resolve('.')] }), env, timeout: 60000 });
let page;
const waitSnapshot = async predicate => {
  const until = Date.now() + 60000;
  while (Date.now() < until) {
    const state = await page.evaluate(() => window.desktop.snapshot());
    if (predicate(state)) return state;
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
    && state.messages.some(message => message.role === 'assistant' && text(message).includes('WORKFLOW-PARENT-DONE')));
  assert.ok(finished.messages.some(message => message.role === 'toolResult' && message.toolCallId === 'workflow-call' && !message.isError));
  assert.equal(requests.filter(request => request.task.startsWith('WORKFLOW-FINAL')).length, 1);
  assert.equal(finished.sessions.some(session => /^(workflow|subagent)-/.test(session.id)), false);
  console.log('Workflow runtime passed: real parallel children, chained result handoff, parent settlement, live and final sidebar filtering. Local HTTP fixture only.');
} catch (error) {
  console.error('Workflow profile:', profile);
  if (page) console.error('Workflow snapshot:', JSON.stringify(await page.evaluate(() => window.desktop.snapshot()).catch(() => null)));
  throw error;
} finally {
  releaseChild?.();
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
