import assert from 'node:assert/strict';
import { join } from 'node:path';

// Exercise actual IPC and renderer presentation. Native application launches and
// release-network requests stay intercepted inside the disposable Electron app.
export async function verifyLinuxPlatformUi({ app, page, project, runtimeId }) {
  const target = { runtimeId, path: 'fixture.txt' };
  const options = await page.evaluate(target => window.desktop.fileOpenOptions(target), target);
  assert.deepEqual(options.choices.map(choice => choice.id), ['internal', 'system']);
  for (const destination of ['other', 'app:unsupported-windows-application']) {
    await assert.rejects(page.evaluate(({ target, destination }) => window.desktop.fileOpen(target, destination),
      { target, destination }), /only available on Windows/);
  }

  const releaseUrl = 'https://github.com/7oMB2006/desktop-for-step-code/releases/tag/v99.0.0';
  await app.evaluate(({ net, shell }, releaseUrl) => {
    globalThis.linuxPlatformUi = { fetch: net.fetch, openPath: shell.openPath, openExternal: shell.openExternal,
      files: [], links: [], requests: [] };
    shell.openPath = async path => { globalThis.linuxPlatformUi.files.push(path); return ''; };
    shell.openExternal = async url => { globalThis.linuxPlatformUi.links.push(url); };
    net.fetch = async url => {
      globalThis.linuxPlatformUi.requests.push(url);
      if (url !== 'https://raw.githubusercontent.com/7oMB2006/desktop-for-step-code/update-feed/latest.json') {
        throw new Error('Unexpected release request in Linux fixture');
      }
      const release = { version: '99.0.0', tag: 'v99.0.0', name: 'Linux platform presentation fixture',
        prerelease: false, url: releaseUrl, notes: 'Local acceptance fixture',
        installer: { name: 'Desktop.for.Step.Code.Setup.99.0.0.exe', size: 1000,
          url: 'https://github.com/7oMB2006/desktop-for-step-code/releases/download/v99.0.0/Desktop.for.Step.Code.Setup.99.0.0.exe' } };
      return new Response(JSON.stringify({ schemaVersion: 1, repository: '7oMB2006/desktop-for-step-code',
        generatedAt: new Date().toISOString(), channels: { stable: release, preview: release } }));
    };
  }, releaseUrl);
  try {
    assert.deepEqual(await page.evaluate(target => window.desktop.fileOpen(target, 'system'), target), { destination: 'external' });
    assert.deepEqual(await app.evaluate(() => globalThis.linuxPlatformUi.files), [join(project, 'fixture.txt')]);
    await page.locator('.sidebar-bottom > button').click();
    const dialog = page.getByRole('dialog', { name: 'Settings', exact: true });
    await dialog.getByRole('button', { name: 'Updates', exact: true }).click();
    const updates = dialog.getByRole('region', { name: 'App updates' });
    assert.match(await updates.locator('.update-version').textContent(), /Linux x64/);
    assert.doesNotMatch(await updates.locator('.update-version').textContent(), /Windows x64/);
    await updates.getByRole('button', { name: 'Check for updates', exact: true }).click();
    await updates.getByText('Version 99.0.0 is available', { exact: true }).waitFor();
    assert.equal(await updates.locator('.update-package-missing').textContent(),
      'The update feed currently provides Windows installers. For the Linux preview, view the release notes.');
    assert.equal(await updates.getByRole('button', { name: 'Download installer', exact: true }).count(), 0);
    await assert.rejects(page.evaluate(() => window.desktop.openUpdate('download')), /No verified update download/);
    await updates.getByRole('button', { name: 'Releases', exact: true }).click();
    assert.deepEqual(await app.evaluate(() => globalThis.linuxPlatformUi.links), [releaseUrl]);
    assert.equal((await app.evaluate(() => globalThis.linuxPlatformUi.requests)).length, 1);
    await page.screenshot({ path: 'test-results/linux-platform-updates.png' });
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    await dialog.waitFor({ state: 'hidden' });
  } finally {
    await app.evaluate(({ net, shell }) => {
      const saved = globalThis.linuxPlatformUi;
      net.fetch = saved.fetch; shell.openPath = saved.openPath; shell.openExternal = saved.openExternal;
      delete globalThis.linuxPlatformUi;
    });
  }
}
