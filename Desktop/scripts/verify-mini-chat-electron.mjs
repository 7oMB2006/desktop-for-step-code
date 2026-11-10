import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { cp, mkdir, mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { _electron as electron } from 'playwright';
import { closeDesktopFixtureAndWait } from './close-desktop-fixture.mjs';
import { settleLayout } from './settle-layout.mjs';
import { verifyTooltipLayer } from './tooltip-layer-probe.mjs';

const profile = await realpath(await mkdtemp(join(tmpdir(), 'desktop-mini-chat-')));
const root = join(profile, 'step-runtime'), workspace = join(profile, 'project');
const webLocal = join(profile, 'local', 'web-app'), webClient = join(profile, 'client', 'web-app'), scratch = join(profile, 'scratch');
const output = resolve('test-results/mini-chat-native');
await mkdir(join(root, 'sessions'), { recursive: true }); await mkdir(workspace); await mkdir(output, { recursive: true });
for (const path of [webLocal, webClient, scratch]) await mkdir(path, { recursive: true });
await cp(resolve('../theme-marketplace/plugins/stellar-cruise'), join(root, 'plugins/stellar-cruise'), { recursive: true });
const timestamp = new Date().toISOString();
const subagentTask = { agent: 'review', task: 'Selected Mini subagent', status: 'completed', messages: [] };
for (const [id, cwd] of [['one', workspace], ['two', workspace], ['three', workspace],
  ['web-local', webLocal], ['web-client', webClient], ['independent', scratch]]) {
  const lines = [{ type: 'session', version: 3, id, cwd, timestamp }];
  let parentId = null;
  for (let index = 0; index < 12; index++) {
    for (const role of ['user', 'assistant']) {
      const entry = `${id}-${role}-${index}`;
      const workflow = id === 'one' && [4, 5].includes(index) && role === 'assistant'
        ? { callId: `workflow-${index}`, name: index === 4 ? 'Selected Mini workflow' : 'Latest Mini workflow' } : undefined;
      const subagent = id === 'one' && index === 6 && role === 'assistant';
      lines.push({ type: 'message', id: entry, parentId, timestamp, message: {
        role, timestamp: Date.now() + index,
        content: role === 'user' ? `Question ${index} in ${id}` : [
          { type: 'thinking', thinking: `Reasoning ${index}: retain manually opened details.` },
          { type: 'text', text: `## Answer ${index}\n\nNative MiniChat reuses the actual conversation and composer.\n\n`
            + 'Readable text remains available when switching windows.\n\n'.repeat(3) + '```ts\nconst shared = "one runtime";\n```' },
          ...(workflow ? [{ type: 'toolCall', id: workflow.callId, name: 'workflow', arguments: { name: workflow.name, script: 'fixture' } }] : []),
          ...(subagent ? [{ type: 'toolCall', id: 'mini-subagent', name: 'subagent', arguments: {
            tasks: [{ agent: subagentTask.agent, task: subagentTask.task }],
          } }] : []),
        ], ...(role === 'assistant' ? { stopReason: 'stop', usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: { total: 0 } } } : {}),
      } });
      parentId = entry;
      if (workflow) {
        const resultId = `${entry}-result`;
        lines.push({ type: 'message', id: resultId, parentId, timestamp, message: {
          role: 'toolResult', toolName: 'workflow', toolCallId: workflow.callId, content: [{ type: 'text', text: 'Completed fixture workflow' }],
          details: { schemaVersion: 1, runId: `wf_mini_${index}`, name: workflow.name, status: 'completed',
            agents: [], totalAgents: 0, completedAgents: 0 }, isError: false, timestamp: Date.now() + index,
        } });
        parentId = resultId;
      }
      if (subagent) {
        const resultId = `${entry}-result`;
        lines.push({ type: 'message', id: resultId, parentId, timestamp, message: {
          role: 'toolResult', toolName: 'subagent', toolCallId: 'mini-subagent', content: '',
          details: { results: [subagentTask] }, isError: false, timestamp: Date.now() + index,
        } });
        parentId = resultId;
      }
    }
  }
  lines.push({ type: 'session_info', id: `${id}-name`, parentId, timestamp, name: id.startsWith('web-') ? 'Configuration checks' : `Mini ${id}` });
  await writeFile(join(root, 'sessions', `${id}.jsonl`), lines.map(value => JSON.stringify(value)).join('\n') + '\n');
}
await writeFile(join(root, 'config.toml'), 'defaultProvider = "fixture"\ndefaultModel = "fixture"\npermissionPreset = "ask"\n[telemetry]\nenabled = false\n');
await writeFile(join(profile, 'preferences.json'), JSON.stringify({ language: 'zh', theme: 'dark', workspace,
  workspaces: [workspace, webLocal, webClient], terminalDock: 'bottom', completionSound: true }));
const requests = [];
const held = new Map();
const chunk = (delta, finish_reason = null) => `data: ${JSON.stringify({ id: 'mini-fixture', object: 'chat.completion.chunk', model: 'fixture',
  choices: [{ index: 0, delta, finish_reason }] })}\n\n`;
const textOf = content => typeof content === 'string' ? content : content?.map(block => block.text ?? '').join('\n') ?? '';
const server = createServer(async (request, response) => {
  if (request.method === 'GET') {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end('<!doctype html><title>MiniChat link handoff</title><p>Opened in the main window.</p>');
    return;
  }
  let body = ''; for await (const part of request) body += part;
  const payload = JSON.parse(body); requests.push(payload);
  const label = textOf(payload.messages.findLast(message => message.role === 'user' && /MINI-/.test(textOf(message.content)))?.content);
  response.writeHead(200, { 'content-type': 'text/event-stream' });
  if (label.includes('MINI-APPROVAL') && !payload.messages.some(message => message.role === 'tool' && message.tool_call_id === 'mini-write')) {
    response.end(chunk({ tool_calls: [{ index: 0, id: 'mini-write', type: 'function',
      function: { name: 'write_file', arguments: JSON.stringify({ path: 'mini-approved.txt', content: 'Explicit MiniChat approval' }) } }] }, 'tool_calls') + 'data: [DONE]\n\n');
  } else if (label.includes('MINI-HOLD')) {
    held.set(label, response); response.write(chunk({ role: 'assistant', content: 'Mini streaming is live.' }));
  } else response.end(chunk({ role: 'assistant', content: label.includes('MINI-WEB-LINK')
    ? `[MiniChat local page](http://127.0.0.1:${server.address().port}/mini-link)`
    : label.includes('MINI-FILE-LINK') ? '[MiniChat local file](./handoff.md)'
    : `Completed ${label || 'MINI-SEND'}.` }, 'stop') + 'data: [DONE]\n\n');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
await writeFile(join(root, 'models.json'), JSON.stringify({ providers: { fixture: {
  api: 'openai-completions', baseUrl: `http://127.0.0.1:${server.address().port}/v1`, apiKey: 'isolated-mini-fixture',
  models: [{ id: 'fixture', name: 'Mini fixture', contextWindow: 65536, maxTokens: 2048 }],
} } }));
const env = { ...process.env, DESKTOP_TEST_USER_DATA: profile, DESKTOP_TEST_NO_FOCUS: '1' };
delete env.ELECTRON_RUN_AS_NODE;
const executablePath = process.env.DESKTOP_VERIFY_EXE;
let app, mini;
const errors = [];
try {
  app = await electron.launch({ ...(executablePath ? { executablePath } : {}),
    args: [...(executablePath ? [] : [resolve('.')]), '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding', '--disable-features=CalculateNativeWinOcclusion'],
    env, timeout: 60000 });
  const main = await app.firstWindow();
  main.setDefaultTimeout(30000); main.on('pageerror', error => errors.push(error.message));
  const mainWindowId = await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    window.setOpacity(0); window.setIgnoreMouseEvents(true); window.showInactive(); window.setSize(1320, 880);
    return window.id;
  });
  await main.getByRole('button', { name: 'Mini one', exact: true }).click();
  await main.waitForFunction(async () => {
    const snapshot = await window.desktop.snapshot();
    return snapshot.state?.sessionId === 'one' && !document.querySelector('.session-reading-preview')
      && document.querySelector('.composer-wrap')?.getAttribute('aria-busy') === 'false'
      && document.querySelector('main .composer-input')?.getAttribute('contenteditable') === 'true';
  }, undefined, { timeout: 60000 });
  await main.locator('main .composer-input').fill('Shared from main');
  const opened = app.waitForEvent('window').catch(error => ({ error }));
  await main.getByRole('button', { name: 'MiniChat', exact: true }).click();
  mini = await opened;
  if (mini.error) throw mini.error;
  mini.setDefaultTimeout(30000); mini.on('pageerror', error => errors.push(error.message));
  await mini.waitForFunction(() => window.desktop?.surface === 'mini' && document.querySelector('main .composer-input'));
  await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows().find(window => window.getTitle() === 'MiniChat');
    window.setOpacity(0); window.setIgnoreMouseEvents(true); window.showInactive();
  });
  const editor = mini.locator('main .composer-input');
  await mini.waitForFunction(() => document.querySelector('main .composer-input')?.textContent === 'Shared from main');
  await editor.fill('Shared from mini');
  await main.waitForFunction(() => document.querySelector('main .composer-input')?.textContent === 'Shared from mini');
  const minimizeState = await app.evaluate(({ BrowserWindow }, mainId) => {
    const miniWindow = BrowserWindow.getAllWindows().find(window => window.getTitle() === 'MiniChat');
    return { miniId: miniWindow.id, mainMinimized: BrowserWindow.fromId(mainId).isMinimized() };
  }, mainWindowId);
  const minimizeWindow = async () => {
    await mini.getByRole('button', { name: '最小化', exact: true }).click();
    await app.evaluate(async ({ BrowserWindow }, id) => {
      const window = BrowserWindow.fromId(id), deadline = Date.now() + 5000;
      while (!window.isMinimized() && Date.now() < deadline)
        await new Promise(resolve => setTimeout(resolve, 20));
    }, minimizeState.miniId);
    assert.deepEqual(await app.evaluate(({ BrowserWindow }, { miniId, mainId }) => ({
      miniMinimized: BrowserWindow.fromId(miniId).isMinimized(),
      mainMinimized: BrowserWindow.fromId(mainId).isMinimized(),
    }), { miniId: minimizeState.miniId, mainId: mainWindowId }),
    { miniMinimized: true, mainMinimized: minimizeState.mainMinimized }, 'Minimize targets only MiniChat');
  };
  const restoreMiniWindow = async () => {
    await main.getByRole('button', { name: 'MiniChat', exact: true }).click();
    assert.equal(await app.evaluate(({ BrowserWindow }, id) => {
      const window = BrowserWindow.fromId(id);
      window.showInactive();
      return window.isMinimized();
    }, minimizeState.miniId), false, 'The MiniChat entry restores the same native window');
    await editor.waitFor();
  };
  const runtimeBeforeMinimize = (await mini.evaluate(() => window.desktop.snapshot())).runtimeId;
  await minimizeWindow();
  await restoreMiniWindow();
  assert.equal(await editor.innerText(), 'Shared from mini', 'Minimize retains the shared draft');
  assert.equal((await mini.evaluate(() => window.desktop.snapshot())).runtimeId, runtimeBeforeMinimize,
    'Restoring reuses the same session runtime');
  const both = await Promise.all([main.evaluate(() => window.desktop.snapshot()), mini.evaluate(() => window.desktop.snapshot())]);
  assert.equal(both[0].runtimeId, both[1].runtimeId);
  assert.equal(both[0].runtimes.filter(worker => worker.sessionId === 'one').length, 1);
  assert.equal(await mini.locator('.sidebar, .window-bar, .right-tool-rail, .performance-bar').count(), 0);
  assert.equal(await mini.evaluate(() => typeof window.require), 'undefined');
  await assert.rejects(mini.evaluate(() => window.desktop.browserLayout({})), /main window/);
  await assert.rejects(mini.evaluate(() => window.desktop.preferences({ language: 'en' })), /main window/);
  const miniScroll = mini.locator('#conversation-scroll');
  const miniTrack = mini.locator('.conversation-scroll-track');
  const scrollEvidence = [];
  for (const [width, theme] of [[360, 'dark'], [900, 'light'], [1600, 'dark']]) {
    await main.evaluate(theme => window.desktop.preferences({ theme }), theme);
    const size = await app.evaluate(({ BrowserWindow }, width) => {
      const window = BrowserWindow.getAllWindows().find(window => window.getTitle() === 'MiniChat');
      window.setContentSize(width, 680);
      return window.getContentSize();
    }, width);
    await mini.waitForFunction(([width, height]) => innerWidth === width && innerHeight === height, size);
    await settleLayout(mini.locator('.app'));
    const geometry = await mini.evaluate(() => {
      const box = selector => {
        const { x, y, width, height, right, bottom } = document.querySelector(selector).getBoundingClientRect();
        return { x, y, width, height, right, bottom };
      };
      const messages = document.querySelector('.messages');
      const actions = document.querySelector('.mini-chat-window-actions');
      const trigger = box('.mini-chat-session');
      const gapX = (trigger.right + actions.getBoundingClientRect().left) / 2;
      const gapY = trigger.y + trigger.height / 2;
      const gap = document.elementFromPoint(gapX, gapY);
      return { width: innerWidth, scroll: box('.conversation'), track: box('.conversation-scroll-track'),
        ruler: box('.turn-marker-layer'), trigger, actions: box('.mini-chat-window-actions'),
        gapIsHeader: gap?.matches('.mini-chat-header') === true,
        gapRegion: gap ? getComputedStyle(gap).webkitAppRegion : '',
        textRight: messages.getBoundingClientRect().right - parseFloat(getComputedStyle(messages).paddingRight) };
    });
    scrollEvidence.push({ theme, geometry });
    assert.ok(geometry.scroll.right - geometry.track.right <= 4, `${width}: scroll handle stays at the window edge`);
    assert.ok(geometry.scroll.right - geometry.ruler.right <= 22, `${width}: turns stay at the window edge`);
    assert.ok(geometry.track.y >= geometry.scroll.y && geometry.track.bottom <= geometry.scroll.bottom,
      `${width}: the scroll handle cannot extend over the composer or header`);
    assert.ok(geometry.textRight <= geometry.ruler.x - 4, `${width}: text does not overlap turn markers`);
    assert.ok(geometry.trigger.width <= 360 && geometry.trigger.width <= geometry.width * .6,
      `${width}: the conversation switcher does not fill the titlebar`);
    if (width >= 900) {
      assert.ok(geometry.actions.x - geometry.trigger.right >= 150, `${width}: spare titlebar remains draggable`);
      assert.ok(geometry.gapIsHeader && geometry.gapRegion === 'drag', `${width}: spare titlebar is not a switcher hit target`);
    }
    await mini.getByRole('button', { name: '切换小窗会话', exact: true }).click();
    const menu = mini.getByRole('dialog', { name: '小窗会话', exact: true });
    await menu.waitFor();
    const menuBox = await menu.boundingBox();
    assert.ok(menuBox.x >= 0 && menuBox.x + menuBox.width <= geometry.width, `${width}: session menu stays on screen`);
    await mini.keyboard.press('Escape');
    for (const selector of ['.conversation', '.turn-marker.active', '.conversation-scroll-track']) {
      await miniTrack.focus();
      await mini.keyboard.press('End');
      await mini.waitForFunction(() => {
        const element = document.querySelector('#conversation-scroll');
        return element.scrollHeight - element.clientHeight - element.scrollTop <= 1;
      });
      const before = await miniScroll.evaluate(element => element.scrollTop);
      await mini.locator(selector).hover();
      await mini.mouse.wheel(0, -64);
      await mini.waitForFunction(before => document.querySelector('#conversation-scroll').scrollTop < before - 20, before);
      await mini.getByRole('button', { name: '回到底部', exact: true }).waitFor();
      scrollEvidence.push({ width, selector, before, after: await miniScroll.evaluate(element => element.scrollTop) });
    }
    const thumb = await miniTrack.locator('.conversation-scroll-thumb').boundingBox();
    const beforeDrag = await miniScroll.evaluate(element => element.scrollTop);
    await mini.mouse.move(thumb.x + thumb.width / 2, thumb.y + thumb.height / 2);
    await mini.mouse.down();
    await mini.mouse.move(thumb.x + thumb.width / 2, thumb.y + thumb.height / 2 - 36, { steps: 5 });
    await mini.mouse.up();
    assert.ok(await miniScroll.evaluate(element => element.scrollTop) < beforeDrag - 20, `${width}: handle dragging scrolls the transcript`);
    const markerLabel = await mini.locator('.turn-marker').first().getAttribute('aria-label');
    const question = /Question (\d+) in one/.exec(markerLabel)[1];
    await mini.locator('.turn-marker').first().click();
    await mini.waitForFunction(question => {
      const viewport = document.querySelector('#conversation-scroll');
      const message = viewport.querySelector(`[data-message-entry-id="one-user-${question}"]`);
      return message && Math.abs(message.getBoundingClientRect().top - viewport.getBoundingClientRect().top) <= 1;
    }, question);
    await mini.screenshot({ path: join(output, `native-scroll-${theme}-${width}.png`) });
  }
  await writeFile(join(output, 'scroll-geometry.json'), JSON.stringify(scrollEvidence, null, 2));
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => window.getTitle() === 'MiniChat').setSize(470, 680));
  await main.evaluate(() => window.desktop.preferences({ theme: 'dark' }));
  await miniTrack.focus();
  await mini.keyboard.press('End');
  const mainBeforePicker = await main.evaluate(() => window.desktop.snapshot());
  const nativePicker = mini.getByRole('dialog', { name: '小窗会话', exact: true });
  const nativeSearch = nativePicker.getByRole('searchbox', { name: '搜索小窗会话', exact: true });
  const openPicker = async () => {
    await mini.getByRole('button', { name: '切换小窗会话', exact: true }).click();
    await nativeSearch.waitFor();
    await settleLayout(nativePicker);
    assert.equal(await nativeSearch.evaluate(element => element === document.activeElement), true);
  };
  await openPicker();
  const projectPlus = nativePicker.locator('.mini-session-group').first().getByRole('button');
  await projectPlus.hover();
  await verifyTooltipLayer(mini, nativePicker);
  assert.equal(await nativeSearch.evaluate(element => element === document.activeElement), true, 'Tooltip does not move native picker focus');
  await mini.screenshot({ path: join(output, 'native-picker-tooltip.png') });
  await nativePicker.evaluate(element => element.hidePopover());
  await mini.locator('.app-tooltip').waitFor({ state: 'detached' });
  await nativePicker.waitFor({ state: 'hidden' });
  await openPicker();
  assert.equal(await nativePicker.locator('.mini-session-group').count(), 4);
  assert.match(await nativePicker.locator('.mini-session-group').first().innerText(), /project/);
  assert.equal(await nativePicker.locator('summary[aria-expanded="true"]').count(), 1, 'Only the current project starts expanded');
  await nativePicker.locator('.mini-session-group').first().locator('summary').click();
  await mini.waitForFunction(() => document.querySelector('.mini-session-group details')?.open === false);
  assert.equal(await nativePicker.isVisible(), true, 'Collapsing the current project cannot dismiss the native picker');
  const localProject = nativePicker.getByRole('region', { name: webLocal, exact: true });
  const localSummary = localProject.locator('summary');
  await localSummary.focus(); await mini.keyboard.press('Space');
  await localProject.getByRole('option', { name: 'Configuration checks', exact: true }).waitFor();
  await mini.keyboard.press('Enter');
  await mini.waitForFunction(path => {
    const group = [...document.querySelectorAll('.mini-session-group')].find(element => element.getAttribute('aria-label') === path);
    return group?.querySelector('details')?.open === false;
  }, webLocal);
  assert.equal(await nativePicker.isVisible(), true, 'Keyboard collapse of another project cannot dismiss the native picker');
  await mini.keyboard.press('Space');
  await localProject.getByRole('option', { name: 'Configuration checks', exact: true }).click();
  await mini.waitForFunction(async () => (await window.desktop.snapshot()).state?.sessionId === 'web-local');
  await mini.locator('.composer-wrap[aria-busy="false"]').waitFor();
  await openPicker();
  await nativeSearch.fill('Configuration checks');
  assert.equal(await nativePicker.getByRole('option').count(), 2);
  for (const path of [webLocal, webClient])
    assert.equal(await nativePicker.getByRole('region', { name: path, exact: true }).getByRole('option').count(), 1);
  await mini.screenshot({ path: join(output, 'native-picker-duplicate-projects.png') });
  await nativePicker.getByRole('region', { name: webClient, exact: true }).getByRole('option').click();
  await mini.waitForFunction(async () => (await window.desktop.snapshot()).state?.sessionId === 'web-client');
  await mini.locator('.composer-wrap[aria-busy="false"]').waitFor();
  await mini.locator('.mini-chat-session-copy strong').getByText('Configuration checks', { exact: true }).waitFor();
  assert.equal((await main.evaluate(() => window.desktop.snapshot())).runtimeId, mainBeforePicker.runtimeId);
  await openPicker();
  await nativeSearch.fill(webLocal);
  await settleLayout(nativePicker);
  const localPlus = nativePicker.getByRole('region', { name: webLocal, exact: true }).getByRole('button', { name: `在 ${webLocal} 新建会话`, exact: true });
  await localPlus.focus();
  await verifyTooltipLayer(mini, nativePicker);
  assert.equal(await localPlus.evaluate(element => element === document.activeElement), true);
  await mini.screenshot({ path: join(output, 'native-picker-tooltip-path.png') });
  await localPlus.click();
  await mini.locator('.app-tooltip').waitFor({ state: 'detached' });
  await mini.waitForFunction(async path => {
    const snapshot = await window.desktop.snapshot();
    return snapshot.draftId && !snapshot.independent && snapshot.preferences.workspace === path;
  }, webLocal);
  await mini.locator('.mini-chat-session-copy strong').getByText('新会话', { exact: true }).waitFor();
  await mini.locator('.composer-wrap[aria-busy="false"]').waitFor();
  await editor.fill('Keep this project-specific MiniChat draft');
  const projectDraft = (await mini.evaluate(() => window.desktop.snapshot())).draftId;
  await openPicker();
  await nativeSearch.fill('独立会话');
  await nativePicker.getByRole('button', { name: '新建独立会话', exact: true }).click();
  await mini.waitForFunction(async () => {
    const snapshot = await window.desktop.snapshot();
    return snapshot.draftId && snapshot.independent;
  });
  await mini.locator('.composer-wrap[aria-busy="false"]').waitFor();
  const independentDraft = await mini.evaluate(() => window.desktop.snapshot());
  assert.equal(independentDraft.draftId, projectDraft, 'Retargeting an unsubmitted draft preserves its identity');
  assert.equal(await editor.textContent(), 'Keep this project-specific MiniChat draft', 'Retargeting an unsubmitted draft keeps its input');
  assert.ok(independentDraft.independent);
  const mainAfterPicker = await main.evaluate(() => window.desktop.snapshot());
  assert.equal(mainAfterPicker.runtimeId, mainBeforePicker.runtimeId);
  assert.deepEqual(mainAfterPicker.preferences.collapsedWorkspaces, mainBeforePicker.preferences.collapsedWorkspaces);
  assert.deepEqual(mainAfterPicker.preferences.workspaces, mainBeforePicker.preferences.workspaces);
  assert.equal(mainAfterPicker.preferences.workspace, mainBeforePicker.preferences.workspace);
  await openPicker();
  await nativeSearch.fill('Mini one');
  await nativePicker.getByRole('option', { name: 'Mini one', exact: true }).click();
  await mini.waitForFunction(() => document.querySelector('main .composer-input')?.textContent === 'Shared from mini');
  assert.equal(requests.length, 0, 'Project search, navigation and draft creation never invoke the model');
  const expandMainTerminal = async () => {
    const panel = main.locator('#terminal-panel');
    if (await panel.getAttribute('aria-hidden') !== 'false')
      await main.locator('.right-tool-rail').getByRole('button', { name: '终端', exact: true }).click();
    await main.locator('#terminal-panel[aria-hidden="false"]').waitFor();
    await main.waitForFunction(() => document.querySelector('#terminal-panel .terminal-footer')?.textContent.includes('运行中'));
    const owner = (await main.evaluate(() => window.desktop.snapshot())).runtimeId;
    const terminals = await main.evaluate(id => window.desktop.terminalList(id), owner);
    assert.ok(terminals.length);
    await panel.getByRole('button', { name: '全屏查看', exact: true }).click();
    await main.waitForFunction(() => document.querySelector('.main-content')?.inert === true);
    return { owner, terminalId: terminals[0].id };
  };
  const verifyTerminalRestored = async ({ owner, terminalId }) => {
    await main.waitForFunction(() => document.querySelector('.main-content')?.inert === false);
    assert.equal(await main.locator('#terminal-panel').evaluate(element => element.classList.contains('is-expanded')), false);
    assert.ok((await main.evaluate(id => window.desktop.terminalList(id), owner))
      .some(terminal => terminal.id === terminalId && terminal.status === 'running'), 'Handoff collapses the terminal without stopping its PTY');
    await main.locator('.right-tool-rail').getByRole('button', { name: '终端', exact: true }).click();
    await main.locator('#terminal-panel[aria-hidden="true"]').waitFor({ state: 'attached' });
  };
  // The clicked historical workflow, not the latest run or saved catalog, wins.
  await main.evaluate(() => window.desktop.navigateSession('two'));
  await main.reload();
  await mini.locator('article.message.assistant').filter({ hasText: 'Answer 4' }).locator('.historical-agents > summary').click();
  const workflowCard = mini.locator('.workflow-heading').filter({ hasText: 'Selected Mini workflow' });
  const reopenMini = async () => {
    await main.getByRole('button', { name: 'MiniChat', exact: true }).click();
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => window.getTitle() === 'MiniChat').showInactive());
  };
  // A repeated handoff may leave identical content mounted in main. Its old
  // content cannot acknowledge the new action; observe the native hide first.
  const waitForHandoff = async () => {
    const hidden = await app.evaluate(async ({ BrowserWindow }, id) => {
      const window = BrowserWindow.fromId(id), deadline = Date.now() + 5000;
      while (window.isVisible() && Date.now() < deadline)
        await new Promise(resolve => setTimeout(resolve, 20));
      return !window.isVisible();
    }, minimizeState.miniId);
    assert.equal(hidden, true, 'The new handoff hides the native MiniChat window');
  };
  for (let repeat = 0; repeat < 2; repeat++) {
    const terminal = repeat ? undefined : await expandMainTerminal();
    if (repeat) await reopenMini();
    await workflowCard.click();
    await waitForHandoff();
    const overview = main.locator('#subagent-panel[aria-hidden="false"] .workflow-overview-heading strong');
    await overview.waitFor();
    assert.equal(await overview.textContent(), 'Selected Mini workflow');
    assert.equal((await main.evaluate(() => window.desktop.snapshot())).state.sessionId, 'one');
    assert.equal(await main.locator('#workflow-catalog-panel[aria-hidden="false"]').count(), 0);
    if (terminal) await verifyTerminalRestored(terminal);
  }
  await main.locator('#subagent-panel').getByRole('button', { name: '关闭面板', exact: true }).click();
  await main.locator('#subagent-panel').waitFor({ state: 'detached' });
  await reopenMini();
  const subagentArticle = mini.locator('article.message.assistant').filter({ hasText: 'Answer 6' });
  await subagentArticle.locator('.historical-agents > summary').click();
  for (let repeat = 0; repeat < 2; repeat++) {
    if (repeat) await reopenMini();
    await subagentArticle.locator('.lane-row[data-lane-agent="review"]').click();
    await waitForHandoff();
    const description = main.locator('#subagent-panel[aria-hidden="false"] .subagent-task');
    await description.waitFor();
    assert.equal(await description.textContent(), subagentTask.task);
  }
  await main.locator('#subagent-panel').getByRole('button', { name: '关闭面板', exact: true }).click();
  await main.locator('#subagent-panel').waitFor({ state: 'detached' });
  await reopenMini();
  await editor.fill('/workflows'); await editor.press('Escape'); await editor.press('Enter');
  await waitForHandoff();
  await main.locator('#workflow-catalog-panel[aria-hidden="false"]').waitFor();
  assert.equal(await main.locator('#subagent-panel[aria-hidden="false"]').count(), 0, 'Bare workflows opens the saved catalog, not run details');
  await main.keyboard.press('Escape');
  await main.locator('#workflow-catalog-panel[aria-hidden="false"]').waitFor({ state: 'detached' });
  const taskTerminal = await expandMainTerminal();
  await reopenMini();
  await editor.fill('/todos'); await editor.press('Escape'); await editor.press('Enter');
  await main.getByRole('heading', { name: '推进清单', exact: true }).waitFor();
  await verifyTerminalRestored(taskTerminal);
  await main.locator('.summary-board').getByRole('button', { name: '关闭侧栏', exact: true }).click();
  assert.equal(requests.length, 0, 'Inspecting workflows never sends a model request');
  await reopenMini();
  await editor.fill('Shared from mini');
  await main.waitForFunction(() => document.querySelector('main .composer-input')?.textContent === 'Shared from mini');
  const quote = { id: 'shared-quote', entryId: 'one-assistant-0', messageIndex: 1, role: 'assistant',
    text: 'Native MiniChat', markdown: 'Native MiniChat', startOffset: 0, endOffset: 15 };
  await main.evaluate(async quote => {
    const owner = { sessionId: 'one' }, current = await window.desktop.composerRead(owner);
    await window.desktop.composerWrite({ owner, revision: current.revision, value: { ...current.value, quotes: [quote] } });
  }, quote);
  await mini.locator('.quote-chip').waitFor();
  await main.locator('.quote-chip').waitFor();
  await mini.screenshot({ path: join(output, 'native-dark.png') });
  const selected = await main.evaluate(() => window.desktop.snapshot());
  await mini.getByRole('button', { name: '切换小窗会话' }).click();
  await mini.getByRole('option', { name: 'Mini two', exact: true }).click();
  await mini.waitForFunction(async () => (await window.desktop.snapshot()).state?.sessionId === 'two');
  assert.equal((await main.evaluate(() => window.desktop.snapshot())).runtimeId, selected.runtimeId);
  await mini.getByRole('button', { name: '切换小窗会话' }).click();
  await mini.getByRole('option', { name: 'Mini one', exact: true }).click();
  await mini.waitForFunction(() => document.querySelector('main .composer-input')?.textContent === 'Shared from mini');
  await mini.locator('.quote-chip').waitFor();
  // Reload between atomic take and prompt restores the abandoned unsent input.
  await mini.evaluate(async () => {
    const owner = { sessionId: 'one' }, current = await window.desktop.composerRead(owner);
    await window.desktop.composerTake(owner, current.revision);
  });
  await main.waitForFunction(() => document.querySelector('main .composer-input')?.textContent === '');
  await mini.reload();
  await mini.waitForFunction(() => document.querySelector('main .composer-input')?.textContent === 'Shared from mini');
  await main.waitForFunction(() => document.querySelector('main .composer-input')?.textContent === 'Shared from mini');
  await mini.locator('.quote-chip').waitFor();
  assert.equal(requests.length, 0, 'Recovering an abandoned take never submits a model request');
  const cold = await Promise.all([
    main.evaluate(() => window.desktop.navigateSession('three')),
    mini.evaluate(() => window.desktop.navigateSession('three')),
  ]);
  assert.equal(cold[0].runtimeId, cold[1].runtimeId, 'Both windows coalesce the same cold startup');
  assert.equal(cold[0].runtimes.filter(worker => worker.sessionId === 'three').length, 1);
  await Promise.all([main.reload(), mini.reload()]);
  await mini.getByRole('button', { name: '切换小窗会话' }).click();
  await mini.getByRole('option', { name: 'Mini one', exact: true }).click();
  await mini.waitForFunction(() => document.querySelector('main .composer-input')?.textContent === 'Shared from mini');
  assert.equal((await main.evaluate(() => window.desktop.snapshot())).state.sessionId, 'three');
  await assert.rejects(main.evaluate(() => window.desktop.deleteSession('one')), /both windows|主窗口和小窗/);
  await mini.getByRole('button', { name: '关闭小窗', exact: true }).click();
  await main.getByRole('button', { name: 'MiniChat', exact: true }).click();
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => window.getTitle() === 'MiniChat').showInactive());
  assert.equal((await mini.evaluate(() => window.desktop.snapshot())).state.sessionId, 'one', 'Reopening resumes MiniChat, not main’s different selection');
  await main.getByRole('button', { name: 'Mini one', exact: true }).click();
  await main.waitForFunction(() => document.querySelector('main .composer-input')?.textContent === 'Shared from mini'
    && document.querySelector('.composer-wrap')?.getAttribute('aria-busy') === 'false');
  const waitForPin = async expected => {
    for (let attempt = 0; attempt < 100; attempt++) {
      const pinned = await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().find(window => window.getTitle() === 'MiniChat').isAlwaysOnTop());
      if (pinned === expected) return;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert.fail(`OS pin state never became ${expected}`);
  };
  await mini.getByRole('button', { name: '置顶窗口', exact: true }).click();
  await waitForPin(true);
  await mini.getByRole('button', { name: '取消置顶', exact: true }).click();
  await waitForPin(false);
  await mini.evaluate(() => { window.__soundPlays = 0; HTMLMediaElement.prototype.play = async () => { window.__soundPlays++; }; });
  await main.evaluate(() => { window.__soundPlays = 0; HTMLMediaElement.prototype.play = async () => { window.__soundPlays++; }; });
  // Two windows compete for exactly the same input; only the winner may prompt.
  await editor.fill('MINI-SEND-ONCE');
  await main.waitForFunction(() => document.querySelector('main .composer-input')?.textContent === 'MINI-SEND-ONCE');
  // Both clicks must reach take before either button changes from Send to Stop.
  await app.evaluate(({ ipcMain }) => {
    const handler = ipcMain._invokeHandlers.get('desktop');
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    globalThis.miniSendGate = { handler, release, attempts: 0 };
    ipcMain.removeHandler('desktop');
    ipcMain.handle('desktop', async (event, method, ...args) => {
      if (method === 'composerTake') { globalThis.miniSendGate.attempts++; await gate; }
      return handler(event, method, ...args);
    });
  });
  await Promise.all([main.locator('main .composer-action-button').click(), mini.locator('main .composer-action-button').click()]);
  assert.equal(await app.evaluate(async ({ ipcMain }) => {
    const deadline = Date.now() + 5000;
    while (globalThis.miniSendGate.attempts < 2 && Date.now() < deadline)
      await new Promise(resolve => setTimeout(resolve, 20));
    const { handler, release, attempts } = globalThis.miniSendGate;
    ipcMain.removeHandler('desktop'); ipcMain.handle('desktop', handler);
    release(); delete globalThis.miniSendGate;
    return attempts;
  }), 2, 'Both send attempts compete at the real compare-and-swap boundary');
  await mini.getByText(/Completed [\s\S]*MINI-SEND-ONCE/).waitFor();
  assert.equal(requests.filter(request => JSON.stringify(request.messages).includes('MINI-SEND-ONCE')).length, 1);
  await mini.waitForFunction(async () => !(await window.desktop.snapshot()).state.isStreaming);
  await main.waitForFunction(() => window.__soundPlays === 1);
  assert.equal(await mini.evaluate(() => window.__soundPlays), 0);
  assert.equal(await main.evaluate(() => window.__soundPlays), 1);
  await editor.fill('MINI-HOLD-STOP'); await editor.press('Enter');
  await mini.getByText('Mini streaming is live.', { exact: true }).waitFor();
  const runningBeforeMinimize = await mini.evaluate(() => window.desktop.snapshot());
  await minimizeWindow();
  const runningWhileMinimized = await main.evaluate(() => window.desktop.snapshot());
  assert.equal(runningWhileMinimized.state.isStreaming, true, 'Minimizing never stops the worker');
  assert.equal(runningWhileMinimized.runtimeId, runningBeforeMinimize.runtimeId);
  await restoreMiniWindow();
  await mini.getByRole('button', { name: '停止此轮', exact: true }).waitFor();
  await mini.getByRole('button', { name: '关闭小窗', exact: true }).click();
  assert.equal((await main.evaluate(() => window.desktop.snapshot())).state.isStreaming, true, 'Hiding MiniChat never stops the worker');
  await main.getByRole('button', { name: 'MiniChat', exact: true }).click();
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => window.getTitle() === 'MiniChat').showInactive());
  await mini.getByRole('button', { name: '停止此轮', exact: true }).click();
  await mini.waitForFunction(async () => !(await window.desktop.snapshot()).state.isStreaming);
  // A genuine write-file approval remains pending when the mini window is hidden.
  await editor.fill('MINI-APPROVAL'); await editor.press('Enter');
  await mini.locator('.permission-approval').waitFor();
  const pending = (await mini.evaluate(() => window.desktop.snapshot())).requests[0];
  await mini.getByRole('button', { name: '关闭小窗', exact: true }).click();
  assert.equal((await main.evaluate(() => window.desktop.snapshot())).requests[0].id, pending.id);
  await main.getByRole('button', { name: 'MiniChat', exact: true }).click();
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => window.getTitle() === 'MiniChat').showInactive());
  await mini.locator('.permission-approval').getByRole('button', { name: '批准本次操作', exact: true }).click();
  await mini.waitForFunction(async () => !(await window.desktop.snapshot()).state.isStreaming);
  assert.equal(await readFile(join(workspace, 'mini-approved.txt'), 'utf8'), 'Explicit MiniChat approval');
  assert.equal((await main.evaluate(() => window.desktop.snapshot())).requests.length, 0);
  // Independent reading survives reload; Return explicitly transfers it to main.
  await mini.evaluate(() => {
    const viewport = document.querySelector('.conversation'); viewport.scrollTop = 180;
    viewport.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, bubbles: true }));
    viewport.dispatchEvent(new Event('scroll', { bubbles: true }));
  });
  await mini.getByRole('button', { name: '回到底部', exact: true }).waitFor();
  await mini.waitForTimeout(300);
  const reading = await mini.evaluate(() => document.querySelector('.conversation').scrollTop);
  await mini.reload();
  await mini.waitForFunction(() => document.querySelector('main .composer-input')?.getAttribute('contenteditable') === 'true');
  await mini.waitForFunction(top => Math.abs(document.querySelector('.conversation').scrollTop - top) < 4, reading);
  const anchor = await mini.evaluate(() => {
    const viewport = document.querySelector('.conversation');
    const top = viewport.getBoundingClientRect().top;
    const article = [...viewport.querySelectorAll('.messages > article[data-message-index]')]
      .find(article => article.getBoundingClientRect().bottom > top);
    return { index: article.dataset.messageIndex, offset: article.getBoundingClientRect().top - top };
  });
  await main.getByRole('button', { name: '远程访问', exact: true }).click();
  await main.getByRole('region', { name: '远程访问', exact: true }).waitFor();
  // Hold the return snapshot while the old main view emits presentation-saving events.
  await app.evaluate(({ ipcMain, BrowserWindow }, mainWindowId) => {
    const handler = ipcMain._invokeHandlers.get('desktop');
    const contents = BrowserWindow.fromId(mainWindowId).webContents, send = contents.send;
    const mainContentsId = contents.id;
    let release, arrived, releaseTransfer, entered;
    const gate = new Promise(resolve => { release = resolve; });
    const ready = new Promise(resolve => { arrived = resolve; });
    const beforeTransfer = new Promise(resolve => { releaseTransfer = resolve; });
    const entering = new Promise(resolve => { entered = resolve; });
    globalThis.miniReturnGate = {
      handler, contents, send, release, ready, releaseTransfer, entering,
      returning: false, transferred: false, beforeWrites: [], writes: [],
    };
    contents.send = function (channel, ...args) {
      if (channel === 'runtime-event' && args[0]?.type === 'desktop_view_changed'
        && args[0].surface === 'main' && args[0].restorePresentation)
        globalThis.miniReturnGate.transferred = true;
      return send.call(this, channel, ...args);
    };
    ipcMain.removeHandler('desktop');
    ipcMain.handle('desktop', async (event, method, ...args) => {
      const probe = globalThis.miniReturnGate;
      const afterTransfer = probe.transferred;
      if (method === 'miniChatReturn') {
        probe.returning = true;
        entered(); await beforeTransfer;
      }
      if (probe.returning && event.sender.id === mainContentsId) {
        probe.mainEvent = event;
        if (probe.transferred && method === 'snapshot') { arrived(); await gate; }
      }
      const result = await handler(event, method, ...args);
      if (probe.returning && event.sender.id === mainContentsId && method === 'windowPresentation') {
        const writes = afterTransfer ? probe.writes : probe.beforeWrites;
        if (result === true) writes.push(args[1].position);
      }
      return result;
    });
  }, mainWindowId);
  try {
    await mini.getByRole('button', { name: '回到主窗口', exact: true }).click();
    await app.evaluate(() => globalThis.miniReturnGate.entering);
    // A save before the host commits the transfer is valid and must be superseded.
    const oldRevision = await main.evaluate(async () => {
      const value = await window.desktop.snapshot();
      const accepted = await window.desktop.windowPresentation({ sessionId: value.state.sessionId },
        { position: { follow: true, top: 0 }, disclosures: [] }, value.windowPresentationRevision);
      if (!accepted) throw new Error('A pre-transfer save must still be accepted');
      return value.windowPresentationRevision;
    });
    assert.ok(await app.evaluate(() => globalThis.miniReturnGate.beforeWrites
      .some(position => position.follow && position.top === 0)));
    await app.evaluate(() => globalThis.miniReturnGate.releaseTransfer());
    await main.getByRole('region', { name: '远程访问', exact: true }).waitFor({ state: 'detached' });
    await main.locator('main .conversation').waitFor({ state: 'visible' });
    await app.evaluate(() => globalThis.miniReturnGate.ready);
    assert.equal(await main.evaluate(revision => window.desktop.windowPresentation({ sessionId: 'one' },
      { position: { follow: true, top: 0 }, disclosures: [] }, revision), oldRevision), false,
    'The host rejects an old-view save even after the transfer commits but before the renderer installs its snapshot');
    await main.evaluate(async () => {
      document.querySelector('.conversation').dispatchEvent(new Event('scroll', { bubbles: true }));
      window.dispatchEvent(new Event('blur'));
      await window.desktop.miniChatState();
    });
    assert.deepEqual(await app.evaluate(() => globalThis.miniReturnGate.writes), [],
      'The old main view cannot overwrite the transferred reading position while its snapshot is pending');
    const transferred = await app.evaluate(async () => {
      const { handler, mainEvent } = globalThis.miniReturnGate;
      const value = await handler(mainEvent, 'snapshot');
      return { revision: value.windowPresentationRevision, position: value.windowPresentation.position };
    });
    assert.equal(transferred.revision, oldRevision + 1);
    assert.equal(transferred.position.follow, false, 'Rejected saves leave the transferred cache unchanged');
    assert.equal(transferred.position.anchor.index, Number(anchor.index));
  } finally {
    await app.evaluate(({ ipcMain }) => {
      const { handler, contents, send, release, releaseTransfer } = globalThis.miniReturnGate;
      contents.send = send;
      ipcMain.removeHandler('desktop'); ipcMain.handle('desktop', handler);
      releaseTransfer(); release(); delete globalThis.miniReturnGate;
    });
  }
  await main.waitForFunction(anchor => {
    const viewport = document.querySelector('.conversation');
    const article = viewport.querySelector(`article[data-message-index="${anchor.index}"]`);
    return article && Math.abs(article.getBoundingClientRect().top - viewport.getBoundingClientRect().top - anchor.offset) < 4;
  }, anchor);
  const beforeRestart = (await main.evaluate(() => window.desktop.snapshot())).runtimeId;
  const restarted = await main.evaluate(() => window.desktop.restart());
  assert.notEqual(restarted.runtimeId, beforeRestart);
  await mini.waitForFunction(async id => (await window.desktop.snapshot()).runtimeId === id, restarted.runtimeId);
  await mini.waitForFunction(() => document.querySelector('main .composer-input')?.getAttribute('contenteditable') === 'true');
  // Shared first-message drafts promote once, and both views follow that identity.
  await main.evaluate(() => window.desktop.beginSession()).then(() => main.reload());
  await main.waitForFunction(() => document.querySelector('main .composer-input')?.getAttribute('contenteditable') === 'true');
  await main.getByRole('button', { name: 'MiniChat', exact: true }).click();
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => window.getTitle() === 'MiniChat').showInactive());
  await mini.waitForFunction(async () => Boolean((await window.desktop.snapshot()).draftId));
  await mini.evaluate(() => window.desktop.command('set_launch_mode', { mode: 'review', enabled: true }));
  await main.waitForFunction(async () => (await window.desktop.snapshot()).launch.reviewArmed === true);
  await main.evaluate(() => window.desktop.command('set_launch_mode', { mode: 'review', enabled: false }));
  await mini.waitForFunction(async () => (await window.desktop.snapshot()).launch.reviewArmed === false);
  const draftQuestion = '/btw Keep this question until a session exists';
  const beforeInvalidQuestions = requests.length;
  await editor.fill(draftQuestion); await editor.press('Enter');
  await mini.getByRole('alert').getByText('请在已连接的会话中发起旁问，整理上下文时暂不可用。', { exact: true }).waitFor();
  await main.waitForFunction(text => document.querySelector('main .composer-input')?.value === text, draftQuestion);
  assert.equal(await editor.evaluate(element => element.value), draftQuestion);
  assert.equal((await mini.evaluate(() => window.desktop.miniChatState())).open, true);
  assert.equal(requests.length, beforeInvalidQuestions);
  await editor.fill('MINI-FIRST-MESSAGE'); await editor.press('Enter');
  await mini.getByText('Completed MINI-FIRST-MESSAGE.', { exact: true }).waitFor();
  await mini.waitForFunction(async () => !(await window.desktop.snapshot()).state.isStreaming);
  const afterDraft = await Promise.all([main.evaluate(() => window.desktop.snapshot()), mini.evaluate(() => window.desktop.snapshot())]);
  assert.equal(afterDraft[0].runtimeId, afterDraft[1].runtimeId);
  assert.equal(afterDraft[0].draftId, undefined);
  const oversizedQuestion = '/btw ' + 'x'.repeat(8001);
  await editor.fill(oversizedQuestion); await editor.press('Enter');
  await mini.getByRole('alert').getByText('旁问内容不能超过 8000 字符。', { exact: true }).waitFor();
  await main.waitForFunction(text => document.querySelector('main .composer-input')?.value === text, oversizedQuestion);
  assert.equal(await editor.evaluate(element => element.value), oversizedQuestion);
  assert.equal(requests.length, beforeInvalidQuestions + 1, 'Rejected side questions never consume input or invoke the provider');
  await editor.fill('/btw MINI-SIDE-QUESTION'); await editor.press('Enter');
  await main.locator('#btw-panel[aria-hidden="false"]').waitFor();
  await main.locator('#btw-panel .response-text').getByText(/Completed[\s\S]*MINI-SIDE-QUESTION/).waitFor();
  await reopenMini();
  await main.getByRole('button', { name: '关闭旁问', exact: true }).click();
  const fileWorkspace = await realpath(afterDraft[1].runtimes.find(runtime => runtime.runtimeId === afterDraft[1].runtimeId).cwd);
  const fixtureRelative = relative(profile, fileWorkspace);
  assert.ok(fixtureRelative && !fixtureRelative.startsWith('..') && !isAbsolute(fixtureRelative), 'Write only inside this isolated fixture');
  await writeFile(join(fileWorkspace, 'handoff.md'), '# MiniChat file handoff\n\nA real read-only file preview.');
  await editor.fill('MINI-FILE-LINK'); await editor.press('Enter');
  const fileLink = mini.getByRole('link', { name: 'MiniChat local file', exact: true });
  await fileLink.waitFor();
  await mini.waitForFunction(async () => !(await window.desktop.snapshot()).state.isStreaming);
  await editor.fill('Keep this draft during file handoff');
  const beforeFileRequests = requests.length;
  for (let repeat = 0; repeat < 2; repeat++) {
    if (repeat) await reopenMini();
    await fileLink.click();
    await main.locator('#file-panel[aria-hidden="false"] .file-preview-markdown h1').waitFor();
    assert.equal(await main.locator('.file-preview-markdown h1').textContent(), 'MiniChat file handoff');
    await main.waitForFunction(() => document.querySelector('main .composer-input')?.textContent === 'Keep this draft during file handoff');
    assert.equal((await main.evaluate(() => window.desktop.snapshot())).state.sessionId, afterDraft[1].state.sessionId);
    assert.equal(requests.length, beforeFileRequests, 'Repeated file handoff keeps its preview open without sending the draft');
  }
  await main.getByRole('button', { name: '关闭文件预览', exact: true }).click();
  await reopenMini();
  // A real message link transfers the selected conversation and draft to main,
  // then opens its native browser. MiniChat must not gain browser-layout IPC.
  await editor.fill('MINI-WEB-LINK'); await editor.press('Enter');
  const link = mini.getByRole('link', { name: 'MiniChat local page', exact: true });
  await link.waitFor();
  await mini.waitForFunction(async () => !(await window.desktop.snapshot()).state.isStreaming);
  await editor.fill('Keep this draft during web handoff');
  await main.evaluate(() => window.desktop.navigateSession('two'));
  await main.reload();
  const webTerminal = await expandMainTerminal();
  const beforeLinkRequests = requests.length;
  await link.click();
  await main.locator('#browser-panel[aria-hidden="false"]').waitFor();
  await verifyTerminalRestored(webTerminal);
  const linkUrl = `http://127.0.0.1:${server.address().port}/mini-link`;
  const waitForLinkedBrowser = async () => {
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
      const browser = await main.evaluate(() => window.desktop.browserList());
      const loaded = browser.tabs.some(tab => tab.id === browser.activeId && tab.url === linkUrl
        && tab.title === 'MiniChat link handoff' && !tab.loading);
      const visible = await app.evaluate(({ BrowserWindow }, { id, url }) => BrowserWindow.fromId(id).contentView.children
        .some(view => view.getVisible() && view.webContents?.getURL() === url), { id: mainWindowId, url: linkUrl });
      if (loaded && visible) return;
      await main.waitForTimeout(50);
    }
    assert.fail('The linked native browser never finished loading in the visible main panel');
  };
  await waitForLinkedBrowser();
  assert.equal((await main.evaluate(() => window.desktop.snapshot())).state.sessionId, afterDraft[1].state.sessionId);
  await main.waitForFunction(() => document.querySelector('main .composer-input')?.textContent === 'Keep this draft during web handoff');
  assert.equal(requests.length, beforeLinkRequests, 'Opening a link does not submit the preserved draft');
  await assert.rejects(mini.evaluate(() => window.desktop.browserList()), /main window/);
  await main.getByRole('button', { name: 'MiniChat', exact: true }).click();
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => window.getTitle() === 'MiniChat').showInactive());
  await mini.waitForFunction(() => document.querySelector('main .composer-input')?.textContent === 'Keep this draft during web handoff');
  await main.getByRole('button', { name: '远程访问', exact: true }).click();
  await main.getByRole('region', { name: '远程访问', exact: true }).waitFor();
  await link.click();
  await main.getByRole('region', { name: '远程访问', exact: true }).waitFor({ state: 'detached' });
  await main.locator('#browser-panel[aria-hidden="false"]').waitFor();
  await waitForLinkedBrowser();
  assert.equal(requests.length, beforeLinkRequests, 'Reopening the same link neither hides its panel nor submits input');
  await main.getByRole('button', { name: 'MiniChat', exact: true }).click();
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => window.getTitle() === 'MiniChat').showInactive());
  // Provider edits must refresh a draft held only by MiniChat, not change main's session.
  const mainSessionBeforeProvider = (await main.evaluate(() => window.desktop.snapshot())).state.sessionId;
  await mini.evaluate(path => window.desktop.beginSession(path), workspace);
  await mini.reload();
  await editor.waitFor();
  await main.evaluate(address => window.desktop.saveProvider({
    id: '', name: 'Mini provider refresh', baseUrl: address, api: 'openai-completions', enabled: true, keyless: true,
    models: [{ id: 'mini-deleted-model', name: 'Temporary Mini model', reasoning: false, vision: false,
      contextWindow: 65536, maxTokens: 2048 }],
  }), `http://127.0.0.1:${server.address().port}/v1`);
  const providerId = await main.evaluate(async () => (await window.desktop.settings()).providers.find(provider => provider.name === 'Mini provider refresh').id);
  await mini.waitForFunction(id => window.desktop.snapshot().then(value => value.models.some(model => model.provider === id)), providerId);
  await mini.evaluate(provider => window.desktop.command('set_model', { provider, modelId: 'mini-deleted-model' }), providerId);
  await mini.evaluate(() => window.desktop.command('set_launch_mode', { mode: 'review', enabled: true }));
  await editor.fill('Keep provider-refresh draft');
  const providerDraft = (await mini.evaluate(() => window.desktop.snapshot())).draftId;
  const beforeProviderRequests = requests.length;
  await assert.rejects(main.evaluate(path => window.desktop.relocateWorkspace(path), workspace), /小窗会话返回主窗口/);
  assert.equal((await mini.evaluate(() => window.desktop.snapshot())).draftId, providerDraft);
  assert.equal((await mini.evaluate(() => window.desktop.snapshot())).preferences.workspace, workspace);
  assert.equal(await editor.textContent(), 'Keep provider-refresh draft');
  assert.equal((await mini.evaluate(() => window.desktop.snapshot())).launch.reviewArmed, true);
  assert.equal((await main.evaluate(() => window.desktop.snapshot())).state.sessionId, mainSessionBeforeProvider);
  assert.equal(requests.length, beforeProviderRequests, 'Rejected project relocation never starts a runtime or submits input');
  await main.evaluate(id => window.desktop.deleteProvider(id), providerId);
  await mini.waitForFunction(({ id, draftId }) => window.desktop.snapshot().then(value =>
    value.draftId === draftId && value.models.every(model => model.provider !== id)
      && value.models.some(model => model.provider === 'fixture')),
  { id: providerId, draftId: providerDraft });
  assert.equal(await editor.textContent(), 'Keep provider-refresh draft');
  assert.equal((await mini.evaluate(() => window.desktop.snapshot())).launch.reviewArmed, true);
  assert.equal((await main.evaluate(() => window.desktop.snapshot())).state.sessionId, mainSessionBeforeProvider);
  assert.equal(requests.length, beforeProviderRequests);
  await mini.locator('.model-effort-trigger').click();
  await mini.getByRole('button', { name: '选择模型', exact: true }).click();
  await mini.locator('.model-picker-select').filter({ hasText: 'Mini fixture' }).click();
  await mini.waitForFunction(() => window.desktop.snapshot().then(value => value.state?.model?.provider === 'fixture'));
  await editor.press('Escape');
  await mini.evaluate(() => window.desktop.command('set_launch_mode', { mode: 'review', enabled: false }));
  // Match the editing verifier: native fill() selection can race ProseMirror.
  await editor.press('ControlOrMeta+a');
  await editor.press('Backspace');
  await mini.waitForFunction(() => {
    const input = document.querySelector('main .composer-input');
    return input?.value === '' && input.dataset.empty === 'true';
  });
  const providerPrompt = 'MINI-PROVIDER-REFRESH';
  await editor.pressSequentially(providerPrompt);
  await mini.waitForFunction(async ({ draftId, text }) => {
    const input = document.querySelector('main .composer-input');
    return input?.value === text && input.textContent === text && input.dataset.empty === 'false'
      && (await window.desktop.composerRead({ draftId })).value.text === text;
  }, { draftId: providerDraft, text: providerPrompt });
  await editor.press('Enter');
  await mini.getByText('Completed MINI-PROVIDER-REFRESH.', { exact: true }).waitFor();
  await mini.waitForFunction(async () => !(await window.desktop.snapshot()).state.isStreaming);
  assert.equal(requests.length, beforeProviderRequests + 1, 'The refreshed draft submits exactly one request');
  assert.equal(textOf(requests.at(-1).messages.findLast(message => message.role === 'user')?.content), providerPrompt,
    'The submitted prompt contains no previous draft text');
  await main.evaluate(() => window.desktop.preferences({ theme: 'light', language: 'en' }));
  await mini.getByRole('button', { name: 'Switch MiniChat conversation', exact: true }).waitFor();
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => window.getTitle() === 'MiniChat').setSize(380, 400));
  await editor.fill('A long draft\n'.repeat(35));
  await editor.focus(); await settleLayout(mini.locator('main .composer'));
  assert.equal(await mini.evaluate(() => {
    const input = document.querySelector('main .composer-input').getBoundingClientRect();
    const send = document.querySelector('main .composer-action-button').getBoundingClientRect();
    return input.top >= 56 && send.bottom <= innerHeight && send.right <= innerWidth;
  }), true, 'Low-height MiniChat keeps the editor and send controls reachable');
  assert.equal(await mini.locator('main .composer').evaluate(element => {
    const rect = element.getBoundingClientRect();
    for (let parent = element.parentElement; parent; parent = parent.parentElement) {
      const style = getComputedStyle(parent), bounds = parent.getBoundingClientRect();
      if (/(hidden|clip|auto|scroll)/.test(style.overflowX) && (rect.left - 4 < bounds.left || rect.right + 4 > bounds.right)) return false;
      if (/(hidden|clip|auto|scroll)/.test(style.overflowY) && (rect.top - 4 < bounds.top || rect.bottom + 4 > bounds.bottom)) return false;
    }
    return true;
  }), true, 'The complete composer focus outline stays inside clipping ancestors');
  await mini.screenshot({ path: join(output, 'native-light-narrow.png') });
  await main.evaluate(() => window.desktop.preferences({ theme: 'plugin:stellar-cruise', themeMotion: false }));
  await mini.waitForFunction(() => document.documentElement.dataset.palette === 'plugin:stellar-cruise');
  assert.equal((await mini.evaluate(() => window.desktop.themeScene('plugin:stellar-cruise'))).dragons.groups.length, 2);
  assert.match(await mini.evaluate(() => window.desktop.themePoster('plugin:stellar-cruise')), /^data:image\/png;base64,/);
  await mini.waitForFunction(() => document.querySelector('.stellar-workspace-scene canvas')?.dataset.ready === 'true'
    || document.querySelector('.stellar-workspace-scene .theme-stellar-poster')?.naturalWidth > 0);
  await assert.rejects(mini.evaluate(() => window.desktop.themeScene('../../uninstalled')), /Theme unavailable/);
  await assert.rejects(mini.evaluate(() => window.desktop.capabilityMutate({ action: 'plugin-remove', id: 'stellar-cruise' })), /main window/);
  await mini.screenshot({ path: join(output, 'native-stellar-narrow.png') });
  assert.deepEqual(errors, []);
  await writeFile(join(output, 'result.json'), JSON.stringify({ profile, requests: requests.length, errors, verified: true }, null, 2));
  console.log('PASS native MiniChat: grouped cross-project search, same-name path disambiguation, project/independent draft IPC and main-preference isolation, coalesced runtime, independent navigation, shared input/quotes/options, abandoned-send recovery, one send/sound, streaming/stop, real approval, hide/reload/return/restart, selected-workflow handoff/reopen versus bare catalog, repeated subagent/file handoff, web-link handoff/reopen with preserved draft and native browser, fullscreen bottom-terminal collapse with live PTY on workflow/todos/web handoff, draft/oversize side-question rejection preserves input and valid handoff, provider refresh retains independent draft/options and first send succeeds, deletion guard, draft promotion, pin, narrow light/en/focus, read-only Stellar scene/poster with decoded background and blocked plugin mutation.');
} catch (error) {
  console.error('Native MiniChat failure:', error);
  console.error('Native windows at failure', await app?.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map(window => ({
    title: window.getTitle(), url: window.webContents.getURL(),
  }))).catch(() => []));
  for (const [index, page] of (app?.windows() ?? []).entries()) {
    console.error(`window ${index} reading geometry`, await page.evaluate(async () => {
      const viewport = document.querySelector('.conversation');
      return {
        position: (await window.desktop.snapshot()).windowPresentation?.position,
        hidden: viewport?.closest('main')?.hidden, top: viewport?.scrollTop,
        height: viewport?.clientHeight, scrollHeight: viewport?.scrollHeight,
        articles: viewport ? [...viewport.querySelectorAll('.messages > article[data-message-index]')].slice(0, 4)
          .map(article => ({ index: article.dataset.messageIndex,
            offset: article.getBoundingClientRect().top - viewport.getBoundingClientRect().top })) : [],
      };
    }).catch(() => undefined));
    await page.screenshot({ path: join(output, `failure-${index}.png`) }).catch(() => {});
    console.error(`window ${index}`, await page.locator('body').innerText().catch(() => ''), errors);
  }
  console.error('Isolated profile:', profile);
  console.error('Fixture model request count:', requests.length);
  console.error('Mini runtime at failure:', await mini?.evaluate(async () => {
    const snapshot = await window.desktop.snapshot();
    return { runtimeId: snapshot.runtimeId, state: snapshot.state,
      lastMessages: snapshot.messages.slice(-3), requests: snapshot.requests.map(request => ({ id: request.id, method: request.method })) };
  }).catch(() => undefined));
  throw error;
} finally {
  for (const response of held.values()) response.destroy();
  if (app) await closeDesktopFixtureAndWait(app);
  server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
}
