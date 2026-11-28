import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, realpath, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { _electron as electron } from 'playwright';
import { closeDesktopFixtureAndWait } from './close-desktop-fixture.mjs';
import { waitForSessionFixtureTools } from './session-fixture.mjs';
import { mkdtemp } from './test-profile.mjs';

const profile = await realpath(await mkdtemp(join(tmpdir(), 'desktop-subagent-roles-')));
const workspace = join(profile, 'workspace');
const runtimeData = join(profile, 'step-runtime');
await mkdir(workspace);
await mkdir(runtimeData);
await writeFile(join(profile, 'preferences.json'), JSON.stringify({
  language: 'zh', theme: 'dark', workspaces: [workspace], autoCheckUpdates: false,
}));
await writeFile(join(runtimeData, 'config.toml'), 'permissionPreset = "approve-for-me"\n[telemetry]\nenabled = false\n[mcp_servers.steppage__steppage]\nenabled = false\n');

const text = message => typeof message?.content === 'string' ? message.content
  : message?.content?.filter(block => block.type === 'text').map(block => block.text).join('\n') ?? '';
const traffic = [];
const childInputs = new Map();
const delegations = new Map();
const heldChildren = new Map();
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
    if (task.startsWith('ROLE-CHILD-')) childInputs.set(task, {
      system: body.messages.filter(message => message.role === 'system' || message.role === 'developer').map(text).join('\n'),
      tools: body.tools?.map(tool => tool.function.name).sort() ?? [],
    });
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
        : delegations.get(task) ?? { tasks: roles.map(agent => ({ agent, task: `ROLE-CHILD-${agent}` })) };
      send({ tool_calls: [{ index: 0, id: task, type: 'function', function: { name: toolName, arguments: JSON.stringify(args) } }] });
      send({}, 'tool_calls');
    } else {
      assert.ok(task.startsWith('ROLE-'));
      await heldChildren.get(task)?.promise;
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
  const desktop = resolve(import.meta.dirname, '..');
  const executablePath = process.env.DESKTOP_VERIFY_EXE;
  app = await electron.launch({ ...(executablePath ? { executablePath }
    : { args: [desktop], cwd: process.argv[2] ? resolve(process.argv[2]) : desktop }), env, timeout: 60000 });
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

  async function run(name, background = false) {
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
    if (background) {
      assert.match(result?.details?.agentId, /^lane_[0-9a-f]{8}$/);
      return result.details.agentId;
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

  // Older runtime baselines only ship the built-in model feature.
  if (!(await page.evaluate(() => window.desktop.subagentDefinitions())).available) {
    assert.equal(process.env.DESKTOP_VERIFY_LEGACY_ROLE_MODELS, '1', 'Personal roles are required for this verification');
  } else {
    const personalId = 'custom:fixture-review';
    const readTools = ['find_files', 'list_directory', 'read_file', 'search_files'];
    const owner = { runtimeId: before.runtimeId, sessionId: before.state.sessionId };
    const catalog = () => page.evaluate(() => window.desktop.subagentDefinitions());
    const lanes = () => page.evaluate(({ runtimeId, sessionId }) => window.desktop.backgroundAgents(runtimeId, sessionId), owner);
    const reply = (laneId, prompt) => page.evaluate(request => window.desktop.replyBackgroundAgent(request),
      { ...owner, laneId, prompt, requestId: randomUUID() });
    const resize = (width, height) => app.evaluate(({ BrowserWindow }, size) =>
      BrowserWindow.getAllWindows()[0].setSize(...size), [width, height]);
    const openRoles = async () => {
      await resize(1160, 760);
      await page.locator('.sidebar-settings').click();
      await page.getByRole('navigation', { name: '设置分类' }).getByRole('button', { name: '子代理', exact: true }).click();
      await page.getByRole('button', { name: '新建子代理' }).waitFor();
    };
    const closeRoles = async () => {
      await page.locator('.settings-dialog').getByRole('button', { name: '关闭', exact: true }).click();
      await page.locator('.settings-backdrop').waitFor({ state: 'detached' });
    };
    const rowFor = id => page.locator('.subagent-definition-row').filter({ has: page.locator(`[title="${id}"]`) });
    const back = page.getByRole('button', { name: '返回角色列表' });
    const narrowDetail = async () => {
      await resize(760, 640);
      // Electron's resize request can resolve before Chromium applies the container query.
      await back.waitFor({ state: 'visible' });
    };
    const chooseRole = async id => {
      if (await back.isVisible()) await back.click();
      await rowFor(id).click();
    };
    const newRole = page.getByRole('button', { name: '新建子代理' });
    const form = page.locator('.subagent-definition-form:visible');
    const edit = page.getByRole('button', { name: '编辑角色', exact: true });
    const duplicate = page.getByRole('button', { name: '复制为个人角色' });
    const slug = form.getByRole('textbox', { name: '角色标识' });
    const prompt = form.getByRole('textbox', { name: '系统提示词' });
    const model = form.getByRole('combobox', { name: '模型', exact: true });
    const tools = form.getByRole('combobox', { name: '可用工具' });
    const save = async () => {
      await form.getByRole('button', { name: '保存角色' }).click();
      await form.waitFor({ state: 'hidden' });
    };
    async function delegate(label, agent) {
      const task = `ROLE-CHILD-${label}`;
      delegations.set(`ROLE-PARENT-${label}`, { agentScope: 'both', agent, task });
      const [row] = await run(label);
      return { row, request: childInputs.get(task) };
    }
    async function waitForLane(id, task, status) {
      const deadline = Date.now() + 30000;
      while (Date.now() < deadline) {
        if (serverFailure) throw serverFailure;
        const lane = (await lanes()).lanes.find(lane => lane.id === id);
        if (lane?.status === status && (status === 'running' || !lane.settling) && childInputs.has(task)) return;
        await page.waitForTimeout(100);
      }
      assert.fail(`Background lane did not reach ${status}: ${task}`);
    }
    const focusVisible = async control => {
      await control.focus();
      assert.equal(await control.evaluate(element => {
        const box = element.getBoundingClientRect();
        for (let parent = element.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
          const overflow = getComputedStyle(parent);
          if (!/(auto|scroll|hidden|clip)/.test(`${overflow.overflowX} ${overflow.overflowY}`)) continue;
          const bounds = parent.getBoundingClientRect();
          if (box.left - 4 < bounds.left || box.right + 4 > bounds.right ||
              box.top - 4 < bounds.top || box.bottom + 4 > bounds.bottom) return false;
          if (parent instanceof HTMLDialogElement) break;
        }
        return element === document.activeElement;
      }), true, 'focused control has a full 4px gutter');
    };
    await mkdir('test-results', { recursive: true });
    await mkdir(join(runtimeData, 'agent/agents'), { recursive: true });
    await writeFile(join(runtimeData, 'agent/agents/local-fixture.md'),
      '---\nname: local-fixture\ndescription: Read-only local fixture\n---\nLOCAL-FIXTURE\n');

    await openRoles();
    await chooseRole('local-fixture');
    assert.equal(await edit.count(), 0);
    assert.equal(await page.getByRole('button', { name: '删除角色', exact: true }).count(), 0);
    await chooseRole('planner');
    const planner = page.locator('[data-definition-id="planner"]');
    await planner.getByRole('combobox', { name: '规划 模型' }).selectOption(JSON.stringify([ids.review, 'same-id']));
    await planner.getByRole('combobox', { name: '规划 思考强度' }).selectOption('high');
    await planner.getByRole('button', { name: '保存 规划' }).click();
    await planner.getByRole('status').getByText('已保存').waitFor();
    assert.deepEqual((await page.evaluate(() => window.desktop.subagentRoleSettings())).values.planner,
      { provider: ids.review, id: 'same-id', effort: 'high' });
    await page.locator('.subagent-definitions').screenshot({ path: 'test-results/personal-subagent-catalog-wide-dark.png' });
    await narrowDetail();
    await chooseRole('review');
    await back.click();
    assert.ok(await rowFor('review').evaluate(element =>
      new Promise(resolve => requestAnimationFrame(() => resolve(document.activeElement === element)))));
    await rowFor('review').click();
    await duplicate.click();
    assert.equal(await slug.inputValue(), 'review-copy');
    assert.equal(await tools.inputValue(), 'read');
    await form.getByRole('button', { name: '取消', exact: true }).click();
    await newRole.click();
    assert.ok(await slug.evaluate(element => document.activeElement === element));
    await slug.fill('fixture-review');
    await form.getByRole('textbox', { name: '职责' }).fill('Review fixture notes');
    await prompt.fill('PERSONAL-ROLE-SENTINEL-V1');
    await page.keyboard.press('Escape');
    await form.getByRole('button', { name: '继续编辑' }).click();
    assert.equal(await prompt.inputValue(), 'PERSONAL-ROLE-SENTINEL-V1');
    await model.selectOption(`${ids.review}/same-id`);
    await focusVisible(tools);
    await form.screenshot({ path: 'test-results/personal-subagent-editor-narrow-dark.png' });
    await save();
    assert.equal(await page.locator(`[data-definition-id="${personalId}"] select`).count(), 0);
    assert.ok(await edit.evaluate(element =>
      new Promise(resolve => requestAnimationFrame(() => resolve(document.activeElement === element)))));
    await duplicate.click();
    assert.equal(await model.inputValue(), '');
    assert.equal(await prompt.inputValue(), 'PERSONAL-ROLE-SENTINEL-V1');
    await save();
    assert.ok((await catalog()).roles.some(role => role.id === `${personalId}-copy` && role.source === 'personal'));
    await closeRoles();

    await mkdir(join(workspace, '.stepcode/agents'), { recursive: true });
    await writeFile(join(workspace, '.stepcode/agents/shadow.md'),
      '---\nname: custom:fixture-review\ndescription: Shadow\n---\nPROJECT-SHADOW-SENTINEL\n');
    const v1 = await delegate('personal-v1', personalId);
    assert.equal(v1.row.status, 'completed');
    assert.equal(v1.row.agentSource, 'personal');
    assert.equal(v1.row.desktopModel.provider, ids.review);
    assert.match(v1.request.system, /PERSONAL-ROLE-SENTINEL-V1/);
    assert.doesNotMatch(v1.request.system, /PROJECT-SHADOW-SENTINEL/);
    assert.deepEqual(v1.request.tools, readTools);
    const liveTask = 'ROLE-CHILD-personal-live';
    heldChildren.set(liveTask, Promise.withResolvers());
    delegations.set('ROLE-PARENT-personal-live', { agent: personalId, task: liveTask, run_in_background: true });
    const laneId = await run('personal-live', true);
    await waitForLane(laneId, liveTask, 'running');

    await page.evaluate(() => window.desktop.preferences({ theme: 'light' }));
    await openRoles();
    await chooseRole(personalId);
    await edit.click();
    await prompt.fill('PERSONAL-ROLE-SENTINEL-V2');
    await model.selectOption('');
    await tools.selectOption('edit');
    await chooseRole('planner');
    await chooseRole(personalId);
    assert.equal(await prompt.inputValue(), 'PERSONAL-ROLE-SENTINEL-V2');
    await narrowDetail();
    await focusVisible(prompt);
    await page.locator('.settings-dialog').screenshot({ path: 'test-results/personal-subagent-editor-narrow-light.png' });
    await save();
    await closeRoles();
    const staleReply = 'ROLE-CHILD-personal-stale-reply';
    await assert.rejects(reply(laneId, staleReply), /Start a new delegation/);
    heldChildren.get(liveTask).resolve();
    await waitForLane(laneId, liveTask, 'completed');
    assert.equal(childInputs.has(staleReply), false);
    const v2 = await delegate('personal-v2', personalId);
    assert.equal(v2.row.status, 'completed');
    assert.match(v2.request.system, /PERSONAL-ROLE-SENTINEL-V2/);
    assert.equal(v2.row.desktopModel.provider, ids.parent);
    assert.deepEqual(v2.request.tools, [...readTools, 'edit_file', 'write_file', 'run_command'].sort());
    const current = (await catalog()).roles.find(role => role.id === personalId);
    const mutate = input => page.evaluate(input => window.desktop.saveSubagentDefinition(input), input);
    await assert.rejects(mutate({ ...current, revision: '0'.repeat(64) }), /subagent:conflict/);
    await assert.rejects(mutate({ ...current, profile: ['read'] }), /subagent:invalid/);
    await mutate({ ...current, model: 'missing-provider/missing-model' });
    const invalid = await delegate('personal-missing-model', personalId);
    assert.equal(invalid.row.status, 'failed');
    assert.match(invalid.row.errorMessage, /No fallback model was used/);
    assert.equal(invalid.request, undefined);
    await openRoles();
    await chooseRole(personalId);
    await page.getByRole('button', { name: '删除角色', exact: true }).click();
    const dialog = page.locator('.subagent-role-dialog');
    await dialog.getByRole('button', { name: '确认删除' }).click();
    await dialog.waitFor({ state: 'detached' });
    await closeRoles();
    const deleted = await delegate('personal-deleted', personalId);
    assert.equal(deleted.row.status, 'failed');
    assert.equal(deleted.request, undefined);

    // Install an inert independent package to prove no plugin role API ships here.
    const pluginId = 'personal-role-boundary-fixture';
    const market = join(profile, 'fixture-market');
    const pkg = join(market, pluginId);
    await mkdir(join(market, '.step-plugin'), { recursive: true });
    await mkdir(join(pkg, 'roles'), { recursive: true });
    await writeFile(join(market, '.step-plugin/marketplace.json'), JSON.stringify({
      name: 'personal-role-boundary', plugins: [{ name: pluginId, source: `./${pluginId}` }],
    }));
    await writeFile(join(pkg, 'step.plugin.json'), JSON.stringify({
      id: pluginId, name: 'Personal role boundary fixture', version: '1.0.0', agents: ['roles'], skills: [], commands: [],
    }));
    await writeFile(join(pkg, 'roles/review.md'),
      '---\nname: review\ndescription: Inert plugin fixture\ntools: ["read_file"]\n---\nPLUGIN-ROLE-SENTINEL\n');
    const git = (...args) => execFileSync('git', ['-C', market, ...args], { windowsHide: true, stdio: 'pipe' });
    git('init', '--initial-branch=main');
    git('add', '.step-plugin', pluginId);
    git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-m', 'Inert plugin fixture');
    await page.evaluate(async ({ uri, name }) => {
      await window.desktop.capabilityMutate({ action: 'marketplace-add', source: uri });
      const available = (await window.desktop.capabilityCatalog()).available.find(item => item.name === name);
      if (!available?.package?.ref) throw new Error('Fixture package not discovered');
      await window.desktop.capabilityMutate({
        action: 'plugin-install', name, marketplace: available.marketplace, ref: available.package.ref,
      });
      if (!(await window.desktop.capabilityCatalog()).plugins.some(item => item.id === name)) throw new Error('Fixture not installed');
    }, { uri: pathToFileURL(market).href, name: pluginId });
    const pluginRole = `plugin:${pluginId}:review`;
    assert.ok(!(await catalog()).roles.some(role => role.id === pluginRole || role.prompt.includes('PLUGIN-ROLE-SENTINEL')));
    const rejected = await delegate('plugin-role-unavailable', pluginRole);
    assert.equal(rejected.row.status, 'failed');
    assert.equal(rejected.request, undefined);
    const builtinReview = await delegate('builtin-review-unchanged', 'review');
    assert.equal(builtinReview.row.agentSource, 'builtin');
    assert.equal(builtinReview.row.status, 'completed');
    assert.doesNotMatch(builtinReview.request.system, /PLUGIN-ROLE-SENTINEL/);
    console.log('PASS: personal role settings and dispatch, stale background reply blocked, active child preserved, and installed plugin roles unavailable.');
  }
} catch (error) {
  console.error(JSON.stringify(traffic));
  throw serverFailure ?? error;
} finally {
  for (const entry of heldChildren.values()) entry.resolve();
  if (page) await page.evaluate(async () => {
    const snapshot = await window.desktop.snapshot();
    for (const request of snapshot.requests ?? []) await window.desktop.command('extension_ui_response', { id: request.id, cancelled: true }, request.runtimeId);
    if (snapshot.state?.isStreaming) await window.desktop.command('abort', {}, snapshot.runtimeId);
  }).catch(() => {});
  server.closeAllConnections();
  try { if (app) await closeDesktopFixtureAndWait(app); }
  finally { await new Promise(resolve => server.close(resolve)); }
}
