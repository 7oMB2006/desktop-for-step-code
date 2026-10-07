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
