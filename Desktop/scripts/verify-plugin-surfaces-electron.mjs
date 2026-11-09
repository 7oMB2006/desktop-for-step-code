import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { createServer as createBridgeServer } from 'node:net';
import { cp, mkdir, mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { _electron as electron } from 'playwright';
import { closeDesktopFixtureAndWait } from './close-desktop-fixture.mjs';
import { settleLayout } from './settle-layout.mjs';

const output = resolve(process.env.DESKTOP_VERIFY_OUTPUT || 'test-results/plugin-surfaces-electron');
await mkdir(output, { recursive: true });
const profile = await realpath(await mkdtemp(join(output, 'profile-')));
const root = join(profile, 'step-runtime');
const workspace = join(profile, 'project');
const market = join(profile, 'surface-market');
const fixturePlugins = [
  { id: 'a-surface-main', name: 'A Surface Main Guide', title: 'Main Surface', surface: 'main-view' },
  { id: 'surface-side', name: 'Surface Side Guide', title: 'Side Surface', surface: 'side-panel' },
  { id: 'surface-window', name: 'Surface Window Guide', title: 'Window Surface', surface: 'window' },
  { id: 'z-surface-overflow', name: 'Overflow Surface Guide', title: 'Overflow Surface', surface: 'main-view' },
];
await mkdir(join(root, 'sessions'), { recursive: true });
await mkdir(workspace);
await mkdir(join(market, '.step-plugin'), { recursive: true });
const writePlugin = async (plugin, version = '0.1.0', connection = false) => {
  const target = join(market, 'plugins', plugin.id);
  await mkdir(join(target, 'docs'), { recursive: true });
  await writeFile(join(target, 'step.plugin.json'), JSON.stringify({
    id: plugin.id, name: plugin.name, version, description: 'Offline resource-only surface acceptance fixture.',
  }));
  await writeFile(join(target, 'dfsc.plugin.json'), JSON.stringify({
    schemaVersion: 1, documentation: { readme: 'README.md' },
    desktop: {
      title: plugin.title, surface: plugin.surface, symbol: 'bot', defaultPage: 'start',
      ...(connection ? { connection: { protocol: 'agent-bridge-v1' } } : {}),
      pages: [{ id: 'start', title: 'Get started', document: 'docs/start.md' },
        { id: 'setup', title: connection ? 'Setup notes' : 'Connection', document: 'docs/setup.md' }],
    },
  }));
  await writeFile(join(target, 'README.md'), `# ${plugin.name}\n\nAn installed resource-only fixture.\n`);
  await writeFile(join(target, 'docs/start.md'), `# ${plugin.title} start\n\nVersion ${version}\n\n`
    + 'Installation does not establish a connection or authorize project execution.\n\n'
    + '[Read connection preparation](setup.md)\n\n'
    + 'Keep installed resources distinct from live operational state.\n\n'.repeat(60));
  await writeFile(join(target, 'docs/setup.md'), `# ${plugin.title} connection\n\nVersion ${version}\n\n`
    + 'No connection is active in this offline fixture.\n\n'.repeat(60));
};
for (const plugin of fixturePlugins) await writePlugin(plugin);
let hermes;
if (process.env.DESKTOP_PLUGIN_HERMES_SOURCE) {
  const source = await realpath(process.env.DESKTOP_PLUGIN_HERMES_SOURCE);
  const manifest = JSON.parse(await readFile(join(source, 'step.plugin.json'), 'utf8'));
  const metadata = JSON.parse(await readFile(join(source, 'dfsc.plugin.json'), 'utf8'));
  assert.ok(manifest.id && metadata.desktop?.surface === 'main-view');
  assert.equal(metadata.desktop.pages.length, 4, 'Hermes ships the four declared onboarding pages');
  assert.ok(metadata.desktop.icon?.light, 'Hermes declares a custom desktop icon');
  const image = async path => {
    const bytes = await readFile(join(source, path));
    assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', 'The declared source asset is a PNG');
    return { dataUrl: `data:image/png;base64,${bytes.toString('base64')}`,
      sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length,
      width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  };
  const icon = await image(manifest.icon);
  const toolbar = { light: await image(metadata.desktop.icon.light),
    dark: await image(metadata.desktop.icon.dark ?? metadata.desktop.icon.light) };
  if (process.env.DESKTOP_PLUGIN_HERMES_ICON_SHA256)
    assert.equal(icon.sha256, process.env.DESKTOP_PLUGIN_HERMES_ICON_SHA256.toLowerCase(), 'The approved package avatar is staged');
  hermes = { id: manifest.id, name: manifest.name, title: metadata.desktop.title, metadata, icon, toolbar };
  await cp(source, join(market, 'plugins', hermes.id), { recursive: true, errorOnExist: true, force: false });
}
const plugins = [...fixturePlugins, ...(hermes ? [hermes] : [])];
await writeFile(join(market, '.step-plugin', 'marketplace.json'), JSON.stringify({
  name: 'surface-market', plugins: plugins.map(plugin => ({
    name: plugin.id, source: `./plugins/${plugin.id}`, description: 'Local offline desktop surface fixture.',
  })),
}));
const git = (...args) => execFileSync('git', ['-C', market, ...args], { encoding: 'utf8', timeout: 30000 });
git('init', '--initial-branch=main');
const commit = message => {
  git('add', '--all');
  git('-c', 'user.name=Desktop Fixture', '-c', 'user.email=fixture@example.invalid',
    'commit', '--quiet', '-m', message);
};
commit('Create local surface acceptance resources');

const timestamp = new Date().toISOString();
const lines = [{ type: 'session', version: 3, id: 'surface-session', cwd: workspace, timestamp }];
let parentId = null;
for (let index = 0; index < 20; index++) {
  for (const role of ['user', 'assistant']) {
    const id = `surface-${role}-${index}`;
    lines.push({ type: 'message', id, parentId, timestamp, message: {
      role, timestamp: Date.now() + index,
      content: role === 'user' ? `Surface question ${index}` : [{
        type: 'text', text: `## Retained answer ${index}\n\n`
          + 'The real conversation retains its reading position while plugin surfaces are open.\n\n'.repeat(5),
      }],
      ...(role === 'assistant' ? {
        stopReason: 'stop', usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: { total: 0 } },
      } : {}),
    } });
    parentId = id;
  }
}
lines.push({ type: 'session_info', id: 'surface-name', parentId, timestamp, name: 'Surface retained conversation' });
await writeFile(join(root, 'sessions', 'surface-session.jsonl'), lines.map(line => JSON.stringify(line)).join('\n') + '\n');
await writeFile(join(root, 'config.toml'),
  'defaultProvider = "fixture"\ndefaultModel = "fixture"\npermissionPreset = "ask"\n[telemetry]\nenabled = false\n');
await writeFile(join(profile, 'preferences.json'), JSON.stringify({
  language: 'en', theme: 'light', workspace, workspaces: [workspace],
}));
let inferenceRequests = 0;
const transport = createServer(async (request, response) => {
  if (request.method === 'POST') inferenceRequests++;
  for await (const _chunk of request) {}
  response.writeHead(503, { 'content-type': 'application/json' });
  response.end(JSON.stringify({ error: { message: 'No inference is expected in surface acceptance.' } }));
});
await new Promise(resolve => transport.listen(0, '127.0.0.1', resolve));
await writeFile(join(root, 'models.json'), JSON.stringify({ providers: { fixture: {
  api: 'openai-completions', baseUrl: `http://127.0.0.1:${transport.address().port}/v1`, apiKey: 'isolated-surface-fixture',
  models: [{ id: 'fixture', name: 'Offline surface fixture', contextWindow: 65536, maxTokens: 1024 }],
} } }));
const agentProfile = join(profile, 'isolated-agent'), bridgeRoot = join(profile, 'isolated-bridge');
await mkdir(join(agentProfile, 'dfsc-bridge'), { recursive: true });
await mkdir(join(bridgeRoot, 'agents', 'fixture-agent'), { recursive: true });
await writeFile(join(agentProfile, 'config.yaml'), 'api_key: marker-secret-never-read\n');
await writeFile(join(agentProfile, 'dfsc-bridge/config.json'), JSON.stringify({
  schemaVersion: 1, agentId: 'fixture-agent', displayName: 'Isolated agent', bridgeRoot, workspaceRoots: [workspace],
}));
const bridgeToken = 'isolated-private-bridge-token';
const bridgeRequests = [], bridgeSockets = new Set();
let bridgeIdentity = 'fixture-agent', bridgeRoots = [workspace], bridgeGate, bridgeEntered;
const bridgeServer = createBridgeServer(socket => {
  bridgeSockets.add(socket);
  socket.on('close', () => bridgeSockets.delete(socket));
  socket.on('error', () => {});
  let bytes = '';
  socket.on('data', async chunk => {
    bytes += chunk.toString();
    if (!bytes.includes('\n')) return;
    const request = JSON.parse(bytes.slice(0, bytes.indexOf('\n')));
    assert.equal(request.token, bridgeToken);
    assert.ok(['system.capabilities', 'task.list'].includes(request.method), 'only fixed read methods reach the server');
    bridgeRequests.push(request.method);
    if (bridgeGate) { bridgeEntered?.(); await bridgeGate; }
    socket.end(JSON.stringify({ ok: true, result: request.method === 'system.capabilities'
      ? { agentId: bridgeIdentity, roots: bridgeRoots }
      : [
        { id: 'visible-task', title: `Inspect test results ${bridgeToken}`, phase: 'review', cwd: workspace,
          origin: { agentProfile: 'fixture-agent' }, transcript: 'private-transcript-never-read' },
        { id: 'foreign-task', title: 'Never show foreign task', phase: 'running', cwd: workspace, origin: { agentProfile: 'other' } },
      ] }) + '\n');
  });
});
await new Promise(resolve => bridgeServer.listen(0, '127.0.0.1', resolve));
const descriptorFile = join(bridgeRoot, 'agents/fixture-agent/model.json');
await writeFile(descriptorFile, JSON.stringify({ version: 1, role: 'model', agentId: 'fixture-agent',
  transport: 'tcp', host: '127.0.0.1', port: bridgeServer.address().port, token: bridgeToken }));
const originalDescriptor = await readFile(descriptorFile, 'utf8');
const env = { ...process.env, DESKTOP_TEST_USER_DATA: profile, DESKTOP_TEST_NO_FOCUS: '1' };
for (const key of ['ELECTRON_RUN_AS_NODE', 'DESKTOP_TEST_STARTUP_WINDOW', 'DESKTOP_DEV_URL', 'STEP_API_KEY'])
  delete env[key];
const checks = [], errors = [], iconChecks = [];
let app, main, native;
let shutdown;
let verified = false;
const catalog = () => main.evaluate(() => window.desktop.capabilityCatalog());
const installed = async id => {
  const plugin = (await catalog()).plugins.find(plugin => plugin.id === id);
  assert.ok(plugin?.package?.desktop, `${id}: installed desktop metadata`);
  return plugin;
};
const mutate = input => main.evaluate(input => window.desktop.capabilityMutate(input), input);
const action = plugin => main.getByRole('button', { name: plugin.title, exact: true });
const workspaceFor = plugin => main.locator(`[data-plugin-workspace="${plugin.id}"]`);
const center = () => main.getByRole('region', { name: 'Plugin center', exact: true });
const openAction = async plugin => {
  const button = action(plugin);
  if (!await button.isVisible()) {
    await main.getByRole('button', { name: 'More plugins', exact: true }).click();
    await main.getByRole('menuitemradio', { name: plugin.title, exact: true }).click();
  } else await button.click();
};
const statusFor = plugin => main.getByRole('dialog', { name: `${plugin.title} · Agent status`, exact: true });
const openFullAction = async plugin => {
  await openAction(plugin);
  const status = statusFor(plugin);
  await status.waitFor();
  await status.getByRole('button', { name: 'Open full workspace', exact: true }).click();
};
const waitWorkspaceVersion = (plugin, version) => main.waitForFunction(({ id, version }) =>
  document.querySelector(`[data-plugin-workspace="${CSS.escape(id)}"] .plugin-workspace-identity`)?.textContent.includes(`v${version}`),
{ id: plugin.id, version });
const nativePage = async title => {
  for (const page of app.windows()) {
    const view = await app.browserWindow(page);
    if (await view.evaluate(view => view.getTitle()) === title) return page;
  }
  throw new Error(`Plugin window missing: ${title}`);
};
const configRoute = async plugin => {
  await center().getByRole('heading', { name: plugin.name, exact: true, level: 2 }).waitFor();
  assert.equal(await center().getByRole('tab', { name: 'Configuration', exact: true }).getAttribute('aria-selected'), 'true');
};
const assertHermesIcon = async (image, surface, size) => {
  await image.waitFor({ state: 'visible' });
  assert.equal(await image.count(), 1, `${surface}: one visible avatar`);
  const icon = await image.evaluate(async image => {
    await image.decode();
    const box = image.getBoundingClientRect();
    return { src: image.currentSrc, naturalWidth: image.naturalWidth, naturalHeight: image.naturalHeight,
      width: box.width, height: box.height, theme: document.documentElement.dataset.theme };
  });
  const asset = surface.startsWith('market-') ? hermes.icon : hermes.toolbar[icon.theme === 'dark' ? 'dark' : 'light'];
  assert.ok(icon.src === asset.dataUrl, `${surface}: rendered bytes match the exact source asset`);
  assert.equal(icon.naturalWidth, asset.width, `${surface}: decoded source width`);
  assert.equal(icon.naturalHeight, asset.height, `${surface}: decoded source height`);
  assert.ok(Math.abs(icon.width - size) < 0.5 && Math.abs(icon.height - size) < 0.5,
    `${surface}: avatar remains ${size}px square`);
  iconChecks.push({ surface, theme: icon.theme, sha256: asset.sha256,
    naturalWidth: icon.naturalWidth, naturalHeight: icon.naturalHeight, width: icon.width, height: icon.height });
};
const captureHermesAction = async theme => {
  if (await action(hermes).isVisible()) {
    await assertHermesIcon(action(hermes).locator('.plugin-action-icon img:visible'), 'toolbar-direct', 17);
    await main.screenshot({ path: join(output, `hermes-toolbar-direct-${theme}.png`) });
    return;
  }
  await main.getByRole('button', { name: 'More plugins', exact: true }).click();
  const menu = main.getByRole('menu', { name: 'More plugins', exact: true });
  await assertHermesIcon(menu.getByRole('menuitemradio', { name: hermes.title, exact: true })
    .locator('.plugin-action-icon img:visible'), 'toolbar-overflow', 16);
  await settleLayout(menu);
  await main.screenshot({ path: join(output, `hermes-overflow-${theme}.png`) });
  await main.keyboard.press('Escape');
};
try {
  const executablePath = process.env.DESKTOP_VERIFY_EXE;
  app = await electron.launch({
    ...(executablePath ? { executablePath } : {}),
    args: [...(executablePath ? [] : [resolve(process.env.DESKTOP_VERIFY_MAIN || '.')]),
      '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding',
      '--disable-features=CalculateNativeWinOcclusion'],
    ...(process.env.DESKTOP_VERIFY_CWD ? { cwd: process.env.DESKTOP_VERIFY_CWD } : {}),
    env, timeout: 60000,
  });
  main = await app.firstWindow();
  main.setDefaultTimeout(30000);
  main.on('pageerror', error => errors.push(error.message));
  const mainId = await app.evaluate(({ BrowserWindow }) => {
    const view = BrowserWindow.getAllWindows()[0];
    view.setOpacity(0); view.setIgnoreMouseEvents(true); view.showInactive(); view.setSize(1440, 940);
    return view.id;
  });
  await main.getByRole('button', { name: 'Surface retained conversation', exact: true }).click();
  await main.waitForFunction(async () => {
    const snapshot = await window.desktop.snapshot();
    return snapshot.state?.sessionId === 'surface-session' && snapshot.runtimeId
      && !document.querySelector('.session-reading-preview')
      && document.querySelector('main .composer-input')?.getAttribute('contenteditable') === 'true';
  }, undefined, { timeout: 60000 });
  let before;
  const readyDeadline = Date.now() + 60000;
  do {
    before = await main.evaluate(() => window.desktop.snapshot());
    if (before.runtimeId && before.state?.sessionId === 'surface-session'
      && ['connected', 'ready'].includes(before.status)) break;
    await main.waitForTimeout(50);
  } while (Date.now() < readyDeadline);
  assert.ok(before.runtimeId && before.state?.sessionId === 'surface-session', 'The real restored runtime is ready before recording its identity');
  assert.equal(before.firstRun?.required, false);
  const composer = main.locator('main .composer-input');
  const conversation = main.locator('#conversation-scroll');
  await composer.fill('KEEP THE REAL DESKTOP DRAFT');
  await conversation.hover();
  await main.mouse.wheel(0, -2200);
  await main.getByRole('button', { name: 'Scroll to bottom', exact: true }).waitFor();
  const reading = await conversation.evaluate(element => element.scrollTop);
  assert.ok(reading > 0);
  assert.equal(await main.locator('.plugin-action-group').count(), 0);
  const added = await mutate({ action: 'marketplace-add', source: pathToFileURL(market).href });
  assert.deepEqual(added.warnings, []);
  const source = (await catalog()).marketplaces.find(source => source.name === 'surface-market');
  assert.equal(source?.kind, 'git', 'The isolated market is a real local Git clone');
  await main.getByRole('button', { name: 'Plugin marketplace', exact: true }).click();
  await center().getByRole('tab', { name: /^Discover/ }).click();
  for (const plugin of plugins) {
    await center().getByRole('textbox', { name: 'Search plugins', exact: true }).fill(plugin.id);
    const row = center().locator('.pc-plugin-row').filter({ hasText: plugin.name });
    if (plugin === hermes) await assertHermesIcon(row.locator('.cap-plugin-icon img:visible'), 'market-catalog', 72);
    await row.getByRole('button', { name: 'Install', exact: true }).click();
    await center().getByRole('heading', { name: plugin.name, exact: true, level: 2 }).waitFor();
    const active = await installed(plugin.id);
    assert.equal(active.package.provenance, 'recorded');
    if (plugins.indexOf(plugin) < 3) await action(plugin).waitFor();
    else await main.getByRole('button', { name: 'More plugins', exact: true }).waitFor();
    assert.equal((await main.evaluate(() => window.desktop.snapshot())).runtimeId, before.runtimeId,
      'Resource installation does not replace the real selected runtime');
    if (plugin === hermes) {
      for (const theme of ['light', 'dark']) {
        await main.evaluate(theme => window.desktop.preferences({ theme }), theme);
        await main.waitForFunction(theme => document.documentElement.dataset.theme === theme, theme);
        await settleLayout(center());
        await assertHermesIcon(center().locator('.pc-plugin-identity .cap-plugin-icon img:visible'), 'market-detail', 80);
        await main.screenshot({ path: join(output, `hermes-market-${theme}.png`) });
      }
      await main.evaluate(() => window.desktop.preferences({ theme: 'light' }));
      await main.waitForFunction(() => document.documentElement.dataset.theme === 'light');
    }
    if (plugin !== plugins.at(-1)) {
      await center().getByRole('button', { name: 'All plugins', exact: true }).click();
      await center().getByRole('tab', { name: /^Discover/ }).click();
    }
  }
  checks.push('real local Git marketplace and UI install immediately project all plugin shortcuts without reloading or replacing the session');

  await center().getByRole('button', { name: 'Back to conversation', exact: true }).click();
  await composer.waitFor();
  assert.equal(await composer.innerText(), 'KEEP THE REAL DESKTOP DRAFT');
  assert.ok(Math.abs(await conversation.evaluate(element => element.scrollTop) - reading) < 4);
  await main.getByRole('button', { name: 'Plugin marketplace', exact: true }).click();
  const allPlugins = center().getByRole('button', { name: 'All plugins', exact: true });
  if (await allPlugins.isVisible()) await allPlugins.click();
  await center().getByRole('textbox', { name: 'Search plugins', exact: true }).fill('');
  await center().getByRole('tab', { name: /^Installed/ }).click();
  await center().getByRole('button', { name: `Read ${fixturePlugins[0].name} guide`, exact: true }).click();
  await center().getByRole('button', { name: 'Open Main Surface', exact: true }).click();
  const mainSpace = workspaceFor(fixturePlugins[0]);
  await mainSpace.getByRole('heading', { name: 'Main Surface start', exact: true }).waitFor();
  assert.equal(await main.locator('main:visible').count(), 1);
  await mainSpace.getByRole('tab', { name: 'Connection', exact: true }).click();
  await mainSpace.getByRole('heading', { name: 'Main Surface connection', exact: true }).waitFor();
  await mainSpace.getByRole('tabpanel').evaluate(element => { element.scrollTop = 440; });
  await mainSpace.getByRole('button', { name: 'Back to workspace', exact: true }).click();
  await composer.waitFor();
  assert.equal(await composer.innerText(), 'KEEP THE REAL DESKTOP DRAFT');
  assert.ok(Math.abs(await conversation.evaluate(element => element.scrollTop) - reading) < 4);
  await openAction(fixturePlugins[0]);
  assert.equal(await mainSpace.getByRole('tab', { name: 'Connection', exact: true }).getAttribute('aria-selected'), 'true');
  assert.ok(await mainSpace.getByRole('tabpanel').evaluate(element => element.scrollTop) > 400);
  await mainSpace.getByRole('tab', { name: 'Connection', exact: true }).focus();
  await openAction(fixturePlugins[0]);
  await composer.waitFor();
  await main.waitForFunction(() => document.activeElement?.getAttribute('data-plugin-action') === 'a-surface-main');
  await openAction(fixturePlugins[0]);
  await main.waitForFunction(() => document.activeElement?.getAttribute('role') === 'tab'
    && document.activeElement.textContent === 'Connection');
  assert.ok(await mainSpace.getByRole('tabpanel').evaluate(element => element.scrollTop) > 400);
  await mainSpace.getByRole('button', { name: 'Plugin settings', exact: true }).click();
  await configRoute(fixturePlugins[0]);
  checks.push('installed detail opens the actual main workspace; real draft, transcript position and plugin tab/scroll survive; settings target the exact installed config tab');

  await openAction(fixturePlugins[1]);
  const side = workspaceFor(fixturePlugins[1]);
  await side.getByRole('heading', { name: 'Side Surface start', exact: true }).waitFor();
  assert.equal(await composer.innerText(), 'KEEP THE REAL DESKTOP DRAFT');
  await main.getByRole('button', { name: 'Context', exact: true }).click();
  await side.waitFor({ state: 'hidden' });
  await openAction(fixturePlugins[1]);
  await main.keyboard.press('Escape');
  await side.waitFor({ state: 'hidden' });
  await main.waitForFunction(() => document.activeElement?.getAttribute('data-plugin-action') === 'surface-side');
  await openAction(fixturePlugins[1]);
  await side.getByRole('button', { name: 'Close panel', exact: true }).click();
  await side.waitFor({ state: 'hidden' });
  await main.waitForFunction(() => document.activeElement?.getAttribute('data-plugin-action') === 'surface-side');
  checks.push('production side panel coexists with the selected conversation, yields to official right tools and restores its titlebar opener on Escape or explicit close');

  const overflowPlugin = fixturePlugins[3];
  await main.getByRole('button', { name: 'More plugins', exact: true }).click();
  await main.getByRole('menuitemradio', { name: overflowPlugin.title, exact: true }).focus();
  await main.keyboard.press('Enter');
  const overflowSpace = workspaceFor(overflowPlugin);
  await overflowSpace.getByRole('heading', { name: 'Overflow Surface start', exact: true }).waitFor();
  await main.waitForFunction(() => document.activeElement?.closest('[data-plugin-workspace="z-surface-overflow"]')
    && document.activeElement.getAttribute('role') === 'tab');
  await overflowSpace.getByRole('button', { name: 'Back to workspace', exact: true }).click();
  await composer.waitFor();
  await main.waitForFunction(() => document.activeElement?.classList.contains('plugin-action-overflow'));
  assert.equal(await composer.innerText(), 'KEEP THE REAL DESKTOP DRAFT');
  for (const theme of ['light', 'dark']) {
    await main.evaluate(theme => window.desktop.preferences({ theme }), theme);
    await main.waitForFunction(theme => document.documentElement.dataset.theme === theme, theme);
    await openAction(fixturePlugins[0]);
    await settleLayout(mainSpace);
    await main.screenshot({ path: join(output, `main-${theme}.png`) });
    await openAction(fixturePlugins[0]);
    await openAction(fixturePlugins[1]);
    await app.evaluate(({ BrowserWindow }, mainId) => BrowserWindow.fromId(mainId).setSize(900, 780), mainId);
    await settleLayout(side);
    assert.ok(await main.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    for (const name of ['Plugin settings', 'Close panel']) {
      const box = await side.getByRole('button', { name, exact: true }).boundingBox();
      assert.ok(box && box.x >= 0 && box.x + box.width <= 900, `${name}: narrow controls remain inside the window`);
    }
    await main.screenshot({ path: join(output, `side-narrow-${theme}.png`) });
    await side.getByRole('button', { name: 'Close panel', exact: true }).click();
    await app.evaluate(({ BrowserWindow }, mainId) => BrowserWindow.fromId(mainId).setSize(1440, 940), mainId);
  }
  await main.evaluate(() => window.desktop.preferences({ theme: 'light' }));
  checks.push('keyboard overflow selection transfers focus into the workspace and returning restores the overflow trigger without changing the draft');

  if (hermes) {
    if (hermes.metadata.desktop.connection) {
      const beforeStatus = await main.locator('main:visible').evaluate(element => element.innerText);
      await openAction(hermes);
      await statusFor(hermes).getByRole('heading', { name: 'No profile selected', exact: true }).waitFor();
      assert.equal(await main.locator('main:visible').evaluate(element => element.innerText), beforeStatus,
        'Hermes status entry does not navigate the main surface');
      await main.screenshot({ path: join(output, 'hermes-status-unselected.png') });
      await statusFor(hermes).getByRole('button', { name: 'Open full workspace', exact: true }).click();
    } else await openAction(hermes);
    const guide = workspaceFor(hermes);
    await guide.getByRole('heading', { name: hermes.title, exact: true, level: 1 }).waitFor();
    assert.equal(await guide.getByRole('tab').count(), hermes.metadata.desktop.connection ? 5 : 4);
    await assertHermesIcon(guide.locator('.plugin-action-icon img:visible'), 'workspace', 24);
    if (hermes.metadata.desktop.connection) {
      await guide.getByRole('heading', { name: 'No profile selected', exact: true }).waitFor();
      await main.screenshot({ path: join(output, 'hermes-connection-unselected.png') });
      await guide.getByRole('tab', { name: hermes.metadata.desktop.pages[0].title, exact: true }).click();
    }
    await guide.locator('.pc-document-markdown h1, .pc-document-markdown h2').first().waitFor();
    await settleLayout(guide);
    await main.screenshot({ path: join(output, 'hermes-main-light.png') });
    await captureHermesAction('light');
    await main.evaluate(() => window.desktop.preferences({ theme: 'dark' }));
    await main.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
    await settleLayout(guide);
    await assertHermesIcon(guide.locator('.plugin-action-icon img:visible'), 'workspace', 24);
    await main.screenshot({ path: join(output, 'hermes-main-dark.png') });
    await captureHermesAction('dark');
    await app.evaluate(({ BrowserWindow }, mainId) => BrowserWindow.fromId(mainId).setSize(900, 780), mainId);
    await settleLayout(guide);
    assert.ok(await main.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await assertHermesIcon(guide.locator('.plugin-action-icon img:visible'), 'workspace-narrow', 24);
    await main.screenshot({ path: join(output, 'hermes-main-narrow.png') });
    await captureHermesAction('narrow-dark');
    await main.evaluate(() => window.desktop.preferences({ theme: 'light' }));
    await main.waitForFunction(() => document.documentElement.dataset.theme === 'light');
    await settleLayout(guide);
    await assertHermesIcon(guide.locator('.plugin-action-icon img:visible'), 'workspace-narrow', 24);
    await main.screenshot({ path: join(output, 'hermes-main-narrow-light.png') });
    await captureHermesAction('narrow-light');
    await app.evaluate(({ BrowserWindow }, mainId) => BrowserWindow.fromId(mainId).setSize(1440, 940), mainId);
    await main.evaluate(() => window.desktop.preferences({ theme: 'light' }));
    checks.push('the actual optional Hermes package renders all four onboarding tabs and its decoded custom icon in light, dark and narrow production screenshots');
  }

  const nativeOpened = app.waitForEvent('window');
  await openAction(fixturePlugins[2]);
  if (await action(fixturePlugins[2]).isVisible()) {
    assert.equal(await action(fixturePlugins[2]).getAttribute('aria-pressed'), null,
      'a native window launcher is not announced as a main-view toggle');
  } else {
    await main.getByRole('button', { name: 'More plugins', exact: true }).click();
    const launcher = main.getByRole('menuitemradio', { name: fixturePlugins[2].title, exact: true });
    assert.equal(await launcher.getAttribute('aria-checked'), 'false', 'a native launcher is not the selected main workspace');
    await main.keyboard.press('Escape');
  }
  await nativeOpened;
  native = await nativePage(fixturePlugins[2].title);
  native.setDefaultTimeout(30000);
  native.on('pageerror', error => errors.push(error.message));
  await app.evaluate(({ BrowserWindow }) => {
    const view = BrowserWindow.getAllWindows().find(view => view.getTitle() === 'Window Surface');
    view.setOpacity(0); view.setIgnoreMouseEvents(true); view.showInactive();
  });
  await native.getByRole('heading', { name: 'Window Surface start', exact: true }).waitFor();
  assert.equal(await native.evaluate(() => window.desktop.surface), 'plugin');
  assert.equal(await native.evaluate(() => typeof window.require), 'undefined');
  const nativeId = await (await app.browserWindow(native)).evaluate(view => view.id);
  const webPreferences = await (await app.browserWindow(native)).evaluate(view => {
    const preferences = view.webContents.getLastWebPreferences();
    return { nodeIntegration: preferences.nodeIntegration, contextIsolation: preferences.contextIsolation, sandbox: preferences.sandbox };
  });
  assert.deepEqual(webPreferences, { nodeIntegration: false, contextIsolation: true, sandbox: true });
  await openAction(fixturePlugins[2]);
  assert.equal(await (await app.browserWindow(await nativePage('Window Surface'))).evaluate(view => view.id), nativeId);
  const state = await native.evaluate(() => window.desktop.pluginWindowState());
  const other = await installed(fixturePlugins[0].id);
  for (const invoke of [
    () => window.desktop.snapshot(),
    () => window.desktop.command('prompt', { message: 'MUST NOT SEND' }),
    () => window.desktop.preferences({ language: 'zh' }),
    () => window.desktop.capabilityMutate({ action: 'plugin-remove', id: 'a-surface-main' }),
    () => window.desktop.browserList(),
    () => window.desktop.pluginConnectionState({ ref: 'any-package' }),
    () => window.desktop.pluginConnectionChooseProfile({ ref: 'any-package' }),
    () => window.desktop.pluginConnectionForgetProfile({ ref: 'any-package' }),
  ]) await assert.rejects(native.evaluate(invoke), /capability:invalid-input/);
  await assert.rejects(native.evaluate(ref => window.desktop.pluginDocument({ ref, path: 'docs/start.md' }), other.package.ref),
    /capability:invalid-input/);
  await assert.rejects(native.evaluate(ref => window.desktop.pluginDocument({ ref, path: 'private.md' }), state.plugin.package.ref),
    /capability:invalid-path/);
  await native.getByRole('button', { name: 'Plugin settings', exact: true }).click();
  await configRoute(fixturePlugins[2]);
  await native.getByRole('button', { name: 'Read connection preparation', exact: true }).click();
  await native.getByRole('heading', { name: 'Window Surface connection', exact: true }).waitFor();
  await main.evaluate(() => window.desktop.preferences({ theme: 'dark' }));
  await native.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
  await settleLayout(native.locator('.app'));
  assert.equal(await native.getByRole('button', { name: 'Previous document', exact: true }).count(), 1);
  await native.screenshot({ path: join(output, 'native-window-dark.png') });
  checks.push('full production main opens and reuses the sandboxed native renderer; narrow IPC denies conversations, prompts, preferences, mutations, browser and foreign/private documents; settings route and preference refresh remain isolated');
  const explicitlyClosed = native.waitForEvent('close');
  await native.getByRole('button', { name: 'Close plugin window', exact: true }).click();
  await explicitlyClosed;
  assert.ok(await app.evaluate(({ BrowserWindow }, id) => !BrowserWindow.fromId(id).isDestroyed(), mainId));
  const reopened = app.waitForEvent('window');
  await openAction(fixturePlugins[2]);
  native = await reopened;
  native.setDefaultTimeout(30000);
  native.on('pageerror', error => errors.push(error.message));
  await native.getByRole('heading', { name: 'Window Surface start', exact: true }).waitFor();
  checks.push('the visible close-window action closes only the plugin renderer and its entry can open a fresh isolated window');

  await writePlugin(fixturePlugins[2], '0.2.0');
  commit('Update the isolated window guide');
  const marketName = (await catalog()).available.find(plugin => plugin.name === 'surface-window').marketplace;
  const updatedMarket = await mutate({ action: 'marketplace-update', name: marketName });
  assert.deepEqual(updatedMarket.warnings, []);
  await mutate({ action: 'plugin-check-updates' });
  const candidate = await installed('surface-window');
  assert.equal(candidate.update?.status, 'available');
  assert.equal(candidate.update.version, '0.2.0');
  const oldRef = candidate.package.ref;
  await mutate({ action: 'plugin-update', id: candidate.id, ref: oldRef, candidate: candidate.update.ref });
  await native.getByRole('heading', { name: 'Plugin unavailable', exact: true }).waitFor();
  assert.equal(await native.locator('[data-plugin-workspace]').count(), 0);
  await assert.rejects(main.evaluate(ref => window.desktop.pluginDocument({ ref, path: 'docs/start.md' }), oldRef),
    /capability:stale/);
  const replacementOpened = app.waitForEvent('window');
  await openAction(fixturePlugins[2]);
  const replacement = await replacementOpened;
  await replacement.getByRole('heading', { name: 'Window Surface start', exact: true }).waitFor();
  if (!native.isClosed()) await native.waitForEvent('close');
  native = replacement;
  native.on('pageerror', error => errors.push(error.message));
  const replacementState = await native.evaluate(() => window.desktop.pluginWindowState());
  assert.equal(replacementState.plugin.version, '0.2.0');
  assert.notEqual(replacementState.plugin.package.ref, oldRef);
  assert.ok((await native.locator('[data-plugin-workspace]').innerText()).includes('Version 0.2.0'));
  assert.equal((await main.evaluate(() => window.desktop.snapshot())).runtimeId, before.runtimeId);
  checks.push('real Git marketplace refresh and plugin update invalidate old refs, clear the stale native workspace and replace it with the new package without changing the selected runtime');

  const removedRef = replacementState.plugin.package.ref;
  await mutate({ action: 'plugin-remove', id: 'surface-window' });
  await native.getByRole('heading', { name: 'Plugin unavailable', exact: true }).waitFor();
  await action(fixturePlugins[2]).waitFor({ state: 'detached' });
  await assert.rejects(main.evaluate(ref => window.desktop.pluginDocument({ ref, path: 'docs/start.md' }), removedRef),
    /capability:stale/);
  await assert.rejects(native.evaluate(() => window.desktop.pluginWindowState()), /capability:stale/);
  const closed = native.waitForEvent('close');
  await native.evaluate(() => { void window.desktop.windowControl('close'); });
  await closed;
  assert.ok(await app.evaluate(({ BrowserWindow }, id) => !BrowserWindow.fromId(id).isDestroyed(), mainId));
  checks.push('real uninstall removes the shortcut, rejects old package/state reads, clears native content and still permits closing only the plugin window');

  const bridgePlugin = fixturePlugins[3];
  await writePlugin(bridgePlugin, '0.2.0', true);
  commit('Declare a read-only Agent Bridge connection');
  await mutate({ action: 'marketplace-update', name: marketName });
  await mutate({ action: 'plugin-check-updates' });
  const originalBridgePlugin = await installed(bridgePlugin.id);
  await mutate({ action: 'plugin-update', id: bridgePlugin.id, ref: originalBridgePlugin.package.ref, candidate: originalBridgePlugin.update.ref });
  await waitWorkspaceVersion(bridgePlugin, '0.2.0');
  if (!await workspaceFor(bridgePlugin).isVisible()) await openFullAction(bridgePlugin);
  const bridgeSpace = workspaceFor(bridgePlugin), panel = bridgeSpace.locator('.plugin-connection');
  await panel.getByRole('heading', { name: 'No profile selected', exact: true }).waitFor();
  assert.equal(bridgeRequests.length, 0, 'no selected profile means no credential reads or transport calls');
  const plainPlugin = await installed(fixturePlugins[0].id);
  await assert.rejects(main.evaluate(ref => window.desktop.pluginConnectionState({ ref }), plainPlugin.package.ref), /capability:invalid-input/);
  await app.evaluate(({ dialog }) => {
    globalThis.originalPluginProfileDialog = dialog.showOpenDialog;
    dialog.showOpenDialog = async () => ({ canceled: true, filePaths: [] });
  });
  await panel.getByRole('button', { name: 'Choose profile', exact: true }).click();
  await panel.getByRole('heading', { name: 'No profile selected', exact: true }).waitFor();
  assert.equal(bridgeRequests.length, 0);
  await app.evaluate(({ dialog }, selected) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selected] });
  }, agentProfile);
  await panel.getByRole('button', { name: 'Choose profile', exact: true }).click();
  await panel.getByRole('heading', { name: 'Read-only connection verified', exact: true }).waitFor();
  assert.ok((await panel.innerText()).includes('visible-task'));
  for (const secret of [bridgeToken, 'marker-secret-never-read', 'private-transcript-never-read', 'foreign-task'])
    assert.ok(!(await panel.innerText()).includes(secret));
  assert.deepEqual(bridgeRequests, ['system.capabilities', 'task.list']);
  const binding = await readFile(join(root, 'desktop-plugins/bridge-profiles.json'), 'utf8');
  assert.ok(!binding.includes(bridgeToken));
  assert.ok(Object.values(JSON.parse(binding)).includes(agentProfile));
  for (const theme of ['light', 'dark']) {
    await main.evaluate(theme => window.desktop.preferences({ theme }), theme);
    await main.waitForFunction(theme => document.documentElement.dataset.theme === theme, theme);
    await panel.getByRole('button', { name: 'Check again', exact: true }).focus();
    await settleLayout(panel);
    await main.screenshot({ path: join(output, `connection-${theme}.png`) });
  }
  bridgeIdentity = 'other';
  await panel.getByRole('button', { name: 'Check again', exact: true }).click();
  await panel.getByRole('heading', { name: 'Agent identity mismatch', exact: true }).waitFor();
  assert.ok(!(await panel.innerText()).includes('visible-task'));
  bridgeIdentity = 'fixture-agent'; bridgeRoots = [];
  await panel.getByRole('button', { name: 'Check again', exact: true }).click();
  await panel.getByRole('heading', { name: 'Read-only connection verified', exact: true }).waitFor();
  assert.ok((await panel.innerText()).includes('No authorized directories'));
  assert.ok(!(await panel.innerText()).includes('visible-task'));
  await panel.getByRole('button', { name: 'Forget selection', exact: true }).click();
  await panel.getByRole('heading', { name: 'No profile selected', exact: true }).waitFor();
  assert.equal(await readFile(descriptorFile, 'utf8'), originalDescriptor, 'forgetting never changes pairing credentials');
  bridgeRoots = [workspace];
  await panel.getByRole('button', { name: 'Choose profile', exact: true }).click();
  await panel.getByRole('heading', { name: 'Read-only connection verified', exact: true }).waitFor();
  checks.push('production read-only connection uses only explicit native profile choice; cancel, identity/root filtering, redaction and forgetting preserve pairing files');
  await bridgeSpace.getByRole('button', { name: 'Back to workspace', exact: true }).click();
  await composer.waitFor();
  const draftBeforeStatus = await composer.innerText();
  const readingBeforeStatus = await conversation.evaluate(element => element.scrollTop);
  await openAction(bridgePlugin);
  const quickStatus = statusFor(bridgePlugin);
  await quickStatus.getByRole('heading', { name: 'Read-only connection verified', exact: true }).waitFor();
  assert.ok((await quickStatus.innerText()).includes('visible-task'));
  assert.equal(await composer.innerText(), draftBeforeStatus);
  assert.ok(Math.abs(await conversation.evaluate(element => element.scrollTop) - readingBeforeStatus) < 4);
  assert.equal(await bridgeSpace.isVisible(), false);
  await main.screenshot({ path: join(output, 'connection-status-overflow.png') });
  await main.keyboard.press('Escape');
  await quickStatus.waitFor({ state: 'hidden' });
  await main.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === 'More plugins');
  await openFullAction(bridgePlugin);
  await panel.getByRole('heading', { name: 'Read-only connection verified', exact: true }).waitFor();
  checks.push('production titlebar status reads the real isolated Bridge without changing main navigation, draft or transcript position; Escape restores its overflow anchor and full page opens explicitly');

  await writePlugin(bridgePlugin, '0.3.0', true);
  commit('Update the read-only connection package');
  await mutate({ action: 'marketplace-update', name: marketName });
  await mutate({ action: 'plugin-check-updates' });
  const bridgeUpdate = await installed(bridgePlugin.id);
  let releaseBridge;
  bridgeGate = new Promise(resolve => { releaseBridge = resolve; });
  const entered = new Promise(resolve => { bridgeEntered = resolve; });
  const inFlight = main.evaluate(ref => window.desktop.pluginConnectionState({ ref }), bridgeUpdate.package.ref);
  // Keep this rejection observed while the real installed-package update invalidates its reference.
  const observed = inFlight.then(() => 'unexpected-success', error => String(error));
  await entered;
  await mutate({ action: 'plugin-update', id: bridgePlugin.id, ref: bridgeUpdate.package.ref, candidate: bridgeUpdate.update.ref });
  await waitWorkspaceVersion(bridgePlugin, '0.3.0');
  bridgeGate = undefined; releaseBridge();
  assert.match(await observed, /capability:stale/);
  if (!await bridgeSpace.isVisible()) await openFullAction(bridgePlugin);
  await panel.getByRole('heading', { name: 'No profile selected', exact: true }).waitFor();
  assert.ok(!(await panel.innerText()).includes('visible-task'), 'updated package does not inherit old scope or in-flight data');
  const removeBridgeRef = (await installed(bridgePlugin.id)).package.ref;
  await mutate({ action: 'plugin-remove', id: bridgePlugin.id });
  await assert.rejects(main.evaluate(ref => window.desktop.pluginConnectionState({ ref }), removeBridgeRef), /capability:stale/);
  checks.push('package update invalidates in-flight connection IPC and saved scope; uninstall rejects old connection references');
  if (hermes) {
    if (hermes.metadata.desktop.connection) await openFullAction(hermes);
    else await openAction(hermes);
    if (hermes.metadata.desktop.connection) {
      const guide = workspaceFor(hermes);
      await guide.getByRole('tab', { name: 'Connection', exact: true }).click();
      await guide.getByRole('heading', { name: 'No profile selected', exact: true }).waitFor();
      await guide.getByRole('button', { name: 'Choose profile', exact: true }).click();
      await guide.getByRole('heading', { name: 'Read-only connection verified', exact: true }).waitFor();
      assert.ok((await guide.innerText()).includes('visible-task'));
      assert.ok(!(await guide.innerText()).includes(bridgeToken));
      checks.push('the actual Hermes source package verifies the isolated read-only connection and renders scoped task summaries with its approved theme icons');
    }
    for (const theme of ['light', 'dark']) {
      await main.evaluate(theme => window.desktop.preferences({ theme }), theme);
      await main.waitForFunction(theme => document.documentElement.dataset.theme === theme, theme);
      await settleLayout(workspaceFor(hermes));
      await assertHermesIcon(action(hermes).locator('.plugin-action-icon img:visible'), 'toolbar-direct', 17);
      await main.screenshot({ path: join(output, `hermes-toolbar-direct-${theme}.png`) });
    }
    if (hermes.metadata.desktop.connection) {
      await workspaceFor(hermes).getByRole('button', { name: 'Back to workspace', exact: true }).click();
      await composer.waitFor();
      for (const theme of ['light', 'dark']) {
        await main.evaluate(theme => window.desktop.preferences({ theme }), theme);
        await main.waitForFunction(theme => document.documentElement.dataset.theme === theme, theme);
        await openAction(hermes);
        const quick = statusFor(hermes);
        await quick.getByRole('heading', { name: 'Read-only connection verified', exact: true }).waitFor();
        assert.ok((await quick.innerText()).includes('visible-task'));
        assert.equal(await workspaceFor(hermes).isVisible(), false);
        await assertHermesIcon(action(hermes).locator('.plugin-action-icon img:visible'), 'toolbar-direct', 17);
        await settleLayout(quick);
        await main.screenshot({ path: join(output, `hermes-status-${theme}.png`) });
        await main.keyboard.press('Escape');
        await quick.waitFor({ state: 'hidden' });
      }
      checks.push('actual Hermes approved titlebar icon opens the compact connected Agent status in both themes while leaving the conversation visible');
    }
    for (const surface of ['market-detail', 'toolbar-direct', 'toolbar-overflow', 'workspace'])
      for (const theme of ['light', 'dark'])
        assert.ok(iconChecks.some(icon => icon.surface === surface && icon.theme === theme),
          `${surface}: the exact new avatar is checked in ${theme} theme`);
    checks.push('the approved portrait bytes match marketplace catalog/detail; exact separate theme toolbar assets match overflow/direct and workspace at their real sizes');
  }
  await app.evaluate(({ dialog }) => { dialog.showOpenDialog = globalThis.originalPluginProfileDialog; });
  assert.equal(inferenceRequests, 0, 'No fixture or remote inference is invoked');
  assert.deepEqual(errors, []);
  verified = true;
} catch (error) {
  console.error('Full plugin surface acceptance failed:', error);
  for (const [index, page] of (app?.windows() ?? []).entries()) {
    await page.screenshot({ path: join(output, `failure-${index}.png`) }).catch(() => {});
    console.error(`window ${index}`, await page.locator('body').innerText().catch(() => ''), errors);
  }
  throw error;
} finally {
  try {
    if (app) {
      const child = app.process();
      await closeDesktopFixtureAndWait(app);
      assert.equal(child.exitCode, 0, 'The isolated Desktop launcher exits successfully');
      assert.equal(app.windows().length, 0, 'All fixture windows close before cleanup is confirmed');
      shutdown = { launcherExitCode: child.exitCode, windows: app.windows().length, confirmed: true };
    }
  } finally {
    transport.closeAllConnections();
    await new Promise(resolve => transport.close(resolve));
    for (const socket of bridgeSockets) socket.destroy();
    await new Promise(resolve => bridgeServer.close(resolve));
    await writeFile(join(output, 'verification.json'), JSON.stringify({
      profile, checks, errors, inferenceRequests, bridgeRequests, shutdown,
      scope: 'Full production Desktop main/preload/renderer, capability service, real staged runtime, isolated profile and local Git marketplace. No model inference.',
      hermes: hermes ? { id: hermes.id, title: hermes.title, pages: hermes.metadata.desktop.pages.length,
        icon: { sha256: hermes.icon.sha256, bytes: hermes.icon.bytes, width: hermes.icon.width, height: hermes.icon.height },
        toolbar: Object.fromEntries(Object.entries(hermes.toolbar).map(([theme, { dataUrl, ...asset }]) => [theme, asset])),
        iconChecks } : null,
      passed: verified && errors.length === 0 && inferenceRequests === 0 && shutdown?.confirmed === true,
    }, null, 2));
  }
}
console.log(JSON.stringify({ output, profile, checks: checks.length, passed: true, shutdown }, null, 2));
