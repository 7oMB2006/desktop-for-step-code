import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { closeDesktopFixtureAndWait } from './close-desktop-fixture.mjs';
import { settleLayout } from './settle-layout.mjs';
import { checkWorkspaceCoverage } from './workspace-surface-checks.mjs';

if (!process.argv[2] || !process.argv[3]) throw new Error('Pass the isolated build and evidence directories');
const build = resolve(process.argv[2]);
const output = resolve(process.argv[3]);
await mkdir(output, { recursive: true });
const profile = await realpath(await mkdtemp(join(output, 'profile-')));
const root = join(profile, 'step-runtime');
const pngPath = join(profile, 'background sample.png');
const jpegPath = join(profile, 'background sample.jpg');
const invalidPath = join(profile, 'not an image.png');
const market = resolve('../theme-marketplace');
const executablePath = process.env.DESKTOP_VERIFY_EXE || resolve('node_modules/electron/dist/electron.exe');
const draftText = 'Background acceptance keeps this unsent draft.';
const errors = [];
const checks = [];
let app, page, mini;

await mkdir(root, { recursive: true });
await writeFile(join(profile, 'preferences.json'), JSON.stringify({
  theme: 'original-dark', language: 'en', workspaces: [], autoCheckUpdates: false,
}));
await writeFile(join(root, 'config.toml'), 'defaultProvider = "fixture"\ndefaultModel = "fixture"\n[telemetry]\nenabled = false\n');
await writeFile(join(root, 'models.json'), JSON.stringify({ providers: { fixture: {
  api: 'openai-completions', baseUrl: 'http://127.0.0.1:1/v1', apiKey: 'fixture-only',
  models: [{ id: 'fixture', name: 'Offline background acceptance', contextWindow: 32768, maxTokens: 1024 }],
} } }));
await cp(join(market, 'plugins/stellar-cruise/cover.png'), pngPath);
await writeFile(invalidPath, 'This fixture is not an image.');
const env = { ...process.env, DESKTOP_TEST_USER_DATA: profile, DESKTOP_TEST_NO_FOCUS: '1' };
for (const key of ['DESKTOP_DEV_URL', 'ELECTRON_RUN_AS_NODE', 'STEP_API_KEY', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY'])
  delete env[key];

async function launch() {
  app = await electron.launch({
    executablePath, args: [join(build, 'main.cjs'), '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding'],
    cwd: build, env, timeout: 60000,
  });
  page = await app.firstWindow();
  page.on('pageerror', error => errors.push(error.message));
  await page.waitForURL('**/renderer/index.html');
  await page.waitForFunction(() => Boolean(window.desktop), { timeout: 60000 });
  await app.evaluate(({ BrowserWindow, dialog }) => {
    const window = BrowserWindow.getAllWindows()[0];
    window.setOpacity(0);
    window.setIgnoreMouseEvents(true);
    window.showInactive();
    globalThis.backgroundAcceptance = { original: dialog.showOpenDialog, selection: null, calls: [] };
    // Only the OS picker is substituted; the real host import and validation run.
    dialog.showOpenDialog = async (_window, options) => {
      const fixture = globalThis.backgroundAcceptance;
      fixture.calls.push(options);
      const selection = fixture.selection;
      fixture.selection = null;
      return { canceled: !selection, filePaths: selection ? [selection] : [] };
    };
  });
  await page.evaluate(() => window.desktop.finishFirstRun('skipped'));
  await page.reload();
  await page.locator('.sidebar-settings').waitFor({ timeout: 60000 });
  await poll(async () => Boolean((await snapshot()).draftId), 'Initial session draft');
}

async function close() {
  if (!app) return;
  await app.evaluate(({ dialog }) => {
    if (globalThis.backgroundAcceptance) dialog.showOpenDialog = globalThis.backgroundAcceptance.original;
  }).catch(() => {});
  const closing = app;
  app = undefined; mini = undefined;
  await closeDesktopFixtureAndWait(closing, 60000);
}

const state = () => page.evaluate(() => window.desktop.customBackgroundState());
const snapshot = () => page.evaluate(() => window.desktop.snapshot());
const settings = () => page.getByRole('region', { name: 'Custom background settings', exact: true });
async function poll(check, description) {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    const value = await check();
    if (value) return value;
    await delay(100);
  }
  throw new Error(`Timed out waiting for ${description}`);
}
async function waitState(predicate, description) {
  const value = await poll(async () => {
    const current = await state();
    return predicate(current) ? current : undefined;
  }, description);
  checks.push(description);
  return value;
}
async function identity(target = page) {
  return target.evaluate(async () => {
    const value = await window.desktop.snapshot();
    return { draftId: value.draftId, runtimeId: value.runtimeId, runtimeRevision: value.runtimeRevision,
      runtimes: value.runtimes, sessionId: value.state?.sessionId };
  });
}
async function assertIdentity(expected, description) {
  assert.deepEqual(await identity(), expected, description);
  assert.equal(await page.locator('.composer-input').evaluate(element => element.value ?? element.textContent), draftText, description);
}
async function configure() {
  const dialog = page.getByRole('dialog', { name: 'Settings', exact: true });
  if (!await dialog.isVisible()) await page.locator('.sidebar-settings').click();
  if (!await settings().isVisible()) {
    await dialog.getByRole('button', { name: 'Appearance', exact: true }).click();
  }
  await settings().waitFor();
  const importButton = settings().getByRole('button', { name: 'Import background image', exact: true });
  await importButton.waitFor();
  await poll(() => importButton.isEnabled(), 'Visible background configuration controls');
}
async function conversation() {
  const dialog = page.getByRole('dialog', { name: 'Settings', exact: true });
  if (await dialog.isVisible()) {
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    await dialog.waitFor({ state: 'detached' });
  }
  const center = page.getByRole('region', { name: 'Plugin center', exact: true });
  if (await center.isVisible()) await center.getByRole('button', { name: 'Back to conversation', exact: true }).click();
  await page.locator('.composer-input').waitFor();
}
async function picker(path) {
  await app.evaluate((_electron, selection) => { globalThis.backgroundAcceptance.selection = selection; }, path);
}
async function saved() {
  await page.waitForFunction(() => {
    const section = document.querySelector('.custom-background-settings:not([hidden])');
    return section?.querySelector('.custom-background-feedback')?.textContent === 'Saved'
      && !section.querySelector('button[aria-label="Import background image"]')?.disabled;
  });
}
async function imageReady(target = page) {
  await target.waitForFunction(() => {
    const image = document.querySelector('.custom-background-plane .theme-workspace-image');
    return image?.complete && image.naturalWidth > 0;
  });
}
async function selectTheme(theme) {
  await page.evaluate(theme => window.desktop.preferences({ theme }), theme);
  await page.waitForFunction(theme => document.documentElement.dataset.palette === theme, theme);
}
async function importThroughSettings(path) {
  await configure();
  await picker(path);
  await settings().getByRole('button', { name: 'Import background image', exact: true }).click();
}

try {
  await launch();
  const initial = await state();
  assert.equal(initial.available, true);
  assert.equal(initial.options.enabled, false);
  await page.locator('.composer-input').fill(draftText);
  await page.locator('.composer-input').blur();
  const before = await identity();
  assert.ok(before.draftId);
  assert.equal(before.runtimeId, undefined);

  assert.equal(await page.evaluate(async () =>
    (await window.desktop.capabilityCatalog()).plugins.some(item => item.id === 'custom-background')), false);
  checks.push('Fresh profile exposes built-in background controls with no background plugin installed');

  await importThroughSettings(pngPath);
  const imported = await waitState(value => {
    return value.available && value.options.enabled && Boolean(value.image);
  }, 'PNG import through the real picker handler activates the local image');
  await saved();
  await imageReady();
  assert.equal(await page.evaluate(() => document.documentElement.dataset.palette), 'original-dark');
  assert.equal(await page.evaluate(() => document.documentElement.dataset.themeMaterial), undefined);
  const image = await page.evaluate(revision => window.desktop.customBackgroundImage(revision), imported.image.revision);
  assert.match(image.dataUrl, /^data:image\/png;base64,/);
  assert.ok(image.width > 0 && image.height > 0);
  const pickerOptions = await app.evaluate(() => globalThis.backgroundAcceptance.calls.at(-1));
  assert.deepEqual(pickerOptions.properties, ['openFile']);
  assert.deepEqual(pickerOptions.filters[0].extensions, ['png', 'jpg', 'jpeg']);
  const jpeg = await app.evaluate(({ nativeImage }, dataUrl) =>
    nativeImage.createFromDataURL(dataUrl).toJPEG(85).toString('base64'), image.dataUrl);
  await writeFile(jpegPath, Buffer.from(jpeg, 'base64'));

  await picker(null);
  await settings().getByRole('button', { name: 'Import background image', exact: true }).click();
  await page.waitForFunction(() =>
    !document.querySelector('.custom-background-settings button[aria-label="Import background image"]')?.disabled);
  assert.deepEqual((await state()).image, imported.image, 'Cancel must retain the previous image');
  await importThroughSettings(invalidPath);
  await settings().getByRole('alert').waitFor();
  assert.deepEqual((await state()).image, imported.image, 'Invalid image must retain the previous image');
  assert.equal((await state()).options.enabled, true);
  checks.push('Canceled and invalid imports retain the enabled image without destructive changes');

  await importThroughSettings(jpegPath);
  await saved();
  const jpegState = await waitState(value => value.options.enabled && value.image && value.image.revision !== imported.image.revision,
    'JPEG input is decoded and normalized through the native import path');
  await page.waitForFunction(() => {
    const preview = document.querySelector('.custom-background-preview img');
    return !document.querySelector('.custom-background-settings [role="alert"]') && preview?.complete && preview.naturalWidth > 0;
  });
  assert.deepEqual({ width: jpegState.image.width, height: jpegState.image.height },
    { width: image.width, height: image.height });
  const normalized = await page.evaluate(revision => window.desktop.customBackgroundImage(revision), jpegState.image.revision);
  assert.match(normalized.dataUrl, /^data:image\/png;base64,/);
  const adjustments = { positionX: 25, positionY: 70, zoom: 120, brightness: 75, blur: 3, parallax: 8,
    contentTransparency: 55, sidebarTransparency: 45, panelTransparency: 60, composerTransparency: 35, surfaceBlur: 12 };
  for (const [label, value] of [
    ['Horizontal position', adjustments.positionX], ['Vertical position', adjustments.positionY],
    ['Zoom', adjustments.zoom], ['Brightness', adjustments.brightness], ['Background blur', adjustments.blur],
    ['Mouse parallax', adjustments.parallax],
    ['Conversation transparency', adjustments.contentTransparency], ['Left sidebar transparency', adjustments.sidebarTransparency],
    ['Right panel transparency', adjustments.panelTransparency], ['Composer transparency', adjustments.composerTransparency],
    ['Interface blur', adjustments.surfaceBlur],
  ]) {
    const slider = settings().getByRole('slider', { name: label, exact: true });
    await slider.fill(String(value));
    await slider.press('Tab');
    await page.waitForFunction(({ label, value }) => {
      const control = [...document.querySelectorAll('.custom-background-slider')].find(item =>
        item.querySelector('span > span')?.textContent === label)?.querySelector('input');
      return control?.value === String(value) && !control.disabled
        && document.querySelector('.custom-background-feedback')?.textContent === 'Saved';
    }, { label, value });
  }
  await settings().getByRole('button', { name: 'Fit', exact: true }).click();
  await saved();
  await waitState(value => value.options.fit === 'contain',
    'All framing and visual adjustments save through the settings form');
  assert.deepEqual((await state()).options, { enabled: true, fit: 'contain', ...adjustments });
  await conversation();
  await imageReady();
  await assertIdentity(before, 'Importing and adjusting a background must retain the active draft and composer');
  await page.waitForFunction(() => document.documentElement.dataset.customBackgroundSurfaces === 'true');
  const summaryToggle = page.locator('.right-tool-rail button[aria-controls="summary-board"]');
  if (await summaryToggle.getAttribute('aria-pressed') !== 'true') await summaryToggle.click();
  await page.locator('.summary-board').waitFor();
  await settleLayout(page.locator('.summary-board'));
  const materials = await page.evaluate(() => ({
    regions: ['main:not([hidden])', '.sidebar', '.summary-track', '.summary-board', '.composer'].map(selector => {
      const element = document.querySelector(selector), style = getComputedStyle(element), plane = getComputedStyle(element, '::before');
      return { selector, opacity: style.opacity, filter: style.filter, blur: plane.backdropFilter,
        background: plane.backgroundColor, fill: style.backgroundColor };
    }),
    veil: getComputedStyle(document.querySelector('.composer-wrap'), '::before').backgroundImage,
    values: ['content', 'sidebar', 'panel', 'composer'].map(name =>
      document.documentElement.style.getPropertyValue(`--background-${name}-opacity`)),
  }));
  assert.deepEqual(materials.values, ['45%', '55%', '40%', '65%']);
  assert.equal(materials.veil, 'none');
  for (const [index, region] of materials.regions.entries()) {
    assert.equal(region.opacity, '1'); assert.equal(region.filter, 'none');
    assert.equal(region.blur, index < 3 ? 'blur(12px)' : 'none');
    assert.equal(region.fill, 'rgba(0, 0, 0, 0)');
  }
  await writeFile(join(output, 'surface-materials.json'), JSON.stringify(materials, null, 2));
  const mainCoverage = await checkWorkspaceCoverage(page, output, 'native-main-continuous-workspace');
  await writeFile(join(output, 'workspace-coverage.json'), JSON.stringify({ main: mainCoverage }, null, 2));
  checks.push('Actual workspace covers composer gutters, footer and unused summary space without dimming foregrounds');
  await page.screenshot({ path: join(output, 'builtin-custom-background.png') });

  await page.evaluate(async source => {
    await window.desktop.capabilityMutate({ action: 'marketplace-add', source });
    await window.desktop.capabilityMutate({ action: 'plugin-install', name: 'stellar-cruise', marketplace: 'dfsc-themes' });
  }, market);
  await selectTheme('plugin:stellar-cruise');
  await page.locator('.stellar-workspace-scene canvas[data-ready=true]').waitFor({ timeout: 60000 });
  assert.equal(await page.locator('.custom-background-plane').count(), 0);
  assert.equal(await page.evaluate(() => document.documentElement.dataset.themeMaterial), 'stellar');
  assert.equal(await page.evaluate(() => document.documentElement.dataset.customBackgroundSurfaces), undefined);
  assert.equal((await state()).options.enabled, true);
  assert.deepEqual((await state()).image, jpegState.image);
  await configure();
  await settings().getByText('This theme does not accept a replacement. Your image and adjustments are kept.', { exact: true }).waitFor();
  await conversation();
  await page.screenshot({ path: join(output, 'closed-theme-background.png') });
  checks.push('A closed interactive theme retains its scene and UI while preserving inactive custom settings');
  await selectTheme('original-dark');
  await imageReady();
  await assertIdentity(before, 'Switching theme background ownership must retain the active draft');

  await configure();
  await settings().getByRole('checkbox', { name: 'Enable background', exact: true }).click();
  await saved();
  await waitState(value => !value.options.enabled,
    'Disabling custom background follows the theme and retains the local image');
  assert.deepEqual((await state()).image, jpegState.image);
  await page.waitForFunction(() => !document.querySelector('.custom-background-plane'));
  assert.equal(await page.evaluate(() => document.documentElement.dataset.customBackgroundSurfaces), undefined);
  await settings().getByRole('checkbox', { name: 'Enable background', exact: true }).click();
  await saved();
  await imageReady();
  const persisted = await state();
  await close();
  await launch();
  await imageReady();
  const restored = await state();
  assert.equal(restored.available, true);
  assert.deepEqual(restored.options, persisted.options);
  assert.deepEqual(restored.image, persisted.image);
  checks.push('An orderly host restart restores the local image, activation, and adjustments');
  await page.locator('.composer-input').fill(draftText);
  await page.locator('.composer-input').blur();
  const afterRestart = await identity();

  const miniOpened = app.waitForEvent('window');
  await page.getByRole('button', { name: 'MiniChat', exact: true }).click();
  mini = await miniOpened;
  mini.on('pageerror', error => errors.push(error.message));
  await mini.waitForFunction(() => window.desktop?.surface === 'mini');
  await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows().find(window => window.getTitle() === 'MiniChat');
    window.setOpacity(0); window.setIgnoreMouseEvents(true); window.showInactive();
  });
  await imageReady(mini);
  await mini.waitForFunction(() => document.documentElement.dataset.customBackgroundSurfaces === 'true');
  assert.deepEqual(await identity(mini), afterRestart);
  assert.deepEqual(await mini.evaluate(() => window.desktop.customBackgroundState()), restored);
  assert.deepEqual(await mini.evaluate(async () => {
    const results = [];
    for (const operation of [
      () => window.desktop.customBackgroundImport(),
      () => window.desktop.customBackgroundSave({ patch: { brightness: 80 } }),
      () => window.desktop.customBackgroundRemove(),
    ]) {
      try { await operation(); results.push(false); } catch { results.push(true); }
    }
    return results;
  }), [true, true, true]);
  await mini.screenshot({ path: join(output, 'mini-custom-background.png') });
  const miniCoverage = await checkWorkspaceCoverage(mini, output, 'native-mini-continuous-workspace');
  await writeFile(join(output, 'workspace-coverage.json'), JSON.stringify({ main: mainCoverage, mini: miniCoverage }, null, 2));
  await mini.evaluate(() => window.desktop.windowControl('close')); mini = undefined;
  checks.push('MiniChat displays the shared background but cannot import, change, or remove it');
  await assertIdentity(afterRestart, 'MiniChat appearance reads must not create or replace a runtime');

  await configure();
  await settings().getByRole('button', { name: 'Delete background image', exact: true }).click();
  await page.getByRole('dialog', { name: 'Delete the local background image?', exact: true })
    .getByRole('button', { name: 'Cancel', exact: true }).click();
  assert.deepEqual((await state()).image, persisted.image);
  await settings().getByRole('button', { name: 'Delete background image', exact: true }).click();
  await page.getByRole('dialog', { name: 'Delete the local background image?', exact: true })
    .getByRole('button', { name: 'Delete image', exact: true }).click();
  await saved();
  await waitState(value => !value.image && !value.options.enabled,
    'Confirmed deletion removes the local image; canceled deletion preserves it');
  await importThroughSettings(pngPath);
  await saved();
  await imageReady();
  const beforeUninstall = await state();
  await conversation();
  await page.evaluate(async () => {
    const entry = (await window.desktop.capabilityCatalog()).available.find(item => item.name === 'custom-background');
    await window.desktop.capabilityMutate({
      action: 'plugin-install', name: entry.name, marketplace: entry.marketplace, ref: entry.package.ref,
    });
  });
  const reinstalled = await state();
  assert.equal(reinstalled.available, true);
  assert.deepEqual(reinstalled, beforeUninstall, 'Installing the legacy adapter cannot reset built-in settings');
  const center = page.getByRole('region', { name: 'Plugin center', exact: true });
  await page.getByRole('button', { name: 'Plugin marketplace', exact: true }).click();
  await center.getByRole('button', { name: 'Configure \u81ea\u5b9a\u4e49\u80cc\u666f', exact: true }).click();
  assert.equal(await settings().count(), 0, 'Legacy plugin does not retain a second editor');
  await center.getByRole('button', { name: 'Appearance settings', exact: true }).click();
  await settings().waitFor();
  await conversation();
  await page.evaluate(() => window.desktop.capabilityMutate({ action: 'plugin-remove', id: 'custom-background' }));
  assert.deepEqual(await state(), beforeUninstall);
  await imageReady();
  await assertIdentity(afterRestart, 'Uninstalling and reinstalling the adapter must retain the active draft');
  checks.push('Legacy plugin redirects to Appearance; installing or removing it cannot disable or erase built-in settings');

  await configure();
  await imageReady();
  for (const [width, palette] of [[1440, 'original-light'], [760, 'original-light'], [760, 'original-dark'], [1440, 'original-dark']]) {
    await selectTheme(palette);
    await page.setViewportSize({ width, height: 960 });
    for (const control of await settings().locator('button,input').all()) {
      if (!await control.isVisible() || await control.isDisabled()) continue;
      await control.focus();
      assert.deepEqual(await control.evaluate(element => {
        const rect = element.getBoundingClientRect(), clips = [];
        for (let parent = element.parentElement; parent; parent = parent.parentElement) {
          const bounds = parent.getBoundingClientRect(), style = getComputedStyle(parent);
          if (/hidden|clip|auto|scroll/.test(style.overflowX) && (rect.left - 4 < bounds.left + parent.clientLeft - 1
            || rect.right + 4 > bounds.left + parent.clientLeft + parent.clientWidth + 1)) clips.push(`${parent.className}:x`);
          if (/hidden|clip|auto|scroll/.test(style.overflowY) && (rect.top - 4 < bounds.top + parent.clientTop - 1
            || rect.bottom + 4 > bounds.top + parent.clientTop + parent.clientHeight + 1)) clips.push(`${parent.className}:y`);
        }
        return clips;
      }), [], `${width}/${palette}: native focus outline`);
    }
    await settings().locator('.custom-background-heading').scrollIntoViewIfNeeded();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.mouse.move(0, 0);
    await page.screenshot({ path: join(output, `builtin-settings-${width}-${palette}.png`) });
    await settings().locator('.custom-background-surfaces').scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(output, `builtin-surfaces-${width}-${palette}.png`) });
  }
  checks.push('Native Appearance editor and all focus outlines fit light/dark desktop and narrow windows');
  assert.deepEqual(errors, []);
  const savedState = JSON.parse(await readFile(join(profile, 'custom-background/state.json'), 'utf8'));
  assert.equal(savedState.schemaVersion, 2);
  assert.equal(savedState.instance, undefined);
  assert.equal(savedState.options.enabled, true);
  await close();
  // Exercise a real legacy profile on the new host, without reimporting its image.
  await writeFile(join(profile, 'custom-background/state.json'), JSON.stringify({
    ...savedState, schemaVersion: 1, instance: 'legacy-installation-fixture',
  }));
  await launch();
  await imageReady();
  assert.deepEqual((await state()).options, savedState.options);
  assert.deepEqual((await state()).image, savedState.image);
  const migrated = JSON.parse(await readFile(join(profile, 'custom-background/state.json'), 'utf8'));
  assert.equal(migrated.schemaVersion, 2);
  assert.equal(migrated.instance, undefined);
  checks.push('Real host migrates an enabled legacy plugin profile without changing the image or adjustments');
  await close();
  const results = { passed: true, build, profile, checks, errors };
  await writeFile(join(output, 'results.json'), JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results));
} catch (error) {
  await page?.screenshot({ path: join(output, 'failure.png') }).catch(() => {});
  if (page && !page.isClosed()) console.error((await page.locator('body').innerText()).slice(0, 5000));
  await writeFile(join(output, 'failure.json'), JSON.stringify({
    passed: false, build, profile, checks, errors, error: error.stack ?? String(error),
  }, null, 2));
  throw error;
} finally { await close(); }
