import assert from 'node:assert/strict';
import test from 'node:test';
import { finalizeCapabilityDiagnostics } from '../scripts/capability-diagnostics-finalize.mjs';

test('passed is reported only after every cleanup has succeeded', async () => {
  const order: string[] = [];
  await finalizeCapabilityDiagnostics(undefined, [
    ['holder', async () => { order.push('holder'); }],
    ['app', async () => { order.push('app'); }],
  ], async result => {
    assert.deepEqual(order, ['holder', 'app']);
    assert.equal(result.passed, true);
    assert.equal(result.cleanupConfirmed, true);
  });
});

test('cleanup failure cannot be passed and does not skip other cleanup', async () => {
  const order: string[] = [], failure = new Error('private path must not be reported');
  await assert.rejects(finalizeCapabilityDiagnostics(undefined, [
    ['holder', async () => { order.push('holder'); throw failure; }],
    ['app', async () => { order.push('app'); }],
    ['server', async () => { order.push('server'); }],
  ], async result => {
    assert.deepEqual(order, ['holder', 'app', 'server']);
    assert.equal(result.passed, false);
    assert.equal(result.cleanupConfirmed, false);
    assert.equal(result.failurePhase, 'cleanup');
    assert.deepEqual(result.cleanupFailures, ['holder']);
    assert.ok(!JSON.stringify(result).includes(failure.message));
  }), error => error === failure);
});

test('operation failure remains failed even when all cleanup succeeds', async () => {
  const failure = new Error('operation');
  await assert.rejects(finalizeCapabilityDiagnostics(failure, [
    ['app', async () => {}],
  ], async result => {
    assert.equal(result.passed, false);
    assert.equal(result.cleanupConfirmed, true);
    assert.equal(result.failurePhase, 'operation');
  }), error => error === failure);
});

test('operation and all cleanup failures are retained together', async () => {
  const operation = new Error('operation'), app = new Error('app'), holder = new Error('holder');
  await assert.rejects(finalizeCapabilityDiagnostics(operation, [
    ['holder', async () => { throw holder; }],
    ['app', async () => { throw app; }],
  ], async result => {
    assert.equal(result.passed, false);
    assert.deepEqual(result.cleanupFailures, ['holder', 'app']);
  }), error => error instanceof AggregateError && assert.deepEqual(error.errors, [operation, holder, app]) === undefined);
});
