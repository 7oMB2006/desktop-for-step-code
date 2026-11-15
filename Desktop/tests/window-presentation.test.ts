import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { parseWindowPresentation } from '../electron/window-presentation';
import { composerErrorText, composerKey, type WindowPresentation } from '../src/window-conversation';

const presentation = (top: number): WindowPresentation => ({ position: { follow: false, top }, disclosures: [] });

test('expected startup refusal is localized without concealing unrelated submission errors', () => {
  for (const prefix of ['', "Error invoking remote method 'desktop': Error: "]) {
    const error = new Error(`${prefix}STARTUP_NOT_READY: wait for tools or reconnect this runtime`);
    assert.match(composerErrorText(error, 'en'), /^Message not sent\./);
    assert.doesNotMatch(composerErrorText(error, 'zh'), /STARTUP_NOT_READY|Error/);
    assert.match(composerErrorText(error, 'zh'), /\u6d88\u606f\u672a\u53d1\u9001/);
  }
  assert.equal(composerErrorText(new Error('RPC request timed out'), 'en'), 'RPC request timed out');
  assert.equal(composerErrorText(new Error('RPC request timed out'), 'zh'), 'RPC request timed out');
});

async function declarations(path: string, names: string[]) {
  const source = ts.createSourceFile(path, await readFile(new URL(path, import.meta.url), 'utf8'),
    ts.ScriptTarget.Latest, true, path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const found = new Map<string, string>();
  const visit = (node: ts.Node) => {
    if (ts.isFunctionDeclaration(node) && node.name && names.includes(node.name.text))
      found.set(node.name.text, node.getText(source));
    if (ts.isVariableDeclaration(node) && names.includes(node.name.getText(source)))
      found.set(node.name.getText(source), `const ${node.getText(source)};`);
    ts.forEachChild(node, visit);
  };
  visit(source);
  for (const name of names) assert.ok(found.has(name), `Missing production declaration: ${name}`);
  return ts.transpileModule(names.map(name => found.get(name)).join('\n'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
}

async function fixture(draft = false) {
  const names = ['presentations', 'presentationRevisions', 'savePresentation', 'commitSessionNavigation', 'handle'];
  const source = await declarations('../electron/main.ts', names);
  const owner = draft ? { draftId: 'draft' } : { sessionId: 'one' };
  const worker = { id: 'worker', status: 'connected', state: { sessionId: 'one' } };
  let release!: () => void, entered!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const ready = new Promise<void>(resolve => { entered = resolve; });
  const readingSelections = new Map<string, { sessionId: string; revision: number }>(), cancelled: string[] = [];
  let pause = false;
  const context = {
    readingSelections, rendererGenerations: new Map([[17, 3]]),
    cancelHistoryReading: (owner: string) => { cancelled.push(owner); },
    composerKey, parseWindowPresentation, requireComposerOwner: (value: unknown) => value,
    miniView: draft ? { draft: { id: 'draft' } } : { runtimeId: worker.id },
    miniNavigation: { busy: false }, transition: false, quitting: false, quitPending: false, updateInstalling: false,
    runtimes: {
      workers: new Map([[worker.id, worker]]), require: () => worker, summaries: () => [], unreadSessionIds: new Set(),
    },
    snapshot: async () => { if (pause) { entered(); await gate; } return {}; },
    selectDraft: () => {}, selectRuntime: () => {}, preferences: {}, savePreferences: async () => {}, emit: () => {},
    window: { webContents: { id: 17, send: () => {} } }, showMainWindow: () => {}, miniChat: { hide: () => {} },
    resumeMini: true,
  };
  const api = runInNewContext(source + '\n({ handle, commitSessionNavigation, presentations, presentationRevisions })', context) as {
    handle: (method: string, args: unknown[], surface?: 'main' | 'mini') => Promise<unknown>;
    commitSessionNavigation: (worker: unknown, value: unknown) => { windowPresentationRevision: number };
    presentations: Record<'main' | 'mini', Map<string, WindowPresentation>>;
    presentationRevisions: Record<'main' | 'mini', number>;
  };
  const write = (revision: unknown, top: number, surface: 'main' | 'mini' = 'main') =>
    api.handle('windowPresentation', [owner, presentation(top), revision], surface);
  const read = () => api.presentations.main.get(composerKey(owner))!.position.top;
  const transfer = (top: number) => api.handle('miniChatReturn', [presentation(top)], 'mini');
  return { api, write, read, transfer, worker, readingSelections, cancelled,
    gate: { ready, release, hold: () => { pause = true; } } };
}

for (const draft of [false, true]) test(`the actual ${draft ? 'draft' : 'session'} return handler fences delayed main saves`, async () => {
  const f = await fixture(draft);
  assert.equal(await f.write(0, 10), true);
  await f.transfer(180);
  assert.equal(f.read(), 180);
  assert.equal(await f.write(0, 0), false, 'A valid but superseded snapshot cannot overwrite the handoff');
  assert.equal(f.read(), 180);
  assert.equal(await f.write(1, 200), true, 'The restored view can save normally');
  assert.equal(f.read(), 200);
  assert.equal(await f.write(0, 20, 'mini'), true, 'Independent MiniChat saves retain their own generation');
  assert.equal(f.api.presentationRevisions.mini, 0);
  await f.transfer(300);
  assert.equal(await f.write(1, 0), false, 'A second transfer invalidates the first generation too');
  assert.equal(f.read(), 300);
  assert.equal(f.api.commitSessionNavigation(f.worker, {}).windowPresentationRevision, 2);
});
for (const draft of [false, true]) test(`the actual ${draft ? 'draft' : 'session'} handoff releases a different failed main reading only`, async () => {
  const f = await fixture(draft);
  f.readingSelections.set('17:3:main', { sessionId: 'failed-reading-b', revision: 7 });
  f.readingSelections.set('29:4:mini', { sessionId: 'other-reading', revision: 8 });
  await f.transfer(180);
  assert.equal(f.readingSelections.has('17:3:main'), false);
  assert.deepEqual(f.cancelled, ['17:3:main']);
  assert.equal(f.readingSelections.has('29:4:mini'), true, 'Another window owns its own reading');
  assert.equal(f.read(), 180);
});

test('a save before the return snapshot resolves remains valid and is superseded at host commit', async () => {
  const f = await fixture();
  f.gate.hold();
  const returning = f.transfer(180);
  await f.gate.ready;
  try {
    assert.equal(await f.write(0, 0), true);
    assert.equal(f.read(), 0);
    assert.equal(f.api.presentationRevisions.main, 0);
  } finally { f.gate.release(); await returning; }
  assert.equal(f.read(), 180);
  assert.equal(await f.write(0, 0), false);
});

test('missing, malformed and future presentation revisions fail closed without mutating the cache', async () => {
  const f = await fixture();
  assert.equal(await f.write(0, 180), true);
  for (const revision of [undefined, null, NaN, Infinity, -1, 0.5, '0', 1])
    assert.equal(await f.write(revision, 0), false);
  assert.equal(f.read(), 180);
});

test('the actual renderer installer rejects late pre-transfer snapshots and restores a same-owner transfer', async () => {
  const source = await declarations('../src/main.tsx', ['installSnapshot']);
  let restored = 0, installed = 0;
  const errors: string[] = [];
  const refused = "Error invoking remote method 'desktop': Error: STARTUP_NOT_READY: wait for tools";
  const context = {
    acceptQuitReview: () => {}, presentationRevision: { current: 1 },
    messageRevision: { current: { acceptSnapshot: () => true } }, registerPluginThemes: () => {},
    view: { current: { runtimeId: 'worker', sessionId: 'one' } }, composerKey, composerErrorText,
    composerOwner: () => ({ sessionId: 'one' }), navigationPending: { current: null },
    rememberView: () => {}, composerBySession: { current: new Map() },
    composer: { client: { select: () => {} } }, setArrivingUser: () => {}, setError: (value: string) => { errors.push(value); }, setNotice: () => {},
    setDetails: () => {}, errorsBySession: { current: new Map([['one', refused]]) }, stoppingRef: { current: false }, setStopping: () => {},
    follow: { current: true }, scrollIntent: { current: undefined }, touchY: { current: undefined },
    setAwayFromBottom: () => {}, readingRestore: { current: undefined }, restoreWindowPresentation: () => { restored++; },
    viewId: { current: 'worker' }, setPreparedMarkdown: () => {},
    setUnavailableWorkspace: () => {}, readingCache: { current: { retain: () => {} } },
    setData: () => { installed++; }, setBusy: () => {}, setRequests: () => {}, setRunMetrics: () => {},
    metricsBySession: { current: new Map() },
  };
  const install = runInNewContext(source + '\ninstallSnapshot', context);
  const value = { runtimeId: 'worker', state: { sessionId: 'one' }, sessions: [], preferences: { language: 'en' }, windowPresentationRevision: 0 };
  assert.equal(install(value), false);
  assert.equal(installed, 0);
  assert.equal(install({ ...value, windowPresentationRevision: 2 }), true);
  assert.equal(restored, 1, 'Same-session transfers still install their authoritative reading position');
  assert.equal(context.presentationRevision.current, 2);
  assert.equal(installed, 1);
  assert.deepEqual(errors, [composerErrorText(refused, 'en')]);
  context.errorsBySession.current.set('one', refused);
  assert.equal(install({ ...value, preferences: { language: 'zh' }, windowPresentationRevision: 3 }), true);
  assert.equal(errors.at(-1), composerErrorText(refused, 'zh'), 'Revisited errors use the current snapshot language');
  assert.doesNotMatch(errors.join('\n'), /STARTUP_NOT_READY|remote method/);
});
