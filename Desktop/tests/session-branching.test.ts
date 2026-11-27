import test from 'node:test';
import assert from 'node:assert/strict';
import { activeHistory, type HistoryEntry } from '../electron/session-branching';
import { sessionTranscript } from '../electron/session-transcript';

const user = (text: string, timestamp?: number) => ({ role: 'user', content: text, timestamp });
const entries: HistoryEntry[] = [
  { id: 'u1', parentId: null, type: 'message', message: user('same', 1) },
  { id: 'a1', parentId: 'u1', type: 'message', message: { role: 'assistant', content: 'answer', timestamp: 2 } },
  { id: 'u2', parentId: 'a1', type: 'message', message: user('same', 3) },
  { id: 'other', parentId: 'a1', type: 'message', message: user('same', 3) },
];

test('entry mapping follows the active path and distinguishes repeated user text', () => {
  assert.deepEqual(sessionTranscript(entries, 'u2').map(message => message.entryId), ['u1', 'a1', 'u2']);
  assert.ok(!('entryId' in entries[0].message!));
  assert.deepEqual(activeHistory(entries, 'u2').map(entry => entry.id), ['u1', 'a1', 'u2']);
});
test('visible Desktop Goal inputs map to their exact custom history entry', () => {
  const timestamp = '2026-10-11T00:00:00Z';
  const details = { desktopGoalInputId: 'input-1' };
  const saved = { id: 'goal-input', parentId: null, type: 'custom_message', timestamp,
    customType: 'desktop-goal-input', display: true, content: 'Goal task', details };
  assert.deepEqual(sessionTranscript([saved], saved.id), [{
    role: 'custom', customType: 'desktop-goal-input', content: 'Goal task',
    timestamp: Date.parse(timestamp), details, entryId: saved.id, display: true,
  }]);
});
test('Desktop Goal input producer attaches a unique persisted ID without altering user content', async () => {
  const { default: register } = await import('../electron/' + 'desktop-sessions.mjs');
  const keys = ['DESKTOP_SESSION_URL', 'DESKTOP_SESSION_TOKEN', 'STEPCODE_SUBAGENT_CHILD'] as const;
  const previous = keys.map(key => process.env[key]);
  const commands = new Map<string, { handler: (args: string, ctx: { isIdle: () => boolean }) => Promise<void> }>();
  const sent: any[] = [];
  try {
    process.env.DESKTOP_SESSION_URL = 'http://127.0.0.1:1';
    process.env.DESKTOP_SESSION_TOKEN = 'fixture';
    delete process.env.STEPCODE_SUBAGENT_CHILD;
    register({
      registerCommand: (name: string, command: any) => commands.set(name, command),
      registerTool: () => {},
      sendMessage: (message: any) => sent.push(message),
    });
    const handler = commands.get('_desktop_goal_input')!.handler;
    await handler(JSON.stringify({ message: 'Goal task' }), { isIdle: () => true });
    await handler(JSON.stringify({ message: 'Goal task' }), { isIdle: () => true });
    assert.deepEqual(sent[0].content, [{ type: 'text', text: 'Goal task' }]);
    assert.match(sent[0].details.desktopGoalInputId, /^[0-9a-f-]{36}$/);
    assert.notEqual(sent[0].details.desktopGoalInputId, sent[1].details.desktopGoalInputId);
    assert.equal(sent[0].display, true);
    assert.equal(sent[0].customType, 'desktop-goal-input');
  } finally {
    keys.forEach((key, index) => {
      if (previous[index] === undefined) delete process.env[key];
      else process.env[key] = previous[index];
    });
  }
});
test('identical messages on the same branch keep distinct persisted identities', () => {
  const duplicate = [
    { id: 'x', parentId: null, type: 'message', message: user('same') },
    { id: 'y', parentId: 'x', type: 'message', message: user('same') },
  ];
  assert.deepEqual(sessionTranscript(duplicate, 'y').map(message => message.entryId), ['x', 'y']);
});
test('invalid active paths reject missing parents and cycles', () => {
  assert.throws(() => activeHistory(entries, 'missing'), /Incomplete/);
  assert.throws(() => activeHistory([{ id: 'x', parentId: 'x', type: 'message' }], 'x'), /Invalid/);
});
