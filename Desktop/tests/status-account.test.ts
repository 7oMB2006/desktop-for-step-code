import test from 'node:test';
import assert from 'node:assert/strict';
import { statusAccount } from '../electron/status-account';

test('Status projects only the applied account method, region and numeric identity', () => {
  for (const [profile, mode, region] of [
    ['step_plan', 'plan', 'cn'], ['step_plan_oversea', 'plan', 'global'],
    ['platform_cn', 'api', 'cn'], ['platform_oversea', 'api', 'global'],
  ]) {
    assert.deepEqual(statusAccount({ step: { type: 'oauth', profile, access: 'secret', refresh: 'refresh', uid: '12345' } }),
      { mode, region, userId: '12345' });
  }
  assert.deepEqual(statusAccount({ step: { type: 'oauth', access: 'secret' } }), { mode: 'plan', region: 'cn' });
});

test('Status does not pass arbitrary credential fields or infer unknown account profiles', () => {
  assert.deepEqual(statusAccount({ step: { type: 'oauth', access: 'secret', profile: 'future-profile', uid: '123' } }), { mode: 'unknown' });
  assert.deepEqual(statusAccount({ step: { type: 'oauth', access: 'secret', uid: 'sk-secret' } }), { mode: 'plan', region: 'cn' });
  for (const step of [undefined, [], 'secret', { type: 'oauth', access: '' }, { type: 'api_key', key: 'secret' }])
    assert.deepEqual(statusAccount({ step }), { mode: 'none' });
});
