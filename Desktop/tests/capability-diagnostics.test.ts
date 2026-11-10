import test from 'node:test';
import assert from 'node:assert/strict';
import { capabilityFailureCode } from '../electron/capability-failure.mjs';
import { diagnoseCapabilityMutation, type CapabilityPhase } from '../electron/capability-diagnostics';
import { crashDetails } from '../electron/crash-log-format';
import { capabilityErrorText, capabilityWarningText } from '../src/capability-errors';
import { SessionRuntimes, type WorkerTransport, type SessionRuntime } from '../electron/session-runtimes';

test('capability failures preserve known codes without leaking raw system errors', () => {
  for (const [system, expected] of [
    ['EACCES', 'access-denied'], ['EPERM', 'operation-denied'], ['EBUSY', 'file-in-use'],
    ['ENOTEMPTY', 'directory-not-empty'], ['ENOENT', 'not-found'],
  ]) assert.equal(capabilityFailureCode(Object.assign(new Error('private-file-name'), { code: system })), expected);
  assert.equal(capabilityFailureCode(new Error('capability:resource-in-use')), 'resource-in-use');
  assert.equal(capabilityFailureCode({ code: 'stale-configuration' }), 'stale-configuration');
  assert.equal(capabilityFailureCode(new Error('token=private-token')), 'operation-failed');
  assert.equal(capabilityFailureCode(new Error('capability:private-token')), 'operation-failed');
  assert.equal(capabilityFailureCode({ code: 'private-token' }), 'operation-failed');
});

test('dispatch locks and disconnected runtime errors have distinct stable codes', () => {
  for (const [message, expected] of [
    ['Shared settings operation in progress', 'busy'],
    ['Undo in progress', 'busy'],
    ['Workspace operation in progress', 'workspace-busy'],
    ['Runtime is not connected', 'runtime-unavailable'],
    ['Runtime timed out: get_state', 'runtime-unavailable'],
  ]) assert.equal(capabilityFailureCode(new Error(message)), expected);
});

test('diagnostics record the action and failure phase, not input, paths, URLs or raw errors', async () => {
  const records: unknown[] = [];
  await assert.rejects(diagnoseCapabilityMutation('capabilityMutate', {
    action: 'marketplace-remove', name: 'private-market-name',
    source: 'https://user:private-password@example.invalid/?token=private-token',
  }, async mark => {
    mark('mutation');
    throw Object.assign(new Error('EPERM C:\\private\\directory private-token'), { code: 'EPERM' });
  }, async (error, details) => { records.push({ message: error.message, ...details }); }), error => {
    assert.match(String(error), /capability:operation-denied; diagnostic:[a-f0-9]{12}/);
    const id = /\bdiagnostic:([a-f0-9]{12})/u.exec(String(error))![1];
    assert.equal((records[0] as { diagnosticId: string }).diagnosticId, id);
    return true;
  });
  assert.equal((records[0] as { operationPhase: CapabilityPhase }).operationPhase, 'mutation');
  assert.equal((records[0] as { action: string }).action, 'marketplace-remove');
  assert.doesNotMatch(JSON.stringify(records), /private|example\.invalid|password|token=/);
});

test('untrusted action names and diagnostic writer failure cannot permit a denied operation', async () => {
  let recordedAction: unknown;
  await assert.rejects(diagnoseCapabilityMutation('capabilityMutate', { action: 'secret-input' }, async () => {
    throw new Error('Shared settings operation in progress');
  }, async (_error, details) => {
    recordedAction = details.action;
    throw new Error('Diagnostic storage failed');
  }), /capability:busy; diagnostic:[a-f0-9]{12}/);
  assert.equal(recordedAction, 'unknown');
});

test('successful mutations and unrelated IPC retain their existing results and errors', async () => {
  let writes = 0;
  const writer = async () => { writes++; };
  const result = { warnings: [] };
  assert.equal(await diagnoseCapabilityMutation('capabilityMutate', {}, async () => result, writer), result);
  const original = new Error('Unrelated command');
  await assert.rejects(diagnoseCapabilityMutation('snapshot', {}, async () => { throw original; }, writer),
    error => error === original);
  assert.equal(writes, 0);
});

test('Git diagnostics retain validated numeric fields, never raw output or caller details', async () => {
  const records: unknown[] = [];
  await assert.rejects(diagnoseCapabilityMutation('capabilityMutate', { action: 'marketplace-update' }, async mark => {
    mark('mutation');
    throw Object.assign(new Error('capability:marketplace-network'), { details: {
      operation: 'marketplace-refresh', elapsedMs: 120, gitExitCode: 128, gitSignal: null, gitSystemCode: null,
      stderr: 'private-password', source: 'C:\\private\\directory', env: { TOKEN: 'private-token' },
    } });
  }, async (error, details) => { records.push({ error: error.message, ...details }); }),
  /capability:marketplace-network; diagnostic:[a-f0-9]{12}/);
  assert.deepEqual(records[0], {
    error: 'capability:marketplace-network',
    diagnosticId: (records[0] as { diagnosticId: string }).diagnosticId,
    action: 'marketplace-update', operationPhase: 'mutation', code: 'marketplace-network',
    operation: 'marketplace-refresh', elapsedMs: 120, gitExitCode: 128, gitSignal: null, gitSystemCode: null,
  });
  assert.doesNotMatch(JSON.stringify(records), /private|TOKEN|stderr|env/);
});

test('main crash-log redaction preserves correlated Git diagnostics without private payloads', async () => {
  let log = '', diagnosticId = '';
  const details = {
    operation: 'marketplace-refresh', elapsedMs: 313, gitExitCode: 1, gitSignal: null, gitSystemCode: null,
    stderr: 'Bearer private-token', source: 'https://user:private-password@example.invalid',
  };
  await assert.rejects(diagnoseCapabilityMutation('capabilityMutate', { action: 'marketplace-update' }, async mark => {
    mark('mutation');
    throw Object.assign(new Error('capability:marketplace-network'), { details });
  }, async (_error, safeDetails) => {
    diagnosticId = safeDetails.diagnosticId;
    log = crashDetails(safeDetails).join('\n');
  }), error => String(error).includes(`diagnostic:${diagnosticId}`));
  assert.match(log, new RegExp(`diagnosticId: ${diagnosticId}`));
  assert.match(log, /operationPhase: mutation/);
  assert.match(log, /code: marketplace-network/);
  assert.match(log, /elapsedMs: 313/);
  assert.match(log, /gitExitCode: 1/);
  assert.doesNotMatch(log, /private|Bearer|stderr|source|example\.invalid/);
  assert.equal(details.stderr, 'Bearer private-token');
});

test('partial update checks log each failure and replace internal payloads with diagnostic IDs', async () => {
  const records: unknown[] = [];
  const result = await diagnoseCapabilityMutation('capabilityMutate', { action: 'plugin-check-updates' }, async mark => {
    mark('mutation');
    return { warnings: ['ordinary warning'], failures: [
      { code: 'marketplace-dns', details: {
        operation: 'marketplace-refresh', elapsedMs: 30, gitExitCode: 128, gitSignal: null, gitSystemCode: null,
        stderr: 'private-output',
      } },
      { code: 'marketplace-locked', source: 'private-source' },
    ] };
  }, async (error, details) => { records.push({ error: error.message, ...details }); });
  assert.equal(records.length, 2);
  assert.equal(result.warnings.length, 3);
  assert.equal(result.warnings[0], 'ordinary warning');
  assert.match(result.warnings[1], /^capability:marketplace-dns; diagnostic:[a-f0-9]{12}$/);
  assert.match(result.warnings[2], /^capability:marketplace-locked; diagnostic:[a-f0-9]{12}$/);
  assert.equal('failures' in result, false);
  assert.doesNotMatch(JSON.stringify(result) + JSON.stringify(records), /private|stderr/);
  assert.equal((records[0] as { diagnosticId: string }).diagnosticId, result.warnings[1].split('diagnostic:')[1]);
});

test('a failed diagnostic writer cannot hide partial refresh failures', async () => {
  const result = await diagnoseCapabilityMutation('capabilityMutate', { action: 'plugin-check-updates' },
    async () => ({ warnings: [], failures: [{ code: 'marketplace-git-missing' }] }),
    async () => { throw new Error('disk unavailable'); });
  assert.match(result.warnings[0], /^capability:marketplace-git-missing; diagnostic:[a-f0-9]{12}$/);
  assert.equal('failures' in result, false);
});

test('Chinese and English error text is bounded and retains a validated diagnostic ID', () => {
  const error = new Error("Error invoking remote method 'desktop': Error: capability:background-active; diagnostic:012345abcdef");
  assert.match(capabilityErrorText(error, true), /后台代理/);
  assert.match(capabilityErrorText(error, true), /诊断编号：012345abcdef/);
  assert.match(capabilityErrorText(error, false), /background agents/);
  assert.doesNotMatch(capabilityErrorText(error, false), /Error invoking/);
  assert.doesNotMatch(capabilityErrorText(new Error('secret-value diagnostic:not-an-id'), true), /secret-value|not-an-id/);
  assert.match(capabilityErrorText(new Error('capability:resource-in-use'), true), /插件仍被会话占用/);
  assert.match(capabilityWarningText('capability:marketplace-dns; diagnostic:012345abcdef', true), /DNS.*诊断编号：012345abcdef/);
  assert.match(capabilityWarningText('capability:marketplace-git-missing; diagnostic:012345abcdef', false), /could not find Git.*Diagnostic ID: 012345abcdef/);
  assert.equal(capabilityWarningText('ordinary warning', true), 'ordinary warning');
  for (const code of ['host-unavailable', 'invalid-host-declaration', 'host-selection-incomplete']) {
    const error = new Error(`capability:${code}; diagnostic:012345abcdef`);
    assert.match(capabilityErrorText(error, true), /宿主|声明|模式/);
    assert.match(capabilityErrorText(error, true), /诊断编号：012345abcdef/);
    assert.match(capabilityErrorText(error, false), /host|declaration|mode/);
    assert.match(capabilityErrorText(error, false), /Diagnostic ID: 012345abcdef/);
  }
});

class Transport implements WorkerTransport {
  stopped = false;
  start() {}
  async request(type: string): Promise<any> {
    if (type === 'get_state') return { sessionId: 'diagnostic-session', isStreaming: false };
    if (type === 'get_available_models') return { models: [] };
    if (type === 'get_messages') return { messages: [] };
    return {};
  }
  respond() {}
  async stop() { this.stopped = true; }
}

const guards: [string, (worker: SessionRuntime) => void][] = [
  ['session-busy', worker => { worker.mutating = true; }],
  ['session-busy', worker => { worker.busy = true; }],
  ['messages-queued', worker => { worker.queued = true; }],
  ['remote-attached', worker => { worker.remoteAttached = true; }],
  ['side-question-active', worker => { worker.btwActive = true; }],
  ['background-active', worker => {
    worker.backgroundActive = true;
    worker.backgroundLanes = [{ id: 'lane_12345678', status: 'running' }];
  }],
  ['goal-active', worker => {
    worker.launch!.goal = { status: 'active', objective: 'fixture', id: 'goal', sessionId: 'diagnostic-session',
      tokensUsed: 0, timeUsedSeconds: 0, iteration: 1, createdAt: '', updatedAt: '' };
  }],
];
for (const action of ['plugin-remove', 'plugin-update']) {
  for (const [index, [expected, setGuard]] of guards.entries()) {
    test(`${action} retains native guard ${index + 1} and reports ${expected}`, async () => {
      const transport = new Transport();
      const pool = new SessionRuntimes(() => {}, () => transport);
      try {
        const worker = await pool.open('node', 'step', 'fixture-workspace', {});
        setGuard(worker);
        let deleted = false;
        let phase: unknown;
        await assert.rejects(diagnoseCapabilityMutation('capabilityMutate', { action }, async mark => {
          mark('idle-check');
          await pool.assertAllIdle({ stopHost: false });
          deleted = true;
        }, async (_error, details) => { phase = details.operationPhase; }), new RegExp(`capability:${expected}; diagnostic:`));
        assert.equal(deleted, false);
        assert.equal(phase, 'idle-check');
        assert.equal(transport.stopped, false);
      } finally { await pool.stopAll(); }
    });
  }
}
