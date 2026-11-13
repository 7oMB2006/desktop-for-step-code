import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { parsePluginConfirmations, validPluginConfirmationBinding } from '../electron/plugin-confirmation-contract.mjs';
import { PluginConfirmations, type PluginConfirmationRequest } from '../electron/plugin-confirmations';
import type { PluginConfirmationSource } from '../src/plugin-confirmations';

const binding = { id: 'test-bridge', installation: 'a'.repeat(64) };
const notice = { id: 'automatic-execution', version: '1', action: 'external.policy' as const, policy: 'remember' as const,
  title: 'Automatic execution', message: 'Files may be changed or deleted. Scope is not a sandbox.', confirmLabel: 'Acknowledge' };
const source = (): PluginConfirmationSource => ({ binding, name: 'Test bridge', revision: 'b'.repeat(64), confirmations: [notice] });
async function fixture(t: test.TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'dfsc-plugin-confirmations-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  let current = source(), allowed = true, remembered = true, calls = 0;
  const prompts: PluginConfirmationRequest[] = [];
  const gate = () => new PluginConfirmations(root, {
    resolve: async value => { assert.deepEqual(value, binding); return structuredClone(current); },
    confirm: async request => { prompts.push(request); return { confirmed: allowed, remember: remembered }; },
  });
  const input = () => ({ binding, agentId: 'agent-test', authorization: 'credential-and-directory-identity',
    action: 'external.policy' as const, scope: { cwd: '/project', days: null, categories: ['file'] },
    summary: 'Until manually revoked. Selected file approvals.',
    validate: async () => {}, execute: async () => ++calls });
  return { root, gate, input, prompts, current: () => current, replace: (value: PluginConfirmationSource) => { current = value; },
    allow: (value: boolean) => { allowed = value; }, remember: (value: boolean) => { remembered = value; },
    calls: () => calls };
}
test('declarations are bounded data, not scripts, capabilities or arbitrary interception hooks', () => {
  assert.deepEqual(parsePluginConfirmations([notice]), [notice]);
  for (const value of [null, [], Array(9).fill(notice), [notice, notice], [{ ...notice, action: 'shell.execute' }],
    [{ ...notice, script: 'return true' }], [{ ...notice, policy: 'auto-accept' }], [{ ...notice, message: '<x>\n' }],
    [{ ...notice, id: '../escape' }], [{ ...notice, id: ['coerced'] }], [{ ...notice, confirmLabel: 'x'.repeat(41) }],
    [{ ...notice, message: '\u202e reversed' }], [{ ...notice, version: '' }], [{ ...notice, title: ' ' }]])
    assert.throws(() => parsePluginConfirmations(value), /invalid-confirmation/);
  assert.equal(validPluginConfirmationBinding(binding), true);
  assert.equal(validPluginConfirmationBinding({ ...binding, token: 'secret' }), false);
  assert.equal(validPluginConfirmationBinding({ ...binding, installation: '../escape' }), false);
});
test('cancel and closed prompts never execute or remember the action', async t => {
  const f = await fixture(t), gate = f.gate();
  f.allow(false);
  await assert.rejects(gate.run(f.input()), /confirmation-cancelled/);
  assert.equal(f.calls(), 0);
  await assert.rejects(readFile(join(f.root, 'plugin-confirmations/acknowledgements.json')), { code: 'ENOENT' });
  f.allow(true); await gate.run(f.input());
  assert.equal(f.prompts.length, 2);
  assert.equal(f.calls(), 1);
});
test('remember persists across restart only for the exact package, risk, credentials and scope', async t => {
  const f = await fixture(t);
  await f.gate().run(f.input());
  await f.gate().run(f.input());
  assert.equal(f.prompts.length, 1);
  const file = await readFile(join(f.root, 'plugin-confirmations/acknowledgements.json'), 'utf8');
  assert.ok(!file.includes('/project') && !file.includes('credential-and-directory-identity'));
  await f.gate().run({ ...f.input(), scope: { cwd: '/project', days: 7, categories: ['file'] } });
  await f.gate().run({ ...f.input(), authorization: 'rotated-credential' });
  f.replace({ ...f.current(), revision: 'c'.repeat(64) }); await f.gate().run(f.input());
  f.replace({ ...f.current(), confirmations: [{ ...notice, version: '2' }] }); await f.gate().run(f.input());
  f.replace({ ...f.current(), confirmations: [{ ...notice, message: 'Changed without a version bump.' }] });
  await f.gate().run(f.input());
  assert.equal(f.prompts.length, 6);
});
test('always and unchecked remember never persist acknowledgement', async t => {
  const f = await fixture(t), gate = f.gate();
  f.remember(false); await gate.run(f.input()); await gate.run(f.input());
  assert.equal(f.prompts.length, 2);
  f.replace({ ...f.current(), confirmations: [{ ...notice, policy: 'always' }] });
  f.remember(true); await gate.run(f.input()); await gate.run(f.input());
  assert.equal(f.prompts.length, 4);
  await assert.rejects(readFile(join(f.root, 'plugin-confirmations/acknowledgements.json')), { code: 'ENOENT' });
});
test('revocation during confirmation invalidates even a later positive response', async t => {
  const f = await fixture(t);
  let gate: PluginConfirmations;
  gate = new PluginConfirmations(f.root, { resolve: async () => source(),
    confirm: async () => { gate.invalidate('agent-test'); return { confirmed: true, remember: true }; } });
  await assert.rejects(gate.run(f.input()), /revoked/);
  assert.equal(f.calls(), 0);
});
test('package or declaration changes while a prompt is open fail closed', async t => {
  const f = await fixture(t);
  const gate = new PluginConfirmations(f.root, { resolve: async () => structuredClone(f.current()),
    confirm: async () => {
      f.replace({ ...f.current(), revision: 'd'.repeat(64) });
      return { confirmed: true, remember: true };
    } });
  await assert.rejects(gate.run(f.input()), /confirmation-stale/);
  assert.equal(f.calls(), 0);
});
test('revocation remains visible during an asynchronous authorization commit', async t => {
  const f = await fixture(t), gate = f.gate();
  await assert.rejects(gate.run({ ...f.input(), execute: async valid => {
    await Promise.resolve();
    gate.invalidate('agent-test');
    assert.equal(valid(), false);
    throw new Error('connector:revoked');
  } }), /revoked/);
  assert.equal(f.calls(), 0);
});
test('removed, reinstalled or invalid plugins cannot become an unguarded action', async t => {
  const f = await fixture(t);
  const gate = new PluginConfirmations(f.root, { resolve: async () => { throw new Error('capability:stale'); },
    confirm: async () => { throw new Error('must not prompt'); } });
  await assert.rejects(gate.run(f.input()), /stale/);
  assert.equal(f.calls(), 0);
});
test('storage corruption blocks grants instead of silently forgetting required confirmation', async t => {
  const f = await fixture(t), gate = f.gate();
  await gate.run(f.input());
  await writeFile(join(f.root, 'plugin-confirmations/acknowledgements.json'), '{"version":1,"keys":["bad"]}');
  await assert.rejects(gate.run(f.input()), /storage/);
  assert.equal(f.calls(), 1);
});
test('concurrent grants cannot reuse one interactive decision; cancellation releases the gate', async t => {
  const f = await fixture(t);
  let release!: () => void, opened!: () => void;
  const ready = new Promise<void>(resolve => { opened = resolve; });
  const gate = new PluginConfirmations(f.root, { resolve: async () => source(), confirm: async () => {
    opened(); await new Promise<void>(resolve => { release = resolve; }); return { confirmed: false, remember: false };
  } });
  const first = gate.run(f.input());
  await ready;
  await assert.rejects(gate.run(f.input()), /confirmation-busy/);
  release(); await assert.rejects(first, /confirmation-cancelled/);
  assert.equal(f.calls(), 0);
  assert.equal(await gate.run({ ...f.input(), binding: undefined }), 1);
});
test('unrelated actions and generic connections are not intercepted, but still validate authority', async t => {
  const f = await fixture(t), gate = f.gate();
  await gate.run({ ...f.input(), action: 'external.delegate' });
  await gate.run({ ...f.input(), binding: undefined });
  await assert.rejects(gate.run({ ...f.input(), binding: undefined,
    validate: async () => { throw new Error('revoked'); } }), /revoked/);
  assert.equal(f.calls(), 2);
  assert.equal(f.prompts.length, 0);
});
