import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { manualClmInput } from '../src/manual-clm-input';
import { messageText } from '../src/conversation-presentation';
import { firstUserText } from '../electron/session-runtimes';

// Git may check text fixtures out as CRLF; the pinned runtime emits this template with LF.
const fixture = readFileSync(new URL('./fixtures/manual-clm-input.txt', import.meta.url), 'utf8').replace(/\r\n/g, '\n').trimEnd();

test('manual CLM session titles use the visible command without exposing the internal envelope', () => {
  const message = { role: 'user', content: fixture };
  assert.equal(firstUserText([message]), '/clm-compact KEEP-CLM-731');
  assert.equal(firstUserText([{ ...message, content: [{ type: 'text', text: fixture }, { type: 'text', text: 'extra requirement' }] }]),
    '/clm-compact KEEP-CLM-731\nextra requirement');
  assert.equal(message.content, fixture);
  assert.equal(firstUserText([{ role: 'assistant', content: fixture }, { role: 'user', content: 'ordinary task' }]), 'ordinary task');
  assert.equal(firstUserText([{ role: 'user', content: 'ultracode:\n\noriginal task' }]), 'original task');
  assert.equal(firstUserText([{ role: 'custom', customType: 'desktop-goal-input', content: 'ultracode:\n\noriginal goal' }]), 'original goal');
  assert.equal(firstUserText([{ role: 'user', content: 'x'.repeat(300) }]), 'x'.repeat(200));
  assert.equal(firstUserText([]), '');
});

test('Manual CLM display restores the compact command and instructions without changing history', () => {
  assert.equal(manualClmInput(fixture), '/clm-compact KEEP-CLM-731');
  assert.equal(manualClmInput(fixture.replace(' Additional guidance: KEEP-CLM-731', '')), '/clm-compact');
  const message = { role: 'user', content: fixture, timestamp: 123 };
  assert.equal(messageText(message), '/clm-compact KEEP-CLM-731');
  assert.equal(message.content, fixture);
  assert.equal(messageText({ ...message, content: [{ type: 'text', text: fixture }, { type: 'text', text: 'ordinary second block' }] }),
    '/clm-compact KEEP-CLM-731\n\nordinary second block');
  assert.equal(messageText({ ...message, role: 'assistant' }), fixture, 'Assistant quotes remain literal');
  assert.equal(messageText({ ...message, role: 'toolResult' }), fixture, 'Tool output remains literal');
});

test('Manual CLM projection fails closed on partial, ordinary and mismatched templates', () => {
  for (const value of [
    '/clm', '/clm-compact keep facts', 'Working context index (read-only)',
    `Quoted prompt:\n${fixture}`, fixture.slice(0, 300),
    fixture.replace('Editable file: "C:', 'Editable file: "D:'),
    fixture.replace('p = Path("C:', 'p = Path("D:'),
    fixture.replace('seen = set()', 'seen = arbitrary()'),
    fixture.replace('Revision: 0; document: a', 'Revision: 0; document: z'),
    fixture.replace(' Additional guidance: ', ' User wrote: '),
    `${fixture}\nUser commentary`,
  ]) assert.equal(manualClmInput(value), undefined);
});
