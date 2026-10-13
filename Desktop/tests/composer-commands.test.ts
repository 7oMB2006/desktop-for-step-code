import test from 'node:test';
import assert from 'node:assert/strict';
import { desktopCommands } from '../src/composer-commands';

test('Desktop discovers the pinned core CLM commands absent from upstream get_commands', () => {
  const original = [{ name: 'goal', source: 'extension' }, { name: 'daily', source: 'prompt' },
    { name: 'skill:review', source: 'skill' }, { name: '_desktop_retry', source: 'extension' }];
  const result = desktopCommands(original);
  assert.deepEqual(result.map(command => command.name), ['goal', 'daily', 'skill:review', 'clm', 'clm-compact']);
  assert.ok(result.filter(command => command.name.startsWith('clm')).every(command => command.source === 'core'));
  assert.equal(original.length, 4, 'Catalog projection does not mutate the runtime reply');
});

test('Core CLM handlers take precedence over same-name catalog entries without duplicates', () => {
  const result = desktopCommands([{ name: 'clm', source: 'prompt' }, { name: 'clm-compact', source: 'extension' }]);
  assert.deepEqual(result.map(command => command.name), ['clm', 'clm-compact']);
  assert.ok(result.every(command => command.source === 'core'));
  assert.deepEqual(desktopCommands(result), result, 'Repeated projection remains idempotent');
  result[0].description = 'changed';
  assert.notEqual(desktopCommands([])[0].description, 'changed');
});
