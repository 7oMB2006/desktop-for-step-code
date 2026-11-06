import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createContext, runInContext } from 'node:vm';

const { observeGoalClear, launchFailureDiagnostics, restoreGoalClearObservation } = await import(
  new URL('../scripts/launch-failure-diagnostics.mjs', import.meta.url).href);

function fixture() {
  const originalError = new Error('fixture-private-value');
  const calls: unknown[][] = [];
  const original = async (...args: unknown[]) => {
    calls.push(args);
    if (args[3] === 'reject') throw originalError;
    return { accepted: true };
  };
  const handlers = new Map<string, (...args: unknown[]) => Promise<unknown>>([['desktop', original]]);
  const listeners = new Map<string, (event: unknown) => void>();
  const main = { ipcMain: { _invokeHandlers: handlers } };
  const renderer = {
    document: {
      addEventListener(type: string, listener: (event: unknown) => void) { listeners.set(type, listener); },
      removeEventListener(type: string) { listeners.delete(type); },
      querySelector() { return undefined; }, querySelectorAll() { return []; },
    },
    window: { desktop: { snapshot: async () => ({ runtimeId: 'runtime', state: { sessionId: 'session', isStreaming: false },
      launch: { goal: { id: 'goal', status: 'complete', objective: 'fixture-private-value' } }, messages: ['fixture-private-value'], requests: [] }) } },
  };
  const mainContext = createContext(main), pageContext = createContext(renderer);
  const app = { evaluate: async (fn: Function, argument: unknown) => {
    (main as any).input = main; (main as any).argument = argument;
    return runInContext(`(${fn.toString()})(input, argument)`, mainContext);
  } };
  const page = { evaluate: async (fn: Function, argument: unknown) => {
    (renderer as any).argument = argument;
    return runInContext(`(${fn.toString()})(argument)`, pageContext);
  } };
  return { app, page, handlers, original, originalError, calls, renderer, listeners };
}

test('clear observation forwards exact requests and results, then restores its own handler', async () => {
  const value = fixture();
  await observeGoalClear(value.app, value.page);
  const handler = value.handlers.get('desktop')!;
  const args = [null, 'command', 'goal_action', { action: 'clear' }, 'runtime'];
  assert.deepEqual(await handler(...args), { accepted: true });
  assert.deepEqual(value.calls, [args]);
  const diagnostic = await launchFailureDiagnostics(value.app, value.page, 20);
  assert.equal(diagnostic.ipc.length, 1);
  assert.equal(diagnostic.ipc[0].outcome, 'resolved');
  assert.equal(diagnostic.runtime.goalStatus, 'complete');
  assert.doesNotMatch(JSON.stringify(diagnostic), /fixture-private-value/);
  await restoreGoalClearObservation(value.app, value.page, 20);
  assert.equal(value.handlers.get('desktop'), value.original);
  assert.equal(value.listeners.size, 0);
});

test('observation preserves original command rejection and does not log its raw text', async () => {
  const value = fixture();
  await observeGoalClear(value.app, value.page);
  const handler = value.handlers.get('desktop')!;
  await assert.rejects(handler(null, 'command', 'goal_action', 'reject'), error => error === value.originalError);
  // A recognized clear refusal is still forwarded without rewriting the error.
  const rejecting = async () => { throw value.originalError; };
  value.handlers.set('desktop', rejecting);
  await observeGoalClear(value.app, value.page);
  await assert.rejects(value.handlers.get('desktop')!(null, 'command', 'goal_action', { action: 'clear' }), error => error === value.originalError);
  const diagnostic = await launchFailureDiagnostics(value.app, value.page, 20);
  assert.equal(diagnostic.ipc[0].outcome, 'rejected');
  assert.equal(diagnostic.ipc[0].reason, 'other');
  assert.doesNotMatch(JSON.stringify(diagnostic), /fixture-private-value/);
  await restoreGoalClearObservation(value.app, value.page, 20);
});

test('restoring observation cannot overwrite a newer desktop handler', async () => {
  const value = fixture();
  await observeGoalClear(value.app, value.page);
  const newer = async () => ({ newer: true });
  value.handlers.set('desktop', newer);
  await restoreGoalClearObservation(value.app, value.page, 20);
  assert.equal(value.handlers.get('desktop'), newer);
  assert.equal(value.listeners.size, 0);
});

test('never-settling main and renderer observations return bounded timeout evidence', async () => {
  const pending = { evaluate: () => new Promise(() => {}) };
  const diagnostic = await launchFailureDiagnostics(pending, pending, 10);
  assert.deepEqual(diagnostic, { ipc: { timeout: true }, ui: { timeout: true }, runtime: { timeout: true } });
  await restoreGoalClearObservation(pending, pending, 10);
});

test('failed observations are unavailable rather than replacing the caller failure', async () => {
  const rejected = { evaluate: () => Promise.reject(new Error('fixture-private-value')) };
  assert.deepEqual(await launchFailureDiagnostics(rejected, undefined, 10), {
    ipc: { unavailable: true }, ui: { unavailable: true }, runtime: { unavailable: true },
  });
});
