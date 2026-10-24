import test from 'node:test';
import assert from 'node:assert/strict';
import { desktopCommand, desktopCommands, isStatusCommand } from '../src/composer-commands';

test('Desktop discovers the pinned core CLM commands absent from upstream get_commands', () => {
  const original = [{ name: 'goal', source: 'extension' }, { name: 'daily', source: 'prompt' },
    { name: 'skill:review', source: 'skill' }, { name: '_desktop_retry', source: 'extension' }];
  const result = desktopCommands(original);
  assert.deepEqual(result.map(command => command.name), ['goal', 'daily', 'skill:review', 'status', 'clm', 'clm-compact', 'trust', 'compact']);
  assert.ok(result.filter(command => command.name.startsWith('clm')).every(command => command.source === 'core'));
  assert.equal(original.length, 4, 'Catalog projection does not mutate the runtime reply');
});

test('Core CLM handlers take precedence over same-name catalog entries without duplicates', () => {
  const result = desktopCommands([{ name: 'clm', source: 'prompt' }, { name: 'clm-compact', source: 'extension' }]);
  assert.deepEqual(result.map(command => command.name), ['status', 'clm', 'clm-compact', 'trust', 'compact']);
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

test('only complete supported standalone commands select a Desktop action', () => {
  for (const [message, name, args] of [
    [' /status \n', 'status', ''], ['/usage', 'usage', ''],
    ['/usage overview', 'usage', 'overview'], ['/usage account', 'usage', 'account'],
    ['/cron', 'cron', ''], ['/clm', 'clm', ''], ['/compact keep protocol\nand tests', 'compact', 'keep protocol\nand tests'],
  ]) assert.deepEqual(desktopCommand(message), { name, args });
  for (const message of ['explain /usage', '/cron list', '/cron delete job', '/usage other', '/status extra', '/compactness', '/clm on', '/clm diff', '/clm-compact']) {
    assert.equal(desktopCommand(message), undefined, message);
  }
  for (const message of ['/usage', '/cron', '/compact keep notes', '/status', '/clm']) {
    assert.equal(desktopCommand(message, 1), undefined);
    assert.equal(desktopCommand(message, 0, 1), undefined);
  }
});

test('Desktop compact is discoverable and overrides a same-name entry only once', () => {
  const catalog = desktopCommands([{ name: 'compact', source: 'extension' }]);
  assert.deepEqual(catalog.filter(command => command.name === 'compact'), [
    { name: 'compact', source: 'desktop', description: 'Compact the current conversation with optional retention instructions' },
  ]);
  assert.deepEqual(desktopCommands(catalog), catalog);
});
