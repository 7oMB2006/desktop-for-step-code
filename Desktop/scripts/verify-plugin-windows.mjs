import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { build } from 'esbuild';
import { _electron as electron } from 'playwright';
import { closeDesktopFixtureAndWait } from './close-desktop-fixture.mjs';

const approved = await realpath('D:/DFSC-Preview-QA');
assert.equal(resolve(approved).slice(0, 3).toLowerCase(), 'd:\\', 'Native fixture artifacts must stay on D:');
const output = await realpath(await mkdtemp(join(approved, 'plugin-windows-')));
assert.ok(relative(approved, output) && !relative(approved, output).startsWith('..'));
const profile = join(output, 'profile');
await mkdir(profile);
await Promise.all([
  build({ entryPoints: ['tests/fixtures/plugin-window-native-main.ts'], outfile: join(output, 'main.cjs'),
    bundle: true, platform: 'node', format: 'cjs', external: ['electron'] }),
  build({ entryPoints: ['electron/preload.ts'], outfile: join(output, 'preload.cjs'),
    bundle: true, platform: 'node', format: 'cjs', external: ['electron'] }),
  cp('tests/fixtures/plugin-window-native.html', join(output, 'plugin-window-native.html')),
]);
const mainSource = await readFile('electron/main.ts', 'utf8');
assert.match(mainSource, /const pluginOwner = pluginWindows\?\.owner\(event\)/u);
assert.match(mainSource, /pluginWindowMethodAllowed\(method, args, pluginOwner\.ref\)/u);
assert.match(mainSource, /capabilityService\.desktop\(pluginOwner\.ref\)/u);
assert.match(mainSource, /pluginOwner[\s\S]+?method === 'pluginWindowState'/u);
const env = { ...process.env, DESKTOP_TEST_USER_DATA: profile, DESKTOP_PLUGIN_NATIVE_ROOT: output };
delete env.ELECTRON_RUN_AS_NODE;
const checks = [], errors = [];
let app;
try {
  app = await electron.launch({ args: [join(output, 'main.cjs'), '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding', '--disable-features=CalculateNativeWinOcclusion'],
    env, timeout: 60000 });
  await app.firstWindow();
  const call = (method, args = []) => app.evaluate(async (_, { method, args }) =>
    globalThis.pluginWindowNative[method](...args), { method, args });
  const pageFor = async title => {
    for (const page of app.windows()) {
      const view = await app.browserWindow(page);
      if (await view.evaluate(view => view.getTitle()) === title) return page;
    }
    throw new Error(`Native fixture window missing: ${title}`);
  };
  const waitForNativeClose = id => app.evaluate(async ({ BrowserWindow }, id) => {
    const view = BrowserWindow.fromId(id);
    if (view && !view.isDestroyed()) await new Promise(resolve => view.once('closed', resolve));
  }, id);
  const id = await call('open', ['one']);
  let plugin = await pageFor('Native plugin one');
  plugin.on('pageerror', error => errors.push(error.message));
  await plugin.waitForFunction(() => document.body.dataset.state === 'ready');
  assert.equal(await plugin.evaluate(() => window.desktop.surface), 'plugin');
  assert.equal(await plugin.evaluate(() => typeof window.require), 'undefined');
  let stats = await call('stats');
  assert.deepEqual(stats.windows.map(view => [view.nodeIntegration, view.contextIsolation, view.sandbox]), [[false, true, true]]);
  assert.equal(stats.documentReads, 1);
  assert.equal(stats.configurationRequests, 0);
  assert.equal(await call('open', ['one']), id);
  assert.equal((await call('stats')).windows.length, 1);
  checks.push('production window manager reuses one isolated window per plugin; no task or configuration action on first load');
  const deniedCalls = [
    () => window.desktop.snapshot(),
    () => window.desktop.command('prompt', { message: 'must-not-run' }),
    () => window.desktop.capabilityMutate({ action: 'plugin-remove', id: 'one' }),
    () => window.desktop.pluginDocument({ ref: 'other-plugin', path: 'guide.md' }),
    () => window.desktop.pluginWindowOpen({ ref: window.fixtureRef }),
    () => window.desktop.preferences({ language: 'zh' }),
  ];
  for (const invoke of deniedCalls)
    await assert.rejects(plugin.evaluate(invoke), /capability:invalid-input/u);
  await assert.rejects(plugin.evaluate(() => window.desktop.pluginDocument({ ref: window.fixtureRef, path: 'private.md' })),
    /capability:invalid-path/u);
  checks.push('real production preload reaches only the production owner-ref method policy; snapshot/command/mutation/cross-plugin reads denied');
  await plugin.locator('#configure').click();
  assert.equal((await call('stats')).configurationRequests, 1);
  await call('broadcast', ['desktop_credentials']);
  await call('broadcast', ['desktop_system_theme', 'truthy']);
  await call('broadcast', ['desktop_plugin_preferences_changed']);
  await call('broadcast', ['desktop_plugin_catalog_changed']);
  await call('background');
  await plugin.waitForFunction(() => window.fixtureEvents.includes('desktop_system_theme'));
  await plugin.waitForFunction(() => window.fixtureEvents.includes('desktop_plugin_preferences_changed'));
  await plugin.waitForFunction(() => window.fixtureEvents.includes('desktop_plugin_catalog_changed'));
  assert.ok(!(await plugin.evaluate(() => window.fixtureEvents)).includes('desktop_credentials'));
  const messages = await plugin.evaluate(() => window.fixtureMessages);
  assert.ok(messages.every(message => !('secret' in message)));
  assert.deepEqual(messages.find(message => message.type === 'desktop_system_theme'), { type: 'desktop_system_theme', dark: true });
  assert.deepEqual(messages.find(message => message.type === 'desktop_plugin_preferences_changed'), { type: 'desktop_plugin_preferences_changed' });
  assert.deepEqual(messages.find(message => message.type === 'desktop_plugin_catalog_changed'), { type: 'desktop_plugin_catalog_changed' });
  checks.push('configuration uses its dedicated action; allowlisted events expose only projected fields and exclude arbitrary secrets');
  const beforeUrl = plugin.url();
  await plugin.locator('#external').click();
  await plugin.locator('#insecure').click();
  await plugin.locator('#credentials').click();
  await plugin.locator('#navigate').click({ noWaitAfter: true });
  await plugin.evaluate(() => window.open('file:///C:/private.txt'));
  assert.equal(plugin.url(), beforeUrl);
  stats = await call('stats');
  assert.equal(stats.windows.length, 1);
  assert.deepEqual(stats.network, []);
  assert.deepEqual(stats.external, ['https://example.com/guide']);
  checks.push('navigation and renderer popups blocked; only credential-free HTTPS reaches mocked external browser opener');
  const mainId = stats.mainId;
  await plugin.evaluate(() => window.desktop.windowControl('toggleMaximize'));
  await plugin.waitForFunction(() => window.fixtureEvents.includes('desktop_window_state'));
  assert.equal(await plugin.evaluate(async () => (await window.desktop.windowControl('state')).maximized), true);
  await plugin.evaluate(() => window.desktop.windowControl('toggleMaximize'));
  assert.equal(await plugin.evaluate(async () => (await window.desktop.windowControl('state')).maximized), false);
  await plugin.evaluate(() => window.desktop.windowControl('minimize'));
  assert.ok((await call('stats')).windows.find(view => view.id === id).minimized);
  assert.equal((await call('stats')).mainAlive, true);
  await call('open', ['one']);
  await call('invalidate');
  await plugin.waitForFunction(() => document.body.dataset.state === 'stale');
  assert.equal(await plugin.locator('#document').textContent(), '');
  await assert.rejects(plugin.evaluate(() => window.desktop.pluginDocument({ ref: window.fixtureRef, path: 'guide.md' })),
    /capability:stale/u);
  const replacementId = await call('open', ['one', 'native-one-replaced']);
  assert.notEqual(replacementId, id);
  if (!plugin.isClosed()) await plugin.waitForEvent('close');
  plugin = await pageFor('Native plugin one');
  await plugin.waitForFunction(() => document.body.dataset.state === 'ready');
  assert.equal(await plugin.evaluate(() => window.fixtureRef), 'native-one-replaced');
  checks.push('stale invalidation clears fixture content and old reads fail; a new package reference replaces the old native window');
  const closed = plugin.waitForEvent('close');
  await plugin.evaluate(() => { void window.desktop.windowControl('close'); });
  await closed;
  await waitForNativeClose(replacementId);
  assert.equal((await call('stats')).windows.length, 0);
  assert.equal((await call('stats')).mainId, mainId);
  assert.equal((await call('stats')).mainAlive, true);
  checks.push('plugin minimize and close operate independently from the main window');
  for (let index = 1; index <= 8; index++) await call('open', [`limit-${index}`]);
  await assert.rejects(call('open', ['limit-nine']), /capability:too-large/u);
  assert.equal((await call('stats')).windows.length, 8);
  const closeLimit = await pageFor('Native plugin limit-1');
  const closeLimitId = await (await app.browserWindow(closeLimit)).evaluate(view => view.id);
  await closeLimit.waitForFunction(() => document.body.dataset.state === 'ready');
  const limitClosed = closeLimit.waitForEvent('close');
  await closeLimit.evaluate(() => { void window.desktop.windowControl('close'); });
  await limitClosed;
  await waitForNativeClose(closeLimitId);
  await call('open', ['limit-nine']);
  assert.equal((await call('stats')).windows.length, 8);
  const failure = await call('failedLoad');
  assert.match(failure, /ERR_FILE_NOT_FOUND|FILE_NOT_FOUND/u);
  assert.equal((await call('stats')).windows.length, 8);
  checks.push('eight-window bound, closing frees a slot, and failed document load leaves no extra native window');
  assert.deepEqual(errors, []);
  await writeFile(join(output, 'verification.json'), JSON.stringify({
    scope: 'Isolated production PluginWindows + production preload + production owner-ref policy; fixture state/documents, not full Desktop runtime acceptance.',
    checks, errors, stats: await call('stats'), noAccounts: true, noRuntime: true, noRealExternalBrowser: true,
  }, null, 2));
  console.log(JSON.stringify({ output, checks: checks.length, passed: true }, null, 2));
} finally {
  if (app) await closeDesktopFixtureAndWait(app);
}
