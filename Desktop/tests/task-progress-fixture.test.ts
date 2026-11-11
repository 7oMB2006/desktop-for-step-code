import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const { waitForSessionFixtureSnapshot } = await import(
  new URL('../scripts/session-fixture.mjs', import.meta.url).href);
const source = ts.createSourceFile('verify-task-progress-electron.mjs',
  readFileSync(new URL('../scripts/verify-task-progress-electron.mjs', import.meta.url), 'utf8'),
  ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const declarations = source.statements.filter(ts.isVariableStatement)
  .flatMap(statement => [...statement.declarationList.declarations]);
const chunk = declarations.find(declaration => declaration.name.getText(source) === 'chunk')?.initializer;
const server = declarations.find(declaration => declaration.name.getText(source) === 'server')?.initializer;
assert.ok(chunk && server && ts.isCallExpression(server));
assert.equal(server.expression.getText(source), 'createServer');
const receive = server.arguments[0];
assert.ok(receive && ts.isArrowFunction(receive));
const body = source.statements.find(ts.isTryStatement)?.tryBlock.statements;
assert.ok(body);
const first = body.findIndex(statement => statement.getText(source)
  === "await page.locator('.composer > .composer-input').fill('下一轮只回复确认即可。');");
const last = body.findIndex((statement, index) => index > first
  && statement.getText(source) === 'assert.deepEqual(errors, []);');
assert.ok(first >= 0 && last > first, 'Execute the real next-turn submission, reload and request assertions');
const tail = body.slice(first, last + 1).map(statement => statement.getText(source)).join('\n');
const create = new Function('assert', 'page', 'board', 'progress', 'errors', 'waitForSessionFixtureSnapshot', `
  let taskUpdateRequests = 0, taskSummaryRequests = 0, nextTurnRequests = 0, finishTaskAnswer;
  const chunk = ${chunk.getText(source)};
  const receive = ${receive.getText(source)};
  return {
    receive,
    finishInitial: () => { finishTaskAnswer(); finishTaskAnswer = undefined; },
    counts: () => ({ taskUpdateRequests, taskSummaryRequests, nextTurnRequests }),
    run: async () => { ${tail} },
  };
`);

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
const turn = () => new Promise<void>(done => setImmediate(done));
const nextPrompt = '下一轮只回复确认即可。';
const taskPrompt = '完成最后一项，然后总结。';
const messages = (prompt: string, summary = false) => [
  { role: 'user', content: prompt },
  ...(summary ? [{ role: 'tool', tool_call_id: 'finish-task', content: 'done' }] : []),
];
interface ResponseFixture {
  chunks: string[];
  writeHead(code: number, headers: object): void;
  write(value: string): void;
  end(value: string): void;
}
interface NativeFixture {
  receive(request: AsyncIterable<string>, response: ResponseFixture): Promise<void>;
  finishInitial(): void;
  counts(): { taskUpdateRequests: number; taskSummaryRequests: number; nextTurnRequests: number };
  run(): Promise<void>;
}

async function fixture({ scenario = nextPrompt, duplicate = false, streaming = false } = {}) {
  const requestBody = deferred<void>(), reply = deferred<void>(), idle = deferred<object>();
  const pressed = deferred<void>(), snapshotRead = deferred<void>();
  const state = { input: '', reloads: 0, replyWaits: 0, snapshotReads: 0, navigationReads: 0 };
  const responses: ResponseFixture[] = [], requests: Promise<void>[] = [];
  const response = (): ResponseFixture => ({
    chunks: [],
    writeHead: code => { assert.equal(code, 200); },
    write(value) { this.chunks.push(value); },
    end(value) { this.chunks.push(value); },
  });
  let native: NativeFixture;
  const dispatch = (prompt: string, summary = false, gate?: Promise<void>) => {
    const result = response();
    const request = {
      async *[Symbol.asyncIterator]() {
        await gate;
        yield JSON.stringify({ messages: messages(prompt, summary) });
      },
    };
    return { result, completed: native.receive(request, result) };
  };
  const trigger = {
    waitFor: async () => {},
    getAttribute: async (name: string) => { assert.equal(name, 'aria-expanded'); return 'false'; },
    click: async () => {},
  };
  const history = {
    getByRole: (role: string, { name }: { name: RegExp }) => {
      assert.equal(role, 'button');
      if (name.test('已完成计划 2 项')) return trigger;
      assert.equal(name.test('验证并归档'), true);
      return { waitFor: async () => {} };
    },
  };
  const board = {
    locator: (selector: string) => { assert.equal(selector, '.sb-task-history'); return history; },
    isVisible: async () => true,
  };
  const page = {
    locator: (selector: string) => {
      if (selector === '.composer > .composer-input') return {
        fill: async (value: string) => { state.input = value; },
        press: async (key: string) => {
          assert.equal(key, 'Enter');
          assert.equal(state.input, nextPrompt);
          for (let index = 0; index < (duplicate ? 2 : 1); index++) {
            const request = dispatch(scenario, false, requestBody.promise);
            responses.push(request.result);
            requests.push(request.completed);
          }
          pressed.resolve();
        },
      };
      assert.equal(selector, '.conversation .message.assistant .response-text');
      return {
        getByText: (text: string, options: object) => {
          assert.equal(text, '确认。');
          assert.deepEqual(options, { exact: true });
          return { waitFor: async () => {
            state.replyWaits++;
            await reply.promise;
            const answer = responses[0].chunks.join('').split('\n')
              .filter(line => line.startsWith('data: {'))
              .map(line => JSON.parse(line.slice(6)).choices[0].delta.content ?? '').join('');
            assert.equal(answer, text, 'An incorrect response cannot satisfy the exact confirmation wait');
          } };
        },
      };
    },
    waitForFunction: async (predicate: () => unknown) => {
      const check = new Function('document', `return (${predicate.toString()})();`);
      assert.equal(check({ querySelector: () => ({ getAttribute: () => 'false' }) }), true);
      state.navigationReads++;
    },
    evaluate: async (callback: () => unknown) => {
      assert.equal(callback.toString().includes('window.desktop.snapshot()'), true);
      state.snapshotReads++;
      snapshotRead.resolve();
      return streaming ? { state: { isStreaming: true } } : idle.promise;
    },
    screenshot: async () => {},
    reload: async () => { state.reloads++; },
  };
  const waitForIdle = (owner: typeof page, predicate: (snapshot: { state: { isStreaming: boolean } }) => boolean, label: string) => {
    assert.equal(predicate({ state: { isStreaming: true } }), false, 'A still-streaming turn cannot be accepted');
    assert.equal(predicate({ state: { isStreaming: false } }), true);
    return streaming ? waitForSessionFixtureSnapshot(owner, predicate, label, 0)
      : waitForSessionFixtureSnapshot(owner, predicate, label);
  };
  native = create(assert, page, board, { count: async () => 0 }, [], waitForIdle) as NativeFixture;
  await dispatch(taskPrompt).completed;
  await dispatch(taskPrompt, true).completed;
  native.finishInitial();
  assert.deepEqual(native.counts(), { taskUpdateRequests: 1, taskSummaryRequests: 1, nextTurnRequests: 0 });
  return {
    native, state, pressed: pressed.promise, snapshotRead: snapshotRead.promise,
    releaseBody: () => requestBody.resolve(),
    releaseReply: () => reply.resolve(),
    releaseIdle: () => idle.resolve({ state: { isStreaming: false } }),
    received: () => Promise.all(requests),
    replay: async (summary: boolean) => { await dispatch(taskPrompt, summary).completed; },
  };
}

test('task progress acceptance cannot reload on retired history before request, exact reply and authoritative idle', { timeout: 5000 }, async () => {
  const f = await fixture();
  const pending = f.native.run().then(() => ({ ok: true }), error => ({ error }));
  await f.pressed;
  await turn();
  assert.equal(f.state.replyWaits, 1, 'History and navigation are already ready, but the reply is not');
  assert.equal(f.native.counts().nextTurnRequests, 0);
  assert.equal(f.state.reloads, 0, 'The renderer must not reload before the model request arrives');
  f.releaseBody();
  await f.received();
  assert.equal(f.native.counts().nextTurnRequests, 1);
  assert.equal(f.state.reloads, 0, 'Receiving HTTP input alone is not reply completion');
  f.releaseReply();
  await f.snapshotRead;
  await turn();
  assert.equal(f.state.reloads, 0, 'Even a displayed confirmation must await its authoritative IPC state');
  f.releaseIdle();
  const outcome = await pending;
  assert.ifError('error' in outcome ? outcome.error : undefined);
  assert.equal(f.state.reloads, 1);
  assert.equal(f.state.navigationReads, 2);
  assert.deepEqual(f.native.counts(), { taskUpdateRequests: 1, taskSummaryRequests: 1, nextTurnRequests: 1 });
});

test('task progress acceptance rejects a replayed tool response instead of accepting ready history', { timeout: 5000 }, async () => {
  const f = await fixture({ scenario: taskPrompt });
  const pending = assert.rejects(f.native.run(), /incorrect response cannot satisfy/);
  await f.pressed;
  f.releaseBody();
  await f.received();
  f.releaseReply();
  await pending;
  assert.equal(f.state.reloads, 0);
  assert.equal(f.state.snapshotReads, 0);
  assert.deepEqual(f.native.counts(), { taskUpdateRequests: 2, taskSummaryRequests: 1, nextTurnRequests: 0 });
});

test('task progress acceptance retains a bounded failure when the confirmation turn stays streaming', { timeout: 5000 }, async () => {
  const f = await fixture({ streaming: true });
  const pending = assert.rejects(f.native.run(), /Timed out waiting for the confirmation turn to finish/);
  await f.pressed;
  f.releaseBody();
  await f.received();
  f.releaseReply();
  await pending;
  assert.equal(f.state.snapshotReads, 1, 'The negative case uses the real snapshot poller with a zero test deadline');
  assert.equal(f.state.reloads, 0);
});

for (const replay of ['next request', 'task command', 'task summary'] as const)
  test(`task progress acceptance still rejects a duplicate ${replay} after readiness`, { timeout: 5000 }, async () => {
    const f = await fixture({ duplicate: replay === 'next request' });
    const pending = assert.rejects(f.native.run(), error =>
      error instanceof assert.AssertionError && error.actual === 2 && error.expected === 1);
    await f.pressed;
    f.releaseBody();
    await f.received();
    if (replay !== 'next request') await f.replay(replay === 'task summary');
    f.releaseReply();
    await f.snapshotRead;
    f.releaseIdle();
    await pending;
    assert.equal(f.state.reloads, 1);
  });
