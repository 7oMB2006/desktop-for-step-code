import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { createConnection } from 'node:net';
import { mkdir, readFile, realpath, stat, writeFile } from 'node:fs/promises';
import { mkdtemp } from './test-profile.mjs';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { _electron as electron } from 'playwright';
import { closeDesktopFixtureAndWait } from './close-desktop-fixture.mjs';

const execute = promisify(execFile);
const output = resolve(process.env.DESKTOP_VERIFY_OUTPUT || 'test-results/external-connectors-electron');
const companion = resolve(process.env.DESKTOP_HERMES_COMPANION || 'D:/Dev/hermes-engineering-bridge/companion/external.py');
await mkdir(output, { recursive: true });
const profile = await realpath(await mkdtemp(join(output, 'profile-')));
const root = join(profile, 'step-runtime'), workspace = join(profile, 'project');
await mkdir(join(root, 'sessions'), { recursive: true });
await mkdir(workspace);
await writeFile(join(profile, 'preferences.json'), JSON.stringify({
  language: 'zh', theme: 'light', workspace, workspaces: [workspace],
}));
await writeFile(join(root, 'config.toml'),
  'defaultProvider = "fixture"\ndefaultModel = "fixture"\npermissionPreset = "ask"\n[telemetry]\nenabled = false\n');
const requests = [], errors = [], checks = [];
const held = new Set();
const content = message => typeof message?.content === 'string' ? message.content
  : message?.content?.filter(block => block.type === 'text').map(block => block.text).join('\n') ?? '';
const model = createServer(async (request, response) => {
  try {
    let raw = '';
    for await (const chunk of request) { raw += chunk; assert.ok(raw.length < 8 * 1024 * 1024); }
    const body = JSON.parse(raw);
    const input = content(body.messages.findLast(message => message.role === 'user'
      && !content(message).startsWith('<collaboration_mode>')
      && !content(message).includes('This is runtime state, not an additional user message.')));
    requests.push(input);
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    const send = (delta, finish_reason = null) => response.write(`data: ${JSON.stringify({
      id: 'connector-fixture', object: 'chat.completion.chunk', created: 1, model: body.model,
      choices: [{ index: 0, delta, finish_reason }],
    })}\n\n`);
    send({ role: 'assistant', content: '' });
    if (input === 'LOCAL-HOLD' || input === 'CONNECTOR-HOLD') {
      held.add(response); response.on('close', () => held.delete(response)); return;
    }
    const delegated = /^CONNECTOR-DELEGATE-(ALLOW|DENY|ESCALATE|REVOKE)$/.test(input);
    const automatic = input === 'CONNECTOR-AUTO', risky = input === 'CONNECTOR-RISK', question = input === 'CONNECTOR-QUESTION';
    const asksApproval = delegated || automatic || risky || question || input === 'CONNECTOR-APPROVAL' || input === 'CONNECTOR-DENY';
    const callId = delegated || automatic || risky || question ? `${input.toLowerCase()}-12345678`
      : input === 'CONNECTOR-DENY' ? 'connector-deny-12345678' : 'connector-tool-12345678';
    const toolResult = body.messages.find(message => message.role === 'tool' && message.tool_call_id === callId);
    if (asksApproval && !toolResult) {
      const command = input === 'CONNECTOR-DENY'
        ? 'echo connector-denied > connector-denied.txt' : 'echo connector-approved';
      send({ tool_calls: [{ index: 0, id: callId, type: 'function',
        function: { name: question ? 'clarify_user' : delegated || automatic ? 'write_file' : 'run_command',
          arguments: JSON.stringify(question ? { questions: [{ id: 'target', label: 'Target', question: 'Which target?',
            allow_freeform: false, options: [{ label: 'Tests', value: 'tests' }, { label: 'Docs', value: 'docs' }] }] }
            : risky ? { command: 'rm -rf ./connector-risk-empty', timeout_ms: 10000 }
              : delegated || automatic ? { path: `${input.toLowerCase()}.txt`, content: input } : { command }) } }] }, 'tool_calls');
    } else if (risky || question || automatic) {
      if (risky) assert.match(content(toolResult), /Tool call denied/u);
      if (question) assert.match(content(toolResult), /tests/u);
      send({ content: `${input}-COMPLETE` }, 'stop');
    } else if (delegated) {
      const denied = input.endsWith('-DENY') || input.endsWith('-REVOKE');
      if (denied) assert.match(content(toolResult), /Tool call denied: write_file/u);
      else assert.ok(!/Tool call denied/u.test(content(toolResult)));
      send({ content: denied ? 'DELEGATED-DENIED' : 'DELEGATED-ALLOWED' }, 'stop');
    } else if (input === 'CONNECTOR-DENY') {
      assert.match(content(toolResult), /Tool call denied: run_command/u);
      send({ content: 'CONNECTOR-DENIED-NOT-EXECUTED' }, 'stop');
    } else send({ content: input === 'LOCAL-PRIVATE' ? 'PRIVATE-LOCAL-REPLY' : 'CONNECTOR-FIXTURE-ANSWER' }, 'stop');
    response.end('data: [DONE]\n\n');
  } catch (error) { errors.push(error.message); response.destroy(); }
});
await new Promise(resolve => model.listen(0, '127.0.0.1', resolve));
await writeFile(join(root, 'models.json'), JSON.stringify({ providers: { fixture: {
  api: 'openai-completions', baseUrl: `http://127.0.0.1:${model.address().port}/v1`, apiKey: 'isolated-connector-fixture',
  models: [{ id: 'fixture', name: 'Local connector fixture', contextWindow: 100000, maxTokens: 2048 }],
} } }));
const env = { ...process.env, DESKTOP_TEST_USER_DATA: profile, DESKTOP_TEST_NO_FOCUS: '1' };
for (const key of ['ELECTRON_RUN_AS_NODE', 'DESKTOP_DEV_URL', 'STEP_API_KEY']) delete env[key];
let app, child, page, descriptor, config, shutdown, passed = false;
const pause = () => new Promise(resolve => setTimeout(resolve, 60));
const until = async (read, predicate, label, timeout = 45000) => {
  const deadline = Date.now() + timeout;
  let value;
  do {
    value = await read();
    if (predicate(value)) return value;
    await pause();
  } while (Date.now() < deadline);
  throw new Error(`Timed out: ${label}; state=${JSON.stringify(value)}`);
};
const client = async (method, params = {}, reject = false) => {
  const args = ['-X', 'utf8', '-B', companion, '--config', config, method, '--params', JSON.stringify(params)];
  try {
    const result = await execute(process.env.PYTHON || 'python', args, { timeout: 45000, windowsHide: true, maxBuffer: 256 * 1024 });
    assert.equal(reject, false, `Expected ${method} to be rejected`);
    assert.equal(result.stderr, '');
    return JSON.parse(result.stdout);
  } catch (error) {
    if (!reject) throw error;
    assert.ok(error.code !== undefined);
    const parsed = JSON.parse(error.stderr);
    assert.ok(parsed.error?.code);
    return parsed;
  }
};
const rpc = async (method, params = {}) => new Promise((accept, reject) => {
  const socket = createConnection({ host: descriptor.host, port: descriptor.port });
  let data = '';
  socket.setTimeout(10000, () => socket.destroy(new Error('RPC deadline')));
  socket.on('error', reject);
  socket.on('connect', () => socket.write(JSON.stringify({
    version: 1, protocol: 'dfsc-external-v1', token: descriptor.token, method, params,
  }) + '\n'));
  socket.on('data', chunk => { data += chunk; });
  socket.on('end', () => { try { accept(JSON.parse(data)); } catch (error) { reject(error); } });
});
const launch = async () => {
  app = await electron.launch({ args: [resolve('.')], env, timeout: 60000 });
  child = app.process();
  page = await app.firstWindow();
  page.on('pageerror', error => errors.push(error.message));
  await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    window.setOpacity(0); window.setIgnoreMouseEvents(true); window.showInactive(); window.setSize(1360, 900);
  });
  await page.waitForFunction(() => document.querySelector('.new-chat')?.disabled === false, undefined, { timeout: 60000 });
  await page.evaluate(() => {
    window.connectorRequests = [];
    window.desktop.onEvent(event => {
      if (event.type === 'extension_ui_request') window.connectorRequests.push(event);
    });
  });
};
const close = async () => {
  const windows = app.windows();
  await closeDesktopFixtureAndWait(app, 45000);
  shutdown = { exitCode: child.exitCode, windows: windows.filter(view => !view.isClosed()).length };
  assert.equal(shutdown.exitCode, 0);
  assert.equal(shutdown.windows, 0);
};
const connectorState = () => page.evaluate(() => window.desktop.externalConnectorState());
const snapshot = () => page.evaluate(() => window.desktop.snapshot());
const action = value => page.evaluate(value => window.desktop.externalConnectorAction(value), value);
const create = key => client('task.create', { key, title: key, cwd: workspace });
const task = id => client('task.get', { taskId: id });
const submit = (id, key, message) => client('run.submit', { taskId: id, key, message });
const openPanel = async () => {
  await page.getByRole('button', { name: '远程访问', exact: true }).click();
  await page.getByRole('button', { name: /外部 Agent.*管理连接/ }).click();
  await page.getByRole('heading', { name: '本机外部委托', exact: true }).waitFor();
};
try {
  await launch();
  assert.equal((await connectorState()).enabled, false);
  const initial = await snapshot();
  await page.locator('.composer > .composer-input').fill('LOCAL-UNSENT-DRAFT');
  await openPanel();
  const panel = page.getByRole('region', { name: '外部 Agent', exact: true });
  await panel.getByRole('switch').click();
  await until(connectorState, value => value.listening, 'enabled listener');
  await panel.getByRole('textbox', { name: '连接名称' }).fill('Hermes 验收');
  await panel.getByRole('checkbox').check();
  await panel.getByRole('button', { name: '添加连接', exact: true }).click();
  await panel.getByRole('button', { name: '确认授权', exact: true }).click();
  const paired = await until(connectorState, value => value.connections.length === 1, 'local pairing');
  const connection = paired.connections[0];
  config = connection.configPath;
  descriptor = JSON.parse(await readFile(join(profile, 'external-connectors', 'agents', connection.agentId, 'model.json'), 'utf8'));
  assert.ok(!JSON.stringify(paired).includes(descriptor.token));
  await panel.getByRole('button', { name: '复制 Hermes 验收 配置路径', exact: true }).click();
  assert.equal(await app.evaluate(({ clipboard }) => clipboard.readText()), config);
  await page.screenshot({ path: join(output, 'paired-light.png') });
  checks.push('default off; real main/preload UI pairing, project scope and non-secret config export');

  const capabilities = await client('system.capabilities');
  assert.equal(capabilities.protocol, 'dfsc-external-v1');
  assert.equal(capabilities.agentId, connection.agentId);
  const nativeCapabilities = await rpc('system.capabilities');
  assert.equal(nativeCapabilities.ok, true);
  assert.equal(nativeCapabilities.result.approvals, 'local-with-explicit-task-delegation');
  assert.equal(nativeCapabilities.result.methods.includes('approval.respond'), true);
  const first = await create('connector-first');
  assert.ok(first.runtimeId && first.sessionId);
  assert.equal((await snapshot()).draftId, initial.draftId);
  await page.getByRole('button', { name: '返回接入渠道', exact: true }).click();
  await page.getByRole('button', { name: '返回会话', exact: true }).click();
  assert.equal(await page.locator('.composer > .composer-input').innerText(), 'LOCAL-UNSENT-DRAFT');
  await submit(first.id, 'run-first', 'CONNECTOR-ANSWER');
  const completed = await until(() => task(first.id), value => value.phase === 'completed', 'native completion');
  assert.equal(completed.summary, 'CONNECTOR-FIXTURE-ANSWER');
  await submit(first.id, 'run-first', 'CONNECTOR-ANSWER');
  assert.equal(requests.filter(value => value === 'CONNECTOR-ANSWER').length, 1);
  assert.equal((await client('run.submit', { taskId: first.id, key: 'run-first', message: 'DIFFERENT' }, true)).error.code, 'connector:key-conflict');
  checks.push('real Python adapter creates an independent native Ask session and submits once through queue');

  await page.evaluate(async ({ runtimeId }) => {
    await window.desktop.command('prompt', { message: 'LOCAL-PRIVATE' }, runtimeId);
  }, first);
  assert.equal((await task(first.id)).summary, completed.summary);
  await page.evaluate(({ runtimeId }) => {
    window.localConnectorHold = window.desktop.command('prompt', { message: 'LOCAL-HOLD' }, runtimeId).catch(() => {});
  }, first);
  await until(async () => requests, value => value.includes('LOCAL-HOLD'), 'later local task');
  assert.equal((await client('task.stop', { taskId: first.id })).phase, 'completed');
  assert.ok((await snapshot()).runtimes.some(value => value.runtimeId === first.runtimeId && value.status === 'running'));
  await page.evaluate(async ({ runtimeId }) => {
    await window.desktop.command('abort', {}, runtimeId); await window.localConnectorHold;
  }, first);
  checks.push('frozen summary excludes later local conversation; old task.stop cannot stop a later local turn');

  const approval = await create('connector-approval');
  await submit(approval.id, 'approval-run', 'CONNECTOR-APPROVAL');
  await until(() => task(approval.id), value => value.awaitingLocalApproval, 'native local approval');
  const refused = await rpc('approval.respond', { taskId: approval.id, confirmed: true });
  assert.equal(refused.ok, false);
  assert.equal((await task(approval.id)).awaitingLocalApproval, true);
  await assert.rejects(page.evaluate(({ runtimeId }) =>
    window.desktop.command('set_permission_preset', { preset: 'full-access' }, runtimeId), approval), /此会话正在处理外部委托/);
  await assert.rejects(page.evaluate(({ runtimeId }) =>
    window.desktop.command('prompt', { message: 'COMPETING-LOCAL' }, runtimeId), approval), /此会话正在处理外部委托/);
  const request = await until(() => page.evaluate(runtimeId =>
    window.connectorRequests.findLast(value => value.runtimeId === runtimeId && value.method === 'confirm'), approval.runtimeId),
  Boolean, 'approval event');
  await page.evaluate(async ({ runtimeId, id }) => {
    await window.desktop.command('extension_ui_response', { id, confirmed: true }, runtimeId);
  }, { runtimeId: approval.runtimeId, id: request.id });
  await until(() => task(approval.id), value => value.phase === 'completed', 'locally approved tool');
  checks.push('external approval rejected; competing prompt and policy mutation rejected; native local approval succeeds');

  const denied = await create('connector-deny');
  const deniedMarker = join(workspace, 'connector-denied.txt');
  await assert.rejects(readFile(deniedMarker), { code: 'ENOENT' });
  await submit(denied.id, 'deny-run', 'CONNECTOR-DENY');
  await until(() => task(denied.id), value => value.awaitingLocalApproval, 'native approval to deny');
  const externalDenial = await rpc('approval.respond', { taskId: denied.id, confirmed: true });
  assert.equal(externalDenial.ok, false);
  assert.equal(externalDenial.error, 'connector:invalid-input');
  assert.equal((await task(denied.id)).awaitingLocalApproval, true);
  const deniedRequest = await until(() => page.evaluate(runtimeId =>
    window.connectorRequests.findLast(value => value.runtimeId === runtimeId && value.method === 'confirm'), denied.runtimeId),
  Boolean, 'native denial event');
  await page.evaluate(({ runtimeId, id }) =>
    window.desktop.command('extension_ui_response', { id, confirmed: false }, runtimeId),
  { runtimeId: denied.runtimeId, id: deniedRequest.id });
  const deniedResult = await until(() => task(denied.id), value => value.phase === 'completed', 'denied tool report');
  assert.equal(deniedResult.summary, 'CONNECTOR-DENIED-NOT-EXECUTED');
  assert.equal(deniedResult.awaitingLocalApproval, false);
  assert.equal(deniedResult.resultAvailable, true);
  await assert.rejects(readFile(deniedMarker), { code: 'ENOENT' });
  const deniedRequestCount = requests.filter(value => value === 'CONNECTOR-DENY').length;
  await submit(denied.id, 'deny-run', 'CONNECTOR-DENY');
  assert.equal(requests.filter(value => value === 'CONNECTOR-DENY').length, deniedRequestCount);
  checks.push('local native denial prevents command execution; completed reports the denial, not tool success; retry never resubmits');

  for (const decision of ['ALLOW', 'DENY', 'ESCALATE', 'REVOKE']) {
    const delegated = await create(`connector-delegate-${decision.toLowerCase()}`);
    const input = `CONNECTOR-DELEGATE-${decision}`, marker = join(workspace, `${input.toLowerCase()}.txt`);
    await submit(delegated.id, 'delegated-run', input);
    await until(() => task(delegated.id), value => value.awaitingLocalApproval, `pending ${decision}`);
    assert.deepEqual((await client('approval.list', { taskId: delegated.id })).requests, []);
    await openPanel();
    const panel = page.getByRole('region', { name: '外部 Agent', exact: true });
    await panel.getByRole('button', { name: '刷新接入状态', exact: true }).click();
    const row = panel.locator('.external-approval-task').filter({ hasText: `connector-delegate-${decision.toLowerCase()}` });
    await row.getByRole('button', { name: '委托此任务审批', exact: true }).click();
    await row.getByRole('button', { name: '确认委托审批', exact: true }).click();
    await row.getByRole('button', { name: '撤销审批委托', exact: true }).waitFor();
    if (decision === 'ALLOW') {
      await row.scrollIntoViewIfNeeded();
      await page.screenshot({ path: join(output, 'delegation-native-light.png') });
    }
    const listed = await client('approval.list', { taskId: delegated.id });
    assert.equal(listed.requests.length, 1);
    assert.equal(listed.requests[0].category, 'file');
    assert.equal(JSON.parse(listed.requests[0].input).content, input);
    const answer = { taskId: delegated.id, requestId: listed.requests[0].requestId,
      decision: decision === 'DENY' ? 'deny' : decision === 'ESCALATE' ? 'escalate' : 'allow', reason: `Isolated ${decision} fixture` };
    if (decision === 'REVOKE') {
      await row.getByRole('button', { name: '撤销审批委托', exact: true }).click();
      assert.equal((await client('approval.respond', answer, true)).error.code, 'connector:local-approval');
    } else {
      const receipt = await client('approval.respond', answer);
      assert.equal(receipt.outcome, 'applied');
    }
    if (decision === 'ESCALATE' || decision === 'REVOKE') {
      assert.equal((await task(delegated.id)).awaitingLocalApproval, true);
      assert.deepEqual((await client('approval.list', { taskId: delegated.id })).requests, []);
      await assert.rejects(readFile(marker), { code: 'ENOENT' });
      const pending = await page.evaluate(runtimeId =>
        window.connectorRequests.findLast(value => value.runtimeId === runtimeId && value.method === 'confirm'), delegated.runtimeId);
      await page.evaluate(({ runtimeId, id, confirmed }) => window.desktop.command('extension_ui_response', { id, confirmed }, runtimeId),
        { runtimeId: delegated.runtimeId, id: pending.id, confirmed: decision === 'ESCALATE' });
    }
    const done = await until(() => task(delegated.id), value => value.phase === 'completed', `settled ${decision}`);
    assert.equal(done.summary, decision === 'DENY' || decision === 'REVOKE' ? 'DELEGATED-DENIED' : 'DELEGATED-ALLOWED');
    assert.equal(done.approvalDelegation, undefined);
    if (decision === 'ALLOW' || decision === 'ESCALATE') assert.equal(await readFile(marker, 'utf8'), input);
    else await assert.rejects(readFile(marker), { code: 'ENOENT' });
    await page.getByRole('button', { name: '返回接入渠道', exact: true }).click();
    await page.getByRole('button', { name: '返回会话', exact: true }).click();
  }
  const audit = (await connectorState()).approvals.audit;
  for (const decision of ['allow', 'deny', 'escalate'])
    assert.ok(audit.some(entry => entry.action === decision && entry.outcome === 'applied' && entry.callId));
  checks.push('real Python approval adapter + local task opt-in UI: native allow/deny/escalate/revoke and exact file side effects');

  const stopped = await create('connector-stop');
  await submit(stopped.id, 'stop-run', 'CONNECTOR-HOLD');
  await until(async () => requests, value => value.includes('CONNECTOR-HOLD'), 'external held turn');
  await client('task.stop', { taskId: stopped.id });
  await until(() => task(stopped.id), value => ['stopped', 'failed'].includes(value.phase), 'native external stop');
  checks.push('external task.stop follows native abort for its own live turn');

  const localStop = await create('connector-local-stop');
  await assert.rejects(page.evaluate(({ runtimeId, sessionId }) =>
    window.desktop.btwAsk({ runtimeId, sessionId, scopeId: 'fixture-scope',
      requestId: 'fixture-question', question: 'NO-SIDE-QUESTION' }), localStop), /Stop the external task before asking a local side question/);
  await assert.rejects(page.evaluate(workspace => window.desktop.relocateWorkspace(workspace), workspace),
    /Stop external tasks before relocating this project/);
  await page.evaluate(({ runtimeId }) => window.desktop.command('abort', {}, runtimeId), localStop);
  assert.equal((await task(localStop.id)).phase, 'stopped');
  await page.evaluate(({ runtimeId }) => window.desktop.command('prompt', { message: 'LOCAL-TAKEOVER' }, runtimeId), localStop);
  checks.push('local stop releases a waiting external task and permits a new local turn');

  await action({ type: 'policy', agentId: connection.agentId, cwd: workspace, days: null,
    permissionPreset: 'approve-for-me', categories: ['risk', 'question'] });
  assert.equal((await connectorState()).approvals.policies[0].expiresAt, null);
  const automatic = await create('connector-automatic');
  await submit(automatic.id, 'auto-run', 'CONNECTOR-AUTO');
  await until(() => task(automatic.id), value => value.phase === 'completed', 'native automatic write');
  assert.equal(await readFile(join(workspace, 'connector-auto.txt'), 'utf8'), 'CONNECTOR-AUTO');
  assert.equal(await page.evaluate(runtimeId => window.connectorRequests.some(r =>
    r.runtimeId === runtimeId && r.title?.startsWith('Approve write_file')), automatic.runtimeId), false);
  checks.push('explicit persistent approve-for-me policy runs ordinary native writes without another approval');
  const nativeAsk = value => until(() => page.evaluate(sessionId => window.desktop.switchSession(sessionId), value.sessionId),
    state => state.permissionPreset === 'ask', 'terminal automatic session resets native permissions');
  await nativeAsk(automatic);
  const automaticStop = await create('connector-automatic-local-stop');
  await submit(automaticStop.id, 'auto-stop-run', 'CONNECTOR-HOLD');
  await until(() => task(automaticStop.id), value => value.phase === 'running', 'automatic native work before local stop');
  await page.evaluate(runtimeId => window.desktop.command('abort', {}, runtimeId), automaticStop.runtimeId);
  assert.equal((await task(automaticStop.id)).phase, 'stopped');
  await nativeAsk(automaticStop);
  checks.push('completed and locally stopped automatic sessions reset to native Ask before local ownership is released');

  await mkdir(join(workspace, 'connector-risk-empty'));
  const risk = await create('connector-persistent-risk');
  const wake = execute(process.env.PYTHON || 'python', ['-X', 'utf8', '-B',
    resolve('scripts/fixtures/external-wake-client.py'), companion, config, risk.id],
  { timeout: 45000, windowsHide: true, maxBuffer: 256 * 1024 });
  // Keep rejection observed while the native request is being prepared.
  void wake.catch(() => {});
  await submit(risk.id, 'risk-run', 'CONNECTOR-RISK');
  await until(() => task(risk.id), value => value.awaitingLocalApproval, 'delegated native risk');
  const notification = JSON.parse((await wake).stdout);
  assert.equal(notification.messages.length, 1);
  assert.equal(notification.messages[0].sessionKey, 'isolated-origin-session');
  assert.match(notification.messages[0].content, /approval.list/);
  assert.equal((await task(risk.id)).awaitingLocalApproval, true, 'wake is never an unconditional approval');
  const riskApproval = await client('approval.list', { taskId: risk.id });
  assert.equal(riskApproval.requests[0].category, 'risk');
  await client('approval.respond', { taskId: risk.id, requestId: riskApproval.requests[0].requestId,
    decision: 'deny', reason: 'Controlled reviewer rejects destructive operation' });
  await until(() => task(risk.id), value => value.phase === 'completed', 'risk denial');
  assert.equal((await stat(join(workspace, 'connector-risk-empty'))).isDirectory(), true);
  checks.push('real companion long polling wakes only simulated original Hermes host; no auto-answer; native risk denial keeps target');

  const question = await create('connector-persistent-question');
  await submit(question.id, 'question-run', 'CONNECTOR-QUESTION');
  const listedQuestion = await until(() => client('approval.list', { taskId: question.id }),
    value => value.requests.some(r => r.category === 'question'), 'delegated native clarification');
  let questionRequest = listedQuestion.requests[0];
  // Some runtimes first ask permission to pose the question.
  if (!questionRequest.input.startsWith('[')) {
    await client('approval.respond', { taskId: question.id, requestId: questionRequest.requestId, decision: 'allow', reason: 'Permit clarification' });
    questionRequest = (await until(() => client('approval.list', { taskId: question.id }),
      value => value.requests.some(r => r.category === 'question' && r.input.startsWith('[')), 'structured question')).requests[0];
  }
  await client('approval.respond', { taskId: question.id, requestId: questionRequest.requestId, decision: 'allow',
    reason: 'Original fixture goal specifies tests', answers: [{ id: 'target', value: 'tests', wasCustom: false }] });
  await until(() => task(question.id), value => value.phase === 'completed', 'native structured answer');
  checks.push('real native clarification validates and receives explicitly delegated structured answers');

  const policyRevoke = await create('connector-policy-revoke');
  await submit(policyRevoke.id, 'hold-policy', 'CONNECTOR-HOLD');
  await until(() => task(policyRevoke.id), value => value.phase === 'running', 'automatic task before revoke');
  await action({ type: 'unpolicy', agentId: connection.agentId, cwd: workspace });
  assert.equal((await task(policyRevoke.id)).phase, 'interrupted');
  const restricted = await page.evaluate(sessionId => window.desktop.switchSession(sessionId), policyRevoke.sessionId);
  assert.equal(restricted.permissionPreset, 'ask');
  assert.equal((await connectorState()).approvals.policies.length, 0);
  checks.push('revoking persistent policy aborts automatic task and restores native Ask, not just a UI badge');

  await action({ type: 'policy', agentId: connection.agentId, cwd: workspace, days: 7,
    permissionPreset: 'approve-for-me', categories: ['risk'] });
  const waiting = await create('connector-restart');
  await action({ type: 'delegate', taskId: waiting.id, minutes: 15, categories: ['file'] });
  assert.ok((await task(waiting.id)).approvalDelegation);
  const count = requests.length;
  await close();
  app = undefined;
  await launch();
  assert.equal((await connectorState()).listening, true);
  assert.equal((await task(waiting.id)).phase, 'interrupted');
  assert.equal((await task(waiting.id)).approvalDelegation, undefined);
  assert.equal((await connectorState()).approvals.tasks.length, 0);
  assert.equal((await connectorState()).approvals.policies[0].permissionPreset, 'approve-for-me');
  assert.ok((await connectorState()).approvals.audit.some(entry => entry.taskId === waiting.id && entry.action === 'grant'));
  const restartedRuntimes = (await snapshot()).runtimes.map(value => value.runtimeId).sort();
  const afterRestart = await task(first.id);
  assert.equal(afterRestart.phase, 'completed');
  assert.equal(afterRestart.submitted, true);
  assert.equal(afterRestart.receipt, 'delivered');
  assert.equal(afterRestart.resultAvailable, false);
  assert.equal(afterRestart.summary, undefined);
  assert.equal(afterRestart.summaryTruncated, undefined);
  assert.equal(afterRestart.reason, completed.reason);
  assert.equal((await create('connector-first')).id, first.id);
  assert.equal((await submit(first.id, 'run-first', 'CONNECTOR-ANSWER')).phase, 'completed');
  assert.deepEqual((await snapshot()).runtimes.map(value => value.runtimeId).sort(), restartedRuntimes);
  assert.equal(requests.length, count);
  descriptor = JSON.parse(await readFile(join(profile, 'external-connectors', 'agents', connection.agentId, 'model.json'), 'utf8'));
  const newAutomatic = await create('connector-automatic-after-restart');
  await submit(newAutomatic.id, 'auto-restart', 'CONNECTOR-AUTO');
  await until(() => task(newAutomatic.id), value => value.phase === 'completed', 'persistent native tier after restart');
  checks.push('persistent policy survives restart only for fresh tasks; old process and request IDs never reattach');
  await action({ type: 'revoke', agentId: connection.agentId });
  assert.equal((await connectorState()).connections.length, 0);
  assert.equal((await client('system.capabilities', {}, true)).error.code, 'connector:unauthorized');
  await action({ type: 'disable' });
  assert.equal((await connectorState()).listening, false);
  checks.push('restart preserves explicit access but interrupts old tasks without replay; revocation rejects old credential');
  checks.push('completed receipts survive restart without answers, history attachment or repeated native work');

  await page.getByRole('button', { name: '远程访问', exact: true }).click();
  await page.getByRole('button', { name: /外部 Agent.*管理连接/ }).click();
  await page.screenshot({ path: join(output, 'disabled-light.png') });
  assert.deepEqual(errors, []);
  passed = true;
} catch (error) {
  errors.push(error.message);
  await page?.screenshot({ path: join(output, 'failure.png') }).catch(() => {});
  console.error(error);
  process.exitCode = 1;
} finally {
  if (app) {
    try {
      await close();
    } catch (error) { errors.push(error.message); process.exitCode = 1; }
  }
  for (const response of held) response.destroy();
  await new Promise(resolve => model.close(resolve));
  await writeFile(join(output, 'verification.json'), JSON.stringify({
    passed: passed && !errors.length, checks, errors, shutdown, inferenceRequests: requests.length,
    fixtureOnly: true, realHermesGateway: false, profile,
  }, null, 2) + '\n');
}
if (passed && !errors.length) console.log(`External connector native acceptance passed (${checks.length} groups). Evidence: ${output}`);
