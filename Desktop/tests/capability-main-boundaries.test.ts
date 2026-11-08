import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { CapabilityGate } from '../electron/capability-gate';
import type { CapabilityPolicy } from '../electron/capability-policy';
import { capabilityFailureDetails } from '../electron/capability-failure.mjs';

const file = ts.createSourceFile('main.ts', readFileSync(new URL('../electron/main.ts', import.meta.url), 'utf8'),
  ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
function find(predicate: (node: ts.Node) => boolean): ts.Node {
  let result: ts.Node | undefined;
  const visit = (node: ts.Node) => { if (predicate(node)) result = node; else ts.forEachChild(node, visit); };
  visit(file);
  assert.ok(result);
  return result;
}
const javascript = (source: string) => ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText;
const mutationCase = find(node => ts.isCaseClause(node) && ts.isStringLiteral(node.expression)
  && node.expression.text === 'capabilityMutate') as ts.CaseClause;

function mutationFixture(policy: CapabilityPolicy, unsafeFailure = false) {
  let refreshes = 0, idleChecks = 0;
  const service = {
    runtimeAvailable: true,
    async mutate(_input: unknown, guard: (policy: CapabilityPolicy) => Promise<() => void>) {
      const release = await guard(policy);
      try {
        if (unsafeFailure) {
          this.runtimeAvailable = false;
          throw new Error('capability:management-uncertain');
        }
        return { warnings: [] };
      } finally { release(); }
    },
  };
  const create = new Function('capabilityGate', 'capabilityService', 'guardIdle', 'assertPluginUnused', 'refreshThemePacks',
    javascript(`
      let settingsMutation = false;
      const transition = false, undoBusy = false, updateInstalling = false, quitting = false, quitPending = false;
      const runtimes = { workers: new Map() }, preferences = {}, themePacks = { packs: [] };
      const window = { webContents: { send() {} } }, markCapabilityPhase = () => {};
      return { locked: () => settingsMutation, invoke: async args => { ${mutationCase.statements.map(node => node.getText(file)).join('\n')} } };
    `));
  return {
    ...create(new CapabilityGate(), service, async () => { idleChecks++; }, async () => {},
      async () => { refreshes++; }),
    refreshes: () => refreshes, idleChecks: () => idleChecks,
  };
}

test('actual main discovery actions do not scan themes or persist appearance preferences', async () => {
  for (const action of ['marketplace-add', 'marketplace-update', 'marketplace-remove', 'plugin-check-updates']) {
    const f = mutationFixture({ scope: 'discovery' });
    await f.invoke([{ action }]);
    assert.equal(f.refreshes(), 0);
    assert.equal(f.idleChecks(), 0);
    assert.equal(f.locked(), false);
  }
  const theme = mutationFixture({ scope: 'theme', pluginId: 'theme' });
  await theme.invoke([{ action: 'plugin-install' }]);
  assert.equal(theme.refreshes(), 1);
  assert.equal(theme.locked(), false);
});

test('actual main retains its runtime barrier after an unconfirmed executable writer', async () => {
  const f = mutationFixture({ scope: 'runtime' }, true);
  await assert.rejects(f.invoke([{ action: 'skill-create' }]), /management-uncertain/);
  assert.equal(f.locked(), true);
  assert.equal(f.idleChecks(), 1);
  assert.equal(f.refreshes(), 0);
});

const ipcCall = find(node => ts.isCallExpression(node) && node.expression.getText(file) === 'ipcMain.handle'
  && node.arguments[0]?.getText(file) === "'desktop'") as ts.CallExpression;
const ipcSource = ipcCall.arguments[1].getText(file);

function ipcFixture(handler: (method: string) => unknown = method => method) {
  const webContents = { mainFrame: {} };
  const state = { applications: 0 };
  const create = new Function('window', 'applyProviderSettings', 'handle', 'capabilityFailureDetails', javascript(`
    let settingsMutation = false;
    const providerApplication = undefined, providerSettingsPending = true, undoBusy = false, transition = false;
    const updateInstalling = false, quitting = false, quitPending = false;
    const capabilityGate = { active: false }, capabilityService = { available: true, runtimeAvailable: true };
    const canApplyProviders = () => true;
    const diagnoseCapabilityMutation = async (_method, _input, action) => action(() => {});
    const crashLog = { record: async () => {} };
    return ${ipcSource};
  `));
  const invoke = create({ webContents }, async () => { state.applications++; }, handler, capabilityFailureDetails);
  return { state, read: (method: string) => invoke({ sender: webContents, senderFrame: webContents.mainFrame }, method) };
}

test('actual main passive capability reads never trigger pending provider application or recovery', async () => {
  const f = ipcFixture();
  for (const method of [
    'capabilityCatalog', 'pluginDocument', 'pluginRepositoryInfo', 'pluginConfiguration', 'pluginChoosePath',
    'themeScene', 'themePoster', 'bvrConfiguration', 'bvrCheckEnvironment', 'bvrChoosePath', 'capabilityMutate',
  ]) assert.equal(await f.read(method), method);
  assert.equal(f.state.applications, 0);
  await f.read('beginSession');
  assert.equal(f.state.applications, 1);
});

test('actual main IPC rewrap retains only allowlisted Git failure metadata for capability mutations', async () => {
  const error = Object.assign(new Error('capability:marketplace-network'), { details: {
    operation: 'marketplace-refresh', elapsedMs: 80, gitExitCode: 128, gitSystemCode: null, gitSignal: null,
    stderr: 'private-output', environment: { TOKEN: 'private-token' }, source: 'private-source',
  } });
  const f = ipcFixture(async () => { throw error; });
  await assert.rejects(f.read('capabilityMutate'), failure => {
    assert.notEqual(failure, error);
    assert.deepEqual(capabilityFailureDetails(failure), {
      operation: 'marketplace-refresh', elapsedMs: 80, gitExitCode: 128, gitSystemCode: null, gitSignal: null,
    });
    assert.doesNotMatch(JSON.stringify(failure), /private|stderr|environment|source/);
    return true;
  });
  await assert.rejects(f.read('beginSession'), failure => {
    assert.equal(capabilityFailureDetails(failure), undefined);
    return true;
  });
});

test('actual main recovery rechecks idle after asynchronous resource observation', async () => {
  const constructor = find(node => ts.isNewExpression(node) && node.expression.getText(file) === 'CapabilityService') as ts.NewExpression;
  const options = constructor.arguments![0] as ts.ObjectLiteralExpression;
  const guard = options.properties.find(node => ts.isPropertyAssignment(node) && node.name.getText(file) === 'guardRecovery') as ts.PropertyAssignment;
  let observations = 0, changed = false;
  const create = new Function('runtimes', 'assertPluginUnused', javascript(`
    let settingsMutation = false;
    const capabilityService = { runtimeAvailable: true };
    const guard = ${guard.initializer.getText(file)};
    return { guard, locked: () => settingsMutation };
  `));
  const value = create({
    workers: new Map(),
    async assertAllIdle() { observations++; if (changed) throw new Error('late task'); },
  }, async (id: string) => { assert.equal(id, 'journal-owner'); changed = true; });
  await assert.rejects(value.guard('journal-owner'), /late task/);
  assert.equal(observations, 2);
  assert.equal(value.locked(), false);
});
