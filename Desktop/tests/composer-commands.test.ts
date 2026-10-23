import test from 'node:test';
import assert from 'node:assert/strict';
import { desktopCommands, isStatusCommand } from '../src/composer-commands';

test('Desktop discovers the pinned core CLM commands absent from upstream get_commands', () => {
  const original = [{ name: 'goal', source: 'extension' }, { name: 'daily', source: 'prompt' },
    { name: 'skill:review', source: 'skill' }, { name: '_desktop_retry', source: 'extension' }];
  const result = desktopCommands(original);
  assert.deepEqual(result.map(command => command.name), ['goal', 'daily', 'skill:review', 'status', 'plugin', 'skills', 'clm', 'clm-compact', 'trust']);
  assert.ok(result.filter(command => command.name.startsWith('clm')).every(command => command.source === 'core'));
  assert.equal(original.length, 4, 'Catalog projection does not mutate the runtime reply');
});

test('Core CLM handlers take precedence over same-name catalog entries without duplicates', () => {
  const result = desktopCommands([{ name: 'clm', source: 'prompt' }, { name: 'clm-compact', source: 'extension' }]);
  assert.deepEqual(result.map(command => command.name), ['status', 'plugin', 'skills', 'clm', 'clm-compact', 'trust']);
  assert.ok(result.filter(command => command.name.startsWith('clm')).every(command => command.source === 'core'));
  assert.deepEqual(desktopCommands(result), result, 'Repeated projection remains idempotent');
  result[0].description = 'changed';
  assert.notEqual(desktopCommands([])[0].description, 'changed');
});

test('Desktop status replaces the upstream entry once and only consumes a standalone command', () => {
  const catalog = desktopCommands([{ name: 'status', source: 'extension' }]);
  assert.equal(catalog.filter(command => command.name === 'status').length, 1);
  assert.equal(catalog.find(command => command.name === 'status')?.source, 'desktop');
  assert.equal(isStatusCommand(' /status \n'), true);
  for (const value of ['/status details', 'explain /status', '/statusx', '']) assert.equal(isStatusCommand(value), false);
  assert.equal(isStatusCommand('/status', 1), false);
  assert.equal(isStatusCommand('/status', 0, 1), false);
});

test('Desktop trust entry takes precedence over same-name runtime commands', () => {
  const commands = desktopCommands([{ name: 'trust', source: 'prompt' }]);
  assert.deepEqual(commands.filter(command => command.name === 'trust'), [
    { name: 'trust', source: 'desktop', description: 'Approve project trust for future runtime launches' },
  ]);
  assert.deepEqual(desktopCommands(commands), commands);
});
