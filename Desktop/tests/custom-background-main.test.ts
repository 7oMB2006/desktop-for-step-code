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
const helpers = ['publishCustomBackground', 'syncCustomBackground', 'assertCustomBackgroundWritable', 'changeCustomBackground'].map(name =>
  find(node => ts.isFunctionDeclaration(node) && node.name?.text === name).getText(file)).join('\n');
const cases = methods.map(method => find(node => ts.isCaseClause(node)
  && ts.isStringLiteral(node.expression) && node.expression.text === method).getText(file)).join('\n');
const image = { revision: 'a'.repeat(64), width: 1, height: 1 };
type Selection = { canceled: boolean; filePaths: string[] };
type Operation = 'import' | 'save' | 'remove';
type Flags = Partial<Record<'settingsMutation' | 'undoBusy' | 'transition' | 'updateInstalling' | 'quitting' | 'quitPending', boolean>>;
const deferred = <T = void>() => {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>(complete => { resolve = complete; });
  return { promise, resolve };
};

function fixture(flags: Flags = {}, enabled = false) {
  const gate = new CapabilityGate(), calls: string[] = [], publications: CustomBackgroundState[] = [];
  const dialogs: { options: { properties: string[]; filters: { extensions: string[] }[] } }[] = [];
  const controls: {
    available: boolean;
    onInitialize?: () => Promise<void> | void;
    onDialog?: () => Promise<Selection>;
    onChange?: (operation: Operation) => Promise<void> | void;
    importImage?: typeof image;
    imageIssue?: 'missing' | 'invalid' | 'storage';
  } = { available: true };
  let stored: StoredBackgroundState = { options: { ...DEFAULT_BACKGROUND_OPTIONS, enabled }, image: { ...image } };
  const background = {
    state: () => structuredClone(stored),
    async initialize() { calls.push('initialize'); await controls.onInitialize?.(); },
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
      await controls.onChange?.('import');
      stored = { options: { ...stored.options, enabled: true }, image: { ...(controls.importImage ?? image) } };
    },
    async save(patch: unknown) {
      calls.push('save');
      assert.equal(gate.active, true);
      const validated = validateBackgroundPatch(patch);
      await controls.onChange?.('save');
      stored.options = { ...stored.options, ...validated };
    },
    async remove() {
      calls.push('remove');
      assert.equal(gate.active, true);
      await controls.onChange?.('remove');
      stored = { options: { ...stored.options, enabled: false } };
    },
  };
  const capabilityService = {
    get available() { return controls.available; },
    async catalog() { calls.push('catalog'); return { plugins: [] }; },
    customBackgroundContext() { throw new Error('Built-in backgrounds must not request plugin proofs'); },
  };
  const initial: CustomBackgroundState = { ...background.state(), available: true };
  const runtimeAction = (name: string): never => { calls.push(`runtime:${name}`); throw new Error(`Unexpected runtime action: ${name}`); };
  const create = new Function('capabilityGate', 'capabilityService', 'customBackground', 'dialog', 'emit', 'initial', 'flags', 'runtimeAction', javascript(`
    const window = {}, preferences = { language: 'en' };
    let backgroundState = structuredClone(initial);
    let settingsMutation = flags.settingsMutation ?? false, undoBusy = flags.undoBusy ?? false;
    let transition = flags.transition ?? false, updateInstalling = flags.updateInstalling ?? false;
    let quitting = flags.quitting ?? false, quitPending = flags.quitPending ?? false;
    const guardIdle = () => runtimeAction('idle');
    const runtimes = { restart: () => runtimeAction('restart'), stopAll: () => runtimeAction('stop') };
    const admin = { request: () => runtimeAction('admin') };
    ${helpers}
    return { state: () => structuredClone(backgroundState), sync: syncCustomBackground, setFlag: (flag, value) => {
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
    publications.push(structuredClone(event.state)); calls.push('publish');
  }, initial, flags, runtimeAction) as {
    state(): CustomBackgroundState; sync(): Promise<CustomBackgroundState>;
    setFlag(flag: 'updateInstalling' | 'quitting' | 'quitPending', value: boolean): void;
    invoke(method: string, ...args: unknown[]): Promise<any>;
  };
  return { ...api, gate, calls, publications, dialogs, controls, stored: () => structuredClone(stored) };
}

test('actual main exposes built-in state without plugins or runtime leases; image reads require the active revision', async () => {
  const f = fixture({}, true);
  f.controls.available = false;
  assert.deepEqual(await f.invoke('customBackgroundState'), f.state());
  assert.equal(f.calls.length, 0);
  assert.equal((await f.sync()).options.enabled, true);
  assert.deepEqual(f.calls, ['initialize']);
  assert.equal((await f.invoke('customBackgroundImage', image.revision)).width, 1);
  await assert.rejects(f.invoke('customBackgroundImage', 'stale'), /stale-image/);
  const saved = await f.invoke('customBackgroundSave', { patch: { brightness: 75 } });
  assert.equal(saved.available, true);
  assert.equal(saved.options.brightness, 75);
  assert.equal('ref' in saved, false);
  assert.equal(f.calls.some(call => call.startsWith('runtime:')), false);
});

test('actual main passive state and catalog reads never reserve the gate or mutate appearance', async () => {
  const f = fixture();
  await f.gate.run(async () => {
    const states = await Promise.all(Array.from({ length: 64 }, () => f.invoke('customBackgroundState')));
    states.forEach(state => assert.deepEqual(state, f.state()));
    assert.deepEqual(await f.invoke('capabilityCatalog'), { plugins: [] });
    assert.deepEqual(f.calls, ['catalog']);
  });
  assert.equal(f.publications.length, 0);
});

test('actual main cancellation and invalid native selections preserve state without mutations', async () => {
  for (const selection of [{ canceled: true, filePaths: [] }, { canceled: false, filePaths: [] }]) {
    const f = fixture(), previous = f.stored();
    f.controls.onDialog = async () => selection;
    assert.equal(await f.invoke('customBackgroundImport'), null);
    assert.deepEqual(f.stored(), previous);
    assert.deepEqual(f.calls, ['dialog']);
    assert.equal(f.gate.active, false);
    assert.equal(f.publications.length, 0);
  }
  const f = fixture();
  f.controls.onDialog = async () => ({ canceled: false, filePaths: ['D:\\one.png', 'D:\\two.png'] });
  await assert.rejects(f.invoke('customBackgroundImport'), /Invalid background selection/);
  assert.equal(f.calls.some(call => call.startsWith('import:')), false);
});

test('actual main import uses only a native-selected file, never renderer paths or package references', async () => {
  const f = fixture();
  const result = await f.invoke('customBackgroundImport', 'C:\\renderer-forged-path.png');
  assert.equal(result.options.enabled, true);
  assert.deepEqual(f.calls, ['dialog', 'import:D:\\native-background.png', 'publish']);
  assert.deepEqual(f.dialogs[0].options.properties, ['openFile']);
  assert.deepEqual(f.dialogs[0].options.filters[0].extensions, ['png', 'jpg', 'jpeg']);
});

test('actual main picker allows other settings work and passive polling while pending', async () => {
  const f = fixture(), opened = deferred(), picked = deferred<Selection>();
  f.controls.onDialog = async () => { opened.resolve(); return picked.promise; };
  const pending = f.invoke('customBackgroundImport');
  await opened.promise;
  try {
    assert.equal(f.gate.active, false);
    await f.gate.run(async () => { f.controls.available = false; });
    assert.equal((await f.invoke('customBackgroundState')).options.enabled, false);
  } finally { picked.resolve({ canceled: false, filePaths: ['D:\\native-background.png'] }); }
  assert.equal((await pending).options.enabled, true, 'Legacy plugin management cannot revoke built-in backgrounds');
});

test('actual main rejects concurrent writes without taking a runtime lease or publishing uncommitted state', async () => {
  const f = fixture(), entered = deferred(), release = deferred();
  f.controls.onChange = async () => { entered.resolve(); await release.promise; };
  const pending = f.invoke('customBackgroundSave', { patch: { brightness: 75 } });
  await entered.promise;
  try {
    assert.equal(f.gate.active, true);
    assert.equal((await f.invoke('customBackgroundState')).options.brightness, DEFAULT_BACKGROUND_OPTIONS.brightness);
    await assert.rejects(f.invoke('customBackgroundRemove'), /capability:busy/);
    await assert.rejects(f.gate.run(async () => undefined), /capability:busy/);
    assert.equal(f.publications.length, 0);
  } finally { release.resolve(); }
  assert.equal((await pending).options.brightness, 75);
  assert.equal(f.gate.active, false);
});

test('actual main rejects pickers and writes during all shared transitions', async () => {
  for (const flag of ['settingsMutation', 'undoBusy', 'transition', 'updateInstalling', 'quitting', 'quitPending'] as const) {
    for (const [method, input] of [
      ['customBackgroundImport', undefined], ['customBackgroundRemove', undefined],
      ['customBackgroundSave', { patch: { enabled: true } }],
    ]) {
      const f = fixture({ [flag]: true });
      await assert.rejects(f.invoke(method as string, input), /Shared settings operation in progress/);
      assert.deepEqual(f.calls, []);
      assert.equal(f.gate.active, false);
    }
  }
});

test('actual main save validates its narrow envelope and failed writes preserve state and original error', async () => {
  for (const input of [undefined, [], 'settings', {}, { patch: {}, path: 'C:\\private.png' },
    { ref: 'legacy-package', patch: { enabled: true } }]) {
    const f = fixture(), previous = f.state();
    await assert.rejects(f.invoke('customBackgroundSave', input), /Invalid background settings|invalid-input/);
    assert.deepEqual(f.state(), previous);
    assert.equal(f.publications.length, 0);
  }
  const f = fixture(), previous = f.state(), failure = new Error('custom-background:storage');
  f.controls.onChange = () => { throw failure; };
  await assert.rejects(f.invoke('customBackgroundSave', { patch: { zoom: 20 } }), /invalid-input/);
  await assert.rejects(f.invoke('customBackgroundSave', { patch: { enabled: true } }), error => error === failure);
  assert.deepEqual(f.state(), previous);
  assert.equal(f.gate.active, false);
  f.controls.onInitialize = () => { throw new Error('secondary private failure'); };
  await assert.rejects(f.invoke('customBackgroundRemove'), error => error === failure);
  assert.equal(f.state().options.enabled, false);
  assert.equal(f.state().issue, 'storage');
});

test('actual main startup storage failures disable only the rendered fallback without erasing the saved intent', async () => {
  const f = fixture({}, true);
  f.controls.onInitialize = () => { throw new Error('private optional storage failure'); };
  const state = await f.sync();
  assert.equal(state.options.enabled, false);
  assert.equal(state.issue, 'storage');
  assert.equal(state.available, true);
  assert.deepEqual(state.image, image);
  assert.equal(f.stored().options.enabled, true);
  assert.doesNotMatch(JSON.stringify(state), /private optional/);
});

test('actual main publishes image issues but never exposes pending writes via image-read failure', async () => {
  for (const issue of ['missing', 'invalid', 'storage'] as const) {
    const f = fixture({}, true);
    f.controls.imageIssue = issue;
    await assert.rejects(f.invoke('customBackgroundImage', image.revision), new RegExp(`custom-background:${issue}`));
    assert.equal(f.state().issue, issue);
    assert.equal(f.publications.length, 1);
  }
  const f = fixture(), entered = deferred(), release = deferred();
  f.controls.onChange = async () => { entered.resolve(); await release.promise; };
  const pending = f.invoke('customBackgroundImport');
  await entered.promise;
  try {
    await assert.rejects(f.invoke('customBackgroundImage', 'stale'), /stale-image/);
    assert.equal(f.publications.length, 0);
    assert.equal(f.state().options.enabled, false);
  } finally { release.resolve(); }
  assert.equal((await pending).options.enabled, true);
  assert.equal(f.publications.length, 1);
});

test('actual main removal disables the background without runtime actions', async () => {
  const f = fixture({}, true), result = await f.invoke('customBackgroundRemove');
  assert.equal(result.image, undefined);
  assert.equal(result.options.enabled, false);
  assert.equal(f.calls.some(call => call.startsWith('runtime:')), false);
});

for (const flag of ['updateInstalling', 'quitting', 'quitPending'] as const) {
  test(`actual main keeps cached reads during ${flag} and rejects a picker result after shutdown begins`, async () => {
    const f = fixture(), opened = deferred(), picked = deferred<Selection>(), previous = f.state();
    f.controls.onDialog = async () => { opened.resolve(); return picked.promise; };
    const pending = f.invoke('customBackgroundImport');
    await opened.promise;
    f.setFlag(flag, true);
    picked.resolve({ canceled: false, filePaths: ['D:\\native-background.png'] });
    await assert.rejects(pending, /Shared settings operation in progress/);
    assert.deepEqual(await f.invoke('customBackgroundState'), previous);
    await assert.rejects(f.invoke('capabilityCatalog'), /Shared settings operation in progress/);
    assert.deepEqual(f.calls, ['dialog']);
    assert.equal(f.publications.length, 0);
    assert.equal(f.gate.active, false);
  });
}
