import assert from 'node:assert/strict';
import test from 'node:test';
import { mergeRuntimeAuth, runtimeAuth } from '../electron/custom-providers';
import { PLUGIN_HOST_ACCOUNT_FIELD, pluginHostAccount, withPluginHostAccount } from '../electron/plugin-host-account';

const credential = { type: 'oauth', profile: 'step_plan', access: 'fixture', uid: '42', expires: Date.now() + 3600000 };

test('account continuity requires verified refresh of the identical official identity', () => {
  const initial = withPluginHostAccount({ step: credential });
  const id = pluginHostAccount(initial)?.binding.id;
  assert.ok(id);
  const next = { step: { ...credential, access: 'refreshed' } };
  assert.equal(pluginHostAccount(withPluginHostAccount(next, initial, true))?.binding.id, id);
  assert.notEqual(pluginHostAccount(withPluginHostAccount(next, initial))?.binding.id, id);
  assert.notEqual(pluginHostAccount(withPluginHostAccount({ step: { ...next.step, uid: '43' } }, initial, true))?.binding.id, id);
  assert.equal(pluginHostAccount({ ...initial, ...next }), undefined, 'A legacy writer cannot keep a modified credential bound');
  assert.equal(pluginHostAccount(withPluginHostAccount({}, initial)), undefined);
  const noUid = withPluginHostAccount({ step: { ...credential, uid: undefined } });
  const refreshed = withPluginHostAccount({ step: { ...next.step, uid: undefined } }, noUid, true);
  assert.notEqual(pluginHostAccount(noUid)?.binding.id, pluginHostAccount(refreshed)?.binding.id);
});

test('broker account identity never enters runtime auth and cannot be provided by runtime', () => {
  const auth = withPluginHostAccount({ step: credential });
  assert.deepEqual(runtimeAuth(auth), { step: credential });
  assert.deepEqual(mergeRuntimeAuth(auth, { step: credential, [PLUGIN_HOST_ACCOUNT_FIELD]: 'injected' }), { step: credential });
});
