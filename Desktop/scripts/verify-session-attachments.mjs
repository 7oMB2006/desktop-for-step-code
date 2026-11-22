import assert from 'node:assert/strict';
import { mkdir, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { _electron as electron } from 'playwright';
import { restartIdleSessionFixture, submitSessionFixture, waitForSessionFixtureSnapshot, waitForSessionFixtureTools } from './session-fixture.mjs';
import { mkdtemp } from './test-profile.mjs';

const tool = 'desktop_session_attachments';
const replies = new Map();
const imageCounts = new Map();
const observed = [];
const saved = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a/tUAAAAASUVORK5CYII=';
let selectedMessageId;
let serverError;
const text = content => typeof content === 'string' ? content
  : content?.filter(block => block.type === 'text').map(block => block.text).join('\n') ?? '';
const chunk = (delta, finish_reason = null) => `data: ${JSON.stringify({
  id: 'session-attachments', object: 'chat.completion.chunk', created: 1, model: 'fixture',
  choices: [{ index: 0, delta, finish_reason }],
})}\n\n`;
const server = createServer(async (request, response) => {
  try {
    let body = '';
    for await (const part of request) body += part;
    const payload = JSON.parse(body);
    const last = payload.messages.at(-1);
    const prompt = /\bATTACHMENTS (pair|list|selected|default|followup|peer|compact)\b/;
    const user = payload.messages.findLast(message => message.role === 'user' && prompt.test(text(message.content)));
    const scenario = prompt.exec(text(user?.content))?.[1];
    observed.push({ scenario, lastRole: last?.role });
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    const complete = () => response.end(chunk({ role: 'assistant', content: `Fixture complete: ${scenario}` })
      + chunk({}, 'stop') + 'data: [DONE]\n\n');
    if (!scenario) { complete(); return; }
    if (last?.role === 'tool') { replies.set(scenario, text(last.content)); complete(); return; }
    assert.ok(payload.tools.some(entry => entry.function.name === tool), 'Step Code must register the attachment tool');
    imageCounts.set(scenario, payload.messages.reduce((count, message) => count
      + (Array.isArray(message.content) ? message.content.filter(block => block.type === 'image_url').length : 0), 0));
    const args = scenario === 'list' || scenario === 'peer' ? { operation: 'list' }
      : scenario === 'selected' || scenario === 'followup'
        ? { operation: 'export', messageId: selectedMessageId, imageIndex: 2 }
        : { operation: 'export' };
    response.end(chunk({ tool_calls: [{ index: 0, id: `call-${scenario}`, type: 'function',
      function: { name: tool, arguments: JSON.stringify(args) } }] }) + chunk({}, 'tool_calls') + 'data: [DONE]\n\n');
  } catch (error) { serverError = error; response.destroy(); }
});

const profile = await realpath(await mkdtemp(join(tmpdir(), 'step-session-attachments-')));
const cache = join(profile, 'cache', 'session-attachment-exports');
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let app;
try {
  const root = join(profile, 'step-runtime');
  const sessions = join(root, 'sessions');
  await mkdir(sessions, { recursive: true });
  await writeFile(join(profile, 'preferences.json'), JSON.stringify({ language: 'en', workspaces: [] }));
  await writeFile(join(root, 'config.toml'), 'defaultProvider = "fixture"\ndefaultModel = "fixture"\npermissionPreset = "ask"\n[telemetry]\nenabled = false\n[mcp_servers.steppage__steppage]\nenabled = false\n');
  await writeFile(join(root, 'models.json'), JSON.stringify({ providers: { fixture: {
    baseUrl: `http://127.0.0.1:${server.address().port}/v1`, api: 'openai-completions',
    apiKey: 'local-test-only', models: [{ id: 'fixture', name: 'Fixture', input: ['text', 'image'], contextWindow: 32768, maxTokens: 2048 }],
  } } }));
  for (const id of ['attachment-source', 'attachment-peer', 'attachment-compact']) {
    const timestamp = new Date().toISOString();
    const user = (id, parentId, content) => ({ type: 'message', id, parentId, timestamp,
      message: { role: 'user', content, timestamp: Date.parse(timestamp) } });
    const entries = [{ type: 'session', version: 3, id, cwd: profile, timestamp }];
    if (id === 'attachment-compact') {
      entries.push(user('saved-image', null, [{ type: 'text', text: 'Image before compaction' },
        { type: 'image', mimeType: 'image/png', data: saved }]));
      entries.push(user('keep-text', 'saved-image', [{ type: 'text', text: 'Text kept after compaction' }]));
      entries.push({ type: 'compaction', id: 'compact', parentId: 'keep-text', timestamp,
        summary: 'Earlier message had an image.', firstKeptEntryId: 'keep-text', tokensBefore: 200 });
    } else entries.push(user('message-1', null, [{ type: 'text', text: id }]));
    await writeFile(join(sessions, `${id}.jsonl`), entries.map(value => JSON.stringify(value)).join('\n') + '\n');
  }
  const env = { ...process.env, DESKTOP_TEST_USER_DATA: profile, DESKTOP_TEST_NO_FOCUS: '1' };
  delete env.ELECTRON_RUN_AS_NODE;
  const executablePath = process.env.DESKTOP_VERIFY_EXE;
  app = await electron.launch({ ...(executablePath ? { executablePath } : { args: [resolve('.')] }),
    cwd: executablePath ? process.env.DESKTOP_VERIFY_CWD : undefined, env, timeout: 60000 });
  const page = await app.firstWindow();
  await page.getByText('Step Code connected', { exact: true }).waitFor({ state: 'attached', timeout: 60000 });
  const select = async id => {
    await page.locator(`[data-reorder-kind="session"][data-reorder-id="${id}"]`).locator('button').first().click();
    return waitForSessionFixtureSnapshot(page, snapshot => snapshot.state?.sessionId === id && !snapshot.draftId, id);
  };
  const input = page.locator('.composer > .composer-input');
  const send = async (scenario, runtimeId) => {
    const message = `ATTACHMENTS ${scenario}`;
    if (runtimeId) {
      await waitForSessionFixtureTools(page, runtimeId);
      await page.evaluate(async ({ message, runtimeId }) => window.desktop.command('prompt', { message }, runtimeId),
        { message, runtimeId });
    } else {
      await input.fill(message);
      await submitSessionFixture(page, () => input.press('Enter'));
    }
    await waitForSessionFixtureSnapshot(page, snapshot => {
      if (serverError) throw serverError;
      return replies.has(scenario) && !snapshot.state?.isStreaming;
    }, `settled attachment tool: ${scenario}`).catch(error => {
      throw new Error(`${error.message}; fixture requests: ${JSON.stringify(observed)}`, { cause: error });
    });
    return JSON.parse(replies.get(scenario));
  };
  const paste = images => input.evaluate((element, images) => {
    const transfer = new DataTransfer();
    const encoded = images.map(([mime, color]) => {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 8;
      const context = canvas.getContext('2d');
      context.fillStyle = color;
      context.fillRect(0, 0, 8, 8);
      const base64 = canvas.toDataURL(mime).split(',')[1];
      const bytes = Uint8Array.from(atob(base64), char => char.charCodeAt(0));
      transfer.items.add(new File([bytes], mime === 'image/jpeg' ? 'sample.jpg' : 'sample.png', { type: mime }));
      return base64;
    });
    element.dispatchEvent(new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true }));
    return encoded;
  }, images);
  const checkBytes = async (image, base64) => {
    assert.equal(dirname(image.path), cache);
    assert.equal((await readFile(image.path)).toString('base64'), base64);
  };

  await select('attachment-source');
  const pasted = await paste([['image/png', '#336677'], ['image/jpeg', '#95442a']]);
  await page.waitForFunction(() => document.querySelectorAll('.attachments .attachment-card').length === 2);
  const pair = await send('pair');
  assert.equal(imageCounts.get('pair'), 2);
  assert.deepEqual(pair.images.map(image => image.mimeType), ['image/png', 'image/jpeg']);
  for (const [i, image] of pair.images.entries()) {
    await checkBytes(image, pasted[i]);
    assert.ok(!replies.get('pair').includes(pasted[i]));
  }
  const listed = await send('list');
  assert.deepEqual(listed.messages.map(group => ({
    messageId: group.messageId, images: group.images,
  })), [{ messageId: pair.messageId, images: [{ imageIndex: 1, mimeType: 'image/png' }, { imageIndex: 2, mimeType: 'image/jpeg' }] }]);
  selectedMessageId = listed.messages[0].messageId;
  assert.ok(selectedMessageId);
  const [newer] = await paste([['image/png', '#3e8352']]);
  await page.waitForFunction(() => document.querySelectorAll('.attachments .attachment-card').length === 1);
  assert.deepEqual(await send('selected'), { messageId: selectedMessageId, images: [pair.images[1]] });
  assert.equal(imageCounts.get('selected'), 3);
  assert.equal((await readdir(cache)).length, 2, 'the explicit repeat reuses the original export');
  const latest = await send('default');
  assert.notEqual(latest.messageId, selectedMessageId);
  assert.equal(latest.images.length, 1);
  await checkBytes(latest.images[0], newer);

  await select('attachment-peer');
  assert.deepEqual(await send('peer'), { messages: [] });
  const source = await select('attachment-source');
  await restartIdleSessionFixture(page, source.runtimeId);
  const reconnected = await waitForSessionFixtureSnapshot(page, async snapshot => snapshot.state?.sessionId === 'attachment-source'
    && snapshot.status === 'connected' && (await readdir(cache)).length === 0, 'reconnected session and cleared exports');
  assert.notEqual(reconnected.runtimeId, source.runtimeId);
  const followup = await send('followup', reconnected.runtimeId);
  assert.equal(followup.messageId, selectedMessageId);
  assert.notEqual(followup.images[0].path, pair.images[1].path);
  await checkBytes(followup.images[0], pasted[1]);

  await select('attachment-compact');
  const compact = await send('compact');
  assert.equal(imageCounts.get('compact'), 0, 'the model context no longer contains the original image');
  assert.equal(compact.messageId, 'saved-image');
  await checkBytes(compact.images[0], saved);
  await app.close();
  app = undefined;
  assert.deepEqual(await readdir(cache), []);
  console.log('Session attachments passed: exact pasted bytes, stable selection, cache reuse, peer isolation, compaction, reconnect, and cleanup.');
} finally {
  try { await app?.close(); }
  finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}
