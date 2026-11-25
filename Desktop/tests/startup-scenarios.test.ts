import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  previewScenario, scenarioPhase, scenarioSurface, SCENARIO_FAILURE_MS, SCENARIO_TIMEOUT_MS, SLOW_NOTICE_MS,
} from './fixtures/startup-scenario-model';
import { STARTUP_FINISH_TIMEOUT_MS } from '../src/startup-motion';

test('normal startup waits for both simulated readiness and the real entrance, with an animation deadline', () => {
  assert.equal(scenarioPhase('normal', 0, false), 'opening');
  assert.equal(scenarioPhase('normal', 650, true), 'waiting');
  assert.equal(scenarioPhase('normal', 900, true), 'handoff');
  assert.equal(scenarioPhase('normal', 2800, false), 'opening');
  assert.equal(scenarioPhase('normal', STARTUP_FINISH_TIMEOUT_MS, false), 'handoff');
});

test('slow startup holds the settled logo and gives a slow notice before eventual readiness', () => {
  assert.equal(scenarioPhase('slow', 2900, true), 'waiting');
  assert.equal(scenarioPhase('slow', SLOW_NOTICE_MS, true), 'delayed');
  assert.equal(scenarioPhase('slow', 7999, true), 'delayed');
  assert.equal(scenarioPhase('slow', 8000, true), 'handoff');
});

test('hung initialization never pretends to be ready, and continuing waiting has another bounded interval', () => {
  assert.equal(scenarioPhase('timeout', 9000, true), 'delayed');
  assert.equal(scenarioPhase('timeout', SCENARIO_TIMEOUT_MS, true), 'timeout');
  assert.equal(scenarioPhase('timeout', SCENARIO_TIMEOUT_MS, true, SCENARIO_TIMEOUT_MS), 'waiting');
  assert.equal(scenarioPhase('timeout', 14000, true, SCENARIO_TIMEOUT_MS), 'delayed');
  assert.equal(scenarioPhase('timeout', 20000, true, SCENARIO_TIMEOUT_MS), 'timeout');
  assert.equal(scenarioPhase('timeout', 900000, true), 'timeout');
});

test('an explicit initialization failure is not held by a broken animation', () => {
  assert.equal(scenarioPhase('failure', SCENARIO_FAILURE_MS - 1, true), 'delayed');
  assert.equal(scenarioPhase('failure', SCENARIO_FAILURE_MS, false), 'failed');
  assert.equal(scenarioPhase('failure', 100000, true), 'failed');
});

test('animation degradation cannot block a simulated ready shell', () => {
  assert.equal(scenarioPhase('animation', 1000, true), 'waiting');
  assert.equal(scenarioPhase('animation', 4500, false), 'handoff');
  assert.equal(previewScenario('animation'), 'animation');
  for (const value of [null, 'unknown', '__proto__', 'constructor']) assert.equal(previewScenario(value), 'normal');
});

test('normal startup has no floating text, while slow and failed startup have opaque local surfaces', () => {
  assert.equal(scenarioSurface('opening', 0, 0, false), 'transparent');
  assert.equal(scenarioSurface('waiting', 3000, 0, false), 'transparent');
  assert.equal(scenarioSurface('handoff', 3000, 0, false), 'transparent');
  assert.equal(scenarioSurface('delayed', 4000, 0, false), 'notice');
  assert.equal(scenarioSurface('waiting', 12000, 12000, false), 'notice');
  assert.equal(scenarioSurface('handoff', 8000, 0, false), 'notice');
  assert.equal(scenarioSurface('timeout', 10000, 0, false), 'recovery');
  assert.equal(scenarioSurface('failed', 4200, 0, false), 'recovery');
  assert.equal(scenarioSurface('handoff', 3000, 0, true), 'recovery');
});
