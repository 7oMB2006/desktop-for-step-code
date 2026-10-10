import test from 'node:test';
import assert from 'node:assert/strict';
import { isChildSession } from '../electron/session-visibility';

test('hide both upstream child namespaces without hiding user branches', () => {
  for (const id of ['subagent-abcd', 'workflow-wf_abc123-wf_abc123-2']) assert.equal(isChildSession(id), true);
  for (const id of ['plain', 'abc-123', 'my-workflow-notes', '']) assert.equal(isChildSession(id), false);
});
