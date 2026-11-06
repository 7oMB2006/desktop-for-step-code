import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startMcp } from './mcp-client.mjs';

const options = {};
for (let index = 2; index < process.argv.length; index += 2) {
  const key = process.argv[index], value = process.argv[index + 1];
  assert.ok(['--desktop', '--main', '--output'].includes(key) && !options[key] && isAbsolute(value ?? ''),
    'Use --desktop <Desktop directory> --main <existing built main.cjs> --output <new absolute directory>');
  options[key] = value;
}
assert.ok(options['--desktop'] && options['--main'] && options['--output']);
await access(join(dirname(options['--main']), 'runtime/capability-settings.mjs'));
const source = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = resolve(options['--output']);
await mkdir(output, { recursive: false });
const profile = join(output, 'profile'), root = join(profile, 'step-runtime');
await mkdir(root, { recursive: true });
await writeFile(join(profile, 'preferences.json'), JSON.stringify({ language: 'zh', theme: 'light', autoCheckUpdates: false }));
await writeFile(join(root, 'config.toml'), 'defaultProvider = "fixture"\ndefaultModel = "fixture"\n[telemetry]\nenabled = false\n');
await writeFile(join(root, 'models.json'), JSON.stringify({ providers: { fixture: {
  api: 'openai-completions', baseUrl: 'http://127.0.0.1:1/v1', apiKey: 'local-unused',
  models: [{ id: 'fixture', name: 'Offline verification', contextWindow: 32768, maxTokens: 1024 }],
} } }));
const require = createRequire(join(options['--desktop'], 'package.json'));
const { _electron: electron } = require('playwright');
const env = { ...process.env, DESKTOP_TEST_USER_DATA: profile, DESKTOP_TEST_NO_FOCUS: '1' };
delete env.ELECTRON_RUN_AS_NODE;
for (const key of Object.keys(env))
  if (/api.?key|token|secret|password|authorization|cookie/iu.test(key)) delete env[key];
const app = await electron.launch({
  args: [resolve(options['--main']), '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding'],
  cwd: dirname(options['--main']), env, timeout: 60000,
});
let client;
const errors = [], checks = [];
try {
  const page = await app.firstWindow();
  page.on('pageerror', error => errors.push(error.message));
  await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows().find(item => item.webContents.getURL().includes('index.html'));
    window.setOpacity(0); window.setIgnoreMouseEvents(true); window.showInactive();
    window.setSize(1440, 1000);
  });
  await page.waitForFunction(() => Boolean(window.desktop));
  await page.evaluate(async source => {
    await window.desktop.newIndependentSession();
    await window.desktop.capabilityMutate({ action: 'marketplace-add', source });
  }, source);
  const available = await page.evaluate(async () => (await window.desktop.capabilityCatalog()).available.find(item => item.name === 'text-workbench'));
  assert.equal(available.package.provenance, 'recorded');
  assert.equal(available.icon.kind, 'png');
  checks.push('actual native market discovery');
  await page.reload();
  await page.getByRole('button', { name: '插件市场', exact: true }).click();
  await page.getByRole('tab', { name: '发现', exact: true }).click();
  await page.getByLabel('搜索插件', { exact: true }).fill('文本整理台');
  await page.getByRole('button', { name: '查看 文本整理台 使用说明', exact: true }).waitFor();
  await page.screenshot({ path: join(output, '01-discovery.png'), animations: 'disabled' });
  await page.getByRole('button', { name: '安装', exact: true }).click();
  await page.getByLabel('清单标题', { exact: true }).waitFor();
  const pkg = await page.evaluate(async () => (await window.desktop.capabilityCatalog()).plugins.find(item => item.id === 'text-workbench').package);
  assert.equal(pkg.configurationAvailable, true);
  assert.equal(pkg.provenance, 'recorded');
  checks.push('actual native installation and generic configuration');
  await page.getByLabel('清单标题', { exact: true }).fill('验收清单');
  await page.getByLabel('最多输出条数', { exact: true }).fill('3');
  await page.getByRole('button', { name: '保存配置', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.pc-save-state')?.textContent.includes('已保存'));
  const configuration = await page.evaluate(ref => window.desktop.pluginConfiguration({ ref }), pkg.ref);
  assert.equal(configuration.values.heading, '验收清单');
  assert.equal(configuration.values.max_items, 3);
  checks.push('real form save with applied values');
  await page.screenshot({ path: join(output, '02-configuration.png'), animations: 'disabled' });
  await page.getByRole('tab', { name: '使用说明', exact: true }).click();
  await page.getByRole('heading', { name: '可以做什么', exact: true }).waitFor();
  await page.screenshot({ path: join(output, '03-guide.png'), animations: 'disabled' });
  const guide = await page.evaluate(ref => window.desktop.pluginDocument({ ref, path: 'docs/GUIDE.md' }), pkg.ref);
  assert.ok(Object.values(guide.links).includes('docs/SETTINGS.md'));
  await page.getByRole('button', { name: '配置说明', exact: true }).click();
  await page.getByRole('heading', { name: '配置说明', exact: true }).waitFor();
  checks.push('installed author guide and package-relative navigation');
  await page.getByRole('tab', { name: '更新记录', exact: true }).click();
  await page.getByRole('heading', { name: '0.1.0 · 本地示范', exact: true }).waitFor();
  await page.getByRole('tab', { name: '配置', exact: true }).click();
  await page.getByRole('button', { name: '重启当前会话', exact: true }).click();
  await page.waitForFunction(async () => {
    const state = await window.desktop.snapshot();
    if (!state.runtimeId) return false;
    const summary = await window.desktop.summary(state.runtimeId);
    return summary.mcp.some(server => server.name === 'text-workbench__text' && server.status === 'connected');
  }, undefined, { timeout: 45000 });
  checks.push('real runtime MCP connection after explicit restart');
  await page.waitForFunction(async () => {
    try {
      const commands = await window.desktop.command('get_commands');
      return commands.commands.some(command => command.name === 'tidy-text');
    } catch { return false; }
  }, undefined, { timeout: 30000 });
  const catalog = await page.evaluate(() => window.desktop.capabilityCatalog());
  assert.ok(catalog.skills.some(skill => skill.name === 'text-workbench' && skill.enabled));
  checks.push('actual command and skill resource loading');
  await page.getByRole('tab', { name: '能力', exact: true }).click();
  await page.screenshot({ path: join(output, '04-capabilities.png'), animations: 'disabled' });
  const installed = join(root, 'plugins/text-workbench');
  client = startMcp(installed);
  assert.ok((await client.request('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'acceptance', version: '1' } })).result);
  client.notify('notifications/initialized');
  assert.deepEqual((await client.request('tools/list')).result.tools.map(tool => tool.name), ['prepare_list', 'analyze_text']);
  const result = await client.request('tools/call', { name: 'prepare_list', arguments: { text: 'beta\nalpha\nbeta' } });
  assert.equal(result.result.content[0].text, '## 验收清单\n\n- beta\n- alpha');
  const stats = await client.request('tools/call', { name: 'analyze_text', arguments: { text: 'beta\nalpha\nbeta' } });
  assert.equal(JSON.parse(stats.result.content[0].text).repeatedLines, 1);
  checks.push('real installed stdio MCP calls, no model request');
  const changed = await page.evaluate(async ref => {
    const config = await window.desktop.pluginConfiguration({ ref });
    return window.desktop.pluginSaveConfiguration({ ref, revision: config.revision,
      values: { ...config.values, heading: '', style: 'numbered', max_items: 1, order: 'ascending' }, secrets: {} });
  }, pkg.ref);
  assert.notEqual(changed.revision, configuration.revision);
  const stale = await client.request('tools/call', { name: 'prepare_list', arguments: { text: 'beta\nalpha\nbeta' } });
  assert.equal(stale.result.isError, true);
  await client.close(); client = startMcp(installed);
  assert.ok((await client.request('initialize', { protocolVersion: '2025-03-26' })).result);
  const reapplied = await client.request('tools/call', { name: 'prepare_list', arguments: { text: 'beta\nalpha\nbeta' } });
  assert.equal(reapplied.result.content[0].text, '1. alpha\n\n另有 1 条未展示（受最多输出条数限制）。');
  checks.push('saved configuration changes output only after restarting consumer');
  await page.getByRole('button', { name: '全部插件', exact: true }).click();
  await page.getByRole('button', { name: '配置 文本整理台', exact: true }).click();
  await page.getByLabel('清单标题', { exact: true }).waitFor();
  checks.push('Discover settings resolve the installed generic configuration');
  await page.getByRole('button', { name: '全部插件', exact: true }).click();
  for (const theme of ['light', 'dark']) {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.evaluate(theme => window.desktop.preferences({ theme }), theme);
    await page.reload();
    await page.waitForFunction(theme => document.documentElement.dataset.theme === theme, theme);
    await page.getByRole('button', { name: '插件市场', exact: true }).click();
    for (const width of [1440, 640, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.getByRole('button', { name: '查看 文本整理台 使用说明', exact: true }).waitFor();
      await page.screenshot({ path: join(output, `catalog-${theme}-${width}.png`), animations: 'disabled' });
      await page.getByRole('button', { name: '配置 文本整理台', exact: true }).click();
      const field = page.getByLabel('清单标题', { exact: true });
      await field.waitFor(); await field.focus();
      assert.equal(await page.evaluate(() => typeof window.require), 'undefined');
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
      await page.screenshot({ path: join(output, `settings-${theme}-${width}.png`), animations: 'disabled' });
      await page.getByRole('button', { name: '全部插件', exact: true }).click();
    }
  }
  checks.push('real generic UI light/dark and 1440/640/390 widths');
  await page.evaluate(async () => {
    await window.desktop.capabilityMutate({ action: 'plugin-toggle', id: 'text-workbench', enabled: false });
  });
  assert.ok((await page.evaluate(() => window.desktop.capabilityCatalog())).mcp
    .filter(server => server.pluginId === 'text-workbench').every(server => !server.enabled));
  await page.evaluate(() => window.desktop.restart());
  await page.waitForFunction(async () => {
    const state = await window.desktop.snapshot();
    const summary = await window.desktop.summary(state.runtimeId);
    return summary.mcp.filter(server => server.name === 'text-workbench__text').every(server => server.status === 'disabled');
  }, undefined, { timeout: 30000 });
  checks.push('real service toggle mutation');
  await page.evaluate(() => window.desktop.capabilityMutate({ action: 'plugin-remove', id: 'text-workbench' }));
  const revoked = await client.request('tools/call', { name: 'prepare_list', arguments: { text: 'x' } });
  assert.equal(revoked.result.isError, true);
  const binding = JSON.parse(await readFile(join(root, 'desktop-plugins/bindings/text-workbench.json'), 'utf8'));
  assert.equal(binding.revoked, true);
  await assert.rejects(access(installed), /ENOENT/);
  assert.ok(!(await page.evaluate(() => window.desktop.capabilityCatalog())).skills.some(skill => skill.pluginId === 'text-workbench'));
  checks.push('uninstall removes package and resources; old consumer rejects revoked binding');
  assert.equal(client.stderr(), '');
  await client.close(); client = undefined;
  assert.deepEqual(errors, []);
  await writeFile(join(output, 'verification.json'), JSON.stringify({
    date: new Date().toISOString(), independentSource: source,
    desktopMain: options['--main'], isolatedProfile: true, noModelRequest: true,
    noHostPluginExceptions: true, publicSubmission: false, checks,
    hostRegression: 'Discover settings must use the installed configuration reference, not the marketplace preview reference.',
    examples: { initial: result.result.content[0].text, changed: reapplied.result.content[0].text },
  }, null, 2) + '\n');
  console.log(JSON.stringify({ result: 'passed', output, checks }, null, 2));
} catch (error) {
  const page = await app.firstWindow();
  await page.screenshot({ path: join(output, 'failure.png') }).catch(() => {});
  console.error(await page.getByRole('alert').allTextContents());
  console.error(error);
  throw error;
} finally {
  await client?.close();
  const pages = app.windows();
  for (const page of pages) await page.evaluate(() => {
    if (!window.desktop) return;
    window.desktop.onEvent(event => {
      if (event.type === 'desktop_quit_review' && event.state?.request?.phase === 'review')
        void window.desktop.quitRespond(event.state.request.id, true);
    });
  }).catch(() => {});
  const child = app.process();
  await app.close();
  for (const pipe of child.stdio ?? []) pipe?.destroy();
}
