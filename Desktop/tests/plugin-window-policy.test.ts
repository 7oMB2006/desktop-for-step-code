import test from 'node:test';
import assert from 'node:assert/strict';
import { pluginWindowMethodAllowed } from '../electron/plugin-window-policy';

test('plugin windows have only their own document, presentation and explicit configuration navigation', () => {
  assert.equal(pluginWindowMethodAllowed('pluginWindowState', [], 'own'), true);
  assert.equal(pluginWindowMethodAllowed('pluginDocument', [{ ref: 'own', path: 'guide.md' }], 'own'), true);
  assert.equal(pluginWindowMethodAllowed('pluginWindowConfigure', [], 'own'), true);
  for (const action of ['state', 'minimize', 'toggleMaximize', 'close'])
    assert.equal(pluginWindowMethodAllowed('windowControl', [action], 'own'), true);
});
test('plugin windows cannot read other plugins, invoke tools, change configuration or close the app', () => {
  for (const method of ['snapshot', 'capabilityCatalog', 'command', 'pluginSaveConfiguration', 'pluginChoosePath',
    'copyText', 'miniChatOpen', 'browserOpenLink', 'preferences', 'capabilityMutate'])
    assert.equal(pluginWindowMethodAllowed(method, [], 'own'), false);
  assert.equal(pluginWindowMethodAllowed('pluginDocument', [{ ref: 'other', path: 'guide.md' }], 'own'), false);
  assert.equal(pluginWindowMethodAllowed('pluginDocument', [{ ref: 'own' }], 'own'), false);
  assert.equal(pluginWindowMethodAllowed('windowControl', ['quit'], 'own'), false);
  assert.equal(pluginWindowMethodAllowed('pluginWindowState', ['other'], 'own'), false);
  assert.equal(pluginWindowMethodAllowed('pluginWindowConfigure', ['other'], 'own'), false);
});
