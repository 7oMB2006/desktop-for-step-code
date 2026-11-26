import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron as electron } from 'playwright';
import { mkdtemp } from './test-profile.mjs';
import { settleLayout } from './settle-layout.mjs';
import { assertFocusVisible } from './assert-focus-visible.mjs';

const executablePath = process.env.DESKTOP_VERIFY_EXE;
const renderer = process.env.DESKTOP_PERF_RENDERER;
const output = resolve(process.env.DESKTOP_PERF_OUTPUT ?? 'test-results/context-virtualization');
const profile = await mkdtemp(join(tmpdir(), 'step-context-virtualization-'));
await mkdir(output, { recursive: true });
await writeFile(join(profile, 'preferences.json'), JSON.stringify({
  language: 'en', theme: 'dark', workspaces: [], autoCheckUpdates: false,
}));
const env = { ...process.env, DESKTOP_TEST_USER_DATA: profile, DESKTOP_TEST_NO_FOCUS: '1' };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({
  ...(executablePath ? { executablePath } : {}),
  args: [...(executablePath ? [] : [resolve('.')]), '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding', '--disable-features=CalculateNativeWinOcclusion'],
  env, timeout: 60000,
});

function fixtureMessages() {
  const messages = [];
  const now = Date.now() - 1112 * 1000;
  const add = value => messages.push({ ...value, entryId: `virtualization-${messages.length}`,
    timestamp: now + messages.length * 1000 });
  let assistants = 0, tools = 0;
  for (let turn = 0; turn < 39; turn++) {
    add({ role: 'user', content: `Virtualization request ${turn + 1}.` });
    const count = Math.floor(484 / 39) + (turn < 484 % 39 ? 1 : 0);
    for (let step = 0; step < count; step++) {
      const calls = tools < 204 ? 2 : 1;
      const content = [];
      if (step === count - 1) content.push({ type: 'text', text: `## Response ${turn + 1}\n\nVirtualization fixture.` });
      for (let call = 0; call < calls && tools + call < 586; call++) content.push({
        type: 'toolCall', id: `virtualization-call-${tools + call}`, name: 'run_command',
        arguments: { command: 'node --test fixture.test.mjs', api_key: 'virtualization-fixture-secret' },
      });
      add({ role: 'assistant', provider: 'step', model: 'step-5-preview', content, stopReason: 'toolUse' });
      assistants++;
      for (let call = 0; call < calls && tools < 586; call++) {
        const tool = tools++;
        add({ role: 'toolResult', toolCallId: `virtualization-call-${tool}`, toolName: 'run_command',
          content: [{ type: 'text', text: `Virtualization output ${tool}.` }] });
      }
    }
  }
  for (let index = 0; index < 3; index++) add({ role: 'compactionSummary', content: `Summary ${index}.` });
  assert.equal(assistants, 484);
  assert.equal(tools, 586);
  assert.equal(messages.length, 1112);
  return messages;
}

const baseMessages = fixtureMessages();
const checks = [];
const errors = [];
let page;
try {
  page = await app.firstWindow();
  page.setDefaultTimeout(20000);
  page.on('pageerror', error => errors.push(error.message));
  await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    window.setOpacity(0);
    window.setIgnoreMouseEvents(true);
    window.setMinimumSize(320, 480);
    window.setSize(1920, 1032);
    window.showInactive();
  });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.waitForFunction(() => Boolean(window.desktop), undefined, { timeout: 60000 });
  const original = await page.evaluate(() => window.desktop.snapshot());
  const fixture = {
    ...original, draftId: undefined, runtimeId: 'virtualization-runtime', status: 'connected',
    firstRun: { required: false }, themePacks: [], customBackground: undefined,
    preferences: { ...original.preferences, language: 'en', theme: 'dark', workspaces: ['D:/fixture'],
      workspace: 'D:/fixture', autoCheckUpdates: false },
    state: { sessionId: 'virtualization-session', sessionName: 'Context virtualization acceptance', isStreaming: false,
      model: { id: 'step-5-preview', name: 'step-5-preview', provider: 'step', contextWindow: 1024000 } },
    sessions: [{ id: 'virtualization-session', name: 'Context virtualization acceptance', path: 'D:/fixture/session.jsonl',
      cwd: 'D:/fixture', firstMessage: 'Isolated virtualization fixture', modified: new Date().toISOString(), messageCount: 1112 }],
    messages: baseMessages, requests: [], pendingMessages: [],
    stats: { toolCalls: 586, assistantMessages: 484, userMessages: 39, toolResults: 586, totalMessages: 1112,
      tokens: { input: 2180, output: 1157, cacheRead: 800768, cacheWrite: 0, total: 226645693 },
      contextUsage: { tokens: 803405, contextWindow: 1024000, percent: 78.5 } },
  };
  // All fixture updates use the real preload IPC and snapshot installation path.
  await app.evaluate(({ ipcMain }, fixture) => {
    globalThis.virtualizationFixture = fixture;
    globalThis.virtualizationCopies = [];
    globalThis.virtualizationCalls = [];
    ipcMain.removeHandler('desktop');
    ipcMain.handle('desktop', (_event, method, ...args) => {
      globalThis.virtualizationCalls.push(method);
      if (method === 'snapshot') return globalThis.virtualizationFixture;
      if (method === 'contextMessages') {
        const current = globalThis.virtualizationFixture;
        if (args[0] !== current.runtimeId || args[1] !== current.state.sessionId) throw new Error('Unexpected context owner');
        return current.messages;
      }
      if (method === 'preferences') {
        Object.assign(globalThis.virtualizationFixture.preferences, args[0]);
        return globalThis.virtualizationFixture.preferences;
      }
      if (method === 'copyText') { globalThis.virtualizationCopies.push(args[0]); return; }
      if (method === 'clm') return {
        sessionId: 'virtualization-session', enabled: false, revision: 0, total: 0, revisions: [],
      };
      if (method === 'summary') return { sessionId: 'virtualization-session', tasks: [], mcp: [], skillCount: 0 };
      if (method === 'command' && args[0] === 'get_available_thinking_levels') return { levels: ['off', 'high'] };
      if (method === 'command' && args[0] === 'get_commands') return { commands: [] };
      if (method === 'settings') return { account: { loggedIn: false, validity: 'unknown' }, profiles: [], mcp: {}, skills: [] };
      return {};
    });
  }, fixture);
  if (renderer) await app.evaluate(({ BrowserWindow }, path) =>
    BrowserWindow.getAllWindows()[0].loadFile(path), resolve(renderer));
  else await page.reload();
  await page.locator('.composer > .composer-input').waitFor();
  await page.locator('.messages > article').last().waitFor();
  const panel = page.locator('#context-panel');
  await page.locator('.right-tool-rail').getByRole('button', { name: 'Context', exact: true }).click();
  await panel.waitFor();
  await settleLayout(panel);
  assert.equal(await panel.locator('.context-message-virtualization').count(), 0, 'Continuous scrolling has no page controls');
  const frame = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(resolve)))));
  const mainScroll = await page.locator('.messages').evaluate(element => element.scrollTop);
  const expectedNumbers = (messages, filter = 'all') => messages.map((message, index) => ({ message, number: index + 1 }))
    .filter(({ message }) => filter === 'all' || message.role === filter).reverse().map(row => row.number);
  let maxMounted = 0;
  const bounded = async () => {
    const count = await panel.locator('.context-message').count();
    maxMounted = Math.max(maxMounted, count);
    assert.ok(count <= 50, `Visible rows, overscan and held controls stay bounded, found ${count}`);
    return count;
  };
  const rowFor = key => panel.locator(`[data-context-key="${key}"]`);
  async function scrollTo(fraction) {
    await panel.locator('.context-panel-scroll').evaluate((viewport, fraction) => {
      const list = viewport.querySelector('#context-message-list');
      const top = list.getBoundingClientRect().top - viewport.getBoundingClientRect().top + viewport.scrollTop;
      viewport.scrollTop = top + list.getBoundingClientRect().height * fraction;
    }, fraction);
    await frame();
    await bounded();
  }
  const visibleRows = () => panel.locator('.context-panel-scroll').evaluate(viewport => {
    const bounds = viewport.getBoundingClientRect();
    return [...viewport.querySelectorAll('[data-context-key]')].map(row => {
      const rect = row.getBoundingClientRect();
      return { key: row.dataset.contextKey, number: Number(row.querySelector('.context-message-number').textContent),
        top: rect.top - bounds.top, bottom: rect.bottom - bounds.top };
    }).filter(row => row.bottom > 0 && row.top < bounds.height);
  });
  const focusedNumber = () => page.evaluate(() => {
    const row = document.activeElement?.closest('[data-context-key]');
    return row ? Number(row.querySelector('.context-message-number').textContent) : null;
  });
  async function focusIsVisible() {
    assert.equal(await panel.locator('.context-panel-scroll').evaluate(viewport => {
      const bounds = viewport.getBoundingClientRect();
      const rect = document.activeElement.getBoundingClientRect();
      return rect.top >= bounds.top - 1 && rect.bottom <= bounds.bottom + 1;
    }), true, 'Focused control is visible inside the inspector');
  }
  const waitNewest = async number => {
    await page.waitForFunction(number =>
      Number(document.querySelector('#context-message-list .context-message-number')?.textContent) === number, number);
    await frame();
  };
  async function filter(value) {
    await panel.locator(`#context-tab-${value}`).click();
    await page.waitForFunction(value => document.getElementById(`context-tab-${value}`)?.getAttribute('aria-selected') === 'true', value);
    await frame();
  }
  async function traverse(filterValue, expectedCount) {
    await filter(filterValue);
    const expected = expectedNumbers(baseMessages, filterValue);
    assert.equal(expected.length, expectedCount);
    await scrollTo(0);
    const seen = new Set();
    let steps = 0;
    while (true) {
      await bounded();
      const mounted = await panel.locator('.context-message-number').evaluateAll(elements => elements.map(element => Number(element.textContent)));
      assert.deepEqual(mounted, [...mounted].sort((a, b) => b - a), 'DOM order stays newest first');
      const positions = await panel.getByRole('listitem').evaluateAll(elements => elements.map(element => ({
        position: Number(element.getAttribute('aria-posinset')), size: Number(element.getAttribute('aria-setsize')),
      })));
      assert.ok(positions.every(item => item.size === expectedCount && item.position > 0 && item.position <= expectedCount),
        'Assistive technology receives logical positions and total size, not just the mounted row count');
      for (const number of mounted) seen.add(number);
      assert.ok((await visibleRows()).length > 0, 'The scroll viewport never becomes blank');
      assert.equal(await panel.locator('.context-json').count(), 0, 'Unopened rows must not render JSON');
      const moved = await panel.locator('.context-panel-scroll').evaluate(viewport => {
        const before = viewport.scrollTop;
        viewport.scrollTop += viewport.clientHeight * .65;
        return viewport.scrollTop > before;
      });
      if (!moved) break;
      await frame();
      assert.ok(++steps < 1000, 'Scrolling converges to the end');
    }
    assert.deepEqual([...seen].sort((a, b) => b - a), expected, `${filterValue}: every message is reachable without gaps`);
    assert.equal((await visibleRows()).at(-1).number, expected.at(-1), 'The oldest row is reachable');
    await scrollTo(0);
    assert.equal((await visibleRows())[0].number, expected[0], 'The newest row is reachable again');
    checks.push({ check: 'continuous-full-scroll', filter: filterValue, steps, messages: expectedCount });
  }
  for (const [role, count] of [['all', 1112], ['user', 39], ['assistant', 484], ['toolResult', 586]]) {
    assert.equal(await panel.locator(`#context-tab-${role} small`).innerText(), String(count));
  }
  await traverse('all', 1112);
  await traverse('user', 39);
  await traverse('assistant', 484);
  await traverse('toolResult', 586);

  await filter('all');
  await panel.locator('#context-tab-all').focus();
  await page.keyboard.press('ArrowRight');
  await frame();
  assert.equal(await panel.locator('#context-tab-user').evaluate(element => element === document.activeElement), true);
  await page.keyboard.press('End');
  await frame();
  assert.equal(await panel.locator('#context-tab-toolResult').evaluate(element => element === document.activeElement), true);
  await page.keyboard.press('Home');
  await frame();
  assert.equal(await panel.locator('#context-tab-all').evaluate(element => element === document.activeElement), true);
  checks.push({ check: 'keyboard-role-tabs' });

  await filter('user');
  await panel.locator('#context-tab-user').focus();
  await page.keyboard.press('Tab');
  const userNumbers = expectedNumbers(baseMessages, 'user');
  for (let index = 0; index < userNumbers.length; index++) {
    await frame();
    assert.equal(await focusedNumber(), userNumbers[index], 'Tab reaches even rows that were not mounted');
    await focusIsVisible();
    await bounded();
    if (index < userNumbers.length - 1) await page.keyboard.press('Tab');
  }
  for (let index = userNumbers.length - 2; index >= 0; index--) {
    await page.keyboard.press('Shift+Tab');
    await frame();
    assert.equal(await focusedNumber(), userNumbers[index], 'Shift+Tab follows the complete logical list');
    await focusIsVisible();
  }
  await page.keyboard.press('Shift+Tab');
  assert.equal(await panel.locator('#context-tab-user').evaluate(element => element === document.activeElement), true,
    'Shift+Tab leaves the first logical row without trapping focus');
  checks.push({ check: 'keyboard-entire-virtual-list', messages: userNumbers.length });

  await filter('assistant');
  const jsonRow = panel.locator('.context-message').first();
  await jsonRow.locator('summary').click();
  await jsonRow.locator('.context-json pre').waitFor();
  const json = await jsonRow.locator('.context-json pre').innerText();
  assert.equal(JSON.parse(json).role, 'assistant');
  assert.ok(!json.includes('virtualization-fixture-secret'), 'Inspector JSON must redact credential-like keys');
  assert.ok(json.includes('[omitted]'));
  await jsonRow.getByRole('button', { name: 'Copy message JSON', exact: true }).click();
  await jsonRow.locator('.context-json-tools .lucide-check').waitFor();
  assert.equal(await app.evaluate(() => globalThis.virtualizationCopies.at(-1)), json, 'Copy uses the displayed safe JSON via isolated IPC');
  await jsonRow.locator('summary').focus();
  await page.keyboard.press('Tab');
  assert.equal(await jsonRow.locator('.context-json-tools button').evaluate(element => element === document.activeElement), true);
  await page.keyboard.press('Tab');
  const jsonBody = jsonRow.locator('.context-json pre');
  assert.equal(await jsonBody.evaluate(element => element === document.activeElement), true,
    'Tab from Copy reaches the JSON scroll container instead of skipping to another message');
  await assertFocusVisible(page, jsonBody, 'JSON body', { focus: false });
  assert.ok(await jsonBody.evaluate(element => element.scrollHeight > element.clientHeight),
    'The keyboard fixture includes overflowing JSON');
  const outerBefore = await panel.locator('.context-panel-scroll').evaluate(element => element.scrollTop);
  await page.keyboard.press('PageDown');
  await page.waitForFunction(() => document.querySelector('.context-json pre')?.scrollTop > 0);
  assert.equal(await panel.locator('.context-panel-scroll').evaluate(element => element.scrollTop), outerBefore,
    'PageDown scrolls the focused JSON body, not the inspector');
  await page.keyboard.press('Shift+Tab');
  assert.equal(await jsonRow.locator('.context-json-tools button').evaluate(element => element === document.activeElement), true,
    'Reverse navigation within the row reaches Copy');
  await page.keyboard.press('Tab');
  assert.equal(await jsonBody.evaluate(element => element === document.activeElement), true);
  await page.keyboard.press('Tab');
  await frame();
  assert.equal(await focusedNumber(), expectedNumbers(baseMessages, 'assistant')[1]);
  await scrollTo(.8);
  await page.keyboard.press('Shift+Tab');
  await frame();
  assert.equal(await jsonBody.evaluate(element => element === document.activeElement), true,
    'Reverse navigation from another virtual row returns to the last control, not Copy');
  await focusIsVisible();
  await assertFocusVisible(page, jsonBody, 'Restored JSON body', { focus: false });
  await page.keyboard.press('Shift+Tab');
  assert.equal(await jsonRow.locator('.context-json-tools button').evaluate(element => element === document.activeElement), true);
  await page.keyboard.press('Shift+Tab');
  assert.equal(await jsonRow.locator('summary').evaluate(element => element === document.activeElement), true);
  await jsonRow.locator('summary').click();
  await jsonRow.locator('.context-json').waitFor({ state: 'detached' });
  checks.push({ check: 'json-expand-copy-redaction-and-keyboard' });
  checks.push({ check: 'json-keyboard-scroll-and-virtual-row-boundaries' });

  async function updateMessages(messages, mode = 'button') {
    const countBefore = await app.evaluate(() => globalThis.virtualizationCalls.filter(method => method === 'snapshot').length);
    const revision = await app.evaluate((_electron, messages) => {
      const fixture = globalThis.virtualizationFixture;
      globalThis.virtualizationRevision = (globalThis.virtualizationRevision ?? 0) + 1;
      fixture.state.model.name = `step-5-preview (r${globalThis.virtualizationRevision})`;
      fixture.messages = messages;
      fixture.sessions[0].messageCount = messages.length;
      fixture.stats.totalMessages = messages.length;
      fixture.stats.userMessages = messages.filter(message => message.role === 'user').length;
      fixture.stats.assistantMessages = messages.filter(message => message.role === 'assistant').length;
      fixture.stats.toolResults = messages.filter(message => message.role === 'toolResult').length;
      return fixture.state.model.name;
    }, messages);
    if (mode === 'event') {
      // main.tsx handles this event with refresh() -> bridge.snapshot() -> installSnapshot().
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('runtime-event', {
        type: 'desktop_sessions_changed',
      }));
    } else await panel.getByRole('button', { name: 'Refresh context', exact: true }).click();
    await page.waitForFunction(count => document.getElementById('context-tab-all')?.querySelector('small')?.textContent === String(count),
      messages.length);
    await page.waitForFunction(name => document.querySelector('.context-identity > span')?.textContent === name, revision);
    await page.waitForFunction(() => !document.querySelector('[aria-label="Refresh context"]')?.disabled);
    const countAfter = await app.evaluate(() => globalThis.virtualizationCalls.filter(method => method === 'snapshot').length);
    assert.ok(countAfter > countBefore, 'Updates must actually request and install an IPC snapshot');
    await bounded();
  }
  const appended = (messages, count, label) => [...messages, ...Array.from({ length: count }, (_, index) => ({
    role: 'assistant', content: [{ type: 'text', text: `${label} ${index + 1}.` }],
    entryId: `${label}-${index}`, timestamp: Date.now() + index,
  }))];
  await filter('all');
  await scrollTo(.45);
  const anchor = (await visibleRows())[0];
  const anchorNode = await rowFor(anchor.key).elementHandle();
  const grown = appended(baseMessages, 85, 'append-anchor');
  await updateMessages(grown, 'event');
  await frame();
  const afterAnchor = (await visibleRows()).find(row => row.key === anchor.key);
  assert.ok(afterAnchor && Math.abs(afterAnchor.top - anchor.top) <= 2, `Reading anchor must not jump: ${JSON.stringify({ anchor, afterAnchor })}`);
  assert.equal(await anchorNode.evaluate(element => element.isConnected), true, 'Appending does not replace the anchor DOM node');
  checks.push({ check: 'append-85-retains-pixel-anchor', before: anchor, after: afterAnchor });
  const sameCount = grown.slice(85);
  await updateMessages(sameCount, 'event');
  await frame();
  const sameCountAnchor = (await visibleRows()).find(row => row.key === anchor.key);
  assert.ok(sameCountAnchor && Math.abs(sameCountAnchor.top - anchor.top) <= 2,
    `Trim plus prepend retains the reading anchor: ${JSON.stringify(sameCountAnchor)}`);
  const rolled = appended(sameCount.slice(1), 1, 'same-count-roll');
  await updateMessages(rolled, 'event');
  await frame();
  const rolledAnchor = (await visibleRows()).find(row => row.key === anchor.key);
  assert.ok(rolledAnchor && Math.abs(rolledAnchor.top - anchor.top) <= 2,
    'A same-length snapshot with new edge keys also preserves the anchor');
  checks.push({ check: 'trim-and-same-count-edge-change-anchor', before: anchor, after: rolledAnchor });

  for (const fraction of [0, .4, .85]) {
    await updateMessages(baseMessages, 'event');
    await scrollTo(fraction);
    const item = (await visibleRows()).find(row => row.top >= 0);
    const row = rowFor(item.key);
    await row.locator('summary').click();
    const copy = row.getByRole('button', { name: 'Copy message JSON', exact: true });
    await copy.waitFor();
    await frame();
    const overlap = await row.evaluate(element => {
      const rect = element.getBoundingClientRect();
      const next = element.nextElementSibling?.getBoundingClientRect();
      return next ? rect.bottom - next.top : 0;
    });
    assert.ok(overlap <= 1, 'Expanding JSON measures its real height without overlapping the next row');
    await copy.focus();
    const before = await row.locator('.context-json pre').innerText();
    await updateMessages(appended(baseMessages, 1, `focused-append-${fraction}`), 'event');
    await frame();
    assert.equal(await row.count(), 1, 'Expanded row stays mounted');
    assert.equal(await row.locator('.context-json pre').innerText(), before);
    assert.equal(await copy.evaluate(element => element === document.activeElement), true,
      'Appending preserves the focused JSON copy control');
    await copy.press('Enter');
    await row.locator('.context-json-tools .lucide-check').waitFor();
    assert.equal(await app.evaluate(() => globalThis.virtualizationCopies.at(-1)), before);
    await scrollTo(.99);
    assert.equal(await copy.evaluate(element => element === document.activeElement), true, 'Scrolling away keeps the focused row alive');
    await row.locator('summary').click();
    await row.locator('.context-json').waitFor({ state: 'detached' });
    checks.push({ check: 'dynamic-height-and-json-focus-retention', fraction, number: item.number });
  }

  await updateMessages(baseMessages, 'event');
  const tallMessages = baseMessages.map((message, index) => index === baseMessages.length - 1
    ? { ...message, content: 'Dynamic JSON height. '.repeat(3000) } : message);
  await scrollTo(0);
  const newest = rowFor(baseMessages.at(-1).entryId);
  await newest.locator('summary').click();
  await newest.locator('.context-json').waitFor();
  await frame();
  const shortHeight = await newest.evaluate(element => element.getBoundingClientRect().height);
  const shortBody = newest.locator('.context-json pre');
  assert.equal(await shortBody.evaluate(element => element.scrollHeight > element.clientHeight), false,
    'The short JSON fixture does not require scrolling');
  await newest.locator('summary').focus();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  assert.equal(await shortBody.evaluate(element => element === document.activeElement), true,
    'Short JSON also has a predictable keyboard stop');
  await updateMessages(tallMessages, 'event');
  await frame();
  const tallHeight = await newest.evaluate(element => element.getBoundingClientRect().height);
  assert.ok(tallHeight > shortHeight + 100, 'An expanded streamed payload is remeasured');
  assert.equal(await shortBody.evaluate(element => element === document.activeElement), true,
    'A streamed JSON update preserves its body focus');
  await newest.locator('summary').click();
  await newest.locator('.context-json').waitFor({ state: 'detached' });
  await frame();
  const collapsedHeight = await newest.evaluate(element => element.getBoundingClientRect().height);
  assert.ok(collapsedHeight < tallHeight - 100, 'Collapsing the payload releases its measured height');
  await updateMessages(baseMessages, 'event');
  checks.push({ check: 'expanded-live-payload-height-change', shortHeight, tallHeight, collapsedHeight });

  await scrollTo(.3);
  const selected = (await visibleRows()).find(row => row.top >= 0);
  await rowFor(selected.key).locator('.context-message-preview').evaluate(element => {
    const range = document.createRange();
    range.selectNodeContents(element);
    const selection = document.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  });
  await frame();
  const selectionBefore = await page.evaluate(() => document.getSelection().toString());
  await scrollTo(.9);
  assert.ok(selectionBefore.length > 0);
  assert.equal(await page.evaluate(() => document.getSelection().toString()), selectionBefore);
  assert.equal(await rowFor(selected.key).count(), 1, 'Selection endpoint stays mounted');
  await page.evaluate(() => document.getSelection().removeAllRanges());
  await frame();
  checks.push({ check: 'selection-survives-virtual-scroll' });

  await scrollTo(.5);
  const removed = (await visibleRows()).find(row => row.top >= 0);
  await rowFor(removed.key).locator('summary').focus();
  await updateMessages(baseMessages.slice(0, 31), 'event');
  await frame();
  assert.equal(await panel.locator('#context-tab-all').evaluate(element => element === document.activeElement), true,
    'Removing the focused record restores focus to its role tab');
  await scrollTo(1);
  assert.equal((await visibleRows()).at(-1).number, 1);
  await updateMessages([], 'event');
  await panel.getByText('No messages', { exact: true }).waitFor();
  assert.equal(await bounded(), 0);
  checks.push({ check: 'snapshot-shrink-focus-clamp-and-empty' });

  await updateMessages(baseMessages, 'event');
  await filter('all');
  await panel.locator('.context-panel-scroll').evaluate(viewport => { viewport.scrollTop = 0; });
  await frame();
  await updateMessages(appended(baseMessages, 1, 'at-top'), 'event');
  await frame();
  assert.equal(await panel.locator('.context-panel-scroll').evaluate(viewport => viewport.scrollTop), 0, 'New messages do not move the statistics viewport');
  await scrollTo(0);
  await waitNewest(1113);
  checks.push({ check: 'newest-updates-at-top-without-scroll-jump' });

  await panel.getByRole('button', { name: 'Expand view', exact: true }).click();
  await settleLayout(panel);
  await scrollTo(.5);
  assert.ok((await visibleRows()).length > 0);
  await panel.getByRole('button', { name: 'Restore sidebar', exact: true }).click();
  await settleLayout(panel);
  await bounded();
  checks.push({ check: 'fullscreen-and-restore-measurement' });

  await panel.getByRole('button', { name: 'Expand view', exact: true }).click();
  await settleLayout(panel);
  const clmReads = () => app.evaluate(() => globalThis.virtualizationCalls.filter(method => method === 'clm').length);
  assert.equal(await clmReads(), 0, 'A hidden CLM view does not read while the context list is active');
  await panel.locator('#inspector-tab-status').click();
  await panel.locator('.session-status-content').waitFor();
  assert.equal(await panel.locator('.context-message-row').count(), 0);
  assert.equal(await panel.locator('.context-panel-scroll').evaluate(element => getComputedStyle(element).overflowAnchor), 'auto',
    'Status keeps native scroll anchoring');
  await panel.locator('#inspector-tab-clm').click();
  await panel.getByText('CLM disabled', { exact: true }).waitFor();
  assert.equal(await panel.locator('.context-message-row').count(), 0);
  assert.equal(await panel.locator('.context-panel-scroll').evaluate(element => getComputedStyle(element).overflowAnchor), 'auto',
    'CLM keeps native scroll anchoring');
  const readsWhileVisible = await clmReads();
  assert.ok(readsWhileVisible > 0, 'The visible CLM view performs its own read');
  await panel.locator('#inspector-tab-context').click();
  await panel.locator('.context-message-row').first().waitFor();
  await updateMessages(baseMessages, 'event');
  await frame();
  assert.equal(await clmReads(), readsWhileVisible, 'Refreshing context does not read the hidden CLM view');
  assert.equal(await panel.locator('.context-panel-scroll').evaluate(element => getComputedStyle(element).overflowAnchor), 'none',
    'Only the virtual context list owns its scroll anchor');
  await panel.getByRole('button', { name: 'Restore sidebar', exact: true }).click();
  await settleLayout(panel);
  await scrollTo(.5);
  assert.ok((await visibleRows()).length > 0);
  checks.push({ check: 'inspector-view-switching-and-scoped-scroll-anchoring' });

  for (const reducedMotion of ['no-preference', 'reduce']) {
    await page.emulateMedia({ reducedMotion });
    for (let cycle = 0; cycle < 2; cycle++) {
      await panel.getByRole('button', { name: 'Close context', exact: true }).click();
      await panel.waitFor({ state: 'detached' });
      assert.equal(await page.locator('.context-message-row').count(), 0, 'Closing unmounts the virtual rows');
      await page.locator('.right-tool-rail').getByRole('button', { name: 'Context', exact: true }).click();
      await panel.locator('.context-message-row').first().waitFor();
      await settleLayout(panel);
      await scrollTo(.5);
      assert.ok((await visibleRows()).length > 0, 'Reopening reattaches the scroll container');
    }
  }
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  checks.push({ check: 'repeated-open-close-with-and-without-reduced-motion', cycles: 4 });

  await updateMessages(baseMessages, 'event');
  async function capture(name, width, height) {
    await app.evaluate(({ BrowserWindow }, { width, height }) =>
      BrowserWindow.getAllWindows()[0].setSize(width, height), { width, height });
    await settleLayout(page.locator('.app'));
    await scrollTo(.2);
    const item = (await visibleRows()).find(row => row.top >= 0);
    const row = rowFor(item.key);
    await row.locator('summary').click();
    await row.locator('.context-json pre').waitFor();
    await settleLayout(row);
    await row.locator('summary').focus();
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    await frame();
    await assertFocusVisible(page, row.locator('.context-json pre'), `${name}: JSON body`, { focus: false });
    const geometry = await panel.evaluate(element => {
      const bounds = element.getBoundingClientRect();
      const selectors = ['.context-panel-scroll', '.context-panel-header', '#context-message-list', '.context-message-tabs'];
      return {
        viewport: { width: innerWidth, height: innerHeight },
        bounds: { x: bounds.x, right: bounds.right, width: bounds.width },
        documentOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        overflow: selectors.map(selector => {
          const node = element.querySelector(selector);
          return { selector, extra: node ? node.scrollWidth - node.clientWidth : null };
        }),
      };
    });
    assert.ok(geometry.bounds.x >= -.5 && geometry.bounds.right <= geometry.viewport.width - 44 + 1, `${name}: panel fits beside the tool rail`);
    assert.ok(geometry.documentOverflow <= 1, `${name}: document has no horizontal overflow`);
    for (const item of geometry.overflow) assert.ok(item.extra !== null && item.extra <= 1, `${name}: ${item.selector} overflow ${item.extra}`);
    await focusIsVisible();
    await page.screenshot({ path: join(output, `${name}.png`) });
    checks.push({ check: 'viewport-overflow-and-screenshot', name, geometry });
    await row.locator('summary').click();
    await row.locator('.context-json').waitFor({ state: 'detached' });
  }
  await capture('context-virtual-desktop', 1920, 1032);
  await capture('context-virtual-narrow', 640, 720);
  const localeSnapshotsBefore = await app.evaluate(() =>
    globalThis.virtualizationCalls.filter(method => method === 'snapshot').length);
  await app.evaluate(({ BrowserWindow }) => {
    Object.assign(globalThis.virtualizationFixture.preferences, { language: 'zh', theme: 'light' });
    BrowserWindow.getAllWindows()[0].webContents.send('runtime-event', { type: 'desktop_sessions_changed' });
  });
  await page.waitForFunction(() => document.documentElement.lang === 'zh-CN'
    && document.documentElement.dataset.theme === 'light');
  assert.ok(await app.evaluate(() => globalThis.virtualizationCalls.filter(method => method === 'snapshot').length)
    > localeSnapshotsBefore, 'Changing locale and theme must use the snapshot refresh path');
  await capture('context-virtual-zh-light-mobile', 390, 720);
  assert.equal(await page.locator('.messages').evaluate(element => element.scrollTop), mainScroll,
    'Inspector scrolling never changes the main transcript scroll position');
  assert.deepEqual(errors, []);
  await writeFile(join(output, 'results.json'), JSON.stringify({
    synthetic: true, acceptance: 'isolated Electron presentation, not real-provider or system-stall acceptance',
    executablePath, renderer, maxMountedContextRows: maxMounted, checks, errors,
  }, null, 2));
  console.log(`Context continuous virtualization acceptance passed: ${checks.length} checks; max ${maxMounted} mounted rows; evidence: ${output}`);
} catch (error) {
  if (page) await page.screenshot({ path: join(output, 'failure.png') }).catch(() => {});
  const geometry = page && await page.evaluate(() => {
    const viewport = document.querySelector('.context-panel-scroll');
    return { scrollTop: viewport?.scrollTop, scrollHeight: viewport?.scrollHeight, height: viewport?.clientHeight,
      nodes: [...document.querySelectorAll('.context-content, #context-message-list, .context-message-row, .context-message[open], .context-json, .context-json-tools, .context-json pre')].slice(0, 70).map(element => {
        const rect = element.getBoundingClientRect();
        return { class: element.className, key: element.dataset.contextKey, index: element.dataset.index,
          top: rect.top, height: rect.height, left: rect.left, right: rect.right, width: rect.width,
          clientWidth: element.clientWidth, scrollWidth: element.scrollWidth, style: element.getAttribute('style') };
      }) };
  }).catch(() => null);
  await writeFile(join(output, 'failure.json'), JSON.stringify({ message: String(error), stack: error.stack, checks, errors, geometry }, null, 2));
  throw error;
} finally {
  await app.close();
}
