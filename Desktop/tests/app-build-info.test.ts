import assert from 'node:assert/strict';
import test from 'node:test';
import { bundledStepCode } from '../electron/app-build-info';
import { commit as v017 } from '../../patches/v017/manifest.json';
import { commit as v018 } from '../../patches/v018/manifest.json';

test('labels only known bundled source commits as Desktop integration baselines', () => {
  assert.deepEqual(bundledStepCode({ commit: v017 }), { commit: v017, baseline: 'v0.1.7' });
  assert.deepEqual(bundledStepCode({ commit: v018 }), { commit: v018, baseline: 'v0.1.8' });
  const unknown = 'a'.repeat(40);
  assert.deepEqual(bundledStepCode({ commit: unknown, baseline: 'v0.1.8' }), { commit: unknown, baseline: undefined });
  assert.equal(bundledStepCode({ commit: 'not-a-commit' }), null);
  assert.equal(bundledStepCode(null), null);
});
