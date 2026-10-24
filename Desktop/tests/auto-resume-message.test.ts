import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Message } from '../src/contracts';
import { isAutoResumeMessage } from '../src/auto-resume-message';
import { AutoResumeMessage } from '../src/AutoResumeMessage';
import { conversationEntries, responsePresentation } from '../src/conversation-presentation';
import { isUserMessage } from '../src/user-message';
import { groupProcesses } from '../src/process-groups';
import { groupConsecutiveTools } from '../src/tool-groups';

const prompt = 'The previous turn was interrupted by a transient model or transport error. Re-read the recent transcript and continue from where it stopped. Do not restart from scratch or repeat tool calls whose results are already present. If the work needs a decision from the user, stop and explain what is needed.';
const notice: Message = { role: 'custom', customType: 'step-auto-resume', display: true, content: prompt,
  details: { version: 1, kind: 'resume', source: 'autopilot' } };
const indexed = (messages: Message[]) => messages.map((message, index) => ({ message, index }));

test('automatic continuation uses structured identity, not the English prompt', () => {
  assert.ok(isAutoResumeMessage(notice));
  assert.ok(!isUserMessage(notice));
  for (const message of [
    { ...notice, role: 'user' }, { ...notice, role: 'assistant' }, { ...notice, customType: 'other' },
    { ...notice, details: undefined }, { ...notice, details: { ...notice.details, version: 2 } },
    { ...notice, details: { ...notice.details, source: 'user' } },
    { ...notice, details: { ...notice.details, kind: 'other' } },
  ]) assert.equal(isAutoResumeMessage(message), false);
  assert.ok(isAutoResumeMessage({ ...notice, content: 'Updated upstream wording' }));
  const user = { role: 'user', content: prompt };
  assert.ok(isUserMessage(user));
  assert.equal(conversationEntries([user])[0].type, 'user');
});

test('the original task retains one response, with the notice outside tool groups and copied prose', () => {
  const messages: Message[] = [
    { role: 'user', content: 'Original request' },
    { role: 'assistant', content: 'Before interruption' },
    notice,
    { role: 'assistant', content: 'Continued reply' },
  ];
  for (const snapshot of [messages, JSON.parse(JSON.stringify(messages)) as Message[]]) {
    const entries = conversationEntries(snapshot);
    assert.equal(entries.length, 2);
    const response = entries[1];
    assert.equal(response.type, 'response');
    if (response.type !== 'response') continue;
    const { content, text } = responsePresentation(response.items);
    assert.deepEqual(content.map(item => item.type), ['text', 'auto-resume', 'text']);
    assert.equal(text, 'Before interruption\n\nContinued reply');
    assert.equal(groupProcesses(content, true)[1].type, 'auto-resume');
    assert.equal(groupConsecutiveTools(content, true)[1].type, 'auto-resume');
    assert.equal(snapshot[2].content, prompt, 'The model instruction is never deleted or rewritten');
  }
  assert.deepEqual(responsePresentation(indexed([{ ...notice, display: false }])).content, []);
  assert.equal(responsePresentation(indexed([{ ...notice, details: undefined }])).content[0].type, 'text');
});

test('repeated continuation attempts remain separate notes without claiming recovery success', () => {
  const content = responsePresentation(indexed([notice, notice])).content;
  assert.deepEqual(content.map(item => item.key), ['0:auto-resume', '1:auto-resume']);
  for (const language of ['zh', 'en'] as const) {
    const html = renderToStaticMarkup(createElement(AutoResumeMessage, { index: 2, language }));
    assert.match(html, /role="note"/);
    assert.ok(!/<button|message-actions|message user|animation|aria-live/.test(html));
    assert.ok(!html.includes(prompt));
    assert.ok(html.includes(language === 'zh' ? '已发起自动续跑' : 'continuation requested'));
  }
});
