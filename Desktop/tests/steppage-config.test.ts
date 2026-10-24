import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
// @ts-expect-error Node ESM adapter is staged verbatim beside admin.mjs.
import { reconcileStepPageServers, prepareStepPageServers, STEPPAGE_SERVER as name } from '../electron/steppage-config.mjs';

const nodePath = 'D:\\New App\\runtime\\node\\node.exe';
const bundlePath = 'D:\\Home\\.steppage-mcp\\bin\\steppage-mcp.mjs';
const options = { nodePath, bundlePath, bundleExists: true, platform: 'win32' };
const managed = (extra = {}) => ({
  command: 'C:\\Old App\\runtime\\node\\node.exe', args: [bundlePath], enabled: true, ...extra,
});
const reconcile = (servers: Record<string, unknown>, extra = {}) => reconcileStepPageServers(servers, { ...options, ...extra });

test('StepPage fresh registration uses the upstream qualified identity and is idempotent', () => {
  const first = reconcile({});
  assert.deepEqual(first, { [name]: { command: nodePath, args: [bundlePath], enabled: true } });
  assert.deepEqual(reconcile(first), first);
  assert.deepEqual(reconcile({}, { bundleExists: false }), {});
});
test('StepPage migrates complete legacy declarations without changing custom transport or secrets', () => {
  for (const transport of [{ command: 'user-command', args: ['--custom', 'x'] }, { url: 'https://example.invalid/mcp' }]) {
    const custom = { ...transport, enabled: false, cwd: 'D:\\Project', env: { PRIVATE_KEY: 'fixture-only' },
      http_headers: { Authorization: 'fixture-only' }, disabled_tools: ['publish'], startup_timeout_sec: 42 };
    const input = { steppage: custom, other: { enabled: false } };
    const before = structuredClone(input);
    assert.deepEqual(reconcile(input), { [name]: custom, other: input.other });
    assert.deepEqual(input, before, 'Do not mutate the caller or its secret-bearing declaration');
    assert.deepEqual(reconcile(input, { bundleExists: false }), { [name]: custom, other: input.other });
  }
});
test('StepPage stale paths keep disabled intent and every non-transport field', () => {
  const source = managed({ enabled: false, env: { KEEP: 'fixture' }, enabled_tools: ['read'], tool_timeout_sec: 15 });
  const out = reconcile({ steppage: source });
  assert.deepEqual(out[name], { ...source, command: nodePath });
  assert.equal(out.steppage, undefined);
  assert.deepEqual(reconcile(out), out);
  assert.deepEqual(reconcile({ [name]: source })[name], out[name]);
});
test('StepPage only repairs the exact Desktop bundle launch shape, not arbitrary runtime-node commands', () => {
  for (const args of [['D:\\User\\custom.mjs'], [bundlePath, '--custom'], []]) {
    const custom = managed({ args, enabled: false });
    assert.deepEqual(reconcile({ [name]: custom }), { [name]: custom });
  }
  const custom = { command: 'D:\\User\\node.exe', args: [bundlePath], enabled: false };
  assert.deepEqual(reconcile({ [name]: custom }), { [name]: custom });
});
test('StepPage canonical declaration wins over the obsolete managed alias without merging old secrets', () => {
  const canonical = { command: 'my-command', args: ['--safe'], enabled: false };
  const out = reconcile({ steppage: managed({ env: { OLD: 'fixture' } }), [name]: canonical });
  assert.deepEqual(out, { [name]: canonical });
  assert.deepEqual(reconcile({ steppage: managed(), [name]: { enabled: false } }), { [name]: { enabled: false } });
  const enabled = { command: 'my-command', args: ['--safe'], enabled: true };
  assert.deepEqual(reconcile({ steppage: managed({ enabled: false }), [name]: enabled }),
    { [name]: { ...enabled, enabled: false } }, 'Removing a managed alias must not undo its explicit disable');
});
test('StepPage conflicting user-owned aliases are not deleted or silently disabled', () => {
  const input = { steppage: { command: 'custom-a', args: [], enabled: false }, [name]: { command: 'custom-b', args: [] } };
  assert.deepEqual(reconcile(input), input);
});
test('StepPage a missing bundle never enables, replaces or removes existing launch configuration', () => {
  const source = managed({ enabled: false });
  assert.deepEqual(reconcile({ [name]: source }, { bundleExists: false }), { [name]: source });
  const missing = reconcile({}, { bundleExists: false });
  assert.ok(!Object.hasOwn(missing, name));
  const retry = reconcile(missing);
  assert.equal(retry[name].command, nodePath);
  assert.deepEqual(reconcile(retry), retry);
});
test('StepPage relocation repairs both managed paths but preserves launch arguments customized by the user', () => {
  const old = managed({ args: ['C:\\Old Home\\.steppage-mcp\\bin\\steppage-mcp.mjs'], enabled: false });
  assert.deepEqual(reconcile({ [name]: old })[name], { ...old, command: nodePath, args: [bundlePath] });
  const relative = managed({ args: ['.steppage-mcp\\bin\\steppage-mcp.mjs'] });
  assert.deepEqual(reconcile({ [name]: relative })[name], relative);
});
test('StepPage macOS paths use the same migration without Windows case folding', () => {
  const source = { command: '/old/runtime/node/node', args: ['/home/.steppage-mcp/bin/steppage-mcp.mjs'], enabled: false };
  const out = reconcile({ steppage: source }, { platform: 'darwin', nodePath: '/new/runtime/node/node', bundlePath: '/home/.steppage-mcp/bin/steppage-mcp.mjs' });
  assert.deepEqual(out[name], { ...source, command: '/new/runtime/node/node' });
});
test('StepPage configuration reconciliation uses the isolated admin lock and is shipped with staging', async () => {
  const admin = await readFile(new URL('../electron/admin.mjs', import.meta.url), 'utf8');
  const stage = await readFile(new URL('../scripts/stage-runtime.mjs', import.meta.url), 'utf8');
  assert.match(admin, /case 'reconcile_steppage':/);
  assert.match(admin, /updateGlobalMcpConfig\(process\.env, servers => reconcile\(servers/);
  assert.match(stage, /cp\('electron\/steppage-config\.mjs', join\(runtime, 'steppage-config\.mjs'\)\)/);
});
test('StepPage preparation preserves disables and secrets, refuses custom transports', () => {
  const homePath = 'D:\\Desktop\\step-runtime\\steppage\\home';
  const out = prepareStepPageServers({ [name]: { enabled: false } }, { ...options, homePath });
  assert.equal(out[name].enabled, false);
  assert.deepEqual(out[name].env, { HOME: homePath, USERPROFILE: homePath });
  const disabled = managed({ enabled: false, env: { MY_KEY: 'fixture' }, tool_timeout_sec: 42 });
  const migrated = prepareStepPageServers({ steppage: disabled }, { ...options, homePath });
  assert.equal(migrated[name].enabled, false);
  assert.equal(migrated[name].env.MY_KEY, 'fixture');
  assert.equal(migrated[name].tool_timeout_sec, 42);
  for (const server of [{ command: 'user-command', args: [] }, { url: 'https://example.invalid' }, { enabled: false, env: { X: 'fixture' } }]) {
    assert.throws(() => prepareStepPageServers({ [name]: server }, options), /custom configuration/);
  }
});
test('Desktop-owned StepPage relocation repairs its home without overwriting custom environment paths', () => {
  const oldBundle = 'C:\\Old\\step-runtime\\steppage\\bin\\steppage-mcp.mjs';
  const oldHome = 'C:\\Old\\step-runtime\\steppage\\home';
  const newBundle = 'D:\\New\\step-runtime\\steppage\\bin\\steppage-mcp.mjs';
  const newHome = 'D:\\New\\step-runtime\\steppage\\home';
  const previous = managed({ args: [oldBundle], enabled: false, env: { HOME: oldHome, USERPROFILE: oldHome, KEEP: 'fixture' } });
  const migrated = reconcile({ [name]: previous }, { bundlePath: newBundle, homePath: newHome })[name];
  assert.deepEqual(migrated, { ...previous, command: nodePath, args: [newBundle], env: { HOME: newHome, USERPROFILE: newHome, KEEP: 'fixture' } });
  const custom = { ...previous, env: { HOME: 'D:\\Custom Home', USERPROFILE: 'D:\\Custom Home' } };
  assert.deepEqual(reconcile({ [name]: custom }, { bundlePath: newBundle, homePath: newHome })[name].env, custom.env);
});
test('rejected Desktop bundles disable only their managed declarations and stay disabled after repair', () => {
  const rejectedBundlePath = 'D:\\Desktop\\step-runtime\\steppage\\bin\\steppage-mcp.mjs';
  const source = managed({ args: [rejectedBundlePath], env: { KEEP: 'fixture' }, tool_timeout_sec: 42 });
  for (const key of ['steppage', name]) {
    const input = { [key]: source };
    const before = structuredClone(input);
    const disabled = reconcile(input, { bundlePath: rejectedBundlePath, bundleExists: false, rejectedBundlePath });
    assert.deepEqual(disabled, { [name]: { ...source, enabled: false } });
    assert.deepEqual(input, before);
    assert.equal(reconcile(disabled, { bundlePath: rejectedBundlePath })[name].enabled, false);
  }
  const otherBundle = managed({ args: ['D:\\Other\\.steppage-mcp\\bin\\steppage-mcp.mjs'] });
  const custom = { command: 'custom-node', args: [rejectedBundlePath], enabled: true };
  for (const server of [otherBundle, custom])
    assert.deepEqual(reconcile({ [name]: server }, { bundleExists: false, rejectedBundlePath }), { [name]: server });
  assert.deepEqual(reconcile({}, { bundlePath: rejectedBundlePath, bundleExists: false, rejectedBundlePath }), {});
  const fallback = reconcile({ [name]: source }, { rejectedBundlePath });
  assert.equal(fallback[name].enabled, false, 'Even a different candidate must not silently undo quarantine');
  assert.deepEqual(reconcile({ steppage: source, [name]: custom }, { bundleExists: false, rejectedBundlePath }),
    { [name]: custom }, 'Quarantining a managed alias must not disable a different user-owned transport');
});


test('Desktop-only StepPage seeds a missing pinned transport without discovery or changing custom/disabled entries', () => {
  const homePath = '/Desktop/step-runtime/steppage/home';
  const mac = { platform: 'darwin', nodePath: '/App/runtime/node/node',
    bundlePath: '/Desktop/step-runtime/steppage/bin/steppage-mcp.mjs', homePath, bundleExists: false, desktopOnly: true };
  const seeded = reconcile({}, mac);
  assert.deepEqual(seeded[name], { command: mac.nodePath, args: [mac.bundlePath], enabled: true,
    env: { HOME: homePath, USERPROFILE: homePath } });
  assert.deepEqual(reconcile(seeded, mac), seeded);
  for (const enabled of [false, true])
    assert.deepEqual(reconcile({ [name]: { enabled } }, mac)[name], { ...seeded[name], enabled });
  for (const custom of [{ command: 'custom-node', args: ['custom.mjs'], enabled: true },
    { url: 'https://example.invalid/mcp', enabled: false }])
    assert.deepEqual(reconcile({ [name]: custom }, mac), { [name]: custom });
  const legacy = { command: '/Old/runtime/node/node', args: ['/Personal/.steppage-mcp/bin/steppage-mcp.mjs'], enabled: false };
  assert.deepEqual(reconcile({ steppage: legacy }, mac)[name], { ...seeded[name], enabled: false });
});
