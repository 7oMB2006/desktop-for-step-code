import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import semver from 'semver';

const { version: currentVersion } = JSON.parse(await readFile(resolve('package.json'), 'utf8'));
const nextVersion = semver.inc(currentVersion, 'minor');
const feedVersion = semver.inc(nextVersion, 'minor');
assert.ok(nextVersion && feedVersion);

const profile = await mkdtemp(join(tmpdir(), 'desktop-app-updates-'));
await writeFile(join(profile, 'preferences.json'), JSON.stringify({ theme: 'light', language: 'zh', workspaces: [] }));
await mkdir('test-results', { recursive: true });
const env = { ...process.env, DESKTOP_TEST_USER_DATA: profile, DESKTOP_TEST_NO_FOCUS: '1' };
delete env.ELECTRON_RUN_AS_NODE;
let app;
const errors = [];
const launch = async () => {
  const executablePath = process.env.DESKTOP_VERIFY_EXE;
  app = await electron.launch({ ...(executablePath ? { executablePath } : { args: [resolve('.')] }), env, timeout: 60000 });
  const page = await app.firstWindow();
  await app.evaluate(({ BrowserWindow, dialog, net, shell }, { currentVersion, nextVersion, feedVersion }) => {
    const window = BrowserWindow.getAllWindows()[0];
    window.setOpacity(0); window.setIgnoreMouseEvents(true); window.showInactive(); window.setSize(1280, 900);
    dialog.showMessageBox = async () => ({ response: 1 });
    globalThis.updateFixture = { time: Date.now(), calls: [], opened: [], mode: 'available', release: null };
    Date.now = () => globalThis.updateFixture.time;
    shell.openExternal = async url => { globalThis.updateFixture.opened.push(url); };
    net.fetch = async (url, options) => {
      const fixture = globalThis.updateFixture;
      fixture.calls.push({ url, credentials: options.credentials, redirect: options.redirect, headers: options.headers });
      if (fixture.mode === 'pending') await new Promise(resolve => { fixture.release = resolve; });
      if (fixture.mode === 'network') throw new Error('fixture private error must not be shown');
      if (fixture.mode === 'rate-limit') return new Response('', { status: 429, headers: { 'retry-after': '120' } });
      if (fixture.mode === 'feed') return url.endsWith('latest.json') ? new Response('', { status: 404 })
        : new Response(`<feed xmlns="http://www.w3.org/2005/Atom"><id>tag:github.com,2008:https://github.com/7oMB2006/desktop-for-step-code/releases</id>
          <entry><title>Desktop for Step Code ${feedVersion}</title><link rel="alternate" href="https://github.com/7oMB2006/desktop-for-step-code/releases/tag/v${feedVersion}"/></entry></feed>`);
      const makeRelease = (version, preview = false) => ({
        version, tag: `v${version}`, prerelease: preview, name: `Desktop for Step Code ${version}`,
        url: `https://github.com/7oMB2006/desktop-for-step-code/releases/tag/v${version}`,
        publishedAt: '2026-10-08T00:00:00Z', notes: '## 本次更新\n\n- 支持 GitHub 版本检查\n- 保留任务和会话\n\n<script>unsafe</script>',
        installer: fixture.mode === 'missing' ? undefined : {
          name: `Desktop.for.Step.Code.Setup.${version}.exe`, size: 156_676_739,
          url: `https://github.com/7oMB2006/desktop-for-step-code/releases/download/v${version}/Desktop.for.Step.Code.Setup.${version}.exe`,
        },
      });
      return new Response(JSON.stringify({ schemaVersion: 1, repository: '7oMB2006/desktop-for-step-code',
        generatedAt: '2026-10-08T00:00:00Z', channels: {
          stable: fixture.mode === 'current' ? null : makeRelease('0.1.0'),
          preview: makeRelease(fixture.mode === 'current' ? currentVersion : nextVersion, true),
        } }));
    };
  }, { currentVersion, nextVersion, feedVersion });
  page.on('pageerror', error => errors.push(error.message));
  await page.waitForFunction(() => {
    const button = document.querySelector('.new-chat');
    return Boolean(window.desktop && button && !button.disabled);
  });
  return page;
};
const mode = async value => app.evaluate((_electron, value) => {
  globalThis.updateFixture.time += 60_001;
  globalThis.updateFixture.mode = value;
}, value);
const chooseChannel = async (page, id) => {
  await page.getByRole('combobox', { name: /^(更新通道|Update channel)$/ }).selectOption(id);
};
try {
  let page = await launch();
  assert.equal(await app.evaluate(() => globalThis.updateFixture.calls.length), 0, 'background acceptance cannot contact GitHub');
  await page.locator('.sidebar-bottom > button').click();
  await page.getByRole('button', { name: '通用', exact: true }).click();
  assert.equal(await page.getByRole('region', { name: '应用更新' }).count(), 0);
  await page.getByRole('button', { name: '版本更新', exact: true }).click();
  const updates = page.getByRole('region', { name: '应用更新' });
  await updates.getByText('尚未检查更新', { exact: true }).waitFor();
  assert.equal(await updates.getByRole('checkbox', { name: '自动检查更新' }).isChecked(), true);
  const channelTrigger = updates.getByRole('combobox', { name: '更新通道', exact: true });
  assert.equal(await channelTrigger.inputValue(), 'preview');
  assert.equal(await channelTrigger.evaluate(element => getComputedStyle(element).appearance), 'base-select');
  await channelTrigger.focus();
  await page.keyboard.press('Space');
  await page.waitForFunction(() => document.querySelector('.update-channel-field select')?.matches(':open'));
  assert.equal(await channelTrigger.evaluate(element => getComputedStyle(element, '::picker(select)').minWidth), `${await channelTrigger.evaluate(element => element.getBoundingClientRect().width)}px`);
  const triggerBox = await channelTrigger.boundingBox();
  const firstOptionBox = await channelTrigger.getByRole('option').first().boundingBox();
  assert.ok(triggerBox && firstOptionBox && firstOptionBox.y >= triggerBox.y + triggerBox.height,
    'channel picker opens below the trigger when there is enough space');
  await page.screenshot({ path: 'test-results/app-updates-channel-menu-light.png' });
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('.update-channel-field select')?.matches(':open'));
  assert.equal(await channelTrigger.evaluate(element => element === document.activeElement), true);
  await channelTrigger.click();
  await page.waitForFunction(() => document.querySelector('.update-channel-field select')?.matches(':open'));
  await page.getByRole('heading', { name: '版本更新', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('.update-channel-field select')?.matches(':open'));
  assert.ok((await updates.locator('.update-version').textContent()).includes(`v${currentVersion}`));
  await mode('pending');
  await updates.getByRole('button', { name: '检查更新', exact: true }).click();
  await updates.getByText('正在检查更新…', { exact: true }).waitFor();
  assert.equal(await updates.getByRole('button', { name: '检查更新', exact: true }).isEnabled(), false);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  assert.equal(await updates.locator('.update-spinning').evaluate(element => getComputedStyle(element).animationName), 'none');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await app.evaluate(() => { globalThis.updateFixture.mode = 'available'; globalThis.updateFixture.release(); });
  await updates.getByText(`发现新版本 ${nextVersion}`, { exact: true }).waitFor();
  await page.locator('.update-indicator').waitFor();
  await updates.getByText('版本说明', { exact: true }).click();
  assert.equal(await updates.locator('.update-notes script').count(), 0);
  assert.equal(await updates.locator('.update-notes h2').count(), 1);
  await updates.scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'test-results/app-updates-available-light.png' });
  await updates.getByRole('button', { name: '下载安装包', exact: true }).click();
  await updates.getByRole('button', { name: '发布页', exact: true }).click();
  const opened = await app.evaluate(() => globalThis.updateFixture.opened);
  assert.deepEqual(opened, [
    `https://github.com/7oMB2006/desktop-for-step-code/releases/download/v${nextVersion}/Desktop.for.Step.Code.Setup.${nextVersion}.exe`,
    `https://github.com/7oMB2006/desktop-for-step-code/releases/tag/v${nextVersion}`,
  ]);
  await assert.rejects(page.evaluate(() => window.desktop.openUpdate('https://evil.example')), /No verified update download/);
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.screenshot({ path: 'test-results/app-updates-sidebar-badge.png' });
  await mode('network');
  const backgroundFailure = await page.evaluate(() => window.desktop.checkUpdates());
  assert.equal(backgroundFailure.status, 'error');
  await page.locator('.update-indicator').waitFor();
  await page.locator('.sidebar-bottom > button').click();
  await updates.waitFor();
  assert.equal(await page.getByRole('button', { name: '版本更新', exact: true }).getAttribute('class'), 'selected');

  await app.evaluate(() => { globalThis.updateFixture.mode = 'available'; });
  await chooseChannel(page, 'stable');
  await updates.getByText('当前没有更高版本', { exact: true }).waitFor();
  assert.equal(await updates.getByRole('button', { name: '下载安装包', exact: true }).count(), 0);
  assert.equal(await page.locator('.update-indicator').count(), 0);
  await mode('current');
  await chooseChannel(page, 'preview');
  await updates.getByText('当前没有更高版本', { exact: true }).waitFor();
  await page.screenshot({ path: 'test-results/app-updates-current.png' });
  await assert.rejects(page.evaluate(() => window.desktop.openUpdate('download')), /No verified update download/);
  await mode('missing');
  await updates.getByRole('button', { name: '检查更新', exact: true }).click();
  await updates.getByText('此版本暂未提供 Windows x64 安装包。', { exact: true }).waitFor();
  assert.equal(await updates.getByRole('button', { name: '下载安装包', exact: true }).count(), 0);
  await mode('network');
  await updates.getByRole('button', { name: '检查更新', exact: true }).click();
  await updates.getByText('暂时连不上 GitHub，请检查网络后重试。', { exact: true }).waitFor();
  assert.ok(!(await updates.textContent()).includes('fixture private'));
  await page.screenshot({ path: 'test-results/app-updates-network.png' });
  await mode('rate-limit');
  await updates.getByRole('button', { name: '检查更新', exact: true }).click();
  await updates.getByText('GitHub 暂时限制了更新请求，请稍后重试。', { exact: true }).waitFor();
  const rateCalls = await app.evaluate(() => globalThis.updateFixture.calls.length);
  await updates.getByRole('button', { name: '检查更新', exact: true }).click();
  assert.equal(await app.evaluate(() => globalThis.updateFixture.calls.length), rateCalls);
  await app.evaluate(() => { globalThis.updateFixture.time += 180_000; globalThis.updateFixture.mode = 'available'; });
  await updates.getByRole('button', { name: '检查更新', exact: true }).click();
  await updates.getByText(`发现新版本 ${nextVersion}`, { exact: true }).waitFor();
  await page.getByRole('button', { name: '通用', exact: true }).click();
  await page.getByRole('dialog').getByLabel(/^主题/).selectOption('dark');
  await page.getByRole('button', { name: '版本更新', exact: true }).click();
  await page.locator('html[data-theme="dark"]').waitFor();
  await updates.scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'test-results/app-updates-available-dark.png' });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(640, 720));
  await updates.scrollIntoViewIfNeeded();
  assert.equal(await page.locator('.settings-content').evaluate(element => element.scrollWidth > element.clientWidth), false);
  await page.screenshot({ path: 'test-results/app-updates-narrow.png' });
  await channelTrigger.click();
  await page.waitForFunction(() => document.querySelector('.update-channel-field select')?.matches(':open'));
  const menuBox = await channelTrigger.getByRole('option').first().boundingBox();
  assert.ok(menuBox && menuBox.x >= 0 && menuBox.y >= 0 && menuBox.x + menuBox.width <= 640 && menuBox.y + menuBox.height <= 720);
  await page.screenshot({ path: 'test-results/app-updates-channel-menu-narrow.png' });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  assert.equal(await channelTrigger.evaluate(element => getComputedStyle(element, '::picker-icon').transitionDuration), '0s');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('.update-channel-field select')?.matches(':open'));
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await updates.getByRole('checkbox', { name: '自动检查更新' }).click();
  await page.waitForFunction(() => document.querySelector('.update-preferences input')?.checked === false);
  assert.equal(await updates.getByRole('checkbox', { name: '自动检查更新' }).isChecked(), false);
  await chooseChannel(page, 'stable');
  await assert.rejects(page.evaluate(() => window.desktop.preferences({ updateChannel: 'nightly' })), /Invalid update channel/);
  await assert.rejects(page.evaluate(() => window.desktop.preferences({ autoCheckUpdates: 'true' })), /Invalid automatic update setting/);
  await page.getByRole('button', { name: '通用', exact: true }).click();
  await page.getByRole('dialog').getByLabel(/^语言/).selectOption('en');
  await page.getByRole('button', { name: 'Updates', exact: true }).click();
  await page.getByRole('region', { name: 'App updates' }).waitFor();
  await page.getByRole('region', { name: 'App updates' }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'test-results/app-updates-english.png' });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1280, 900));
  await app.evaluate(() => { globalThis.updateFixture.time += 60_001; globalThis.updateFixture.mode = 'feed'; });
  await chooseChannel(page, 'preview');
  const fallback = page.getByRole('region', { name: 'App updates' });
  await fallback.getByText(`Version ${feedVersion} is available`, { exact: true }).waitFor();
  assert.equal(await fallback.getByRole('button', { name: 'Download installer', exact: true }).count(), 0);
  await fallback.getByText('Check the releases page for a Windows x64 installer.', { exact: true }).waitFor();
  await page.locator('.update-indicator').waitFor();
  await chooseChannel(page, 'stable');
  await fallback.getByText('The stable update manifest is not published yet. Check the releases page.', { exact: true }).waitFor();
  const requests = await app.evaluate(() => globalThis.updateFixture.calls);
  assert.ok(requests.every(request => ['https://raw.githubusercontent.com/7oMB2006/desktop-for-step-code/update-feed/latest.json',
    'https://github.com/7oMB2006/desktop-for-step-code/releases.atom'].includes(request.url)
    && request.credentials === 'omit' && request.redirect === 'error' && !request.headers.Authorization));
  await app.close(); app = undefined;
  const saved = JSON.parse(await readFile(join(profile, 'preferences.json'), 'utf8'));
  assert.equal(saved.autoCheckUpdates, false);
  assert.equal(saved.updateChannel, 'stable');
  page = await launch();
  assert.equal((await page.evaluate(() => window.desktop.updateState())).channel, 'stable');
  assert.equal((await page.evaluate(() => window.desktop.snapshot())).preferences.autoCheckUpdates, false);
  assert.deepEqual(errors, []);
  console.log('App updates: state transitions, official links, missing installer, errors/rate limits, theme/narrow/i18n/reduced motion, preferences and restart passed.');
} finally { if (app) await app.close(); }
