import assert from 'node:assert/strict';
import { mkdir, realpath, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron as electron } from 'playwright';
import { closeDesktopFixtureAndWait } from './close-desktop-fixture.mjs';
import { waitForSessionFixtureTools } from './session-fixture.mjs';
import { mkdtemp } from './test-profile.mjs';

const profile = await realpath(await mkdtemp(join(tmpdir(), 'desktop-subagent-roles-')));
const workspace = join(profile, 'workspace');
const runtimeData = join(profile, 'step-runtime');
await mkdir(workspace);
await mkdir(runtimeData);
await writeFile(join(profile, 'preferences.json'), JSON.stringify({ language: 'zh', theme: 'dark', workspaces: [workspace] }));
await writeFile(join(runtimeData, 'config.toml'), 'permissionPreset = "approve-for-me"\n[telemetry]\nenabled = false\n[mcp_servers.steppage__steppage]\nenabled = false\n');

const text = message => typeof message?.content === 'string' ? message.content
  : message?.content?.filter(block => block.type === 'text').map(block => block.text).join('\n') ?? '';
const traffic = [];
let serverFailure;
let reviewProvider;
const server = createServer(async (req, res) => {
  try {
    assert.equal(req.headers.authorization, 'Bearer subagent-role-test');
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw);
    const index = body.messages.findLastIndex(message => message.role === 'user' && /^ROLE-(PARENT|CHILD)-/.test(text(message).trim()));
    const task = text(body.messages[index]).trim();
    const result = body.messages.slice(index + 1).find(message => message.role === 'tool' && message.tool_call_id === task);
    traffic.push({ task, path: req.url, model: body.model, effort: body.reasoning_effort });
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    const send = (delta, finish_reason = null) => res.write(`data: ${JSON.stringify({
      id: `fixture-${traffic.length}`, object: 'chat.completion.chunk', created: 1, model: body.model,
      choices: [{ index: 0, delta, finish_reason }],
    })}\n\n`);
    send({ role: 'assistant', content: '' });
    if (task.startsWith('ROLE-PARENT-') && !result) {
      const workflow = task.endsWith('-workflow');
      const toolName = workflow ? 'workflow' : 'subagent';
      assert.ok(body.tools.some(tool => tool.function?.name === toolName));
      const roles = task.endsWith('-routed') ? ['explore', 'review', 'planner', 'general'] : ['review'];
      const options = { model: `${reviewProvider}/same-id`, effort: 'high', agentType: 'review' };
      const args = workflow ? { script: `return await agent("ROLE-CHILD-workflow", ${JSON.stringify(options)});`, agentTimeoutMs: 30000 }
        : { tasks: roles.map(agent => ({ agent, task: `ROLE-CHILD-${agent}` })) };
      send({ tool_calls: [{ index: 0, id: task, type: 'function', function: { name: toolName, arguments: JSON.stringify(args) } }] });
      send({}, 'tool_calls');
    } else {
      assert.ok(task.startsWith('ROLE-'));
      send({ content: `${task}-DONE` }); send({}, 'stop');
    }
    res.end('data: [DONE]\n\n');
  } catch (error) {
    serverFailure = error;
    if (!res.headersSent) res.writeHead(500);
    res.end();
  }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));

let app;
let page;
try {
  const env = { ...process.env, DESKTOP_TEST_USER_DATA: profile, DESKTOP_TEST_NO_FOCUS: '1' };
  delete env.ELECTRON_RUN_AS_NODE;
  app = await electron.launch({ ...(process.env.DESKTOP_VERIFY_EXE ? { executablePath: process.env.DESKTOP_VERIFY_EXE }
    : { args: [resolve(import.meta.dirname, '..')], cwd: process.argv[2] }), env, timeout: 60000 });
  assert.equal(await app.evaluate(({ app }) => app.getPath('userData')), profile);
  page = await app.firstWindow();
  await app.evaluate(({ BrowserWindow }) => { const window = BrowserWindow.getAllWindows()[0]; window.setOpacity(0); window.setIgnoreMouseEvents(true); window.showInactive(); });
  await page.waitForFunction(() => document.querySelector('.composer .composer-input') && !document.querySelector('.composer-wrap[aria-busy="true"]') && !document.querySelector('.composer .composer-input').disabled);
  const ids = await page.evaluate(async ({ workspace, baseUrl }) => {
    const model = (id, levels) => ({ id, name: id, reasoning: true, vision: false, contextWindow: 128000, maxTokens: 16384,
      thinkingLevels: levels, thinkingControl: { source: 'manual', levels, defaultLevel: levels[0], mapping: Object.fromEntries(levels.map(level => [level, level])) } });
    for (const [name, route, models] of [
      ['Parent fixture', '/parent', [model('same-id', ['high']), model('fast', ['low'])]],
      ['Review fixture', '/review', [model('near-id', ['medium']), model('same-id', ['medium', 'high'])]],
    ]) await window.desktop.saveProvider({ id: '', name, baseUrl: baseUrl + route, api: 'openai-completions', enabled: true, keyless: false, models }, 'subagent-role-test');
    await window.desktop.beginSession(workspace);
    const providers = (await window.desktop.settings()).providers;
    return { parent: providers.find(p => p.name === 'Parent fixture').id, review: providers.find(p => p.name === 'Review fixture').id };
  }, { workspace, baseUrl: `http://127.0.0.1:${server.address().port}` });
  reviewProvider = ids.review;

  const draft = await page.evaluate(async provider => {
    const state = await window.desktop.snapshot();
    await window.desktop.command('set_model', { provider, modelId: 'same-id' }, state.runtimeId);
    await window.desktop.command('set_thinking_level', { level: 'high' }, state.runtimeId);
    return state.draftId;
  }, ids.parent);
  await page.evaluate(id => window.desktop.createDraftSession(id), draft);
  await waitForSessionFixtureTools(page);
  const before = await page.evaluate(() => window.desktop.snapshot());
  assert.deepEqual(await page.evaluate(() => window.desktop.subagentRoleSettings()), { available: true, values: {} });
  await page.evaluate(async ({ parent, review }) => {
    await Promise.all([
      window.desktop.saveSubagentRole('explore', { provider: parent, id: 'fast', effort: 'low' }),
      window.desktop.saveSubagentRole('review', { provider: review, id: 'same-id', effort: 'medium' }),
      window.desktop.saveSubagentRole('planner', { provider: review, id: 'near-id', effort: 'medium' }),
    ]);
  }, ids);

  async function run(name) {
    const request = `ROLE-PARENT-${name}`;
    await page.evaluate(message => window.desktop.command('prompt', { message }), request);
    const deadline = Date.now() + 45000;
    let state;
    while (Date.now() < deadline) {
      if (serverFailure) throw serverFailure;
      const snapshot = await page.evaluate(async workflow => {
        const state = await window.desktop.snapshot();
        for (const request of state.requests ?? []) {
          if (!workflow || request.method !== 'confirm' || !request.title?.startsWith('Approve workflow'))
            throw new Error('Unexpected fixture approval');
          await window.desktop.command('extension_ui_response', { id: request.id, confirmed: true }, request.runtimeId);
        }
        return state;
      }, name === 'workflow');
      if (!snapshot.state?.isStreaming && snapshot.messages.some(message => message.role === 'assistant' && text(message) === `${request}-DONE`)) {
        state = snapshot;
        break;
      }
      await page.waitForTimeout(100);
    }
    assert.ok(state, `parent did not settle for ${request}`);
    if (serverFailure) throw serverFailure;
    assert.equal(state.runtimeId, before.runtimeId);
    assert.equal(state.state.sessionId, before.state.sessionId);
    assert.equal(state.state.model.provider, ids.parent);
    assert.equal(state.state.model.id, 'same-id');
    assert.equal(state.state.thinkingLevel, 'high');
    const result = state.messages.find(message => message.role === 'toolResult' && message.toolCallId === request);
    if (name === 'workflow') {
      assert.equal(result?.isError, false);
      assert.equal(result?.details?.status, 'completed');
      return;
    }
    assert.ok(Array.isArray(result?.details?.results), `missing subagent record for ${request}`);
    return result.details.results;
  }

  const routed = await run('routed');
  assert.deepEqual(routed.map(row => [row.agent, row.status, row.desktopModel]), [
    ['explore', 'completed', { provider: ids.parent, id: 'fast', effort: 'low', source: 'role' }],
    ['review', 'completed', { provider: ids.review, id: 'same-id', effort: 'medium', source: 'role' }],
    ['planner', 'completed', { provider: ids.review, id: 'near-id', effort: 'medium', source: 'role' }],
    ['general', 'completed', { provider: ids.parent, id: 'same-id', effort: 'high', source: 'inherited' }],
  ]);
  const parent = task => ({ task, path: '/parent/chat/completions', model: 'same-id', effort: 'high' });
  const between = traffic.slice(1, -1).sort((a, b) => a.task.localeCompare(b.task));
  assert.deepEqual(between, [
    { task: 'ROLE-CHILD-explore', path: '/parent/chat/completions', model: 'fast', effort: 'low' },
    parent('ROLE-CHILD-general'),
    { task: 'ROLE-CHILD-planner', path: '/review/chat/completions', model: 'near-id', effort: 'medium' },
    { task: 'ROLE-CHILD-review', path: '/review/chat/completions', model: 'same-id', effort: 'medium' },
  ]);
  assert.deepEqual([traffic[0], traffic.at(-1)], Array(2).fill(parent('ROLE-PARENT-routed')));

  const workflowStart = traffic.length;
  await run('workflow');
  assert.deepEqual(traffic.slice(workflowStart), [
    parent('ROLE-PARENT-workflow'),
    { task: 'ROLE-CHILD-workflow', path: '/review/chat/completions', model: 'same-id', effort: 'high' },
    parent('ROLE-PARENT-workflow'),
  ]);

  const settingsFile = join(runtimeData, 'desktop-subagent-models.json');
  for (const [name, id, effort] of [['missing', 'same-i', 'medium'], ['unsupported', 'same-id', 'low']]) {
    // Reproduce stale settings after a provider catalog change without allowing
    // the settings UI to save invalid values to begin with.
    await writeFile(settingsFile, JSON.stringify({ version: 1, roles: { review: { provider: ids.review, id, effort } } }));
    const start = traffic.length;
    const [row] = await run(name);
    assert.equal(row.status, 'failed');
    assert.equal(row.desktopModel, undefined);
    assert.match(row.errorMessage, /Configured model or thinking level unavailable/);
    assert.deepEqual(traffic.slice(start), Array(2).fill(parent(`ROLE-PARENT-${name}`)));
  }
  await page.evaluate(() => window.desktop.saveSubagentRole('review', null));
  const [reset] = await run('reset');
  assert.deepEqual(reset.desktopModel, { provider: ids.parent, id: 'same-id', effort: 'high', source: 'inherited' });
  console.log('PASS: all four built-in roles, exact provider routing, distinct efforts, fail-closed stale settings, reset, Workflow override, and unchanged parent.');
} catch (error) {
  console.error(JSON.stringify(traffic));
  throw serverFailure ?? error;
} finally {
  if (page) await page.evaluate(async () => {
    const snapshot = await window.desktop.snapshot();
    for (const request of snapshot.requests ?? []) await window.desktop.command('extension_ui_response', { id: request.id, cancelled: true }, request.runtimeId);
    if (snapshot.state?.isStreaming) await window.desktop.command('abort', {}, snapshot.runtimeId);
  }).catch(() => {});
  server.closeAllConnections();
  try { if (app) await closeDesktopFixtureAndWait(app); }
  finally { await new Promise(resolve => server.close(resolve)); }
}
