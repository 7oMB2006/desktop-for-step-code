import test from 'node:test';
import assert from 'node:assert/strict';
import { capabilityCommand } from '../src/capability-command';

test('management commands route to settings without treating ordinary prompts as commands', () => {
  assert.deepEqual(capabilityCommand(' /plugin \n'), { page: 'plugins', tab: 'installed' });
  assert.deepEqual(capabilityCommand('/plugin browse'), { page: 'plugins', tab: 'discover' });
  assert.deepEqual(capabilityCommand('/mcp'), { page: 'mcp' });
  assert.deepEqual(capabilityCommand('/skills'), { page: 'skills' });
  for (const value of ['explain /plugin', '/pluginx', '/mcp add', '/skill:review', '/skills review'])
    assert.equal(capabilityCommand(value), null);
  assert.equal(capabilityCommand('/plugin', 1), null);
  assert.equal(capabilityCommand('/plugin', 0, 1), null);
});
test('plugin actions only prepare a filtered review page and marketplace sources are preserved', () => {
  assert.deepEqual(capabilityCommand('/plugin install example@official'), { page: 'plugins', tab: 'discover', query: 'example' });
  assert.deepEqual(capabilityCommand('/plugin uninstall example'), { page: 'plugins', tab: 'installed', query: 'example' });
  assert.deepEqual(capabilityCommand('/plugin marketplace add "D:\\My market"'),
    { page: 'plugins', tab: 'sources', source: 'D:\\My market' });
  assert.deepEqual(capabilityCommand('/plugin marketplace remove example'), { page: 'plugins', tab: 'sources', query: 'example' });
});
