import assert from 'node:assert/strict';
import test from 'node:test';

const { prepareDispatchInput, taskSectionIsRevealed, waitForTaskSectionReveal } = await import(
  new URL('../scripts/command-dispatch-fixture.mjs', import.meta.url).href);

function dispatchFixture(menuExpected = true) {
  const events: string[] = [];
  let value = '', menuReady = false, expanded = false, menuMounted = false, disposed = false;
  const handle = {
    get value() { return value; },
    getAttribute: () => String(expanded),
    closest: () => ({ querySelector: () => menuMounted ? {} : null }),
    dispose: async () => { disposed = true; },
  };
  const input = {
    fill: async (text: string) => { value = text; events.push('fill'); },
    elementHandle: async () => handle,
    press: async (key: string) => {
      assert.equal(key, 'Escape', 'Preparing input never submits or retries a command');
      assert.ok(!menuExpected || menuReady, 'Escape must not race ahead of menu readiness');
      events.push('Escape'); expanded = false; menuMounted = false;
    },
  };
  const page = {
    locator: (selector: string) => {
      assert.equal(selector, '.composer-discovery[data-mode="commands"]');
      return { getByText: (text: string, options: { exact: boolean }) => {
        assert.equal(options.exact, true);
        return { waitFor: async ({ timeout }: { timeout: number }) => {
          assert.equal(timeout, 5000);
          events.push(`ready:${text}`); menuReady = true; expanded = true; menuMounted = true;
        } };
      } };
    },
    waitForFunction: async (predicate: (argument: unknown) => boolean,
      argument: { element: typeof handle; text: string }, options: { timeout: number }) => {
      events.push('dismissed');
      assert.equal(argument.element, handle);
      assert.equal(options.timeout, 5000);
      assert.equal(predicate(argument), true);
      expanded = true;
      assert.equal(predicate(argument), false, 'An open menu cannot be treated as dismissed');
      expanded = false; menuMounted = true;
      assert.equal(predicate(argument), false, 'The menu must actually unmount');
      menuMounted = false; value += ' ';
      assert.equal(predicate(argument), false, 'Autocomplete must not silently replace the intended input');
    },
  };
  return { page, input, events, disposed: () => disposed };
}

test('dispatch waits for delayed completion readiness before Escape, without submitting or changing text', async () => {
  for (const text of ['/todos', 'Explain /todos']) {
    const value = dispatchFixture();
    await prepareDispatchInput(value.page, value.input, text);
    assert.deepEqual(value.events, ['fill', 'ready:/todos', 'Escape', 'dismissed']);
    assert.equal(value.disposed(), true);
  }
});

test('parameterized commands and ordinary prose do not wait for a nonexistent completion', async () => {
  for (const text of ['/compact keep interfaces', '/todos list', 'Explain task plans']) {
    const value = dispatchFixture(false);
    await prepareDispatchInput(value.page, value.input, text);
    assert.deepEqual(value.events, ['fill', 'Escape', 'dismissed']);
    assert.equal(value.disposed(), true);
  }
});

test('a completion readiness failure prevents Escape and retains the original error', async () => {
  const value = dispatchFixture();
  const failure = new Error('Completion menu did not appear');
  value.page.locator = () => ({ getByText: () => ({ waitFor: async () => { throw failure; } }) });
  await assert.rejects(prepareDispatchInput(value.page, value.input, '/todos'), error => error === failure);
  assert.deepEqual(value.events, ['fill']);
});

test('a dismissal failure releases the input handle and never retries', async () => {
  const value = dispatchFixture();
  const failure = new Error('Completion menu did not close');
  value.page.waitForFunction = async () => { throw failure; };
  await assert.rejects(prepareDispatchInput(value.page, value.input, '/todos'), error => error === failure);
  assert.deepEqual(value.events, ['fill', 'ready:/todos', 'Escape']);
  assert.equal(value.disposed(), true);
});

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
