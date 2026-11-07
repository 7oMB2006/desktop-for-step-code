import test from 'node:test';
import assert from 'node:assert/strict';
import { approvalSamples } from './fixtures/theme-pack-approvals';
import { permissionApprovalPresentation } from '../src/approval-presentation';
import { planReview } from '../src/plan-review';
import { questionnaire, serializeAnswers } from '../src/questionnaire';

const samples = approvalSamples('D:\\Preview\\Stellar');
test('theme permission sample uses the real permission parser and call context', () => {
  const sample = samples[0];
  const parsed = permissionApprovalPresentation(sample.request, sample.messages, 'zh', sample.request.runtimeId);
  assert.equal(parsed?.operation, 'file');
  assert.equal(parsed?.target, 'theme/reading.json');
  assert.match(parsed?.preview ?? '', /"reading": "quiet"/);
});
test('theme plan and question samples use the native protocols', () => {
  assert.match(planReview(samples[1].request)?.content ?? '', /星辰巡航/);
  const q = questionnaire(samples[2].request)!;
  assert.equal(q.questions.length, 2);
  assert.doesNotThrow(() => serializeAnswers(q, [
    { id: 'reading', value: 'quiet', wasCustom: false },
    { id: 'details', value: '保留清晰的焦点', wasCustom: true },
  ]));
  assert.throws(() => serializeAnswers(q, []));
});
test('theme sample requests are isolated by runtime and match their tool calls', () => {
  for (const sample of samples) {
    assert.equal(sample.request.runtimeId, `preview-${sample.id}`);
    assert.ok(sample.messages.some(m => Array.isArray(m.content)
      && m.content.some(c => c.type === 'toolCall' && c.id === sample.callId && c.name === sample.toolName)));
  }
});
