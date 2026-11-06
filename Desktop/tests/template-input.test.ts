import test from 'node:test';
import assert from 'node:assert/strict';
import type { Message } from '../src/contracts';
import { messageBlocks, messageText } from '../src/conversation-presentation';
import { originalTemplateInput, submittedInputContent } from '../src/template-input';
import { firstUserText, type SessionRuntime } from '../electron/session-runtimes';
import { PendingMessages } from '../electron/pending-messages';
import { applyMessageEvent } from '../src/message-events';

const body = "Use the bilibili-video-research skill and this plugin's BVR MCP to address:\n\nWhat is this?";
const input = '/bvr What is this?';
const message: Message = { role: 'user', timestamp: 42, content: [{ type: 'text', text: body },
  { type: 'image', mimeType: 'image/png', data: 'fixture' }], desktopInput: { version: 1, text: input } };

test('expanded templates display original input in live messages, copy/edit text, titles and saved history', () => {
  let messages = applyMessageEvent([], { type: 'message_start', message });
  messages = applyMessageEvent(messages, { type: 'message_end', message });
  for (const history of [messages, JSON.parse(JSON.stringify(messages)) as Message[]]) {
    assert.equal(messageText(history[0]), input);
    assert.equal(firstUserText(history), input);
    assert.equal(messageBlocks(history[0])[1].type, 'image');
    assert.equal((history[0].content as { text: string }[])[0].text, body, 'canonical model content stays expanded');
  }
});

test('ordinary human text and legacy templates are not reclassified by their wording', () => {
  assert.equal(messageText({ role: 'user', content: body }), body);
  assert.equal(messageText({ role: 'user', content: '/bvr' }), '/bvr');
  assert.equal(messageText({ ...message, role: 'assistant' }), body);
  for (const desktopInput of [undefined, { version: 2, text: input }, { version: 1, text: 'not a command' }, { version: 1, text: 3 }]) {
    const invalid = { ...message, desktopInput } as Message;
    assert.equal(originalTemplateInput(invalid), undefined);
    assert.equal(submittedInputContent(invalid), invalid.content);
  }
});

test('expanded queued commands acknowledge exactly their original receipt, including steering metadata', async () => {
  const worker = { busy: true, status: 'connected', submissions: 0, operations: 0,
    rpc: { request: async () => ({}) }, pendingUI: new Map() } as unknown as SessionRuntime;
  const queue = new PendingMessages(() => {}, () => assert.fail('Unexpected queue failure'));
  const id = queue.enqueue(worker, input, { message: input });
  queue.enqueue(worker, '/bvr Other input', { message: '/bvr Other input' });
  await queue.steer(worker, id, 0);
  assert.equal(queue.delivered(worker, submittedInputContent(message), message.timestamp), true);
  assert.equal(queue.decorate(worker, message).desktopSteered, true);
  assert.deepEqual(queue.list(worker).map(item => item.message), ['/bvr Other input']);
  queue.clear(worker);
});
