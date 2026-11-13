import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { pcmWav } from '../src/speech-audio';
import { SpeechSegments, appendSpeechText } from '../src/speech-segments';

const source = ts.createSourceFile('SpeechInput.tsx', readFileSync(new URL('../src/SpeechInput.tsx', import.meta.url), 'utf8'),
  ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const component = source.statements.find((node): node is ts.FunctionDeclaration =>
  ts.isFunctionDeclaration(node) && node.name?.text === 'SpeechInput');
assert.ok(component?.body);
const methods = ['release', 'cancel', 'failed', 'drain', 'enqueue', 'stop'];
const declarations = component.body.statements.filter(node => ts.isVariableStatement(node)
  && node.declarationList.declarations.some(declaration => ts.isIdentifier(declaration.name)
    && methods.includes(declaration.name.text)));
assert.equal(declarations.length, methods.length, 'Exercise the actual component methods, not a copied queue implementation');
const javascript = ts.transpileModule(`
  const current = { current: operation }, alive = { current: true };
  const latest = { current: {
    onText: (text, continuation) => {
      state.insertions.push({ text, continuation });
      state.draft = appendSpeechText(state.draft, text, continuation);
    },
    onActiveChange: active => state.active = active,
  } };
  const t = (_, en) => en;
  const setPhase = value => state.phase = value;
  const setLevel = value => state.level = value;
  const setWorking = value => state.working = value;
  const setError = value => state.error = value;
  ${declarations.map(node => node.getText(source)).join('\n')}
  return {
    enqueue: samples => enqueue(operation, samples),
    drain: () => drain(operation),
    stop: () => stop(operation),
    cancel,
    current: () => current.current,
  };
`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const create = new Function('operation', 'state', 'bridge', 'pcmWav', 'appendSpeechText', 'clearTimeout', javascript);

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
const settled = () => new Promise<void>(done => setImmediate(done));
const tone = (seconds: number) => new Float32Array(seconds * 16000).fill(0.2);
function fixture(inserted = false) {
  const state = {
    active: true, phase: 'recording', level: 0.5, working: false, error: '',
    draft: inserted ? 'Manual draft\nKept transcript.' : 'Manual draft',
    insertions: [] as Array<{ text: string; continuation: boolean }>,
    captureCancels: 0, captureStops: 0, trackStops: [0, 0], timerClears: 0,
    cancelled: [] as string[], finished: [] as string[],
    calls: [] as Array<{ id: string; audio: Uint8Array; sequence: number; result: ReturnType<typeof deferred<string>> }>,
  };
  const timer = {};
  const operation = {
    id: 'recording-one', segments: new SpeechSegments(), queue: [] as Uint8Array[], sequence: 0,
    samples: 0, draining: false, inserted, stopping: false, ending: false, cancelled: false, timer,
    capture: {
      cancel: () => { state.captureCancels++; },
      stop: async () => { state.captureStops++; },
    },
    stream: { getTracks: () => state.trackStops.map((_, index) => ({ stop: () => { state.trackStops[index]++; } })) },
  };
  const bridge = {
    transcribeSpeech: (id: string, audio: Uint8Array, sequence: number) => {
      const result = deferred<string>();
      state.calls.push({ id, audio, sequence, result });
      return result.promise;
    },
    cancelSpeech: async (id: string) => { state.cancelled.push(id); },
    finishSpeech: async (id: string) => { state.finished.push(id); },
  };
  const controls = create(operation, state, bridge, pcmWav, appendSpeechText,
    (value: object) => { if (value === timer) state.timerClears++; }) as {
      enqueue(samples: Float32Array): void;
      drain(): Promise<void>;
      stop(): Promise<void>;
      cancel(): void;
      current(): typeof operation | undefined;
    };
  return {
    ...controls, state, operation,
    push(samples: Float32Array) {
      for (const segment of operation.segments.push(samples)) controls.enqueue(segment);
    },
  };
}

test('actual continuous-input queue stops at the sixth segment and discards every late result', async () => {
  const f = fixture(true), keptDraft = f.state.draft;
  f.push(tone(20));
  assert.equal(f.state.calls.length, 1, 'Only the first segment may be in flight');
  assert.equal(f.operation.queue.length, 4, 'Four waiting segments remain allowed');
  assert.equal(f.operation.cancelled, false);
  assert.equal(f.state.calls[0].audio.length, 44 + 64000 * 2);
  assert.deepEqual(f.state.calls.map(call => call.sequence), [0]);
  f.push(tone(4));
  assert.match(f.state.error, /too slow/);
  assert.equal(f.operation.cancelled, true);
  assert.equal(f.current(), undefined);
  assert.deepEqual(f.operation.queue, []);
  assert.equal(f.state.captureCancels, 1);
  assert.deepEqual(f.state.trackStops, [1, 1]);
  assert.equal(f.state.timerClears, 1);
  assert.deepEqual(f.state.cancelled, ['recording-one']);
  assert.deepEqual(f.state.finished, []);
  assert.equal(f.state.active, false);
  assert.equal(f.state.phase, 'idle');
  assert.equal(f.state.level, 0);
  assert.equal(f.state.working, false);
  assert.equal(f.state.draft, keptDraft);
  f.state.calls[0].result.resolve('Must not reach the draft');
  await settled();
  f.push(tone(8));
  await f.drain();
  assert.equal(f.state.calls.length, 1, 'Cancelled queued audio must never be uploaded');
  assert.deepEqual(f.state.insertions, []);
  assert.equal(f.state.draft, keptDraft);
  assert.equal(f.operation.draining, false);
  assert.deepEqual(f.state.cancelled, ['recording-one']);
});

test('actual queue drains serially, appends in order and finishes only after its remaining PCM', async () => {
  const f = fixture();
  f.push(tone(9));
  assert.equal(f.state.calls.length, 1);
  assert.equal(f.operation.queue.length, 1);
  await f.stop();
  assert.equal(f.state.captureStops, 1);
  assert.equal(f.operation.queue.length, 2, 'Finish queues only the one-second tail');
  assert.equal(f.operation.ending, true);
  assert.deepEqual(f.state.finished, []);
  f.state.calls[0].result.resolve('First.');
  await settled();
  assert.equal(f.state.calls.length, 2);
  assert.deepEqual(f.state.calls.map(call => call.sequence), [0, 1]);
  assert.equal(f.state.draft, 'Manual draft\nFirst.');
  assert.deepEqual(f.state.finished, []);
  f.state.calls[1].result.resolve('Second.');
  await settled();
  assert.equal(f.state.calls.length, 3);
  assert.deepEqual(f.state.calls.map(call => call.audio.length), [128044, 128044, 32044]);
  assert.deepEqual(f.state.calls.map(call => call.sequence), [0, 1, 2]);
  assert.equal(f.state.draft, 'Manual draft\nFirst. Second.');
  assert.deepEqual(f.state.finished, []);
  f.state.calls[2].result.resolve('Tail.');
  await settled();
  assert.equal(f.state.draft, 'Manual draft\nFirst. Second. Tail.');
  assert.deepEqual(f.state.insertions.map(insertion => insertion.continuation), [false, true, true]);
  assert.deepEqual(f.state.finished, ['recording-one']);
  assert.deepEqual(f.state.cancelled, ['recording-one']);
  assert.equal(f.state.captureCancels, 1);
  assert.deepEqual(f.state.trackStops, [1, 1]);
  assert.equal(f.current(), undefined);
  assert.equal(f.state.error, '');
  await f.stop();
  assert.equal(f.state.captureStops, 1, 'Repeated Finish must not flush the tail twice');
  assert.equal(f.state.calls.length, 3);
});

test('actual cancellation clears queued audio and keeps text when an in-flight request rejects', async () => {
  const f = fixture(true), keptDraft = f.state.draft;
  f.push(tone(12));
  f.cancel();
  assert.equal(f.operation.queue.length, 0);
  assert.equal(f.state.captureCancels, 1);
  assert.deepEqual(f.state.trackStops, [1, 1]);
  assert.deepEqual(f.state.cancelled, ['recording-one']);
  f.state.calls[0].result.reject(new Error('Speech service HTTP 401: private provider diagnostic'));
  await settled();
  assert.equal(f.state.calls.length, 1);
  assert.equal(f.state.draft, keptDraft);
  assert.deepEqual(f.state.insertions, []);
  assert.equal(f.state.error, '', 'A late rejection must not replace the cancelled state');
  assert.equal(f.state.working, false);
});

test('actual provider failure releases capture without exposing its response or draining queued audio', async () => {
  const f = fixture(true), keptDraft = f.state.draft;
  f.push(tone(8));
  f.state.calls[0].result.reject(new Error('Speech service HTTP 401: private provider diagnostic'));
  await settled();
  assert.match(f.state.error, /HTTP 401/);
  assert.doesNotMatch(f.state.error, /private provider/);
  assert.equal(f.state.calls.length, 1);
  assert.equal(f.state.draft, keptDraft);
  assert.deepEqual(f.operation.queue, []);
  assert.equal(f.state.captureCancels, 1);
  assert.deepEqual(f.state.trackStops, [1, 1]);
  assert.deepEqual(f.state.cancelled, ['recording-one']);
  assert.deepEqual(f.state.finished, []);
});
