import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile, cp } from 'node:fs/promises';
import { mkdtemp } from './test-profile.mjs';
import { join, resolve } from 'node:path';
import { parseEnv } from 'node:util';
import { closeDesktopFixture } from './close-desktop-fixture.mjs';

const main = process.env.DESKTOP_VERIFY_MAIN, cwd = process.env.DESKTOP_VERIFY_CWD, bvr = process.env.DESKTOP_BVR_CHECKOUT;
const executablePath = process.env.DESKTOP_VERIFY_EXE;
if ((!main && !executablePath) || !cwd || !bvr) throw new Error('Set DESKTOP_VERIFY_MAIN or DESKTOP_VERIFY_EXE, DESKTOP_VERIFY_CWD and DESKTOP_BVR_CHECKOUT');
const output = resolve(process.env.DESKTOP_PREVIEW_OUTPUT ?? 'test-results/bvr-settings');
await mkdir(output, { recursive: true });
const profile = await mkdtemp(join(output, 'profile-'));
const root = join(profile, 'step-runtime'), market = join(profile, 'fixture-market');
await mkdir(root);
await writeFile(join(profile, 'preferences.json'), JSON.stringify({ language: 'zh', theme: 'light' }));
await writeFile(join(root, 'config.toml'), 'defaultProvider = "fixture"\ndefaultModel = "fixture"\n[telemetry]\nenabled = false\n');
await writeFile(join(root, 'models.json'), JSON.stringify({ providers: { fixture: {
  api: 'openai-completions', baseUrl: 'http://127.0.0.1:1/v1', apiKey: 'fixture-only',
  models: [{ id: 'fixture', name: 'Offline verification', contextWindow: 32768, maxTokens: 1024 }],
} } }));
await mkdir(join(market, '.step-plugin'), { recursive: true });
await writeFile(join(market, '.step-plugin/marketplace.json'), JSON.stringify({
  name: 'local-bvr-check', plugins: [{ name: 'bilibili-video-research', source: './bilibili-video-research', description: 'Local BVR acceptance' }],
}));
await cp(join(bvr, 'plugins/bilibili-video-research'), join(market, 'bilibili-video-research'), { recursive: true });
const env = { ...process.env, DESKTOP_TEST_USER_DATA: profile, DESKTOP_TEST_NO_FOCUS: '1' };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ ...(executablePath ? { executablePath } : {}),
  args: [...(executablePath ? [] : [resolve(main)]), '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding'], cwd: resolve(cwd), env, timeout: 60000 });
const errors = [];
try {
  const page = await app.firstWindow();
  page.on('pageerror', error => errors.push(error.message));
  await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows().find(window => window.webContents.getURL().includes('index.html'));
    if (!window) throw new Error('Main application window is unavailable');
    window.setOpacity(0); window.setIgnoreMouseEvents(true); window.showInactive();
  });
  await page.waitForFunction(() => Boolean(window.desktop));
  await page.evaluate(async source => {
    await window.desktop.newIndependentSession();
    await window.desktop.capabilityMutate({ action: 'marketplace-add', source });
    await window.desktop.capabilityMutate({ action: 'plugin-install', name: 'bilibili-video-research', marketplace: 'local-bvr-check' });
  }, market);
  await page.reload();
  await page.getByRole('button', { name: '插件市场', exact: true }).click();
  await page.getByRole('button', { name: '配置 Bilibili Video Research', exact: true }).click();
  await page.getByLabel('BVR 运行目录', { exact: true }).fill(resolve(bvr));
  await page.getByRole('button', { name: '独立配置', exact: true }).click();
  await page.getByLabel('API Key', { exact: true }).fill('fixture-main-private');
  await page.getByLabel('ASR API Key', { exact: true }).fill('fixture-asr-private');
  await page.getByLabel('ASR 接口地址', { exact: true }).fill('https://api.stepfun.ai/step_plan/v1');
  await page.getByRole('button', { name: '检查环境', exact: true }).click();
  await page.getByRole('status').filter({ hasText: /Node.js/ }).waitFor();
  await page.getByRole('button', { name: '保存配置', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.pc-secret input')?.value === '');
  const publicConfig = await page.evaluate(() => window.desktop.bvrConfiguration());
  assert.equal(publicConfig.mode, 'independent');
  assert.equal(publicConfig.hasApiKey, true); assert.equal(publicConfig.hasAsrApiKey, true);
  assert.equal(publicConfig.asrApiBase, 'https://api.stepfun.ai/step_plan/v1');
  assert.doesNotMatch(JSON.stringify(publicConfig), /fixture-main-private|fixture-asr-private/);
  const disk = JSON.parse(await readFile(join(root, 'bvr/config.json'), 'utf8'));
  const privateEnv = parseEnv(await readFile(disk.envFile, 'utf8'));
  assert.equal(privateEnv.STEPFUN_API_KEY, 'fixture-main-private');
  assert.equal(privateEnv.STEPFUN_ASR_API_KEY, 'fixture-asr-private');
  assert.doesNotMatch(JSON.stringify(await page.evaluate(() => window.desktop.snapshot())), /fixture-main-private|fixture-asr-private/);
  await page.getByRole('button', { name: '重启当前会话', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('.pc-detail-footer button:last-child')?.disabled);
  const summary = await page.evaluate(async () => {
    const state = await window.desktop.snapshot();
    return window.desktop.summary(state.runtimeId);
  });
  assert.ok(summary.mcp.some(server => server.name === 'bilibili-video-research__bvr' && server.status === 'connected'), 'Actual BVR MCP initializes with separately saved connections');
  await page.getByRole('button', { name: '跟随 DFSC 会话', exact: true }).click();
  await page.getByRole('button', { name: '保存配置', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.pc-save-state')?.textContent.includes('已保存')
    && !document.querySelector('.pc-form-fields')?.disabled);
  assert.equal((await page.evaluate(() => window.desktop.bvrConfiguration())).mode, 'dfsc');
  const follow = JSON.parse(await readFile(join(root, 'bvr/config.json'), 'utf8'));
  assert.equal(follow.hostAccess, 'confirm');
  const pkg = await page.evaluate(async () => (await window.desktop.capabilityCatalog()).plugins.find(plugin =>
    plugin.id === 'bilibili-video-research').package);
  assert.equal(pkg.documentation.readme, 'docs/DFSC.md');
  assert.ok(pkg.tutorials.some(item => item.url === 'https://www.bilibili.com/video/BV1dPeP6REwM/'));
  const guide = await page.evaluate(ref => window.desktop.pluginDocument({ ref, path: 'docs/DFSC.md' }), pkg.ref);
  assert.match(guide.text, /Bilibili Video Research/);
  assert.ok(Object.values(guide.links).some(path => path === 'README.md'));
  let publicStars;
  if (process.env.DESKTOP_VERIFY_PUBLIC_STARS === '1') {
    publicStars = await page.evaluate(ref => window.desktop.pluginRepositoryInfo({ ref, refresh: true }), pkg.ref);
    assert.equal(publicStars.status, 'fresh', 'Explicit public GitHub query must return a real snapshot');
    assert.equal(Number.isSafeInteger(publicStars.count), true);
    console.log('Public BVR GitHub Stars:', JSON.stringify(publicStars));
  }
  assert.equal(await page.evaluate(() => typeof window.require), 'undefined');
  assert.deepEqual(errors, []);
  await page.screenshot({ path: join(output, 'actual-bvr-config.png'), animations: 'disabled' });
  await writeFile(join(output, 'verification.json'), JSON.stringify({ realElectron: true, realBvrMcp: true,
    isolatedProfile: true, separateConnections: true, keysExcludedFromReads: true, noModelRequest: true,
    packageDocumentation: true, publicStars }, null, 2));
  console.log('BVR real Electron configuration and MCP initialization acceptance passed.');
} catch (error) {
  const page = await app.firstWindow();
  await page.screenshot({ path: join(output, 'failure.png') }).catch(() => {});
  console.error(await page.getByRole('alert').allTextContents());
  throw error;
} finally { await closeDesktopFixture(app); }
