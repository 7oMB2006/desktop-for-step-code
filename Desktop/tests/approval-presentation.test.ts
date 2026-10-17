import test from 'node:test';
import assert from 'node:assert/strict';
import { permissionApprovalPresentation, redactApprovalText } from '../src/approval-presentation';
import type { Message, UIRequest } from '../src/contracts';

const callId = 'permission-call-3d6009f9';
const summary = 'run_command command=powershell -NoProfile -Command Get-ChildItem...';
const uncertain = 'Shell command could not be fully analyzed (unsupported-shell); explicit approval is required.';
function request(reason = uncertain, kind = 'Approve', toolName = 'run_command'): UIRequest {
  return {
    type: 'extension_ui_request', method: 'confirm', id: 'ui-1', runtimeId: 'worker-1',
    title: `${kind} ${toolName} [${callId.slice(-8)}]`,
    message: `Call: ${callId}\n${reason}\n\n${summary}\n\nBatch calls may ask separately\nbefore approved tools begin running.`,
  };
}
function messages(input: unknown, id = callId, name = 'run_command'): Message[] {
  return [{ role: 'assistant', content: [{ type: 'toolCall', id, name, arguments: input }] }];
}

test('localizes incomplete analysis without calling the operation safe or dangerous', () => {
  const result = permissionApprovalPresentation(request(), [], 'zh', 'worker-1')!;
  assert.equal(result.category, 'uncertain');
  assert.equal(result.title, '批准执行命令');
  assert.equal(result.reasonCode, 'unsupported-shell');
  assert.match(result.reason, /分析器不支持/);
  assert.equal(result.input, summary);
  assert.equal(result.inputKind, 'summary');
  assert.equal(result.rawMessage, request().message);
});

test('recovers exact original command and all other parameters without truncation or reformatting', () => {
  const command = 'powershell -Command "\n' + 'Get-Content 中文.md\n'.repeat(60) + '"';
  const result = permissionApprovalPresentation(request(), messages({ command, run_in_background: true, timeout: 30 }), 'zh', 'worker-1')!;
  assert.equal(result.input, command);
  assert.equal(result.inputKind, 'command');
  assert.deepEqual(JSON.parse(result.otherParameters!), { run_in_background: true, timeout: 30 });
});

test('never uses the short suffix, a wrong tool, or another runtime to recover a command', () => {
  for (const history of [
    messages({ command: 'wrong' }, 'other-call-3d6009f9'),
    messages({ command: 'wrong' }, callId, 'powershell'),
  ]) assert.equal(permissionApprovalPresentation(request(), history, 'zh', 'worker-1')!.inputKind, 'summary');
  assert.equal(permissionApprovalPresentation(request(), messages({ command: 'wrong' }), 'zh', 'worker-2')!.inputKind, 'summary');
  assert.equal(permissionApprovalPresentation(request(), messages({ command: 'wrong' }), 'zh')!.inputKind, 'summary');
});

test('all known high-risk rules get a Chinese explanation and retain the original reason', () => {
  for (const rule of ['recursive-force-remove', 'system-lifecycle', 'format-filesystem', 'copy-device', 'truncate-device', 'destructive-git', 'destructive-sql', 'future-rule']) {
    const r = request(`Dangerous command requires confirmation (${rule}): ${summary}`, 'Dangerous');
    const result = permissionApprovalPresentation(r, [], 'zh', 'worker-1')!;
    assert.equal(result.category, 'hazardous');
    assert.equal(result.reasonCode, rule);
    assert.match(result.reason, /[\u4e00-\u9fff]/);
    assert.equal(result.rawMessage, r.message);
  }
});

test('ordinary writes keep their complete structured parameters and English locale works', () => {
  const r = request('write_file can modify the workspace or execute a command', 'Approve', 'write_file');
  const input = { path: 'note.md', content: '<img src=x onerror=alert(1)>\n原始内容' };
  const result = permissionApprovalPresentation(r, messages(input, callId, 'write_file'), 'en', 'worker-1')!;
  assert.equal(result.category, 'ordinary');
  assert.equal(result.title, 'Approve file changes');
  assert.equal(result.inputKind, 'parameters');
  assert.deepEqual(JSON.parse(result.input), input);
  assert.match(result.reason, /permission settings/);
});

test('fused file approvals preserve the complete embedded command, including blank lines and redaction', () => {
  const command = 'printf checked\n\nprintf second\nAPI_KEY=private-value printf safe';
  for (const name of ['write_file', 'edit_file']) {
    const r = request(`${name} can modify the workspace or execute a command\nthen_run: ${command}`, 'Approve', name);
    const input = { path: 'sample.txt', content: 'after', search: 'before', replace: 'after', then_run: command };
    const result = permissionApprovalPresentation(r, messages(input, callId, name), 'zh', 'worker-1')!;
    assert.equal(result.category, 'ordinary');
    assert.equal(result.target, 'sample.txt');
    assert.equal(result.preview, name === 'write_file' ? 'after' : '替换前\nbefore\n\n替换后\nafter');
    assert.match(result.verificationCommand!, /printf checked\n\nprintf second/);
    assert.doesNotMatch(JSON.stringify(result), /private-value/);
    const fallback = permissionApprovalPresentation(r, [], 'en', 'worker-2')!;
    assert.equal(fallback.inputKind, 'summary');
    assert.equal(fallback.verificationCommand, result.verificationCommand, 'the command comes from this request, not another runtime');
    assert.equal(fallback.target, undefined);
  }
});

test('embedded command policies retain hazardous, uncertain and explicit-confirm classifications', () => {
  for (const [reason, kind, category] of [
    ['Dangerous command requires confirmation (recursive-force-remove): run_command command=rm -rf ./empty', 'Dangerous', 'hazardous'],
    [uncertain, 'Approve', 'uncertain'],
    ['Policy override for run_command: confirm', 'Approve', 'ordinary'],
    ['run_command can modify the workspace or execute a command', 'Approve', 'ordinary'],
  ]) {
    const r = request(`then_run (run_command): ${reason}\nthen_run: printf checked`, kind, 'write_file');
    const result = permissionApprovalPresentation(r, [], 'zh', 'worker-1')!;
    assert.equal(result.category, category);
    assert.equal(result.verificationCommand, 'printf checked');
  }
  assert.equal(permissionApprovalPresentation(request(`unknown reason\nthen_run: printf checked`, 'Approve', 'write_file'), [], 'zh'), undefined);
  assert.equal(permissionApprovalPresentation(request(`${uncertain}\nthen_run: printf checked`), [], 'zh'), undefined);
  assert.equal(permissionApprovalPresentation(request(`${uncertain}\nunrecognized suffix`, 'Approve', 'write_file'), [], 'zh'), undefined);
});

test('redacts credentials from commands, summaries, raw details and auxiliary parameters', () => {
  const r = request('write_file can modify the workspace or execute a command', 'Approve', 'write_file');
  r.message = r.message!.replace(summary, 'write_file path=note.md Authorization: Bearer visible-token');
  const result = permissionApprovalPresentation(r, messages({
    path: 'note.md', content: 'safe', authorization: 'token-value', env: { API_KEY: 'secret-value', PATH: 'visible-path' },
    command: 'curl -H "Authorization: Bearer command-token" https://example.test?token=query-token',
  }, callId, 'write_file'), 'zh', 'worker-1')!;
  assert.match(result.input, /Bearer \[redacted\]/);
  assert.doesNotMatch(result.input, /command-token|query-token/);
  assert.match(result.otherParameters!, /"authorization": "\[redacted\]"/);
  assert.match(result.otherParameters!, /"API_KEY": "\[redacted\]"/);
  assert.match(result.otherParameters!, /"PATH": "\[redacted\]"/);
  assert.doesNotMatch(result.rawMessage, /visible-token/);
  assert.equal(redactApprovalText('api_key=raw-secret'), 'api_key=[redacted]');
});

test('handles CRLF and unknown analysis codes without inventing a risk classification', () => {
  const r = request(uncertain.replace('unsupported-shell', 'future-analysis'));
  r.message = r.message!.replace(/\n/g, '\r\n');
  const result = permissionApprovalPresentation(r, [], 'zh', 'worker-1')!;
  assert.equal(result.category, 'uncertain');
  assert.equal(result.reasonCode, 'future-analysis');
  assert.match(result.reason, /无法完整判断/);
});

test('unknown extensions and malformed or conflicting permission envelopes stay unchanged', () => {
  const variants: UIRequest[] = [
    { ...request(), method: 'select' },
    { ...request(), messageStyle: 'preformatted' },
    { ...request(), title: 'Confirm publishing?' },
    { ...request(), title: 'Approve run_command [wrong-id]' },
    { ...request(), message: request().message!.replace(`Call: ${callId}\n`, '') },
    request('Unrecognized upstream reason'),
    request(uncertain, 'Dangerous'),
    request(`Dangerous command requires confirmation (destructive-git): ${summary}`),
  ];
  for (const r of variants) assert.equal(permissionApprovalPresentation(r, [], 'zh', 'worker-1'), undefined);
  assert.equal(permissionApprovalPresentation(undefined, [], 'zh'), undefined);
});

test('describes a command from its exact arguments and preserves its working directory', () => {
  const result = permissionApprovalPresentation(request(), messages({
    command: 'npm install', cwd: 'D:\\项目', env: { TOKEN: 'private' },
  }), 'zh', 'worker-1')!;
  assert.equal(result.action, '执行以下命令');
  assert.equal(result.target, 'D:\\项目');
  assert.equal(result.preview, 'npm install');
  assert.doesNotMatch(JSON.stringify(result), /private/);
});

test('writes and edits describe actual paths and payloads, never invent a diff', () => {
  for (const name of ['write_file', 'edit_file']) {
    const r = request(`Policy override for ${name}: confirm`, 'Approve', name);
    const result = permissionApprovalPresentation(r, messages({
      path: 'README.md', content: 'new content', oldText: 'before', newText: 'after',
    }, callId, name), 'zh', 'worker-1')!;
    assert.equal(result.operation, 'file');
    assert.equal(result.target, 'README.md');
    assert.equal(result.preview, name === 'write_file' ? 'new content' : '替换前\nbefore\n\n替换后\nafter');
  }
  const r = request('Policy override for edit_file: confirm', 'Approve', 'edit_file');
  const unknown = permissionApprovalPresentation(r, messages({ path: 'README.md', patch: 'unknown' }, callId, 'edit_file'), 'zh', 'worker-1')!;
  assert.equal(unknown.preview, undefined);
});

test('question permissions preview the question without treating choices as approval actions', () => {
  const r = request('Policy override for clarify_user: confirm', 'Approve', 'clarify_user');
  const result = permissionApprovalPresentation(r, messages({
    question: '继续吗？', options: [{ label: '同意', description: '写入文件' }, null],
  }, callId, 'clarify_user'), 'zh', 'worker-1')!;
  assert.equal(result.operation, 'question');
  assert.equal(result.preview, '继续吗？');
  assert.deepEqual(result.choices, [{ label: '同意', description: '写入文件' }]);
  const wrongRuntime = permissionApprovalPresentation(r, messages({ question: 'wrong' }, callId, 'clarify_user'), 'zh', 'worker-2')!;
  assert.equal(wrongRuntime.preview, undefined);
});

test('group clarification permission previews questions without authorizing an answer', () => {
  const r = request('Policy override for clarify_user: confirm', 'Approve', 'clarify_user');
  const result = permissionApprovalPresentation(r, messages({
    questions: [{ question: 'Choose scope' }, { question: 'Choose format' }],
  }, callId, 'clarify_user'), 'zh', 'worker-1')!;
  assert.equal(result.operation, 'question');
  assert.equal(result.preview, '1. Choose scope\n2. Choose format');
  assert.equal(result.choices, undefined);
});

test('unknown tools retain their identity and redacted parameters, not an invented purpose', () => {
  const r = request('Policy override for mcp__service__publish: confirm', 'Approve', 'mcp__service__publish');
  const result = permissionApprovalPresentation(r, messages({
    url: 'https://example.test?token=private', authorization: 'hidden', task: 'publish',
  }, callId, 'mcp__service__publish'), 'zh', 'worker-1')!;
  assert.equal(result.action, '调用工具 mcp__service__publish');
  assert.equal(result.operation, 'tool');
  assert.doesNotMatch(JSON.stringify(result), /private|hidden/);
});

test('upstream batch edits preserve each replacement, including empty replacement text', () => {
  const r = request('Policy override for edit_file: confirm', 'Approve', 'edit_file');
  const result = permissionApprovalPresentation(r, messages({
    path: 'note.md', edits: [{ oldText: 'before', newText: '' }, { oldText: 'api_key=secret', newText: 'safe' }],
  }, callId, 'edit_file'), 'zh', 'worker-1')!;
  assert.equal(result.action, '修改文件 · 2 处替换');
  assert.match(result.preview!, /1\. 替换前\nbefore\n\n替换后\n/);
  assert.match(result.preview!, /2\. 替换前\napi_key=\[redacted\]/);
  assert.doesNotMatch(JSON.stringify(result), /secret/);
  const malformed = permissionApprovalPresentation(r, messages({
    path: 'note.md', edits: [{ oldText: 'before', newText: 'after' }, {}],
  }, callId, 'edit_file'), 'zh', 'worker-1')!;
  assert.equal(malformed.preview, undefined);
});

test('agent notes use only prose before the exact call in the same message and runtime', () => {
  const history: Message[] = [{ role: 'assistant', content: [
    { type: 'text', text: 'Other call explanation' },
    { type: 'toolCall', id: 'another-call', name: 'run_command', arguments: { command: 'wrong' } },
    { type: 'thinking', thinking: 'private reasoning' },
    { type: 'text', text: '统计 Markdown 文件。api_key=private-value' },
    { type: 'toolCall', id: callId, name: 'run_command', arguments: { command: 'Get-ChildItem *.md' } },
    { type: 'text', text: 'Later explanation' },
  ] }];
  const result = permissionApprovalPresentation(request(), history, 'zh', 'worker-1')!;
  assert.equal(result.agentNote, '统计 Markdown 文件。api_key=[redacted]');
  assert.doesNotMatch(JSON.stringify(result), /Other call explanation|private reasoning|private-value|Later explanation/);
  assert.equal(permissionApprovalPresentation(request(), history, 'zh', 'worker-2')!.agentNote, undefined);
});
