import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron as electron } from 'playwright';
import { closeDesktopFixture } from './close-desktop-fixture.mjs';
import { settleLayout } from './settle-layout.mjs';

const profile = await mkdtemp(join(tmpdir(), 'step-btw-electron-'));
const workspace = join(profile, 'project');
const runtimeProfile = join(profile, 'step-runtime');
const sessions = join(runtimeProfile, 'sessions');
await mkdir(workspace); await mkdir(sessions, { recursive: true });
const timestamp = new Date().toISOString();
await writeFile(join(sessions, 'btw-fixture.jsonl'), [
  { type: 'session', version: 3, id: 'btw-fixture', cwd: workspace, timestamp },
  { type: 'message', id: 'u', parentId: null, timestamp, message: { role: 'user', content: 'MAIN-CONTEXT-SEED', timestamp: Date.now() } },
  { type: 'message', id: 'a', parentId: 'u', timestamp, message: { role: 'assistant', content: [{ type: 'text', text: 'Main context ready.\n\n**Quoted source** stays in the main task.\n\n```ts\nconst source = "btw-reference";\n```' }],
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: { total: 0 } }, timestamp: Date.now() } },
  { type: 'session_info', id: 'name', parentId: 'a', timestamp, name: 'BTW acceptance' },
].map(value => JSON.stringify(value)).join('\n') + '\n');
await writeFile(join(runtimeProfile, 'config.toml'), 'defaultProvider = "fixture"\ndefaultModel = "fixture"\n[telemetry]\nenabled = false\n');
const requests = [];
let heldMain;
let mainRequested;
const mainRequest = new Promise(resolve => { mainRequested = resolve; });
const chunk = (response, text, done = false) => {
  response.write(`data: ${JSON.stringify({ id: 'btw', object: 'chat.completion.chunk', model: 'fixture',
    choices: [{ index: 0, delta: { content: text }, finish_reason: done ? 'stop' : null }],
    ...(done ? { usage: { prompt_tokens: 50, completion_tokens: 10, total_tokens: 60 } } : {}),
  })}\n\n`);
  if (done) response.end('data: [DONE]\n\n');
};
const server = createServer(async (request, response) => {
  let body = ''; for await (const part of request) body += part;
  const parsed = JSON.parse(body); requests.push(parsed);
  const scenario = [...parsed.messages].reverse().filter(message => message.role === 'user')
    .map(message => JSON.stringify(message.content))
    .find(content => /RUN-MAIN|HOLD-SIDE|SIDE-FIRST|AFTER-SESSION-SWITCH|WHY-THIS-REFERENCE|NEXT-QUOTED-QUESTION|SIDE-QUESTION-AFTER-REFERENCE/.test(content)) ?? '';
  response.writeHead(200, { 'content-type': 'text/event-stream' });
  if (scenario.includes('RUN-MAIN')) { heldMain = response; chunk(response, 'Main running.'); mainRequested(); }
  else if (scenario.includes('HOLD-SIDE')) chunk(response, 'Partial side answer.');
  else { chunk(response, 'SIDE-ANSWER '); setTimeout(() => { if (!response.destroyed) chunk(response, 'isolated.', true); }, 100); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
await writeFile(join(runtimeProfile, 'models.json'), JSON.stringify({ providers: { fixture: {
  api: 'openai-completions', baseUrl: `http://127.0.0.1:${server.address().port}/v1`, apiKey: 'local-btw-fixture',
  models: [{ id: 'fixture', name: 'BTW fixture', contextWindow: 32768, maxTokens: 2048 },
    { id: 'fixture-next', name: 'BTW next model', contextWindow: 32768, maxTokens: 2048 }],
} } }));
await writeFile(join(profile, 'preferences.json'), JSON.stringify({ language: 'en', theme: 'dark', workspace, workspaces: [workspace] }));
const env = { ...process.env, DESKTOP_TEST_USER_DATA: profile, DESKTOP_TEST_NO_FOCUS: '1' };
delete env.ELECTRON_RUN_AS_NODE;
let app;
try {
  const executablePath = process.env.DESKTOP_VERIFY_EXE;
  app = await electron.launch({ ...(executablePath ? { executablePath, args: [] } : { args: [resolve('.')] }), env, timeout: 60000 });
  const page = await app.firstWindow();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    win.setOpacity(0); win.setIgnoreMouseEvents(true); win.showInactive(); win.setSize(1300, 900);
  });
  await page.getByRole('button', { name: 'BTW acceptance', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.conversation')?.getAttribute('aria-busy') === 'false'
    && document.querySelector('.composer > .composer-input')?.getAttribute('contenteditable') === 'true');
  const input = page.locator('main .composer > .composer-input');
  const panel = page.getByRole('complementary', { name: 'Side question', exact: true });
  const send = async text => { await input.fill(text); await input.press('Escape'); await input.press('Enter'); };
  const before = await page.evaluate(() => window.desktop.snapshot());
  await input.fill('KEEP-MAIN-DRAFT');
  await page.getByRole('button', { name: 'Side question', exact: true }).click();
  assert.equal(await input.innerText(), 'KEEP-MAIN-DRAFT');
  await settleLayout(panel);
  assert.equal(await page.evaluate(() => {
    const main = document.querySelector('main .composer').getBoundingClientRect();
    const side = document.querySelector('#btw-panel .composer').getBoundingClientRect();
    return Math.abs(main.top - side.top) < 1 && Math.abs(main.bottom - side.bottom) < 1;
  }), true, 'Real Electron main and side fields share their top and bottom baseline, despite the main performance footer');
  await panel.getByRole('button', { name: 'Close side question', exact: true }).click();
  await send('/btw SIDE-FIRST');
  await panel.locator('[data-state="done"]').waitFor();
  assert.equal(requests.length, 1);
  assert.ok(!requests[0].tools?.length);
  assert.match(JSON.stringify(requests[0].messages), /MAIN-CONTEXT-SEED/);
  const after = await page.evaluate(() => window.desktop.snapshot());
  assert.deepEqual(after.messages, before.messages, 'Side question does not append a main user or assistant message');
  assert.deepEqual(after.launch, before.launch, 'Side question does not consume launch state');
  assert.deepEqual(after.pendingMessages, before.pendingMessages, 'Side question never uses the main queue');
  await panel.getByRole('button', { name: 'Close side question', exact: true }).click();
  await send('RUN-MAIN');
  await page.waitForFunction(() => document.querySelector('.composer-action-button')?.getAttribute('data-action') === 'stop');
  let mainTimer;
  try {
    await Promise.race([mainRequest, new Promise((_, reject) => {
      mainTimer = setTimeout(() => reject(new Error('The held main provider request did not arrive')), 10000);
    })]);
  } finally { clearTimeout(mainTimer); }
  assert.ok(heldMain && !heldMain.writableEnded, 'The fixture holds the actual main request, not a trailing context reminder');
  await send('/btw HOLD-SIDE');
  await panel.getByText('Partial side answer.', { exact: true }).waitFor();
  await panel.getByRole('button', { name: 'Stop side question', exact: true }).click();
  await panel.locator('[data-state="cancelled"]').waitFor();
  const still = await page.evaluate(() => window.desktop.snapshot());
  assert.equal(still.state.isStreaming, true, 'Stopping a side question does not abort the main task');
  assert.equal(heldMain.destroyed, false, 'Side cancellation does not close the main provider stream');
  assert.equal(heldMain.writableEnded, false, 'The main response stays held until explicitly released');
  assert.ok(!JSON.stringify(still.messages).includes('HOLD-SIDE'));
  chunk(heldMain, ' Main complete.', true);
  await page.waitForFunction(async () => !(await window.desktop.snapshot()).state.isStreaming);
  await panel.getByRole('button', { name: 'Close side question', exact: true }).click();
  const saved = await page.evaluate(() => window.desktop.snapshot());
  const history = await readFile(saved.state.sessionFile, 'utf8');
  assert.ok(!history.includes('SIDE-FIRST') && !history.includes('HOLD-SIDE') && !history.includes('SIDE-ANSWER'));
  assert.equal(requests.length, 3);
  assert.equal(await page.evaluate(() => typeof window.require), 'undefined');
  await assert.rejects(page.evaluate(async snapshot =>
    window.desktop.btwAsk({ runtimeId: snapshot.runtimeId, sessionId: 'wrong-session',
      scopeId: 'foreign', requestId: 'foreign', question: 'Never sent' }), saved));
  assert.equal(requests.length, 3, 'Foreign ownership never reaches the provider');
  await page.getByRole('button', { name: 'Side question', exact: true }).click();
  assert.equal(await page.locator('.composer-tools [aria-controls="btw-panel"]').count(), 0);
  assert.equal(await page.locator('.right-tool-rail [aria-controls="btw-panel"]').count(), 1);
  await page.getByRole('button', { name: 'Context', exact: true }).click();
  await panel.waitFor({ state: 'hidden' });
  await page.getByRole('button', { name: 'Side question', exact: true }).click();
  assert.equal(await panel.locator('article').count(), 2, 'Changing right tools retains temporary answers');
  await panel.getByRole('button', { name: 'Expand view', exact: true }).click();
  await panel.getByRole('button', { name: 'Restore sidebar', exact: true }).waitFor();
  await page.keyboard.press('Escape');
  await panel.getByRole('button', { name: 'Expand view', exact: true }).waitFor();
  await page.evaluate(() => window.desktop.command('set_model', { provider: 'fixture', modelId: 'fixture-next' }));
  await page.waitForFunction(async () => (await window.desktop.snapshot()).state.model.id === 'fixture-next');
  await panel.locator('.btw-model').filter({ hasText: 'BTW next model' }).waitFor();
  assert.equal(await panel.locator('article').count(), 2, 'Applying a model change retains temporary records');
  await input.fill('KEEP-MAIN-DRAFT-AFTER-TOOLS');
  const sideInput = panel.getByRole('textbox', { name: 'Side question text', exact: true });
  await sideInput.fill('HOLD-SIDE-TOOLS');
  await sideInput.press('Enter');
  await panel.locator('[data-state="running"]').getByText('Partial side answer.', { exact: true }).waitFor();
  assert.equal(requests.at(-1).model, 'fixture-next', 'The next side request uses the applied model, not the previous answer model');
  await page.getByRole('button', { name: 'Context', exact: true }).click();
  await panel.waitFor({ state: 'hidden' });
  await page.getByRole('button', { name: 'Side question', exact: true }).click();
  await panel.locator('[data-state="cancelled"]').nth(1).waitFor();
  assert.equal(await panel.locator('[data-state="running"]').count(), 0, 'Changing tools cancels the hidden side request');
  assert.equal(await input.innerText(), 'KEEP-MAIN-DRAFT-AFTER-TOOLS', 'Side cancellation retains the main draft');
  const output = process.env.DESKTOP_VERIFY_OUTPUT || 'test-results/btw';
  await mkdir(output, { recursive: true });
  await page.waitForTimeout(260);
  await page.screenshot({ path: join(output, 'electron.png') });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(640, 720));
  await page.waitForTimeout(300);
  assert.equal(await panel.evaluate(el => {
    const box = el.getBoundingClientRect();
    return box.left >= 0 && box.right <= innerWidth && box.top >= 0 && box.bottom <= innerHeight;
  }), true, 'Side panel fits the supported minimum desktop size');
  assert.equal(await page.locator('main .composer-tools').evaluate(el => el.scrollWidth <= el.clientWidth), true,
    'Moving the side-question entry leaves the real composer toolbar within bounds');
  assert.equal(await panel.locator('.composer-tools').evaluate(el => el.scrollWidth <= el.clientWidth), true,
    'The shared side composer toolbar also fits the supported minimum window');
  await page.screenshot({ path: join(output, 'electron-640.png') });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1300, 900));
  await sideInput.fill('HOLD-SIDE-SESSION');
  await sideInput.press('Enter');
  await panel.locator('[data-state="running"]').getByText('Partial side answer.', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'New chat', exact: true }).click();
  await page.waitForFunction(async () => Boolean((await window.desktop.snapshot()).draftId));
  await page.getByRole('button', { name: 'BTW acceptance', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.conversation')?.getAttribute('aria-busy') === 'false'
    && document.querySelector('.composer > .composer-input')?.getAttribute('contenteditable') === 'true');
  await page.getByRole('button', { name: 'Side question', exact: true }).click();
  await panel.waitFor();
  assert.equal(await panel.locator('article').count(), 0, 'Returning to the conversation discards old temporary records');
  assert.equal(requests.length, 5, 'Returning never resubmits the previous side or slash question');
  await sideInput.fill('AFTER-SESSION-SWITCH');
  await sideInput.press('Enter');
  await panel.locator('[data-state="done"]').waitFor();
  assert.equal(requests.length, 6, 'Session switch releases the old side request before a new one');
  assert.ok(!JSON.stringify(requests.at(-1).messages).includes('HOLD-SIDE')
    && !JSON.stringify(requests.at(-1).messages).includes('SIDE-FIRST'), 'New side scope has no old followup history');
  const final = await page.evaluate(() => window.desktop.snapshot());
  const finalHistory = await readFile(final.state.sessionFile, 'utf8');
  for (const side of ['SIDE-FIRST', 'HOLD-SIDE', 'AFTER-SESSION-SWITCH', 'SIDE-ANSWER'])
    assert.ok(!finalHistory.includes(side), 'All side content stays out of the main JSONL');
  await input.fill('KEEP-MAIN-REFERENCE-DRAFT');
  const toolbar = page.getByRole('toolbar', { name: 'Selected text', exact: true });
  const select = async selector => {
    await page.locator(selector).first().scrollIntoViewIfNeeded();
    await page.locator(selector).first().evaluate(el => {
      document.activeElement?.blur();
      const range = document.createRange(); range.selectNodeContents(el);
      getSelection().removeAllRanges(); getSelection().addRange(range);
    });
    await toolbar.waitFor();
  };
  await panel.getByRole('button', { name: 'Close side question', exact: true }).click();
  await select('.response-text > p');
  await toolbar.getByRole('button', { name: 'Quote', exact: true }).click();
  const mainQuotes = page.locator('main .composer-context-bar .composer-quotes');
  await mainQuotes.getByRole('button', { name: 'View quotes', exact: true }).waitFor();
  const sourceParagraph = page.locator('.response-text > p:has(strong)').first();
  await sourceParagraph.scrollIntoViewIfNeeded();
  const sourceBounds = await sourceParagraph.boundingBox();
  await page.mouse.move(sourceBounds.x + 1, sourceBounds.y + sourceBounds.height / 2);
  await page.mouse.down();
  await page.mouse.move(sourceBounds.x + sourceBounds.width - 1, sourceBounds.y + sourceBounds.height / 2, { steps: 12 });
  assert.equal(await toolbar.count(), 0, 'No selection menu interrupts a native drag');
  await page.mouse.up();
  await toolbar.waitFor();
  await toolbar.getByRole('button', { name: 'Ask in side', exact: true }).click();
  const viewQuotes = panel.getByRole('button', { name: 'View quotes', exact: true });
  await viewQuotes.waitFor();
  assert.equal(requests.length, 6, 'Quote entry never makes a provider request by itself');
  assert.equal(await sideInput.evaluate(el => el.value), '');
  assert.equal(await sideInput.evaluate(el => el === document.activeElement), true);
  assert.equal(await input.innerText(), 'KEEP-MAIN-REFERENCE-DRAFT');
  assert.equal(await mainQuotes.locator('.quote-chip').count(), 1);
  await sideInput.fill('WHY-THIS-REFERENCE');
  await sideInput.press('Enter');
  await panel.locator('[data-state="done"]').nth(1).waitFor();
  const quotedPrompt = JSON.stringify(requests.at(-1).messages.at(-1).content);
  assert.match(quotedPrompt, /Quote 1, from an earlier assistant message/);
  assert.match(quotedPrompt, /> \*\*Quoted source\*\* stays in the main task/);
  assert.match(quotedPrompt, /Current user message:/);
  assert.match(quotedPrompt, /WHY-THIS-REFERENCE/);
  assert.ok(!quotedPrompt.includes('startOffset') && !quotedPrompt.includes('entryId'));
  assert.equal(await panel.locator('.composer-quotes').count(), 0);
  assert.equal(await panel.locator('.btw-sent-quotes blockquote').count(), 1);
  assert.equal(await input.innerText(), 'KEEP-MAIN-REFERENCE-DRAFT');
  assert.equal(await mainQuotes.locator('.quote-chip').count(), 1);
  assert.equal(await readFile(final.state.sessionFile, 'utf8'), finalHistory,
    'Quoted side questions and main draft/quotes never write to the saved main transcript');
  await select('.response-text pre code');
  await toolbar.getByRole('button', { name: 'Ask in side', exact: true }).click();
  await viewQuotes.click();
  const quotePreview = page.getByRole('dialog', { name: 'Quote preview', exact: true });
  await quotePreview.locator('.quote-excerpt').filter({ hasText: 'btw-reference' }).waitFor();
  await page.keyboard.press('Escape');
  assert.equal(await panel.isVisible(), true, 'Quote preview Escape never closes the side panel');
  await sideInput.fill('NEXT-QUOTED-QUESTION');
  await sideInput.press('Enter');
  await panel.locator('[data-state="done"]').nth(2).waitFor();
  assert.match(JSON.stringify(requests.at(-1).messages.at(-1).content), /> ```ts/);
  await sideInput.fill('SIDE-QUESTION-AFTER-REFERENCE');
  await sideInput.press('Enter');
  await panel.locator('[data-state="done"]').nth(3).waitFor();
  assert.ok(!JSON.stringify(requests.at(-1).messages.at(-1).content).includes('Quote 1,'),
    'Previously sent quotes do not get attached again to later questions');
  await select('.response-text > p:has(strong)');
  await toolbar.getByRole('button', { name: 'Ask in side', exact: true }).click();
  await viewQuotes.waitFor();
  await page.screenshot({ path: join(output, 'electron-quoted.png') });
  await viewQuotes.click();
  await quotePreview.getByRole('button', { name: 'Remove quote 1', exact: true }).click();
  assert.equal(await sideInput.evaluate(el => el === document.activeElement), true);
  assert.equal(await readFile(final.state.sessionFile, 'utf8'), finalHistory);
  assert.deepEqual(errors, []);
  console.log('BTW Electron: real IPC/native route, quote toolbar, Markdown references, independent drafts, no auto-send or quote reattachment, applied model changes, slash, main concurrency, cancellation, followup isolation, minimum layout and no history writes passed.');
} finally {
  if (app) await closeDesktopFixture(app);
  server.closeAllConnections(); await new Promise(resolve => server.close(() => resolve()));
  await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
