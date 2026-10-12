import test from 'node:test';
import assert from 'node:assert/strict';
import { isFullAccessRisk, fullAccessRiskPresentation } from '../src/full-access-risk';
import type { UIRequest } from '../src/contracts';

const request: UIRequest = {
  type: 'extension_ui_request', id: 'risk-1', method: 'select',
  title: 'Enable full access?\n\nRisk message',
  options: [
    'Yes, continue anyway \u2014 apply full access for this session',
    "Yes, and don't ask again \u2014 enable full access and remember this choice",
    'Cancel \u2014 go back without enabling full access',
  ],
};
test('Full Access risk presentation localizes exact upstream choices without changing response values', () => {
  const before = structuredClone(request);
  assert.equal(isFullAccessRisk(request), true);
  assert.equal(fullAccessRiskPresentation(request, 'zh')?.title, '启用完全访问？');
  assert.match(fullAccessRiskPresentation(request, 'zh')!.message, /危险.*信息泄露/);
  assert.deepEqual(fullAccessRiskPresentation(request, 'en')?.labels,
    ['Enable for this session', 'Enable and remember', 'Cancel, keep current permissions']);
  assert.deepEqual(request, before);
});
test('unknown, altered or tool-owned selects are not mistaken for a Full Access grant', () => {
  for (const item of [
    undefined, { ...request, method: 'confirm' }, { ...request, title: 'Enable full access?' },
    { ...request, options: ['Yes', 'No'] }, { ...request, options: [...request.options!].reverse() },
    { ...request, title: 'Choose a tool option' },
  ]) assert.equal(fullAccessRiskPresentation(item, 'zh'), undefined);
});
