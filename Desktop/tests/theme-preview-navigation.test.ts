import test from 'node:test';
import assert from 'node:assert/strict';
import { themeNavigationMessages, themeAgentMessages } from './fixtures/theme-pack-navigation';
import { conversationTurns } from '../src/ConversationNavigation';
import { workflowsFromMessages } from '../src/workflow-state';

test('navigation sample has eight dated real user turns and isolated histories', () => {
  const messages = themeNavigationMessages();
  const turns = conversationTurns(messages, 'zh');
  assert.equal(turns.length, 8);
  assert.deepEqual(turns.map(turn => turn.index), [0, 2, 4, 6, 8, 10, 12, 14]);
  assert.ok(turns.every(turn => Number.isFinite(turn.timestamp)));
  messages[0].content = 'changed';
  assert.notEqual(themeNavigationMessages()[0].content, 'changed');
});

test('agent sample preserves failures, cached and unknown outcomes without invented edges', () => {
  const flows = workflowsFromMessages(themeAgentMessages(), false);
  assert.equal(flows.length, 2);
  assert.equal(flows[0].status, 'unknown');
  assert.equal(flows[0].agents[0].status, 'unknown');
  assert.equal(flows[1].status, 'partial_failed');
  assert.deepEqual(flows[1].agents.map(agent => agent.status), ['completed', 'completed', 'cached', 'failed', 'aborted']);
  assert.equal(flows[1].agents[3].error?.code, 'FIXTURE_FOCUS_CLIPPED');
  assert.equal(flows[1].agents[4].finishedAt, undefined);
});
