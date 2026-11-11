import assert from 'node:assert/strict';
import test from 'node:test';
import type { PluginConnection } from '../src/capabilities';
import { pluginConnectionPreparation, type PreparationStep } from '../src/plugin-connection-preparation';

const snapshot = (status: PluginConnection['status'], patch: Partial<PluginConnection> = {}): PluginConnection => ({
  status, roots: ['C:/fixture/project'], tasks: [], ...patch,
});
const unchecked: PreparationStep[] = [
  { id: 'profile', result: 'unchecked', tone: 'neutral', action: 'choose' },
  { id: 'companion', result: 'unchecked', tone: 'neutral', action: 'setup' },
  { id: 'bridge', result: 'unchecked', tone: 'neutral', action: 'setup' },
  { id: 'roots', result: 'unchecked', tone: 'neutral', action: 'setup' },
];
const expected = (changes: Partial<Record<PreparationStep['id'], Partial<PreparationStep>>>): PreparationStep[] =>
  unchecked.map(step => ({ ...step, ...changes[step.id] }));
const found = { result: 'found', tone: 'verified' } as const;
const configured = { result: 'configured', tone: 'verified' } as const;

test('preparation without an observation keeps every checkpoint unchecked', () => {
  assert.deepEqual(pluginConnectionPreparation(), unchecked);
});

const cases: Record<PluginConnection['status'], PreparationStep[]> = {
  unselected: unchecked,
  'profile-missing': expected({ profile: { result: 'missing', tone: 'attention' } }),
  'companion-missing': expected({
    profile: found, companion: { result: 'missing', tone: 'attention' },
  }),
  'configuration-invalid': expected({
    profile: found, companion: { result: 'invalid', tone: 'attention', action: 'troubleshooting' },
  }),
  'pairing-required': expected({
    profile: found, companion: configured, bridge: { result: 'pairing', tone: 'attention' },
  }),
  'connection-unavailable': expected({
    profile: found, companion: configured,
    bridge: { result: 'unavailable', tone: 'attention', action: 'troubleshooting' },
  }),
  'identity-mismatch': expected({
    profile: found, companion: configured,
    bridge: { result: 'mismatch', tone: 'attention', action: 'troubleshooting' },
  }),
  ready: expected({
    profile: found, companion: configured, bridge: { result: 'verified', tone: 'verified' },
    roots: { result: 'authorized', tone: 'verified' },
  }),
};
for (const [status, result] of Object.entries(cases)) {
  test(`${status} preparation exposes only observed checkpoints with the appropriate next action`, () => {
    assert.deepEqual(pluginConnectionPreparation(snapshot(status as PluginConnection['status'])), result);
  });
}

test('invalid configuration never certifies the companion, bridge or authorized roots', () => {
  const result = pluginConnectionPreparation(snapshot('configuration-invalid'));
  assert.equal(result[0].result, 'found', 'profile evidence is only a found profile marker');
  assert.deepEqual(result.slice(1).map(step => step.tone), ['attention', 'neutral', 'neutral']);
  assert.equal(result[1].result, 'invalid');
  assert.equal(result[2].result, 'unchecked');
  assert.equal(result[3].result, 'unchecked');
});

test('pairing prerequisites report configuration evidence rather than a running companion or ready bridge', () => {
  const result = pluginConnectionPreparation(snapshot('pairing-required'));
  assert.deepEqual(result.map(step => step.result), ['found', 'configured', 'pairing', 'unchecked']);
  assert.equal(result[0].action, 'choose');
  assert.equal(result[1].action, 'setup');
  assert.equal(result[2].action, 'setup');
  assert.ok(result.every(step => !['installed', 'loaded', 'running', 'task-ready'].includes(step.result)));
});

test('a verified read-only connection with no intersected roots still requires directory preparation', () => {
  const result = pluginConnectionPreparation(snapshot('ready', { roots: [] }));
  assert.equal(result[2].result, 'verified');
  assert.deepEqual(result[3], { id: 'roots', result: 'no-roots', tone: 'attention', action: 'setup' });
  assert.notEqual(result[3].tone, 'verified');
});

test('completed or accepted task summaries never certify the first task or add a task checkpoint', () => {
  const state = snapshot('ready', { tasks: [
    { id: 'one', title: 'Completed task', phase: 'completed', cwd: 'C:/fixture/project' },
    { id: 'two', title: 'Accepted task', phase: 'accepted', cwd: 'C:/fixture/project' },
  ] });
  const result = pluginConnectionPreparation(state);
  assert.deepEqual(result, pluginConnectionPreparation(snapshot('ready')));
  assert.deepEqual(result.map(step => step.id), ['profile', 'companion', 'bridge', 'roots']);
  assert.ok(result.every(step => step.action !== 'firstTask'));
});

test('preparation leaves frozen input untouched and returns independent steps for each call', () => {
  const state = snapshot('ready', { profile: 'C:/fixture/profile', agentId: 'fixture', checkedAt: 123,
    tasks: [{ id: 'one', title: 'Task', phase: 'running', cwd: 'C:/fixture/project' }] });
  const before = structuredClone(state);
  for (const task of state.tasks) Object.freeze(task);
  Object.freeze(state.tasks);
  Object.freeze(state.roots);
  Object.freeze(state);
  const first = pluginConnectionPreparation(state), second = pluginConnectionPreparation(state);
  assert.deepEqual(state, before);
  assert.deepEqual(first, second);
  assert.notEqual(first, second);
  for (const [index, step] of first.entries()) assert.notEqual(step, second[index]);
  first[0].result = 'missing';
  first.push({ id: 'roots', result: 'unchecked', tone: 'neutral', action: 'setup' });
  assert.deepEqual(pluginConnectionPreparation(state), second);
  assert.deepEqual(state, before);
  const initial = pluginConnectionPreparation(), following = pluginConnectionPreparation();
  initial[0].result = 'missing';
  assert.deepEqual(following, unchecked);
});
