import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { prepareSessionFixture } from './session-fixture.mjs';

const profile = await mkdtemp(join(tmpdir(), 'step-chain-runtime-'));
const root = join(profile, 'step-runtime');
await mkdir(root, { recursive: true });
await mkdir('test-results', { recursive: true });
const results = [];
const children = [];
const errors = [];
let heldChild = false;
const phase = text => console.log(`[chain-runtime] ${text}`);
const server = createServer(async (req, res) => {
  try {
    let raw = '';
    for await (const chunk of req) { raw += chunk; assert.ok(raw.length < 8 * 1024 * 1024); }
    const body = JSON.parse(raw);
    const textOf = m => typeof m.content === 'string' ? m.content : m.content?.filter(c => c.type === 'text').map(c => c.text).join('\n') ?? '';
    const userIndex = body.messages.findLastIndex(m => m.role === 'user' && /CHAIN_SUCCESS|CHAIN_FAILURE|CHAIN_ABORT|CHILD_ONE|CHILD_TWO|CHILD_THREE/.test(textOf(m)));
    const text = textOf(body.messages[userIndex] ?? {});
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    const send = (delta, finish_reason = null) => res.write(`data: ${JSON.stringify({
      id: 'chain-fixture', object: 'chat.completion.chunk', model: body.model, created: 1,
      choices: [{ index: 0, delta, finish_reason }],
    })}\n\n`);
    send({ role: 'assistant', content: '' });
    const scenario = /^CHAIN_(SUCCESS|FAILURE|ABORT)$/.test(text);
    if (scenario && !body.messages.slice(userIndex + 1).some(m => m.role === 'tool')) {
      assert.ok(body.tools.some(tool => tool.function?.name === 'subagent'), 'runtime exposes subagent');
      const chain = [
        { agent: 'general', task: 'CHILD_ONE return STEP_1_SOURCE' },
        { agent: text === 'CHAIN_FAILURE' ? 'missing-chain-fixture-agent' : 'general', task: `CHILD_TWO previous={previous}; ${text === 'CHAIN_ABORT' ? 'HOLD_CHILD' : 'return STEP_2_SUMMARY'}` },
        { agent: 'general', task: 'CHILD_THREE previous={previous}; return STEP_3_FINAL' },
      ];
      send({ tool_calls: [{ index: 0, id: `call-${text}`, type: 'function', function: { name: 'subagent', arguments: JSON.stringify({ chain }) } }] });
      send({}, 'tool_calls'); res.end('data: [DONE]\n\n'); return;
    }
    if (scenario) {
      const tool = body.messages.slice(userIndex + 1).find(m => m.role === 'tool');
      results.push({ scenario: text, content: tool.content });
      send({ content: 'Chain fixture inspected the returned tool result.' });
    } else {
      children.push(text);
      if (text.includes('HOLD_CHILD')) { heldChild = true; return; }
      const output = text.includes('CHILD_THREE') ? 'STEP_3_FINAL' : text.includes('CHILD_TWO') ? 'STEP_2_SUMMARY' : 'STEP_1_SOURCE';
      await new Promise(resolve => setTimeout(resolve, 250));
      send({ content: output });
    }
    send({}, 'stop'); res.end('data: [DONE]\n\n');
  } catch (error) { errors.push(error.message); if (!res.headersSent) res.writeHead(500); res.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
await writeFile(join(profile, 'preferences.json'), JSON.stringify({ theme: 'dark', language: 'zh', workspaces: [] }));
await writeFile(join(root, 'config.toml'), 'defaultProvider = "chain-fixture"\ndefaultModel = "chain-fixture"\npermissionPreset = "bypass"\n[telemetry]\nenabled = false\n');
await writeFile(join(root, 'models.json'), JSON.stringify({ providers: { 'chain-fixture': {
  baseUrl: `http://127.0.0.1:${server.address().port}/v1`, api: 'openai-completions', apiKey: 'local-fixture',
  models: [{ id: 'chain-fixture', name: 'Local chain fixture', contextWindow: 32768, maxTokens: 2048 }],
} } }));
const env = { ...process.env, DESKTOP_TEST_USER_DATA: profile, DESKTOP_TEST_NO_FOCUS: '1' };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ ...(process.env.DESKTOP_VERIFY_EXE ? { executablePath: process.env.DESKTOP_VERIFY_EXE } : { args: [resolve('.')] }), env, timeout: 60000 });
try {
  const page = await app.firstWindow();
  await app.evaluate(({ BrowserWindow }) => { const win = BrowserWindow.getAllWindows()[0]; win.setOpacity(0); win.setIgnoreMouseEvents(true); win.showInactive(); });
  const snapshot = await prepareSessionFixture(page);
  phase('session ready');
  for (const scenario of ['CHAIN_SUCCESS', 'CHAIN_FAILURE', 'CHAIN_ABORT']) {
    const before = await page.evaluate(async () => (await window.desktop.snapshot()).messages.length);
    phase(`${scenario}: submitting`);
    await page.evaluate(({ runtimeId, scenario }) => window.desktop.command('prompt', { message: scenario }, runtimeId), { runtimeId: snapshot.runtimeId, scenario });
    phase(`${scenario}: acknowledged`);
    if (scenario === 'CHAIN_ABORT') {
      const deadline = Date.now() + 30000;
      while (!heldChild && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 100));
      assert.ok(heldChild, 'second child is running before cancellation');
      await page.evaluate(runtimeId => window.desktop.command('abort', {}, runtimeId), snapshot.runtimeId);
    }
    let current;
    let settled = false;
    const deadline = Date.now() + 90000;
    do {
      current = await page.evaluate(() => window.desktop.snapshot());
      const ended = scenario === 'CHAIN_ABORT'
        ? current.messages.slice(before).some(m => m.role === 'toolResult' && m.toolName === 'subagent')
        : results.some(r => r.scenario === scenario) && current.messages.slice(before).some(m => m.role === 'assistant' && m.stopReason === 'stop');
      if (ended && !current.state.isStreaming) { settled = true; break; }
      await new Promise(resolve => setTimeout(resolve, 100));
    } while (Date.now() < deadline);
    assert.ok(settled, `${scenario}: run and authoritative result settled before deadline`);
    assert.equal(current.sessions.some(session => /^(workflow|subagent)-/.test(session.id)), false,
      'real child sessions never enter the user conversation catalog');
    phase(`${scenario}: settled`);
    const tool = current.messages.slice(before).findLast(m => m.role === 'toolResult' && m.toolName === 'subagent');
    assert.ok(tool, 'real runtime returned subagent records');
    assert.deepEqual(tool.details.results.map(r => r.status), scenario === 'CHAIN_SUCCESS' ? ['completed', 'completed', 'completed'] : ['completed', scenario === 'CHAIN_ABORT' ? 'aborted' : 'failed', 'skipped']);
    if (scenario === 'CHAIN_ABORT') continue;
    const returned = results.find(r => r.scenario === scenario)?.content;
    assert.ok(returned, 'parent model received the tool content');
    assert.match(returned, scenario === 'CHAIN_SUCCESS' ? /STEP_3_FINAL/ : /chain did not complete/i);
    if (scenario === 'CHAIN_FAILURE') {
      assert.match(returned, /missing-chain-fixture-agent/);
      await page.locator('.subagent-status-icon[data-state="skipped"]').first().waitFor({ timeout: 10000 });
      await page.screenshot({ path: 'test-results/chain-runtime-failed-skipped.png' });
    }
  }
  assert.ok(children.some(text => text.includes('CHILD_TWO') && text.includes('STEP_1_SOURCE')));
  assert.ok(children.some(text => text.includes('CHILD_THREE') && text.includes('STEP_2_SUMMARY')));
  assert.deepEqual(errors, []);
  console.log('Real chain runtime passed: three child processes, previous propagation, final content to parent, failure, cancellation and skipped step. Local HTTP only.');
} finally {
  await app.evaluate(({ BrowserWindow }) => { for (const win of BrowserWindow.getAllWindows()) win.destroy(); }).catch(() => {});
  await app.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
}
