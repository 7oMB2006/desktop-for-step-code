import assert from 'node:assert/strict';
import test from 'node:test';

const { taskSectionIsRevealed, waitForTaskSectionReveal } = await import(
  new URL('../scripts/command-dispatch-fixture.mjs', import.meta.url).href);

function fixture() {
  const document = { activeElement: null as unknown };
  const rect = { top: 20, bottom: 40 }, viewport = { top: 10, bottom: 100 };
  const element = { ownerDocument: document, getBoundingClientRect: () => rect,
    closest: () => ({ getBoundingClientRect: () => viewport }) };
  document.activeElement = element;
  return { document, rect, viewport, element };
}

test('task reveal requires both exact focus ownership and full vertical containment', () => {
  const value = fixture();
  assert.equal(taskSectionIsRevealed(value.element), true);
  value.document.activeElement = {};
  assert.equal(taskSectionIsRevealed(value.element), false);
  value.document.activeElement = value.element;
  value.rect.top = 9.99;
  assert.equal(taskSectionIsRevealed(value.element), false);
  value.rect.top = 10;
  value.rect.bottom = 100.01;
  assert.equal(taskSectionIsRevealed(value.element), false);
  value.rect.bottom = 100;
  assert.equal(taskSectionIsRevealed(value.element), true, 'Boundary equality is unchanged; no tolerance added');
  assert.equal(taskSectionIsRevealed(null), false);
  const detached = { ...value.element, closest: () => null };
  value.document.activeElement = detached;
  assert.equal(taskSectionIsRevealed(detached), false);
});

test('native reveal wait passes the same strict predicate to the bounded browser wait and disposes its handle', async () => {
  const value = fixture();
  let disposed = false, waited = false;
  const handle = { dispose: async () => { disposed = true; } };
  const heading = { elementHandle: async () => handle };
  await waitForTaskSectionReveal({
    waitForFunction: async (predicate: typeof taskSectionIsRevealed, argument: unknown, options: { timeout: number }) => {
      assert.equal(argument, handle);
      assert.equal(options.timeout, 5000);
      assert.equal(predicate, taskSectionIsRevealed);
      assert.equal(predicate(value.element), true);
      waited = true;
    },
  }, heading);
  assert.equal(waited, true);
  assert.equal(disposed, true);
});

test('permanent reveal failure retains the original timeout and releases the element handle', async t => {
  let disposed = false;
  const failure = new Error('Browser reveal timeout');
  const log = t.mock.method(console, 'error', () => {});
  const heading = {
    elementHandle: async () => ({ dispose: async () => { disposed = true; } }),
    evaluate: async () => ({ focused: false, activeElement: 'DIV' }),
  };
  await assert.rejects(waitForTaskSectionReveal({
    waitForFunction: async () => { throw failure; },
  }, heading), error => error === failure);
  assert.equal(log.mock.calls.length, 1);
  assert.equal(disposed, true);
});

test('a missing task section is never accepted as an already completed reveal', async () => {
  await assert.rejects(waitForTaskSectionReveal({}, { elementHandle: async () => null }), /not mounted/);
});
