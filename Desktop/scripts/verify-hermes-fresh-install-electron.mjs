import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { cp, mkdir, mkdtemp, readFile, readdir, realpath, stat, unlink, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { _electron as electron } from 'playwright';
import semver from 'semver';
import { closeDesktopFixtureAndWait } from './close-desktop-fixture.mjs';
import { settleLayout } from './settle-layout.mjs';

const output = resolve(process.env.DESKTOP_VERIFY_OUTPUT
  || 'D:/DFSC-Preview-QA/hermes-real-setup-20261111/fresh-install');
const source = await realpath(process.env.DESKTOP_HERMES_MARKET_SOURCE || 'D:/Dev/hermes-engineering-bridge');
await mkdir(output, { recursive: true });
const exists = async path => {
  try { await stat(path); return true; }
  catch (error) { if (error.code === 'ENOENT') return false; throw error; }
};
assert.equal(await exists(join(output, 'verification.json')), false,
  'Preserve prior evidence by selecting a new DESKTOP_VERIFY_OUTPUT directory');
const profile = await realpath(await mkdtemp(join(output, 'profile-')));
const root = join(profile, 'step-runtime'), project = join(profile, 'project');
const market = join(profile, 'local-market');
const emptyAgent = join(profile, 'empty-agent'), markerAgent = join(profile, 'marker-only-agent');
const marker = join(markerAgent, 'config.yaml'), markerText = 'fixture: profile-marker-only\n';
const checks = [], errors = [], screenshots = [], metadataChecks = [], iconChecks = [];
let app, main, child, originalProfileDialog, inferenceRequests = 0, verified = false, shutdown;
let appVersion, installedRef, disclosureDiagnostics;
const withinProfile = path => {
  const remainder = relative(profile, path);
  return Boolean(remainder && remainder !== '..' && !remainder.startsWith('..\\')
    && !remainder.startsWith('../') && !isAbsolute(remainder));
};
for (const path of [root, project, market, emptyAgent, markerAgent]) {
  assert.ok(withinProfile(path), 'Every generated fixture belongs to this new profile');
  await mkdir(path, { recursive: true });
}
await mkdir(join(root, 'sessions'));
await mkdir(join(market, '.step-plugin'));
await cp(join(source, '.step-plugin/marketplace.json'), join(market, '.step-plugin/marketplace.json'),
  { force: false, errorOnExist: true });
await cp(join(source, 'plugins'), join(market, 'plugins'), { recursive: true, force: false, errorOnExist: true });
assert.deepEqual((await readdir(market)).sort(), ['.step-plugin', 'plugins']);
const marketManifest = JSON.parse(await readFile(join(market, '.step-plugin/marketplace.json'), 'utf8'));
const pluginSource = join(market, 'plugins/hermes-engineering-bridge');
const manifest = JSON.parse(await readFile(join(pluginSource, 'step.plugin.json'), 'utf8'));
const metadata = JSON.parse(await readFile(join(pluginSource, 'dfsc.plugin.json'), 'utf8'));
assert.equal(manifest.id, 'hermes-engineering-bridge');
assert.ok(marketManifest.plugins.some(plugin => plugin.name === manifest.id));
assert.equal(metadata.desktop.surface, 'main-view');
assert.equal(metadata.desktop.connection.protocol, 'agent-bridge-v1');
assert.equal(metadata.desktop.pages.length, 4);
const expected = {
  author: metadata.authors.map(author => author.name).join(', '),
  maintainer: metadata.maintainers.map(author => author.name).join(', '),
  requirements: { ...metadata.requirements, external: metadata.requirements.external.map(item => ({
    ...item, ...(item.url ? { url: new URL(item.url).href } : {}),
  })) },
};
assert.ok(expected.author && expected.author !== expected.maintainer);
assert.ok(semver.valid(manifest.version));
assert.ok(semver.validRange(expected.requirements.dfsc));
assert.equal(expected.requirements.external.length, 4);
assert.equal(expected.requirements.external.filter(item => item.optional).length, 1);
await writeFile(marker, markerText, { flag: 'wx' });
await writeFile(join(profile, 'preferences.json'), JSON.stringify({
  language: 'zh', theme: 'light', workspace: project, workspaces: [project],
}), { flag: 'wx' });
await writeFile(join(root, 'config.toml'),
  'defaultProvider = "fixture"\ndefaultModel = "fixture"\npermissionPreset = "ask"\n[telemetry]\nenabled = false\n',
  { flag: 'wx' });
const transport = createServer(async (request, response) => {
  inferenceRequests++;
  for await (const _chunk of request) {}
  response.writeHead(503, { 'content-type': 'application/json' });
  response.end(JSON.stringify({ error: { message: 'Model requests are forbidden in fresh-install acceptance.' } }));
});
const env = { ...process.env };
for (const name of Object.keys(env)) {
  if (/^(STEP|STEPCODE|STEPFUN|OPENAI|ANTHROPIC|OPENROUTER|HERMES_|DESKTOP_)/iu.test(name)
    || name === 'ELECTRON_RUN_AS_NODE') delete env[name];
}
Object.assign(env, { DESKTOP_TEST_USER_DATA: profile, DESKTOP_TEST_NO_FOCUS: '1' });
const center = () => main.getByRole('region', { name: '插件中心', exact: true });
const workspace = () => main.locator(`[data-plugin-workspace="${manifest.id}"]`);
const quick = () => main.getByRole('dialog', { name: `${metadata.desktop.title} · 智能体状态`, exact: true });
const action = () => main.getByRole('button', { name: metadata.desktop.title, exact: true });
const catalog = () => main.evaluate(() => window.desktop.capabilityCatalog());
const snapshot = () => main.evaluate(() => window.desktop.snapshot());
const selection = value => ({ runtimeId: value.runtimeId ?? null, draftId: value.draftId ?? null,
  sessionId: value.state?.sessionId ?? null, workspace: value.preferences.workspace ?? null });
const capture = async name => {
  const path = join(output, `${name}.png`);
  await main.screenshot({ path });
  screenshots.push(path);
};
const assertStatus = async (scope, status) => {
  await scope.locator(`[data-connection-status="${status}"][aria-busy="false"]`).waitFor();
  assert.equal(await scope.locator('[data-connection-status="ready"]').count(), 0,
    'An unconfigured profile cannot be presented as a verified connection');
  assert.equal(await scope.locator('.plugin-connection-tasks > li').count(), 0);
  assert.equal(await scope.locator('.plugin-connection-details code').count(), 0);
};
const assertPreparation = async results => {
  assert.equal(await workspace().locator('[data-preparation-step]').count(), 4);
  for (const [id, result] of Object.entries(results))
    assert.equal(await workspace().locator(`[data-preparation-step="${id}"]`).getAttribute('data-result'), result);
};
const assertRequirements = async scope => {
  assert.equal(await scope.locator('.pc-external-requirements > li').count(), expected.requirements.external.length);
  for (const dependency of expected.requirements.external) {
    const row = scope.locator('.pc-external-requirements > li').filter({ hasText: dependency.name });
    await row.getByText(dependency.name, { exact: true }).waitFor();
    await row.getByText(dependency.optional ? '可选' : '必需', { exact: true }).waitFor();
    if (dependency.description) await row.getByText(dependency.description, { exact: true }).waitFor();
  }
};
const assertPackage = (pkg, location) => {
  assert.ok(pkg);
  assert.equal(pkg.author, expected.author);
  assert.equal(pkg.maintainer, expected.maintainer);
  assert.deepEqual(pkg.requirements, expected.requirements);
  assert.equal(Object.hasOwn(pkg, 'downloads'), false);
  metadataChecks.push({ location, author: pkg.author, maintainer: pkg.maintainer,
    dfsc: pkg.requirements.dfsc, external: pkg.requirements.external.length });
};
const assertMetadata = async (scope, location) => {
  const author = scope.locator('.pc-market-author');
  assert.equal((await author.innerText()).trim(), expected.author);
  assert.equal(await author.getAttribute('aria-label'), `作者：${expected.author}`);
  const versionStatus = semver.satisfies(appVersion, expected.requirements.dfsc) ? 'matches' : 'mismatch';
  const version = scope.locator(`.pc-version-requirement[data-version-status="${versionStatus}"]`);
  await version.waitFor();
  assert.ok((await version.innerText()).includes(expected.requirements.dfsc));
  assert.ok((await version.getAttribute('aria-label')).includes('仅比较 DFSC 版本，不代表依赖或服务已就绪'));
  if (location === 'card') assert.equal(await scope.locator('.pc-downloads').count(), 0);
  else {
    await scope.getByText(`当前 ${appVersion}`, { exact: true }).waitFor();
    await scope.getByText('作者声明 · 未检测本机环境', { exact: true }).waitFor();
    await scope.getByRole('group', { name: '作者：' + expected.author, exact: true }).waitFor();
    assert.equal(await scope.locator('.pc-downloads').getAttribute('aria-label'), '下载量：暂无统计');
    await assertRequirements(scope);
  }
};
const assertImage = async (image, path, location, size) => {
  const bytes = await readFile(join(pluginSource, path));
  assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  const observed = await image.evaluate(async element => {
    await element.decode();
    const rect = element.getBoundingClientRect();
    return { src: element.currentSrc, naturalWidth: element.naturalWidth, naturalHeight: element.naturalHeight,
      width: rect.width, height: rect.height, objectFit: getComputedStyle(element).objectFit };
  });
  assert.equal(observed.src, `data:image/png;base64,${bytes.toString('base64')}`);
  assert.equal(observed.naturalWidth, bytes.readUInt32BE(16));
  assert.equal(observed.naturalHeight, bytes.readUInt32BE(20));
  assert.equal(observed.objectFit, 'contain');
  assert.ok(Math.abs(observed.width - size) < .5 && Math.abs(observed.height - size) < .5);
  iconChecks.push({ location, sha256: createHash('sha256').update(bytes).digest('hex'),
    naturalWidth: observed.naturalWidth, naturalHeight: observed.naturalHeight,
    width: observed.width, height: observed.height });
};
const resize = async (width, height) => {
  await app.evaluate(({ BrowserWindow }, bounds) => BrowserWindow.getAllWindows()[0].setSize(...bounds), [width, height]);
  await main.waitForFunction(width => innerWidth === width, width);
};
const chooseFixtureProfile = async (path, expectedStatus) => {
  assert.ok(withinProfile(path));
  await app.evaluate(({ dialog }, selected) => {
    globalThis.freshInstallProfileDialog = dialog.showOpenDialog;
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selected] });
  }, path);
  originalProfileDialog = true;
  try {
    await workspace().getByRole('button', { name: /^(选择|更换)身份目录$/u }).click();
    await assertStatus(workspace(), expectedStatus);
  } finally {
    await app.evaluate(({ dialog }) => {
      dialog.showOpenDialog = globalThis.freshInstallProfileDialog;
      delete globalThis.freshInstallProfileDialog;
    });
    originalProfileDialog = false;
  }
};
try {
  await new Promise((resolve, reject) => {
    transport.once('error', reject);
    transport.listen(0, '127.0.0.1', () => {
      transport.off('error', reject);
      resolve();
    });
  });
  await writeFile(join(root, 'models.json'), JSON.stringify({ providers: { fixture: {
    api: 'openai-completions', baseUrl: `http://127.0.0.1:${transport.address().port}/v1`,
    apiKey: 'isolated-fresh-install-fixture',
    models: [{ id: 'fixture', name: 'Offline fresh-install fixture', contextWindow: 65536, maxTokens: 1024 }],
  } } }), { flag: 'wx' });
  const executablePath = process.env.DESKTOP_VERIFY_EXE;
  app = await electron.launch({
    ...(executablePath ? { executablePath } : {}),
    args: [...(executablePath ? [] : [resolve(process.env.DESKTOP_VERIFY_MAIN || '.')]),
      '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding',
      '--disable-features=CalculateNativeWinOcclusion'],
    ...(process.env.DESKTOP_VERIFY_CWD ? { cwd: process.env.DESKTOP_VERIFY_CWD } : {}),
    env, timeout: 60000,
  });
  child = app.process();
  main = await app.firstWindow();
  main.setDefaultTimeout(30000);
  main.on('pageerror', error => errors.push(error.message));
  await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    window.setOpacity(0); window.setIgnoreMouseEvents(true); window.showInactive(); window.setSize(1360, 900);
  });
  assert.equal(await realpath(await app.evaluate(({ app }) => app.getPath('userData'))), profile);
  appVersion = await app.evaluate(({ app }) => app.getVersion());
  assert.ok(semver.valid(appVersion));
  await main.waitForFunction(() => document.querySelector('.new-chat')?.disabled === false, undefined, { timeout: 90000 });
  const initialCatalog = await catalog();
  assert.equal(initialCatalog.plugins.some(plugin => plugin.id === manifest.id), false);
  assert.equal(await main.locator('.plugin-action-group').count(), 0);
  const initialConnectors = await main.evaluate(() => window.desktop.externalConnectorState());
  assert.equal(initialConnectors.enabled, false);
  assert.equal(initialConnectors.listening, false);
  assert.deepEqual(initialConnectors.connections, []);
  const composer = main.locator('.composer > .composer-input');
  await composer.fill('安装 Hermes x DFSC 时保留这段未发送草稿。');
  const draft = await composer.innerText(), before = selection(await snapshot());
  checks.push('new isolated Desktop profile has no Hermes installation, connection, pairing or authorization');

  const added = await main.evaluate(source => window.desktop.capabilityMutate({ action: 'marketplace-add', source }), market);
  assert.deepEqual(added.warnings, []);
  const available = (await catalog()).available.find(plugin => plugin.name === manifest.id);
  assert.ok(available?.package?.ref);
  assert.equal(available.version, manifest.version);
  assertPackage(available.package, 'marketplace');
  await main.getByRole('button', { name: '插件市场', exact: true }).click();
  await center().getByRole('tab', { name: /^发现/u }).click();
  await center().getByRole('textbox', { name: '搜索插件', exact: true }).fill(manifest.id);
  const card = center().locator('.pc-plugin-row').filter({ hasText: manifest.name });
  await assertMetadata(card, 'card');
  await assertImage(card.locator('.cap-plugin-icon img:visible'), manifest.icon, 'marketplace-avatar', 72);
  const dependencyButton = card.locator('.pc-extra-requirement');
  await dependencyButton.scrollIntoViewIfNeeded();
  const cardBounds = await card.boundingBox();
  await main.evaluate(() => {
    const events = [];
    globalThis.freshInstallDisclosureEvents = events;
    const controller = new AbortController();
    globalThis.freshInstallDisclosureController = controller;
    const describe = element => element instanceof Element
      ? { tag: element.tagName, className: element.className, text: element.textContent?.slice(0, 100),
        scrollLeft: element.scrollLeft, scrollTop: element.scrollTop } : null;
    for (const name of ['scroll', 'focusin', 'focusout', 'beforetoggle', 'toggle', 'pointerdown', 'click'])
      document.addEventListener(name, event => {
        if (events.length < 100) events.push({ event: name, at: performance.now(),
          target: describe(event.target), relatedTarget: describe(event.relatedTarget),
          oldState: event.oldState, newState: event.newState });
      }, { capture: true, passive: true, signal: controller.signal });
  });
  await dependencyButton.click();
  const dependencyPopover = main.getByRole('dialog', { name: '额外准备', exact: true });
  await dependencyPopover.waitFor();
  await settleLayout(dependencyPopover);
  assert.equal(await dependencyButton.getAttribute('aria-expanded'), 'true');
  assert.equal(await dependencyButton.getAttribute('aria-controls'), await dependencyPopover.getAttribute('id'));
  assert.equal(await dependencyPopover.evaluate(element => element.matches(':popover-open')), true);
  const directClickEvents = await main.evaluate(() => globalThis.freshInstallDisclosureEvents);
  await center().getByRole('textbox', { name: '搜索插件', exact: true })
    .evaluate(element => element.dispatchEvent(new Event('scroll')));
  await settleLayout(dependencyPopover);
  assert.equal(await dependencyPopover.isVisible(), true, 'Unrelated input scrolling must not dismiss the dependency dialog');
  assert.equal(await dependencyButton.getAttribute('aria-expanded'), 'true');
  disclosureDiagnostics = {
    nativeInputScrollObserved: directClickEvents.some(event => event.event === 'scroll' && event.target?.tag === 'INPUT'),
    syntheticInputScrollRemainsOpen: true,
    events: await main.evaluate(() => globalThis.freshInstallDisclosureEvents),
  };
  await assertRequirements(dependencyPopover);
  await dependencyPopover.getByText('作者声明 · 未检测本机环境', { exact: true }).waitFor();
  assert.deepEqual(await card.boundingBox(), cardBounds);
  assert.equal(await center().locator('.pc-detail:visible').count(), 0);
  await capture('marketplace-dependencies-light');
  await main.keyboard.press('Escape');
  await dependencyPopover.waitFor({ state: 'hidden' });
  await main.evaluate(() => globalThis.freshInstallDisclosureController.abort());
  await capture('marketplace-card-light');
  await card.getByRole('button', { name: '安装', exact: true }).click();
  await center().getByRole('heading', { name: manifest.name, exact: true, level: 2 }).waitFor();
  const installed = (await catalog()).plugins.find(plugin => plugin.id === manifest.id);
  assert.ok(installed?.package?.ref);
  assert.equal(installed.version, manifest.version);
  assert.equal(installed.package.provenance, 'recorded');
  assertPackage(installed.package, 'installed');
  installedRef = installed.package.ref;
  await center().getByRole('tab', { name: '使用说明', exact: true }).click();
  await assertMetadata(center().locator('.pc-detail'), 'detail');
  await assertImage(center().locator('.pc-plugin-identity .cap-plugin-icon img:visible'),
    manifest.icon, 'installed-avatar', 80);
  await settleLayout(center());
  await capture('installed-guide-light');
  assert.deepEqual(selection(await snapshot()), before);
  checks.push('actual package installed through native PluginCenter; author, version range, four dependencies and absent download counts are truthful');

  await center().getByRole('button', { name: '返回会话', exact: true }).click();
  await composer.waitFor();
  assert.equal(await composer.innerText(), draft);
  await action().click();
  await assertStatus(quick(), 'unselected');
  assert.equal(await workspace().isVisible(), false, 'The titlebar shortcut opens only the lightweight status view');
  assert.deepEqual(selection(await snapshot()), before);
  assert.equal(await composer.innerText(), draft);
  await assertImage(action().locator('.plugin-action-icon img:visible'), metadata.desktop.icon.light, 'toolbar-light', 17);
  await settleLayout(quick());
  await capture('status-unselected-light');
  await main.keyboard.press('Escape');
  await quick().waitFor({ state: 'hidden' });
  assert.equal(await action().evaluate(element => document.activeElement === element), true);
  await action().click();
  await assertStatus(quick(), 'unselected');
  await quick().getByRole('button', { name: '打开完整工作台', exact: true }).click();
  await assertStatus(workspace(), 'unselected');
  assert.equal(await quick().isVisible(), false);
  await assertPreparation({ profile: 'unchecked', companion: 'unchecked', bridge: 'unchecked', roots: 'unchecked' });
  await workspace().getByRole('heading', { name: metadata.desktop.title, exact: true, level: 1 }).waitFor();
  checks.push('titlebar status preserves the selected conversation and draft; explicit full workspace shows four unchecked preparation steps');

  for (const [name, width, height, theme] of [
    ['onboarding-light', 1360, 900, 'light'], ['onboarding-dark', 1360, 900, 'dark'],
    ['onboarding-narrow-light', 640, 740, 'light'], ['onboarding-narrow-dark', 640, 740, 'dark'],
  ]) {
    await resize(width, height);
    await main.evaluate(theme => window.desktop.preferences({ theme }), theme);
    await main.waitForFunction(theme => document.documentElement.dataset.theme === theme, theme);
    await assertStatus(workspace(), 'unselected');
    await assertPreparation({ profile: 'unchecked', companion: 'unchecked', bridge: 'unchecked', roots: 'unchecked' });
    assert.ok(await main.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await settleLayout(workspace());
    await capture(name);
  }
  await resize(1360, 900);
  await main.evaluate(() => window.desktop.preferences({ theme: 'light' }));
  await main.waitForFunction(() => document.documentElement.dataset.theme === 'light');
  checks.push('new-user preparation remains unconfigured in both themes and at the native 640px minimum width');

  await chooseFixtureProfile(emptyAgent, 'error');
  assert.equal((await main.evaluate(ref => window.desktop.pluginConnectionState({ ref }), installedRef)).status, 'unselected');
  await workspace().getByRole('button', { name: '重新检查', exact: true }).click();
  await assertStatus(workspace(), 'unselected');
  await chooseFixtureProfile(markerAgent, 'companion-missing');
  await assertPreparation({ profile: 'found', companion: 'missing', bridge: 'unchecked', roots: 'unchecked' });
  await settleLayout(workspace());
  await capture('onboarding-companion-missing');
  await unlink(marker);
  await workspace().getByRole('button', { name: '重新检查', exact: true }).click();
  await assertStatus(workspace(), 'profile-missing');
  await assertPreparation({ profile: 'missing', companion: 'unchecked', bridge: 'unchecked', roots: 'unchecked' });
  await settleLayout(workspace());
  await capture('onboarding-profile-missing');
  await writeFile(marker, markerText, { flag: 'wx' });
  await workspace().getByRole('button', { name: '忘记此选择', exact: true }).click();
  await assertStatus(workspace(), 'unselected');
  assert.equal(await readFile(marker, 'utf8'), markerText);
  assert.equal(await exists(join(markerAgent, 'dfsc-bridge')), false);
  checks.push('invalid profile selection is rejected; marker-only and missing-marker fixtures expose missing prerequisites without installation or pairing');

  await workspace().getByRole('button', { name: '查看第一项任务', exact: true }).click();
  assert.equal(await workspace().getByRole('tab', { name: '第一项任务', exact: true }).getAttribute('aria-selected'), 'true');
  for (const page of metadata.desktop.pages) {
    await workspace().getByRole('tab', { name: page.title, exact: true }).click();
    const document = await readFile(join(pluginSource, page.document), 'utf8');
    const heading = /^# (.+)$/mu.exec(document)?.[1].trim();
    assert.ok(heading, `${page.id}: the source guide has a visible title`);
    await workspace().getByRole('heading', { name: heading, exact: true }).waitFor();
    await settleLayout(workspace());
    await capture(`guide-${page.id}-light`);
  }
  await workspace().getByRole('tab', { name: '连接', exact: true }).click();
  await assertStatus(workspace(), 'unselected');
  await workspace().getByRole('button', { name: '返回工作区', exact: true }).click();
  await composer.waitFor();
  assert.equal(await composer.innerText(), draft);
  assert.deepEqual(selection(await snapshot()), before);
  checks.push('all four installed onboarding guides render through opaque document references; returning retains the unsent draft');

  await main.evaluate(() => window.desktop.preferences({ theme: 'dark' }));
  await main.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
  await action().click();
  await assertStatus(quick(), 'unselected');
  await assertImage(action().locator('.plugin-action-icon img:visible'), metadata.desktop.icon.dark, 'toolbar-dark', 17);
  await settleLayout(quick());
  await capture('status-unselected-dark');
  await main.keyboard.press('Escape');
  const finalConnectors = await main.evaluate(() => window.desktop.externalConnectorState());
  assert.equal(finalConnectors.enabled, false);
  assert.equal(finalConnectors.listening, false);
  assert.deepEqual(finalConnectors.connections, []);
  const tasksFile = join(profile, 'external-connectors/tasks.json');
  if (await exists(tasksFile))
    assert.deepEqual(JSON.parse(await readFile(tasksFile, 'utf8')).tasks, []);
  assert.deepEqual(await readdir(project), []);
  assert.equal(inferenceRequests, 0);
  assert.deepEqual(errors, []);
  checks.push('zero inference requests, engineering tasks, pairing, authorization changes or fixture-project writes');
  verified = true;
} catch (error) {
  errors.push(error.message);
  disclosureDiagnostics = await main?.evaluate(() => ({
    events: globalThis.freshInstallDisclosureEvents,
    focused: document.hasFocus(), activeElement: document.activeElement && {
      tag: document.activeElement.tagName, className: document.activeElement.className,
      ariaLabel: document.activeElement.getAttribute('aria-label'),
    },
    trigger: document.querySelector('.pc-extra-requirement')?.outerHTML,
    popovers: [...document.querySelectorAll('.pc-requirements-popover')].map(element => ({
      html: element.outerHTML, open: element.matches(':popover-open'),
    })),
  })).catch(() => undefined);
  await main?.screenshot({ path: join(output, 'failure.png') }).catch(() => {});
  console.error('Fresh Hermes installation acceptance failed:', error);
  process.exitCode = 1;
} finally {
  try {
    if (app) {
      if (originalProfileDialog) await app.evaluate(({ dialog }) => {
        dialog.showOpenDialog = globalThis.freshInstallProfileDialog;
        delete globalThis.freshInstallProfileDialog;
      });
      const windows = app.windows();
      await closeDesktopFixtureAndWait(app, 45000);
      shutdown = { exitCode: child.exitCode, windows: windows.filter(window => !window.isClosed()).length };
      assert.equal(shutdown.exitCode, 0);
      assert.equal(shutdown.windows, 0);
    }
  } catch (error) {
    errors.push(error.message);
    process.exitCode = 1;
  } finally {
    try {
      if (transport.listening) {
        transport.closeAllConnections();
        await new Promise((resolve, reject) => transport.close(error => error ? reject(error) : resolve()));
      }
    } catch (error) {
      errors.push(error.message);
      process.exitCode = 1;
    }
    await writeFile(join(output, 'verification.json'), JSON.stringify({
      passed: verified && !errors.length, profile, source, localMarket: market, plugin: manifest.id,
      pluginVersion: manifest.version, appVersion, checks, errors, screenshots, metadataChecks, iconChecks,
      inferenceRequests, shutdown, disclosureDiagnostics,
      fixtureOnly: true, realHermesGateway: false, realAccount: false,
      scope: 'Fresh isolated Desktop profile with offline model configuration; real resource installation and native onboarding UI only. Not a clean-machine, public-market or dispatch acceptance.',
    }, null, 2) + '\n');
  }
}
if (verified && !errors.length)
  console.log(`Fresh Hermes installation acceptance passed (${checks.length} groups). Evidence: ${output}`);
