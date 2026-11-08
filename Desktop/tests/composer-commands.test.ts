import test from 'node:test';
import assert from 'node:assert/strict';
import { desktopCommand, desktopCommands, isStatusCommand } from '../src/composer-commands';

test('Desktop discovers the pinned core CLM commands absent from upstream get_commands', () => {
  const original = [{ name: 'goal', source: 'extension' }, { name: 'daily', source: 'prompt' },
    { name: 'skill:review', source: 'skill' }, { name: '_desktop_retry', source: 'extension' }];
  const result = desktopCommands(original);
  assert.deepEqual(result.map(command => command.name), ['goal', 'daily', 'skill:review', 'status', 'plugin', 'mcp', 'skills', 'clm', 'clm-compact', 'trust', 'compact', 'btw', 'todos', 'init']);
  assert.ok(result.filter(command => command.name.startsWith('clm')).every(command => command.source === 'core'));
  assert.equal(original.length, 4, 'Catalog projection does not mutate the runtime reply');
});

test('Core CLM handlers take precedence over same-name catalog entries without duplicates', () => {
  const result = desktopCommands([{ name: 'clm', source: 'prompt' }, { name: 'clm-compact', source: 'extension' }]);
  assert.deepEqual(result.map(command => command.name), ['status', 'plugin', 'mcp', 'skills', 'clm', 'clm-compact', 'trust', 'compact', 'btw', 'todos', 'init']);
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
    ['/cron', 'cron', ''], ['/clm', 'clm', ''], ['/workflows', 'workflows', ''], ['/compact keep protocol\nand tests', 'compact', 'keep protocol\nand tests'],
    ['/btw', 'btw', ''], ['/btw explain the tradeoff\nbriefly', 'btw', 'explain the tradeoff\nbriefly'],
    [' /todos \n', 'todos', ''],
  ]) assert.deepEqual(desktopCommand(message), { name, args });
  for (const message of ['explain /usage', 'explain /workflows', '/workflows extra', '/workflow', '/cron list', '/cron delete job', '/usage other', '/status extra', '/compactness', '/clm on', '/clm diff', '/clm-compact', '/todos list', '/todos\nhelp', 'explain /todos', '/todosx', '/todo', '`/todos`', '```\n/todos\n```', '/todos\n/status']) {
    assert.equal(desktopCommand(message), undefined, message);
  }
  for (const message of ['/usage', '/cron', '/compact keep notes', '/status', '/clm', '/workflows', '/btw question', '/todos']) {
    assert.equal(desktopCommand(message, 1), undefined);
    assert.equal(desktopCommand(message, 0, 1), undefined);
  }
});

test('task-plan shortcut is discoverable before starting a worker and replaces the upstream notification once', () => {
  assert.equal(desktopCommands([]).find(command => command.name === 'todos')?.source, 'desktop');
  const catalog = desktopCommands([{ name: 'todos', source: 'extension' }, { name: 'skill:todos', source: 'skill' },
    { name: 'daily-todos', source: 'prompt' }]);
  assert.deepEqual(catalog.filter(command => command.name === 'todos'), [
    { name: 'todos', source: 'desktop', description: 'Open the current task plan and completed history in the right panel' },
  ]);
  assert.equal(catalog.find(command => command.name === 'skill:todos')?.source, 'skill');
  assert.equal(catalog.find(command => command.name === 'daily-todos')?.source, 'prompt');
  assert.deepEqual(desktopCommands(catalog), catalog);
});

test('Desktop compact is discoverable and overrides a same-name entry only once', () => {
  const catalog = desktopCommands([{ name: 'compact', source: 'extension' }]);
  assert.deepEqual(catalog.filter(command => command.name === 'compact'), [
    { name: 'compact', source: 'desktop', description: 'Compact the current conversation with optional retention instructions' },
  ]);
  assert.deepEqual(desktopCommands(catalog), catalog);
});

test('capability management commands are discoverable without a runtime and replace upstream entries', () => {
  const names = ['plugin', 'mcp', 'skills'];
  const draft = desktopCommands([]).filter(command => command.source === 'desktop');
  for (const name of names) assert.equal(draft.filter(command => command.name === name).length, 1, name);
  const catalog = desktopCommands(names.map(name => ({ name, source: 'extension' })));
  for (const name of names) {
    assert.equal(catalog.filter(command => command.name === name).length, 1);
    assert.equal(catalog.find(command => command.name === name)?.source, 'desktop');
  }
  assert.deepEqual(desktopCommands(catalog), catalog);
});

test('project rules are discoverable in drafts without duplicating or changing a discovered source', () => {
  assert.equal(desktopCommands([]).find(command => command.name === 'init')?.source, 'desktop');
  for (const source of ['extension', 'prompt', 'skill']) {
    const discovered = { name: 'init', source, description: 'Discovered init' };
    const catalog = desktopCommands([discovered]);
    assert.deepEqual(catalog.filter(command => command.name === 'init'), [discovered]);
    assert.deepEqual(desktopCommands(catalog), catalog);
  }
});
