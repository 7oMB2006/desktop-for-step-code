import test from 'node:test';
import assert from 'node:assert/strict';
import { questionnaire, questionsFrom, serializeAnswers, validAnswer, QUESTION_TITLE } from '../src/questionnaire';

const questions = [
  { id: 'choice', label: 'Scope', question: 'Which scope?', allowFreeform: false, options: [
    { label: 'Small', value: 'small', description: 'Keep it narrow' }, { label: 'Large', value: 'large' },
  ] },
  { id: 'notes', label: 'Notes', question: 'Any constraints?', allowFreeform: true, options: [] },
];
const payload = { version: 1, callId: 'call-1', questions };
const request = { type: 'extension_ui_request' as const, id: 'one', method: 'input', title: QUESTION_TITLE + JSON.stringify(payload) };

test('clarification transport requires exact marker, version and normalized questions', () => {
  assert.deepEqual(questionnaire(request), payload);
  assert.equal(questionnaire({ ...request, method: 'select' }), undefined);
  assert.equal(questionnaire({ ...request, title: 'Question' }), undefined);
  assert.equal(questionnaire({ ...request, title: QUESTION_TITLE + '{' }), undefined);
  assert.equal(questionnaire({ ...request, title: QUESTION_TITLE + JSON.stringify({ ...payload, version: 2 }) }), undefined);
  assert.equal(questionnaire({ ...request, title: QUESTION_TITLE + JSON.stringify({ ...payload, callId: '' }) }), undefined);
});
test('clarification shape rejects malformed or unanswerable questions', () => {
  assert.equal(questionsFrom([]), undefined);
  assert.equal(questionsFrom(Array(13).fill(questions[0])), undefined);
  assert.equal(questionsFrom([{ ...questions[0], options: [] }]), undefined);
  assert.equal(questionsFrom([{ ...questions[0], options: [{ label: 'A', value: 2 }] }]), undefined);
  assert.equal(questionsFrom([{ ...questions[0], allowFreeform: 'yes' }]), undefined);
});
test('whole-group answers preserve original option values and trim freeform only', () => {
  const answer = [{ id: 'choice', value: 'small', wasCustom: false }, { id: 'notes', value: '  No dependencies  ', wasCustom: true }];
  assert.equal(serializeAnswers(payload as any, answer),
    '[{"id":"choice","value":"small","wasCustom":false},{"id":"notes","value":"No dependencies","wasCustom":true}]');
});
test('answers reject missing, swapped, forged options and disallowed custom answers', () => {
  const valid = [{ id: 'choice', value: 'small', wasCustom: false }, { id: 'notes', value: 'Text', wasCustom: true }];
  for (const invalid of [[], valid.slice(0, 1), [...valid].reverse(), [{ ...valid[0], value: 'forged' }, valid[1]],
    [{ ...valid[0], wasCustom: true }, valid[1]], [valid[0], { ...valid[1], value: ' ' }],
    [valid[0], { ...valid[1], wasCustom: 'true' }]]) assert.throws(() => serializeAnswers(payload as any, invalid));
  assert.equal(validAnswer(questions[0], undefined), false);
});
