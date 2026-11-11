import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inspectProjectInstructions, createProjectInstructions, projectInstructionsMessage, MAX_RULE_BYTES } from '../electron/project-instructions';
import register from '../electron/project-instructions-extension';
import { isProjectInstructionsCommand, projectInstructionsCopy, projectInstructionsInput, projectInstructionsPrompt } from '../src/project-instructions';
import { commandPresentation } from '../src/command-presentation';
import { visibleInputBlocks } from '../src/ultracode-input';
import ts from 'typescript';
import { runInNewContext } from 'node:vm';
import { PendingMessages, promptNeedsQueue } from '../electron/pending-messages';
import { SessionRuntimes, type SessionRuntime } from '../electron/session-runtimes';
import { reviewPayload, reserveReview } from '../electron/completion-review';
import { externalSessionCommandAllowed } from '../electron/external-connector-policy';
import { emptyLaunch } from '../src/launch-state';

async function fixture(run: (cwd: string) => Promise<void>) {
  const cwd = await mkdtemp(join(tmpdir(), 'desktop-project-rules-'));
  try { await run(cwd); } finally { await rm(cwd, { recursive: true, force: true }); }
}

test('project rules distinguish missing, existing and case variants without needing Git', () => fixture(async cwd => {
  assert.deepEqual(await inspectProjectInstructions(cwd), { mode: 'create', fileName: 'AGENTS.md' });
  await writeFile(join(cwd, 'AGENTS.MD'), '# Human rules\nNever erase source documents.\n');
  assert.deepEqual(await inspectProjectInstructions(cwd), { mode: 'review', fileName: 'AGENTS.MD' });
  await assert.rejects(createProjectInstructions(cwd, 'replacement'), /already exists/);
  assert.match(await readFile(join(cwd, 'AGENTS.MD'), 'utf8'), /Never erase/);
}));

test('failed detection never becomes a create decision', () => fixture(async cwd => {
  await assert.rejects(inspectProjectInstructions(join(cwd, 'missing')));
  await mkdir(join(cwd, 'AGENTS.md'));
  await assert.rejects(inspectProjectInstructions(cwd), /regular project file/);
}));

test('large or linked rule files require manual resolution', () => fixture(async cwd => {
  await writeFile(join(cwd, 'AGENTS.md'), 'x'.repeat(MAX_RULE_BYTES + 1));
  await assert.rejects(inspectProjectInstructions(cwd), /too large/);
  await rm(join(cwd, 'AGENTS.md'));
  await mkdir(join(cwd, 'real'));
  // Junctions need no Windows developer-mode privilege.
  await symlink(join(cwd, 'real'), join(cwd, 'AGENTS.md'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(inspectProjectInstructions(cwd), /regular project file/);
}));

test('exclusive creation retains the other writer and rejects invalid content', () => fixture(async cwd => {
  await assert.rejects(createProjectInstructions(cwd, ' '), /UTF-8 bytes/);
  await assert.rejects(createProjectInstructions(cwd, '界'.repeat(MAX_RULE_BYTES)), /UTF-8 bytes/);
  const results = await Promise.allSettled([
    createProjectInstructions(cwd, '# A\n'), createProjectInstructions(cwd, '# B\n'),
  ]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.ok(['# A\n', '# B\n'].includes(await readFile(join(cwd, 'AGENTS.md'), 'utf8')));
}));

test('Chinese copy separates AI rules, checking and user-approved future changes', () => {
  assert.equal(commandPresentation({ name: 'init' }, true, undefined, { mode: 'create' }).title, '创建 AI 工作规范');
  const review = projectInstructionsCopy({ mode: 'review' }, true);
  assert.equal(review.title, '检查 AI 工作规范');
  assert.match(review.detail, /只提出建议.*确认/);
  assert.match(projectInstructionsCopy({ mode: 'unavailable' }, true).detail, /不会/);
  assert.match(projectInstructionsCopy({ mode: 'choose-project' }, false).detail, /Choose a project/);
  assert.equal(commandPresentation({ name: 'init', source: 'skill', description: 'Skill instructions' }, true, undefined,
    { mode: 'review' }).title, 'init');
});

test('only a standalone init without attachments selects the Desktop adapter', () => {
  assert.equal(isProjectInstructionsCommand(' /init \n'), true);
  for (const value of ['explain /init', '/init extra', '/initialize', ''])
    assert.equal(isProjectInstructionsCommand(value), false);
  assert.equal(isProjectInstructionsCommand('/init', 1), false);
});

test('execution rechecks detection and rejects unreadable rules before submitting a model request', () => fixture(async cwd => {
  assert.match(await projectInstructionsMessage(cwd, '/init'), /Mode: create/);
  await writeFile(join(cwd, 'AGENTS.md'), '# Rules\n');
  assert.match(await projectInstructionsMessage(cwd, '/init'), /Mode: review/);
  await rm(join(cwd, 'AGENTS.md'));
  await mkdir(join(cwd, 'AGENTS.md'));
  await assert.rejects(projectInstructionsMessage(cwd, '/init'), /regular project file/);
  assert.equal(await projectInstructionsMessage(cwd, '/init', 1), '/init');
}));

test('only the complete known init envelope projects to the original user command', () => {
  for (const mode of ['create', 'review'] as const) {
    for (const fileName of ['AGENTS.md', 'AGENTS.MD']) {
      const text = projectInstructionsPrompt(mode, fileName);
      assert.equal(projectInstructionsInput(text), '/init');
      assert.equal(visibleInputBlocks({ role: 'user', content: text })[0].text, '/init');
      assert.equal(visibleInputBlocks({ role: 'assistant', content: text })[0].text, text);
      assert.equal(projectInstructionsInput(text + '\nExtra user text'), undefined);
    }
  }
  assert.equal(projectInstructionsInput('/init'), undefined);
  assert.throws(() => projectInstructionsPrompt('create', '../AGENTS.md'));
});

test('native adapter restricts the whole run, persists only /init and restores tools after settlement', () => fixture(async cwd => {
  const events = new Map<string, (...args: any[]) => any>();
  const tools = new Map<string, any>();
  let activeTools = ['read_file', 'list_directory', 'run_command', 'write_file', 'subagent'];
  register({
    registerTool: (tool: any) => tools.set(tool.name, tool),
    on: (name: string, handler: (...args: any[]) => any) => events.set(name, handler),
    getActiveTools: () => [...activeTools],
    setActiveTools: (names: string[]) => { activeTools = names; },
  });
  events.get('session_start')!();
  const original = [...activeTools];
  const ctx = { cwd };
  const prompt = await projectInstructionsMessage(cwd, '/init');
  const system = events.get('before_agent_start')!({ prompt, systemPrompt: 'BASE SYSTEM' }, ctx);
  assert.match(system.systemPrompt, /BASE SYSTEM[\s\S]*Mode: create/);
  assert.ok(activeTools.includes('desktop_create_project_instructions'));
  assert.equal(events.get('tool_call')!({ toolName: 'run_command' }).block, true);
  assert.equal(events.get('tool_call')!({ toolName: 'write_file' }).block, true);
  assert.deepEqual(events.get('message_end')!({ message: { role: 'user', content: [{ type: 'text', text: prompt }], timestamp: 123 } }),
    { message: { role: 'user', content: [{ type: 'text', text: '/init' }], timestamp: 123 } });
  await tools.get('desktop_create_project_instructions').execute('', { content: '# Human rules\n' }, undefined, undefined, ctx);
  events.get('agent_end')?.();
  assert.equal(events.get('tool_call')!({ toolName: 'write_file' }).block, true, 'Internal retry/compaction end is not settlement');
  assert.ok(activeTools.includes('desktop_create_project_instructions'), 'Creation remains available during retries');
  events.get('agent_settled')!();
  assert.deepEqual(activeTools, original);
  events.get('before_agent_start')!({ prompt: await projectInstructionsMessage(cwd, '/init'), systemPrompt: 'BASE SYSTEM' }, ctx);
  assert.deepEqual(activeTools, ['read_file', 'list_directory']);
  for (const name of ['write_file', 'run_command', 'subagent', 'desktop_create_project_instructions', 'unknown_mcp'])
    assert.equal(events.get('tool_call')!({ toolName: name }).block, true, name);
  await assert.rejects(tools.get('desktop_create_project_instructions').execute('', { content: 'overwrite' }, undefined, undefined, ctx));
  events.get('agent_settled')!();
  assert.deepEqual(activeTools, original);
  assert.equal(events.get('tool_call')!({ toolName: 'write_file' }), undefined);
  assert.equal(events.get('before_agent_start')!({ prompt: 'ordinary work', systemPrompt: 'BASE SYSTEM' }, ctx), undefined);
  assert.deepEqual(activeTools, original);
  assert.equal(events.get('message_end')!({ message: { role: 'user', content: prompt } }), undefined);
  assert.equal(await readFile(join(cwd, 'AGENTS.md'), 'utf8'), '# Human rules\n');
}));

async function submissionFixture(cwd: string) {
  const source = ts.createSourceFile('main.ts', await readFile(new URL('../electron/main.ts', import.meta.url), 'utf8'),
    ts.ScriptTarget.Latest, true);
  const declaration = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'handle')!;
  const javascript = ts.transpileModule(declaration.getText(source), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const sent: string[] = [];
  const sentPayloads: Record<string, unknown>[] = [];
  const externalWorkers = new Set<SessionRuntime>();
  let hold: (() => Promise<unknown>) | undefined;
  const worker = { id: 'worker', cwd, status: 'connected', state: { sessionId: 'session' },
    busy: false, submissions: 0, operations: 0, mutating: false, pendingUI: new Map(),
    rpc: { request: async (type: string, args: any) => {
      if (type === 'get_state') return hold ? hold() : { isStreaming: false };
      if (type === 'prompt') { sent.push(args.message); sentPayloads.push(args); }
      return {};
    } },
  } as unknown as SessionRuntime;
  const runtimes = {
    activeId: worker.id, workers: new Map([[worker.id, worker]]), require: () => worker,
    publish() {}, publishLaunch() {}, preparePrompt: async () => {},
    isBusy: SessionRuntimes.prototype.isBusy,
    assertIdle: SessionRuntimes.prototype.assertIdle,
  };
  const pendingMessages = new PendingMessages(() => {}, (_worker, error) => assert.fail(String(error)));
  const handle = runInNewContext(javascript + '\nhandle', {
    updateInstalling: false, transition: false, sessionNavigation: {}, sessionDraft: null, runtimes,
    selectedDraft: () => undefined, selectedRuntime: () => worker.id,
    text: (value: string) => value, isProjectInstructionsCommand, projectInstructionsMessage, promptNeedsQueue,
    isProjectTrustInput: () => false, preferences: { language: 'zh' }, pendingMessages, emptyLaunch, reviewPayload, reserveReview,
    launchControls: { consume() {}, input: (_worker: unknown, payload: unknown) => payload },
    externalTasks: { retains: (value: SessionRuntime) => externalWorkers.has(value) },
    externalSessionCommandAllowed,
  });
  return { worker, sent, sentPayloads, pendingMessages, externalWorkers, hold: (read: typeof hold) => { hold = read; },
    edit: (id: string, message: string) => handle('command', ['queue_edit', { id, version: 0, message }, worker.id]),
    send: (message: string) => handle('command', ['prompt', { message }, worker.id]) };
}

test('actual IPC init preserves a preselected completion review for the next ordinary task', () => fixture(async cwd => {
  const f = await submissionFixture(cwd);
  f.worker.launch = { ...emptyLaunch(), reviewArmed: true };
  f.worker.state!.desktopCompletionReview = 1;
  await f.send('/init');
  assert.equal(f.worker.launch.reviewArmed, true);
  assert.equal(f.sentPayloads[0].completionReview, undefined);
  assert.match(String(f.sentPayloads[0].message), /Mode: create/);
  await f.send('ordinary task');
  assert.equal(f.sentPayloads[1].completionReview, true);
  assert.equal(f.worker.launch.reviewArmed, false);
  assert.equal(f.worker.submissions, 0);
  assert.equal(f.worker.operations, 0);
}));

test('actual IPC rejects project rules and local inputs while an external task owns the session', () => fixture(async cwd => {
  const f = await submissionFixture(cwd);
  const queued = f.pendingMessages.enqueue(f.worker, 'Existing input', { message: 'Existing input' });
  f.externalWorkers.add(f.worker);
  await assert.rejects(f.send('/init'), /外部委托/);
  await assert.rejects(f.send('ordinary local task'), /外部委托/);
  await assert.rejects(f.edit(queued, '/init'), /外部委托/);
  assert.deepEqual(f.sent, []);
  assert.equal(f.pendingMessages.list(f.worker).find(entry => entry.id === queued)?.message, 'Existing input');
  assert.equal(f.worker.submissions, 0);
  assert.equal(f.worker.operations, 0);
  assert.equal(f.worker.mutating, false);
  f.externalWorkers.delete(f.worker);
  assert.equal(f.pendingMessages.withdraw(f.worker, queued), true);
  await f.send('/init');
  assert.equal(f.sent.length, 1);
  assert.match(f.sent[0], /Mode: create/);
}));

test('actual IPC queue editing rejects bare init but preserves image and file attachment routing', () => fixture(async cwd => {
  const f = await submissionFixture(cwd);
  f.worker.busy = true;
  const plain = f.pendingMessages.enqueue(f.worker, 'plain', { message: 'plain' });
  await assert.rejects(f.edit(plain, '/init'), /当前任务结束/);
  assert.equal(f.pendingMessages.list(f.worker).find(entry => entry.id === plain)?.message, 'plain');
  for (const [payload, files] of [
    [{ message: 'with image', images: [{ type: 'image', data: 'fixture' }] }, []],
    [{ message: 'with file' }, [join(cwd, 'reference.txt')]],
  ] as const) {
    const id = f.pendingMessages.enqueue(f.worker, payload.message, payload, [...files]);
    await f.edit(id, '/init');
    const entry = f.pendingMessages.list(f.worker).find(entry => entry.id === id)!;
    assert.equal(entry.message, '/init');
    assert.equal(entry.attachmentCount, 1);
    assert.equal(entry.version, 1);
  }
}));

test('actual IPC handler reserves init before its asynchronous idle check and never queues it', () => fixture(async cwd => {
  const f = await submissionFixture(cwd);
  let release!: (state: unknown) => void;
  const state = new Promise(resolve => { release = resolve; });
  f.hold(() => state);
  const init = f.send('/init');
  assert.equal(f.worker.mutating, true);
  await assert.rejects(f.send('concurrent ordinary task'), /Session operation in progress/);
  await assert.rejects(f.send('/init'), /Session operation in progress/);
  release({ isStreaming: false });
  await init;
  assert.equal(f.sent.length, 1);
  assert.match(f.sent[0], /Mode: create/);
  assert.equal(f.pendingMessages.list(f.worker).length, 0);
  assert.equal(f.worker.submissions, 0);
  assert.equal(f.worker.mutating, false);
  f.worker.busy = true;
  await assert.rejects(f.send('/init'), /Stop this session/);
  assert.equal(f.worker.submissions, 0, 'A rejected idle check never decrements another submission');
  assert.equal(f.worker.mutating, false);
}));

test('actual IPC handler propagates execution read failures and releases all submission reservations', () => fixture(async cwd => {
  const f = await submissionFixture(cwd);
  await mkdir(join(cwd, 'AGENTS.md'));
  await assert.rejects(f.send('/init'), /regular project file/);
  assert.deepEqual(f.sent, []);
  assert.equal(f.worker.mutating, false);
  assert.equal(f.worker.submissions, 0);
  assert.equal(f.worker.operations, 0);
  await rm(join(cwd, 'AGENTS.md'), { recursive: true });
  await f.send('/init');
  assert.equal(f.sent.length, 1, 'The failed request does not block a subsequent retry');
}));
