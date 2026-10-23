import test from 'node:test';
import assert from 'node:assert/strict';
import { assertPluginUnused } from '../electron/capability-service';

const worker = (mcp: { name: string; status: string }[]) => ({ rpc: {
  request: async (type: string) => { assert.equal(type, 'get_desktop_summary'); return { mcp }; },
} });
test('plugin removal requires all resident sessions to release their own namespaced MCP services', async () => {
  for (const status of ['connected', 'connecting', 'failed', 'unknown'])
    await assert.rejects(assertPluginUnused('example', [worker([{ name: 'example__tools', status }])]), /resource-in-use/);
  await assertPluginUnused('example', [
    worker([{ name: 'example__tools', status: 'disabled' }]),
    worker([{ name: 'other__tools', status: 'connected' }, { name: 'example-two__tools', status: 'connected' }]),
  ]);
  await assertPluginUnused('example', []);
});
test('missing or failed runtime observation does not authorize deleting plugin files', async () => {
  await assert.rejects(assertPluginUnused('example', [{ rpc: { request: async () => undefined } }]), /resource-in-use/);
  await assert.rejects(assertPluginUnused('example', [{ rpc: { request: async () => { throw new Error('Unavailable'); } } }]), /resource-in-use/);
});
