import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SessionImports, importedProjectDirectory, importEnvironment, importScanOptions, importSelections, importStartOptions } from '../electron/session-import';
import { importedHistoryMessages } from '../electron/imported-history';
import { messagesWithEntryIds } from '../electron/session-branching';
import { responsePresentation } from '../src/conversation-presentation';
import { groupConsecutiveTools } from '../src/tool-groups';
import { approvedPlan } from '../src/plan-execution';
import { turnChanges } from '../src/turn-changes';
import { turnOutputPaths } from '../src/turn-artifacts';
import { workflowsFromMessages } from '../src/workflow-state';
import { JsonLines } from '../electron/runtime';
import type { Message } from '../src/contracts';

test('offline importer inherits only system paths and explicit discovery roots, never provider credentials', () => {
  const env = importEnvironment('D:/isolated', {
    SystemRoot: 'C:/Windows', Path: 'system-path', USERPROFILE: 'C:/source-user',
    CODEX_HOME: 'D:/codex-source', CLAUDE_CONFIG_DIR: 'D:/claude-source',
    GH_TOKEN: 'private', AWS_ACCESS_KEY_ID: 'private', OPENAI_API_KEY: 'private',
    HTTP_PROXY: 'http://private:password@proxy', NODE_OPTIONS: '--import=private',
    STEP_CODING_AGENT_DIR: 'personal-profile',
  });
  assert.equal(env.SystemRoot, 'C:/Windows');
  assert.equal(env.Path, 'system-path');
  assert.equal(env.CODEX_HOME, 'D:/codex-source');
  assert.equal(env.CLAUDE_CONFIG_DIR, 'D:/claude-source');
  assert.equal(env.STEP_CODING_AGENT_DIR, 'D:/isolated/agent');
  assert.ok(!Object.values(env).some(value => value?.includes('private')));
});

test('source options allow bounded directories, not credentials or arbitrary operations', () => {
  assert.deepEqual(importScanOptions({}), {});
  assert.deepEqual(importScanOptions({ codexRoot: process.cwd(), includeArchived: false }), { codexRoot: process.cwd(), includeArchived: false });
  for (const input of [undefined, [], { codexRoot: '../profile' }, { claudeRoot: '\0' }, { includeArchived: 'yes' }, { apiKey: 'secret' }])
    assert.throws(() => importScanOptions(input));
});

test('import selections require unique reviewed snapshots and absolute destinations', () => {
  const selection = { candidateId: 'opaque', fingerprint: 'a'.repeat(64), cwd: process.cwd() };
  assert.deepEqual(importSelections([selection]), [selection]);
  assert.deepEqual(importSelections([{ ...selection, credential: 'must-not-forward' }]), [selection]);
  for (const input of [[], Array(101).fill(selection), [selection, selection], [{ ...selection, fingerprint: '' }], [{ ...selection, cwd: '../project' }], [null]])
    assert.throws(() => importSelections(input));
});

test('a terminal importer event received with the start reply cannot leave the host busy', async () => {
  const host = new SessionImports('', '', '', () => {});
  const job = { id: 'job', status: 'running', results: [], total: 1, createdAt: new Date().toISOString() };
  Object.assign(host, { rpc: { hasPendingRequests: false, request: async () => {
    Object.assign(host, { running: false });
    return job;
  } } });
  await host.start([{ candidateId: 'one', fingerprint: 'a'.repeat(64), cwd: process.cwd() }]);
  assert.equal(host.busy, false);
});

test('a rejected start reconciles busy state without forgetting other live batches', async () => {
  for (const running of [false, true]) {
    const host = new SessionImports('', '', '', () => {});
    Object.assign(host, { rpc: { hasPendingRequests: false, request: async (type: string) => {
      if (type === 'start') throw new Error('expired preview');
      return running ? [{ status: 'running' }] : [];
    } } });
    await assert.rejects(host.start([{ candidateId: 'one', fingerprint: 'a'.repeat(64), cwd: process.cwd() }]), /expired preview/);
    assert.equal(host.busy, running);
  }
});

test('native messages keep the existing projection by identity', () => {
  const messages: Message[] = [{ role: 'assistant', content: 'native' }];
  assert.equal(importedHistoryMessages(messages, [], null), messages);
});

test('project grouping is an explicit validated opt-in at the bridge boundary', () => {
  assert.deepEqual(importStartOptions(undefined), { addProjects: false });
  assert.deepEqual(importStartOptions({ addProjects: true }), { addProjects: true });
  for (const value of [null, [], {}, { addProjects: 'true' }, { addProjects: true, cwd: 'extra' }])
    assert.throws(() => importStartOptions(value));
});

test('grouping reads the saved native directory, not the new selection or foreign source body', async () => {
  const root = await mkdtemp(join(tmpdir(), 'import-project-header-'));
  const id = '12345678-1234-4234-a234-123456789012';
  try {
    await mkdir(join(root, 'sessions', 'imported'), { recursive: true });
    const file = join(root, 'sessions', 'imported', `${id}.jsonl`);
    await writeFile(file, JSON.stringify({ type: 'session', id, cwd: process.cwd() }) + '\n' + 'not JSON'.repeat(100_000));
    assert.equal(await importedProjectDirectory(root, id), process.cwd());
    await assert.rejects(importedProjectDirectory(root, '../outside'));
    await writeFile(file, JSON.stringify({ type: 'session', id, cwd: '../relative' }) + '\n');
    await assert.rejects(importedProjectDirectory(root, id));
    await writeFile(file, 'x'.repeat(70_000) + '\n');
    await assert.rejects(importedProjectDirectory(root, id), /header/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('only saved import results register projects; repeated polling is idempotent', async () => {
  for (const addProjects of [false, true]) {
    const added: string[][] = [];
    let job: any = { id: 'batch', status: 'running', results: [], total: 4 };
    const host = new SessionImports('', '', '', () => {}, async paths => { added.push(paths); });
    Object.assign(host, { rpc: { request: async (method: string) => method === 'start' ? job : [job] } });
    const selections = ['saved', 'skipped', 'failed', 'unprocessed'].map(candidateId =>
      ({ candidateId, fingerprint: 'a'.repeat(64), cwd: process.cwd() }));
    await host.start(selections, { addProjects });
    assert.deepEqual(added, [], 'preparation/start alone never adds a project');
    job = { ...job, status: 'cancelled', results: [
      { candidateId: 'saved', status: 'imported', sessionId: 'native-copy' },
      { candidateId: 'skipped', status: 'skipped', sessionId: 'native-copy' },
      { candidateId: 'failed', status: 'failed' },
    ] };
    await Promise.all([host.jobs(), host.jobs()]);
    assert.deepEqual(added, addProjects ? [['native-copy']] : []);
  }
});

test('grouping uses saved session identities and retries persistence without starting another import', async () => {
  let writes = 0;
  let starts = 0;
  const destination = process.cwd();
  const job = { id: 'saved', status: 'completed', results: [{ candidateId: 'one', status: 'skipped', sessionId: 'original-copy' }] };
  const host = new SessionImports('', '', '', () => {}, async sessionIds => {
    assert.deepEqual(sessionIds, ['original-copy']);
    if (++writes === 1) throw new Error('temporary preference write failure');
  });
  Object.assign(host, { rpc: { request: async (method: string) => {
    if (method === 'start') { starts++; return job; }
    return [job];
  } } });
  assert.equal((await host.start([{ candidateId: 'one', fingerprint: 'a'.repeat(64), cwd: destination }],
    { addProjects: true })).id, job.id);
  await host.jobs();
  await host.jobs();
  assert.equal(writes, 2);
  assert.equal(starts, 1);
});

test('historical transcript uses raw active-path records, with usage stripped and tools marked historical', () => {
  const provenance = { source: 'codex', sessionId: 'source', itemId: 'one' };
  const raw: Message = { role: 'assistant', content: [{ type: 'toolCall', name: 'write_file', id: 'call', arguments: { path: 'result.html' } }],
    provider: 'codex', model: 'historical', usage: { input: 100, output: 20, cacheRead: 0, cacheWrite: 0 } };
  const entries = [
    { id: 'user', parentId: null, type: 'message', imported: provenance, message: { role: 'user', content: 'source question' } },
    { id: 'call', parentId: 'user', type: 'message', imported: provenance, message: raw },
    { id: 'result', parentId: 'call', type: 'message', imported: provenance,
      message: { role: 'toolResult', toolName: 'write_file', toolCallId: 'call', content: 'old result', details: { importedStatus: 'unknown' } } },
    { id: 'other', parentId: 'user', type: 'message', imported: provenance, message: { role: 'assistant', content: 'wrong branch' } },
    { id: 'native', parentId: 'result', type: 'message', message: { role: 'assistant', content: 'new answer', model: 'current', usage: raw.usage } },
  ];
  const displayed = importedHistoryMessages([{ role: 'user', content: 'model-only projection' }], entries, 'native');
  assert.equal(displayed.length, 4);
  assert.equal(displayed[1].usage, undefined);
  assert.equal(displayed[1].desktopImported, true);
  assert.equal(Array.isArray(displayed[1].content) && displayed[1].content[0].historical, true);
  assert.equal(displayed[2].details?.importedStatus, 'unknown');
  assert.notEqual(displayed[2].toolCallId, 'call');
  assert.equal(Array.isArray(displayed[1].content) && displayed[1].content[0].id, displayed[2].toolCallId);
  assert.equal(Array.isArray(raw.content) && raw.content[0].id, 'call', 'source records remain unchanged');
  assert.equal(displayed[3].usage, raw.usage);
  assert.equal(displayed[3].desktopImported, undefined);
  assert.ok(!JSON.stringify(displayed).includes('wrong branch'));
  assert.deepEqual(raw.usage, { input: 100, output: 20, cacheRead: 0, cacheWrite: 0 });
  const items = displayed.map((message, index) => ({ message, index }));
  assert.deepEqual(turnOutputPaths(items), []);
  assert.deepEqual(turnChanges(items).files, []);
  const content = responsePresentation(items).content;
  assert.ok(!groupConsecutiveTools(content, false).some(item => item.type === 'tool-group'));
});

test('imported Plan/Workflow records cannot become native live task state', () => {
  assert.equal(approvedPlan({ role: 'toolResult', content: 'approved', toolName: 'exit_plan_mode', desktopImported: true }), undefined);
  assert.deepEqual(workflowsFromMessages([{ role: 'assistant', desktopImported: true,
    content: [{ type: 'toolCall', name: 'workflow', id: 'old-workflow', arguments: { name: 'foreign' } }] }], true), []);
});

test('foreign tool IDs cannot pair with a new native result or contribute current receipts', () => {
  const importedCall: Message = { role: 'assistant', desktopImported: true, content: [{
    type: 'toolCall', id: 'shared', name: 'write_file', arguments: { path: 'foreign.html', content: 'old' },
  }] };
  const result: Message = { role: 'toolResult', toolCallId: 'shared', toolName: 'write_file', content: 'saved' };
  const items = [importedCall, result].map((message, index) => ({ message, index }));
  assert.deepEqual(turnChanges(items).files, []);
  assert.deepEqual(turnOutputPaths(items), []);
  const workflow: Message = { role: 'assistant', content: [{ type: 'toolCall', id: 'shared', name: 'workflow', arguments: {} }] };
  const oldResult: Message = { role: 'toolResult', desktopImported: true, toolCallId: 'shared', toolName: 'workflow', content: 'old' };
  assert.equal(workflowsFromMessages([workflow, oldResult])[0].status, 'running');
});

test('entry ids on imported native continuations remain matchable', () => {
  const messages: Message[] = [{ role: 'user', content: 'continue', timestamp: 123 }];
  const entries = [{ type: 'message', id: 'native-user', parentId: null, message: messages[0] }];
  assert.equal(messagesWithEntryIds(messages, entries, 'native-user')[0].entryId, 'native-user');
});

test('larger history frames remain bounded without raising the default management limit', () => {
  const line = JSON.stringify({ content: 'x'.repeat(33 * 1024 * 1024) }) + '\n';
  assert.throws(() => new JsonLines(() => {}).push(Buffer.from(line)), /32 MiB/);
  const messages: unknown[] = [];
  const decoder = new JsonLines(value => messages.push(value), 256 * 1024 * 1024);
  const bytes = Buffer.from(line);
  for (let offset = 0; offset < bytes.length; offset += 1024 * 1024) decoder.push(bytes.subarray(offset, offset + 1024 * 1024));
  assert.equal((messages[0] as { content: string }).content.length, 33 * 1024 * 1024);
  assert.throws(() => new JsonLines(() => {}, 10).push(Buffer.from('{"too":"large"}\n')), /Runtime record exceeds/);
});
