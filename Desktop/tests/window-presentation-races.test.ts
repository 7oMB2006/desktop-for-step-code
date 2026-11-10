import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import type { ReadingPosition } from '../src/session-reading';

const source = ts.createSourceFile('main.tsx', readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8'),
  ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const app = source.statements.find((node): node is ts.FunctionDeclaration =>
  ts.isFunctionDeclaration(node) && node.name?.text === 'App')!;
const declarations = app.body!.statements.flatMap(node => ts.isVariableStatement(node) ? [...node.declarationList.declarations] : []);
let handoff: ts.IfStatement | undefined;
const visit = (node: ts.Node) => {
  if (ts.isIfStatement(node) && node.expression.getText(source).startsWith("event.type === 'desktop_view_changed'"))
    handoff = node;
  ts.forEachChild(node, visit);
};
visit(app);
assert.ok(handoff);
const handoffSource = handoff.getText(source);

function harness() {
  const reads: { resolve(value: { position: ReadingPosition }): void; reject(error: Error): void }[] = [];
  const writes: ReadingPosition[] = [], requests: Promise<unknown>[] = [];
  const state = { position: { follow: true, top: 6938 } as ReadingPosition };
  const runtime = declarations.filter(node => ['pendingPresentationRestores', 'saveWindowPresentation'].includes(node.name.getText(source)))
    .map(node => `const ${node.getText(source)};`).join('\n');
  const program = ts.transpileModule(`
    const useRef = current => ({ current });
    const navigationPending = useRef(undefined), switching = useRef(false), readingRestore = useRef(undefined);
    const latestData = useRef({});
    const composerOwner = () => ({ sessionId: 'one' });
    const currentPresentation = () => ({ position: state.position, disclosures: [] });
    const isMini = false;
    const finishSettingsClose = () => {};
    const setRemoteOpen = () => {}, setUsageOpen = () => {}, setScheduledOpen = () => {};
    const setPluginsOpen = () => {}, setFulltextOpen = () => {}, setDetails = () => {}, setExpandedRightPanel = () => {};
    const rememberView = persist => { if (persist) throw new Error('Cannot persist the old view'); };
    const installSnapshot = () => true;
    const flushSync = action => action();
    const followLayout = () => {};
    const restoreWindowPresentation = value => { readingRestore.current = { position: value.position }; };
    ${runtime}
    return {
      save: saveWindowPresentation,
      event: event => { ${handoffSource} },
      paint: () => {
        state.position = readingRestore.current.position;
        readingRestore.current.expectedTop = state.position.top;
      },
    };
  `, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const api = new Function('bridge', 'run', 'state', program)({
    snapshot: () => new Promise((resolve, reject) => { reads.push({ resolve, reject }); }),
    windowPresentation: async (_owner: unknown, value: { position: ReadingPosition }) => { writes.push(value.position); },
  }, (action: () => Promise<unknown>) => { requests.push(action().catch(error => error)); }, state) as {
    save(): void; event(event: { type: string; surface: string; restorePresentation?: boolean }): void; paint(): void;
  };
  const restore = () => api.event({ type: 'desktop_view_changed', surface: 'main', restorePresentation: true });
  return { ...api, restore, reads, writes, requests, state };
}

test('a delayed MiniChat handoff cannot be overwritten by old main-window scroll persistence', async () => {
  const h = harness();
  h.restore();
  h.save();
  assert.deepEqual(h.writes, [], 'old scroll events cannot overwrite the incoming presentation during IPC');
  const position: ReadingPosition = { follow: false, top: 180, anchor: {
    index: 1, entryId: 'answer', role: 'assistant', timestamp: 1, offset: -44.75,
  } };
  h.reads[0].resolve({ position });
  await h.requests[0];
  h.save();
  assert.deepEqual(h.writes, [], 'the snapshot alone does not establish restored DOM geometry');
  h.paint(); h.save();
  assert.deepEqual(h.writes, [position], 'normal persistence resumes with the restored reading position');
});

test('overlapping presentation reads remain protected until all have settled', async () => {
  const h = harness();
  h.restore(); h.restore();
  h.reads[0].resolve({ position: { follow: false, top: 180 } });
  await h.requests[0];
  h.paint(); h.save();
  assert.deepEqual(h.writes, [], 'an earlier response cannot unlock another in-flight handoff');
  h.reads[1].resolve({ position: { follow: false, top: 240 } });
  await h.requests[1];
  h.paint(); h.save();
  assert.deepEqual(h.writes, [{ follow: false, top: 240 }]);
});

test('failed handoff reads release the persistence guard without inventing a restored position', async () => {
  const h = harness();
  h.restore();
  const failure = new Error('Snapshot failed');
  h.reads[0].reject(failure);
  assert.equal(await h.requests[0], failure);
  h.save();
  assert.deepEqual(h.writes, [{ follow: true, top: 6938 }]);
});

test('ordinary view refreshes keep independent reading persistence available', async () => {
  const h = harness();
  h.event({ type: 'desktop_view_changed', surface: 'main' });
  h.save();
  assert.deepEqual(h.writes, [{ follow: true, top: 6938 }]);
  h.reads[0].resolve({ position: { follow: false, top: 180 } });
  await h.requests[0];
  h.save();
  assert.equal(h.writes.length, 2);
});
