import test from 'node:test';
import assert from 'node:assert/strict';
import { providerDiscoveryError } from '../src/provider-discovery-error';

test('discovery errors recognize safe labels through IPC wrappers without reflecting secrets', () => {
  for (const language of ['zh', 'en']) {
    for (const status of [401, 403, 404, 429, 500]) {
      const message = providerDiscoveryError(new Error(`Error invoking remote method: Error: Model discovery HTTP ${status}; private-key`), language);
      assert.match(message, new RegExp(`HTTP ${status}`));
      assert.equal(message.includes('private-key'), false);
    }
    assert.match(providerDiscoveryError(new Error('Error: Model discovery timed out'), language), /15/);
    for (const error of [new Error('private-key https://private-path'), undefined, 'private-key', {}]) {
      const message = providerDiscoveryError(error, language);
      assert.equal(message.includes('private-key'), false);
      assert.equal(message.includes('private-path'), false);
    }
  }
});
