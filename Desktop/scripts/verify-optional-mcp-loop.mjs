import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { _electron as electron } from 'playwright';
import { mkdtemp } from './test-profile.mjs';
import { closeDesktopFixtureAndWait } from './close-desktop-fixture.mjs';
import { settleLayout } from './settle-layout.mjs';

const desktop = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = resolve(process.env.DESKTOP_VERIFY_OUTPUT ?? 'test-results/optional-mcp-loop');
const executionRoot = resolve(process.env.DESKTOP_VERIFY_ROOT ?? desktop);
const executablePath = process.env.DESKTOP_VERIFY_EXE;
const scratch = resolve(process.env.DESKTOP_TEST_SCRATCH ?? join(dirname(output), 'scratch'));
await mkdir(output, { recursive: true });
await mkdir(scratch, { recursive: true });
const profile = await mkdtemp(join(scratch, 'optional-mcp-'));
const root = join(profile, 'step-runtime');
const project = join(profile, 'project');
const market = join(profile, 'market');
await mkdir(project);
await mkdir(join(root, 'sessions'), { recursive: true });
await mkdir(join(root, 'plugins'));
await writeFile(join(root, 'plugins/.stepcode-preinstalled'), '["steppage"]');
await writeFile(join(profile, 'preferences.json'), JSON.stringify({
  language: 'en', theme: 'light', workspaces: [project], workspace: project, autoCheckUpdates: false,
}));
await writeFile(join(root, 'config.toml'), [
  'defaultProvider = "fixture"', 'defaultModel = "fixture"', '[telemetry]', 'enabled = false',
  '[mcp_servers.steppage__steppage]', 'enabled = false',
  '[mcp_servers.optional_failed]', 'enabled = true',
  `command = ${JSON.stringify(join(profile, 'missing-optional.exe'))}`,
].join('\n') + '\n');
const timestamp = new Date().toISOString();
await writeFile(join(root, 'sessions/optional-loop.jsonl'), [
  { type: 'session', version: 3, id: 'optional-loop', cwd: project, timestamp },
  { type: 'session_info', id: 'name', parentId: null, timestamp, name: 'Optional MCP loop' },
].map(entry => JSON.stringify(entry)).join('\n') + '\n');
await cp(resolve(desktop, '../examples/plugins/config-starter'), market, { recursive: true });
const git = (...args) => execFileSync('git', ['-C', market, ...args], { windowsHide: true, stdio: 'pipe' });
git('init', '--initial-branch=main');
git('add', '--all');
git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-m', 'Local fixture');
const payloads = [], errors = [], checks = [];
let finishFirst;
const server = createServer(async (request, response) => {
  let body = '';
  for await (const part of request) body += part;
  payloads.push(JSON.parse(body));
  const chunk = (delta, finish_reason = null) => `data: ${JSON.stringify({
    id: 'optional-fixture', object: 'chat.completion.chunk', created: 1, model: 'fixture',
    choices: [{ index: 0, delta, finish_reason }],
  })}\n\n`;
  response.writeHead(200, { 'content-type': 'text/event-stream' });
  response.write(chunk({ role: 'assistant', content: `Fixture response ${payloads.length}.` }));
  const finish = () => response.end(chunk({}, 'stop') + 'data: [DONE]\n\n');
  if (payloads.length === 1) finishFirst = finish;
  else finish();
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
await writeFile(join(root, 'models.json'), JSON.stringify({ providers: { fixture: {
  api: 'openai-completions', baseUrl: `http://127.0.0.1:${server.address().port}/v1`, apiKey: 'synthetic',
  models: [{ id: 'fixture', name: 'Fixture', contextWindow: 128000, maxTokens: 1024 }],
} } }));
const env = { ...process.env, DESKTOP_TEST_USER_DATA: profile, DESKTOP_TEST_NO_FOCUS: '1' };
for (const key of Object.keys(env)) if (/^(ELECTRON_RUN_AS_NODE|DESKTOP_DEV_URL|NODE_OPTIONS|STEP|PI_|AI_AGENT)/i.test(key)
  || /(?:API_KEY|ACCESS_TOKEN|AUTH_TOKEN|SECRET|PASSWORD|COOKIE)$/i.test(key)) delete env[key];
let app, page, complete = false, phase = 'launch';
const until = async predicate => {
  const deadline = Date.now() + 30000;
  while (!await predicate().catch(error => {
    if (/capability:busy/u.test(String(error))) return false;
    throw error;
  })) {
    assert.ok(Date.now() < deadline, `Timeout: ${phase}`);
    await delay(50);
  }
};
const mark = value => { phase = value; console.log(`Optional MCP loop: ${value}`); };
try {
  app = await electron.launch({ ...(executablePath ? { executablePath, args: [] }
    : { args: [process.env.DESKTOP_VERIFY_ENTRY ?? executionRoot] }), cwd: executionRoot, env, timeout: 60000 });
  page = await app.firstWindow();
  page.on('pageerror', error => errors.push(error.message));
  await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    window.setOpacity(0); window.setIgnoreMouseEvents(true); window.showInactive(); window.setSize(1440, 960);
  });
  await page.waitForFunction(() => Boolean(window.desktop?.snapshot));
  const ipc = (method, input) => page.evaluate(({ method, input }) =>
    input === undefined ? window.desktop[method]() : window.desktop[method](input), { method, input });
  const snapshot = () => ipc('snapshot');
  await page.locator('[data-reorder-id="optional-loop"] > button').first().click();
  await until(async () => (await snapshot()).state?.desktopStartup?.tools.some(tool =>
    tool.name === 'optional_failed' && tool.status === 'failed'));
  const identity = (await snapshot()).runtimeId;
  const input = page.locator('.composer-input');
  mark('normal send starts with a failed optional MCP and no confirmation');
  await input.fill('Start a normal task without the unavailable MCP.');
  await input.press('Enter');
  await until(async () => payloads.length === 1 && (await snapshot()).state?.isStreaming);
  assert.equal(await page.getByRole('dialog', { name: 'Unavailable tools', exact: true }).count(), 0);
  checks.push(phase);

  mark('browse, install, toggle and save generic configuration without stopping the live task');
  await page.getByRole('button', { name: 'Plugin marketplace', exact: true }).click();
  await ipc('capabilityMutate', { action: 'marketplace-add', source: pathToFileURL(market).href });
  let catalog = await ipc('capabilityCatalog');
  const available = catalog.available.find(plugin => plugin.name === 'dfsc-config-example');
  assert.ok(available?.package?.ref);
  await ipc('capabilityMutate', {
    action: 'plugin-install', name: available.name, marketplace: available.marketplace, ref: available.package.ref,
  });
  catalog = await ipc('capabilityCatalog');
  const installed = catalog.plugins.find(plugin => plugin.id === 'dfsc-config-example');
  assert.ok(installed?.package?.configurationAvailable);
  // Reload only the renderer so its actual catalog sees the new installation.
  await page.reload();
  await page.getByRole('button', { name: 'Plugin marketplace', exact: true }).click();
  await page.getByRole('button', { name: 'Configure DFSC Configuration Example', exact: true }).click();
  await page.getByLabel('Prefix', { exact: true }).fill('Next launch: ');
  const save = page.getByRole('button', { name: 'Save configuration', exact: true });
  await save.click();
  await until(async () => (await ipc('pluginConfiguration', { ref: installed.package.ref })).values.prefix === 'Next launch: ');
  await page.getByRole('switch', { name: 'Enable DFSC Configuration Example services', exact: true }).click();
  await until(async () => !(await ipc('capabilityCatalog')).mcp.find(server => server.pluginId === installed.id).enabled);
  await page.getByText('Services disabled', { exact: true }).waitFor();
  assert.ok((await snapshot()).state.isStreaming);
  assert.equal((await snapshot()).runtimeId, identity);
  assert.equal(payloads.length, 1);
  assert.ok(!(await snapshot()).state.desktopStartup.tools.some(tool => tool.name.startsWith('dfsc-config-example__')));
  assert.ok(await page.getByRole('button', { name: 'Restart current session', exact: true }).isDisabled());
  for (const [theme, width] of [['light', 1440], ['dark', 1440], ['dark', 640]]) {
    await ipc('preferences', { theme });
    await page.waitForFunction(theme => document.documentElement.dataset.theme === theme, theme);
    await app.evaluate(({ BrowserWindow }, width) => BrowserWindow.getAllWindows()[0].setSize(width, 960), width);
    const prefix = page.getByLabel('Prefix', { exact: true });
    await settleLayout(page.locator('.pc-detail-document'));
    await until(async () => {
      await prefix.focus();
      await settleLayout(prefix);
      return prefix.evaluate(element => document.activeElement === element);
    });
    await page.screenshot({ path: join(output, `busy-plugin-config-${theme}-${width}.png`) });
  }
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1440, 960));
  checks.push(phase);
  await page.getByRole('button', { name: 'Back to conversation', exact: true }).click();

  mark('queue two messages and steer the first while the optional MCP remains failed');
  await input.fill('STEER_FIXTURE: use another approach.');
  await input.press('Enter');
  await until(async () => (await snapshot()).pendingMessages?.length === 1 && !(await input.textContent()).trim());
  await input.fill('FOLLOWUP_FIXTURE: next task.');
  await input.press('Enter');
  await until(async () => (await snapshot()).pendingMessages?.length === 2 && !(await input.textContent()).trim());
  await input.press('Enter');
  await until(async () => (await snapshot()).pendingMessages?.some(item => item.steered && item.sending));
  assert.equal(await page.getByRole('dialog', { name: 'Unavailable tools', exact: true }).count(), 0);
  await page.screenshot({ path: join(output, 'degraded-steer-accepted.png') });
  checks.push(phase);
  finishFirst();
  mark('agent loop consumes steering and automatically drains the queued follow-up');
  await until(async () => payloads.length === 3 && !(await snapshot()).state?.isStreaming
    && !(await snapshot()).pendingMessages?.length);
  assert.ok(JSON.stringify(payloads[1].messages).includes('STEER_FIXTURE'));
  assert.ok(JSON.stringify(payloads[2].messages).includes('FOLLOWUP_FIXTURE'));
  const history = await readFile(join(root, 'sessions/optional-loop.jsonl'), 'utf8');
  for (const text of ['STEER_FIXTURE', 'FOLLOWUP_FIXTURE'])
    assert.equal(history.split('\n').filter(line => {
      if (!line) return false;
      const entry = JSON.parse(line);
      return entry.message?.role === 'user' && JSON.stringify(entry.message.content).includes(text);
    }).length, 1);
  assert.equal((await snapshot()).runtimeId, identity);
  assert.equal((await snapshot()).state.desktopStartup.tools.find(tool => tool.name === 'optional_failed').status, 'failed');
  assert.equal(await page.locator('.app-error-banner').count(), 0);
  assert.deepEqual(errors, []);
  checks.push(phase);
  complete = true;
} catch (error) {
  if (page) {
    console.error(await page.evaluate(async () => {
      const value = await window.desktop.snapshot();
      return { state: value.state, pending: value.pendingMessages, requests: value.requests,
        error: document.querySelector('.app-error-banner')?.textContent,
        draft: document.querySelector('.composer-input')?.textContent };
    }).catch(() => null));
    await page.screenshot({ path: join(output, 'failure.png') }).catch(() => {});
  }
  throw error;
} finally {
  await writeFile(join(output, 'results.json'), JSON.stringify({
    complete, phase, checks, providerRequests: payloads.length, rendererErrors: errors,
    scope: 'Real isolated Electron main/preload/runtime with a local synthetic provider and local Git plugin; no real account or installer.',
  }, null, 2));
  try { if (app) await closeDesktopFixtureAndWait(app); }
  finally { server.closeAllConnections(); await new Promise(done => server.close(done)); }
}
console.log(`Optional MCP loop passed: ${checks.length} checks, ${payloads.length} synthetic provider requests.`);
