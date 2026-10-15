import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const source = process.argv[2];
if (!source) throw new Error('Pass the isolated, patched Step Code source directory');
const { registerStepClarifyUserExtension } = await import(pathToFileURL(resolve(source, 'packages/coding-agent/dist/features/step-questionnaire.js')).href);
let tool, enabled = false;
registerStepClarifyUserExtension({
  registerFlag(name, flag) { assert.equal(name, 'desktop-clarification'); assert.equal(flag.default, false); },
  registerTool(value) { tool = value; },
  getFlag() { return enabled; },
});
assert.equal(tool.name, 'clarify_user');
const params = { questions: [
  { id: 'scope', question: 'Which scope?', options: [{ label: 'Small scope', value: 'small' }], allow_freeform: false },
  { id: 'notes', question: 'Notes?', allow_freeform: true },
] };
const controller = new AbortController();
let title, options, calls = 0;
let result = JSON.stringify([
  { id: 'scope', value: 'small', wasCustom: false, label: 'FORGED DISPLAY' },
  { id: 'notes', value: ' No dependencies ', wasCustom: true },
]);
const ctx = { mode: 'rpc', hasUI: true, ui: {
  async input(value, _, opts) { calls++; title = value; options = opts; return result; },
  async custom() { throw new Error('RPC must not enter the TUI custom renderer'); },
} };
const execute = () => tool.execute('call-1', params, controller.signal, undefined, ctx);
assert.match((await execute()).content[0].text, /requires an interactive UI/);
assert.equal(calls, 0, 'Normal RPC behavior is unchanged without Desktop opt-in');
enabled = true;
const answered = await execute();
assert.equal(answered.details.cancelled, false);
assert.equal(answered.details.answers[0].label, 'Small scope');
assert.equal(answered.details.answers[0].index, 1);
assert.equal(answered.details.answers[1].value, 'No dependencies');
assert.equal(options.signal, controller.signal);
assert.equal(options.timeout, undefined);
assert.equal(JSON.parse(title.split('\n').slice(1).join('\n')).callId, 'call-1');
for (const invalid of ['{', '[]', JSON.stringify([
  { id: 'scope', value: 'small', wasCustom: true }, { id: 'notes', value: 'Notes', wasCustom: true },
]), JSON.stringify([
  { id: 'scope', value: 'forged', wasCustom: false }, { id: 'notes', value: 'Notes', wasCustom: true },
])]) {
  result = invalid; await assert.rejects(execute);
}
result = undefined;
assert.equal((await execute()).details.cancelled, true);
result = '[{"id":"scope","value":"small","wasCustom":false},{"id":"notes","value":"Notes","wasCustom":true}]';
controller.abort();
assert.equal((await execute()).details.cancelled, true);
const tui = { mode: 'tui', hasUI: true, ui: {
  async select() { return 'Small scope'; },
  async input() { return 'Native answer'; },
} };
const native = await tool.execute('native', params, undefined, undefined, tui);
assert.equal(native.details.answers[0].value, 'small');
assert.equal(native.details.answers[1].value, 'Native answer');
console.log('Beta bridge: opt-in boundary, RPC whole-group validation, cancellation/signal, canonical results and unchanged TUI fallback passed.');
