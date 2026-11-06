import assert from 'node:assert/strict';
import test from 'node:test';
import { inspect } from 'node:util';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { build } from 'esbuild';
import { remoteWorkerStatus, RemoteToolProgress, type RemoteWorkerState, type RemoteWorkerStatus } from '../electron/remote-progress';
import type { RuntimeEvent, UIRequest } from '../src/contracts';
import { QUESTION_TITLE } from '../src/questionnaire';

const worker = (patch: Partial<RemoteWorkerState> = {}): RemoteWorkerState => ({
  id: 'worker-1', status: 'connected', busy: false, submissions: 0, runActive: false,
  pendingUI: new Map(), messages: [], failed: false, interrupted: false, ...patch,
});
const request = (patch: Partial<UIRequest> = {}): UIRequest => ({
  type: 'extension_ui_request', id: 'ui-1', runtimeId: 'worker-1', method: 'input', ...patch,
});
const waiting = (value: UIRequest) => remoteWorkerStatus(worker({ pendingUI: new Map([[value.id, value]]) }));
const start = (toolCallId: string, toolName = 'read_file', patch: Partial<RuntimeEvent> = {}): RuntimeEvent =>
  ({ type: 'tool_execution_start', toolCallId, toolName, ...patch });
const end = (toolCallId: string, toolName = 'read_file', patch: Partial<RuntimeEvent> = {}): RuntimeEvent =>
  ({ type: 'tool_execution_end', toolCallId, toolName, isError: false, ...patch });
const progress = (...events: RuntimeEvent[]) => {
  const value = new RemoteToolProgress();
  value.update({ type: 'agent_start' });
  events.forEach(event => value.update(event));
  return value;
};
function assertStatus(value: RemoteWorkerStatus, expected: Omit<RemoteWorkerStatus, 'label'>, label: RegExp) {
  assert.deepEqual({ kind: value.kind, queue: value.queue, attention: value.attention }, expected);
  assert.match(value.label, label);
  assert.match(value.label, /^[\u3400-\u9fff].*\/.*[A-Za-z]/);
}
interface ToolSummary {
  active?: number; returned?: number; missingResults?: number; failures?: number;
  cancelled?: number; missingStarts?: number; interrupted?: boolean; partial?: boolean;
  categories?: string[];
}
function assertSummary(value: RemoteToolProgress, expected: ToolSummary, settled = false) {
  const text = value.summary(settled);
  assert.ok(text.length <= 200, text);
  assert.doesNotMatch(text, /[\r\n]/);
  for (const [label, count] of [
    ['进行/Active', expected.active], ['已返回/Returned', expected.returned],
    ['未返回/Missing results', expected.missingResults], ['失败/Failed', expected.failures],
    ['取消/Cancelled', expected.cancelled], ['缺开始/Missing starts', expected.missingStarts],
  ] as const) {
    const match = new RegExp(`(?:^|; )${label}: (\\d+)\\b`).exec(text);
    if (count) assert.equal(match?.[1], String(count), text);
    else assert.equal(match, null, text);
  }
  assert.equal(text.includes('中断/Interrupted'), expected.interrupted ?? false, text);
  assert.equal(text.includes('记录不全/Partial'), expected.partial ?? false, text);
  for (const category of expected.categories ?? []) assert.ok(text.includes(category), text);
  assert.doesNotMatch(text, /success|passed|tests|成功|通过/i);
}

test('the module bundles and executes in a browser context without Node runtime APIs or output files', async () => {
  const result = await build({
    entryPoints: [fileURLToPath(new URL('../electron/remote-progress.ts', import.meta.url))],
    bundle: true, platform: 'browser', format: 'iife', globalName: 'RemoteProgressModule',
    target: 'es2022', write: false, metafile: true, logLevel: 'silent',
  });
  assert.equal(result.outputFiles.length, 1);
  assert.ok(Object.values(result.metafile.outputs).every(output => output.imports.length === 0));
  const context: { RemoteProgressModule?: typeof import('../electron/remote-progress') } = {};
  runInNewContext(result.outputFiles[0].text, context, { timeout: 2000 });
  const api = context.RemoteProgressModule!;
  const value = new api.RemoteToolProgress();
  value.update(start('browser-tool', 'run_command'));
  assertSummary(value, { active: 1, categories: ['命令/command 1'] });
  value.update(end('browser-tool', 'run_command'));
  assertSummary(value, { returned: 1, categories: ['命令/command 1'] });
  assertStatus(api.remoteWorkerStatus(worker()), { kind: 'idle', queue: 0, attention: false }, /空闲.*Idle/);
});

test('worker status is idle, not an inferred successful completion', () => {
  const value = worker();
  Object.defineProperty(value, 'messages', { get() { throw new Error('Do not read transcripts'); } });
  assertStatus(remoteWorkerStatus(value), { kind: 'idle', queue: 0, attention: false }, /空闲.*Idle/);
});

test('worker queue uses a finite state count, preserves zero and falls back to queued when unknown', () => {
  for (const count of [undefined, NaN, Infinity, -Infinity, -1]) {
    for (const queued of [false, true]) {
      const status = remoteWorkerStatus(worker({ queued, state: { isStreaming: false, pendingMessageCount: count } }));
      assert.equal(status.queue, queued ? 1 : 0);
      assert.equal(status.kind, queued ? 'queued' : 'idle');
    }
  }
  assert.equal(remoteWorkerStatus(worker({ queued: true })).queue, 1);
  assert.equal(remoteWorkerStatus(worker({ queued: true, state: { isStreaming: false, pendingMessageCount: 0 } })).queue, 0);
  assertStatus(remoteWorkerStatus(worker({ state: { isStreaming: false, pendingMessageCount: 4 } })),
    { kind: 'queued', queue: 4, attention: false }, /排队.*Queued/);
});
test('observed Desktop drafts are added to the runtime queue without treating dispatching receipts as queued', () => {
  assert.equal(remoteWorkerStatus(worker({ queued: true, state: { isStreaming: false, pendingMessageCount: 0 } }), 2).queue, 2);
  assert.equal(remoteWorkerStatus(worker({ queued: true, state: { isStreaming: false, pendingMessageCount: 3 } }), 2).queue, 5);
  assert.equal(remoteWorkerStatus(worker({ queued: true, state: { isStreaming: false, pendingMessageCount: 0 } }), 0).queue, 0);
  assert.equal(remoteWorkerStatus(worker({ queued: true }), 0).queue, 0);
});

test('streaming, run ownership, submissions, compaction, background lanes and side questions are live work', () => {
  for (const [patch, label] of [
    [{ busy: true }, /运行.*Running/],
    [{ runActive: true }, /运行.*Running/],
    [{ state: { isStreaming: true } }, /运行.*Running/],
    [{ submissions: 1 }, /提交.*Submitting/],
    [{ busy: true, state: { isStreaming: true, isCompacting: true } }, /压缩.*Compacting/],
    [{ backgroundActive: true }, /后台.*Background agents/],
    [{ backgroundLanes: [{ id: 'lane_aabbccdd', status: 'settling' }] }, /后台.*Background agents/],
    [{ btwActive: true }, /旁问.*Side question/],
    [{ stopping: true, busy: true }, /停止.*Stopping/],
    [{ status: 'connecting' }, /连接.*Connecting/],
  ] satisfies [Partial<RemoteWorkerState>, RegExp][]) {
    assertStatus(remoteWorkerStatus(worker({ queued: true, ...patch })),
      { kind: 'running', queue: 1, attention: false }, label);
  }
});

test('interruptions and disconnection need attention, without stale activity overriding a dead transport', () => {
  assertStatus(remoteWorkerStatus(worker({ interrupted: true, queued: true })),
    { kind: 'interrupted', queue: 1, attention: true }, /中断.*Interrupted/);
  assert.match(remoteWorkerStatus(worker({ failed: true })).label, /失败.*Failed/);
  assertStatus(remoteWorkerStatus(worker({ status: 'disconnected', busy: true, backgroundActive: true,
    backgroundLanes: [{ id: 'lane_aabbccdd', status: 'running' }], pendingUI: new Map([['ui-1', request()]]) })),
  { kind: 'interrupted', queue: 0, attention: true }, /断开.*Disconnected/);
  assert.equal(remoteWorkerStatus(worker({ busy: true, interrupted: true })).kind, 'running');
});

test('only the known permission envelope identifies a tool approval, without exposing its contents', () => {
  const callId = 'permission-call-3d6009f9';
  const approval = request({ method: 'confirm', title: `Approve run_command [${callId.slice(-8)}]`,
    message: `Call: ${callId}\nrun_command can modify the workspace or execute a command\n\nPRIVATE COMMAND\n\nBatch calls may ask separately\nbefore approved tools begin running.` });
  let historyReads = 0;
  const value = worker({ pendingUI: new Map([[approval.id, approval]]) });
  Object.defineProperty(value, 'messages', { get() {
    historyReads++;
    return [{ role: 'assistant', content: [{ type: 'toolCall', id: callId, name: 'run_command',
      arguments: { command: 'PRIVATE RECOVERED COMMAND', cwd: 'C:\\PRIVATE' } }] }];
  } });
  const status = remoteWorkerStatus(value);
  assert.equal(historyReads, 1, 'Approval parsing must use this worker history');
  assertStatus(status, { kind: 'waiting', queue: 0, attention: true }, /待审批.*Approval/);
  assert.doesNotMatch(JSON.stringify(status), /PRIVATE|permission-call/);
  assert.match(waiting({ ...approval, message: 'Please approve this command' }).label, /待本机输入.*Local input/);
  assert.match(waiting({ ...approval, runtimeId: 'other-worker' }).label, /待本机输入.*Local input/);
});

test('project trust is scoped to its runtime and is not presented as a tool approval', () => {
  const trust = request({ method: 'confirm', messageStyle: 'preformatted', projectTrust: { cwd: 'C:\\PRIVATE' } });
  assert.match(waiting(trust).label, /项目授权.*Project trust/);
  assert.match(waiting({ ...trust, runtimeId: 'other-worker' }).label, /待本机输入.*Local input/);
  assert.match(waiting({ ...trust, projectTrust: undefined, title: 'Trust this project?' }).label, /待本机输入.*Local input/);
});

test('validated single questions and multi-question forms have distinct labels', () => {
  const question = { id: 'scope', label: 'Scope', question: 'PRIVATE QUESTION', allowFreeform: true, options: [] };
  for (const questions of [[question], [question, { ...question, id: 'extra' }]]) {
    const value = request({ title: QUESTION_TITLE + JSON.stringify({ version: 1, callId: 'ask-1', questions }) });
    assert.match(waiting(value).label, questions.length === 1 ? /待回答.*Question/ : /待表单.*Form/);
  }
  for (const title of [QUESTION_TITLE + '{', QUESTION_TITLE + JSON.stringify({ version: 2, callId: 'ask-1', questions: [question] })])
    assert.match(waiting(request({ title })).label, /待本机输入.*Local input/);
});

test('plan approval uses its existing structured parser', () => {
  const plan = request({ method: 'select', title: 'Desktop Plan review\nC:\\PRIVATE\\plan.md\n\nPRIVATE PLAN',
    options: ['Approve plan', 'Request refinements', 'Keep planning'] });
  assert.match(waiting(plan).label, /计划审批.*Plan approval/);
  assert.match(waiting({ ...plan, options: ['Approve', 'Deny'] }).label, /待本机输入.*Local input/);
});

test('login, form and approval keywords or untyped metadata never infer a request type', () => {
  for (const method of ['input', 'editor', 'select', 'confirm', 'login', 'form', 'question']) {
    for (const title of ['Login required', 'Approve command', 'Question form', 'Trust project', 'Please sign in']) {
      const value = request({ method, title, message: 'SECRET login token; approval; question; form' });
      const status = remoteWorkerStatus(worker({ busy: true, queued: true, pendingUI: new Map([[value.id, value]]) }));
      assertStatus(status, { kind: 'waiting', queue: 1, attention: true }, /待本机输入.*Local input/);
    }
  }
  const untyped = { ...request({ placeholder: 'Login password', prefill: 'SECRET', text: 'Sign in' }),
    kind: 'login', login: { provider: 'PRIVATE' }, authRequired: true };
  assertStatus(waiting(untyped), { kind: 'waiting', queue: 0, attention: true }, /待本机输入.*Local input/);
  assert.doesNotMatch(JSON.stringify(waiting(untyped)), /SECRET|PRIVATE|password/);
});

test('tool progress is empty before observed execution and resets completely at agent_start', () => {
  const value = new RemoteToolProgress();
  assert.equal(value.summary(), '');
  value.update(start('one'));
  value.update({ type: 'desktop_exit' });
  assertSummary(value, { interrupted: true, missingResults: 1 });
  value.update({ type: 'agent_start' });
  assert.equal(value.summary(true), '');
  value.update(start('one', 'run_command'));
  assertSummary(value, { active: 1, categories: ['命令/command 1'] });
});

test('actual tool start and end events are deduplicated by call ID, not tool name', () => {
  const value = progress(start('one'), start('one'), start('two'), end('one'), end('one'));
  assertSummary(value, { active: 1, returned: 1, categories: ['读取/read 1'] });
  value.update(end('two'));
  assertSummary(value, { returned: 2, categories: ['读取/read 2'] });
});

test('parallel tools retain separate active categories when one finishes out of order', () => {
  const value = progress(start('read'), start('command', 'run_command'), start('web', 'fetch_url'));
  assertSummary(value, { active: 3, categories: ['读取/read 1', '命令/command 1', '网页/web 1'] });
  value.update(end('command', 'run_command'));
  assertSummary(value, { active: 2, returned: 1, categories: ['读取/read 1', '网页/web 1', '命令/command 1'] });
  value.update(end('read'));
  value.update(end('web', 'fetch_url'));
  assertSummary(value, { returned: 3, categories: ['读取/read 1', '命令/command 1', '网页/web 1'] });
});

test('a missing start is explicit and a late start never resurrects a finished invocation', () => {
  const value = progress(end('one', 'run_command'), end('one', 'run_command'));
  assertSummary(value, { returned: 1, missingStarts: 1, categories: ['命令/command 1'] });
  value.update(start('one', 'run_command'));
  value.update(start('one', 'run_command'));
  assertSummary(value, { returned: 1, categories: ['命令/command 1'] });
});

test('missing tool names can be classified by a later start without double counting', () => {
  const value = progress({ type: 'tool_execution_end', toolCallId: 'one' });
  assertSummary(value, { returned: 1, missingStarts: 1, categories: ['工具/other 1'] });
  value.update(start('one', 'read_file'));
  assertSummary(value, { returned: 1, categories: ['读取/read 1'] });
});

test('settled presentation marks missing ends honestly, is read-only and accepts a late end', () => {
  const value = progress(start('one'));
  assertSummary(value, { missingResults: 1, categories: ['读取/read 1'] }, true);
  assertSummary(value, { active: 1, categories: ['读取/read 1'] });
  value.update({ type: 'agent_end' });
  assertSummary(value, { missingResults: 1, categories: ['读取/read 1'] });
  value.update(end('one'));
  assertSummary(value, { returned: 1, categories: ['读取/read 1'] });
});

test('failed end receipts are not successes and duplicate error events cannot inflate counts', () => {
  const value = progress(start('one', 'run_command'), end('one', 'run_command', { isError: true }),
    end('one', 'run_command', { isError: true }));
  assertSummary(value, { returned: 1, failures: 1, categories: ['命令/command 1'] });
  value.update(end('one', 'run_command'));
  assertSummary(value, { returned: 1, failures: 1, categories: ['命令/command 1'] });
});

test('structured embedded check failures reuse tool presentation but never claim that tests passed', () => {
  for (const check of [
    { command: 'PRIVATE COMMAND', exitCode: 7, timedOut: false },
    { command: 'PRIVATE COMMAND', exitCode: null, timedOut: true },
    { command: 'PRIVATE COMMAND', exitCode: null, timedOut: false },
    { command: 'PRIVATE COMMAND', exitCode: 0, timedOut: false },
  ]) {
    const value = progress(start('one', 'write_file'), end('one', 'write_file', {
      result: { details: { changed: true, thenRun: check }, content: 'PRIVATE OUTPUT' },
    }));
    assertSummary(value, { returned: 1, failures: check.exitCode === 0 ? 0 : 1, categories: ['写入/write 1'] });
    assert.doesNotMatch(value.summary(), /PRIVATE|passed|success|tests/i);
  }
});

test('explicit cancellation is counted, while cancellation-looking output is never interpreted', () => {
  const value = progress(start('one'), start('two'), end('one', 'read_file', { cancelled: true }));
  assertSummary(value, { active: 1, returned: 1, cancelled: 1, categories: ['读取/read 1'] });
  value.update(end('two', 'read_file', { result: { content: 'cancelled aborted failed tests passed' } }));
  assertSummary(value, { returned: 2, cancelled: 1, categories: ['读取/read 2'] });
});

test('authoritative abort, error, truncation and transport exit preserve missing results', () => {
  for (const stopReason of ['aborted', 'error', 'length']) {
    const value = progress(start('one', 'run_command'));
    value.update({ type: 'message_end', message: { role: 'assistant', stopReason, content: 'PRIVATE' } });
    value.update({ type: 'agent_end' });
    assertSummary(value, { interrupted: true, missingResults: 1, categories: ['命令/command 1'] });
  }
  for (const event of [
    { type: 'desktop_exit' },
    { type: 'agent_end', aborted: true },
    { type: 'agent_end', cancelled: true },
    { type: 'agent_end', messages: [{ role: 'assistant', stopReason: 'aborted', content: 'PRIVATE' }] },
  ]) {
    const value = progress(start('one'), event);
    assertSummary(value, { interrupted: true, missingResults: 1, categories: ['读取/read 1'] });
  }
});

test('private IDs, unknown tools and payloads expose no sensitive data in public state or summary', () => {
  const secret = 'SECRET-C:\\private\\key.txt\ncurl --token=sk-private https://private.invalid';
  const value = progress(start(secret, secret, { args: { secret }, arguments: { secret }, thinking: secret }),
    end(secret, secret, { result: { content: secret, details: { path: secret, output: secret } }, output: secret }));
  value.update({ type: 'message_update', assistantMessageEvent: { type: 'thinking_delta', delta: secret } });
  value.update({ type: 'tool_execution_update', toolCallId: 'partial', partialResult: { content: secret } });
  assertSummary(value, { returned: 1, categories: ['工具/other 1'] });
  assert.doesNotMatch(inspect(value, { depth: null, showHidden: true }), /SECRET|private|curl|sk-private/);
  assert.ok(value.summary().length <= 200);
  assert.doesNotMatch(value.summary(), /[\r\n]/);
});

test('tool summaries never read arguments, thinking, output or result content', () => {
  const unreadable = () => { throw new Error('Sensitive payload was accessed'); };
  const event = start('one', 'run_command');
  for (const name of ['args', 'arguments', 'thinking', 'output']) Object.defineProperty(event, name, { get: unreadable });
  const result = {};
  Object.defineProperty(result, 'content', { get: unreadable });
  const value = progress(event, end('one', 'run_command', { result }));
  assertSummary(value, { returned: 1, categories: ['命令/command 1'] });
});

test('missing or malformed IDs and transcript tool calls do not invent execution receipts', () => {
  const value = progress(
    { type: 'tool_execution_start', toolName: 'read_file' },
    { type: 'tool_execution_end', toolCallId: '', toolName: 'read_file' },
    { type: 'tool_execution_end', toolCallId: 3, toolName: 'read_file' },
    { type: 'message_end', message: { role: 'assistant', content: [{ type: 'toolCall', id: 'one', name: 'read_file' }] } },
    { type: 'tool_execution_update', toolCallId: 'one', toolName: 'read_file' },
  );
  assertSummary(value, { partial: true });
});

test('summary stays one line within 200 characters without dropping failure or missing lifecycle counts', () => {
  const value = progress();
  const tools = ['read_file', 'write_file', 'edit_file', 'run_command', 'search', 'list_directory', 'fetch_url',
    'desktop_sessions', 'desktop_read_session', 'desktop_send_message', 'unknown'];
  for (let i = 0; i < 55; i++) {
    const name = tools[i % tools.length];
    value.update(start(`active-${i}`, name));
    value.update(start(`returned-${i}`, name));
    value.update(end(`returned-${i}`, name, { isError: true, cancelled: true }));
    value.update(end(`missing-start-${i}`, name));
  }
  for (const settled of [false, true]) {
    assertSummary(value, { ...(settled ? { missingResults: 55 } : { active: 55 }),
      returned: 110, failures: 55, cancelled: 55, missingStarts: 55, categories: ['读取/read'] }, settled);
  }
});

test('call ID length is bounded without truncation collisions and partial state resets per run', () => {
  const prefix = 'x'.repeat(256);
  const value = progress(start(prefix), start(`${prefix}1`), end(`${prefix}2`), end(prefix));
  assertSummary(value, { returned: 1, partial: true, categories: ['读取/read 1'] });
  assert.doesNotMatch(value.summary(), /x{8}/);
  value.update({ type: 'agent_start' });
  assert.equal(value.summary(), '');
  value.update(start('fresh'));
  assertSummary(value, { active: 1 });
});

test('call records are bounded and known calls still deduplicate and settle after capacity is reached', () => {
  const value = progress();
  for (let i = 0; i < 4096; i++) value.update(start(`call-${i}`));
  assertSummary(value, { active: 2048, partial: true, categories: ['读取/read 2048'] });
  value.update(start('call-0'));
  value.update(end('call-0', 'read_file', { isError: true }));
  value.update(end('call-0', 'read_file', { isError: true }));
  value.update(end('call-4095'));
  assertSummary(value, { active: 2047, returned: 1, failures: 1, partial: true });
  value.update({ type: 'agent_start' });
  value.update(start('call-4095'));
  value.update(end('call-4095'));
  assertSummary(value, { returned: 1 });
});

test('oversized tool names use the generic category without retaining or displaying the name', () => {
  const name = 'PRIVATE'.repeat(1000);
  const value = progress(start('one', name), end('one', name));
  assertSummary(value, { returned: 1, categories: ['工具/other 1'] });
  assert.doesNotMatch(value.summary() + inspect(value, { depth: null, showHidden: true }), /PRIVATE/);
});

test('max-capacity bilingual summaries retain active categories and all warning counts within 200 characters', () => {
  const value = progress();
  const tools = ['desktop_send_message', 'desktop_read_session', 'desktop_sessions', 'run_command', 'read_file'];
  for (let i = 0; i < 2048; i++) {
    const name = tools[i % tools.length];
    if (i % 2) value.update(end(`call-${i}`, name, { isError: true, cancelled: true }));
    else value.update(start(`call-${i}`, name));
  }
  value.update(start('overflow'));
  value.update({ type: 'desktop_exit' });
  assertSummary(value, { missingResults: 1024, returned: 1024, failures: 1024, cancelled: 1024,
    missingStarts: 1024, partial: true, interrupted: true, categories: ['传话/session send'] });
});
