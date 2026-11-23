import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';

const upstream = resolve(process.argv[2] ?? process.env.DESKTOP_STEP_CODE_SOURCE ?? '../Step-Code');
const load = api => import(pathToFileURL(resolve(upstream, 'packages/providers/dist/api', `${api}.js`)).href);
const user = { role: 'user', content: 'Call the fixture tools.', timestamp: 1 };
const model = (api, baseUrl, id = 'fixture-model') => ({
  id, name: id, api, baseUrl, provider: 'desktop-custom-fixture', reasoning: false, input: ['text'],
  contextWindow: 128000, maxTokens: 4096, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
});
const options = { apiKey: 'fixture-key', maxTokens: 512 };
const sse = (events, named = false) => new Response(events.map(event =>
  `${named ? `event: ${event.type}\n` : ''}data: ${JSON.stringify(event)}\n\n`).join('') + (named ? '' : 'data: [DONE]\n\n'),
{ headers: { 'content-type': 'text/event-stream' } });

test('OpenAI Responses runtime uses the public API host and a Bearer key', async () => {
  const { stream } = await load('openai-responses');
  const sent = [];
  const message = await stream(model('openai-responses', 'https://api.openai.com/v1'), { messages: [user] }, {
    ...options, fetch: async (url, request) => {
      sent.push([String(url), new Headers(request.headers).get('authorization'), JSON.parse(request.body)]);
      return sse([
        { type: 'response.created', response: { id: 'resp_fixture' } },
        { type: 'response.output_item.added', output_index: 0, item: { type: 'message', id: 'msg_fixture', role: 'assistant', status: 'in_progress', content: [] } },
        { type: 'response.output_text.delta', output_index: 0, item_id: 'msg_fixture', content_index: 0, delta: 'OK' },
        { type: 'response.output_item.done', output_index: 0, item: { type: 'message', id: 'msg_fixture', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'OK', annotations: [] }] } },
        { type: 'response.completed', response: { id: 'resp_fixture', status: 'completed' } },
      ]);
    },
  }).result();
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0].slice(0, 2), ['https://api.openai.com/v1/responses', 'Bearer fixture-key']);
  assert.equal(sent[0][2].store, false);
  assert.equal(message.stopReason, 'stop', message.errorMessage);
  assert.equal(message.content[0].text, 'OK');
});

test('Anthropic Messages runtime appends v1 once and uses x-api-key', async () => {
  const { stream } = await load('anthropic-messages');
  const sent = [];
  const message = await stream(model('anthropic-messages', 'https://api.anthropic.com'), { messages: [user] }, {
    ...options, fetch: async (url, request) => {
      const headers = new Headers(request.headers);
      sent.push([String(url), headers.get('x-api-key'), headers.get('authorization'), headers.get('anthropic-version')]);
      return sse([
        { type: 'message_start', message: { id: 'msg_fixture', type: 'message', role: 'assistant', content: [], usage: { input_tokens: 1, output_tokens: 0 } } },
        { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'OK' } },
        { type: 'content_block_stop', index: 0 },
        { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 1 } },
        { type: 'message_stop' },
      ], true);
    },
  }).result();
  assert.deepEqual(sent, [['https://api.anthropic.com/v1/messages', 'fixture-key', null, '2023-06-01']]);
  assert.equal(message.stopReason, 'stop', message.errorMessage);
  assert.equal(message.content[0].text, 'OK');
});

test('Gemini preserves the parallel tool batch and the opaque signature across tool steps', async () => {
  const { stream } = await load('openai-completions');
  const origin = 'https://generativelanguage.googleapis.com/v1beta/openai';
  const gemini = model('openai-completions', origin);
  const signature = 'YV9maXh0dXJlLXNpZ25hdHVyZQ==';
  const extra_content = { google: { thought_signature: signature } };
  const tools = ['get_first', 'get_second'].map(name => ({
    name, description: name, parameters: { type: 'object', properties: { n: { type: 'number' } }, required: ['n'] },
  }));
  const context = { messages: [user], systemPrompt: 'Use the tools.', tools };
  const sent = [];
  const chunk = (delta, finish_reason = null) => ({
    id: 'chatcmpl-fixture', object: 'chat.completion.chunk', model: gemini.id, choices: [{ index: 0, delta, finish_reason }],
  });
  const calls = [
    { index: null, id: 'call_one', type: 'function', function: { name: tools[0].name, arguments: '{"n":1}' }, extra_content },
    { index: null, id: 'call_two', type: 'function', function: { name: tools[1].name, arguments: '{"n":2}' } },
  ];
  const toolStream = [chunk({ tool_calls: calls }), chunk({}, 'stop')];
  const replyStream = [chunk({ content: 'OK' }), chunk({}, 'stop')];
  const run = async (target, history, events) => await stream(target, history, {
    ...options, fetch: async (url, request) => {
      sent.push({ url: String(url), auth: new Headers(request.headers).get('authorization'), body: JSON.parse(request.body) });
      return sse(events);
    },
  }).result();
  const first = await run(gemini, context, toolStream);
  assert.equal(first.stopReason, 'toolUse', first.errorMessage);
  assert.deepEqual(first.content.map(({ id, arguments: args }) => [id, args]), [['call_one', { n: 1 }], ['call_two', { n: 2 }]]);
  const toolResults = first.content.map(call => ({
    role: 'toolResult', toolCallId: call.id, toolName: call.name,
    content: [{ type: 'text', text: 'fixture result' }], isError: false, timestamp: 2,
  }));
  const history = { ...context, messages: [user, JSON.parse(JSON.stringify(first)), ...toolResults] };
  const second = await run(gemini, history, replyStream);
  assert.equal(second.stopReason, 'stop', second.errorMessage);
  assert.equal(second.content[0].text, 'OK');
  assert.deepEqual(sent.map(r => [r.url, r.auth]), Array.from({ length: 2 }, () => [`${origin}/chat/completions`, 'Bearer fixture-key']));
  const request = sent[1].body;
  assert.equal(request.max_tokens, 512);
  assert.ok(!('store' in request));
  assert.equal(request.messages[0].role, 'system');
  assert.ok(request.tools.every(tool => !('strict' in tool.function)));
  const assistant = request.messages.find(message => message.role === 'assistant');
  const toolMessages = request.messages.slice(request.messages.indexOf(assistant) + 1);
  assert.deepEqual(assistant.tool_calls.map(call => call.id), ['call_one', 'call_two']);
  assert.deepEqual(assistant.tool_calls[0].extra_content, extra_content);
  assert.equal(assistant.tool_calls[1].extra_content, undefined);
  assert.deepEqual(toolMessages.map(message => message.tool_call_id), ['call_one', 'call_two']);

  // Neither a different model nor a lookalike host inherits Gemini's signatures.
  const otherModel = await run({ ...gemini, id: 'fixture-other-model' }, history, replyStream);
  assert.equal(otherModel.stopReason, 'stop', otherModel.errorMessage);
  const lookalike = { ...gemini, baseUrl: 'https://generativelanguage.googleapis.com.example.test/v1beta/openai' };
  const otherHost = await run(lookalike, history, toolStream);
  assert.equal(otherHost.stopReason, 'stop', otherHost.errorMessage);
  assert.equal(otherHost.content[0].thoughtSignature, undefined);
  for (const { body } of sent.slice(2)) assert.ok(!JSON.stringify(body).includes(signature));
});
