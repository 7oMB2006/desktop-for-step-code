import assert from 'node:assert/strict';
import test from 'node:test';
import { uniquePendingApprovalCall } from '../electron/approval-call-identity';
import type { Content, Message } from '../src/contracts';

const call: Content = { type: 'toolCall', id: 'call-1', name: 'example', arguments: { label: 'document' } };
const assistant = (...content: Content[]): Message => ({ role: 'assistant', content });

test('approval identity resolves one live native call by exact ID and name', () => {
  const entries = [assistant(call, { ...call, id: 'call-2', name: 'other' })];
  assert.equal(uniquePendingApprovalCall(entries, 'example', 'call-1'), call);
  assert.equal(uniquePendingApprovalCall(entries, 'example'), call);
  assert.equal(uniquePendingApprovalCall(entries, 'other', 'call-1'), undefined);
  assert.equal(uniquePendingApprovalCall(entries, 'example', ''), undefined);
});

test('approval identity rejects ambiguous, historical, imported and completed records', () => {
  const records = [
    [assistant(call, { ...call })],
    [assistant(call), assistant({ ...call, name: 'other' })],
    [assistant({ ...call, historical: true })],
    [{ ...assistant(call), desktopImported: true }],
    [assistant(call), { role: 'toolResult', toolCallId: 'call-1', content: 'Done' }],
  ];
  for (const messages of records) {
    assert.equal(uniquePendingApprovalCall(messages, 'example', 'call-1'), undefined);
    assert.equal(uniquePendingApprovalCall(messages, 'example'), undefined);
  }
});
