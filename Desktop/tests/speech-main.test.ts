import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { SpeechService, SPEECH_FIELD, speechSettings, saveSpeech, acknowledgeSpeech } from '../electron/speech';
import { pcmWav } from '../src/speech-audio';

const source = ts.createSourceFile('main.ts', readFileSync(new URL('../electron/main.ts', import.meta.url), 'utf8'),
  ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const methods = ['speechSettings', 'saveSpeech', 'acknowledgeSpeech', 'beginSpeech', 'transcribeSpeech', 'finishSpeech', 'cancelSpeech'];
const clauses: string[] = [];
const visit = (node: ts.Node) => {
  if (ts.isCaseClause(node) && ts.isStringLiteral(node.expression) && methods.includes(node.expression.text))
    clauses.push(node.getText(source));
  else ts.forEachChild(node, visit);
};
visit(source);
assert.equal(clauses.length, methods.length);
const account = () => ({ step: { type: 'oauth', profile: 'step_plan', access: 'main-fixture-secret', expires: Date.now() + 3600000 } });
function fixture(request: typeof fetch = async () => new Response('data: {"type":"transcript.text.done","text":"fixture transcript"}\n\n')) {
  const initial = account(), auth = acknowledgeSpeech(initial, 'unconfigured');
  const state = { visible: true, generation: 1, save: undefined as undefined | (() => Promise<void>),
    saves: 0, gated: false };
  const speech = new SpeechService(request);
  const javascript = ts.transpileModule(`
    let authData = initialAuth, appliedAuthData = initialApplied;
    let speechSaving = false, settingsMutation = false, transition = false, undoBusy = false;
    let quitting = false, quitPending = false, updateInstalling = false;
    let providerSettingsPending = false, providerApplyFailed = false, sessionDraft = { id: 'draft-one' };
    const capabilityGate = { get active() { return state.gated; } };
    const runtimes = { active: undefined };
    const window = { webContents: { id: 1 }, isVisible: () => state.visible };
    const rendererGenerations = { get: () => state.generation };
    const text = value => { if (typeof value !== 'string') throw new Error('Invalid text'); return value; };
    return {
      invoke: async (method, ...args) => { switch (method) { ${clauses.join('\n')} } },
      auth: () => authData,
      pending: value => { providerSettingsPending = value; },
      applied: value => { appliedAuthData = value; },
      navigate: id => { sessionDraft = { id }; },
      saving: () => speechSaving,
    };
  `, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const create = new Function('initialAuth', 'initialApplied', 'speech', 'state', 'vault',
    'SPEECH_FIELD', 'speechSettings', 'saveSpeech', 'acknowledgeSpeech', javascript);
  const handle = create(auth, initial, speech, state, { save: async () => { state.saves++; await state.save?.(); } },
    SPEECH_FIELD, speechSettings, saveSpeech, acknowledgeSpeech);
  return { ...handle, state, speech };
}
const wav = () => pcmWav(new Float32Array(16000).fill(0.2));
const follow = { source: 'follow', endpoint: '', model: 'stepaudio-2.5-asr', language: 'zh' };

test('actual native handler uses an applied account before worker creation and only returns an opaque ID', async () => {
  const f = fixture();
  const operation = await f.invoke('beginSpeech');
  assert.deepEqual(Object.keys(operation), ['id']);
  assert.equal(f.speech.allowMicrophone(), true);
  assert.equal(await f.invoke('transcribeSpeech', operation.id, wav()), 'fixture transcript');
  assert.equal(f.speech.allowMicrophone(), false);
});
test('actual native handler rejects pending accounts without applying or contacting any provider', async () => {
  let count = 0;
  const f = fixture(async () => { count++; throw new Error('must not contact'); });
  f.pending(true);
  assert.equal((await f.invoke('speechSettings')).followAvailable, false);
  await assert.rejects(f.invoke('beginSpeech'));
  assert.equal(count, 0);
});
test('actual native handlers keep a sequenced recording alive until explicit Finish and reject late segments after navigation', async () => {
  const f = fixture();
  const operation = await f.invoke('beginSpeech');
  assert.equal(await f.invoke('transcribeSpeech', operation.id, wav(), 0), 'fixture transcript');
  assert.equal(await f.invoke('transcribeSpeech', operation.id, wav(), 1), 'fixture transcript');
  await f.invoke('finishSpeech', operation.id);
  await assert.rejects(f.invoke('transcribeSpeech', operation.id, wav(), 2));
  const next = await f.invoke('beginSpeech');
  f.navigate('draft-two');
  await assert.rejects(f.invoke('transcribeSpeech', next.id, wav(), 0));
});
test('actual native scope rejects navigation, reload, hide, config gates and replaced credentials before upload', async () => {
  for (const change of [
    (f: ReturnType<typeof fixture>) => f.navigate('draft-two'),
    (f: ReturnType<typeof fixture>) => { f.state.generation++; },
    (f: ReturnType<typeof fixture>) => { f.state.visible = false; },
    (f: ReturnType<typeof fixture>) => { f.state.gated = true; },
    (f: ReturnType<typeof fixture>) => f.applied(account()),
  ]) {
    let count = 0;
    const f = fixture(async () => { count++; throw new Error('must not contact'); });
    const operation = await f.invoke('beginSpeech');
    change(f);
    assert.equal(f.speech.allowMicrophone(), false);
    await assert.rejects(f.invoke('transcribeSpeech', operation.id, wav()));
    assert.equal(count, 0);
  }
});
test('actual native handler discards late results after an account/window change', async () => {
  let resolve!: (response: Response) => void;
  const f = fixture(() => new Promise<Response>(done => { resolve = done; }));
  const operation = await f.invoke('beginSpeech');
  const pending = f.invoke('transcribeSpeech', operation.id, wav());
  f.state.generation++;
  resolve(new Response('data: {"type":"transcript.text.done","text":"late result"}\n\n'));
  await assert.rejects(pending);
});
test('actual save handler excludes concurrent writers, persists only after CAS and releases its latch', async () => {
  const f = fixture();
  let release!: () => void;
  f.state.save = () => new Promise<void>(done => { release = done; });
  const settings = await f.invoke('speechSettings');
  const saving = f.invoke('saveSpeech', { ...follow, language: 'en' }, settings.revision);
  assert.equal(f.saving(), true);
  await assert.rejects(f.invoke('saveSpeech', follow, settings.revision), /in progress/);
  await assert.rejects(f.invoke('acknowledgeSpeech', settings.revision), /in progress/);
  assert.equal(f.state.saves, 1);
  release();
  const saved = await saving;
  assert.equal(saved.language, 'en');
  assert.equal(f.saving(), false);
  await assert.rejects(f.invoke('saveSpeech', follow, settings.revision), /speech:conflict/);
  assert.equal((await f.invoke('speechSettings')).language, 'en');
  assert.equal(f.saving(), false);
});
test('failed native vault writes preserve old settings and release recording/save state', async () => {
  const f = fixture(), before = f.auth();
  const operation = await f.invoke('beginSpeech');
  f.state.save = async () => { throw new Error('fixture disk failure'); };
  await assert.rejects(f.invoke('saveSpeech', { ...follow, language: 'en' }, speechSettings(before).revision));
  assert.equal(f.auth(), before);
  assert.equal(f.saving(), false);
  assert.equal(f.speech.allowMicrophone(), false);
  await assert.rejects(f.invoke('transcribeSpeech', operation.id, wav()));
});
