import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { CapabilityGate } from '../electron/capability-gate';
import { DEFAULT_BACKGROUND_OPTIONS, validateBackgroundPatch, type CustomBackgroundState, type StoredBackgroundState } from '../src/custom-background';

const file = ts.createSourceFile('main.ts', readFileSync(new URL('../electron/main.ts', import.meta.url), 'utf8'),
  ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
function find(predicate: (node: ts.Node) => boolean): ts.Node {
  let result: ts.Node | undefined;
  const visit = (node: ts.Node) => {
    if (predicate(node)) result = node;
    else ts.forEachChild(node, visit);
  };
  visit(file);
  assert.ok(result);
  return result;
}
const javascript = (source: string) => ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText;
const methods = ['customBackgroundState', 'customBackgroundImage', 'customBackgroundImport', 'customBackgroundSave', 'customBackgroundRemove',
  'capabilityCatalog'];
const helpers = ['publishCustomBackground', 'syncCustomBackground', 'changeCustomBackground'].map(name =>
  find(node => ts.isFunctionDeclaration(node) && node.name?.text === name).getText(file)).join('\n');
const cases = methods.map(method => find(node => ts.isCaseClause(node)
  && ts.isStringLiteral(node.expression) && node.expression.text === method).getText(file)).join('\n');
const textDeclaration = find(node => ts.isVariableDeclaration(node) && node.name.getText(file) === 'text') as ts.VariableDeclaration;
const approved = { ref: 'approved-package-ref', instance: 'installation-one' };
const image = { revision: 'a'.repeat(64), width: 1, height: 1 };
type Context = typeof approved;
type Selection = { canceled: boolean; filePaths: string[] };
type Operation = 'import' | 'save' | 'remove';
type Flags = Partial<Record<'settingsMutation' | 'undoBusy' | 'transition' | 'updateInstalling' | 'quitting' | 'quitPending', boolean>>;
const deferred = <T = void>() => {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>(complete => { resolve = complete; });
  return { promise, resolve };
};

function fixture(flags: Flags = {}, enabled = false) {
  const gate = new CapabilityGate();
  const calls: string[] = [];
  const publications: CustomBackgroundState[] = [];
  const dialogs: { options: { properties: string[]; filters: { extensions: string[] }[] } }[] = [];
  const controls: {
    context?: Context;
    available: boolean;
    onProof?: (ref: string | undefined) => Promise<void> | void;
    onBind?: (instance: string | undefined) => Promise<void> | void;
    onDialog?: () => Promise<Selection>;
    onChange?: (operation: Operation) => Promise<void> | void;
    importImage?: typeof image;
    imageIssue?: 'missing' | 'invalid' | 'storage';
  } = { context: { ...approved }, available: true };
  let stored: StoredBackgroundState = { options: { ...DEFAULT_BACKGROUND_OPTIONS, enabled }, image: { ...image } };
  let instance: string | undefined = approved.instance;
  const background = {
    state: () => structuredClone(stored),
    async bind(next?: string) {
      calls.push(`bind:${next ?? 'none'}`);
      await controls.onBind?.(next);
      if (next !== instance) stored.options.enabled = false;
      instance = next;
    },
    async image(revision: unknown) {
      calls.push(`image:${revision}`);
      if (revision !== stored.image?.revision) throw new Error('custom-background:stale-image');
      if (controls.imageIssue) {
        stored.issue = controls.imageIssue;
        throw new Error(`custom-background:${controls.imageIssue}`);
      }
      return { dataUrl: 'data:image/png;base64,fixture', width: 1, height: 1 };
    },
    async importFile(path: string) {
      calls.push(`import:${path}`);
      assert.equal(gate.active, true);
      stored = { options: { ...stored.options, enabled: true }, image: { ...(controls.importImage ?? image) } };
      await controls.onChange?.('import');
    },
    async save(patch: unknown) {
      calls.push('save');
      assert.equal(gate.active, true);
      stored.options = { ...stored.options, ...validateBackgroundPatch(patch) };
      await controls.onChange?.('save');
    },
    async remove() {
      calls.push('remove');
      assert.equal(gate.active, true);
      stored = { options: { ...stored.options, enabled: false } };
      await controls.onChange?.('remove');
    },
  };
  const capabilityService = {
    get available() { return controls.available; },
    async catalog() { calls.push('catalog'); return { plugins: [] }; },
    async customBackgroundContext(ref?: string) {
      calls.push(`proof:${ref ?? 'current'}`);
      await controls.onProof?.(ref);
      if (ref !== undefined && ref !== controls.context?.ref) throw new Error('capability:stale');
      return controls.context ? { ...controls.context } : undefined;
    },
  };
  const initial: CustomBackgroundState = { ...background.state(), available: true, ref: approved.ref };
  const runtimeAction = (name: string): never => { calls.push(`runtime:${name}`); throw new Error(`Unexpected runtime action: ${name}`); };
  const create = new Function('capabilityGate', 'capabilityService', 'customBackground', 'dialog', 'emit', 'initial', 'flags', 'runtimeAction', javascript(`
    const window = {}, preferences = { language: 'en' };
    let backgroundState = structuredClone(initial);
    let settingsMutation = flags.settingsMutation ?? false, undoBusy = flags.undoBusy ?? false;
    let transition = flags.transition ?? false, updateInstalling = flags.updateInstalling ?? false;
    let quitting = flags.quitting ?? false, quitPending = flags.quitPending ?? false;
    const guardIdle = () => runtimeAction('idle');
    const applyProviderSettings = () => runtimeAction('providers');
    const runtimes = { restart: () => runtimeAction('restart'), stopAll: () => runtimeAction('stop') };
    const admin = { request: () => runtimeAction('admin') };
    const text = ${textDeclaration.initializer!.getText(file)};
    ${helpers}
    return { state: () => structuredClone(backgroundState), sync: syncCustomBackground, setShutdownFlag: (flag, value) => {
      if (flag === 'updateInstalling') updateInstalling = value;
      else if (flag === 'quitting') quitting = value;
      else if (flag === 'quitPending') quitPending = value;
      else throw new Error('Unknown shutdown flag');
    }, invoke: async (method, ...args) => {
      switch (method) { ${cases} default: throw new Error('Unknown method'); }
    } };
  `));
  const api = create(gate, capabilityService, background, {
    async showOpenDialog(_window: unknown, options: { properties: string[]; filters: { extensions: string[] }[] }) {
      calls.push('dialog');
      assert.equal(gate.active, false, 'The native picker must not hold the capability gate');
      dialogs.push({ options });
      return controls.onDialog ? controls.onDialog() : { canceled: false, filePaths: ['D:\\native-background.png'] };
    },
  }, (event: { type: string; state: CustomBackgroundState }) => {
    assert.equal(event.type, 'desktop_custom_background');
    publications.push(structuredClone(event.state));
    calls.push('publish');
  }, initial, flags, runtimeAction) as {
    state(): CustomBackgroundState;
    sync(): Promise<CustomBackgroundState>;
    setShutdownFlag(flag: 'updateInstalling' | 'quitting' | 'quitPending', value: boolean): void;
    invoke(method: string, ...args: unknown[]): Promise<any>;
  };
  return { ...api, gate, calls, publications, dialogs, controls, stored: () => structuredClone(stored) };
}

test('actual main background reconciliation synchronizes binding and image reads require an active revision', async () => {
  const f = fixture();
  assert.deepEqual(await f.invoke('customBackgroundState'), f.state());
  assert.equal(f.calls.length, 0);
  assert.deepEqual(await f.sync(), f.state());
  assert.deepEqual(f.calls, ['proof:current', `bind:${approved.instance}`]);
  assert.equal((await f.invoke('customBackgroundImage', image.revision)).width, 1);
  await assert.rejects(f.invoke('customBackgroundImage', 'stale-revision'), /stale-image/);
  assert.equal(f.calls.some(call => call.startsWith('runtime:')), false);
  f.controls.context = undefined;
  const published = f.state();
  assert.deepEqual(await f.invoke('customBackgroundState'), published);
  const unavailable = await f.sync();
  assert.equal(unavailable.available, false);
  assert.equal(unavailable.options.enabled, false);
  assert.equal(unavailable.ref, undefined);
  assert.deepEqual(unavailable.image, image);
  assert.deepEqual(await f.invoke('customBackgroundState'), unavailable);
});

test('actual main frequent passive state reads never reserve the gate or block a picker import', async () => {
  const f = fixture(), opened = deferred(), picked = deferred<Selection>(), admitted = deferred(), release = deferred();
  const selection = { canceled: false, filePaths: ['D:\\native-background.png'] };
  let gateEntries = 0;
  const reserve = f.gate.run.bind(f.gate);
  f.gate.run = async <T>(action: () => Promise<T>) => { gateEntries++; return reserve(action); };
  const readBurst = async () => {
    const previousCalls = [...f.calls], previousEntries = gateEntries, cached = f.state();
    const states = await Promise.all(Array.from({ length: 64 }, () => f.invoke('customBackgroundState')));
    for (const state of states) assert.deepEqual(state, cached);
    assert.deepEqual(f.calls, previousCalls, 'Passive polling must not request worker proofs or store binding');
    assert.equal(gateEntries, previousEntries, 'Passive polling must not reserve the capability gate');
  };
  await readBurst();
  assert.equal(gateEntries, 0);
  f.controls.onDialog = async () => { opened.resolve(); return picked.promise; };
  f.controls.onChange = async () => { admitted.resolve(); await release.promise; };
  const pending = f.invoke('customBackgroundImport', approved.ref);
  try {
    await opened.promise;
    await readBurst();
    assert.equal(f.gate.active, false);
    picked.resolve(selection);
    await admitted.promise;
    assert.equal(gateEntries, 1);
    assert.equal(f.gate.active, true);
    await readBurst();
    assert.equal(f.state().options.enabled, false, 'Polling sees the last publication until final proof');
  } finally {
    picked.resolve(selection);
    release.resolve();
    await pending.catch(() => {});
  }
  const imported = await pending;
  assert.equal(imported.options.enabled, true);
  assert.equal(gateEntries, 1);
  assert.equal(f.gate.active, false);
  assert.equal(f.publications.length, 1);
  await readBurst();
});

test('actual main refuses forged or stale package references before picker or mutations', async () => {
  for (const [method, input] of [
    ['customBackgroundImport', 'forged-ref'],
    ['customBackgroundSave', { ref: 'forged-ref', patch: { brightness: 80 } }],
    ['customBackgroundRemove', 'forged-ref'],
    ['customBackgroundImport', 123],
    ['customBackgroundSave', { ref: 123, patch: { enabled: true } }],
  ] as const) {
    const f = fixture(), previous = f.stored();
    await assert.rejects(f.invoke(method, input), /stale|Invalid text/);
    assert.deepEqual(f.stored(), previous);
    assert.equal(f.dialogs.length, 0);
    assert.equal(f.publications.length, 0);
    assert.equal(f.calls.some(call => /^(?:import|save|remove|runtime):?/.test(call)), false);
    assert.equal(f.gate.active, false);
  }
});

test('actual main cancellation and invalid native selections preserve state without a mutation gate', async () => {
  for (const selection of [{ canceled: true, filePaths: [] }, { canceled: false, filePaths: [] }]) {
    const f = fixture(), previous = f.stored();
    f.controls.onDialog = async () => selection;
    assert.equal(await f.invoke('customBackgroundImport', approved.ref), null);
    assert.deepEqual(f.stored(), previous);
    assert.deepEqual(f.calls, [`proof:${approved.ref}`, 'dialog']);
    assert.equal(f.gate.active, false);
    assert.equal(f.publications.length, 0);
  }
  const f = fixture();
  f.controls.onDialog = async () => ({ canceled: false, filePaths: ['D:\\one.png', 'D:\\two.png'] });
  await assert.rejects(f.invoke('customBackgroundImport', approved.ref), /Invalid background selection/);
  assert.equal(f.calls.some(call => call.startsWith('import:')), false);
});

test('actual main import proves ownership before and after the picker and uses only the native-selected file', async () => {
  const f = fixture();
  const result = await f.invoke('customBackgroundImport', approved.ref, 'C:\\renderer-forged-path.png');
  assert.equal(result.options.enabled, true);
  assert.deepEqual(f.calls, [`proof:${approved.ref}`, 'dialog', `proof:${approved.ref}`, `bind:${approved.instance}`,
    'import:D:\\native-background.png', `proof:${approved.ref}`, 'publish']);
  assert.deepEqual(f.dialogs[0].options.properties, ['openFile']);
  assert.deepEqual(f.dialogs[0].options.filters[0].extensions, ['png', 'jpg', 'jpeg']);
  assert.equal(f.calls.some(call => call.startsWith('runtime:')), false);
  assert.equal(f.gate.active, false);
});

test('actual main does not import after uninstall or same-ref installation replacement while the picker is open', async () => {
  for (const replacement of [undefined, { ...approved, instance: 'installation-two' }]) {
    const f = fixture(), previous = f.stored();
    f.controls.onDialog = async () => {
      f.controls.context = replacement;
      return { canceled: false, filePaths: ['D:\\native-background.png'] };
    };
    await assert.rejects(f.invoke('customBackgroundImport', approved.ref), /capability:stale/);
    assert.deepEqual(f.stored(), previous);
    assert.equal(f.calls.some(call => call.startsWith('import:')), false);
    assert.ok(f.publications.every(state => state.options.enabled === false));
    assert.equal(f.gate.active, false);
  }
});

test('actual main rechecks proof after storage and never publishes stale enabled state', async () => {
  for (const replacement of [undefined, { ...approved, instance: 'installation-two' }]) {
    const f = fixture();
    f.controls.onChange = () => { f.controls.context = replacement; };
    await assert.rejects(f.invoke('customBackgroundImport', approved.ref), /capability:stale/);
    assert.equal(f.stored().options.enabled, false);
    assert.equal(f.state().options.enabled, false);
    assert.equal(f.state().available, Boolean(replacement));
    assert.ok(f.publications.every(state => state.options.enabled === false));
    assert.ok(f.calls.includes(`bind:${replacement?.instance ?? 'none'}`));
    assert.equal(f.gate.active, false);
  }
});

test('actual main native changes reject concurrency without taking a runtime lease', async () => {
  const f = fixture(), entered = deferred(), release = deferred();
  f.controls.onChange = async () => { entered.resolve(); await release.promise; };
  const pending = f.invoke('customBackgroundSave', { ref: approved.ref, patch: { brightness: 75 } });
  await entered.promise;
  try {
    assert.equal(f.gate.active, true);
    const proofs = f.calls.filter(call => call.startsWith('proof:')).length;
    const cached = await f.invoke('customBackgroundState');
    assert.equal(cached.options.brightness, DEFAULT_BACKGROUND_OPTIONS.brightness, 'Uncommitted state stays private');
    assert.equal(f.calls.filter(call => call.startsWith('proof:')).length, proofs);
    await assert.rejects(f.invoke('customBackgroundRemove', approved.ref), /capability:busy/);
    await assert.rejects(f.gate.run(async () => undefined), /capability:busy/);
    assert.equal(f.calls.some(call => call.startsWith('runtime:')), false);
  } finally { release.resolve(); }
  const saved = await pending;
  assert.equal(saved.options.brightness, 75);
  assert.equal(f.gate.active, false);
  assert.equal(f.calls.some(call => call.startsWith('runtime:')), false);
});

test('actual main keeps uninstall possible while a native picker is pending', async () => {
  const f = fixture(), entered = deferred(), picked = deferred<Selection>();
  f.controls.onDialog = async () => { entered.resolve(); return picked.promise; };
  const pending = f.invoke('customBackgroundImport', approved.ref);
  await entered.promise;
  await f.gate.run(async () => { f.controls.context = undefined; });
  picked.resolve({ canceled: false, filePaths: ['D:\\native-background.png'] });
  await assert.rejects(pending, /capability:stale/);
  assert.equal(f.calls.some(call => call.startsWith('import:')), false);
  assert.equal(f.gate.active, false);
});

test('actual main rejects native changes during shared transitions or unavailable management', async () => {
  for (const flag of ['settingsMutation', 'undoBusy', 'transition', 'updateInstalling', 'quitting', 'quitPending'] as const) {
    const f = fixture({ [flag]: true });
    await assert.rejects(f.invoke('customBackgroundSave', { ref: approved.ref, patch: { enabled: true } }),
      /Shared settings operation in progress/);
    assert.deepEqual(f.calls, []);
    assert.equal(f.gate.active, false);
  }
  const f = fixture();
  f.controls.available = false;
  await assert.rejects(f.invoke('customBackgroundRemove', approved.ref), /Shared settings operation in progress/);
  assert.deepEqual(f.calls, []);
});

test('actual main save validates its narrow envelope and failed store changes publish nothing', async () => {
  for (const input of [undefined, [], 'settings', { ref: approved.ref, patch: {}, path: 'C:\\private.png' }]) {
    const f = fixture();
    await assert.rejects(f.invoke('customBackgroundSave', input), /Invalid background settings/);
    assert.deepEqual(f.calls, []);
    assert.equal(f.publications.length, 0);
  }
  const f = fixture(), previous = f.state();
  await assert.rejects(f.invoke('customBackgroundSave', { ref: approved.ref, patch: { zoom: 20 } }), /invalid-input/);
  assert.deepEqual(f.state(), previous);
  assert.equal(f.publications.length, 0);
  assert.equal(f.gate.active, false);
  const removed = await f.invoke('customBackgroundRemove', approved.ref);
  assert.equal(removed.image, undefined);
  assert.equal(removed.options.enabled, false);
  assert.equal(f.calls.some(call => call.startsWith('runtime:')), false);
});

test('actual main optional startup proof or binding failures publish a disabled fallback instead of rejecting', async () => {
  for (const stage of ['proof', 'bind']) {
    const f = fixture({}, true);
    const failure = () => { throw new Error('private optional appearance storage failure'); };
    if (stage === 'proof') f.controls.onProof = failure;
    else f.controls.onBind = failure;
    const state = await f.sync();
    assert.equal(state.options.enabled, false);
    assert.equal(state.issue, 'storage');
    assert.equal(state.available, stage === 'bind');
    assert.deepEqual(state.image, image);
    assert.equal(f.stored().options.enabled, true, 'Temporary storage failure must not erase the saved choice');
    assert.ok(f.publications.every(value => value.options.enabled === false));
    assert.doesNotMatch(JSON.stringify(state), /private optional/);
    assert.equal(f.gate.active, false);
  }
});

test('actual main reconciles a failed native change but preserves its original error', async () => {
  const f = fixture();
  const failure = new Error('custom-background:storage');
  f.controls.onChange = () => { throw failure; };
  f.controls.onProof = ref => {
    if (ref === undefined) throw new Error('secondary reconciliation failure');
  };
  await assert.rejects(f.invoke('customBackgroundSave', { ref: approved.ref, patch: { enabled: true } }),
    error => error === failure);
  assert.equal(f.state().options.enabled, false);
  assert.equal(f.state().issue, 'storage');
  assert.equal(f.gate.active, false);
});

test('actual main publishes missing or invalid image issues after a passive image read fails', async () => {
  for (const issue of ['missing', 'invalid', 'storage'] as const) {
    const f = fixture({}, true);
    f.controls.imageIssue = issue;
    await assert.rejects(f.invoke('customBackgroundImage', image.revision), new RegExp(`custom-background:${issue}`));
    assert.equal(f.state().issue, issue);
    assert.equal(f.state().available, true);
    assert.equal(f.state().ref, approved.ref);
    assert.equal(f.publications.length, 1);
    assert.equal(f.calls.some(call => call.startsWith('runtime:')), false);
  }
});

test('actual main keeps failed stale-image reads from publishing an import before its final ownership proof', async () => {
  const f = fixture(), entered = deferred(), release = deferred();
  const imported = { ...image, revision: 'b'.repeat(64) };
  f.controls.importImage = imported;
  f.controls.onChange = async () => { entered.resolve(); await release.promise; };
  const pending = f.invoke('customBackgroundImport', approved.ref);
  await entered.promise;
  try {
    assert.equal(f.gate.active, true);
    assert.deepEqual(f.stored().image, imported);
    await assert.rejects(f.invoke('customBackgroundImage', image.revision), /stale-image/);
    assert.deepEqual(f.state().image, image);
    assert.equal(f.state().options.enabled, false);
    assert.equal(f.publications.length, 0);
  } finally { release.resolve(); }
  const result = await pending;
  assert.deepEqual(result.image, imported);
  assert.equal(result.options.enabled, true);
  assert.equal(f.publications.length, 1);
  assert.deepEqual(f.publications[0].image, imported);
  assert.equal(f.calls.at(-2), `proof:${approved.ref}`);
  assert.equal(f.calls.at(-1), 'publish');
  assert.equal(f.gate.active, false);
});

test('actual main catalog reads reconcile adapter ownership only when the gate is free', async () => {
  const f = fixture();
  f.controls.context = undefined;
  assert.deepEqual(await f.invoke('capabilityCatalog'), { plugins: [] });
  assert.deepEqual(f.calls, ['catalog', 'proof:current', 'bind:none', 'publish']);
  assert.equal(f.state().available, false);
  const busy = fixture();
  await busy.gate.run(async () => {
    assert.deepEqual(await busy.invoke('capabilityCatalog'), { plugins: [] });
    assert.deepEqual(busy.calls, ['catalog']);
  });
});

test('actual main serves cached appearance during shutdown and refuses pickers or catalog work', async () => {
  for (const flag of ['updateInstalling', 'quitting', 'quitPending'] as const) {
    const f = fixture({ [flag]: true });
    assert.deepEqual(await f.invoke('customBackgroundState'), f.state());
    await assert.rejects(f.invoke('customBackgroundImport', approved.ref), /Shared settings operation in progress/);
    await assert.rejects(f.invoke('capabilityCatalog'), /Shared settings operation in progress/);
    assert.deepEqual(f.calls, []);
    assert.equal(f.dialogs.length, 0);
  }
});

for (const flag of ['updateInstalling', 'quitting', 'quitPending'] as const) {
  test(`actual main does not open a picker when ${flag} begins during its ownership proof`, async () => {
    const f = fixture(), entered = deferred(), release = deferred(), previous = f.stored();
    f.controls.onProof = async () => { entered.resolve(); await release.promise; };
    const pending = f.invoke('customBackgroundImport', approved.ref);
    await entered.promise;
    f.setShutdownFlag(flag, true);
    const rejected = assert.rejects(pending, /Shared settings operation in progress/);
    release.resolve();
    await rejected;
    assert.deepEqual(f.calls, [`proof:${approved.ref}`]);
    assert.equal(f.dialogs.length, 0);
    assert.equal(f.publications.length, 0);
    assert.equal(f.gate.active, false);
    assert.deepEqual(f.stored(), previous);
  });
}
